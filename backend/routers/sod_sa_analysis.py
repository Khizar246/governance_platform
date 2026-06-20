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

import io
import threading
from typing import Optional

import pandas as pd
import polars as pl
from fastapi import APIRouter, Request, UploadFile, File
from fastapi.responses import JSONResponse, StreamingResponse

from config import MAX_UPLOAD_SIZE_BYTES, ALLOWED_EXTENSIONS, output_filename
from models.common import UploadResponse, AnalysisResponse, JobResponse, JobStatus, FilePreview
from models.sod_sa_analysis import SODSARunConfig, ViolationCounts, SODSASummary
from services.job_manager import job_manager
from shared.file_io import load_csv_to_polars, load_excel_to_polars
from shared.validators import validate_upload
from shared.logger import get_logger
from engines.sod_sa_engine import (
    load_ruleset_sheets, analyze_roles, analyze_users, export_results,
    run_fp_pipeline, compute_user_groups,
    INPUT_COLUMN_RENAME, apply_rename, upper_values,
    BUCKET_DETAILS_REQUIRED_COLS,
)

router = APIRouter(prefix="/api/sod-sa", tags=["SOD & SA Analysis"])
logger = get_logger("sod_sa_analysis")

# Columns exposed per sheet through the paginated results endpoint
_ROLE_COLS = ["CONTROL_NAME", "CONTROL_BUCKET", "ENTITLEMENT", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_DISPLAY_NAME", "PRIVILEGE_DISPLAY_NAME", "Potential FP", "Reason"]
_USER_COLS = ["CONTROL_NAME", "CONTROL_BUCKET", "ENTITLEMENT", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_DISPLAY_NAME", "PRIVILEGE_DISPLAY_NAME", "GROUP_NAME", "USER_NAME", "Potential FP", "Reason"]
_SHEET_COLS = {
    "ROLE_SOD": _ROLE_COLS,
    "ROLE_SA":  _ROLE_COLS,
    "USER_SOD": _USER_COLS,
    "USER_SA":  _USER_COLS,
    "GROUP_MAPPING": ["GROUP_NAME", "ROLE_NAME", "NO_OF_USERS_IN_GROUP"],
}

_ROLE_SORT = ["CONTROL_NAME", "ENTITLEMENT", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_DISPLAY_NAME", "PRIVILEGE_DISPLAY_NAME"]
_USER_SORT = ["CONTROL_NAME", "ENTITLEMENT", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_DISPLAY_NAME", "PRIVILEGE_DISPLAY_NAME", "GROUP_NAME", "USER_NAME"]

# Per-sheet DataFrames keyed by job_id; purged on DELETE and on TTL expiry
_result_dfs: dict[str, dict[str, pl.DataFrame]] = {}
job_manager.register_result_cache(_result_dfs)


# ── Comprehensive upfront schema validation ─────────────────────────────────
# Required headers exactly as they appear in the user's file (case-insensitive).
_CSV_HEADER_ENCODINGS = ("utf-8-sig", "utf-8", "latin1", "cp1252", "iso-8859-1")

_RH_REQUIRED_COLS = [
    "TOP_ROLE_CODE", "TOP_ROLE_NAME", "ROLE_CODE", "ROLE_NAME",
    "PRIVILEGE_CODE", "PRIVILEGE_NAME",
]
_UR_REQUIRED_COLS = ["User Name", "Assigned Role Name"]
_RULESET_SHEET_SCHEMA = {
    "SoD Ruleset": ["Control Name", "Risk Ranking", "LHS Entitlement", "RHS Entitlement", "Module(s)", "Risk Description"],
    "SA Ruleset":  ["Control Name", "Risk Ranking", "Entitlement", "Side", "Module(s)", "Risk Description"],
    "Entitlement to Privilege": ["Entitlement Name", "Privilege Code"],
}
_FP_SHEET_SCHEMA = {
    "No_action_Privileges": ["PRIVILEGE_NAME", "False Positive Reason"],
    "WorkArea_Privileges":  ["PRIVILEGE_NAME", "WORK_AREA_PRIVILEGE_CODE"],
}


def _norm(s: str) -> str:
    return s.strip().upper()


def _missing_columns(actual_cols: list[str], required: list[str], file_label: str, sheet_label: Optional[str] = None) -> list[str]:
    present = {_norm(c) for c in actual_cols}
    errors: list[str] = []
    for col in required:
        if _norm(col) not in present:
            if sheet_label:
                errors.append(f"{file_label} -> {sheet_label} -> Missing Column: {col}")
            else:
                errors.append(f"{file_label} -> Missing Column: {col}")
    return errors


def _read_header_columns(file_bytes: bytes, filename: str, sheet_name: Optional[str] = None) -> list[str]:
    """Read ONLY the header row (nrows=0) so 10M-row files stay cheap."""
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if ext == ".csv":
        for enc in _CSV_HEADER_ENCODINGS:
            try:
                return list(pd.read_csv(io.StringIO(file_bytes.decode(enc)), nrows=0).columns)
            except Exception:
                continue
        raise ValueError("could not decode CSV header with any supported encoding")
    # For a flat (single-sheet) Excel file no sheet name is given; pd.read_excel
    # would then return a {name: DataFrame} dict, so target the first sheet explicitly.
    target_sheet = 0 if sheet_name is None else sheet_name
    return list(pd.read_excel(io.BytesIO(file_bytes), sheet_name=target_sheet, nrows=0).columns)


def _validate_flat_file(file_bytes: bytes, filename: str, file_label: str, required_cols: list[str]) -> list[str]:
    """Validate a single-sheet/CSV file's columns. Aggregates every missing column."""
    try:
        cols = _read_header_columns(file_bytes, filename)
    except Exception as exc:
        return [f"{file_label} -> file could not be read: {exc}"]
    return _missing_columns(cols, required_cols, file_label)


def _validate_multisheet_file(file_bytes: bytes, filename: str, file_label: str, sheet_schema: dict[str, list[str]]) -> list[str]:
    """Validate an XLSX: report every missing sheet AND every missing column at once."""
    try:
        sheet_names = pd.ExcelFile(io.BytesIO(file_bytes)).sheet_names
    except Exception as exc:
        return [f"{file_label} -> file could not be read as Excel: {exc}"]

    norm_to_actual = {_norm(s): s for s in sheet_names}
    errors: list[str] = []
    for sheet, required_cols in sheet_schema.items():
        actual = norm_to_actual.get(_norm(sheet))
        if actual is None:
            errors.append(f"{file_label} -> Missing Sheet: {sheet}")
            continue
        try:
            cols = _read_header_columns(file_bytes, filename, actual)
        except Exception as exc:
            errors.append(f"{file_label} -> {sheet} -> could not be read: {exc}")
            continue
        errors.extend(_missing_columns(cols, required_cols, file_label, sheet))
    return errors


def _validate_all_schemas(
    rh_bytes: bytes, rh_name: str,
    ruleset_bytes: bytes, ruleset_name: str,
    ur_bytes: Optional[bytes], ur_name: Optional[str],
    fp_bytes: Optional[bytes], fp_name: Optional[str],
) -> list[str]:
    """Scan every uploaded file, sheet and column upfront; return ALL issues together."""
    errors: list[str] = []
    errors += _validate_flat_file(rh_bytes, rh_name, "Role Hierarchy", _RH_REQUIRED_COLS)
    errors += _validate_multisheet_file(ruleset_bytes, ruleset_name, "Ruleset", _RULESET_SHEET_SCHEMA)
    if ur_bytes is not None and ur_name is not None:
        errors += _validate_flat_file(ur_bytes, ur_name, "User Role", _UR_REQUIRED_COLS)
    if fp_bytes is not None and fp_name is not None:
        errors += _validate_multisheet_file(fp_bytes, fp_name, "FP Database", _FP_SHEET_SCHEMA)
    return errors


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
    with_fp: bool = False,
    no_action_df: Optional[pl.DataFrame] = None,
    work_area_df: Optional[pl.DataFrame] = None,
    selected_analyses: Optional[list[str]] = None,
    with_observation: bool = False,
    project_name: str = "",
    bucket_details_df: Optional[pl.DataFrame] = None,
) -> None:
    try:
        logger.info(f"[{job_id}] Starting SOD & SA Analysis: analysis_type={analysis_type}, with_fp={with_fp}, selected_analyses={selected_analyses}")
        logger.info(f"[{job_id}] Input data - Role Hierarchy: {role_hierarchy_df.height} rows, SoD Controls: {sod_controls_df.height} rows, SA Controls: {sa_controls_df.height} rows, Entitlement Mapping: {entitlement_mapping_df.height} rows")
        if user_role_df is not None:
            logger.info(f"[{job_id}] User Role file: {user_role_df.height} rows")

        # If selected_analyses is empty or None, default to all analyses based on analysis_type
        if not selected_analyses:
            if analysis_type == "both":
                selected_analyses = ["role_sod", "role_sa", "user_sod", "user_sa"]
            elif analysis_type == "role":
                selected_analyses = ["role_sod", "role_sa"]
            else:  # "user"
                selected_analyses = ["user_sod", "user_sa"]

        callback = job_manager.make_progress_callback(job_id)

        def _step(n: int, pct: int, msg: str) -> None:
            """Advance step counter and update progress in one call."""
            job_manager.set_step(job_id, n)
            callback(pct, msg)

        _step(3, 2, "Initiating SOD SA Analysis…")

        # Compute user groups once from the full user-role membership file.
        # Groups users with identical role portfolios; joined onto violations after analysis.
        user_to_group_map: Optional[pl.DataFrame] = None
        group_mapping_export: Optional[pl.DataFrame] = None
        if user_role_df is not None and analysis_type in ("user", "both"):
            user_to_group_map, group_mapping_export = compute_user_groups(user_role_df)

        if analysis_type == "both":
            def role_callback(pct: int, msg: str) -> None:
                job_manager.set_step(job_id, 5 if "SA violations" in msg else 4)
                callback(pct // 2, msg)

            def user_callback(pct: int, msg: str) -> None:
                job_manager.set_step(job_id, 7 if "SA violations" in msg else 6)
                callback(50 + pct // 2, msg)
        elif analysis_type == "role":
            def role_callback(pct: int, msg: str) -> None:
                job_manager.set_step(job_id, 5 if "SA violations" in msg else 4)
                callback(pct, msg)
            user_callback = None
        else:  # "user"
            role_callback = None
            def user_callback(pct: int, msg: str) -> None:
                job_manager.set_step(job_id, 7 if "SA violations" in msg else 6)
                callback(pct, msg)

        role_sod = pl.DataFrame()
        role_sa = pl.DataFrame()
        user_sod = pl.DataFrame()
        user_sa = pl.DataFrame()

        # Only run role analysis if role_sod or role_sa is selected
        if ("role_sod" in selected_analyses or "role_sa" in selected_analyses) and analysis_type in ("role", "both"):
            logger.info(f"[{job_id}] Analyzing Role SoD and SA violations...")
            role_sod, role_sa = analyze_roles(
                role_hierarchy_df,
                sod_controls_df,
                sa_controls_df,
                entitlement_mapping_df,
                logger=logger,
                progress_callback=role_callback,
            )
            logger.info(f"[{job_id}] Role analysis complete - Role SoD: {role_sod.height} violations, Role SA: {role_sa.height} violations")
        elif analysis_type in ("role", "both"):
            logger.info(f"[{job_id}] Role analysis skipped (not in selected_analyses)")

        # Only run user analysis if user_sod or user_sa is selected
        if ("user_sod" in selected_analyses or "user_sa" in selected_analyses) and analysis_type in ("user", "both") and user_role_df is not None:
            logger.info(f"[{job_id}] Analyzing User SoD and SA violations...")
            user_sod, user_sa = analyze_users(
                role_hierarchy_df,
                user_role_df,
                sod_controls_df,
                sa_controls_df,
                entitlement_mapping_df,
                logger=logger,
                progress_callback=user_callback,
            )
            logger.info(f"[{job_id}] User analysis complete - User SoD: {user_sod.height} violations, User SA: {user_sa.height} violations")
        elif analysis_type in ("user", "both") and user_role_df is not None:
            logger.info(f"[{job_id}] User analysis skipped (not in selected_analyses)")

        # Honor dynamic analysis selection: discard any analysis the user did not tick.
        # (analyze_roles/analyze_users each compute SOD+SA together, so we filter here.)
        if "role_sod" not in selected_analyses:
            role_sod = pl.DataFrame()
        if "role_sa" not in selected_analyses:
            role_sa = pl.DataFrame()
        if "user_sod" not in selected_analyses:
            user_sod = pl.DataFrame()
        if "user_sa" not in selected_analyses:
            user_sa = pl.DataFrame()
        logger.info(f"[{job_id}] Selected analyses applied: {selected_analyses}")

        # ── Join GROUP_NAME onto user violations from the pre-computed group map ──
        if user_to_group_map is not None and not user_to_group_map.is_empty():
            _group_col = user_to_group_map.select(["USER_NAME", "GROUP_NAME"])
            if not user_sod.is_empty() and "USER_NAME" in user_sod.columns:
                user_sod = user_sod.join(_group_col, on="USER_NAME", how="left")
            if not user_sa.is_empty() and "USER_NAME" in user_sa.columns:
                user_sa = user_sa.join(_group_col, on="USER_NAME", how="left")

        # ── FP Pipeline (if enabled) ──────────────────────────────────────────
        if with_fp and no_action_df is not None and work_area_df is not None:
            _step(8, 53, "Initiating False Positive Analysis…")

            _step(9, 55, "FP analysis on role SOD…")
            if not role_sod.is_empty():
                role_sod = run_fp_pipeline(
                    role_sod,
                    no_action_df,
                    work_area_df,
                    role_hierarchy_df,
                    "ROLE_NAME",
                    is_sod=True,
                    user_role_df=None,
                )

            _step(10, 60, "FP analysis on role SA…")
            if not role_sa.is_empty():
                role_sa = run_fp_pipeline(
                    role_sa,
                    no_action_df,
                    work_area_df,
                    role_hierarchy_df,
                    "ROLE_NAME",
                    is_sod=False,
                    user_role_df=None,
                )

            _step(11, 65, "FP analysis on user SOD…")
            if not user_sod.is_empty():
                user_sod = run_fp_pipeline(
                    user_sod,
                    no_action_df,
                    work_area_df,
                    role_hierarchy_df,
                    "USER_NAME",
                    is_sod=True,
                    user_role_df=user_role_df,
                )

            _step(12, 70, "FP analysis on user SA…")
            if not user_sa.is_empty():
                user_sa = run_fp_pipeline(
                    user_sa,
                    no_action_df,
                    work_area_df,
                    role_hierarchy_df,
                    "USER_NAME",
                    is_sod=False,
                    user_role_df=user_role_df,
                )
        # FP disabled: leave DataFrames without FP columns; engine and cache
        # populate will both omit them from output when fp_enabled=False.

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
        cache: dict[str, pl.DataFrame] = {}
        for _sheet_name, _df in [
            ("ROLE_SOD",      role_sod),
            ("ROLE_SA",       role_sa),
            ("USER_SOD",      user_sod),
            ("USER_SA",       user_sa),
            ("GROUP_MAPPING", group_mapping_export),
        ]:
            if _df is None or _df.is_empty():
                continue
            _cols = _SHEET_COLS.get(_sheet_name, [])
            _available = [c for c in _cols if c in _df.columns]
            if _available:
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

        _step(14, 82, "All analysis complete — building Excel report…")
        logger.info(f"[{job_id}] Exporting results to Excel workbook...")

        def _export_step(n: int, msg: str) -> None:
            job_manager.set_step(job_id, n)
            callback(82 + n - 14, msg)

        export_result = export_results(
            role_sod,
            role_sa,
            user_sod,
            user_sa,
            sod_controls_df,
            sa_controls_df,
            analysis_type,
            logger=logger,
            group_mapping=group_mapping_export,
            role_hierarchy_df=role_hierarchy_df,
            fp_enabled=with_fp,
            step_callback=_export_step,
            project_name=project_name,
            with_observation=with_observation,
            bucket_details_df=bucket_details_df,
        )
        if not export_result.success:
            logger.error(f"[{job_id}] Export failed: {export_result.errors}")
            job_manager.fail_job(job_id, export_result.errors)
            return

        _step(21, 98, "Finalising workbook…")
        output_file = output_filename("SOD_SA_Analysis", analysis_type.capitalize())
        logger.info(f"[{job_id}] SOD & SA analysis complete. Output file: {output_file}")
        job_manager.complete_job(job_id, summary, export_result.data, output_file)

    except Exception as exc:
        logger.error(f"[{job_id}] SOD & SA analysis failed with exception", exc_info=True)
        job_manager.fail_job(job_id, [str(exc)])


@router.post("/upload", response_model=UploadResponse)
async def upload(
    role_hierarchy: UploadFile = File(..., description="Role Hierarchy Report XLSX/CSV"),
    ruleset: UploadFile = File(..., description="SOD SA Ruleset XLSX (3 sheets)"),
    user_role: Optional[UploadFile] = File(None, description="User Role Membership XLSX/CSV"),
    fp_db: Optional[UploadFile] = File(None, description="FP Database XLSX"),
):
    logger.info(f"SOD & SA upload initiated. Files: {role_hierarchy.filename}, {ruleset.filename}")
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

    if fp_db is not None:
        ok, msg = await validate_upload(fp_db, MAX_UPLOAD_SIZE_BYTES, {".xlsx", ".xls"})
        if not ok:
            errors.append(f"FP Database: {msg}")

    if errors:
        logger.error(f"SOD & SA upload validation failed: {errors}")
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": errors[0], "code": "VALIDATION_ERROR", "details": errors},
        )

    rh_bytes = await role_hierarchy.read()
    ruleset_bytes = await ruleset.read()
    ur_bytes = (await user_role.read()) if user_role is not None else None
    fp_bytes = (await fp_db.read()) if fp_db is not None else None

    rh_name = role_hierarchy.filename or "role_hierarchy.xlsx"
    ruleset_name = ruleset.filename or "ruleset.xlsx"
    ur_name = (user_role.filename or "user_role.xlsx") if user_role is not None else None
    fp_name = (fp_db.filename or "fp_db.xlsx") if fp_db is not None else None

    # ── Step 1: comprehensive upfront schema scan ───────────────────────────────
    # Reports EVERY missing sheet and column across ALL files at once, so the user
    # fixes everything in one pass instead of one-error-at-a-time.
    schema_errors = _validate_all_schemas(
        rh_bytes, rh_name, ruleset_bytes, ruleset_name, ur_bytes, ur_name, fp_bytes, fp_name,
    )
    if schema_errors:
        logger.error(f"SOD & SA schema validation failed with {len(schema_errors)} issue(s):")
        for _e in schema_errors:
            logger.error(f"  • {_e}")
        return JSONResponse(
            status_code=400,
            content={
                "error": True,
                "message": f"Found {len(schema_errors)} schema issue(s) across your files. Fix every item listed below, then re-upload.",
                "code": "SCHEMA_VALIDATION_ERROR",
                "details": schema_errors,
            },
        )

    # ── Step 2: load the validated files (collect any remaining data errors) ─────
    all_errors: list[str] = []
    rh_df = None
    sod_df = None
    sa_df = None
    mapping_df = None
    ur_df: Optional[pl.DataFrame] = None
    no_action_df: Optional[pl.DataFrame] = None
    work_area_df: Optional[pl.DataFrame] = None

    # Load and normalise role hierarchy
    try:
        rh_df = _load_file(rh_bytes, role_hierarchy.filename or "role_hierarchy.xlsx")
        rh_df = apply_rename(upper_values(rh_df), INPUT_COLUMN_RENAME["role"])
        logger.info(f"Loaded Role Hierarchy: {rh_df.height} rows, columns: {rh_df.columns}")
    except Exception as exc:
        logger.error(f"Failed to load Role Hierarchy: {exc}", exc_info=True)
        all_errors.append(f"Role Hierarchy ({role_hierarchy.filename or 'role_hierarchy.xlsx'}): {exc}")

    # Load ruleset — engine-level validation aggregates sheet/column errors
    bucket_details_df: Optional[pl.DataFrame] = None
    sod_df, sa_df, mapping_df, bucket_details_df_loaded, ruleset_errors = load_ruleset_sheets(
        ruleset_bytes, ruleset.filename or "ruleset.xlsx", logger
    )
    bucket_details_df = bucket_details_df_loaded
    if ruleset_errors:
        all_errors.extend([f"Ruleset ({ruleset.filename or 'ruleset.xlsx'}): {err}" for err in ruleset_errors])

    # Load user-role file if provided
    if ur_bytes is not None:
        try:
            ur_df = _load_file(ur_bytes, user_role.filename or "user_role.xlsx")
            ur_df = apply_rename(upper_values(ur_df), INPUT_COLUMN_RENAME["user"])
            logger.info(f"Loaded User Role: {ur_df.height} rows, columns: {ur_df.columns}")
        except Exception as exc:
            logger.error(f"Failed to load User Role: {exc}", exc_info=True)
            all_errors.append(f"User Role ({user_role.filename or 'user_role.xlsx'}): {exc}")

    # Load FP database sheets if provided
    if fp_bytes is not None:
        try:
            no_action_df = load_excel_to_polars(fp_bytes, fp_db.filename or "fp_db.xlsx", "No_action_Privileges", {}, logger)
            work_area_df = load_excel_to_polars(fp_bytes, fp_db.filename or "fp_db.xlsx", "WorkArea_Privileges", {}, logger)
            # Schema validation is case-insensitive but the FP engine joins on the
            # exact upper-case names — normalise headers so e.g. "Work_Area_Privilege"
            # cannot pass validation and then crash mid-run.
            no_action_df = no_action_df.rename({c: c.strip().upper() for c in no_action_df.columns})
            work_area_df = work_area_df.rename({c: c.strip().upper() for c in work_area_df.columns})
            logger.info(f"Loaded FP Database: No_action_Privileges {no_action_df.height} rows, WorkArea_Privileges {work_area_df.height} rows")
        except Exception as exc:
            logger.error(f"Failed to load FP Database: {exc}", exc_info=True)
            all_errors.append(f"FP Database ({fp_db.filename or 'fp_db.xlsx'}): {exc}")

    # Reject files that validated but contain zero data rows — otherwise the run
    # "succeeds" with silently empty results.
    for _df, _label in [
        (rh_df, "Role Hierarchy"),
        (sod_df, "Ruleset -> SoD Ruleset"),
        (sa_df, "Ruleset -> SA Ruleset"),
        (mapping_df, "Ruleset -> Entitlement to Privilege"),
        (ur_df, "User Role"),
    ]:
        if _df is not None and _df.height == 0:
            all_errors.append(f"{_label}: contains no data rows after loading.")

    # If any errors collected, return them all at once
    if all_errors:
        logger.error(f"SOD & SA upload failed with {len(all_errors)} error(s): {all_errors}")
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": f"Found {len(all_errors)} validation error(s). See details below.", "code": "FILE_FORMAT_ERROR", "details": all_errors},
        )

    # Verify that critical files loaded successfully
    if rh_df is None or sod_df is None or sa_df is None or mapping_df is None:
        missing = []
        if rh_df is None:
            missing.append("Role Hierarchy")
        if sod_df is None or sa_df is None or mapping_df is None:
            missing.append("Ruleset")
        error_msg = f"Could not load required files: {', '.join(missing)}"
        logger.error(error_msg)
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": error_msg, "code": "FILE_FORMAT_ERROR", "details": []},
        )

    job = job_manager.create_job("sod_sa_analysis")
    logger.info(f"[{job.id}] Created job for SOD & SA analysis")
    job_manager.store_files(job.id, {
        "role_hierarchy_df": rh_df,
        "sod_controls_df": sod_df,
        "sa_controls_df": sa_df,
        "entitlement_mapping_df": mapping_df,
        "user_role_df": ur_df,
        "no_action_df": no_action_df,
        "work_area_df": work_area_df,
        "bucket_details_df": bucket_details_df,
    })
    job_manager.set_config(job.id, {
        "has_user_role": ur_df is not None,
        "has_fp_db": fp_bytes is not None,
    })
    job_manager.set_status(job.id, JobStatus.VALIDATING, "Files validated.")
    logger.info(f"[{job.id}] Files stored and validated. Ready for analysis.")

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

    has_user_role = job.config.get("has_user_role", False)
    if config.analysis_type in ("user", "both") and not has_user_role:
        logger.warning(f"[{job_id}] User-level analysis requested but no user-role file provided")
        return JSONResponse(
            status_code=400,
            content={
                "error": True,
                "message": "User-role file was not uploaded. Cannot run user-level analysis.",
                "code": "VALIDATION_ERROR",
                "details": [],
            },
        )

    has_fp_db = job.config.get("has_fp_db", False) and config.with_fp

    # Bucket cross-reference validation: every Control Bucket value (except UNCATEGORIZED)
    # must have a matching row in Bucket Details.
    _sod_df = job.files.get("sod_controls_df")
    _bd_df = job.files.get("bucket_details_df")
    if (
        config.with_observation
        and _sod_df is not None
        and not _sod_df.is_empty()
        and "CONTROL_BUCKET" in _sod_df.columns
    ):
        _used_buckets = set(
            _sod_df.filter(
                pl.col("CONTROL_BUCKET").is_not_null()
                & (pl.col("CONTROL_BUCKET") != "")
                & (pl.col("CONTROL_BUCKET") != "UNCATEGORIZED")
            )["CONTROL_BUCKET"].unique().to_list()
        )
        if _used_buckets:
            _known_buckets: set[str] = set()
            if _bd_df is not None and not _bd_df.is_empty() and "BUCKET_NAME" in _bd_df.columns:
                _known_buckets = set(_bd_df["BUCKET_NAME"].unique().to_list())
            _missing_buckets = sorted(_used_buckets - _known_buckets)
            if _missing_buckets:
                return JSONResponse(
                    status_code=400,
                    content={
                        "error": True,
                        "message": (
                            f"Observation tab requested but {len(_missing_buckets)} Control Bucket(s) "
                            "have no matching row in the 'Bucket Details' sheet. "
                            "Add the missing rows or remove the bucket from 'Control Bucket' column."
                        ),
                        "code": "SCHEMA_VALIDATION_ERROR",
                        "details": [f"Missing Bucket Details row for: {b}" for b in _missing_buckets],
                    },
                )

    logger.info(f"[{job_id}] Starting analysis thread: analysis_type={config.analysis_type}, with_fp={has_fp_db}, selected_analyses={config.selected_analyses}")

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
            has_fp_db,
            job.files.get("no_action_df") if has_fp_db else None,
            job.files.get("work_area_df") if has_fp_db else None,
            config.selected_analyses,
            config.with_observation,
            config.project_name,
            job.files.get("bucket_details_df"),
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
    job_manager.delete_job(job_id)  # also purges this router's registered result cache
    return {"message": "Job deleted."}
