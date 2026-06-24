"""Pytest fixtures: a TestClient bound to the real FastAPI app, plus an upload
helper that POSTs an in-memory multipart request to /api/sod-sa/upload.

Importing `main` requires the backend package root on sys.path; this file lives
in backend/tests/, so we add backend/ (its parent's parent... actually parent of
tests = backend) to the path.
"""

from __future__ import annotations

import io
import os
import sys

import pytest

# Ensure `backend/` is importable so `import main` works regardless of CWD.
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient
    import main
    return TestClient(main.app)


@pytest.fixture(autouse=True)
def _reset_jobs():
    """Clear the in-memory job store before each test.

    Every successful upload creates a job that stays "active" (VALIDATING) and
    counts against MAX_CONCURRENT_JOBS (=5). Without a reset, accumulated jobs
    across the session make later uploads fail with 503 SERVICE_UNAVAILABLE.
    Clearing the registry isolates each test.
    """
    from services.job_manager import job_manager
    with job_manager._lock:
        job_manager._jobs.clear()
        for cache in job_manager._result_caches:
            cache.clear()
    yield


def _part(name: str, data: bytes, content_type: str = _XLSX):
    return (name, io.BytesIO(data), content_type)


@pytest.fixture
def upload(client):
    """Return a function that uploads the given file bytes and returns the Response.

    Pass None for any file to omit it. Extra form fields go through **form.
    """
    def _do(role_hierarchy=None, ruleset=None, user_role=None, fp_db=None, **form):
        files = {}
        if role_hierarchy is not None:
            fn, data, ct = role_hierarchy
            files["role_hierarchy"] = (fn, io.BytesIO(data), ct)
        if ruleset is not None:
            fn, data, ct = ruleset
            files["ruleset"] = (fn, io.BytesIO(data), ct)
        if user_role is not None:
            fn, data, ct = user_role
            files["user_role"] = (fn, io.BytesIO(data), ct)
        if fp_db is not None:
            fn, data, ct = fp_db
            files["fp_db"] = (fn, io.BytesIO(data), ct)
        return client.post("/api/sod-sa/upload", files=files, data=form or None)
    return _do
