"""SOD & SA Analysis Engine — ported from SOD Tool/app.py.

Algorithm:
  - create_entitlement_mappings(): join role hierarchy with privilege-to-entitlement map
    via two paths (inherited role codes + direct privileges)
  - check_sod_violations_vectorized(): single join of unpivoted control legs against
    entitlements; an entity violates a control when both LHS and RHS legs match
  - check_sa_violations(): direct join on entitlement name
  - export_results(): xlsxwriter constant_memory mode, auto-split on EXCEL_MAX_ROWS

Pure Polars engine. Pandas only at the Excel I/O boundary.
No FastAPI, no Pydantic, no HTTP.
"""

import io
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import pandas as pd
import polars as pl
import xlsxwriter

# ── Constants (ported verbatim from SOD Tool/app.py) ─────────────────────────

EXCEL_MAX_ROWS   = 1_048_000
EMPTY_PLACEHOLDER = "Not Provided in SOD SA Ruleset"

INPUT_COLUMN_RENAME = {
    "role": {
        "TOP_ROLE_CODE":  "ROLE_NAME",
        "TOP_ROLE_NAME":  "ROLE_DISPLAY_NAME",
        "ROLE_TYPE_CODE": "ROLE_TYPE_CODE",
        "ROLE_CODE":      "INHERITED_ROLE_NAME",
        "ROLE_NAME":      "INHERITED_ROLE_DISPLAY_NAME",
        "PRIVILEGE_CODE": "PRIVILEGE_NAME",
        "PRIVILEGE_NAME": "PRIVILEGE_DISPLAY_NAME",
    },
    "user": {
        "User Name":                  "USER_NAME",
        "Assigned Role Name":         "ROLE_NAME",
        "Assigned Role Display Name": "ROLE_DISPLAY_NAME",
    },
    "sod": {
        "Control Name":    "CONTROL_NAME",
        "Risk Ranking":    "RISK_RANKING",
        "LHS Entitlement": "LHS_ENTITLEMENT",
        "RHS Entitlement": "RHS_ENTITLEMENT",
        "Module(s)":       "MODULES",
        "Risk Description":"RISK_DESCRIPTION",
        "Control Bucket":  "CONTROL_BUCKET",
    },
    "bucket_details": {
        "Bucket Name":       "BUCKET_NAME",
        "Risk":              "RISK",
        "EY Recommendations":"EY_RECOMMENDATIONS",
    },
    "sa": {
        "Control Name":   "CONTROL_NAME",
        "Risk Ranking":   "RISK_RANKING",
        "Entitlement":    "ENTITLEMENT",
        "Side":           "SIDE",
        "Module(s)":      "MODULES",
        "Risk Description":"RISK_DESCRIPTION",
    },
    "mapping": {
        "Entitlement Name": "ENTITLEMENT_NAME",
        "Privilege Name":   "PRIVILEGE_DISPLAY_NAME",
        "Privilege Code":   "PRIVILEGE_NAME",
    },
}

RENAMED_TO_ORIGINAL = {
    kind: {v: k for k, v in mapping.items()}
    for kind, mapping in INPUT_COLUMN_RENAME.items()
}

REQUIRED_COLUMNS = {
    "role": {
        "ROLE_NAME", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_DISPLAY_NAME",
        "INHERITED_ROLE_NAME", "PRIVILEGE_DISPLAY_NAME", "PRIVILEGE_NAME",
    },
    "user": {"USER_NAME", "ROLE_NAME"},
    "sod":  {
        "CONTROL_NAME", "LHS_ENTITLEMENT", "RHS_ENTITLEMENT",
    },
    "sa":   {
        "CONTROL_NAME", "ENTITLEMENT",
    },
    "mapping": {"PRIVILEGE_NAME", "ENTITLEMENT_NAME"},
}

CRITICAL_COLUMNS = {
    "sod":     {"CONTROL_NAME", "LHS_ENTITLEMENT", "RHS_ENTITLEMENT"},
    "sa":      {"CONTROL_NAME", "ENTITLEMENT"},
    "mapping": {"ENTITLEMENT_NAME", "PRIVILEGE_NAME"},
}

SUPPLEMENTARY_COLUMNS = {
    "sod":     {"RISK_RANKING", "MODULES", "RISK_DESCRIPTION"},
    "sa":      {"RISK_RANKING", "MODULES", "RISK_DESCRIPTION"},
    "mapping": set(),
}

# Columns required in the Bucket Details sheet
BUCKET_DETAILS_REQUIRED_COLS = {"BUCKET_NAME", "RISK", "EY_RECOMMENDATIONS"}

# Exact column order for the four exported violation tabs (Step 6 strict schema).
# Any missing column is added blank; columns outside this list are dropped.
ROLE_OUTPUT_COLUMNS = [
    "CONTROL_NAME", "ENTITLEMENT", "SIDE", "RISK_RANKING", "MODULES",
    "ROLE_NAME", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_NAME", "INHERITED_ROLE_DISPLAY_NAME",
    "PRIVILEGE_NAME", "PRIVILEGE_DISPLAY_NAME", "Potential FP", "Reason",
]
USER_OUTPUT_COLUMNS = [
    "CONTROL_NAME", "ENTITLEMENT", "SIDE", "RISK_RANKING", "MODULES",
    "GROUP_NAME", "USER_NAME",
    "ROLE_NAME", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_NAME", "INHERITED_ROLE_DISPLAY_NAME",
    "PRIVILEGE_NAME", "PRIVILEGE_DISPLAY_NAME", "Potential FP", "Reason",
]

# SOD-only output columns when Observation tab is requested (adds CONTROL_BUCKET after CONTROL_NAME)
ROLE_SOD_OUTPUT_COLUMNS_WITH_BUCKET = [
    "CONTROL_NAME", "CONTROL_BUCKET", "ENTITLEMENT", "SIDE", "RISK_RANKING", "MODULES",
    "ROLE_NAME", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_NAME", "INHERITED_ROLE_DISPLAY_NAME",
    "PRIVILEGE_NAME", "PRIVILEGE_DISPLAY_NAME", "Potential FP", "Reason",
]
USER_SOD_OUTPUT_COLUMNS_WITH_BUCKET = [
    "CONTROL_NAME", "CONTROL_BUCKET", "ENTITLEMENT", "SIDE", "RISK_RANKING", "MODULES",
    "GROUP_NAME", "USER_NAME",
    "ROLE_NAME", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_NAME", "INHERITED_ROLE_DISPLAY_NAME",
    "PRIVILEGE_NAME", "PRIVILEGE_DISPLAY_NAME", "Potential FP", "Reason",
]


def reorder_to_output_schema(df: pl.DataFrame, schema: list[str]) -> pl.DataFrame:
    """Return df with exactly the `schema` columns, in order.

    Missing columns are filled with empty strings; extra columns are dropped.
    Pure column projection — does not alter any row values.
    """
    if df.is_empty():
        return df
    missing = [c for c in schema if c not in df.columns]
    if missing:
        df = df.with_columns([pl.lit("").alias(c) for c in missing])
    return df.select(schema)


# ── Result type ───────────────────────────────────────────────────────────────

@dataclass
class EngineResult:
    """Structured return type for all engine functions."""
    success: bool
    data: Any = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ── Internal helpers ──────────────────────────────────────────────────────────

def upper_values(df: pl.DataFrame) -> pl.DataFrame:
    """Cast all columns to string, strip whitespace, uppercase values."""
    return df.with_columns([
        pl.col(c).cast(pl.Utf8).str.strip_chars().str.to_uppercase()
        for c in df.columns
    ])


def apply_rename(df: pl.DataFrame, rename_map: dict[str, str]) -> pl.DataFrame:
    """Case-insensitive column rename. Keys in rename_map are matched case-insensitively."""
    norm_map = {k.strip().upper(): v for k, v in rename_map.items()}
    actual = {c: norm_map[c.strip().upper()] for c in df.columns if c.strip().upper() in norm_map}
    return df.rename(actual) if actual else df


def _write_sheet_batch(
    ws: xlsxwriter.workbook.Worksheet,
    df: pl.DataFrame,
    logger: Any = None,
    sheet_label: str = "",
    log_every: int = 500_000,
) -> None:
    """Write headers + rows from a Polars DataFrame into an xlsxwriter worksheet.

    Logs a heartbeat every `log_every` rows so that a stall while writing a very
    large sheet (millions of rows) is visible in the logs and we can see exactly
    where it stops.
    """
    for ci, col in enumerate(df.columns):
        ws.write(0, ci, col)
    total = df.height
    for ri, row in enumerate(df.iter_rows(), start=1):
        ws.write_row(ri, 0, list(row))
        if logger is not None and ri % log_every == 0:
            logger.info("    … writing '%s': %d/%d rows", sheet_label, ri, total)


# ── Ruleset file loading ──────────────────────────────────────────────────────

def load_ruleset_sheets(
    file_bytes: bytes,
    filename: str,
    logger: Any = None,
) -> tuple[pl.DataFrame | None, pl.DataFrame | None, pl.DataFrame | None, pl.DataFrame, list[str]]:
    """Load SoD Ruleset, SA Ruleset, Entitlement to Privilege, and optional Bucket Details sheets.

    Applies INPUT_COLUMN_RENAME for each sheet, normalises values (uppercase/strip),
    validates required columns, validates critical columns, fills supplementary columns.
    CONTROL_BUCKET blanks in sod_df are filled with "Uncategorized".

    Returns (sod_df, sa_df, mapping_df, bucket_details_df, errors).
    Any None in the first three signals failure; bucket_details_df is always a DataFrame
    (empty if the sheet is absent).
    """
    _log = logger or logging.getLogger(__name__)
    errors: list[str] = []

    try:
        required_sheets = {"SoD Ruleset", "SA Ruleset", "Entitlement to Privilege"}
        xls = pd.ExcelFile(io.BytesIO(file_bytes), engine="openpyxl")
        missing_sheets = required_sheets - set(xls.sheet_names)
        if missing_sheets:
            return None, None, None, pl.DataFrame(), [
                f"Ruleset is missing required sheets: {missing_sheets}. "
                f"Found: {xls.sheet_names}"
            ]

        def _load(sheet_name: str, rename_key: str) -> pl.DataFrame:
            # Reuse the already-open ExcelFile — re-reading the BytesIO would
            # re-parse the entire workbook once per sheet.
            df_pd = pd.read_excel(
                xls,
                sheet_name=sheet_name,
                dtype=str,
                keep_default_na=False,
            )
            df = pl.from_pandas(df_pd)
            df = upper_values(df)
            df = apply_rename(df, INPUT_COLUMN_RENAME[rename_key])
            return df.unique()

        sod_df     = _load("SoD Ruleset",            "sod")
        sa_df      = _load("SA Ruleset",             "sa")
        mapping_df = _load("Entitlement to Privilege", "mapping")

        # Required column validation
        for df, kind, label in [
            (sod_df,     "sod",     "SoD Ruleset"),
            (sa_df,      "sa",      "SA Ruleset"),
            (mapping_df, "mapping", "Entitlement to Privilege"),
        ]:
            missing_cols = REQUIRED_COLUMNS[kind] - set(df.columns)
            if missing_cols:
                errors.append(f"'{label}' missing required columns: {missing_cols}")

        if errors:
            return None, None, None, pl.DataFrame(), errors

        # Critical column (non-empty) validation
        ok, crit_errors = validate_critical_columns(sod_df, sa_df, mapping_df)
        if not ok:
            errs: list[str] = []
            for sheet_name, msgs in crit_errors.items():
                errs.append(f"{sheet_name}: " + "; ".join(msgs))
            return None, None, None, pl.DataFrame(), errs

        # Fill empty supplementary columns with placeholder
        sod_df     = _fill_supplementary(sod_df,     "sod")
        sa_df      = _fill_supplementary(sa_df,      "sa")
        mapping_df = _fill_supplementary(mapping_df, "mapping")

        # CONTROL_BUCKET: optional column; blank/absent → "Uncategorized"
        if "CONTROL_BUCKET" not in sod_df.columns:
            sod_df = sod_df.with_columns(pl.lit("UNCATEGORIZED").alias("CONTROL_BUCKET"))
        else:
            sod_df = sod_df.with_columns(
                pl.when(
                    pl.col("CONTROL_BUCKET").is_null()
                    | (pl.col("CONTROL_BUCKET").str.strip_chars() == "")
                )
                .then(pl.lit("UNCATEGORIZED"))
                .otherwise(pl.col("CONTROL_BUCKET"))
                .alias("CONTROL_BUCKET")
            )

        # Load Bucket Details sheet (optional)
        bucket_details_df = pl.DataFrame()
        norm_sheets = {s.strip().upper(): s for s in xls.sheet_names}
        if "BUCKET DETAILS" in norm_sheets:
            bd_pd = pd.read_excel(
                xls,
                sheet_name=norm_sheets["BUCKET DETAILS"],
                dtype=str,
                keep_default_na=False,
            )
            bd = pl.from_pandas(bd_pd)
            bd = upper_values(bd)
            bd = apply_rename(bd, INPUT_COLUMN_RENAME["bucket_details"])
            missing_bd_cols = BUCKET_DETAILS_REQUIRED_COLS - set(bd.columns)
            if not missing_bd_cols:
                bucket_details_df = bd.filter(
                    pl.col("BUCKET_NAME").is_not_null()
                    & (pl.col("BUCKET_NAME").str.strip_chars() != "")
                )

        _log.info(
            "Ruleset loaded: sod=%d sa=%d mapping=%d bucket_details=%d",
            sod_df.height, sa_df.height, mapping_df.height, bucket_details_df.height,
        )
        return sod_df, sa_df, mapping_df, bucket_details_df, []

    except Exception as exc:
        _log.error("Ruleset loading error: %s", exc, exc_info=True)
        return None, None, None, pl.DataFrame(), [f"Ruleset error in '{filename}': {exc}"]


# ── Validation ────────────────────────────────────────────────────────────────

def validate_critical_columns(
    sod_df: pl.DataFrame,
    sa_df: pl.DataFrame,
    mapping_df: pl.DataFrame,
) -> tuple[bool, dict[str, list[str]]]:
    """Check that critical columns contain no empty or null values.

    Returns (is_valid, {sheet_label: [error_messages]}).
    Ported verbatim from SOD Tool/app.py.
    """
    validation_errors: dict[str, list[str]] = {}

    for df, kind, label in [
        (sod_df,     "sod",     "SoD Ruleset"),
        (sa_df,      "sa",      "SA Ruleset"),
        (mapping_df, "mapping", "Entitlement to Privilege"),
    ]:
        sheet_errors: list[str] = []
        for col in CRITICAL_COLUMNS[kind]:
            if col not in df.columns:
                continue
            empty_count = df.filter(
                pl.col(col).is_null()
                | (pl.col(col).cast(pl.Utf8).str.strip_chars() == "")
            ).height
            if empty_count > 0:
                original = RENAMED_TO_ORIGINAL[kind].get(col, col)
                sheet_errors.append(f"{original}: {empty_count} empty cell(s)")

        if sheet_errors:
            validation_errors[label] = sheet_errors

    return len(validation_errors) == 0, validation_errors


def _fill_supplementary(df: pl.DataFrame, sheet_type: str) -> pl.DataFrame:
    """Fill empty/null supplementary column cells with EMPTY_PLACEHOLDER.

    Supplementary columns are optional in the uploaded ruleset; when absent they
    are added with EMPTY_PLACEHOLDER so the rest of the pipeline can rely on them.
    """
    for col in SUPPLEMENTARY_COLUMNS.get(sheet_type, set()):
        if col not in df.columns:
            df = df.with_columns(pl.lit(EMPTY_PLACEHOLDER).alias(col))
            continue
        # Cast to String first to handle Null-typed columns (all-null columns)
        df = df.with_columns(pl.col(col).cast(pl.Utf8).alias(col))
        df = df.with_columns(
            pl.when(pl.col(col).is_null() | (pl.col(col).str.strip_chars() == ""))
              .then(pl.lit(EMPTY_PLACEHOLDER))
              .otherwise(pl.col(col))
              .alias(col)
        )
    return df


# ── Core analysis logic ───────────────────────────────────────────────────────

def create_entitlement_mappings(
    role_hierarchy_data: pl.DataFrame,
    entitlement_privilege_map: pl.DataFrame,
) -> pl.DataFrame | None:
    """Join role hierarchy with privilege-to-entitlement mapping via two paths.

    Path 1: Map through inherited role codes (INHERITED_ROLE_NAME as pivot).
    Path 2: Map through direct privileges (PRIVILEGE_NAME as pivot).
    Ported verbatim from SOD Tool/app.py.
    """
    # Path 1: inherited role codes
    role_code_mapping = role_hierarchy_data.select([
        "ROLE_NAME",
        "ROLE_DISPLAY_NAME",
        pl.col("INHERITED_ROLE_NAME").alias("CODE_OR_PRIVILEGE"),
        "INHERITED_ROLE_DISPLAY_NAME",
        "INHERITED_ROLE_NAME",
        pl.lit("").alias("PRIVILEGE_DISPLAY_NAME"),
        pl.lit("").alias("PRIVILEGE_NAME"),
    ]).filter(pl.col("CODE_OR_PRIVILEGE").str.strip_chars() != "")

    # Path 2: direct privileges
    privilege_code_mapping = role_hierarchy_data.select([
        "ROLE_NAME",
        "ROLE_DISPLAY_NAME",
        pl.col("PRIVILEGE_NAME").alias("CODE_OR_PRIVILEGE"),
        "INHERITED_ROLE_DISPLAY_NAME",
        "INHERITED_ROLE_NAME",
        "PRIVILEGE_DISPLAY_NAME",
        "PRIVILEGE_NAME",
    ]).filter(pl.col("CODE_OR_PRIVILEGE").str.strip_chars() != "")

    combined_mappings = pl.concat([role_code_mapping, privilege_code_mapping]).unique()

    entitlements_result = combined_mappings.join(
        entitlement_privilege_map.select(["PRIVILEGE_NAME", "ENTITLEMENT_NAME"]),
        left_on="CODE_OR_PRIVILEGE",
        right_on="PRIVILEGE_NAME",
        how="inner",
    )

    if entitlements_result.height > 0:
        return entitlements_result
    return None


def check_sod_violations_vectorized(
    entitlements_data: pl.DataFrame,
    sod_controls: pl.DataFrame,
    entity_column: str | None = None,
) -> pl.DataFrame:
    """Set-based SOD violation detection: A ∩ B = violators.

    Vectorised: each control row is unpivoted into an LHS and an RHS leg, all
    legs are joined against the entitlements in a single pass, and only
    (control row, entity) pairs where BOTH legs matched are kept. The per-row
    control ID preserves the original per-control-row semantics when the same
    control name appears on multiple ruleset rows.
    """
    entity_key = entity_column or "ROLE_NAME"

    entitlements_with_entity = entitlements_data.with_columns(
        pl.col(entity_key).alias("ENTITY_VALUE")
    )

    controls = sod_controls.with_row_index("_ctrl_id")
    _ctrl_extra = ["CONTROL_BUCKET"] if "CONTROL_BUCKET" in controls.columns else []
    legs = pl.concat([
        controls.select([
            "_ctrl_id", "CONTROL_NAME", "RISK_RANKING", "MODULES",
            *_ctrl_extra,
            pl.col("LHS_ENTITLEMENT").alias("ENTITLEMENT_NAME"),
            pl.lit("LHS").alias("SIDE"),
        ]),
        controls.select([
            "_ctrl_id", "CONTROL_NAME", "RISK_RANKING", "MODULES",
            *_ctrl_extra,
            pl.col("RHS_ENTITLEMENT").alias("ENTITLEMENT_NAME"),
            pl.lit("RHS").alias("SIDE"),
        ]),
    ])

    matched = entitlements_with_entity.join(legs, on="ENTITLEMENT_NAME", how="inner")
    if matched.is_empty():
        return pl.DataFrame()

    # Keep only (control row, entity) pairs where both LHS and RHS matched
    both_sides = (
        matched
        .group_by(["_ctrl_id", "ENTITY_VALUE"])
        .agg(pl.col("SIDE").n_unique().alias("_n_sides"))
        .filter(pl.col("_n_sides") == 2)
        .select(["_ctrl_id", "ENTITY_VALUE"])
    )
    matched = matched.join(both_sides, on=["_ctrl_id", "ENTITY_VALUE"], how="semi")
    if matched.is_empty():
        return pl.DataFrame()

    _viol_extra = ["CONTROL_BUCKET"] if "CONTROL_BUCKET" in matched.columns else []
    final_violations = matched.select([
        "CONTROL_NAME", "RISK_RANKING", "MODULES",
        *_viol_extra,
        "ENTITY_VALUE",
        pl.col("ENTITLEMENT_NAME").alias("ENTITLEMENT"),
        "SIDE",
        "ROLE_NAME", "ROLE_DISPLAY_NAME",
        "INHERITED_ROLE_NAME", "INHERITED_ROLE_DISPLAY_NAME",
        "PRIVILEGE_NAME", "PRIVILEGE_DISPLAY_NAME",
    ]).unique()

    if entity_column:
        final_violations = final_violations.rename({"ENTITY_VALUE": entity_column})
    else:
        final_violations = final_violations.drop("ENTITY_VALUE")

    return final_violations


def check_sa_violations(
    entitlements_data: pl.DataFrame,
    sa_controls: pl.DataFrame,
    entity_column: str | None = None,
) -> pl.DataFrame:
    """SA violation detection: direct join on ENTITLEMENT_NAME == ENTITLEMENT.

    Ported verbatim from SOD Tool/app.py.
    """
    entity_key = entity_column or "ROLE_NAME"

    violations_result = entitlements_data.join(
        sa_controls,
        left_on="ENTITLEMENT_NAME",
        right_on="ENTITLEMENT",
        how="inner",
    )

    if violations_result.height == 0:
        return pl.DataFrame()

    output_columns: list[Any] = ["CONTROL_NAME", "RISK_RANKING", "MODULES"]

    if entity_column:
        output_columns.append(entity_column)

    output_columns.extend([
        "ENTITLEMENT_NAME", "ROLE_NAME", "ROLE_DISPLAY_NAME",
        "INHERITED_ROLE_DISPLAY_NAME", "INHERITED_ROLE_NAME",
        "PRIVILEGE_DISPLAY_NAME", "PRIVILEGE_NAME",
    ])

    return (
        violations_result
        .select(output_columns)
        .rename({"ENTITLEMENT_NAME": "ENTITLEMENT"})
        .with_columns(pl.lit("LHS").alias("SIDE"))
        .unique()
    )


# ── False Positive (FP) classification engine ─────────────────────────────────

def _set_fp_where_pending(df: pl.DataFrame, tag: str) -> pl.DataFrame:
    """Apply an FP classification carried in a `_reason` column.

    Rows where `_reason` is non-null and FP? is still unset get FP?=tag and the
    reason text; rows already classified by an earlier level are untouched.
    Drops the `_reason` column.
    """
    return df.with_columns([
        pl.when(
            pl.col("_reason").is_not_null() & (pl.col("Potential FP") == "")
        ).then(pl.lit(tag)).otherwise(pl.col("Potential FP")).alias("Potential FP"),
        pl.when(
            pl.col("_reason").is_not_null() & (pl.col("Reason") == "")
        ).then(pl.col("_reason")).otherwise(pl.col("Reason")).alias("Reason"),
    ]).drop("_reason")


def _fp_level1(
    df: pl.DataFrame,
    no_action_df: pl.DataFrame,
) -> pl.DataFrame:
    """Level 1: Mark privileges in No_action_Privileges sheet as FP=YES.

    Joins on PRIVILEGE_NAME; preserves existing FP?/Reason for already-classified rows.
    """
    if no_action_df.is_empty():
        return df

    joined = df.join(
        no_action_df.select([
            "PRIVILEGE_NAME",
            pl.col("FALSE POSITIVE REASON").alias("_reason"),
        ]).unique(subset=["PRIVILEGE_NAME"], keep="first"),
        on="PRIVILEGE_NAME",
        how="left",
    )

    return _set_fp_where_pending(joined, "FP")


def _fp_level2(
    df: pl.DataFrame,
    work_area_df: pl.DataFrame,
    role_hierarchy_df: pl.DataFrame,
    entity_col: str,
    user_role_df: pl.DataFrame | None = None,
) -> pl.DataFrame:
    """Level 2: Work Area gatekeeper privilege check.

    For users (entity_col == "USER_NAME"): checks if ANY assigned role grants the WA privilege.
    For roles: checks only the specific role in the violation.
    Marks as FP=YES if privilege is NOT granted.
    """
    if work_area_df.is_empty():
        return df

    wa_valid = work_area_df.filter(
        pl.col("WORK_AREA_PRIVILEGE_CODE").is_not_null()
        & (pl.col("WORK_AREA_PRIVILEGE_CODE") != "")
        & (~pl.col("WORK_AREA_PRIVILEGE_CODE").is_in(["NAN", "NONE"]))
    )

    if wa_valid.is_empty():
        return df

    pending = df.filter(pl.col("Potential FP") == "")
    if pending.is_empty():
        return df

    # Merge pending rows with work area rules
    wa_merged = pending.join(
        wa_valid.select(["PRIVILEGE_NAME", "WORK_AREA_PRIVILEGE_CODE"]),
        on="PRIVILEGE_NAME",
        how="inner",
    )

    if wa_merged.is_empty():
        return df

    # Build access lookup: role → privilege code
    role_gk = role_hierarchy_df.select(["ROLE_NAME", "PRIVILEGE_NAME"]).unique()

    # Determine how to check for WA privilege satisfaction
    if entity_col == "USER_NAME" and user_role_df is not None:
        # User-level: check across ALL assigned roles
        access_master = user_role_df.join(
            role_gk,
            on="ROLE_NAME",
            how="inner",
        ).select(["USER_NAME", "PRIVILEGE_NAME"]).unique()
        join_keys = ["USER_NAME", "WORK_AREA_PRIVILEGE_CODE"]
        right_keys = ["USER_NAME", "PRIVILEGE_NAME"]
    else:
        # Role-level: check only the specific role
        access_master = role_gk
        join_keys = ["ROLE_NAME", "WORK_AREA_PRIVILEGE_CODE"]
        right_keys = ["ROLE_NAME", "PRIVILEGE_NAME"]

    # Find rows where WA privilege IS satisfied (inner join succeeds).
    # Keep WORK_AREA_PRIVILEGE_CODE so the TC reason names codes the entity ACTUALLY holds.
    satisfied_codes = wa_merged.join(
        access_master,
        left_on=join_keys,
        right_on=right_keys,
        how="inner",
    ).select(["_row_nr", "WORK_AREA_PRIVILEGE_CODE"]).unique()
    satisfied = satisfied_codes.select("_row_nr").unique()

    # FP candidates: rows in wa_merged but NOT in satisfied
    fp_ids = wa_merged.select("_row_nr").unique().join(
        satisfied,
        on="_row_nr",
        how="anti",
    )

    # Annotate satisfied rows with the held WA code(s) for the TC reason in level 3.
    # Aggregate over the held codes only (not the full FP-DB mapping) and list them all.
    if not satisfied_codes.is_empty():
        wa_code_map = satisfied_codes.group_by("_row_nr").agg(
            pl.col("WORK_AREA_PRIVILEGE_CODE").unique().sort().str.join(", ").alias("_wa_code")
        )
        df = df.join(wa_code_map, on="_row_nr", how="left")

    if fp_ids.is_empty():
        return df

    # Build FP reasons
    target_noun = "User" if entity_col == "USER_NAME" else "Role"
    fp_reasons = wa_merged.join(fp_ids, on="_row_nr", how="inner").group_by("_row_nr").agg(
        pl.col("WORK_AREA_PRIVILEGE_CODE").unique().sort().alias("_wa_list")
    ).with_columns(
        (pl.lit(f"False Positive - {target_noun} lacks required work-area privilege(s) to perform this activity: ") + pl.col("_wa_list").list.join(", ")).alias("_reason")
    ).drop("_wa_list")

    return _set_fp_where_pending(df.join(fp_reasons, on="_row_nr", how="left"), "FP")


def _fp_level3(
    df: pl.DataFrame,
    entity_col: str,
    is_sod: bool,
) -> pl.DataFrame:
    """Level 3: SL (Single Leg) vs True Conflict classification.

    For SOD: count unique entitlements per (CONTROL_NAME, entity_col).
      1 entitlement → SL, ≥2 → True Conflict.
    For SA: all remaining rows → True Conflict.
    """
    pending = df.filter(pl.col("Potential FP") == "")
    if pending.is_empty():
        return df

    noun = "user" if entity_col == "USER_NAME" else "role"

    if is_sod:
        # Count entitlements per control & entity
        pending_counted = pending.with_columns(
            pl.col("ENTITLEMENT").n_unique().over(["CONTROL_NAME", entity_col]).alias("_ent_count")
        )

        sl_ids = pending_counted.filter(pl.col("_ent_count") == 1).select("_row_nr")
        tc_ids = pending_counted.filter(pl.col("_ent_count") >= 2).select("_row_nr")

        sl_reasons = pending_counted.join(sl_ids, on="_row_nr", how="inner").select([
            "_row_nr",
            (pl.lit("Single Leg - Only one entitlement remains after identifying the false positive for '") + pl.col(entity_col) + pl.lit("'")).alias("_reason"),
        ])

        tc_rows = pending_counted.join(tc_ids, on="_row_nr", how="inner")
        if "_wa_code" in tc_rows.columns:
            tc_reasons = tc_rows.select([
                "_row_nr",
                pl.when(pl.col("_wa_code").is_not_null())
                  .then(pl.lit(f"True Conflict - The {noun} has ") + pl.col("_wa_code") + pl.lit(" work area privilege to perform this activity."))
                  .otherwise(pl.lit("True Conflict — Both entitlements required by the control are present."))
                  .alias("_reason"),
            ])
        else:
            tc_reasons = tc_rows.select([
                "_row_nr",
                pl.lit("True Conflict — Both entitlements required by the control are present.").alias("_reason"),
            ])

        # Apply SL, then TC
        df = _set_fp_where_pending(df.join(sl_reasons, on="_row_nr", how="left"), "SL")
        return _set_fp_where_pending(df.join(tc_reasons, on="_row_nr", how="left"), "TC")
    else:
        # SA: all pending rows are True Conflict
        if "_wa_code" in pending.columns:
            tc_reasons = pending.select(["_row_nr", "_wa_code"]).with_columns(
                pl.when(pl.col("_wa_code").is_not_null())
                  .then(pl.lit(f"True Conflict - The {noun} has ") + pl.col("_wa_code") + pl.lit(" work area privilege to perform this activity."))
                  .otherwise(pl.lit("True Conflict — Both entitlements required by the control are present."))
                  .alias("_reason")
            ).drop("_wa_code")
        else:
            tc_reasons = pending.select("_row_nr").with_columns(
                pl.lit("True Conflict — Both entitlements required by the control are present.").alias("_reason")
            )
        return _set_fp_where_pending(df.join(tc_reasons, on="_row_nr", how="left"), "TC")


def run_fp_pipeline(
    df: pl.DataFrame,
    no_action_df: pl.DataFrame,
    work_area_df: pl.DataFrame,
    role_hierarchy_df: pl.DataFrame,
    entity_col: str,
    is_sod: bool,
    user_role_df: pl.DataFrame | None = None,
) -> pl.DataFrame:
    """Run all 3 FP levels sequentially.

    Adds _row_nr index for tracking, applies levels 1→2→3, drops index.
    Returns DataFrame with FP? and Reason columns added.
    """
    df = df.with_row_index("_row_nr").with_columns([
        pl.lit("").alias("Potential FP"),
        pl.lit("").alias("Reason"),
    ])
    # Candidate FP-DB match keys per row: privilege and/or inherited role,
    # dropping empties and the empty-cell placeholder. A row may have one or both.
    df = df.with_columns(
        pl.concat_list(["PRIVILEGE_NAME", "INHERITED_ROLE_NAME"])
          .list.eval(
              pl.element().filter(
                  pl.element().is_not_null()
                  & (pl.element().str.strip_chars() != "")
                  & (pl.element() != EMPTY_PLACEHOLDER)
              )
          )
          .alias("_fp_keys")
    )
    df = _fp_level1(df, no_action_df)
    df = _fp_level2(df, work_area_df, role_hierarchy_df, entity_col, user_role_df)
    df = _fp_level3(df, entity_col, is_sod)
    cols_to_drop = [c for c in ["_row_nr", "_wa_code", "_fp_keys"] if c in df.columns]
    return df.drop(cols_to_drop)


# ── User grouping engine (post-analysis review efficiency) ──────────────────

def _generate_user_groups(
    user_role_df_filtered: pl.DataFrame,
    group_prefix: str = "Group",
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Group users by identical role combinations.

    Returns (user_to_group_map, group_export).
    user_to_group_map: [USER_NAME, GROUP_NAME]
    group_export: [GROUP_NAME, ROLE_NAME, NO_OF_USERS_IN_GROUP]
    """
    if user_role_df_filtered.is_empty():
        return pl.DataFrame(), pl.DataFrame()

    # Aggregate roles per user (sorted, deduplicated)
    user_roles_agg = user_role_df_filtered.group_by("USER_NAME").agg(
        pl.col("ROLE_NAME").unique().sort().alias("roles_list")
    )

    # Get unique role combinations
    unique_groups = user_roles_agg.select("roles_list").unique()
    unique_groups = unique_groups.with_columns(
        pl.col("roles_list").list.join(",").alias("sort_key")
    ).sort("sort_key").with_row_index(name="group_idx")

    unique_groups = unique_groups.with_columns(
        pl.format("{}_{}", pl.lit(group_prefix), pl.col("group_idx") + 1).alias("GROUP_NAME")
    ).drop(["group_idx", "sort_key"])

    # Map users to groups
    user_to_group_map = user_roles_agg.join(unique_groups, on="roles_list", how="inner")

    # Explode roles for group mapping export
    group_roles_exploded = unique_groups.explode("roles_list").rename({"roles_list": "ROLE_NAME"})

    # Count users per group
    group_user_counts = user_to_group_map.group_by("GROUP_NAME").agg(
        pl.col("USER_NAME").count().alias("NO_OF_USERS_IN_GROUP")
    )

    # Final export: GROUP_NAME, ROLE_NAME, NO_OF_USERS_IN_GROUP
    group_mapping_export = group_roles_exploded.join(
        group_user_counts,
        on="GROUP_NAME",
        how="left",
    ).select(["GROUP_NAME", "ROLE_NAME", "NO_OF_USERS_IN_GROUP"])

    return user_to_group_map.select(["USER_NAME", "GROUP_NAME"]), group_mapping_export


def compute_user_groups(
    user_role_df: pl.DataFrame,
    prefix: str = "Group",
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Compute user groups from the full user-role membership file (all users, not just violators).

    Returns (user_to_group_map, group_mapping_export):
    - user_to_group_map: USER_NAME → GROUP_NAME (join key for violation DFs)
    - group_mapping_export: GROUP_NAME, ROLE_NAME, NO_OF_USERS_IN_GROUP (the sheet written to Excel)
    """
    if user_role_df is None or user_role_df.is_empty():
        return pl.DataFrame(), pl.DataFrame()
    return _generate_user_groups(user_role_df, prefix)


def apply_grouping_to_violations(
    user_violations_df: pl.DataFrame,
    full_user_role_df: pl.DataFrame,
    prefix: str = "Group",
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Apply user grouping to violation DataFrame.

    Filters full_user_role_df to only violating users, generates groups,
    joins GROUP_NAME and NO_OF_USERS_IN_GROUP back onto violations.
    Returns (augmented_violations, group_mapping_export).
    """
    if user_violations_df.is_empty():
        return pl.DataFrame(), pl.DataFrame()

    violating_users = user_violations_df.select("USER_NAME").unique()
    violating_user_roles = full_user_role_df.join(
        violating_users,
        on="USER_NAME",
        how="inner",
    )

    user_to_group_map, group_export = _generate_user_groups(violating_user_roles, prefix)
    if user_to_group_map.is_empty():
        return user_violations_df, pl.DataFrame()

    group_counts = group_export.select(["GROUP_NAME", "NO_OF_USERS_IN_GROUP"]).unique()
    map_with_counts = user_to_group_map.join(group_counts, on="GROUP_NAME", how="left")
    grouped_violations = user_violations_df.join(map_with_counts, on="USER_NAME", how="left")

    # Reorder columns: GROUP_NAME and NO_OF_USERS_IN_GROUP after first 3 columns, USER_NAME at end
    cols = list(grouped_violations.columns)
    if "GROUP_NAME" in cols:
        cols.remove("GROUP_NAME")
    if "NO_OF_USERS_IN_GROUP" in cols:
        cols.remove("NO_OF_USERS_IN_GROUP")
    if "USER_NAME" in cols:
        cols.remove("USER_NAME")

    insert_idx = min(3, len(cols))
    cols.insert(insert_idx, "GROUP_NAME")
    cols.insert(insert_idx + 1, "NO_OF_USERS_IN_GROUP")
    cols.append("USER_NAME")

    return grouped_violations.select(cols), group_export


# ── Analysis orchestrators ────────────────────────────────────────────────────

def analyze_roles(
    role_hierarchy_df: pl.DataFrame,
    sod_controls_df: pl.DataFrame,
    sa_controls_df: pl.DataFrame,
    entitlement_mapping_df: pl.DataFrame,
    logger: Any = None,
    progress_callback: Callable[[int, str], None] | None = None,
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Analyse roles for SOD and SA violations.

    Returns (role_sod_violations, role_sa_violations).
    Ported verbatim from SOD Tool/app.py.
    """
    _log = logger or logging.getLogger(__name__)

    def _cb(pct: int, msg: str) -> None:
        if progress_callback:
            progress_callback(pct, msg)

    _cb(5, "Building role entitlement mappings…")
    all_entitlements = create_entitlement_mappings(role_hierarchy_df, entitlement_mapping_df)

    if all_entitlements is None or all_entitlements.height == 0:
        _log.warning("No entitlement mappings created for roles")
        return pl.DataFrame(), pl.DataFrame()

    _cb(30, f"Checking SOD violations across {sod_controls_df.height:,} controls…")
    role_sod = check_sod_violations_vectorized(all_entitlements, sod_controls_df)

    _cb(65, f"Checking SA violations across {sa_controls_df.height:,} controls…")
    role_sa = check_sa_violations(all_entitlements, sa_controls_df)

    _log.info("Role analysis: SOD=%d SA=%d", role_sod.height, role_sa.height)
    _cb(95, "Role analysis complete.")
    return role_sod, role_sa


def analyze_users(
    role_hierarchy_df: pl.DataFrame,
    user_role_df: pl.DataFrame,
    sod_controls_df: pl.DataFrame,
    sa_controls_df: pl.DataFrame,
    entitlement_mapping_df: pl.DataFrame,
    logger: Any = None,
    progress_callback: Callable[[int, str], None] | None = None,
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Analyse users for SOD and SA violations.

    SOD detection is fully vectorised (single leg-join pass), so no user
    chunking is needed; SA detection is a single join.
    Returns (user_sod_violations, user_sa_violations).
    """
    _log = logger or logging.getLogger(__name__)

    def _cb(pct: int, msg: str) -> None:
        if progress_callback:
            progress_callback(pct, msg)

    _cb(5, "Expanding user-role memberships…")
    user_role_expanded = user_role_df.join(role_hierarchy_df, on="ROLE_NAME", how="inner")

    if user_role_expanded.height == 0:
        _log.warning("No user-role expansions found")
        return pl.DataFrame(), pl.DataFrame()

    num_users = user_role_expanded.select("USER_NAME").unique().height
    _log.info("User analysis: %d users", num_users)

    _cb(10, "Building user entitlement mappings…")
    all_user_entitlements = create_entitlement_mappings(user_role_expanded, entitlement_mapping_df)

    if all_user_entitlements is None or all_user_entitlements.height == 0:
        _log.warning("No user entitlement mappings created")
        return pl.DataFrame(), pl.DataFrame()

    all_user_entitlements = all_user_entitlements.join(
        user_role_expanded.select(["ROLE_NAME", "USER_NAME"]).unique(),
        on="ROLE_NAME",
        how="left",
    )

    _cb(20, f"Checking SOD violations for {num_users:,} users…")
    user_sod = check_sod_violations_vectorized(
        all_user_entitlements, sod_controls_df, "USER_NAME"
    )

    _cb(58, f"Checking SA violations for {num_users:,} users…")
    user_sa = check_sa_violations(all_user_entitlements, sa_controls_df, "USER_NAME")

    _log.info("User analysis: SOD=%d SA=%d", user_sod.height, user_sa.height)
    _cb(95, "User analysis complete.")
    return user_sod, user_sa


# ── Summary and export ────────────────────────────────────────────────────────

def create_summary_sheet(
    sod_controls_df: pl.DataFrame,
    sa_controls_df: pl.DataFrame,
    role_sod_violations: pl.DataFrame,
    role_sa_violations: pl.DataFrame,
    user_sod_violations: pl.DataFrame,
    user_sa_violations: pl.DataFrame,
    analysis_type: str,
    fp_enabled: bool = False,
) -> pl.DataFrame:
    """Build control-level violation summary DataFrame.

    Counts unique violating roles/users per control for both SOD and SA.
    When fp_enabled=True, only True Conflict (TC) rows are counted — FP and SL
    rows are excluded because they are not genuine violations after FP analysis.
    Counts are precomputed with one group_by per violation sheet instead of
    one full-table filter per control.
    """
    def _counts_by_control(df: pl.DataFrame, entity_col: str, enabled: bool) -> dict[str, int]:
        if not enabled or df.height == 0 or entity_col not in df.columns:
            return {}
        return {
            row["CONTROL_NAME"]: row["count"]
            for row in df.group_by("CONTROL_NAME")
            .agg(pl.col(entity_col).n_unique().alias("count"))
            .iter_rows(named=True)
        }

    if fp_enabled:
        def _tc_only(df: pl.DataFrame) -> pl.DataFrame:
            if "Potential FP" in df.columns:
                return df.filter(pl.col("Potential FP") == "TC")
            return df
        role_sod_violations = _tc_only(role_sod_violations)
        role_sa_violations  = _tc_only(role_sa_violations)
        user_sod_violations = _tc_only(user_sod_violations)
        user_sa_violations  = _tc_only(user_sa_violations)

    role_enabled = analysis_type in ("role", "both")
    user_enabled = analysis_type in ("user", "both")

    sod_role_counts = _counts_by_control(role_sod_violations, "ROLE_NAME", role_enabled)
    sod_user_counts = _counts_by_control(user_sod_violations, "USER_NAME", user_enabled)
    sa_role_counts  = _counts_by_control(role_sa_violations,  "ROLE_NAME", role_enabled)
    sa_user_counts  = _counts_by_control(user_sa_violations,  "USER_NAME", user_enabled)

    summary_data: list[dict] = []
    index = 1

    for control_type, controls_df, role_counts, user_counts in [
        ("SOD", sod_controls_df, sod_role_counts, sod_user_counts),
        ("SA",  sa_controls_df,  sa_role_counts,  sa_user_counts),
    ]:
        for control_row in controls_df.iter_rows(named=True):
            control_name = control_row["CONTROL_NAME"]
            summary_data.append({
                "#":                        index,
                "CONTROL_TYPE":             control_type,
                "CONTROL_NAME":             control_name,
                "RISK_RANKING":             control_row["RISK_RANKING"],
                "RISK_DESCRIPTION":         control_row.get("RISK_DESCRIPTION", EMPTY_PLACEHOLDER),
                "MODULES":                  control_row["MODULES"],
                "NO_OF_ROLES_IN_VIOLATION": role_counts.get(control_name, 0),
                "NO_OF_USERS_IN_VIOLATION": user_counts.get(control_name, 0),
            })
            index += 1

    return pl.DataFrame(summary_data) if summary_data else pl.DataFrame()


def _write_safe_split_dataframe(
    workbook: xlsxwriter.Workbook,
    sheet_base_name: str,
    df: pl.DataFrame,
    entity_col: str,
    max_rows: int = EXCEL_MAX_ROWS,
    logger: Any = None,
) -> int:
    """Entity-aware safe sheet splitting: never split a single entity's block.

    Processes entities in order, adding complete entity blocks to current sheet
    until the next entity would exceed max_rows. If so, starts a new sheet
    (named "{base} Part N"). If a SINGLE entity block alone exceeds max_rows it
    physically cannot fit on one sheet, so it is hard-split across sheets with
    a warning — xlsxwriter's constant_memory mode would otherwise silently drop
    every row past the Excel limit.
    Returns number of sheets created.
    """
    if df.is_empty():
        return 0

    total_rows = df.height
    if total_rows <= max_rows:
        ws = workbook.add_worksheet(sheet_base_name[:31])
        _write_sheet_batch(ws, df, logger=logger, sheet_label=sheet_base_name[:31])
        return 1

    # Sort by entity and count rows per entity
    df_sorted = df.sort(entity_col)
    entity_counts = df_sorted.group_by(entity_col, maintain_order=True).agg(
        pl.len().alias("count")
    )
    counts = entity_counts["count"].to_list()

    start_row = 0
    current_chunk_rows = 0
    part_num = 1
    sheets_created = 0

    for count in counts:
        if current_chunk_rows + count > max_rows and current_chunk_rows > 0:
            # Flush the current sheet before starting this entity's block
            end_row = start_row + current_chunk_rows
            sheet_name = f"{sheet_base_name[:24]} Part {part_num}"
            if logger is not None:
                logger.info("  Writing sheet '%s' (rows %d–%d)…", sheet_name[:31], start_row, end_row)
            ws = workbook.add_worksheet(sheet_name[:31])
            _write_sheet_batch(ws, df_sorted[start_row:end_row], logger=logger, sheet_label=sheet_name[:31])
            sheets_created += 1
            start_row = end_row
            current_chunk_rows = 0
            part_num += 1

        if count > max_rows:
            # One entity exceeds the Excel row limit — split its block rather
            # than lose rows.
            (logger or logging.getLogger(__name__)).warning(
                "Sheet '%s': a single %s block has %d rows (> %d) and must span multiple sheets.",
                sheet_base_name, entity_col, count, max_rows,
            )
            remaining = count
            while remaining > 0:
                take = min(remaining, max_rows)
                end_row = start_row + take
                sheet_name = f"{sheet_base_name[:24]} Part {part_num}"
                if logger is not None:
                    logger.info("  Writing sheet '%s' (rows %d–%d)…", sheet_name[:31], start_row, end_row)
                ws = workbook.add_worksheet(sheet_name[:31])
                _write_sheet_batch(ws, df_sorted[start_row:end_row], logger=logger, sheet_label=sheet_name[:31])
                sheets_created += 1
                start_row = end_row
                remaining -= take
                part_num += 1
        else:
            current_chunk_rows += count

    # Write final sheet
    if current_chunk_rows > 0:
        end_row = start_row + current_chunk_rows
        sheet_name = f"{sheet_base_name[:24]} Part {part_num}" if part_num > 1 else sheet_base_name
        if logger is not None:
            logger.info("  Writing sheet '%s' (rows %d–%d)…", sheet_name[:31], start_row, end_row)
        ws = workbook.add_worksheet(sheet_name[:31])
        _write_sheet_batch(ws, df_sorted[start_row:end_row], logger=logger, sheet_label=sheet_name[:31])
        sheets_created += 1

    return sheets_created


def _write_observation_tab(
    workbook: xlsxwriter.Workbook,
    role_sod_violations: pl.DataFrame,
    bucket_details_df: pl.DataFrame,
    fp_enabled: bool = False,
) -> None:
    """Write one observation block per Control Bucket to an 'Observation' sheet."""
    ws = workbook.add_worksheet("Observation")

    # Formats
    header_fmt = workbook.add_format({
        "bold": True, "font_size": 13, "font_color": "#FFFFFF",
        "bg_color": "#0F1E3D", "align": "center", "valign": "vcenter",
        "font_name": "Calibri",
    })
    subheader_fmt = workbook.add_format({
        "italic": True, "font_size": 10, "font_color": "#0F1E3D",
        "bg_color": "#F2F2F2", "align": "left", "valign": "vcenter",
        "font_name": "Calibri",
    })
    col_hdr_fmt = workbook.add_format({
        "bold": True, "font_size": 10, "font_color": "#0F1E3D",
        "bg_color": "#FFD100", "border": 1,
        "align": "center", "valign": "vcenter", "font_name": "Calibri",
    })
    num_fmt = workbook.add_format({
        "font_size": 10, "align": "center", "valign": "top",
        "border": 1, "text_wrap": True, "font_name": "Calibri",
    })
    text_fmt = workbook.add_format({
        "font_size": 10, "align": "left", "valign": "top",
        "border": 1, "text_wrap": True, "font_name": "Calibri",
    })

    ws.set_column("A:A", 5)
    ws.set_column("B:B", 55)
    ws.set_column("C:C", 50)
    ws.set_column("D:D", 55)

    # Build bucket → role count map (TC-only when FP is enabled)
    bucket_role_counts: dict[str, int] = {}
    if not role_sod_violations.is_empty() and "CONTROL_BUCKET" in role_sod_violations.columns and "ROLE_NAME" in role_sod_violations.columns:
        count_df = role_sod_violations
        if fp_enabled and "Potential FP" in count_df.columns:
            count_df = count_df.filter(pl.col("Potential FP") == "TC")
        for row in (
            count_df
            .group_by("CONTROL_BUCKET")
            .agg(pl.col("ROLE_NAME").n_unique().alias("cnt"))
            .iter_rows(named=True)
        ):
            bucket_role_counts[row["CONTROL_BUCKET"]] = row["cnt"]

    # Build bucket details lookup
    bucket_details: dict[str, dict] = {}
    if not bucket_details_df.is_empty():
        for row in bucket_details_df.iter_rows(named=True):
            bucket_details[row["BUCKET_NAME"]] = row

    # Determine bucket order: Bucket Details order first, then any extra (e.g. UNCATEGORIZED)
    ordered_buckets: list[str] = []
    if not bucket_details_df.is_empty():
        ordered_buckets = bucket_details_df["BUCKET_NAME"].to_list()
    # Add any buckets present in violations but not in Bucket Details (e.g. UNCATEGORIZED)
    for b in bucket_role_counts:
        if b not in ordered_buckets:
            ordered_buckets.append(b)

    current_row = 0

    # Header row (written once)
    ws.set_row(current_row, 22)
    ws.merge_range(current_row, 0, current_row, 3, "Observations & Recommendations", header_fmt)
    current_row += 1

    # Sub-header row (written once)
    ws.set_row(current_row, 18)
    ws.merge_range(
        current_row, 0, current_row, 3,
        "Below listed are Oracle Security SOD/SA Analysis Observations related to the Project",
        subheader_fmt,
    )
    current_row += 1

    # Column headers (written once)
    ws.set_row(current_row, 18)
    for ci, label in enumerate(["#", "Observations", "Risk", "EY Recommendations"]):
        ws.write(current_row, ci, label, col_hdr_fmt)
    current_row += 1

    obs_index = 1
    for bucket in ordered_buckets:
        role_count = bucket_role_counts.get(bucket, 0)
        details = bucket_details.get(bucket, {})
        risk_text = details.get("RISK", "")
        rec_text = details.get("EY_RECOMMENDATIONS", "")
        bucket_display = bucket.title() if bucket == "UNCATEGORIZED" else bucket

        obs_text = (
            f"There are {role_count} roles identified with inherent SOD violations "
            f"with access to both {bucket_display} controls."
        )
        row_height = max(60, 15 * (len(obs_text) // 70 + 1))
        ws.set_row(current_row, row_height)
        ws.write(current_row, 0, obs_index, num_fmt)
        ws.write(current_row, 1, obs_text, text_fmt)
        ws.write(current_row, 2, risk_text, text_fmt)
        ws.write(current_row, 3, rec_text, text_fmt)
        current_row += 1
        obs_index += 1


def export_results(
    role_sod_violations: pl.DataFrame,
    role_sa_violations: pl.DataFrame,
    user_sod_violations: pl.DataFrame,
    user_sa_violations: pl.DataFrame,
    sod_controls_df: pl.DataFrame,
    sa_controls_df: pl.DataFrame,
    analysis_type: str,
    logger: Any = None,
    group_mapping: pl.DataFrame | None = None,
    role_hierarchy_df: pl.DataFrame | None = None,
    fp_enabled: bool = False,
    step_callback: Callable[[int, str], None] | None = None,
    with_observation: bool = False,
    bucket_details_df: pl.DataFrame | None = None,
) -> EngineResult:
    """Write SOD & SA results to an in-memory Excel workbook.

    Sheet order: SUMMARY, group mappings (if any), ROLE_SOD / ROLE_SA / USER_SOD / USER_SA,
    and optionally an Observation tab (when with_observation=True and role data is present).
    Uses entity-aware splitting to keep complete user/role blocks together.
    Returns EngineResult with .data = io.BytesIO positioned at offset 0.
    When fp_enabled=True the SUMMARY sheet counts only True Conflict rows.
    """
    _log = logger or logging.getLogger(__name__)

    try:
        summary_df = create_summary_sheet(
            sod_controls_df, sa_controls_df,
            role_sod_violations, role_sa_violations,
            user_sod_violations, user_sa_violations,
            analysis_type,
            fp_enabled=fp_enabled,
        )

        output_buffer = io.BytesIO()
        workbook = xlsxwriter.Workbook(
            output_buffer,
            # strings_to_formulas=False: cell values that begin with '=' must be
            # written as text, never as live formulas (formula-injection guard).
            {"constant_memory": True, "strings_to_urls": False, "strings_to_formulas": False},
        )

        total_sheets = 0
        export_start = time.perf_counter()
        _log.info(
            "Building workbook — ROLE_SOD: %d rows, ROLE_SA: %d rows, USER_SOD: %d rows, USER_SA: %d rows",
            role_sod_violations.height, role_sa_violations.height,
            user_sod_violations.height, user_sa_violations.height,
        )

        def _scb(n: int, msg: str) -> None:
            if step_callback:
                step_callback(n, msg)

        # Write summary
        if not summary_df.is_empty():
            _scb(15, "Writing summary sheet…")
            ws = workbook.add_worksheet("SUMMARY")
            _write_sheet_batch(ws, summary_df)
            total_sheets += 1
            _log.info("Created sheet: SUMMARY")

        # Write single user group mapping (if provided)
        if group_mapping is not None and not group_mapping.is_empty():
            _scb(16, "Writing user group mapping sheet…")
            sheets_created = _write_safe_split_dataframe(
                workbook,
                "User Group Mapping",
                group_mapping.sort("GROUP_NAME"),
                "GROUP_NAME",
                logger=_log,
            )
            total_sheets += sheets_created
            _log.info("Created %d sheet(s) for user group mapping", sheets_created)

        # Write violation sheets
        _role_sort_cols = ["CONTROL_NAME", "ENTITLEMENT", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_DISPLAY_NAME", "PRIVILEGE_DISPLAY_NAME"]
        _user_sort_cols = [*_role_sort_cols, "GROUP_NAME", "USER_NAME"]

        _fp_cols = {"Potential FP", "Reason"}
        _role_schema     = ROLE_OUTPUT_COLUMNS if fp_enabled else [c for c in ROLE_OUTPUT_COLUMNS if c not in _fp_cols]
        _user_schema     = USER_OUTPUT_COLUMNS if fp_enabled else [c for c in USER_OUTPUT_COLUMNS if c not in _fp_cols]
        # SOD tabs get CONTROL_BUCKET only when Observation is requested
        _role_sod_schema = (ROLE_SOD_OUTPUT_COLUMNS_WITH_BUCKET if fp_enabled else [c for c in ROLE_SOD_OUTPUT_COLUMNS_WITH_BUCKET if c not in _fp_cols]) if with_observation else _role_schema
        _user_sod_schema = (USER_SOD_OUTPUT_COLUMNS_WITH_BUCKET if fp_enabled else [c for c in USER_SOD_OUTPUT_COLUMNS_WITH_BUCKET if c not in _fp_cols]) if with_observation else _user_schema
        sheet_order = [
            ("ROLE_SOD", "ROLE_NAME", role_sod_violations, _role_sort_cols, _role_sod_schema),
            ("ROLE_SA",  "ROLE_NAME", role_sa_violations,  _role_sort_cols, _role_schema),
            ("USER_SOD", "USER_NAME", user_sod_violations, _user_sort_cols, _user_sod_schema),
            ("USER_SA",  "USER_NAME", user_sa_violations,  _user_sort_cols, _user_schema),
        ]

        _sheet_steps = {"ROLE_SOD": 17, "ROLE_SA": 18, "USER_SOD": 19, "USER_SA": 20}
        _sheet_labels = {
            "ROLE_SOD": "Writing role SOD sheet…",
            "ROLE_SA":  "Writing role SA sheet…",
            "USER_SOD": "Writing user SOD sheet…",
            "USER_SA":  "Writing user SA sheet…",
        }

        for sheet_name, entity_col, df, sort_cols, output_schema in sheet_order:
            # "ROLE_SOD" → "role", "USER_SA" → "user" (split on underscore — a
            # whitespace split here previously skipped every sheet for
            # role-only / user-only runs).
            if analysis_type not in ("both", sheet_name.lower().split("_")[0]):
                continue
            if df.is_empty():
                continue
            _scb(_sheet_steps[sheet_name], _sheet_labels[sheet_name])

            # Sort with available columns
            available_sort = [c for c in sort_cols if c in df.columns]
            if available_sort:
                df = df.sort(available_sort, nulls_last=True)

            # Project to the exact output schema (Step 6) after sorting
            df = reorder_to_output_schema(df, output_schema)

            sheet_start = time.perf_counter()
            _log.info("Writing %s (%d rows)…", sheet_name, df.height)
            sheets_created = _write_safe_split_dataframe(
                workbook,
                sheet_name,
                df,
                entity_col,
                logger=_log,
            )
            total_sheets += sheets_created
            _log.info(
                "Created %d sheet(s) for %s (%d rows) in %.1fs",
                sheets_created, sheet_name, df.height, time.perf_counter() - sheet_start,
            )

        # Observation tab (optional, role data only)
        if with_observation and analysis_type in ("role", "both") and not role_sod_violations.is_empty():
            _scb(21, "Writing observation tab…")
            _write_observation_tab(
                workbook,
                role_sod_violations,
                bucket_details_df if bucket_details_df is not None else pl.DataFrame(),
                fp_enabled=fp_enabled,
            )
            total_sheets += 1
            _log.info("Created sheet: Observation")

        _log.info("All sheets written; finalising workbook (this can take a while for large files)…")
        workbook.close()
        file_size_mb = len(output_buffer.getvalue()) / (1024 * 1024)
        _log.info(
            "Export complete: %.1f MB, %d sheets in %.1fs",
            file_size_mb, total_sheets, time.perf_counter() - export_start,
        )

        output_buffer.seek(0)
        return EngineResult(success=True, data=output_buffer)

    except Exception as exc:
        _log.error("export_results failed: %s", exc, exc_info=True)
        return EngineResult(success=False, errors=[f"Export failed: {exc}"])
