"""False Positive Analysis API router (Tool 2).

Endpoints:
  POST /api/fp-analysis/upload
  POST /api/fp-analysis/run/{job_id}
  GET  /api/fp-analysis/status/{job_id}
  GET  /api/fp-analysis/download/{job_id}
  DELETE /api/fp-analysis/job/{job_id}
"""

import logging
import threading

import polars as pl
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse, StreamingResponse

from config import MAX_UPLOAD_SIZE_BYTES, output_filename
from models.common import UploadResponse, AnalysisResponse, JobResponse, JobStatus, FilePreview
from models.fp_analysis import FPRunConfig, FPSheetSummary, FPAnalysisSummary
from services.job_manager import job_manager
from shared.validators import validate_upload
from engines.fp_analysis_engine import (
    load_sod_file, load_fp_database, validate_sod, validate_fp, run_analysis, export_results,
    DETAILS_SHEET, VIOLATION_SHEETS, SHEET_LABELS,
)

router = APIRouter(prefix="/api/fp-analysis", tags=["FP Analysis"])
logger = logging.getLogger("governance_platform.fp_analysis")

_XLSX_EXTS = {".xlsx", ".xls"}

# Columns exposed per sheet type through the paginated results endpoint
_ROLE_COLS = ["CONTROL_NAME", "ENTITLEMENT", "ROLE_NAME", "INHERITED_ROLE_NAME", "PRIVILEGE_NAME", "FP?", "Reason"]
_USER_COLS = ["CONTROL_NAME", "ENTITLEMENT", "ROLE_NAME", "INHERITED_ROLE_NAME", "PRIVILEGE_NAME", "USER_NAME", "FP?", "Reason"]

# Per-sheet result rows keyed by job_id; cleared on DELETE
_result_dfs: dict[str, dict[str, list[dict]]] = {}


def _build_preview(df: pl.DataFrame, filename: str) -> FilePreview:
    return FilePreview(
        filename=filename,
        rows=df.height,
        columns=df.columns,
        preview=df.head(5).to_dicts(),
        duplicates=df.height - df.unique().height,
    )


def _run_thread(
    job_id: str,
    sod_data: dict,
    fp_db_data: dict,
    mode: str,
    selected: set[str],
) -> None:
    try:
        callback = job_manager.make_progress_callback(job_id)
        result = run_analysis(sod_data, fp_db_data, selected, mode, logger=logger, progress_callback=callback)

        if not result.success:
            job_manager.fail_job(job_id, result.errors)
            return

        results_dfs: dict[str, pl.DataFrame] = result.data

        # Cache per-sheet rows (selected columns only) for paginated access
        cache: dict[str, list[dict]] = {}
        for _sheet in VIOLATION_SHEETS:
            if _sheet not in results_dfs or results_dfs[_sheet].height == 0:
                continue
            _df = results_dfs[_sheet]
            _cols = _USER_COLS if "USER" in _sheet else _ROLE_COLS
            _available = [c for c in _cols if c in _df.columns]
            cache[_sheet] = _df.select(_available).to_dicts()
        _result_dfs[job_id] = cache

        sheet_summaries = []
        for sheet in VIOLATION_SHEETS:
            if sheet not in results_dfs or results_dfs[sheet].height == 0:
                continue
            df = results_dfs[sheet]
            total = df.height
            fp_col = df["FP?"] if "FP?" in df.columns else None
            fp_count = int(df.filter(pl.col("FP?") == "YES").height) if fp_col is not None else 0
            sl_count = int(df.filter(pl.col("FP?") == "SL").height) if fp_col is not None else 0
            tc_count = int(df.filter(pl.col("FP?") == "True Conflict").height) if fp_col is not None else 0
            sheet_summaries.append(
                FPSheetSummary(
                    sheet=SHEET_LABELS.get(sheet, sheet),
                    total=total,
                    fp_count=fp_count,
                    sl_count=sl_count,
                    tc_count=tc_count,
                    reduction_pct=round((fp_count + sl_count) / total * 100, 1) if total else 0.0,
                ).model_dump()
            )

        summary = FPAnalysisSummary(
            mode=mode,
            sheets_analyzed=sorted(selected),
            sheet_summaries=sheet_summaries,
        ).model_dump()

        export_result = export_results(results_dfs, logger=logger)
        if not export_result.success:
            job_manager.fail_job(job_id, export_result.errors)
            return

        job_manager.complete_job(job_id, summary, export_result.data, output_filename("FP_Analysis", mode.capitalize()))

    except Exception as exc:
        logger.error("FP analysis thread error: %s", exc, exc_info=True)
        job_manager.fail_job(job_id, [str(exc)])


@router.post("/upload", response_model=UploadResponse)
async def upload(
    sod_file: UploadFile = File(..., description="SOD Analysis Output XLSX"),
    fp_db_file: UploadFile = File(..., description="FP Database XLSX"),
):
    errors: list[str] = []

    for uf, label in [(sod_file, "SOD file"), (fp_db_file, "FP Database")]:
        ok, msg = await validate_upload(uf, MAX_UPLOAD_SIZE_BYTES, _XLSX_EXTS)
        if not ok:
            errors.append(f"{label}: {msg}")

    if errors:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": errors[0], "code": "VALIDATION_ERROR", "details": errors},
        )

    sod_bytes = await sod_file.read()
    fp_db_bytes = await fp_db_file.read()

    sod_result = load_sod_file(sod_bytes, sod_file.filename or "sod.xlsx")
    if not sod_result.success:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": sod_result.errors[0], "code": "FILE_FORMAT_ERROR", "details": sod_result.errors},
        )

    fp_db_result = load_fp_database(fp_db_bytes, fp_db_file.filename or "fp_db.xlsx")
    if not fp_db_result.success:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": fp_db_result.errors[0], "code": "FILE_FORMAT_ERROR", "details": fp_db_result.errors},
        )

    sod_data: dict = sod_result.data
    fp_db_data: dict = fp_db_result.data

    available_sheets = [s for s in VIOLATION_SHEETS if s in sod_data and sod_data[s].height > 0]

    job = job_manager.create_job("fp_analysis")
    job_manager.store_files(job.id, {"sod_data": sod_data, "fp_db_data": fp_db_data})
    job_manager.set_config(job.id, {"available_sheets": available_sheets})
    job_manager.set_status(job.id, JobStatus.VALIDATING, "Files validated.")

    details_df = sod_data.get(DETAILS_SHEET, pl.DataFrame())
    no_action_df = fp_db_data.get("No_action_Privileges", pl.DataFrame())

    return UploadResponse(
        job_id=job.id,
        files={
            "sod_file": _build_preview(details_df, sod_file.filename or "sod.xlsx"),
            "fp_db_file": _build_preview(no_action_df, fp_db_file.filename or "fp_db.xlsx"),
        },
        status=JobStatus.VALIDATING,
        warnings=[f"Available violation sheets: {', '.join(available_sheets)}"] if available_sheets else [],
    )


@router.post("/run/{job_id}", response_model=AnalysisResponse)
async def run(job_id: str, config: FPRunConfig):
    job = job_manager.get_job(job_id)

    sod_data = job.files.get("sod_data")
    fp_db_data = job.files.get("fp_db_data")
    if sod_data is None or fp_db_data is None:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Files not found. Please upload again.", "code": "FILES_NOT_FOUND", "details": []},
        )

    available = job.config.get("available_sheets", list(VIOLATION_SHEETS))
    selected = set(config.sheets) if config.sheets else set(available)
    selected = selected & set(available)

    if not selected:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "No valid sheets selected for analysis.", "code": "VALIDATION_ERROR", "details": []},
        )

    ok, errs = validate_sod(sod_data, selected)
    if not ok:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": errs[0], "code": "VALIDATION_ERROR", "details": errs},
        )

    ok, err = validate_fp(fp_db_data, config.mode)
    if not ok:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": err, "code": "VALIDATION_ERROR", "details": [err]},
        )

    threading.Thread(
        target=_run_thread,
        args=(job_id, sod_data, fp_db_data, config.mode, selected),
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


@router.get("/summary/{job_id}")
async def summary(job_id: str):
    """Per-sheet summary stats derived from the cached result rows."""
    if job_id not in _result_dfs:
        job_manager.get_job(job_id)  # raises 404 if job is gone entirely
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Results not ready.", "code": "NOT_READY", "details": []},
        )
    sheets: dict[str, dict] = {}
    for sheet, rows in _result_dfs[job_id].items():
        sheets[sheet] = {
            "total": len(rows),
            "false_positive_count": sum(1 for r in rows if r.get("FP?") == "YES"),
            "single_leg_count":     sum(1 for r in rows if r.get("FP?") == "SL"),
            "true_conflict_count":  sum(1 for r in rows if r.get("FP?") == "True Conflict"),
        }
    return {"sheets": sheets}


@router.get("/results/{job_id}")
async def results_page(
    job_id: str,
    sheet: str,
    page: int = 1,
    page_size: int = 50,
    search: str = "",
    fp_filter: str = "",
):
    """Paginated, filtered rows for a single violation sheet."""
    if job_id not in _result_dfs:
        job_manager.get_job(job_id)  # raises 404 if job is gone entirely
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Results not ready.", "code": "NOT_READY", "details": []},
        )
    sheet_cache = _result_dfs[job_id]
    if sheet not in sheet_cache:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": f"Sheet '{sheet}' was not analyzed.", "code": "NOT_FOUND", "details": []},
        )

    rows: list[dict] = sheet_cache[sheet]

    if search:
        q = search.lower()
        _search_cols = ["CONTROL_NAME", "ENTITLEMENT", "ROLE_NAME", "INHERITED_ROLE_NAME", "PRIVILEGE_NAME", "USER_NAME"]
        rows = [r for r in rows if any(q in str(r.get(c, "")).lower() for c in _search_cols)]

    if fp_filter:
        rows = [r for r in rows if r.get("FP?", "") == fp_filter]

    total = len(rows)
    page_size = max(1, min(page_size, 200))
    page = max(1, page)
    start = (page - 1) * page_size
    return {"data": rows[start: start + page_size], "total": total, "page": page, "page_size": page_size, "sheet": sheet}


@router.delete("/job/{job_id}")
async def cancel(job_id: str):
    job_manager.get_job(job_id)
    job_manager.delete_job(job_id)
    _result_dfs.pop(job_id, None)
    return {"message": "Job deleted."}
