"""Entitlement Mapping API router (Tool 1).

Endpoints:
  POST /api/entitlement-mapping/upload       — upload client + EY files
  POST /api/entitlement-mapping/run/{job_id} — run mapping analysis
  GET  /api/entitlement-mapping/status/{job_id}
  GET  /api/entitlement-mapping/download/{job_id}
  DELETE /api/entitlement-mapping/job/{job_id}
"""

import io
import logging
import threading

import pandas as pd
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse, StreamingResponse

from config import MAX_UPLOAD_SIZE_BYTES, ALLOWED_EXTENSIONS, output_filename
from models.common import UploadResponse, AnalysisResponse, JobResponse, JobStatus, FilePreview
from services.job_manager import job_manager
from shared.file_io import load_csv_to_pandas, load_excel_to_pandas
from shared.validators import validate_upload
from engines.entitlement_mapping_engine import run_mapping

router = APIRouter(prefix="/api/entitlement-mapping", tags=["Entitlement Mapping"])
logger = logging.getLogger("governance_platform.entitlement_mapping")

_REQUIRED_COLS = {"Access Entitlement Name", "Access Point Code"}


def _build_preview(df: pd.DataFrame, filename: str) -> FilePreview:
    preview = df.head(5).fillna("").to_dict(orient="records")
    return FilePreview(
        filename=filename,
        rows=len(df),
        columns=list(df.columns),
        preview=preview,
        duplicates=int(df.duplicated().sum()),
    )


def _load_file(file_bytes: bytes, filename: str) -> pd.DataFrame:
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if ext == ".csv":
        return load_csv_to_pandas(file_bytes, filename, logger)
    return load_excel_to_pandas(file_bytes, filename, None, logger)


def _run_thread(job_id: str, client_df: pd.DataFrame, ey_df: pd.DataFrame) -> None:
    try:
        callback = job_manager.make_progress_callback(job_id)
        result = run_mapping(client_df, ey_df, progress_callback=callback)

        if not result.success:
            job_manager.fail_job(job_id, result.errors)
            return

        result_df: pd.DataFrame = result.data

        total = len(result_df)
        no_matches = int((result_df["EY Entitlement Match"] == "—").sum())
        comment_col = result_df["Comment"].fillna("")
        exact = int((comment_col == "Exact match").sum())
        supersets = int(comment_col.str.contains("superset", na=False).sum())
        partial = max(0, total - exact - supersets - no_matches)

        summary = {
            "total_mappings": total,
            "exact_matches": exact,
            "supersets": supersets,
            "partial_matches": partial,
            "no_matches": no_matches,
            "results_preview": result_df.head(20).fillna("").to_dict(orient="records"),
        }

        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="xlsxwriter") as writer:
            wb = writer.book
            hdr_fmt = wb.add_format({"bold": True, "bg_color": "#D7E4BC", "border": 1})
            result_df.to_excel(writer, sheet_name="Entitlement Mapping", index=False)
            ws = writer.sheets["Entitlement Mapping"]
            for ci, col in enumerate(result_df.columns):
                ws.write(0, ci, col, hdr_fmt)
                max_len = (
                    result_df[col].astype(str).map(len).max()
                    if len(result_df) else 0
                )
                ws.set_column(ci, ci, min(max(len(str(col)), max_len) + 3, 60))
        buf.seek(0)

        job_manager.complete_job(job_id, summary, buf, output_filename("Entitlement_Mapping"))

    except Exception as exc:
        logger.error("Entitlement mapping thread error: %s", exc, exc_info=True)
        job_manager.fail_job(job_id, [str(exc)])


@router.post("/upload", response_model=UploadResponse)
async def upload(
    client_file: UploadFile = File(..., description="Client entitlement CSV/XLSX"),
    ey_file: UploadFile = File(..., description="EY ruleset CSV/XLSX"),
):
    errors: list[str] = []

    for uf, label in [(client_file, "Client file"), (ey_file, "EY ruleset")]:
        ok, msg = await validate_upload(uf, MAX_UPLOAD_SIZE_BYTES, ALLOWED_EXTENSIONS)
        if not ok:
            errors.append(f"{label}: {msg}")

    if errors:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": errors[0], "code": "VALIDATION_ERROR", "details": errors},
        )

    client_bytes = await client_file.read()
    ey_bytes = await ey_file.read()

    try:
        client_df = _load_file(client_bytes, client_file.filename or "client.csv")
        ey_df = _load_file(ey_bytes, ey_file.filename or "ey.csv")
    except Exception as exc:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": str(exc), "code": "FILE_FORMAT_ERROR", "details": []},
        )

    for df, label in [(client_df, "Client file"), (ey_df, "EY ruleset")]:
        present = {c.strip().upper() for c in df.columns}
        missing = [c for c in _REQUIRED_COLS if c.strip().upper() not in present]
        if missing:
            errors.append(f"{label} is missing required columns: {missing}")

    if errors:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": errors[0], "code": "VALIDATION_ERROR", "details": errors},
        )

    job = job_manager.create_job("entitlement_mapping")
    job_manager.store_files(job.id, {"client_df": client_df, "ey_df": ey_df})
    job_manager.set_status(job.id, JobStatus.VALIDATING, "Files validated.")

    return UploadResponse(
        job_id=job.id,
        files={
            "client_file": _build_preview(client_df, client_file.filename or "client.csv"),
            "ey_file": _build_preview(ey_df, ey_file.filename or "ey.csv"),
        },
        status=JobStatus.VALIDATING,
    )


@router.post("/run/{job_id}", response_model=AnalysisResponse)
async def run(job_id: str):
    job = job_manager.get_job(job_id)

    client_df = job.files.get("client_df")
    ey_df = job.files.get("ey_df")
    if client_df is None or ey_df is None:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Files not found. Please upload again.", "code": "FILES_NOT_FOUND", "details": []},
        )

    threading.Thread(target=_run_thread, args=(job_id, client_df, ey_df), daemon=True).start()

    return AnalysisResponse(job_id=job_id, status=JobStatus.RUNNING, summary={})


@router.get("/status/{job_id}", response_model=JobResponse)
async def status(job_id: str):
    return job_manager.to_job_response(job_manager.get_job(job_id))


@router.get("/download/{job_id}")
async def download(job_id: str):
    job = job_manager.get_job(job_id)

    if job.status != JobStatus.COMPLETE:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Analysis is not complete yet.", "code": "NOT_READY", "details": []},
        )
    if job.output_buffer is None:
        return JSONResponse(
            status_code=404,
            content={"error": True, "message": "Download not available.", "code": "NOT_FOUND", "details": []},
        )

    job.output_buffer.seek(0)
    return StreamingResponse(
        job.output_buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{job.output_filename}"'},
    )


@router.delete("/job/{job_id}")
async def cancel(job_id: str):
    job_manager.get_job(job_id)
    job_manager.delete_job(job_id)
    return {"message": "Job deleted."}
