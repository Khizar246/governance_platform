"""SOD & SA Analysis Engine — ported from SOD Tool/app.py.

Algorithm:
  - create_entitlement_mappings(): join role hierarchy with privilege-to-entitlement map
    via two paths (inherited role codes + direct privileges)
  - check_sod_violations_vectorized(): set-based intersection per control (A ∩ B = violators)
  - check_sa_violations(): direct join on entitlement name
  - analyze_users(): chunked processing (CHUNK_SIZE = 10,000) to bound memory usage
  - export_results(): xlsxwriter constant_memory mode, auto-split on EXCEL_MAX_ROWS

Pure Polars engine. Pandas only at the Excel I/O boundary.
No FastAPI, no Pydantic, no HTTP.
"""

import io
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

import pandas as pd
import polars as pl
import xlsxwriter

# ── Constants (ported verbatim from SOD Tool/app.py) ─────────────────────────

EXCEL_MAX_ROWS   = 1_048_000
CHUNK_SIZE       = 10_000
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
        "Control Name":   "CONTROL_NAME",
        "Risk Ranking":   "RISK_RANKING",
        "LHS Entitlement":"LHS_ENTITLEMENT",
        "RHS Entitlement":"RHS_ENTITLEMENT",
        "Module(s)":      "MODULES",
        "Risk Description":"RISK_DESCRIPTION",
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
        "RISK_RANKING", "MODULES", "RISK_DESCRIPTION",
    },
    "sa":   {
        "CONTROL_NAME", "ENTITLEMENT", "RISK_RANKING",
        "MODULES", "RISK_DESCRIPTION", "SIDE",
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
    "sa":      {"RISK_RANKING", "MODULES", "RISK_DESCRIPTION", "SIDE"},
    "mapping": set(),
}


# ── Result type ───────────────────────────────────────────────────────────────

@dataclass
class EngineResult:
    """Structured return type for all engine functions."""
    success: bool
    data: Any = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ── Internal helpers ──────────────────────────────────────────────────────────

def _upper_values(df: pl.DataFrame) -> pl.DataFrame:
    """Cast all columns to string, strip whitespace, uppercase values."""
    return df.with_columns([
        pl.col(c).cast(pl.Utf8).str.strip_chars().str.to_uppercase()
        for c in df.columns
    ])


def _apply_rename(df: pl.DataFrame, rename_map: dict[str, str]) -> pl.DataFrame:
    """Case-insensitive column rename. Keys in rename_map are matched case-insensitively."""
    norm_map = {k.strip().upper(): v for k, v in rename_map.items()}
    actual = {c: norm_map[c.strip().upper()] for c in df.columns if c.strip().upper() in norm_map}
    return df.rename(actual) if actual else df


def _write_sheet_batch(ws: xlsxwriter.workbook.Worksheet, df: pl.DataFrame) -> None:
    """Write headers + rows from a Polars DataFrame into an xlsxwriter worksheet."""
    for ci, col in enumerate(df.columns):
        ws.write(0, ci, col)
    for ri, row in enumerate(df.iter_rows(), start=1):
        ws.write_row(ri, 0, list(row))


# ── Ruleset file loading ──────────────────────────────────────────────────────

def load_ruleset_sheets(
    file_bytes: bytes,
    filename: str,
    logger: Any = None,
) -> tuple[pl.DataFrame | None, pl.DataFrame | None, pl.DataFrame | None, list[str]]:
    """Load SoD Ruleset, SA Ruleset, and Entitlement to Privilege sheets.

    Applies INPUT_COLUMN_RENAME for each sheet, normalises values (uppercase/strip),
    validates required columns, validates critical columns, fills supplementary columns.

    Returns (sod_df, sa_df, mapping_df, errors). Any None in the tuple signals failure.
    Ported from SOD Tool/app.py — load_ruleset_sheets + load_file_cached.
    """
    _log = logger or logging.getLogger(__name__)
    errors: list[str] = []

    try:
        required_sheets = {"SoD Ruleset", "SA Ruleset", "Entitlement to Privilege"}
        xls = pd.ExcelFile(io.BytesIO(file_bytes), engine="openpyxl")
        missing_sheets = required_sheets - set(xls.sheet_names)
        if missing_sheets:
            return None, None, None, [
                f"Ruleset is missing required sheets: {missing_sheets}. "
                f"Found: {xls.sheet_names}"
            ]

        def _load(sheet_name: str, rename_key: str) -> pl.DataFrame:
            df_pd = pd.read_excel(
                io.BytesIO(file_bytes),
                sheet_name=sheet_name,
                dtype=str,
                keep_default_na=False,
                engine="openpyxl",
            )
            df = pl.from_pandas(df_pd)
            df = _upper_values(df)
            df = _apply_rename(df, INPUT_COLUMN_RENAME[rename_key])
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
            return None, None, None, errors

        # Critical column (non-empty) validation
        ok, crit_errors = validate_critical_columns(sod_df, sa_df, mapping_df)
        if not ok:
            errs: list[str] = []
            for sheet_name, msgs in crit_errors.items():
                errs.append(f"{sheet_name}: " + "; ".join(msgs))
            return None, None, None, errs

        # Fill empty supplementary columns with placeholder
        sod_df     = _fill_supplementary(sod_df,     "sod")
        sa_df      = _fill_supplementary(sa_df,      "sa")
        mapping_df = _fill_supplementary(mapping_df, "mapping")

        _log.info("Ruleset loaded: sod=%d sa=%d mapping=%d", sod_df.height, sa_df.height, mapping_df.height)
        return sod_df, sa_df, mapping_df, []

    except Exception as exc:
        _log.error("Ruleset loading error: %s", exc, exc_info=True)
        return None, None, None, [f"Ruleset error in '{filename}': {exc}"]


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
    """Fill empty/null supplementary column cells with EMPTY_PLACEHOLDER."""
    for col in SUPPLEMENTARY_COLUMNS.get(sheet_type, set()):
        if col not in df.columns:
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

    For each SOD control:
      Set A = entities with LHS entitlement
      Set B = entities with RHS entitlement
      Intersection(A, B) = violating entities → emit LHS + RHS rows

    Ported verbatim from SOD Tool/app.py.
    """
    entity_key = entity_column or "ROLE_NAME"

    entitlements_with_entity = entitlements_data.with_columns(
        pl.col(entity_key).alias("ENTITY_VALUE")
    )

    all_violations: list[pl.DataFrame] = []

    for control_row in sod_controls.iter_rows(named=True):
        lhs_entitlement = control_row["LHS_ENTITLEMENT"]
        rhs_entitlement = control_row["RHS_ENTITLEMENT"]

        lhs_records = entitlements_with_entity.filter(
            pl.col("ENTITLEMENT_NAME") == lhs_entitlement
        )
        rhs_records = entitlements_with_entity.filter(
            pl.col("ENTITLEMENT_NAME") == rhs_entitlement
        )

        if lhs_records.height == 0 or rhs_records.height == 0:
            continue

        common_entities = lhs_records.join(
            rhs_records.select(["ENTITY_VALUE"]).unique(),
            on="ENTITY_VALUE",
            how="inner",
        )

        if common_entities.height == 0:
            continue

        shared_cols = [
            "CONTROL_NAME", "RISK_RANKING", "MODULES",
            "ENTITY_VALUE",
            pl.col("ENTITLEMENT_NAME").alias("ENTITLEMENT"),
            "SIDE",
            "ROLE_NAME", "ROLE_DISPLAY_NAME",
            "INHERITED_ROLE_NAME", "INHERITED_ROLE_DISPLAY_NAME",
            "PRIVILEGE_NAME", "PRIVILEGE_DISPLAY_NAME",
        ]

        lhs_violations = common_entities.with_columns([
            pl.lit(control_row["CONTROL_NAME"]).alias("CONTROL_NAME"),
            pl.lit(control_row["RISK_RANKING"]).alias("RISK_RANKING"),
            pl.lit(control_row["MODULES"]).alias("MODULES"),
            pl.lit("LHS").alias("SIDE"),
        ]).select(shared_cols)

        rhs_violations = rhs_records.join(
            common_entities.select(["ENTITY_VALUE"]).unique(),
            on="ENTITY_VALUE",
            how="inner",
        ).with_columns([
            pl.lit(control_row["CONTROL_NAME"]).alias("CONTROL_NAME"),
            pl.lit(control_row["RISK_RANKING"]).alias("RISK_RANKING"),
            pl.lit(control_row["MODULES"]).alias("MODULES"),
            pl.lit("RHS").alias("SIDE"),
        ]).select(shared_cols)

        all_violations.append(pl.concat([lhs_violations, rhs_violations]))

    if not all_violations:
        return pl.DataFrame()

    final_violations = pl.concat(all_violations).unique()

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
    """Analyse users for SOD and SA violations using CHUNK_SIZE batches.

    Users are processed in chunks of CHUNK_SIZE (10,000) to keep memory bounded.
    Returns (user_sod_violations, user_sa_violations).
    Ported verbatim from SOD Tool/app.py.
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

    unique_users = user_role_expanded.select("USER_NAME").unique()
    num_users = unique_users.height
    num_chunks = (num_users + CHUNK_SIZE - 1) // CHUNK_SIZE
    _log.info("User analysis: %d users, %d chunks", num_users, num_chunks)

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

    # ── SOD: chunked ─────────────────────────────────────────────────────────
    _cb(20, f"Checking SOD violations for {num_users:,} users ({num_chunks} batch(es))…")
    sod_batches: list[pl.DataFrame] = []

    for chunk_idx in range(num_chunks):
        start_idx = chunk_idx * CHUNK_SIZE
        end_idx   = min(start_idx + CHUNK_SIZE, num_users)
        user_chunk = unique_users[start_idx:end_idx]
        chunk_ents = all_user_entitlements.join(user_chunk, on="USER_NAME", how="inner")

        if chunk_ents.height > 0:
            chunk_viol = check_sod_violations_vectorized(
                chunk_ents, sod_controls_df, "USER_NAME"
            )
            if chunk_viol.height > 0:
                sod_batches.append(chunk_viol)

        if (chunk_idx + 1) % 10 == 0 or chunk_idx + 1 == num_chunks:
            pct = 20 + int((chunk_idx + 1) / num_chunks * 35)
            _cb(pct, f"SOD violations: users {start_idx + 1:,}–{end_idx:,} of {num_users:,}…")

    user_sod = pl.concat(sod_batches).unique() if sod_batches else pl.DataFrame()

    # ── SA: chunked ───────────────────────────────────────────────────────────
    _cb(58, f"Checking SA violations for {num_users:,} users ({num_chunks} batch(es))…")
    sa_batches: list[pl.DataFrame] = []

    for chunk_idx in range(num_chunks):
        start_idx = chunk_idx * CHUNK_SIZE
        end_idx   = min(start_idx + CHUNK_SIZE, num_users)
        user_chunk = unique_users[start_idx:end_idx]
        chunk_ents = all_user_entitlements.join(user_chunk, on="USER_NAME", how="inner")

        if chunk_ents.height > 0:
            chunk_viol = check_sa_violations(chunk_ents, sa_controls_df, "USER_NAME")
            if chunk_viol.height > 0:
                sa_batches.append(chunk_viol)

        if (chunk_idx + 1) % 10 == 0 or chunk_idx + 1 == num_chunks:
            pct = 58 + int((chunk_idx + 1) / num_chunks * 35)
            _cb(pct, f"SA violations: users {start_idx + 1:,}–{end_idx:,} of {num_users:,}…")

    user_sa = pl.concat(sa_batches).unique() if sa_batches else pl.DataFrame()

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
) -> pl.DataFrame:
    """Build control-level violation summary DataFrame.

    Counts unique violating roles/users per control for both SOD and SA.
    Ported verbatim from SOD Tool/app.py.
    """
    summary_data: list[dict] = []
    index = 1

    # SOD controls
    for control_row in sod_controls_df.iter_rows(named=True):
        control_name = control_row["CONTROL_NAME"]

        role_count = 0
        if analysis_type in ("role", "both") and role_sod_violations.height > 0:
            viol = role_sod_violations.filter(pl.col("CONTROL_NAME") == control_name)
            if viol.height > 0:
                role_count = viol.select("ROLE_NAME").unique().height

        user_count = 0
        if analysis_type in ("user", "both") and user_sod_violations.height > 0:
            viol = user_sod_violations.filter(pl.col("CONTROL_NAME") == control_name)
            if viol.height > 0:
                user_count = viol.select("USER_NAME").unique().height

        summary_data.append({
            "#":                        index,
            "CONTROL_TYPE":             "SOD",
            "CONTROL_NAME":             control_name,
            "RISK_RANKING":             control_row["RISK_RANKING"],
            "RISK_DESCRIPTION":         control_row.get("RISK_DESCRIPTION", EMPTY_PLACEHOLDER),
            "MODULES":                  control_row["MODULES"],
            "NO_OF_ROLES_IN_VIOLATION": role_count,
            "NO_OF_USERS_IN_VIOLATION": user_count,
        })
        index += 1

    # SA controls
    for control_row in sa_controls_df.iter_rows(named=True):
        control_name = control_row["CONTROL_NAME"]

        role_count = 0
        if analysis_type in ("role", "both") and role_sa_violations.height > 0:
            viol = role_sa_violations.filter(pl.col("CONTROL_NAME") == control_name)
            if viol.height > 0:
                role_count = viol.select("ROLE_NAME").unique().height

        user_count = 0
        if analysis_type in ("user", "both") and user_sa_violations.height > 0:
            viol = user_sa_violations.filter(pl.col("CONTROL_NAME") == control_name)
            if viol.height > 0:
                user_count = viol.select("USER_NAME").unique().height

        summary_data.append({
            "#":                        index,
            "CONTROL_TYPE":             "SA",
            "CONTROL_NAME":             control_name,
            "RISK_RANKING":             control_row["RISK_RANKING"],
            "RISK_DESCRIPTION":         control_row.get("RISK_DESCRIPTION", EMPTY_PLACEHOLDER),
            "MODULES":                  control_row["MODULES"],
            "NO_OF_ROLES_IN_VIOLATION": role_count,
            "NO_OF_USERS_IN_VIOLATION": user_count,
        })
        index += 1

    return pl.DataFrame(summary_data) if summary_data else pl.DataFrame()


def export_results(
    role_sod_violations: pl.DataFrame,
    role_sa_violations: pl.DataFrame,
    user_sod_violations: pl.DataFrame,
    user_sa_violations: pl.DataFrame,
    sod_controls_df: pl.DataFrame,
    sa_controls_df: pl.DataFrame,
    analysis_type: str,
    logger: Any = None,
) -> EngineResult:
    """Write SOD & SA results to an in-memory Excel workbook.

    Sheet order: SUMMARY, then ROLE_SOD / ROLE_SA / USER_SOD / USER_SA as applicable.
    Sheets exceeding EXCEL_MAX_ROWS are auto-split.
    Returns EngineResult with .data = io.BytesIO positioned at offset 0.
    Ported verbatim from SOD Tool/app.py.
    """
    _log = logger or logging.getLogger(__name__)

    try:
        summary_df = create_summary_sheet(
            sod_controls_df, sa_controls_df,
            role_sod_violations, role_sa_violations,
            user_sod_violations, user_sa_violations,
            analysis_type,
        )

        results_data: dict[str, pl.DataFrame] = {}
        if not summary_df.is_empty():
            results_data["SUMMARY"] = summary_df

        if analysis_type in ("role", "both"):
            if role_sod_violations.height > 0:
                results_data["ROLE_SOD"] = role_sod_violations.sort("CONTROL_NAME")
            if role_sa_violations.height > 0:
                results_data["ROLE_SA"] = role_sa_violations.sort("CONTROL_NAME")

        if analysis_type in ("user", "both"):
            if user_sod_violations.height > 0:
                results_data["USER_SOD"] = user_sod_violations.sort("CONTROL_NAME")
            if user_sa_violations.height > 0:
                results_data["USER_SA"] = user_sa_violations.sort("CONTROL_NAME")

        output_buffer = io.BytesIO()
        workbook = xlsxwriter.Workbook(
            output_buffer,
            {"constant_memory": True, "strings_to_urls": False},
        )

        total_sheets = 0

        for sheet_name, df in results_data.items():
            total_rows = df.height
            display_name = sheet_name.replace("_", " ")

            if total_rows <= EXCEL_MAX_ROWS:
                ws = workbook.add_worksheet(display_name)
                _write_sheet_batch(ws, df)
                total_sheets += 1
                _log.info("Created sheet: %s (%d rows)", sheet_name, total_rows)
            else:
                num_parts = (total_rows + EXCEL_MAX_ROWS - 1) // EXCEL_MAX_ROWS
                for part_num in range(num_parts):
                    start_row = part_num * EXCEL_MAX_ROWS
                    end_row   = min((part_num + 1) * EXCEL_MAX_ROWS, total_rows)
                    chunk_df  = df[start_row:end_row]

                    part_name = f"{display_name} Part{part_num + 1}"
                    if len(part_name) > 31:
                        part_name = f"{display_name[:20]} P{part_num + 1}"

                    ws = workbook.add_worksheet(part_name)
                    _write_sheet_batch(ws, chunk_df)
                    total_sheets += 1
                    _log.info("Created sheet: %s (%d rows)", part_name, chunk_df.height)

        workbook.close()
        file_size_mb = len(output_buffer.getvalue()) / (1024 * 1024)
        _log.info("Export complete: %.1f MB, %d sheets", file_size_mb, total_sheets)

        output_buffer.seek(0)
        return EngineResult(success=True, data=output_buffer)

    except Exception as exc:
        _log.error("export_results failed: %s", exc, exc_info=True)
        return EngineResult(success=False, errors=[f"Export failed: {exc}"])
