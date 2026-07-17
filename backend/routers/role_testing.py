"""Role Testing Bot API router.

Drives headless Chrome through Oracle Fusion Cloud and captures a screenshot of
every Navigator work area. Unlike the other three tools there is NO file upload —
the run starts from a credentials form — and the artifact is a ZIP of PNGs plus a
per-image gallery, not an Excel workbook.

Endpoints:
  POST   /api/role-testing/run
  GET    /api/role-testing/status/{job_id}
  GET    /api/role-testing/results/{job_id}
  GET    /api/role-testing/image/{job_id}/{filename}
  GET    /api/role-testing/download/{job_id}
  DELETE /api/role-testing/job/{job_id}

Credentials note: url/username/password arrive in the run body, are passed into
the worker thread, used only inside the engine's driver stack frame, and are never
written to disk, logged, or echoed in any response.
"""

import io
import json
import shutil
import threading
import zipfile
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse, FileResponse

from config import ROLE_TESTING_SHOTS_DIR, output_filename
from exceptions import JobNotFoundError
from models.common import AnalysisResponse, JobResponse, JobStatus
from models.role_testing import (
    RoleTestingRunConfig, CapturedScreenshot, RoleTestingSummary,
)
from services.job_manager import job_manager
from shared.download import stream_job_output
from shared.logger import get_logger
from engines.role_testing_engine import run as run_bot

router = APIRouter(prefix="/api/role-testing", tags=["Role Testing Bot"])
logger = get_logger("role_testing")

# { job_id: {"summary": RoleTestingSummary, "dir": Path} }
# Purged on DELETE and on TTL expiry via job_manager's cache registry. The
# per-job screenshot folder is removed explicitly on DELETE and swept on startup.
_result_data: dict[str, dict] = {}
job_manager.register_result_cache(_result_data)

_SHOTS_ROOT = ROLE_TESTING_SHOTS_DIR


def _job_dir(job_id: str) -> Path:
    return _SHOTS_ROOT / job_id


def sweep_orphan_dirs() -> int:
    """Remove screenshot folders with no live job (called once at startup)."""
    if not _SHOTS_ROOT.exists():
        return 0
    removed = 0
    for child in _SHOTS_ROOT.iterdir():
        if child.is_dir() and child.name not in _result_data:
            try:
                shutil.rmtree(child, ignore_errors=True)
                removed += 1
            except Exception:  # noqa: BLE001
                pass
    return removed


def _build_zip(summary: RoleTestingSummary, shot_dir: Path) -> io.BytesIO:
    """Package every PNG + a summary.json into an in-memory ZIP."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for shot in summary.screenshots:
            if shot.filename:
                fpath = shot_dir / shot.filename
                if fpath.exists():
                    zf.write(fpath, arcname=f"screenshots/{shot.filename}")
        zf.writestr("summary.json", json.dumps(summary.model_dump(), indent=2))
    buf.seek(0)
    return buf


def _run_thread(
    job_id: str,
    url: str,
    username: str,
    password: str,
    max_elements,
    overall_timeout,
    headless: bool,
    capture_tasks: bool,
    shot_dir: str,
) -> None:
    try:
        logger.info(f"[{job_id}] Starting Role Testing Bot (max_elements={max_elements}, "
                    f"timeout={overall_timeout}, headless={headless}, "
                    f"capture_tasks={capture_tasks})")
        callback = job_manager.make_progress_callback(job_id)
        result = run_bot(
            url, username, password, shot_dir, logger,
            max_elements=max_elements,
            overall_timeout=overall_timeout,
            headless=headless,
            capture_tasks=capture_tasks,
            progress_callback=callback,
        )

        if not result.success:
            logger.error(f"[{job_id}] Role Testing Bot failed: {result.errors}")
            job_manager.fail_job(job_id, result.errors)
            return

        data = result.data
        screenshots = [
            CapturedScreenshot(
                index=el.index, title=el.title,
                filename=el.screenshot, status=el.status,
            )
            for el in data["elements"]
        ]
        summary = RoleTestingSummary(
            total=len(screenshots),
            captured=data["captured"],
            failed=data["failed"],
            skipped=data["skipped"],
            screenshots=screenshots,
            warnings=list(result.warnings),
        )

        # Cancelled mid-run: the job (and its screenshot dir) are already gone, so
        # caching results here would orphan them (DELETE's purge has already run).
        try:
            job_manager.get_job(job_id)
        except JobNotFoundError:
            logger.info(f"[{job_id}] Job deleted while running; discarding results")
            return

        for w in result.warnings:
            job_manager.add_warning(job_id, w)

        shot_path = Path(shot_dir)
        _result_data[job_id] = {"summary": summary, "dir": shot_path}

        zip_buf = _build_zip(summary, shot_path)
        fname = output_filename("Role_Testing", "screenshots").replace(".xlsx", ".zip")
        logger.info(f"[{job_id}] Complete: {summary.captured} captured, "
                    f"{summary.failed} failed, {summary.skipped} skipped. Output: {fname}")
        job_manager.complete_job(job_id, summary.model_dump(), zip_buf, fname)

        # If DELETE raced the lines above, its cache purge may have run before our
        # insert — an orphaned entry would never be TTL-purged. Clean it up (and
        # the screenshot dir, which DELETE's rmtree may have missed).
        try:
            job_manager.get_job(job_id)
        except JobNotFoundError:
            _result_data.pop(job_id, None)
            if shot_path.exists():
                shutil.rmtree(shot_path, ignore_errors=True)

    except Exception as exc:  # noqa: BLE001
        logger.error(f"[{job_id}] Role Testing Bot crashed", exc_info=True)
        job_manager.fail_job(job_id, [str(exc)])


@router.post("/run", response_model=AnalysisResponse)
async def run(config: RoleTestingRunConfig):
    # URL validity, non-empty credentials, and positive limits are enforced
    # declaratively by RoleTestingRunConfig (422 on violation). Only
    # whitespace-only credentials still need a manual check here.
    if not (config.username.strip() and config.password.strip()):
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Oracle URL, username, and password are required.",
                     "code": "VALIDATION_ERROR", "details": []},
        )
    oracle_url = str(config.url)

    job = job_manager.create_job("role_testing")
    shot_dir = _job_dir(job.id)
    shot_dir.mkdir(parents=True, exist_ok=True)
    # Store config WITHOUT the password (never persisted in the job record).
    job_manager.set_config(job.id, {
        "url": oracle_url,
        "username": config.username,
        "max_elements": config.max_elements,
        "overall_timeout_seconds": config.overall_timeout_seconds,
        "headless": config.headless,
        "capture_tasks": config.capture_tasks,
    })
    job_manager.set_status(job.id, JobStatus.RUNNING, "Starting Role Testing Bot…")

    threading.Thread(
        target=_run_thread,
        args=(job.id, oracle_url, config.username, config.password,
              config.max_elements, config.overall_timeout_seconds,
              config.headless, config.capture_tasks, str(shot_dir)),
        daemon=True,
    ).start()

    logger.info(f"[{job.id}] Role Testing Bot run thread started")
    return AnalysisResponse(job_id=job.id, status=JobStatus.RUNNING)


@router.get("/status/{job_id}", response_model=JobResponse)
async def status(job_id: str):
    return job_manager.to_job_response(job_manager.get_job(job_id))


@router.get("/results/{job_id}")
async def results(job_id: str):
    job = job_manager.get_job(job_id)
    if job.status != JobStatus.COMPLETE or job_id not in _result_data:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Run is not complete yet.",
                     "code": "NOT_READY", "details": []},
        )
    return _result_data[job_id]["summary"].model_dump()


@router.get("/image/{job_id}/{filename}")
async def image(job_id: str, filename: str):
    if job_id not in _result_data:
        return JSONResponse(
            status_code=404,
            content={"error": True, "message": "Screenshots not found.",
                     "code": "NOT_FOUND", "details": []},
        )
    # Path-traversal guard: no separators, no parent refs.
    if "/" in filename or "\\" in filename or ".." in filename:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Invalid filename.",
                     "code": "VALIDATION_ERROR", "details": []},
        )
    job_dir = _result_data[job_id]["dir"].resolve()
    fpath = (job_dir / filename).resolve()
    if not str(fpath).startswith(str(job_dir)) or not fpath.is_file():
        return JSONResponse(
            status_code=404,
            content={"error": True, "message": "Image not found.",
                     "code": "NOT_FOUND", "details": []},
        )
    return FileResponse(str(fpath), media_type="image/png")


@router.get("/download/{job_id}")
async def download(job_id: str):
    return stream_job_output(job_id, media_type="application/zip")


@router.delete("/job/{job_id}")
async def cancel(job_id: str):
    job_manager.get_job(job_id)
    job_dir = _job_dir(job_id)
    job_manager.delete_job(job_id)  # purges _result_data via the cache registry
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)
    return {"message": "Job deleted."}
