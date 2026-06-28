"""Offline tests for the Role Testing Bot — no real Chrome or Oracle needed.

A FakeDriver simulates Selenium just enough to exercise the engine's control flow:
login, Navigator popup, element extraction, per-element clicks/screenshots, the
_FO ID re-prefixing, skip handling, the cap/timeout knobs, and the failure paths.
The router flow is exercised end-to-end through TestClient by monkeypatching the
engine's driver_factory (via the run_bot call) — real Chrome is only ever used at
actual runtime.
"""

from __future__ import annotations

import os
import sys

import pytest

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from engines import role_testing_engine as rte  # noqa: E402
from engines.role_testing_engine import (  # noqa: E402
    run, _prepare_element_ids, OracleSelectors, EngineResult,
)
from shared.logger import get_logger  # noqa: E402

_LOG = get_logger("role_testing_test")

# A 1x1 PNG so save_screenshot writes real, openable bytes.
_PNG_1x1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6300010000050001"
    "0a2db40000000049454e44ae426082"
)


# ── Fake Selenium ──────────────────────────────────────────────────────────────

class _FakeEl:
    def __init__(self, el_id="", title="", displayed=True, enabled=True):
        self._id = el_id
        self._title = title
        self._displayed = displayed
        self._enabled = enabled

    def get_attribute(self, name):
        return {"id": self._id, "title": self._title}.get(name)

    def is_displayed(self):
        return self._displayed

    def is_enabled(self):
        return self._enabled

    def send_keys(self, *_):
        pass

    def click(self):
        pass


class _FakePopup:
    def __init__(self, items):
        # items: list[(id, title)]. First entry mimics the non-clickable header.
        self._els = [_FakeEl(i, t) for i, t in items]

    def find_elements(self, *_):
        return self._els


class FakeDriver:
    """Minimal WebDriver double. `nav_items` are the popup work-area entries."""

    def __init__(self, nav_items, *, login_ok=True, fail_titles=frozenset(),
                 no_task_titles=frozenset()):
        self.nav_items = nav_items
        self.login_ok = login_ok
        self.fail_titles = set(fail_titles)
        self.no_task_titles = set(no_task_titles)
        self.shots = []
        self._current_title = None

    # login / navigation
    def get(self, url):
        pass

    def quit(self):
        pass

    def back(self):
        pass

    def maximize_window(self):
        pass

    def set_window_size(self, *_):
        pass

    def save_screenshot(self, path):
        with open(path, "wb") as f:
            f.write(_PNG_1x1)
        self.shots.append(path)
        return True


def _make_factory(driver):
    return lambda: driver


# ── Patch the WebDriver-dependent helpers to drive the FakeDriver ──────────────
# The engine's _login / _Interactor / popup / task-button code call real Selenium
# WebDriverWait/By/EC. We replace those *engine* seams with fakes that consult the
# FakeDriver, so the loop/branch logic under test (the part we refactored) runs
# unchanged while Selenium itself is never imported.

@pytest.fixture(autouse=True)
def _patch_selenium(monkeypatch):
    # _login: succeed/fail based on the driver flag.
    def fake_login(driver, url, username, password, sel, logger):
        if not driver.login_ok:
            raise RuntimeError("bad credentials")

    # _open_navigator_popup: return a popup built from the driver's nav_items.
    def fake_popup(driver, interactor, sel, logger):
        return _FakePopup(driver.nav_items)

    # _process_element: emulate click + Tasks-panel + screenshot using FakeDriver.
    def fake_process(driver, interactor, sel, shot_dir, el_id, title, index, logger):
        if title in driver.fail_titles:
            raise RuntimeError(f"simulated failure on {title}")
        status = "captured_no_task" if title in driver.no_task_titles else "captured"
        shot = rte._capture_screenshot(driver, shot_dir, title, index)
        return rte.ElementResult(index=index, title=title, screenshot=shot, status=status)

    # _Interactor.click is only used for nav-return + (real) popup open; make it a no-op.
    monkeypatch.setattr(rte, "_login", fake_login)
    monkeypatch.setattr(rte, "_open_navigator_popup", fake_popup)
    monkeypatch.setattr(rte, "_process_element", fake_process)
    monkeypatch.setattr(rte._Interactor, "click",
                        lambda self, *a, **k: True, raising=True)
    # Kill sleeps so tests are fast.
    monkeypatch.setattr(rte.time, "sleep", lambda *_: None)
    yield


# ── _prepare_element_ids (the refactored _FO logic) ────────────────────────────

def test_prepare_element_ids_matches_original_algorithm():
    # Original Code_v2 behaviour: element 2 (first processable) keeps its raw ID;
    # elements 3+ get an _FO prefix.
    raw = ["A", "B", "C", "D"]
    assert _prepare_element_ids(raw) == ["A", "_FOB", "_FOC", "_FOD"]


def test_prepare_element_ids_single():
    assert _prepare_element_ids(["only"]) == ["only"]
    assert _prepare_element_ids([]) == []


# ── Full engine run via FakeDriver ─────────────────────────────────────────────

def _items(n):
    # index 0 is the header entry the engine drops; the rest are processable.
    return [("hdr", "Header")] + [(f"id_{i}", f"Area {i}") for i in range(1, n + 1)]


def test_run_captures_all(tmp_path):
    driver = FakeDriver(_items(4))
    res = run("http://x", "u", "p", str(tmp_path), _LOG,
              driver_factory=_make_factory(driver))
    assert isinstance(res, EngineResult) and res.success
    data = res.data
    assert data["captured"] == 4 and data["failed"] == 0 and data["skipped"] == 0
    assert len(data["elements"]) == 4
    # Real PNG files exist on disk.
    pngs = [f for f in os.listdir(tmp_path) if f.endswith(".png")]
    assert len(pngs) == 4
    # Numbering starts at 2 (matches the original).
    assert data["elements"][0].index == 2


def test_no_task_panel_status(tmp_path):
    driver = FakeDriver(_items(2), no_task_titles={"Area 2"})
    res = run("http://x", "u", "p", str(tmp_path), _LOG,
              driver_factory=_make_factory(driver))
    statuses = {e.title: e.status for e in res.data["elements"]}
    assert statuses["Area 1"] == "captured"
    assert statuses["Area 2"] == "captured_no_task"
    assert res.data["captured"] == 2  # both count as captured


def test_one_element_failure_does_not_abort(tmp_path):
    driver = FakeDriver(_items(3), fail_titles={"Area 2"})
    res = run("http://x", "u", "p", str(tmp_path), _LOG,
              driver_factory=_make_factory(driver))
    assert res.success
    assert res.data["captured"] == 2 and res.data["failed"] == 1
    bad = next(e for e in res.data["elements"] if e.title == "Area 2")
    assert bad.status == "error" and "simulated failure" in bad.message


def test_skip_ids_honored(tmp_path):
    # Make "Area 2"'s prepared ID land in the skip set. processable raw ids are
    # id_1, id_2, id_3 -> prepared id_1, _FOid_2, _FOid_3. Skip _FOid_2.
    sel = OracleSelectors(skip_ids=frozenset({"_FOid_2"}))
    driver = FakeDriver(_items(3))
    res = run("http://x", "u", "p", str(tmp_path), _LOG,
              selectors=sel, driver_factory=_make_factory(driver))
    assert res.data["skipped"] == 1
    skipped = next(e for e in res.data["elements"] if e.status == "skipped")
    assert skipped.title == "Area 2"


def test_max_elements_cap(tmp_path):
    driver = FakeDriver(_items(10))
    res = run("http://x", "u", "p", str(tmp_path), _LOG,
              max_elements=3, driver_factory=_make_factory(driver))
    assert len(res.data["elements"]) == 3
    assert res.data["captured"] == 3


def test_overall_timeout_stops_early(tmp_path, monkeypatch):
    # Force monotonic to jump past the timeout after the first element.
    ticks = iter([0, 0, 0, 100, 100, 100, 100])
    monkeypatch.setattr(rte.time, "monotonic", lambda: next(ticks, 100))
    driver = FakeDriver(_items(5))
    res = run("http://x", "u", "p", str(tmp_path), _LOG,
              overall_timeout=10, driver_factory=_make_factory(driver))
    assert res.success
    assert any("timeout" in w.lower() for w in res.warnings)
    assert res.data["captured"] < 5  # stopped early


def test_login_failure(tmp_path):
    driver = FakeDriver(_items(3), login_ok=False)
    res = run("http://x", "u", "wrong", str(tmp_path), _LOG,
              driver_factory=_make_factory(driver))
    assert not res.success and res.errors


def test_no_work_areas(tmp_path):
    driver = FakeDriver([("hdr", "Header")])  # header only, nothing processable
    res = run("http://x", "u", "p", str(tmp_path), _LOG,
              driver_factory=_make_factory(driver))
    assert not res.success


# ── Router flow via TestClient (engine driver_factory monkeypatched) ───────────

def test_router_full_flow(client, monkeypatch, tmp_path):
    import routers.role_testing as rt

    driver = FakeDriver(_items(3), no_task_titles={"Area 3"})

    # Patch the engine's default factory so the thread's run_bot uses FakeDriver.
    monkeypatch.setattr(rte, "_default_chrome_driver", _make_factory(driver))
    monkeypatch.setattr(rte.time, "sleep", lambda *_: None)

    r = client.post("/api/role-testing/run", json={
        "url": "http://oracle", "username": "u", "password": "p",
    })
    assert r.status_code == 200
    job_id = r.json()["job_id"]

    # Poll status until complete (thread is fast with sleeps stubbed).
    import time as _t
    for _ in range(50):
        s = client.get(f"/api/role-testing/status/{job_id}").json()
        if s["status"] in ("complete", "failed"):
            break
        _t.sleep(0.02)
    assert s["status"] == "complete", s

    summary = client.get(f"/api/role-testing/results/{job_id}").json()
    assert summary["total"] == 3 and summary["captured"] == 3
    fname = summary["screenshots"][0]["filename"]

    # Serve one image.
    img = client.get(f"/api/role-testing/image/{job_id}/{fname}")
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"

    # Path-traversal is rejected.
    bad = client.get(f"/api/role-testing/image/{job_id}/..%2f..%2fsecret.png")
    assert bad.status_code in (400, 404)

    # Download is a valid, non-empty ZIP.
    dl = client.get(f"/api/role-testing/download/{job_id}")
    assert dl.status_code == 200 and dl.headers["content-type"] == "application/zip"
    import io as _io, zipfile as _zip
    with _zip.ZipFile(_io.BytesIO(dl.content)) as zf:
        names = zf.namelist()
    assert any(n.endswith(".png") for n in names)
    assert "summary.json" in names

    # DELETE removes the per-job folder.
    job_dir = rt._job_dir(job_id)
    assert job_dir.exists()
    client.delete(f"/api/role-testing/job/{job_id}")
    assert not job_dir.exists()
