"""SOD & SA Analysis API router (Tool 4).

Endpoints:
  POST /api/sod-sa/upload
  POST /api/sod-sa/run/{job_id}
  GET  /api/sod-sa/status/{job_id}
  GET  /api/sod-sa/summary/{job_id}
  GET  /api/sod-sa/results/{job_id}
  GET  /api/sod-sa/download/{job_id}
  DELETE /api/sod-sa/job/{job_id}
"""

import logging
import threading
from typing import Optional

import polars as pl
from fastapi import APIRouter, Request, UploadFile, File
from fastapi.responses import JSONResponse, StreamingResponse

from config import MAX_UPLOAD_SIZE_BYTES, ALLOWED_EXTENSIONS, output_filename
from models.common import UploadResponse, AnalysisResponse, JobResponse, JobStatus, FilePreview
from models.sod_sa_analysis import SODSARunConfig, ViolationCounts, SODSASummary
from services.job_manager import job_manager
from shared.file_io import load_csv_to_polars, load_excel_to_polars
from shared.validators import validate_upload
from engines.sod_sa_engine import (
    load_ruleset_sheets, analyze_roles, analyze_users, export_results,
    INPUT_COLUMN_RENAME, _apply_rename, _upper_values,
)

router = APIRouter(prefix="/api/sod-sa", tags=["SOD & SA Analysis"])
logger = logging.getLogger("governance_platform.sod_sa")

# Columns exposed per sheet through the paginated results endpoint
_ROLE_COLS = ["CONTROL_NAME", "ENTITLEMENT", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_DISPLAY_NAME", "PRIVILEGE_DISPLAY_NAME"]
_USER_COLS = ["CONTROL_NAME", "ENTITLEMENT", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_DISPLAY_NAME", "PRIVILEGE_DISPLAY_NAME", "USER_NAME"]
_SHEET_COLS = {
    "ROLE_SOD": _ROLE_COLS,
    "ROLE_SA":  _ROLE_COLS,
    "USER_SOD": _USER_COLS,
    "USER_SA":  _USER_COLS,
}

_ROLE_SORT = ["CONTROL_NAME", "ENTITLEMENT", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_DISPLAY_NAME", "PRIVILEGE_DISPLAY_NAME"]
_USER_SORT = ["CONTROL_NAME", "ENTITLEMENT", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_DISPLAY_NAME", "PRIVILEGE_DISPLAY_NAME", "USER_NAME"]

# Per-sheet DataFrames keyed by job_id; cleared on DELETE
_result_dfs: dict[str, dict[str, pl.DataFrame]] = {}


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
    role_hierarchy_df: pl.DataFrame,
    sod_controls_df: pl.DataFrame,
    sa_controls_df: pl.DataFrame,
    entitlement_mapping_df: pl.DataFrame,
    user_role_df: Optional[pl.DataFrame],
    analysis_type: str,
) -> None:
    try:
        callback = job_manager.make_progress_callback(job_id)

        role_sod = pl.DataFrame()
        role_sa = pl.DataFrame()
        user_sod = pl.DataFrame()
        user_sa = pl.DataFrame()

        if analysis_type in ("role", "both"):
            role_sod, role_sa = analyze_roles(
                role_hierarchy_df,
                sod_controls_df,
                sa_controls_df,
                entitlement_mapping_df,
                logger=logger,
                progress_callback=callback if analysis_type == "role" else None,
            )

        if analysis_type in ("user", "both") and user_role_df is not None:
            user_sod, user_sa = analyze_users(
                role_hierarchy_df,
                user_role_df,
                sod_controls_df,
                sa_controls_df,
                entitlement_mapping_df,
                logger=logger,
                progress_callback=callback if analysis_type == "user" else None,
            )

        total_roles = (
            role_hierarchy_df.select("ROLE_NAME").unique().height
            if "ROLE_NAME" in role_hierarchy_df.columns
            else 0
        )
        total_users = (
            user_role_df.select("USER_NAME").unique().height
            if user_role_df is not None and "USER_NAME" in user_role_df.columns
            else 0
        )

        # Cache per-sheet rows (restricted columns) for paginated/summary access
        cache: dict[str, list[dict]] = {}
        for _sheet_name, _df in [
            ("ROLE_SOD", role_sod),
            ("ROLE_SA",  role_sa),
            ("USER_SOD", user_sod),
            ("USER_SA",  user_sa),
        ]:
            if _df.height == 0:
                continue
            _cols = _SHEET_COLS[_sheet_name]
            _available = [c for c in _cols if c in _df.columns]
            cache[_sheet_name] = _df.select(_available)
        _result_dfs[job_id] = cache

        summary = SODSASummary(
            analysis_type=analysis_type,
            violations=ViolationCounts(
                role_sod=role_sod.select("ROLE_NAME").unique().height if role_sod.height > 0 else 0,
                role_sa=role_sa.select("ROLE_NAME").unique().height if role_sa.height > 0 else 0,
                user_sod=user_sod.select("USER_NAME").unique().height if user_sod.height > 0 else 0,
                user_sa=user_sa.select("USER_NAME").unique().height if user_sa.height > 0 else 0,
            ),
            total_roles_analyzed=total_roles,
            total_users_analyzed=total_users,
        ).model_dump()

        export_result = export_results(
            role_sod,
            role_sa,
            user_sod,
            user_sa,
            sod_controls_df,
            sa_controls_df,
            analysis_type,
            logger=logger,
        )
        if not export_result.success:
            job_manager.fail_job(job_id, export_result.errors)
            return

        job_manager.complete_job(job_id, summary, export_result.data, output_filename("SOD_SA_Analysis", analysis_type.capitalize()))

    except Exception as exc:
        logger.error("SOD SA thread error: %s", exc, exc_info=True)
        job_manager.fail_job(job_id, [str(exc)])


@router.post("/upload", response_model=UploadResponse)
async def upload(
    role_hierarchy: UploadFile = File(..., description="Role Hierarchy Report XLSX/CSV"),
    ruleset: UploadFile = File(..., description="SOD SA Ruleset XLSX (3 sheets)"),
    user_role: Optional[UploadFile] = File(None, description="User Role Membership XLSX/CSV"),
):
    errors: list[str] = []

    ok, msg = await validate_upload(role_hierarchy, MAX_UPLOAD_SIZE_BYTES, ALLOWED_EXTENSIONS)
    if not ok:
        errors.append(f"Role Hierarchy: {msg}")

    ok, msg = await validate_upload(ruleset, MAX_UPLOAD_SIZE_BYTES, {".xlsx", ".xls"})
    if not ok:
        errors.append(f"Ruleset: {msg}")

    if user_role is not None:
        ok, msg = await validate_upload(user_role, MAX_UPLOAD_SIZE_BYTES, ALLOWED_EXTENSIONS)
        if not ok:
            errors.append(f"User Role: {msg}")

    if errors:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": errors[0], "code": "VALIDATION_ERROR", "details": errors},
        )

    rh_bytes = await role_hierarchy.read()
    ruleset_bytes = await ruleset.read()
    ur_bytes = (await user_role.read()) if user_role is not None else None

    # Load and normalise role hierarchy
    try:
        rh_df = _load_file(rh_bytes, role_hierarchy.filename or "role_hierarchy.xlsx")
        rh_df = _apply_rename(_upper_values(rh_df), INPUT_COLUMN_RENAME["role"])
    except Exception as exc:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": f"Role Hierarchy: {exc}", "code": "FILE_FORMAT_ERROR", "details": []},
        )

    # Engine-level ruleset loading validates sheet structure and required columns
    sod_df, sa_df, mapping_df, ruleset_errors = load_ruleset_sheets(
        ruleset_bytes, ruleset.filename or "ruleset.xlsx", logger
    )
    if ruleset_errors:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": ruleset_errors[0], "code": "FILE_FORMAT_ERROR", "details": ruleset_errors},
        )

    # Load and normalise user-role file if provided
    ur_df: Optional[pl.DataFrame] = None
    if ur_bytes is not None:
        try:
            ur_df = _load_file(ur_bytes, user_role.filename or "user_role.xlsx")
            ur_df = _apply_rename(_upper_values(ur_df), INPUT_COLUMN_RENAME["user"])
        except Exception as exc:
            return JSONResponse(
                status_code=400,
                content={"error": True, "message": f"User Role: {exc}", "code": "FILE_FORMAT_ERROR", "details": []},
            )

    job = job_manager.create_job("sod_sa_analysis")
    job_manager.store_files(job.id, {
        "role_hierarchy_df": rh_df,
        "sod_controls_df": sod_df,
        "sa_controls_df": sa_df,
        "entitlement_mapping_df": mapping_df,
        "user_role_df": ur_df,
    })
    job_manager.set_config(job.id, {"has_user_role": ur_df is not None})
    job_manager.set_status(job.id, JobStatus.VALIDATING, "Files validated.")

    preview_files: dict[str, FilePreview] = {
        "role_hierarchy": _build_preview(rh_df, role_hierarchy.filename or "role_hierarchy"),
        "sod_controls": _build_preview(sod_df, "SoD Ruleset"),
        "sa_controls": _build_preview(sa_df, "SA Ruleset"),
    }
    if ur_df is not None:
        preview_files["user_role"] = _build_preview(ur_df, user_role.filename or "user_role")

    warnings: list[str] = []
    if ur_df is None:
        warnings.append("No user-role file provided. User-level analysis will not be available.")

    return UploadResponse(
        job_id=job.id,
        files=preview_files,
        status=JobStatus.VALIDATING,
        warnings=warnings,
    )


@router.post("/run/{job_id}", response_model=AnalysisResponse)
async def run(job_id: str, config: SODSARunConfig):
    job = job_manager.get_job(job_id)

    if not job.files:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Files not found. Please upload again.", "code": "FILES_NOT_FOUND", "details": []},
        )

    has_user_role = job.config.get("has_user_role", False)
    if config.analysis_type in ("user", "both") and not has_user_role:
        return JSONResponse(
            status_code=400,
            content={
                "error": True,
                "message": "User-role file was not uploaded. Cannot run user-level analysis.",
                "code": "VALIDATION_ERROR",
                "details": [],
            },
        )

    threading.Thread(
        target=_run_thread,
        args=(
            job_id,
            job.files["role_hierarchy_df"],
            job.files["sod_controls_df"],
            job.files["sa_controls_df"],
            job.files["entitlement_mapping_df"],
            job.files.get("user_role_df"),
            config.analysis_type,
        ),
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
    """Per-sheet counts and top-5 rankings derived from cached result rows."""
    if job_id not in _result_dfs:
        job_manager.get_job(job_id)  # raises 404 if job is gone entirely
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Results not ready.", "code": "NOT_READY", "details": []},
        )

    cache = _result_dfs[job_id]

    def _top5(df: pl.DataFrame, group_col: str, count_col: str) -> list[dict]:
        if group_col not in df.columns or count_col not in df.columns:
            return []
        return (
            df.group_by(group_col)
            .agg(pl.col(count_col).n_unique().alias("count"))
            .sort("count", descending=True)
            .head(5)
            .rename({group_col: "name"})
            .to_dicts()
        )

    sheet_counts: dict[str, dict] = {}
    for sheet, df in cache.items():
        entry: dict = {"total_violations": df.height}
        if "ROLE_NAME" in df.columns:
            entry["unique_roles"] = df["ROLE_NAME"].n_unique()
        if "USER_NAME" in df.columns:
            entry["unique_users"] = df["USER_NAME"].n_unique()
        sheet_counts[sheet] = entry

    result: dict = {"sheet_counts": sheet_counts}

    if "ROLE_SOD" in cache:
        result["top_roles_sod"]    = _top5(cache["ROLE_SOD"], "ROLE_DISPLAY_NAME",    "CONTROL_NAME")
        result["top_sod_controls"] = _top5(cache["ROLE_SOD"], "CONTROL_NAME", "ROLE_DISPLAY_NAME")

    if "USER_SOD" in cache:
        result["top_users_sod"] = _top5(cache["USER_SOD"], "USER_NAME", "CONTROL_NAME")
        if "top_sod_controls" not in result:
            result["top_sod_controls"] = _top5(cache["USER_SOD"], "CONTROL_NAME", "USER_NAME")

    if "ROLE_SA" in cache:
        result["top_sa_controls"] = _top5(cache["ROLE_SA"], "CONTROL_NAME", "ROLE_DISPLAY_NAME")

    if "USER_SA" in cache and "top_sa_controls" not in result:
        result["top_sa_controls"] = _top5(cache["USER_SA"], "CONTROL_NAME", "USER_NAME")

    return result


@router.get("/filter-options/{job_id}")
async def filter_options(request: Request, job_id: str, column: str, sheet: str):
    """Distinct values for one column after applying all other active column filters."""
    if job_id not in _result_dfs:
        job_manager.get_job(job_id)
        return JSONResponse(status_code=400, content={"error": True, "message": "Results not ready.", "code": "NOT_READY", "details": []})
    cache = _result_dfs[job_id]
    if sheet not in cache:
        return {"values": []}
    df: pl.DataFrame = cache[sheet]
    _reserved = {"column", "sheet"}
    for _col, _val in dict(request.query_params).items():
        if _col not in _reserved and _col != column and _col in df.columns and _val:
            _vals = [v.strip() for v in _val.split(",") if v.strip()]
            if _vals:
                df = df.filter(pl.col(_col).is_in(_vals))
    if column not in df.columns:
        return {"values": []}
    return {"values": df.select(column).drop_nulls().unique().sort(column).to_series().cast(pl.Utf8).to_list()}


@router.get("/results/{job_id}")
async def results_page(
    request: Request,
    job_id: str,
    sheet: str,
    page: int = 1,
    page_size: int = 50,
    search: str = "",
):
    """Paginated, filtered rows for a single violation sheet."""
    if job_id not in _result_dfs:
        job_manager.get_job(job_id)  # raises 404 if job is gone entirely
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Results not ready.", "code": "NOT_READY", "details": []},
        )

    cache = _result_dfs[job_id]
    if sheet not in cache:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": f"Sheet '{sheet}' was not analyzed.", "code": "NOT_FOUND", "details": []},
        )

    df: pl.DataFrame = cache[sheet]

    _reserved = {"sheet", "page", "page_size", "search"}
    for _col, _val in dict(request.query_params).items():
        if _col not in _reserved and _col in df.columns and _val:
            _vals = [v.strip() for v in _val.split(",") if v.strip()]
            if _vals:
                df = df.filter(pl.col(_col).is_in(_vals))

    if search:
        q = search.lower()
        cols = [c for c in _SHEET_COLS.get(sheet, []) if c in df.columns]
        if cols:
            df = df.filter(
                pl.any_horizontal([
                    pl.col(c).cast(pl.Utf8).str.to_lowercase().str.contains(q, literal=True)
                    for c in cols
                ])
            )

    sort_cols = _USER_SORT if sheet.startswith("USER") else _ROLE_SORT
    df = df.sort([c for c in sort_cols if c in df.columns])

    total = df.height
    page_size = max(1, page_size)
    page = max(1, page)
    start = (page - 1) * page_size
    return {"data": df.slice(start, page_size).to_dicts(), "total": total, "page": page, "page_size": page_size, "sheet": sheet}


@router.delete("/job/{job_id}")
async def cancel(job_id: str):
    job_manager.get_job(job_id)
    job_manager.delete_job(job_id)
    _result_dfs.pop(job_id, None)
    return {"message": "Job deleted."}
