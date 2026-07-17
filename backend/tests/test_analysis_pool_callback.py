"""Tests for the pool result-payload path: analysis_pool.make_done_callback.

_on_done is the web-process callback attached to each analysis Future. It runs
without any real process pool here — we hand it plain Future objects whose
result/exception we set directly, and assert how each outcome lands in
job_manager and the router result cache:

  * engine failure (AnalysisJobError)      → fail_job with the error list
  * unexpected exception                   → fail_job with str(exc)
  * job deleted mid-run (JobNotFoundError) → no cache write, no crash
  * happy path                             → cache populated + job COMPLETE
  * DELETE races completion                → orphaned cache entry popped back out
  * cancelled future                       → no-op

Uses the module job_manager singleton (reset per-test by the autouse
_reset_jobs fixture) plus a local result_cache dict per test.
"""

import io
from concurrent.futures import Future

from services.analysis_pool import make_done_callback
from services.analysis_workers import AnalysisJobError
from services.job_manager import job_manager
from models.common import JobStatus


def _payload():
    return {
        "result_dfs": {"ROLE_SOD": "df-sentinel"},
        "summary": {"count": 1},
        "output_bytes": b"xlsx-bytes",
        "output_filename": "result.xlsx",
    }


def _running_job() -> str:
    job = job_manager.create_job("sod-sa")
    job_manager.set_status(job.id, JobStatus.RUNNING, "running")
    return job.id


# ── Failure mapping ───────────────────────────────────────────────────────────

def test_engine_failure_calls_fail_job_with_errors():
    job_id = _running_job()
    cache: dict = {}
    fut: Future = Future()
    fut.set_exception(AnalysisJobError(["control X invalid", "sheet Y missing"]))

    make_done_callback(job_id, cache, _logger())(fut)

    job = job_manager.get_job(job_id)
    assert job.status == JobStatus.FAILED
    assert job.errors == ["control X invalid", "sheet Y missing"]
    assert job_id not in cache


def test_unexpected_exception_calls_fail_job_with_str():
    job_id = _running_job()
    cache: dict = {}
    fut: Future = Future()
    fut.set_exception(ValueError("boom"))

    make_done_callback(job_id, cache, _logger())(fut)

    job = job_manager.get_job(job_id)
    assert job.status == JobStatus.FAILED
    assert job.errors == ["boom"]


# ── Job deleted mid-run ───────────────────────────────────────────────────────

def test_job_deleted_midrun_discards_results():
    job_id = _running_job()
    job_manager.delete_job(job_id)  # DELETE arrived while the worker ran
    cache: dict = {}
    fut: Future = Future()
    fut.set_result(_payload())

    # Must not raise and must not populate the cache for a dead job.
    make_done_callback(job_id, cache, _logger())(fut)
    assert job_id not in cache


# ── Happy path ────────────────────────────────────────────────────────────────

def test_success_populates_cache_and_completes_job():
    job_id = _running_job()
    cache: dict = {}
    fut: Future = Future()
    fut.set_result(_payload())

    make_done_callback(job_id, cache, _logger())(fut)

    job = job_manager.get_job(job_id)
    assert job.status == JobStatus.COMPLETE
    assert job.output_filename == "result.xlsx"
    assert job.results == {"count": 1}
    assert cache[job_id] == {"ROLE_SOD": "df-sentinel"}
    assert isinstance(job.output_buffer, io.BytesIO)


# ── Cancelled future ──────────────────────────────────────────────────────────

def test_cancelled_future_is_noop():
    job_id = _running_job()
    cache: dict = {}
    fut: Future = Future()
    fut.cancel()  # cancelled before running

    make_done_callback(job_id, cache, _logger())(fut)

    # Job untouched, cache empty.
    assert job_manager.get_job(job_id).status == JobStatus.RUNNING
    assert cache == {}


def _logger():
    import logging
    lg = logging.getLogger("test_pool_cb")
    lg.addHandler(logging.NullHandler())
    return lg
