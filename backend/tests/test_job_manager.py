"""Unit tests for services/job_manager.py.

Each test builds a fresh JobManager() instead of the module singleton, so the
autouse _reset_jobs fixture (which clears the singleton) can't interfere and
tests stay isolated. Covers the lifecycle, the concurrent-job cap, result-cache
registration/purging, TTL expiry, terminal-state protection on progress
updates, and JobResponse serialisation.
"""

from datetime import timedelta

import pytest

from services import job_manager as jm_module
from services.job_manager import JobManager
from exceptions import JobNotFoundError, GovernanceError
from models.common import JobStatus


def _fresh() -> JobManager:
    return JobManager()


# ── create / get / delete ─────────────────────────────────────────────────────

def test_create_and_get_job():
    jm = _fresh()
    job = jm.create_job("sod-sa")
    assert job.status == JobStatus.PENDING
    assert job.tool == "sod-sa"
    assert jm.get_job(job.id) is job


def test_get_missing_job_raises():
    jm = _fresh()
    with pytest.raises(JobNotFoundError):
        jm.get_job("does-not-exist")


def test_delete_job_removes_it():
    jm = _fresh()
    job = jm.create_job("sod-sa")
    jm.delete_job(job.id)
    with pytest.raises(JobNotFoundError):
        jm.get_job(job.id)


def test_delete_missing_job_is_noop():
    jm = _fresh()
    jm.delete_job("nope")  # must not raise


# ── Concurrent-job cap ────────────────────────────────────────────────────────

def test_concurrent_cap_blocks_new_jobs(monkeypatch):
    jm = _fresh()
    monkeypatch.setattr(jm_module, "MAX_CONCURRENT_JOBS", 2)
    jm.create_job("t")
    jm.create_job("t")
    with pytest.raises(GovernanceError) as exc:
        jm.create_job("t")
    assert exc.value.code == "SERVICE_UNAVAILABLE"


def test_completed_jobs_do_not_count_against_cap(monkeypatch):
    jm = _fresh()
    monkeypatch.setattr(jm_module, "MAX_CONCURRENT_JOBS", 1)
    done = jm.create_job("t")
    jm.set_status(done.id, JobStatus.COMPLETE)
    # The completed job frees its slot, so a second create must succeed.
    jm.create_job("t")


# ── Result-cache registration + purge ─────────────────────────────────────────

def test_delete_purges_registered_result_cache():
    jm = _fresh()
    cache: dict = {}
    jm.register_result_cache(cache)
    job = jm.create_job("t")
    cache[job.id] = "some-dataframe"
    jm.delete_job(job.id)
    assert job.id not in cache


def test_cleanup_expired_purges_result_cache():
    jm = _fresh()
    cache: dict = {}
    jm.register_result_cache(cache)
    job = jm.create_job("t")
    cache[job.id] = "df"
    job.created_at -= timedelta(seconds=jm_module.JOB_TTL_SECONDS + 1)
    removed = jm.cleanup_expired()
    assert removed == 1
    assert job.id not in cache


# ── TTL expiry ────────────────────────────────────────────────────────────────

def test_cleanup_expired_removes_only_old_jobs():
    jm = _fresh()
    old = jm.create_job("t")
    fresh = jm.create_job("t")
    old.created_at -= timedelta(seconds=jm_module.JOB_TTL_SECONDS + 1)
    removed = jm.cleanup_expired()
    assert removed == 1
    with pytest.raises(JobNotFoundError):
        jm.get_job(old.id)
    assert jm.get_job(fresh.id) is fresh


# ── Terminal-state protection ─────────────────────────────────────────────────

def test_progress_does_not_resurrect_completed_job():
    jm = _fresh()
    job = jm.create_job("t")
    jm.complete_job(job.id, {"ok": True}, output=_bytesio(), filename="r.xlsx")
    # A late progress message from a pool worker must NOT flip status back.
    jm.update_progress(job.id, 50, "still working")
    assert jm.get_job(job.id).status == JobStatus.COMPLETE
    assert jm.get_job(job.id).progress == 100


def test_progress_clamped_to_0_100():
    jm = _fresh()
    job = jm.create_job("t")
    jm.update_progress(job.id, 250, "over")
    assert jm.get_job(job.id).progress == 100
    jm.update_progress(job.id, -5, "under")
    assert jm.get_job(job.id).progress == 0


# ── try_begin_run (409 guard) ─────────────────────────────────────────────────

def test_try_begin_run_claims_once():
    jm = _fresh()
    job = jm.create_job("t")
    assert jm.try_begin_run(job.id) is True
    # Already RUNNING → second claim fails (the duplicate-/run 409 guard).
    assert jm.try_begin_run(job.id) is False


def test_try_begin_run_missing_job_false():
    jm = _fresh()
    assert jm.try_begin_run("nope") is False


# ── complete_job releases DataFrames ──────────────────────────────────────────

def test_complete_job_releases_files():
    jm = _fresh()
    job = jm.create_job("t")
    jm.store_files(job.id, {"df": object()})
    jm.complete_job(job.id, {"summary": 1}, output=_bytesio(), filename="r.xlsx")
    j = jm.get_job(job.id)
    assert j.files == {}
    assert j.output_filename == "r.xlsx"
    assert j.results == {"summary": 1}


# ── JobResponse serialisation snapshot ────────────────────────────────────────

def test_to_job_response_snapshots_fields():
    jm = _fresh()
    job = jm.create_job("t")
    jm.add_warning(job.id, "heads up")
    jm.fail_job(job.id, ["boom"])
    resp = jm.to_job_response(jm.get_job(job.id))
    assert resp.job_id == job.id
    assert resp.status == JobStatus.FAILED
    assert resp.errors == ["boom"]
    assert resp.warnings == ["heads up"]


# ── get_stats ─────────────────────────────────────────────────────────────────

def test_get_stats_counts():
    jm = _fresh()
    a = jm.create_job("t")
    jm.create_job("t")
    jm.set_status(a.id, JobStatus.COMPLETE)
    stats = jm.get_stats()
    assert stats["total_jobs"] == 2
    assert stats["active_jobs"] == 1
    assert stats["total_created"] == 2


def _bytesio():
    import io
    return io.BytesIO(b"x")
