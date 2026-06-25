"""Admin Panel API router.

Endpoints:
  GET /api/admin/runs/{run_id}/download-zip
      Build (and stream) a ZIP bundle for one tool-usage run: every file the
      analyst uploaded for that run plus the generated output file.

NOTE — placeholder phase:
  Per-run files are not yet persisted, so the ZIP is currently assembled from a
  list of *resolved file specs* that is empty for every run (yielding an empty —
  but valid — ZIP). The assembly seam is `_resolve_run_files(run_id)`: when real
  per-run file persistence lands, return real `RunFile` entries from there and the
  streaming/zipping code below needs no change.
"""

import io
import zipfile
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from shared.logger import get_logger

router = APIRouter(prefix="/api/admin", tags=["Admin"])
logger = get_logger("admin")


@dataclass
class RunFile:
    """One file to place inside a run's ZIP bundle.

    `arcname` is the path the file gets inside the archive (e.g.
    "uploads/role_hierarchy.xlsx" or "output/result.xlsx"). Exactly one of
    `path` (read from disk) or `data` (raw bytes) should be set.
    """
    arcname: str
    path: Path | None = None
    data: bytes | None = None


def _resolve_run_files(run_id: str) -> list[RunFile]:
    """Return the files that belong in `run_id`'s ZIP bundle.

    Placeholder: returns [] for every run (empty-but-valid ZIP). Real per-run
    file persistence plugs in here — e.g. look the run up, then return its
    uploaded inputs (arcname "uploads/<name>") and its output workbook
    (arcname "output/<name>") as RunFile entries. The caller is agnostic to
    whether bytes come from disk (`path`) or memory (`data`).
    """
    return []


@router.get("/runs/{run_id}/download-zip")
def download_run_zip(run_id: str):
    """Stream a ZIP bundle of all files for one run (uploads + output)."""
    files = _resolve_run_files(run_id)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            if f.data is not None:
                zf.writestr(f.arcname, f.data)
            elif f.path is not None:
                if not f.path.exists():
                    logger.warning("ZIP for run %s: missing file %s", run_id, f.path)
                    continue
                zf.write(f.path, arcname=f.arcname)
    buffer.seek(0)

    logger.info("Built ZIP for run %s (%d file(s))", run_id, len(files))
    headers = {"Content-Disposition": f'attachment; filename="run-{run_id}.zip"'}
    return StreamingResponse(buffer, media_type="application/zip", headers=headers)
