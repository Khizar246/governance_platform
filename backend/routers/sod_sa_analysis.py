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
import pathlib
from typing import Optional

import pandas as pd
import polars as pl
from fastapi import APIRouter, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse, StreamingResponse

from config import MAX_UPLOAD_SIZE_BYTES, ALLOWED_EXTENSIONS
from models.common import UploadResponse, AnalysisResponse, JobResponse, JobStatus, FilePreview
from models.sod_sa_analysis import SODSARunConfig
from services.job_manager import job_manager
from services.analysis_pool import analysis_pool, make_done_callback
from services.analysis_workers import run_sod_sa_job, SHEET_COLS as _SHEET_COLS
from shared.file_io import load_csv_to_polars, load_excel_to_polars
from shared.validators import validate_upload
from shared.logger import get_logger
from engines.sod_sa_engine import (
    load_ruleset_sheets,
    INPUT_COLUMN_RENAME, apply_rename, upper_values,
)

router = APIRouter(prefix="/api/sod-sa", tags=["SOD & SA Analysis"])
logger = get_logger("sod_sa_analysis")

# Bundled "seeded" files the user can load instead of uploading. Resolved relative
# to this package so it works regardless of the process working directory.
_SEEDED_DIR = pathlib.Path(__file__).resolve().parent.parent / "seeded" / "sod-sa"
_SEEDED_RULESET = _SEEDED_DIR / "ruleset.xlsx"
_SEEDED_FP_DB = _SEEDED_DIR / "fp_database.xlsx"

# Columns exposed per sheet through the paginated results endpoint live in
# services.analysis_workers.SHEET_COLS (imported above as _SHEET_COLS) — the
# worker process needs them too when building the result cache.

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
_PA_REQUIRED_COLS = ["USERNAME", "ACTIVE_FLAG"]
_RULESET_SHEET_SCHEMA = {
    "SoD Ruleset": ["Control Name", "LHS Entitlement", "RHS Entitlement"],
    "SA Ruleset":  ["Control Name", "Entitlement"],
    "Entitlement to Privilege": ["Entitlement Name", "Privilege Code"],
}
# 3-leg SOD mode (with_3leg): SoD Ruleset uses the AND/OR layout instead.
# Entitlement 3 / Condition 2 are optional (blank ⇒ 2-leg row).
_RULESET_SHEET_SCHEMA_3LEG = {
    "SoD Ruleset": ["Control Name", "Entitlement 1", "Condition 1", "Entitlement 2"],
    "SA Ruleset":  ["Control Name", "Entitlement"],
    "Entitlement to Privilege": ["Entitlement Name", "Privilege Code"],
}

# Recommended-but-optional columns. Their absence does NOT block analysis; it
# raises a non-blocking warning advising the user to add them for a client-ready
# export. Bucket Details columns are only checked when that sheet is present.
_RULESET_RECOMMENDED_COLS = {
    "SoD Ruleset":   ["Risk Ranking", "Module(s)", "Risk Description"],
    "SA Ruleset":    ["Risk Ranking", "Module(s)", "Risk Description"],
    "Bucket Details": ["Bucket Name", "Risk", "EY Recommendations"],
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


def _validate_module_required(ruleset_bytes: bytes, ruleset_name: str) -> list[str]:
    """A Procurement Agent upload makes Module(s) mandatory in both ruleset sheets."""
    try:
        sheet_names = pd.ExcelFile(io.BytesIO(ruleset_bytes)).sheet_names
    except Exception:
        return []  # unreadable ruleset already reported by the hard validation
    norm_to_actual = {_norm(s): s for s in sheet_names}
    errors: list[str] = []
    for sheet in ("SoD Ruleset", "SA Ruleset"):
        actual = norm_to_actual.get(_norm(sheet))
        if actual is None:
            continue  # missing sheet already reported by the hard validation
        try:
            cols = _read_header_columns(ruleset_bytes, ruleset_name, actual)
        except Exception:
            continue
        if _norm("Module(s)") not in {_norm(c) for c in cols}:
            errors.append(
                f"Ruleset -> {sheet} -> Missing Column: Module(s) "
                f"(required when a Procurement Agent file is uploaded)"
            )
    return errors


def _validate_all_schemas(
    rh_bytes: bytes, rh_name: str,
    ruleset_bytes: bytes, ruleset_name: str,
    ur_bytes: Optional[bytes], ur_name: Optional[str],
    fp_bytes: Optional[bytes], fp_name: Optional[str],
    pa_bytes: Optional[bytes] = None, pa_name: Optional[str] = None,
    with_3leg: bool = False,
) -> list[str]:
    """Scan every uploaded file, sheet and column upfront; return ALL issues together."""
    errors: list[str] = []
    errors += _validate_flat_file(rh_bytes, rh_name, "Role Hierarchy", _RH_REQUIRED_COLS)
    ruleset_schema = _RULESET_SHEET_SCHEMA_3LEG if with_3leg else _RULESET_SHEET_SCHEMA
    errors += _validate_multisheet_file(ruleset_bytes, ruleset_name, "Ruleset", ruleset_schema)
    if ur_bytes is not None and ur_name is not None:
        errors += _validate_flat_file(ur_bytes, ur_name, "User Role", _UR_REQUIRED_COLS)
    if fp_bytes is not None and fp_name is not None:
        errors += _validate_multisheet_file(fp_bytes, fp_name, "FP Database", _FP_SHEET_SCHEMA)
    if pa_bytes is not None and pa_name is not None:
        errors += _validate_flat_file(pa_bytes, pa_name, "Procurement Agent", _PA_REQUIRED_COLS)
        errors += _validate_module_required(ruleset_bytes, ruleset_name)
    return errors


def _inspect_observation_inputs(ruleset_bytes: bytes, ruleset_name: str) -> tuple[bool, bool]:
    """Inspect the raw ruleset for the inputs the Observation tab requires.

    Returns (has_control_bucket_col, has_bucket_details_sheet). Used at /run time
    to block observation runs whose ruleset lacks the Control Bucket column or the
    Bucket Details sheet (the engine silently fills an absent Control Bucket with
    UNCATEGORIZED, so this must be read from the original headers).
    """
    try:
        sheet_names = pd.ExcelFile(io.BytesIO(ruleset_bytes)).sheet_names
    except Exception:
        return False, False
    norm_to_actual = {_norm(s): s for s in sheet_names}
    has_bucket_details = _norm("Bucket Details") in norm_to_actual

    has_control_bucket = False
    sod_actual = norm_to_actual.get(_norm("SoD Ruleset"))
    if sod_actual is not None:
        try:
            cols = _read_header_columns(ruleset_bytes, ruleset_name, sod_actual)
            has_control_bucket = _norm("Control Bucket") in {_norm(c) for c in cols}
        except Exception:
            pass
    return has_control_bucket, has_bucket_details


def _scan_recommended_columns(ruleset_bytes: bytes, ruleset_name: str) -> list[str]:
    """Non-blocking scan: report recommended columns missing from the ruleset.

    Analysis can still run without these, but the export is not "client ready"
    until they are added. Bucket Details columns are only flagged when that
    optional sheet is present.
    """
    try:
        sheet_names = pd.ExcelFile(io.BytesIO(ruleset_bytes)).sheet_names
    except Exception:
        return []  # hard validation already reported the unreadable file

    norm_to_actual = {_norm(s): s for s in sheet_names}
    warnings: list[str] = []
    for sheet, recommended_cols in _RULESET_RECOMMENDED_COLS.items():
        actual = norm_to_actual.get(_norm(sheet))
        if actual is None:
            # Bucket Details is optional; absence of the whole sheet is not warned here.
            continue
        try:
            cols = _read_header_columns(ruleset_bytes, ruleset_name, actual)
        except Exception:
            continue
        present = {_norm(c) for c in cols}
        missing = [c for c in recommended_cols if _norm(c) not in present]
        for col in missing:
            warnings.append(f"Ruleset -> {sheet} -> Missing recommended column: {col}")
    return warnings


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


def _validate_3leg_conditions(sod_df: pl.DataFrame) -> tuple[list[str], list[str]]:
    """Validate Condition values in a 3-leg SoD Ruleset (with_3leg mode only).

    Errors (blocking): a non-blank Condition cell that is not AND/OR
    (case-insensitive), or Entitlement 3 filled with a blank Condition 2.
    Warnings (non-blocking): all-OR rows — they evaluate as written (any single
    entitlement match flags the control), which is usually not intended.
    Returns (errors, warnings) with user-facing column names.
    """
    errors: list[str] = []
    warnings: list[str] = []

    def _s(v) -> str:
        return str(v).strip().upper() if v is not None else ""

    for row in sod_df.select(
        ["CONTROL_NAME", "CONDITION_1", "CONDITION_2", "ENTITLEMENT_3"]
    ).iter_rows():
        control, cond1, cond2, ent3 = (_s(v) for v in row)
        label = f'Ruleset -> SoD Ruleset -> Control "{control}"'
        if cond1 and cond1 not in ("AND", "OR"):
            errors.append(f'{label}: Condition 1 must be AND or OR (found "{cond1}").')
        if cond2 and cond2 not in ("AND", "OR"):
            errors.append(f'{label}: Condition 2 must be AND or OR (found "{cond2}").')
        if ent3 and not cond2:
            errors.append(
                f"{label}: Entitlement 3 is filled but Condition 2 is blank. "
                f"Add AND or OR in Condition 2, or clear Entitlement 3."
            )
        # All-OR row: no AND anywhere → any single entitlement match flags it.
        if cond1 == "OR" and (not ent3 or cond2 == "OR"):
            warnings.append(
                f"{label} uses only OR conditions — any ONE of its entitlements "
                f"alone will flag a violation. Verify this is intended."
            )
    return errors, warnings


def _check_missing_entitlement_mappings(
    sod_df: pl.DataFrame,
    sa_df: pl.DataFrame,
    mapping_df: pl.DataFrame,
    three_leg: bool = False,
) -> list[dict]:
    """Check for entitlements in controls that have no mapping.

    Returns list of dicts: [{"entitlement": str, "controls": [str, ...]}, ...]
    sorted by entitlement name.
    When three_leg=True the SoD Ruleset legs are Entitlement 1/2/3 instead of LHS/RHS.
    """
    EMPTY_PLACEHOLDER = "---"

    # SoD entitlement columns depend on the ruleset layout (2-leg vs 3-leg mode)
    if three_leg:
        sod_ent_cols = ["ENTITLEMENT_1", "ENTITLEMENT_2", "ENTITLEMENT_3"]
    else:
        sod_ent_cols = ["LHS_ENTITLEMENT", "RHS_ENTITLEMENT"]

    # Collect all unique entitlement names from both SOD and SA controls
    sod_ents: list = []
    for _col in sod_ent_cols:
        if _col in sod_df.columns:
            sod_ents += sod_df[_col].to_list()
    sa_ents = sa_df["ENTITLEMENT"].to_list() if "ENTITLEMENT" in sa_df.columns else []

    # Union all entitlements, filter out nulls and empty placeholders, deduplicate
    all_entitlements_in_controls = set()
    for ent in sod_ents + sa_ents:
        if ent is not None and ent != EMPTY_PLACEHOLDER and str(ent).strip():
            all_entitlements_in_controls.add(str(ent).strip().upper())

    # Get mapped entitlements
    mapped_entitlements = set()
    if "ENTITLEMENT_NAME" in mapping_df.columns:
        mapped_list = mapping_df["ENTITLEMENT_NAME"].to_list()
        for ent in mapped_list:
            if ent is not None and ent != EMPTY_PLACEHOLDER and str(ent).strip():
                mapped_entitlements.add(str(ent).strip().upper())

    # Find missing entitlements
    missing_entitlements = all_entitlements_in_controls - mapped_entitlements

    if not missing_entitlements:
        return []

    # For each missing entitlement, find which controls reference it
    warnings: list[dict] = []

    for missing_ent in sorted(missing_entitlements):
        affected_controls = set()

        # Check SOD controls
        for _col in sod_ent_cols:
            if _col not in sod_df.columns:
                continue
            sod_matches = sod_df.filter(
                pl.col(_col).is_not_null() &
                (pl.col(_col).cast(pl.Utf8).str.to_uppercase() == missing_ent)
            )
            for control_name in sod_matches["CONTROL_NAME"].to_list():
                if control_name is not None:
                    affected_controls.add(str(control_name).strip())

        # Check SA controls
        if "ENTITLEMENT" in sa_df.columns:
            sa_matches = sa_df.filter(
                pl.col("ENTITLEMENT").is_not_null() &
                (pl.col("ENTITLEMENT").cast(pl.Utf8).str.to_uppercase() == missing_ent)
            )
            for control_name in sa_matches["CONTROL_NAME"].to_list():
                if control_name is not None:
                    affected_controls.add(str(control_name).strip())

        if affected_controls:
            warnings.append({
                "entitlement": missing_ent,
                "controls": sorted(affected_controls),
            })

    return warnings


def _check_shared_privileges_in_controls(
    sod_df: pl.DataFrame,
    mapping_df: pl.DataFrame,
    three_leg: bool = False,
) -> list[dict]:
    """Detect privileges mapped to BOTH entitlements of the same SoD control.

    WHY THIS GUARD EXISTS
    ---------------------
    A SoD control is defined by two entitlements (LHS and RHS). The conflict
    engine flags a violation only when an entity holds privileges from BOTH
    entitlements at once — that simultaneous-both-sides condition is what makes
    a real Segregation-of-Duties conflict.

    If a single privilege is mapped to BOTH the LHS and RHS entitlements of the
    SAME control, that logic breaks down: an entity holding only that one
    privilege would match both legs and be reported as a violation — not because
    it truly has conflicting access, but because the underlying mapping data is
    wrong. That produces false positives and makes the control unreliable.

    This check runs PER CONTROL on purpose. A privilege can legitimately appear
    in entitlements that belong to DIFFERENT controls; the problem is only an
    overlap WITHIN a single control's two entitlements.

    Returns one dict per offending control (control, privileges, lhs, rhs). Empty list when
    the mapping is clean. Callers treat a non-empty result as a hard upload
    rejection — analysis must not run on a control whose mapping is invalid.

    In 3-leg mode (three_leg=True) the same principle generalizes to AND-groups:
    a privilege mapped to at least one entitlement in EVERY AND-group of a
    control means an entity holding only that privilege satisfies every group
    at once — a guaranteed false violation. OR-alternatives within one group
    sharing a privilege is harmless. All-OR (single-group) rows are skipped.

    Values in both DataFrames are already uppercased/stripped by
    load_ruleset_sheets, so comparisons are exact-match.
    """
    # Need the control legs and the entitlement→privilege mapping to do anything.
    if three_leg:
        needed_sod = {"CONTROL_NAME", "ENTITLEMENT_1", "CONDITION_1", "ENTITLEMENT_2"}
    else:
        needed_sod = {"CONTROL_NAME", "LHS_ENTITLEMENT", "RHS_ENTITLEMENT"}
    if not needed_sod.issubset(set(sod_df.columns)):
        return []
    if not {"ENTITLEMENT_NAME", "PRIVILEGE_NAME"}.issubset(set(mapping_df.columns)):
        return []

    # Build lookup: entitlement name → set of its mapped privilege codes.
    ent_to_privs: dict[str, set[str]] = {}
    for row in mapping_df.select(["ENTITLEMENT_NAME", "PRIVILEGE_NAME"]).iter_rows():
        ent, priv = row
        if ent is None or priv is None:
            continue
        ent_s, priv_s = str(ent).strip(), str(priv).strip()
        if ent_s and priv_s:
            ent_to_privs.setdefault(ent_s, set()).add(priv_s)

    if three_leg:
        issues_3leg: list[dict] = []
        _cond2_present = "CONDITION_2" in sod_df.columns
        _ent3_present = "ENTITLEMENT_3" in sod_df.columns
        for row in sod_df.select([
            "CONTROL_NAME", "ENTITLEMENT_1", "CONDITION_1", "ENTITLEMENT_2",
            *(["CONDITION_2"] if _cond2_present else []),
            *(["ENTITLEMENT_3"] if _ent3_present else []),
        ]).iter_rows(named=True):
            def _val(key: str) -> str:
                v = row.get(key)
                return str(v).strip() if v is not None else ""

            e1, c1, e2 = _val("ENTITLEMENT_1"), _val("CONDITION_1").upper(), _val("ENTITLEMENT_2")
            c2, e3 = _val("CONDITION_2").upper(), _val("ENTITLEMENT_3")
            if not e1 or not e2:
                continue
            # AND starts a new group; OR (or anything else) joins the current one.
            groups: list[list[str]] = [[e1]]
            if c1 == "AND":
                groups.append([e2])
            else:
                groups[-1].append(e2)
            if e3:
                if c2 == "AND":
                    groups.append([e3])
                else:
                    groups[-1].append(e3)
            if len(groups) < 2:
                continue  # all-OR row: no cross-group overlap possible
            # A privilege is problematic when it maps into EVERY group.
            group_privs = [
                set().union(*(ent_to_privs.get(e, set()) for e in grp)) for grp in groups
            ]
            shared = set.intersection(*group_privs)
            if shared:
                issues_3leg.append({
                    "control": _val("CONTROL_NAME"),
                    "privileges": sorted(shared),
                    "entitlements": [e for grp in groups for e in grp],
                })
        return issues_3leg

    issues: list[dict] = []
    # One iteration per control row. Each row carries its own LHS/RHS entitlements,
    # so the overlap test is naturally scoped to a single control.
    for row in sod_df.select(["CONTROL_NAME", "LHS_ENTITLEMENT", "RHS_ENTITLEMENT"]).iter_rows():
        control_name, lhs_ent, rhs_ent = row
        if lhs_ent is None or rhs_ent is None:
            continue
        lhs_s, rhs_s = str(lhs_ent).strip(), str(rhs_ent).strip()
        # Privileges shared between the two sides of THIS control.
        shared = ent_to_privs.get(lhs_s, set()) & ent_to_privs.get(rhs_s, set())
        if shared:
            issues.append({
                "control": str(control_name),
                "privileges": sorted(shared),
                "lhs": lhs_s,
                "rhs": rhs_s,
            })

    return issues




@router.post("/upload", response_model=UploadResponse)
async def upload(
    role_hierarchy: UploadFile = File(..., description="Role Hierarchy Report XLSX/CSV"),
    ruleset: Optional[UploadFile] = File(None, description="SOD SA Ruleset XLSX (3 sheets)"),
    user_role: Optional[UploadFile] = File(None, description="User Role Membership XLSX/CSV"),
    fp_db: Optional[UploadFile] = File(None, description="FP Database XLSX"),
    procurement_agent: Optional[UploadFile] = File(None, description="Procurement Agent XLSX (single sheet with USERNAME and ACTIVE_FLAG)"),
    use_seeded_ruleset: bool = Form(False, description="Load the bundled seeded Ruleset instead of an upload"),
    use_seeded_fp_db: bool = Form(False, description="Load the bundled seeded FP Database instead of an upload"),
    with_3leg: bool = Form(False, description="SoD Ruleset uses the 3-leg AND/OR layout (Entitlement 1/Condition 1/Entitlement 2/Condition 2/Entitlement 3)"),
):
    logger.info(f"SOD & SA upload initiated. Files: {role_hierarchy.filename}, ruleset={ruleset.filename if ruleset else None}, use_seeded_ruleset={use_seeded_ruleset}, use_seeded_fp_db={use_seeded_fp_db}, with_3leg={with_3leg}")
    errors: list[str] = []

    ok, msg = await validate_upload(role_hierarchy, MAX_UPLOAD_SIZE_BYTES, ALLOWED_EXTENSIONS)
    if not ok:
        errors.append(f"Role Hierarchy: {msg}")

    # An uploaded ruleset always wins over the seed flag. Require one of the two.
    if ruleset is not None:
        ok, msg = await validate_upload(ruleset, MAX_UPLOAD_SIZE_BYTES, {".xlsx", ".xls"})
        if not ok:
            errors.append(f"Ruleset: {msg}")
    elif not use_seeded_ruleset:
        errors.append("Ruleset: no file uploaded and the seeded ruleset was not requested.")
    elif not _SEEDED_RULESET.exists():
        errors.append(f"Ruleset: seeded file not found on server ({_SEEDED_RULESET.name}).")

    if fp_db is None and use_seeded_fp_db and not _SEEDED_FP_DB.exists():
        errors.append(f"FP Database: seeded file not found on server ({_SEEDED_FP_DB.name}).")

    if user_role is not None:
        ok, msg = await validate_upload(user_role, MAX_UPLOAD_SIZE_BYTES, ALLOWED_EXTENSIONS)
        if not ok:
            errors.append(f"User Role: {msg}")

    if fp_db is not None:
        ok, msg = await validate_upload(fp_db, MAX_UPLOAD_SIZE_BYTES, {".xlsx", ".xls"})
        if not ok:
            errors.append(f"FP Database: {msg}")

    if procurement_agent is not None:
        ok, msg = await validate_upload(procurement_agent, MAX_UPLOAD_SIZE_BYTES, {".xlsx", ".xls"})
        if not ok:
            errors.append(f"Procurement Agent: {msg}")

    if errors:
        logger.error(f"SOD & SA upload validation failed: {errors}")
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": errors[0], "code": "VALIDATION_ERROR", "details": errors},
        )

    rh_bytes = await role_hierarchy.read()
    ur_bytes = (await user_role.read()) if user_role is not None else None

    # Ruleset / FP Database: an uploaded file wins; otherwise read the seeded file
    # from disk when its flag is set. These bytes flow through the identical
    # validation/load path as an upload from here on.
    if ruleset is not None:
        ruleset_bytes = await ruleset.read()
        ruleset_name = ruleset.filename or "ruleset.xlsx"
    else:
        ruleset_bytes = _SEEDED_RULESET.read_bytes()
        ruleset_name = "ruleset.xlsx"

    if fp_db is not None:
        fp_bytes = await fp_db.read()
        fp_name = fp_db.filename or "fp_db.xlsx"
    elif use_seeded_fp_db:
        fp_bytes = _SEEDED_FP_DB.read_bytes()
        fp_name = "fp_database.xlsx"
    else:
        fp_bytes = None
        fp_name = None

    if procurement_agent is not None:
        pa_bytes = await procurement_agent.read()
        pa_name = procurement_agent.filename or "procurement_agent.xlsx"
    else:
        pa_bytes = None
        pa_name = None

    rh_name = role_hierarchy.filename or "role_hierarchy.xlsx"
    ur_name = (user_role.filename or "user_role.xlsx") if user_role is not None else None

    # ── Step 1: comprehensive upfront schema scan ───────────────────────────────
    # Reports EVERY missing sheet and column across ALL files at once, so the user
    # fixes everything in one pass instead of one-error-at-a-time.
    schema_errors = _validate_all_schemas(
        rh_bytes, rh_name, ruleset_bytes, ruleset_name, ur_bytes, ur_name, fp_bytes, fp_name,
        pa_bytes, pa_name,
        with_3leg=with_3leg,
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
    procurement_df: Optional[pl.DataFrame] = None

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
        ruleset_bytes, ruleset_name, logger, three_leg=with_3leg
    )
    bucket_details_df = bucket_details_df_loaded
    if ruleset_errors:
        all_errors.extend([f"Ruleset ({ruleset_name}): {err}" for err in ruleset_errors])

    # 3-leg mode: validate Condition VALUES (AND/OR) and collect all-OR warnings.
    _3leg_warnings: list[str] = []
    if with_3leg and sod_df is not None:
        _cond_errors, _3leg_warnings = _validate_3leg_conditions(sod_df)
        all_errors.extend(_cond_errors)

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
            no_action_df = load_excel_to_polars(fp_bytes, fp_name or "fp_db.xlsx", "No_action_Privileges", {}, logger)
            work_area_df = load_excel_to_polars(fp_bytes, fp_name or "fp_db.xlsx", "WorkArea_Privileges", {}, logger)
            # Schema validation is case-insensitive but the FP engine joins on the
            # exact upper-case names — normalise headers so e.g. "Work_Area_Privilege"
            # cannot pass validation and then crash mid-run.
            no_action_df = no_action_df.rename({c: c.strip().upper() for c in no_action_df.columns})
            work_area_df = work_area_df.rename({c: c.strip().upper() for c in work_area_df.columns})
            logger.info(f"Loaded FP Database: No_action_Privileges {no_action_df.height} rows, WorkArea_Privileges {work_area_df.height} rows")
        except Exception as exc:
            logger.error(f"Failed to load FP Database: {exc}", exc_info=True)
            all_errors.append(f"FP Database ({fp_name or 'fp_db.xlsx'}): {exc}")

    # Load Procurement Agent file if provided (single sheet; only two columns used)
    if pa_bytes is not None:
        try:
            procurement_df = _load_file(pa_bytes, pa_name or "procurement_agent.xlsx")
            procurement_df = procurement_df.rename({c: c.strip().upper() for c in procurement_df.columns})
            procurement_df = procurement_df.select(["USERNAME", "ACTIVE_FLAG"])
            logger.info(f"Loaded Procurement Agent: {procurement_df.height} rows")
        except Exception as exc:
            logger.error(f"Failed to load Procurement Agent: {exc}", exc_info=True)
            all_errors.append(f"Procurement Agent ({pa_name or 'procurement_agent.xlsx'}): {exc}")

    # Reject files that validated but contain zero data rows — otherwise the run
    # "succeeds" with silently empty results.
    for _df, _label in [
        (rh_df, "Role Hierarchy"),
        (sod_df, "Ruleset -> SoD Ruleset"),
        (sa_df, "Ruleset -> SA Ruleset"),
        (mapping_df, "Ruleset -> Entitlement to Privilege"),
        (ur_df, "User Role"),
        (procurement_df, "Procurement Agent"),
    ]:
        if _df is not None and _df.height == 0:
            all_errors.append(f"{_label}: contains no data rows after loading.")

    # If any errors collected, return them all at once
    if all_errors:
        logger.error(f"SOD & SA upload failed with {len(all_errors)} error(s): {all_errors}")
        _content = {"error": True, "message": f"Found {len(all_errors)} validation error(s). See details below.", "code": "FILE_FORMAT_ERROR", "details": all_errors}
        if with_3leg and _3leg_warnings:
            # Show non-blocking 3-leg warnings alongside the errors so the user
            # fixes the ruleset in one pass. Flag-off responses are unchanged.
            _content["warnings"] = _3leg_warnings
        return JSONResponse(status_code=400, content=_content)

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

    # Data-integrity hard gate: a privilege mapped to BOTH entitlements of the same
    # SoD control makes that control unanalysable (an entity holding only that one
    # privilege would falsely satisfy both legs). Reject the whole upload so the user
    # fixes the mapping before they can reach the Run step. See
    # _check_shared_privileges_in_controls for the full rationale.
    integrity_items = _check_shared_privileges_in_controls(sod_df, mapping_df, three_leg=with_3leg)
    if integrity_items:
        integrity_errors = []
        for it in integrity_items:
            shared_list = ", ".join('"{}"'.format(p) for p in it["privileges"])
            if with_3leg:
                ents_list = ", ".join(it["entitlements"])
                integrity_errors.append(
                    f'Control "{it["control"]}": privilege(s) {shared_list} mapped into every '
                    f'AND-group of its entitlements ({ents_list}). An entity holding only such a '
                    f'privilege would falsely violate this control. Fix the Entitlement-to-Privilege '
                    f'mapping and re-upload.'
                )
            else:
                integrity_errors.append(
                    f'Control "{it["control"]}": privilege(s) {shared_list} mapped to both '
                    f'entitlements ({it["lhs"]}, {it["rhs"]}). An entity holding only such a privilege '
                    f'would falsely violate this control. Fix the Entitlement-to-Privilege '
                    f'mapping and re-upload.'
                )
        logger.error(f"SOD & SA upload rejected — {len(integrity_errors)} shared-privilege issue(s):")
        for _e in integrity_errors:
            logger.error(f"  • {_e}")
        # Also surface the non-blocking warnings (recommended columns, unmapped
        # entitlements) alongside the hard error, so the user can fix the ruleset
        # in one pass instead of discovering warnings only after fixing the error.
        return JSONResponse(
            status_code=400,
            content={
                "error": True,
                "message": (
                    f"Data integrity issue: {len(integrity_errors)} SoD control(s) have a "
                    f"privilege mapped to both entitlements. Fix every item listed below, then re-upload."
                ),
                "code": "DATA_INTEGRITY_ERROR",
                "details": integrity_errors,
                "integrity_items": integrity_items,
                "warnings": _scan_recommended_columns(ruleset_bytes, ruleset_name) + _3leg_warnings,
                "entitlement_warnings": _check_missing_entitlement_mappings(sod_df, sa_df, mapping_df, three_leg=with_3leg),
            },
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
        "procurement_df": procurement_df,
        "bucket_details_df": bucket_details_df,
    })
    has_control_bucket_col, has_bucket_details_sheet = _inspect_observation_inputs(
        ruleset_bytes, ruleset_name
    )
    job_manager.set_config(job.id, {
        "has_user_role": ur_df is not None,
        "has_fp_db": fp_bytes is not None,
        "has_procurement": pa_bytes is not None,
        "has_control_bucket_col": has_control_bucket_col,
        "has_bucket_details_sheet": has_bucket_details_sheet,
        "with_3leg": with_3leg,
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

    # Non-blocking: recommended ruleset columns missing → advise the user to add
    # them for a client-ready export (analysis still proceeds).
    warnings.extend(_scan_recommended_columns(ruleset_bytes, ruleset_name))

    # Non-blocking: 3-leg all-OR rows (any single entitlement flags a violation)
    warnings.extend(_3leg_warnings)

    # Check for missing entitlement mappings
    entitlement_warnings = _check_missing_entitlement_mappings(sod_df, sa_df, mapping_df, three_leg=with_3leg)

    return UploadResponse(
        job_id=job.id,
        files=preview_files,
        status=JobStatus.VALIDATING,
        warnings=warnings,
        entitlement_warnings=entitlement_warnings,
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

    # The 3-leg flag decides how the ruleset was PARSED at upload time, so the
    # run config must agree with what was stored on the job.
    _uploaded_3leg = bool(job.config.get("with_3leg", False))
    if config.with_3leg != _uploaded_3leg:
        logger.warning(f"[{job_id}] with_3leg mismatch: upload={_uploaded_3leg}, run={config.with_3leg}")
        return JSONResponse(
            status_code=400,
            content={
                "error": True,
                "message": (
                    f"3-leg SOD setting mismatch: files were uploaded with the 3-leg option "
                    f"{'ON' if _uploaded_3leg else 'OFF'} but the run requested it "
                    f"{'ON' if config.with_3leg else 'OFF'}. Re-upload with the desired setting."
                ),
                "code": "VALIDATION_ERROR",
                "details": [],
            },
        )

    has_fp_db = job.config.get("has_fp_db", False) and config.with_fp

    # Observation requires both the Control Bucket column (in SoD Ruleset) and the
    # Bucket Details sheet. The engine fills an absent Control Bucket with
    # UNCATEGORIZED, so check the original-upload flags recorded at upload time.
    if config.with_observation:
        _obs_missing: list[str] = []
        if not job.config.get("has_control_bucket_col", False):
            _obs_missing.append("SoD Ruleset -> Missing Column: Control Bucket")
        if not job.config.get("has_bucket_details_sheet", False):
            _obs_missing.append("Ruleset -> Missing Sheet: Bucket Details")
        if _obs_missing:
            return JSONResponse(
                status_code=400,
                content={
                    "error": True,
                    "message": (
                        "Observation level analysis requires the 'Control Bucket' column in the SoD Ruleset "
                        "and a 'Bucket Details' sheet. Add the missing item(s) mentioned below and re-upload, "
                        "or turn off the Observation option."
                    ),
                    "code": "SCHEMA_VALIDATION_ERROR",
                    "details": _obs_missing,
                },
            )

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

    logger.info(f"[{job_id}] Queueing analysis: analysis_type={config.analysis_type}, with_fp={has_fp_db}, selected_analyses={config.selected_analyses}")

    analysis_pool.submit(
        job_id,
        run_sod_sa_job,
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
        job.files.get("bucket_details_df"),
        config.with_3leg,
        job.files.get("procurement_df") if (has_fp_db and job.config.get("has_procurement", False)) else None,
        on_done=make_done_callback(job_id, _result_dfs, logger),
    )

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
                df = df.filter(pl.col(_col).cast(pl.Utf8).is_in(_vals))
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
                df = df.filter(pl.col(_col).cast(pl.Utf8).is_in(_vals))

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
