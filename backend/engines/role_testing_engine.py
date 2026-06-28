"""Role Testing Bot Engine — refactored from Automation_Bot-main/Code_v2.py.

Drives a headless Chrome session through Oracle Fusion Cloud: logs in, opens the
Navigator "Show More" popup, walks every work-area item, optionally clicks its
Tasks/Actions panel, and captures a numbered screenshot of each.

Refactor of the original hardcoded script:
  - All Oracle element IDs/XPaths live in one `OracleSelectors` config object.
  - Pure engine: NO FastAPI, NO Pydantic, NO HTTP. Selenium is imported here only.
  - Progress reported via an injectable `progress_callback(percent, message)`.
  - The WebDriver is built by an injectable `driver_factory` so the whole flow is
    testable offline with a fake driver (real Chrome only at runtime). Selenium is
    constructed lazily inside `_default_chrome_driver`, so importing this module
    (and `main`) does not require Chrome to be installed.
  - One failing work-area no longer aborts the run — each element gets an
    `ElementResult` status and the loop continues.
  - Credentials are passed in, used inside the driver stack frame, and never
    stored, logged, or returned.
"""

import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional


# ── Selector / timing configuration (config-driven; was hardcoded in Code_v2) ──

@dataclass(frozen=True)
class OracleSelectors:
    """Every Oracle Fusion UI selector and timing knob in one place.

    The selector *strings* are byte-identical to the original Code_v2.py — they
    are Oracle-specific and must not be "improved". Change them here (one edit)
    when Oracle's UI changes.
    """
    # Login fields
    username_id: str = "userid"
    password_id: str = "password"

    # Navigator / popup
    navigator_icon_xpath: str = "//*[contains(@id, '_UISmmLink::icon')]"
    show_more_id: str = "pt1:_UISnvr:0:nvcl1"
    popup_container_id: str = "pt1:_UISmmp2::popup-container"
    nav_mask_id: str = "navmenuMaskDiv"

    # Tasks/Actions/Related-Links panel button shown on a work-area page
    task_button_xpath: str = (
        "//*["
        "(starts-with(@id, '_FOpt1:_FOr1:0:_FONSr2:0:_FOTs') or "
        "starts-with(@id, '_FOpt1:_FOr1:0:_FONSr2:0:_FOTsr')) and "
        "contains(@id, '::icon') and "
        "contains(@id, 'sdi') and "
        "(@title='Tasks' or @title='Actions' or @title='Related Links')"
        "]"
    )

    # Navigator items to skip (Oracle areas that hang/redirect the bot)
    skip_ids: frozenset = frozenset({
        "_FOpt1:_UISnvr:0:nv_itemNode_manufacturing_work_definition",
        "_FOpt1:_UISnvr:0:nv_itemNode_MyEnterprise_setup_and_maintenance",
        "_FOpt1:_UISnvr:0:nvd_c_fcf49d68f30248568173f6bcbb51e752",
        "_FOpt1:_UISnvr:0:nvd_itemNode_configuration_VisualBuilder",
    })

    # Timing / retries (seconds)
    default_wait: int = 10
    element_wait: int = 5
    login_wait: int = 20
    max_retries: int = 3
    retry_delay: int = 2
    page_load_delay: int = 5


DEFAULT_SELECTORS = OracleSelectors()


# ── Result types (mirror the other engines' EngineResult shape) ────────────────

@dataclass
class ElementResult:
    """Outcome of processing a single Navigator work-area item."""
    index: int
    title: str
    screenshot: Optional[str] = None       # filename within screenshot_dir, or None
    status: str = "error"                  # captured | captured_no_task | skipped | error
    message: str = ""


@dataclass
class EngineResult:
    """Structured return type for all engine functions."""
    success: bool
    data: Any = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ── WebDriver factory (the only place real Selenium is constructed) ────────────

def _default_chrome_driver():
    """Build a headless Chrome WebDriver. Imported lazily so this module — and
    `import main` — load fine on hosts without Chrome/Selenium installed."""
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options

    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])

    driver = webdriver.Chrome(options=options)
    driver.set_window_size(1920, 1080)
    return driver


# ── Small helpers ──────────────────────────────────────────────────────────────

def _safe_filename(title: str) -> str:
    """Sanitise a work-area title into a filesystem-safe name (kept from original)."""
    return "".join(c for c in title if c.isalnum() or c in (" ", "_", "-")).strip()


def _prepare_element_ids(raw_ids: list[str]) -> list[str]:
    """Return the final clickable IDs for the work-area loop.

    Oracle re-renders Navigator item IDs with an ``_FO`` prefix after the first
    drill-in: the 2nd item is clicked with its raw ID, but the 3rd item onward
    must be addressed as ``_FO<id>``. The original script did this by mutating a
    list of dicts at magic indices; this is the same behaviour expressed as a
    pure, testable transform over the *processable* IDs (i.e. excluding the first
    Navigator entry, which the original never clicked).

    Input  : raw_ids for elements[1:]  (everything after the first popup entry)
    Output : index 0 (the 2nd element overall) unchanged; index 1+ get ``_FO``.
    """
    prepared: list[str] = []
    for i, raw in enumerate(raw_ids):
        prepared.append(raw if i == 0 else f"_FO{raw}")
    return prepared


class _Interactor:
    """Click-with-retry helper (kept from Code_v2's ElementInteractor)."""

    def __init__(self, driver, selectors: OracleSelectors, logger) -> None:
        self.driver = driver
        self.sel = selectors
        self.log = logger

    def click(self, locator: str, by: str = "id", timeout: Optional[int] = None,
              retries: Optional[int] = None, back_on_fail: bool = False) -> bool:
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.common.exceptions import (
            StaleElementReferenceException, ElementNotInteractableException,
            TimeoutException,
        )

        by_obj = By.XPATH if by == "xpath" else By.ID
        timeout = timeout or self.sel.element_wait
        retries = retries or self.sel.max_retries

        for attempt in range(retries):
            try:
                el = WebDriverWait(self.driver, timeout).until(
                    EC.element_to_be_clickable((by_obj, locator))
                )
                el.click()
                return True
            except (StaleElementReferenceException, ElementNotInteractableException) as exc:
                self.log.warning(f"click attempt {attempt + 1} failed: {exc}")
                time.sleep(self.sel.retry_delay)
            except TimeoutException:
                self.log.warning(f"click attempt {attempt + 1} timed out: {locator}")
                if back_on_fail and attempt < retries - 1:
                    self._back()
            except Exception as exc:  # noqa: BLE001 — driver can raise many things
                self.log.warning(f"click attempt {attempt + 1} error: {exc}")
                if back_on_fail and attempt < retries - 1:
                    self._back()
        return False

    def _back(self) -> None:
        try:
            self.driver.back()
            time.sleep(self.sel.page_load_delay)
        except Exception as exc:  # noqa: BLE001
            self.log.warning(f"navigate-back failed: {exc}")


# ── Engine sub-steps ───────────────────────────────────────────────────────────

def _login(driver, url: str, username: str, password: str,
           sel: OracleSelectors, logger) -> None:
    """Log into Oracle Cloud. Raises on failure. Credentials are never logged."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    driver.get(url)
    logger.info("Opened Oracle URL; submitting credentials")

    user_field = WebDriverWait(driver, sel.default_wait).until(
        EC.presence_of_element_located((By.ID, sel.username_id))
    )
    user_field.send_keys(username)

    pwd_field = WebDriverWait(driver, sel.default_wait).until(
        EC.presence_of_element_located((By.ID, sel.password_id))
    )
    pwd_field.send_keys(password + Keys.RETURN)

    # Navigator icon present == login succeeded
    WebDriverWait(driver, sel.login_wait).until(
        EC.presence_of_element_located((By.XPATH, sel.navigator_icon_xpath))
    )
    logger.info("Login successful")


def _open_navigator_popup(driver, interactor: _Interactor, sel: OracleSelectors, logger):
    """Click Navigator → Show More and return the popup container element."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    # By is used below for the popup-container wait.
    if not interactor.click(sel.navigator_icon_xpath, "xpath", back_on_fail=True):
        raise RuntimeError("Could not open the Navigator menu.")
    if not interactor.click(sel.show_more_id, back_on_fail=True):
        raise RuntimeError("Could not click 'Show More' in the Navigator.")

    popup = WebDriverWait(driver, sel.default_wait).until(
        EC.visibility_of_element_located((By.ID, sel.popup_container_id))
    )
    logger.info("Navigator popup is open")
    return popup


def _extract_elements(driver, popup, logger) -> list[tuple[str, str]]:
    """Return [(id, title)] for visible/clickable work-area items in the popup."""
    from selenium.webdriver.common.by import By

    found: list[tuple[str, str]] = []
    for el in popup.find_elements(By.XPATH, ".//*[@id]"):
        try:
            el_id = el.get_attribute("id")
            el_title = el.get_attribute("title")
            if (el_id and el_title
                    and not el_id.startswith("pt1:_UISnvr:0:nvg")
                    and el.is_displayed() and el.is_enabled()):
                found.append((el_id, el_title))
        except Exception:  # noqa: BLE001 — skip stale/odd nodes
            continue
    logger.info(f"Extracted {len(found)} clickable work-area items")
    return found


def _capture_screenshot(driver, screenshot_dir: str, title: str, index: int) -> str:
    """Save a screenshot and return its filename (within screenshot_dir)."""
    filename = f"{index:02d}_{_safe_filename(title)}.png"
    driver.save_screenshot(os.path.join(screenshot_dir, filename))
    return filename


def _process_element(driver, interactor: _Interactor, sel: OracleSelectors,
                     screenshot_dir: str, el_id: str, title: str, index: int,
                     logger) -> ElementResult:
    """Click one work-area item, open its Tasks panel if present, screenshot it.

    Returns an ElementResult; raises only on a hard click failure (caller treats
    that as status='error' and continues to the next item)."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import TimeoutException

    if not interactor.click(el_id, back_on_fail=True):
        return ElementResult(index=index, title=title, status="error",
                             message="Work-area item was not clickable.")

    time.sleep(sel.page_load_delay)

    # Wait for the loading overlay to clear, then try the Tasks/Actions button.
    status = "captured"
    try:
        WebDriverWait(driver, sel.login_wait).until(
            EC.invisibility_of_element_located((By.ID, sel.nav_mask_id))
        )
    except TimeoutException:
        pass  # overlay never appeared / already gone

    try:
        task_btn = WebDriverWait(driver, sel.element_wait).until(
            EC.element_to_be_clickable((By.XPATH, sel.task_button_xpath))
        )
        task_btn.click()
        time.sleep(sel.page_load_delay)
    except TimeoutException:
        status = "captured_no_task"  # no Tasks panel on this page — still capture

    shot = _capture_screenshot(driver, screenshot_dir, title, index)
    return ElementResult(index=index, title=title, screenshot=shot, status=status)


# ── Public entry point ─────────────────────────────────────────────────────────

def run(
    url: str,
    username: str,
    password: str,
    screenshot_dir: str,
    logger,
    *,
    selectors: OracleSelectors = DEFAULT_SELECTORS,
    max_elements: Optional[int] = None,
    overall_timeout: Optional[int] = None,
    progress_callback: Optional[Callable[[int, str], None]] = None,
    driver_factory: Optional[Callable[[], Any]] = None,
) -> EngineResult:
    """Run the full Oracle screenshot walk and return an EngineResult.

    On success, ``data`` = {
        "elements": list[ElementResult],
        "screenshot_dir": str,
        "captured": int, "failed": int, "skipped": int,
    }.

    The driver is always quit in a finally block, so credentials live only within
    this call. ``driver_factory`` is injectable for offline testing.
    """

    def _emit(pct: int, msg: str) -> None:
        if progress_callback:
            progress_callback(pct, msg)

    # Resolve the factory at call-time (not def-time) so tests/callers can swap
    # _default_chrome_driver via monkeypatch without re-binding a default arg.
    if driver_factory is None:
        driver_factory = _default_chrome_driver

    os.makedirs(screenshot_dir, exist_ok=True)
    elements: list[ElementResult] = []
    warnings: list[str] = []
    started = time.monotonic()

    driver = driver_factory()
    try:
        _emit(2, "Launching browser…")
        try:
            _login(driver, url, username, password, selectors, logger)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Login failed: {exc}")
            return EngineResult(
                success=False,
                errors=["Login failed. Check the Oracle URL and credentials, "
                        "then try again."],
            )

        _emit(8, "Opening Navigator…")
        interactor = _Interactor(driver, selectors, logger)
        popup = _open_navigator_popup(driver, interactor, selectors, logger)
        raw = _extract_elements(driver, popup, logger)

        if len(raw) <= 1:
            return EngineResult(
                success=False,
                errors=["No work-area items were found in the Navigator menu."],
            )

        # Elements after the first popup entry are the processable ones; their IDs
        # get the _FO re-prefixing (2nd raw, 3rd+ prefixed). Titles stay aligned.
        processable = raw[1:]
        prepared_ids = _prepare_element_ids([rid for rid, _ in processable])
        titles = [t for _, t in processable]

        if max_elements is not None:
            prepared_ids = prepared_ids[:max_elements]
            titles = titles[:max_elements]

        total = len(prepared_ids)
        captured = failed = skipped = 0

        for i, (el_id, title) in enumerate(zip(prepared_ids, titles)):
            index = i + 2  # original numbering starts work areas at 2

            if overall_timeout is not None and (time.monotonic() - started) > overall_timeout:
                warnings.append(
                    f"Run timeout reached after {index - 2} work areas; "
                    f"{total - i} remaining were skipped."
                )
                logger.warning(warnings[-1])
                break

            if el_id in selectors.skip_ids:
                elements.append(ElementResult(index=index, title=title,
                                              status="skipped",
                                              message="On the skip list."))
                skipped += 1
            else:
                try:
                    res = _process_element(driver, interactor, selectors,
                                           screenshot_dir, el_id, title, index, logger)
                except Exception as exc:  # noqa: BLE001 — never abort the whole run
                    logger.error(f"Element {index} ('{title}') failed: {exc}")
                    res = ElementResult(index=index, title=title, status="error",
                                        message=str(exc))
                elements.append(res)
                if res.status in ("captured", "captured_no_task"):
                    captured += 1
                else:
                    failed += 1

            _emit(10 + int(85 * (i + 1) / total),
                  f"Captured {captured} of {total} work areas…")

            # Return to Navigator for the next item (best-effort).
            interactor.click(selectors.navigator_icon_xpath, "xpath", back_on_fail=True)
            time.sleep(1)

        logger.info(f"Run complete: {captured} captured, {failed} failed, {skipped} skipped")
        return EngineResult(
            success=True,
            data={
                "elements": elements,
                "screenshot_dir": screenshot_dir,
                "captured": captured,
                "failed": failed,
                "skipped": skipped,
            },
            warnings=warnings,
        )
    finally:
        try:
            driver.quit()
        except Exception:  # noqa: BLE001
            pass
