"""Router-level endpoint-contract tests (as opposed to engine logic).

These exercise the SOD & SA router's cross-cutting job endpoints — status,
download, delete, results — for the not-ready / not-found / delete-purges-cache
contracts that engine tests don't touch, plus the shared stream_job_output body
(used by every tool's /download) directly. HTTP status codes come from main.py's
GovernanceError → _STATUS_CODES mapping (JOB_NOT_FOUND → 404).
"""

import io

from services.job_manager import job_manager
from models.common import JobStatus
from shared.download import stream_job_output


# ── /status/{job_id} ──────────────────────────────────────────────────────────

def test_status_missing_job_404(client):
    r = client.get("/api/sod-sa/status/no-such-job")
    assert r.status_code == 404
    assert r.json()["code"] == "JOB_NOT_FOUND"


# ── /download/{job_id} ────────────────────────────────────────────────────────

def test_download_missing_job_404(client):
    r = client.get("/api/sod-sa/download/no-such-job")
    assert r.status_code == 404
    assert r.json()["code"] == "JOB_NOT_FOUND"


def test_download_not_complete_returns_not_ready(client):
    job = job_manager.create_job("sod-sa")
    job_manager.set_status(job.id, JobStatus.RUNNING, "working")
    r = client.get(f"/api/sod-sa/download/{job.id}")
    assert r.status_code == 400
    assert r.json()["code"] == "NOT_READY"


def test_download_complete_streams_xlsx(client):
    job = job_manager.create_job("sod-sa")
    job_manager.complete_job(
        job.id, {"ok": 1}, output=io.BytesIO(b"workbook-bytes"), filename="out.xlsx",
    )
    r = client.get(f"/api/sod-sa/download/{job.id}")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert 'filename="out.xlsx"' in r.headers["content-disposition"]
    assert r.content == b"workbook-bytes"


# ── /job/{job_id} DELETE ──────────────────────────────────────────────────────

def test_delete_job_purges_result_cache(client):
    from routers.sod_sa_analysis import _result_dfs
    job = job_manager.create_job("sod-sa")
    _result_dfs[job.id] = {"ROLE_SOD": "df"}
    r = client.delete(f"/api/sod-sa/job/{job.id}")
    assert r.status_code == 200
    # Job gone AND its registered result-cache entry purged.
    assert job.id not in _result_dfs
    assert client.get(f"/api/sod-sa/status/{job.id}").status_code == 404


def test_delete_missing_job_404(client):
    r = client.delete("/api/sod-sa/job/no-such-job")
    assert r.status_code == 404
    assert r.json()["code"] == "JOB_NOT_FOUND"


# ── /results/{job_id} ─────────────────────────────────────────────────────────

def test_results_missing_job_404(client):
    # `sheet` is a required query param — supply it so the request passes
    # validation and reaches the job lookup (which 404s for a missing job).
    r = client.get("/api/sod-sa/results/no-such-job", params={"sheet": "ROLE_SOD"})
    assert r.status_code == 404
    assert r.json()["code"] == "JOB_NOT_FOUND"


# ── shared stream_job_output body (used by every tool's /download) ────────────

def test_stream_job_output_not_ready_branch():
    job = job_manager.create_job("sod-sa")
    job_manager.set_status(job.id, JobStatus.RUNNING, "x")
    resp = stream_job_output(job.id)
    assert resp.status_code == 400  # JSONResponse NOT_READY


def test_stream_job_output_missing_buffer_branch():
    # COMPLETE status but no buffer → NOT_FOUND (defensive 404).
    job = job_manager.create_job("sod-sa")
    job_manager.set_status(job.id, JobStatus.COMPLETE)
    resp = stream_job_output(job.id)
    assert resp.status_code == 404


def test_stream_job_output_custom_media_type():
    job = job_manager.create_job("role-testing")
    job_manager.complete_job(
        job.id, {}, output=io.BytesIO(b"zip"), filename="shots.zip",
    )
    resp = stream_job_output(job.id, media_type="application/zip")
    assert resp.media_type == "application/zip"
    assert 'filename="shots.zip"' in resp.headers["content-disposition"]
