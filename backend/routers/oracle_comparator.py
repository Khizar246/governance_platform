"""Oracle Comparator API router (Tool 3).

Endpoints:
  POST /api/oracle-comparator/upload
  POST /api/oracle-comparator/run/{job_id}
  GET  /api/oracle-comparator/status/{job_id}
  GET  /api/oracle-comparator/download/{job_id}
  DELETE /api/oracle-comparator/job/{job_id}
"""

import io
import logging
import threading
from typing import Optional

import polars as pl
from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import JSONResponse, StreamingResponse

from config import MAX_UPLOAD_SIZE_BYTES, ALLOWED_EXTENSIONS, output_filename
from models.common import UploadResponse, AnalysisResponse, JobResponse, JobStatus, FilePreview
from models.oracle_comparator import OracleRunConfig, ComparisonTypeSummary, OracleComparatorSummary
from services.job_manager import job_manager
from shared.file_io import load_csv_to_polars, load_excel_to_polars
from shared.validators import validate_upload
from engines.oracle_comparator_engine import run_analysis, generate_report

router = APIRouter(prefix="/api/oracle-comparator", tags=["Oracle Comparator"])
logger = logging.getLogger("governance_platform.oracle_comparator")


def _build_preview(df: pl.DataFrame, filename: str) -> FilePreview:
    return FilePreview(
        filename=filename,
        rows=df.height,
        columns=df.columns,
        preview=df.head(5).to_dicts(),
        duplicates=df.height - df.unique().height,
    )


def _load_file(file_bytes: bytes, filename: str) -> pl.DataFrame:
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if ext == ".csv":
        return load_csv_to_polars(file_bytes, filename, logger)
    return load_excel_to_polars(file_bytes, filename, None, None, logger)


def _run_thread(
    job_id: str,
    files: dict,
    analysis_type: str,
    env1_name: str,
    env2_name: str,
) -> None:
    try:
        callback = job_manager.make_progress_callback(job_id)
        result = run_analysis(files, analysis_type, env1_name, env2_name, progress_callback=callback)

        if not result.success:
            job_manager.fail_job(job_id, result.errors)
            return

        results_1to2, results_2to1 = result.data

        report_result = generate_report(results_1to2, results_2to1, env1_name, env2_name)
        if not report_result.success:
            job_manager.fail_job(job_id, report_result.errors)
            return

        comparisons = []
        for direction, results in [
            (f"{env1_name} → {env2_name}", results_1to2),
            (f"{env2_name} → {env1_name}", results_2to1),
        ]:
            for ctype, df in results.items():
                if df is None:
                    continue
                total = df.height
                matches = df.filter(pl.col("Status").str.contains("Exists")).height
                comparisons.append(
                    ComparisonTypeSummary(
                        comp_type=ctype,
                        direction=direction,
                        total=total,
                        matches=matches,
                        missing=total - matches,
                        match_rate=round(matches / total * 100, 1) if total else 0.0,
                    ).model_dump()
                )

        summary = OracleComparatorSummary(
            analysis_type=analysis_type,
            env1_name=env1_name,
            env2_name=env2_name,
            comparisons=comparisons,
        ).model_dump()

        buf = io.BytesIO(report_result.data)
        fname = output_filename("Oracle_Comparison", f"{env1_name}_vs_{env2_name}")
        job_manager.complete_job(job_id, summary, buf, fname)

    except Exception as exc:
        logger.error("Oracle comparator thread error: %s", exc, exc_info=True)
        job_manager.fail_job(job_id, [str(exc)])


@router.post("/upload", response_model=UploadResponse)
async def upload(
    rbac_file1: Optional[UploadFile] = File(None),
    rbac_file2: Optional[UploadFile] = File(None),
    dsp_file1: Optional[UploadFile] = File(None),
    dsp_file2: Optional[UploadFile] = File(None),
    env1_name: str = Form(...),
    env2_name: str = Form(...),
    analysis_type: str = Form(...),
):
    if analysis_type not in ("rbac", "dsp", "both"):
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "analysis_type must be 'rbac', 'dsp', or 'both'.", "code": "VALIDATION_ERROR", "details": []},
        )

    errors: list[str] = []
    file_bytes: dict[str, bytes] = {}
    file_names: dict[str, str] = {}

    needs_rbac = analysis_type in ("rbac", "both")
    needs_dsp = analysis_type in ("dsp", "both")

    required: dict[str, tuple[Optional[UploadFile], str]] = {}
    if needs_rbac:
        required["rbac_file1"] = (rbac_file1, f"{env1_name} RBAC")
        required["rbac_file2"] = (rbac_file2, f"{env2_name} RBAC")
    if needs_dsp:
        required["dsp_file1"] = (dsp_file1, f"{env1_name} DSP")
        required["dsp_file2"] = (dsp_file2, f"{env2_name} DSP")

    for key, (uf, label) in required.items():
        if uf is None:
            errors.append(f"{label} file is required for analysis type '{analysis_type}'.")
            continue
        ok, msg = await validate_upload(uf, MAX_UPLOAD_SIZE_BYTES, ALLOWED_EXTENSIONS)
        if not ok:
            errors.append(f"{label}: {msg}")
        else:
            file_bytes[key] = await uf.read()
            file_names[key] = uf.filename or key

    if errors:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": errors[0], "code": "VALIDATION_ERROR", "details": errors},
        )

    loaded: dict[str, pl.DataFrame] = {}
    try:
        for key in file_bytes:
            loaded[key] = _load_file(file_bytes[key], file_names[key])
    except Exception as exc:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": str(exc), "code": "FILE_FORMAT_ERROR", "details": []},
        )

    job = job_manager.create_job("oracle_comparator")
    job_manager.store_files(job.id, loaded)
    job_manager.set_config(job.id, {
        "analysis_type": analysis_type,
        "env1_name": env1_name,
        "env2_name": env2_name,
    })
    job_manager.set_status(job.id, JobStatus.VALIDATING, "Files validated.")

    return UploadResponse(
        job_id=job.id,
        files={key: _build_preview(df, file_names[key]) for key, df in loaded.items()},
        status=JobStatus.VALIDATING,
    )


@router.post("/run/{job_id}", response_model=AnalysisResponse)
async def run(job_id: str, config: OracleRunConfig):
    job = job_manager.get_job(job_id)

    if not job.files:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Files not found. Please upload again.", "code": "FILES_NOT_FOUND", "details": []},
        )

    threading.Thread(
        target=_run_thread,
        args=(job_id, dict(job.files), config.analysis_type, config.env1_name, config.env2_name),
        daemon=True,
    ).start()

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
