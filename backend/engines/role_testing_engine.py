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
from dataclasses import dataclass
from typing import Callable, Optional

from engines.result import EngineResult


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

    # Individual task links inside an open Tasks/Actions panel.
    # PLACEHOLDER — verify against the real Oracle DOM. This guess targets
    # anchor/link nodes carrying a @title inside the task panel region; the
    # exact id/class pattern must be confirmed on a live instance. When the
    # capture-tasks toggle is on and this matches nothing, the run logs a
    # warning, keeps the panel screenshot, and moves on (never breaks).
    task_item_xpath: str = (
        "//*["
        "(starts-with(@id, '_FOpt1:_FOr1:0:_FONSr2:0:_FOTsr') or "
        "contains(@id, ':_FOTsr')) and "
        "@title and "
        "(self::a or @role='link' or @role='menuitem')"
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


# ── Login failure types ──────────────────────────────────────────────────────────
# Distinguished so the run can report the actual cause: an unreachable/invalid URL
# vs. the login page loading fine but the credentials being rejected.

class UrlUnreachableError(Exception):
    """The Oracle URL could not be reached or the login form never loaded."""


class InvalidCredentialsError(Exception):
    """Login page reached, but sign-in did not succeed after every attempt."""


# ── Result types ────────────────────────────────────────────────────────────────

@dataclass
class ElementResult:
    """Outcome of processing a single Navigator work-area item."""
    index: int
    title: str
    screenshot: Optional[str] = None       # filename within screenshot_dir, or None
    status: str = "error"                  # captured | captured_no_task | skipped | error
    message: str = ""


# ── WebDriver factory (the only place real Selenium is constructed) ────────────

def _default_chrome_driver(headless: bool = True):
    """Build a Chrome WebDriver. Imported lazily so this module — and
    `import main` — load fine on hosts without Chrome/Selenium installed.

    headless=False opens a visible browser window (local review only); the
    deployed host always runs headless."""
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options

    options = Options()
    if headless:
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
    """Log into Oracle Cloud. Credentials are never logged.

    Two failure modes are raised distinctly:
      - UrlUnreachableError: the URL would not load or the login form never
        appeared (bad/unreachable URL) — not retried, it cannot succeed.
      - InvalidCredentialsError: the login page loaded but sign-in did not
        succeed after ``sel.max_retries`` attempts (wrong username/password).
    """
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    # ── Phase 1: reach the Oracle login page ──────────────────────────────────
    # A failure to load the page or find the login form means the URL is wrong or
    # unreachable — retrying the same URL cannot help, so fail fast.
    try:
        driver.get(url)
        user_field = WebDriverWait(driver, sel.default_wait).until(
            EC.presence_of_element_located((By.ID, sel.username_id))
        )
    except Exception as exc:  # noqa: BLE001 — driver.get / wait raise many types
        logger.error(f"Could not reach the Oracle login page: {exc}")
        raise UrlUnreachableError(str(exc)) from exc

    logger.info("Reached Oracle login page; submitting credentials")

    # ── Phase 2: submit credentials, up to max_retries attempts ───────────────
    for attempt in range(1, sel.max_retries + 1):
        try:
            user_field = WebDriverWait(driver, sel.default_wait).until(
                EC.presence_of_element_located((By.ID, sel.username_id))
            )
            user_field.clear()
            user_field.send_keys(username)

            pwd_field = WebDriverWait(driver, sel.default_wait).until(
                EC.presence_of_element_located((By.ID, sel.password_id))
            )
            pwd_field.clear()
            pwd_field.send_keys(password + Keys.RETURN)

            # Navigator icon present == login succeeded
            WebDriverWait(driver, sel.login_wait).until(
                EC.presence_of_element_located((By.XPATH, sel.navigator_icon_xpath))
            )
            logger.info(f"Login successful on attempt {attempt}")
            return
        except Exception as exc:  # noqa: BLE001 — timeout / stale form / etc.
            logger.warning(f"Login attempt {attempt}/{sel.max_retries} failed: {exc}")
            if attempt < sel.max_retries:
                time.sleep(sel.retry_delay)
                driver.get(url)  # reload a fresh login form for the next attempt

    raise InvalidCredentialsError(
        f"Sign-in failed after {sel.max_retries} attempts."
    )


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


def _id_candidates(el_id: str) -> list[str]:
    """The two ID forms an Oracle node alternates between across navigations:
    the raw id and its ``_FO``-prefixed form. Oracle re-renders ids on drill-in,
    but always to one of these two — so to re-find a node, try both."""
    if el_id.startswith("_FO"):
        return [el_id, el_id[3:]]
    return [el_id, f"_FO{el_id}"]


def _click_trying_both(interactor: _Interactor, el_id: str) -> bool:
    """Click a node by id, trying both id forms (raw and ``_FO``-prefixed)."""
    for candidate in _id_candidates(el_id):
        if interactor.click(candidate):
            return True
    return False


def _open_task_panel(driver, sel: OracleSelectors) -> bool:
    """Click the Tasks/Actions panel button if present. Returns True if opened."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import TimeoutException

    try:
        WebDriverWait(driver, sel.login_wait).until(
            EC.invisibility_of_element_located((By.ID, sel.nav_mask_id))
        )
    except TimeoutException:
        pass
    try:
        btn = WebDriverWait(driver, sel.element_wait).until(
            EC.element_to_be_clickable((By.XPATH, sel.task_button_xpath))
        )
        btn.click()
        time.sleep(sel.page_load_delay)
        return True
    except TimeoutException:
        return False


def _scrape_tasks(driver, sel: OracleSelectors, logger) -> list[tuple[str, str]]:
    """Return [(id, title)] for individual task items in the open Tasks panel."""
    from selenium.webdriver.common.by import By

    found: list[tuple[str, str]] = []
    for el in driver.find_elements(By.XPATH, sel.task_item_xpath):
        try:
            el_id = el.get_attribute("id")
            el_title = el.get_attribute("title")
            if el_id and el_title and el.is_displayed():
                found.append((el_id, el_title))
        except Exception:  # noqa: BLE001 — skip stale/odd nodes
            continue
    logger.info(f"Scraped {len(found)} task items from the panel")
    return found


def _capture_tasks(driver, interactor: _Interactor, sel: OracleSelectors,
                   screenshot_dir: str, work_area_id: str, work_area_index: int,
                   start_index: int, logger) -> tuple[list[ElementResult], int]:
    """Drill into each task of the open Tasks panel and screenshot it.

    For every task: click it (trying both id forms) → screenshot → return to the
    work area via Navigator (trying both work-area id forms) → reopen the Tasks
    panel → continue with the next task (re-found by its title on the fresh panel,
    again trying both id forms). Returns (task_results, next_free_index).

    Never raises: a task that can't be opened becomes an 'error' ElementResult and
    the loop continues. Title is used to re-find a task because ids churn.
    """
    tasks = _scrape_tasks(driver, sel, logger)
    if not tasks:
        return [], start_index

    titles = [t for _, t in tasks]
    results: list[ElementResult] = []
    idx = start_index

    for pos, (task_id, title) in enumerate(tasks):
        if not _click_trying_both(interactor, task_id):
            results.append(ElementResult(index=idx, title=title, status="error",
                                         message="Task item was not clickable."))
            idx += 1
            continue

        time.sleep(sel.page_load_delay)
        shot = _capture_screenshot(driver, screenshot_dir, f"task {title}", idx)
        results.append(ElementResult(index=idx, title=f"Task — {title}",
                                     screenshot=shot, status="captured"))
        idx += 1

        # Return to the work area for the next task (skip after the last one).
        if pos == len(tasks) - 1:
            break
        if not interactor.click(sel.navigator_icon_xpath, "xpath", back_on_fail=True) \
                or not _click_trying_both(interactor, work_area_id):
            logger.warning(f"Could not return to work area {work_area_index} "
                           f"after task '{title}'; stopping task capture here.")
            break
        time.sleep(sel.page_load_delay)
        if not _open_task_panel(driver, sel):
            logger.warning(f"Tasks panel did not reopen for work area "
                           f"{work_area_index}; stopping task capture here.")
            break
        # Re-find the next task by title on the freshly rendered panel.
        fresh = _scrape_tasks(driver, sel, logger)
        by_title = {t: i for i, t in fresh}
        next_title = titles[pos + 1]
        if next_title in by_title:
            tasks[pos + 1] = (by_title[next_title], next_title)

    return results, idx


def _process_element(driver, interactor: _Interactor, sel: OracleSelectors,
                     screenshot_dir: str, el_id: str, title: str, index: int,
                     logger, *, capture_tasks: bool = False,
                     task_start_index: int = 0
                     ) -> tuple[ElementResult, list[ElementResult]]:
    """Click one work-area item, open its Tasks panel if present, screenshot it.

    When ``capture_tasks`` is True, also drill into each individual task in the
    panel (see ``_capture_tasks``). Returns ``(work_area_result, task_results)``;
    ``task_results`` is empty unless ``capture_tasks`` is on and tasks were found.
    Raises only on a hard click failure (caller treats that as status='error')."""
    if not interactor.click(el_id, back_on_fail=True):
        return (ElementResult(index=index, title=title, status="error",
                              message="Work-area item was not clickable."), [])

    time.sleep(sel.page_load_delay)

    # Open the Tasks/Actions panel (clears the loading overlay first).
    opened = _open_task_panel(driver, sel)
    status = "captured" if opened else "captured_no_task"

    shot = _capture_screenshot(driver, screenshot_dir, title, index)
    wa_result = ElementResult(index=index, title=title, screenshot=shot, status=status)

    task_results: list[ElementResult] = []
    if capture_tasks and opened:
        task_results, _ = _capture_tasks(
            driver, interactor, sel, screenshot_dir,
            el_id, index, task_start_index, logger,
        )
        if not task_results:
            logger.warning(f"Capture-tasks on, but no task items found for "
                           f"work area {index} ('{title}'). Selector may need "
                           f"updating for the live Oracle DOM.")

    return wa_result, task_results


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
    headless: bool = True,
    capture_tasks: bool = False,
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
    # The default factory takes `headless`; injected (test) factories take none.
    if driver_factory is None:
        driver = _default_chrome_driver(headless=headless)
    else:
        driver = driver_factory()

    os.makedirs(screenshot_dir, exist_ok=True)
    elements: list[ElementResult] = []
    warnings: list[str] = []
    started = time.monotonic()

    try:
        _emit(2, "Launching browser…")
        try:
            _login(driver, url, username, password, selectors, logger)
        except UrlUnreachableError:
            return EngineResult(
                success=False,
                errors=["The provided URL is invalid or cannot be reached."],
            )
        except InvalidCredentialsError:
            return EngineResult(
                success=False,
                errors=["The username or password provided is incorrect. "
                        "Please verify your credentials and try again."],
            )

        # Capture the landing/home page that appears right after login.
        home_shot = _capture_screenshot(driver, screenshot_dir, "Home", 0)
        elements.append(ElementResult(index=0, title="Home Page",
                                      screenshot=home_shot, status="captured"))

        _emit(8, "Opening Navigator…")
        interactor = _Interactor(driver, selectors, logger)
        popup = _open_navigator_popup(driver, interactor, selectors, logger)

        # Capture the open Navigator popup (Show More) listing every work area.
        nav_shot = _capture_screenshot(driver, screenshot_dir, "Navigator", 1)
        elements.append(ElementResult(index=1, title="Navigator — All Work Areas",
                                      screenshot=nav_shot, status="captured"))

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
        # Home + Navigator popup were already captured above.
        captured = 2
        failed = skipped = 0
        # Task screenshots get indices after the work-area block (2..total+1).
        task_index = total + 2

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
                task_res: list[ElementResult] = []
                try:
                    res, task_res = _process_element(
                        driver, interactor, selectors, screenshot_dir,
                        el_id, title, index, logger,
                        capture_tasks=capture_tasks, task_start_index=task_index,
                    )
                except Exception as exc:  # noqa: BLE001 — never abort the whole run
                    logger.error(f"Element {index} ('{title}') failed: {exc}")
                    res = ElementResult(index=index, title=title, status="error",
                                        message=str(exc))
                elements.append(res)
                if res.status in ("captured", "captured_no_task"):
                    captured += 1
                else:
                    failed += 1
                for tr in task_res:
                    elements.append(tr)
                    task_index += 1
                    if tr.status == "captured":
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
