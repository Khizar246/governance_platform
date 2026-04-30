"""SOD & SA Analysis API router (Tool 4).

Endpoints:
  POST /api/sod-sa/upload
  POST /api/sod-sa/run/{job_id}
  GET  /api/sod-sa/status/{job_id}
  GET  /api/sod-sa/download/{job_id}
  DELETE /api/sod-sa/job/{job_id}
"""

import logging
import threading
from typing import Optional

import polars as pl
from fastapi import APIRouter, UploadFile, File
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

        summary = SODSASummary(
            analysis_type=analysis_type,
            violations=ViolationCounts(
                role_sod=role_sod.height,
                role_sa=role_sa.height,
                user_sod=user_sod.height,
                user_sa=user_sa.height,
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


@router.delete("/job/{job_id}")
async def cancel(job_id: str):
    job_manager.get_job(job_id)
    job_manager.delete_job(job_id)
    return {"message": "Job deleted."}
