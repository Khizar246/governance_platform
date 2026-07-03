"""Oracle Comparator API router (Tool 3).

Endpoints:
  POST   /api/oracle-comparator/upload
  POST   /api/oracle-comparator/run/{job_id}
  GET    /api/oracle-comparator/status/{job_id}
  GET    /api/oracle-comparator/summary/{job_id}
  GET    /api/oracle-comparator/results/{job_id}
  GET    /api/oracle-comparator/download/{job_id}
  DELETE /api/oracle-comparator/job/{job_id}
"""

import io
import threading
from typing import Optional

import polars as pl
from fastapi import APIRouter, Request, UploadFile, File, Form, Query
from fastapi.responses import JSONResponse, StreamingResponse

from config import MAX_UPLOAD_SIZE_BYTES, ALLOWED_EXTENSIONS, output_filename
from models.common import UploadResponse, AnalysisResponse, JobResponse, JobStatus, FilePreview
from models.oracle_comparator import OracleRunConfig, ComparisonTypeSummary, OracleComparatorSummary
from services.job_manager import job_manager
from shared.file_io import load_csv_to_polars, load_excel_to_polars
from shared.validators import validate_upload, validate_dataframe_schema
from shared.logger import get_logger
from engines.oracle_comparator_engine import run_analysis, generate_report, FILE_CONFIGS

router = APIRouter(prefix="/api/oracle-comparator", tags=["Oracle Comparator"])
logger = get_logger("oracle_comparator")

# { job_id: { "1to2": { comp_type: DataFrame }, "2to1": { comp_type: DataFrame } } }
# Purged on DELETE and on TTL expiry via job_manager's cache registry.
_result_data: dict[str, dict[str, dict[str, pl.DataFrame]]] = {}
job_manager.register_result_cache(_result_data)


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
        logger.info(f"[{job_id}] Starting Oracle Comparator: analysis_type={analysis_type}, env1={env1_name}, env2={env2_name}")
        logger.info(f"[{job_id}] Input files: {list(files.keys())}")
        callback = job_manager.make_progress_callback(job_id)
        result = run_analysis(files, analysis_type, env1_name, env2_name, progress_callback=callback)

        if not result.success:
            logger.error(f"[{job_id}] Oracle Comparator analysis failed: {result.errors}")
            job_manager.fail_job(job_id, result.errors)
            return

        results_1to2, results_2to1 = result.data

        _result_data[job_id] = {
            "1to2": {ct: df for ct, df in results_1to2.items() if df is not None},
            "2to1": {ct: df for ct, df in results_2to1.items() if df is not None},
        }
        logger.info(f"[{job_id}] Analysis results cached: {list(_result_data[job_id].keys())}")

        report_result = generate_report(results_1to2, results_2to1, env1_name, env2_name)
        if not report_result.success:
            logger.error(f"[{job_id}] Report generation failed: {report_result.errors}")
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
        logger.info(f"[{job_id}] Oracle Comparator complete. Output file: {fname}")
        job_manager.complete_job(job_id, summary, buf, fname)

    except Exception as exc:
        logger.error(f"[{job_id}] Oracle Comparator failed with exception", exc_info=True)
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
    logger.info(f"Oracle Comparator upload initiated: analysis_type={analysis_type}, env1={env1_name}, env2={env2_name}")
    if analysis_type not in ("rbac", "dsp", "both"):
        logger.error(f"Invalid analysis_type: {analysis_type}")
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
        logger.error(f"Oracle Comparator upload validation failed: {errors}")
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": errors[0], "code": "VALIDATION_ERROR", "details": errors},
        )

    # ── Comprehensive bulk validation — collect all file loading errors ────────
    load_errors: list[str] = []
    loaded: dict[str, pl.DataFrame] = {}
    for key in file_bytes:
        try:
            loaded[key] = _load_file(file_bytes[key], file_names[key])
            logger.info(f"Loaded {key}: {loaded[key].height} rows")
        except Exception as exc:
            logger.error(f"Failed to load {file_names[key]}: {exc}", exc_info=True)
            load_errors.append(f"{file_names[key]} ({key}): {exc}")

    if load_errors:
        logger.error(f"Oracle Comparator upload failed with {len(load_errors)} error(s): {load_errors}")
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": f"Found {len(load_errors)} file loading error(s). See details below.", "code": "FILE_FORMAT_ERROR", "details": load_errors},
        )

    # ── Schema validation — required columns per file type ──────────────────
    schema_errors: list[str] = []
    for key, df in loaded.items():
        file_type = "rbac" if key.startswith("rbac") else "dsp"
        required_cols = set(FILE_CONFIGS[file_type]["required_columns"])
        valid, missing = validate_dataframe_schema(set(df.columns), required_cols, file_names[key])
        if not valid:
            for col in missing:
                schema_errors.append(f"{file_names[key]} ({key}): Missing required column '{col}'")

    if schema_errors:
        logger.error(f"Oracle Comparator upload failed schema validation with {len(schema_errors)} error(s): {schema_errors}")
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": f"Found {len(schema_errors)} missing column error(s). See details below.", "code": "MISSING_COLUMN", "details": schema_errors},
        )

    # Verify that all required files were loaded
    if not loaded:
        error_msg = "No files were successfully loaded."
        logger.error(error_msg)
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": error_msg, "code": "FILE_FORMAT_ERROR", "details": []},
        )

    job = job_manager.create_job("oracle_comparator")
    logger.info(f"[{job.id}] Created job for Oracle Comparator")
    job_manager.store_files(job.id, loaded)
    job_manager.set_config(job.id, {
        "analysis_type": analysis_type,
        "env1_name": env1_name,
        "env2_name": env2_name,
    })
    job_manager.set_status(job.id, JobStatus.VALIDATING, "Files validated.")
    logger.info(f"[{job.id}] Files stored and validated. Ready for analysis.")

    return UploadResponse(
        job_id=job.id,
        files={key: _build_preview(df, file_names[key]) for key, df in loaded.items()},
        status=JobStatus.VALIDATING,
    )


@router.post("/run/{job_id}", response_model=AnalysisResponse)
async def run(job_id: str, config: OracleRunConfig):
    job = job_manager.get_job(job_id)

    if job.status == JobStatus.RUNNING:
        return JSONResponse(
            status_code=409,
            content={"error": True, "message": "Analysis is already running for this job.", "code": "ALREADY_RUNNING", "details": []},
        )

    if not job.files:
        logger.error(f"[{job_id}] Run requested but no files found in job")
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Files not found. Please upload again.", "code": "FILES_NOT_FOUND", "details": []},
        )

    logger.info(f"[{job_id}] Starting analysis thread: analysis_type={config.analysis_type}")
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

    # Copy per request: concurrent downloads sharing one BytesIO corrupt each
    # other (each seek(0) rewinds the stream the other is mid-way through).
    return StreamingResponse(
        io.BytesIO(job.output_buffer.getvalue()),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{job.output_filename}"'},
    )


@router.get("/summary/{job_id}")
async def summary(job_id: str):
    job = job_manager.get_job(job_id)
    if job.status != JobStatus.COMPLETE:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Analysis not complete.", "code": "NOT_READY", "details": []},
        )
    return job.results


@router.get("/filter-options/{job_id}")
async def filter_options(
    request: Request,
    job_id: str,
    column: str,
    direction: str = Query(...),
    comparison_type: str = Query(...),
):
    """Distinct values for one column after applying all other active column filters."""
    if job_id not in _result_data:
        return JSONResponse(status_code=404, content={"error": True, "message": "Results not found.", "code": "NOT_FOUND", "details": []})
    df: pl.DataFrame = _result_data[job_id].get(direction, {}).get(comparison_type, pl.DataFrame())
    if df.height == 0 or column not in df.columns:
        return {"values": []}
    _reserved = {"column", "direction", "comparison_type"}
    for _col, _val in dict(request.query_params).items():
        if _col not in _reserved and _col != column and _col in df.columns and _val:
            _vals = [v.strip() for v in _val.split(",") if v.strip()]
            if _vals:
                df = df.filter(pl.col(_col).is_in(_vals))
    return {"values": df.select(column).drop_nulls().unique().sort(column).to_series().cast(pl.Utf8).to_list()}


@router.get("/results/{job_id}")
async def results_page(
    request: Request,
    job_id: str,
    direction: str = Query(..., description="'1to2' or '2to1'"),
    comparison_type: str = Query(..., description="'duty_role', 'privilege', or 'dsp'"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1),
    status_filter: Optional[str] = Query(None, description="Filter by Status: 'exists' or 'missing'"),
    search: Optional[str] = Query(None, description="Text search across all columns"),
):
    if job_id not in _result_data:
        return JSONResponse(
            status_code=404,
            content={"error": True, "message": "Results not found. The job may have expired.", "code": "NOT_FOUND", "details": []},
        )
    if direction not in ("1to2", "2to1"):
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "direction must be '1to2' or '2to1'.", "code": "VALIDATION_ERROR", "details": []},
        )

    df: pl.DataFrame = _result_data[job_id].get(direction, {}).get(comparison_type, pl.DataFrame())

    if df.height == 0:
        return {"rows": [], "total": 0, "page": page, "page_size": page_size}

    _reserved = {"direction", "comparison_type", "page", "page_size", "status_filter", "search"}
    for _col, _val in dict(request.query_params).items():
        if _col not in _reserved and _col in df.columns and _val:
            _vals = [v.strip() for v in _val.split(",") if v.strip()]
            if _vals:
                df = df.filter(pl.col(_col).is_in(_vals))

    if status_filter and "Status" in df.columns:
        sf = status_filter.lower()
        df = df.filter(pl.col("Status").cast(pl.Utf8).str.to_lowercase().str.contains(sf, literal=True))

    if search:
        s = search.lower()
        df = df.filter(
            pl.any_horizontal([
                pl.col(c).cast(pl.Utf8).str.to_lowercase().str.contains(s, literal=True)
                for c in df.columns
            ])
        )

    if "Status" in df.columns:
        df = df.sort("Status")

    total = df.height
    page_size = max(1, page_size)
    page = max(1, page)
    start = (page - 1) * page_size
    return {"rows": df.slice(start, page_size).to_dicts(), "total": total, "page": page, "page_size": page_size}


@router.delete("/job/{job_id}")
async def cancel(job_id: str):
    job_manager.get_job(job_id)
    job_manager.delete_job(job_id)  # also purges this router's registered result cache
    return {"message": "Job deleted."}
