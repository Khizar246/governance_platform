"""Tests for routers/admin.py — the run download-ZIP endpoint.

The endpoint is in its placeholder phase: _resolve_run_files returns [] for
every run, so the default response is an empty-but-valid ZIP. These tests pin
that contract (valid ZIP, correct headers) and exercise the zip-assembly seam
by monkeypatching _resolve_run_files to cover all three RunFile branches:
in-memory `data`, an existing `path`, and a missing `path` (skipped).
"""

import io
import zipfile

from routers import admin as admin_mod
from routers.admin import RunFile


# ── Default placeholder contract ──────────────────────────────────────────────

def test_download_zip_returns_valid_empty_zip(client):
    r = client.get("/api/admin/runs/run-123/download-zip")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    assert 'filename="run-run-123.zip"' in r.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        assert zf.namelist() == []


# ── Assembly seam: the three RunFile branches ─────────────────────────────────

def test_zip_includes_in_memory_data(client, monkeypatch):
    monkeypatch.setattr(
        admin_mod, "_resolve_run_files",
        lambda run_id: [RunFile(arcname="output/result.xlsx", data=b"hello-bytes")],
    )
    r = client.get("/api/admin/runs/r1/download-zip")
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        assert zf.namelist() == ["output/result.xlsx"]
        assert zf.read("output/result.xlsx") == b"hello-bytes"


def test_zip_reads_existing_path(client, monkeypatch, tmp_path):
    src = tmp_path / "upload.csv"
    src.write_bytes(b"user,role\nalice,admin\n")
    monkeypatch.setattr(
        admin_mod, "_resolve_run_files",
        lambda run_id: [RunFile(arcname="uploads/upload.csv", path=src)],
    )
    r = client.get("/api/admin/runs/r2/download-zip")
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        assert zf.read("uploads/upload.csv") == b"user,role\nalice,admin\n"


def test_zip_skips_missing_path(client, monkeypatch, tmp_path):
    missing = tmp_path / "gone.xlsx"  # never created
    present = RunFile(arcname="output/ok.txt", data=b"kept")
    monkeypatch.setattr(
        admin_mod, "_resolve_run_files",
        lambda run_id: [RunFile(arcname="uploads/gone.xlsx", path=missing), present],
    )
    r = client.get("/api/admin/runs/r3/download-zip")
    assert r.status_code == 200
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        # Missing-path entry is skipped; the valid entry still lands.
        assert zf.namelist() == ["output/ok.txt"]
        assert zf.read("output/ok.txt") == b"kept"
