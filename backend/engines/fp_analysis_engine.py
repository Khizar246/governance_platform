"""False Positive Analysis Engine — ported from FP Tool/app.py.

3-level FP classification:
  Level 1: Direct privilege → FP mapping via No_action_Privileges
  Level 2: Work-area gatekeeper check via WorkArea_Privileges
  Level 3: Single-Leg (SOD) / True Conflict tagging

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

# ── Constants (ported verbatim from FP Tool/app.py) ─────────────────────────

EXCEL_MAX_ROWS   = 1_048_000
DETAILS_SHEET    = "ROLE_DETAILS"
VIOLATION_SHEETS = ["ROLE_SOD", "ROLE_SA", "USER_SOD", "USER_SA"]
SHEET_LABELS     = {
    "ROLE_SOD": "Role SoD",
    "ROLE_SA":  "Role SA",
    "USER_SOD": "User SoD",
    "USER_SA":  "User SA",
}
SHEET_META = {
    "ROLE_SOD": (True,  "ROLE_NAME"),
    "ROLE_SA":  (False, "ROLE_NAME"),
    "USER_SOD": (True,  "USER_NAME"),
    "USER_SA":  (False, "USER_NAME"),
}

DETAILS_COL_MAP = {
    "TOP_ROLE_CODE":  "ROLE_NAME",
    "TOP_ROLE_NAME":  "ROLE_DISPLAY_NAME",
    "ROLE_TYPE_CODE": "ROLE_TYPE_CODE",
    "ROLE_CODE":      "INHERITED_ROLE_NAME",
    "ROLE_NAME":      "INHERITED_ROLE_DISPLAY_NAME",
    "PRIVILEGE_CODE": "PRIVILEGE_NAME",
    "PRIVILEGE_NAME": "PRIVILEGE_DISPLAY_NAME",
}

_BASE_COLS = {
    "CONTROL_NAME", "ENTITLEMENT", "SIDE", "ROLE_NAME", "ROLE_DISPLAY_NAME",
    "INHERITED_ROLE_NAME", "INHERITED_ROLE_DISPLAY_NAME",
    "PRIVILEGE_NAME", "PRIVILEGE_DISPLAY_NAME",
}
REQUIRED_COLS = {
    "ROLE_SOD":    _BASE_COLS,
    "ROLE_SA":     _BASE_COLS,
    "USER_SOD":    _BASE_COLS | {"USER_NAME"},
    "USER_SA":     _BASE_COLS | {"USER_NAME"},
    DETAILS_SHEET: {
        "ROLE_NAME", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_NAME",
        "INHERITED_ROLE_DISPLAY_NAME", "PRIVILEGE_NAME", "PRIVILEGE_DISPLAY_NAME",
    },
}
FP_WA_COLS = {
    "privilege":   {"PRIVILEGE_DISPLAY_NAME", "WORK_AREA_PRIVILEGE"},
    "entitlement": {"ENTITLEMENT",            "WORK_AREA_PRIVILEGE"},
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

def _upper(df: pl.DataFrame) -> pl.DataFrame:
    """Cast all columns to string, strip whitespace, uppercase. Ported verbatim."""
    return df.with_columns([
        pl.col(c).cast(pl.Utf8).str.strip_chars().str.to_uppercase()
        for c in df.columns
    ])


# ── File loading ──────────────────────────────────────────────────────────────

def load_sod_file(file_bytes: bytes, file_name: str) -> EngineResult:
    """Load SOD Analysis XLSX. Applies DETAILS_COL_MAP rename. Deduplicates each sheet.

    Returns EngineResult with .data = dict[sheet_name, pl.DataFrame].
    """
    try:
        result: dict[str, pl.DataFrame] = {}
        with pd.ExcelFile(io.BytesIO(file_bytes)) as xls:
            for sheet in xls.sheet_names:
                key = sheet.strip()
                df_pd = pd.read_excel(
                    xls, sheet_name=sheet, dtype=str, keep_default_na=False
                )
                if key == DETAILS_SHEET:
                    missing = [k for k in DETAILS_COL_MAP if k not in df_pd.columns]
                    if missing:
                        return EngineResult(
                            success=False,
                            errors=[
                                f"SOD file sheet '{DETAILS_SHEET}' is missing required columns: "
                                f"{missing}. Found: {list(df_pd.columns)}"
                            ],
                        )
                    df_pd = df_pd.rename(columns=DETAILS_COL_MAP)
                elif key in VIOLATION_SHEETS:
                    missing_cols = REQUIRED_COLS[key] - set(df_pd.columns)
                    if missing_cols:
                        return EngineResult(
                            success=False,
                            errors=[
                                f"SOD file sheet '{key}' is missing required columns: "
                                f"{sorted(missing_cols)}. Found: {list(df_pd.columns)}"
                            ],
                        )
                result[key] = _upper(pl.from_pandas(df_pd)).unique()
        return EngineResult(success=True, data=result)
    except Exception as exc:
        return EngineResult(success=False, errors=[f"Could not read SOD Analysis file '{file_name}': {exc}"])


def load_fp_database(file_bytes: bytes, file_name: str) -> EngineResult:
    """Load FP Database XLSX (sheets: No_action_Privileges, WorkArea_Privileges).

    Returns EngineResult with .data = dict[sheet_name, pl.DataFrame].
    """
    try:
        result: dict[str, pl.DataFrame] = {}
        required_sheets = {"No_action_Privileges", "WorkArea_Privileges"}
        with pd.ExcelFile(io.BytesIO(file_bytes)) as xls:
            missing = required_sheets - set(xls.sheet_names)
            if missing:
                return EngineResult(
                    success=False,
                    errors=[
                        f"FP Database is missing required sheets: {missing}. "
                        f"Found: {xls.sheet_names}"
                    ],
                )
            _na_req = {"PRIVILEGE_DISPLAY_NAME", "FALSE POSITIVE REASON"}
            _wa_req = {"WORK_AREA_PRIVILEGE"}
            for sheet in required_sheets:
                df_pd = pd.read_excel(
                    xls, sheet_name=sheet, dtype=str, keep_default_na=False
                )
                df = _upper(pl.from_pandas(df_pd).rename({c: c.strip().upper() for c in df_pd.columns}))
                if sheet == "No_action_Privileges":
                    missing_cols = _na_req - set(df.columns)
                    if missing_cols:
                        return EngineResult(
                            success=False,
                            errors=[
                                f"FP Database sheet 'No_action_Privileges' is missing required columns: "
                                f"{sorted(missing_cols)}. Found: {list(df.columns)}"
                            ],
                        )
                elif sheet == "WorkArea_Privileges":
                    missing_cols = _wa_req - set(df.columns)
                    if missing_cols:
                        return EngineResult(
                            success=False,
                            errors=[
                                f"FP Database sheet 'WorkArea_Privileges' is missing required column "
                                f"'WORK_AREA_PRIVILEGE'. Found: {list(df.columns)}"
                            ],
                        )
                result[sheet] = df
        return EngineResult(success=True, data=result)
    except Exception as exc:
        return EngineResult(success=False, errors=[f"Could not read FP Database file '{file_name}': {exc}"])


# ── Validation ────────────────────────────────────────────────────────────────

def validate_sod(
    sod: dict[str, pl.DataFrame],
    selected: set[str],
) -> tuple[bool, list[str]]:
    """Validate that DETAILS_SHEET and all selected violation sheets exist with required columns."""
    errors: list[str] = []
    if DETAILS_SHEET not in sod:
        errors.append(f"SOD file is missing required sheet: '{DETAILS_SHEET}'")
    else:
        missing_cols = REQUIRED_COLS[DETAILS_SHEET] - set(sod[DETAILS_SHEET].columns)
        if missing_cols:
            errors.append(
                f"SOD file sheet '{DETAILS_SHEET}' is missing required columns: "
                f"{sorted(missing_cols)}"
            )
    for s in selected:
        if s not in sod:
            errors.append(f"SOD file is missing sheet: '{s}'")
        elif s in REQUIRED_COLS:
            missing_cols = REQUIRED_COLS[s] - set(sod[s].columns)
            if missing_cols:
                errors.append(
                    f"SOD file sheet '{s}' is missing required columns: "
                    f"{sorted(missing_cols)}"
                )
    return len(errors) == 0, errors


def validate_fp(fp: dict[str, pl.DataFrame], mode: str) -> tuple[bool, str]:
    """Validate FP Database sheets and required columns for the given mode."""
    na_req = {"PRIVILEGE_DISPLAY_NAME", "FALSE POSITIVE REASON"}
    if "No_action_Privileges" not in fp:
        return False, "Missing sheet 'No_action_Privileges'"
    missing_na = na_req - set(fp["No_action_Privileges"].columns)
    if missing_na:
        return False, f"'No_action_Privileges' missing columns: {missing_na}"
    if "WorkArea_Privileges" not in fp:
        return False, "Missing sheet 'WorkArea_Privileges'"
    missing_wa = FP_WA_COLS[mode] - set(fp["WorkArea_Privileges"].columns)
    if missing_wa:
        return False, f"'WorkArea_Privileges' missing columns: {missing_wa}"
    return True, ""


# ── FP classification levels (ported verbatim from source) ───────────────────

def _fp_level1(df: pl.DataFrame, no_action: pl.DataFrame) -> pl.DataFrame:
    """Level 1: Direct privilege → FP mapping via No_action_Privileges."""
    if no_action.is_empty():
        return df
    na = (
        no_action
        .select(["PRIVILEGE_DISPLAY_NAME", "FALSE POSITIVE REASON"])
        .unique(subset=["PRIVILEGE_DISPLAY_NAME"], keep="first")
    )
    j = df.join(na, on="PRIVILEGE_DISPLAY_NAME", how="left")
    r = j.with_columns([
        pl.when(
            pl.col("FALSE POSITIVE REASON").is_not_null() & (pl.col("FP?") == "")
        ).then(pl.lit("YES")).otherwise(pl.col("FP?")).alias("FP?"),
        pl.when(
            pl.col("FALSE POSITIVE REASON").is_not_null() & (pl.col("Reason") == "")
        ).then(pl.col("FALSE POSITIVE REASON")).otherwise(pl.col("Reason")).alias("Reason"),
    ]).drop("FALSE POSITIVE REASON")
    return r


def _fp_level2(
    df: pl.DataFrame,
    work_area: pl.DataFrame,
    role_hier: pl.DataFrame,
    join_col: str,
) -> pl.DataFrame:
    """Level 2: Work-area gatekeeper check.

    A violation row is FP if the role lacks the required work-area gatekeeper privilege.
    join_col is PRIVILEGE_DISPLAY_NAME (privilege mode) or ENTITLEMENT (entitlement mode).
    """
    if work_area.is_empty():
        return df

    wa = work_area.filter(
        pl.col("WORK_AREA_PRIVILEGE").is_not_null()
        & (pl.col("WORK_AREA_PRIVILEGE") != "")
        & (~pl.col("WORK_AREA_PRIVILEGE").is_in(["NAN", "NONE"]))
    )
    if wa.is_empty():
        return df

    pending = df.filter(pl.col("FP?") == "")
    if pending.is_empty():
        return df

    merged = pending.join(
        wa.select([join_col, "WORK_AREA_PRIVILEGE"]),
        on=join_col,
        how="inner",
    )
    if merged.is_empty():
        return df

    role_gk = role_hier.select(["ROLE_NAME", "PRIVILEGE_DISPLAY_NAME"]).unique()
    satisfied = (
        merged
        .join(
            role_gk,
            left_on=["ROLE_NAME", "WORK_AREA_PRIVILEGE"],
            right_on=["ROLE_NAME", "PRIVILEGE_DISPLAY_NAME"],
            how="inner",
        )
        .select("_row_nr")
        .unique()
    )

    fp_ids = (
        merged.select("_row_nr").unique()
        .join(satisfied, on="_row_nr", how="anti")
    )
    if fp_ids.is_empty():
        return df

    reasons = (
        merged
        .join(fp_ids, on="_row_nr", how="inner")
        .group_by("_row_nr")
        .agg(pl.col("WORK_AREA_PRIVILEGE").unique().sort().alias("_wa"))
        .with_columns(
            (
                pl.lit("Role lacks required work-area privilege(s): ")
                + pl.col("_wa").list.join(", ")
            ).alias("_reason")
        )
        .drop("_wa")
    )

    r = df.join(reasons, on="_row_nr", how="left").with_columns([
        pl.when(pl.col("_reason").is_not_null() & (pl.col("FP?") == ""))
          .then(pl.lit("YES")).otherwise(pl.col("FP?")).alias("FP?"),
        pl.when(pl.col("_reason").is_not_null() & (pl.col("Reason") == ""))
          .then(pl.col("_reason")).otherwise(pl.col("Reason")).alias("Reason"),
    ]).drop("_reason")
    return r


def _build_user_effective_access(sod: dict[str, pl.DataFrame]) -> pl.DataFrame:
    """Build a flat [USER_NAME, PRIVILEGE_DISPLAY_NAME] lookup from all roles a user holds.

    Derives user-to-role membership from USER_SOD and USER_SA sheets (source of truth),
    then joins against ROLE_DETAILS to expand each role into its full privilege set.
    """
    user_frames = []
    for sheet in ("USER_SOD", "USER_SA"):
        if sheet in sod and not sod[sheet].is_empty():
            user_frames.append(sod[sheet].select(["USER_NAME", "ROLE_NAME"]))

    if not user_frames:
        return pl.DataFrame(schema={"USER_NAME": pl.Utf8, "PRIVILEGE_DISPLAY_NAME": pl.Utf8})

    membership = pl.concat(user_frames).unique()
    role_hier = sod[DETAILS_SHEET].select(["ROLE_NAME", "PRIVILEGE_DISPLAY_NAME"]).unique()

    return (
        membership
        .join(role_hier, on="ROLE_NAME", how="left")
        .select(["USER_NAME", "PRIVILEGE_DISPLAY_NAME"])
        .drop_nulls()
        .unique()
    )


def _fp_level2_user(
    df: pl.DataFrame,
    work_area: pl.DataFrame,
    user_access: pl.DataFrame,
    join_col: str,
) -> pl.DataFrame:
    """Level 2 work-area gatekeeper check for USER sheets.

    A violation row is FP only if the user lacks the required work-area privilege across
    ALL of their assigned roles. If any role the user holds provides the gatekeeper
    privilege, the violation is genuine (not FP).

    Mirrors _fp_level2 exactly; the only difference is the satisfaction join uses
    USER_NAME instead of ROLE_NAME so the check spans the user's full effective access.
    """
    if work_area.is_empty():
        return df

    wa = work_area.filter(
        pl.col("WORK_AREA_PRIVILEGE").is_not_null()
        & (pl.col("WORK_AREA_PRIVILEGE") != "")
        & (~pl.col("WORK_AREA_PRIVILEGE").is_in(["NAN", "NONE"]))
    )
    if wa.is_empty() or user_access.is_empty():
        return df

    pending = df.filter(pl.col("FP?") == "")
    if pending.is_empty():
        return df

    merged = pending.join(
        wa.select([join_col, "WORK_AREA_PRIVILEGE"]),
        on=join_col,
        how="inner",
    )
    if merged.is_empty():
        return df

    satisfied = (
        merged
        .join(
            user_access,
            left_on=["USER_NAME", "WORK_AREA_PRIVILEGE"],
            right_on=["USER_NAME", "PRIVILEGE_DISPLAY_NAME"],
            how="inner",
        )
        .select("_row_nr")
        .unique()
    )

    fp_ids = (
        merged.select("_row_nr").unique()
        .join(satisfied, on="_row_nr", how="anti")
    )
    if fp_ids.is_empty():
        return df

    reasons = (
        merged
        .join(fp_ids, on="_row_nr", how="inner")
        .group_by("_row_nr")
        .agg(pl.col("WORK_AREA_PRIVILEGE").unique().sort().alias("_wa"))
        .with_columns(
            (
                pl.lit("User lacks required work-area privilege(s): ")
                + pl.col("_wa").list.join(", ")
            ).alias("_reason")
        )
        .drop("_wa")
    )

    r = df.join(reasons, on="_row_nr", how="left").with_columns([
        pl.when(pl.col("_reason").is_not_null() & (pl.col("FP?") == ""))
          .then(pl.lit("YES")).otherwise(pl.col("FP?")).alias("FP?"),
        pl.when(pl.col("_reason").is_not_null() & (pl.col("Reason") == ""))
          .then(pl.col("_reason")).otherwise(pl.col("Reason")).alias("Reason"),
    ]).drop("_reason")
    return r


def _fp_level3(
    df: pl.DataFrame,
    entity_col: str,
    is_sod: bool,
    sheet: str,
) -> pl.DataFrame:
    """Level 3: Single-Leg detection (SOD sheets) / True Conflict tagging (SA sheets)."""
    label = entity_col.lower().replace("_", " ")
    pending = df.filter(pl.col("FP?") == "")
    if pending.is_empty():
        return df

    if is_sod:
        cnt = pending.with_columns(
            pl.col("ENTITLEMENT").n_unique().over(["CONTROL_NAME", entity_col]).alias("_n")
        )
        for tag, filt, tmpl in [
            (
                "SL",
                pl.col("_n") == 1,
                f"Single Leg — only one entitlement remains for {label} '",
            ),
            (
                "True Conflict",
                pl.col("_n") >= 2,
                f"True Conflict — both entitlements present for {label} '",
            ),
        ]:
            ids = cnt.filter(filt).select([
                "_row_nr",
                (pl.lit(tmpl) + pl.col(entity_col) + pl.lit("'")).alias("_reason"),
            ])
            df = df.join(ids, on="_row_nr", how="left").with_columns([
                pl.when(pl.col("_reason").is_not_null() & (pl.col("FP?") == ""))
                  .then(pl.lit(tag)).otherwise(pl.col("FP?")).alias("FP?"),
                pl.when(pl.col("_reason").is_not_null() & (pl.col("Reason") == ""))
                  .then(pl.col("_reason")).otherwise(pl.col("Reason")).alias("Reason"),
            ]).drop("_reason")
    else:
        etype = "user" if "USER" in sheet else "role"
        reason = f"True Conflict — Sensitive Access violation at {etype} level"
        ids = pending.select("_row_nr").with_columns(pl.lit(reason).alias("_reason"))
        df = df.join(ids, on="_row_nr", how="left").with_columns([
            pl.when(pl.col("_reason").is_not_null() & (pl.col("FP?") == ""))
              .then(pl.lit("True Conflict")).otherwise(pl.col("FP?")).alias("FP?"),
            pl.when(pl.col("_reason").is_not_null() & (pl.col("Reason") == ""))
              .then(pl.col("_reason")).otherwise(pl.col("Reason")).alias("Reason"),
        ]).drop("_reason")
    return df


# ── Analysis orchestrator ─────────────────────────────────────────────────────

def run_analysis(
    sod: dict[str, pl.DataFrame],
    fp_db: dict[str, pl.DataFrame],
    selected: set[str],
    mode: str,
    logger: Any = None,
    progress_callback: Callable[[int, str], None] | None = None,
) -> EngineResult:
    """Orchestrate 3-level FP analysis across selected violation sheets.

    Args:
        sod:      dict of DataFrames loaded by load_sod_file
        fp_db:    dict of DataFrames loaded by load_fp_database
        selected: set of sheet names to process (subset of VIOLATION_SHEETS)
        mode:     "privilege" or "entitlement"
        logger:   optional Logger instance for debug logging
        progress_callback: called with (percent, message) at key milestones

    Returns:
        EngineResult with .data = dict[sheet_name, pl.DataFrame] including DETAILS_SHEET.
    """
    _log = logger or logging.getLogger(__name__)

    def _cb(pct: int, msg: str) -> None:
        if progress_callback:
            progress_callback(pct, msg)

    try:
        no_action = fp_db["No_action_Privileges"]
        work_area = fp_db["WorkArea_Privileges"]
        hierarchy = sod[DETAILS_SHEET]
        join_col  = "PRIVILEGE_DISPLAY_NAME" if mode == "privilege" else "ENTITLEMENT"

        active_sheets = [
            s for s in VIOLATION_SHEETS
            if s in selected and s in sod and sod[s].height > 0
        ]
        n_sheets = len(active_sheets)
        user_access = _build_user_effective_access(sod)

        _cb(3, "Loading FP database and input data…")

        results: dict[str, pl.DataFrame] = {}

        for sheet_idx, sheet in enumerate(active_sheets):
            is_sod, entity_col = SHEET_META[sheet]

            start_pct = 10 + int(sheet_idx / n_sheets * 80) if n_sheets else 10
            end_pct   = 10 + int((sheet_idx + 1) / n_sheets * 80) if n_sheets else 90

            _cb(start_pct, f"Analysing {sheet}…")

            df = sod[sheet].with_row_index("_row_nr").with_columns([
                pl.lit("").alias("FP?"),
                pl.lit("").alias("Reason"),
            ])

            _cb(start_pct + (end_pct - start_pct) // 4, f"{sheet}: Level 1 — direct FP lookup…")
            df = _fp_level1(df, no_action)

            _cb(start_pct + (end_pct - start_pct) // 2, f"{sheet}: Level 2 — work-area gatekeeper…")
            if sheet in ("USER_SOD", "USER_SA"):
                df = _fp_level2_user(df, work_area, user_access, join_col)
            else:
                df = _fp_level2(df, work_area, hierarchy, join_col)

            _cb(start_pct + (end_pct - start_pct) * 3 // 4, f"{sheet}: Level 3 — SL/TC classification…")
            df = _fp_level3(df, entity_col, is_sod, sheet)

            df = df.drop("_row_nr")
            results[sheet] = df

            fp_n  = df.filter(pl.col("FP?") == "YES").height
            sl_n  = df.filter(pl.col("FP?") == "SL").height
            tc_n  = df.filter(pl.col("FP?") == "True Conflict").height
            _log.info(
                "%s: FP=%d | SL=%d | TC=%d (total=%d)",
                sheet, fp_n, sl_n, tc_n, df.height,
            )

        results[DETAILS_SHEET] = hierarchy
        _cb(95, "Analysis complete.")
        return EngineResult(success=True, data=results)

    except Exception as exc:
        _log.error("run_analysis failed: %s", exc, exc_info=True)
        return EngineResult(success=False, errors=[str(exc)])


# ── Excel export ──────────────────────────────────────────────────────────────

def export_results(
    results: dict[str, pl.DataFrame],
    logger: Any = None,
) -> EngineResult:
    """Write FP analysis results to an in-memory Excel workbook.

    Sheet order: VIOLATION_SHEETS then DETAILS_SHEET.
    Sheets exceeding EXCEL_MAX_ROWS are auto-split into P1, P2, … suffixes.
    Returns EngineResult with .data = io.BytesIO positioned at offset 0.
    Ported verbatim from FP Tool/app.py — xlsxwriter constant_memory mode.
    """
    _log = logger or logging.getLogger(__name__)
    try:
        buf = io.BytesIO()
        wb = xlsxwriter.Workbook(
            buf,
            {"constant_memory": True, "strings_to_urls": False},
        )

        _role_sort_cols = ["CONTROL_NAME", "ENTITLEMENT", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_DISPLAY_NAME", "PRIVILEGE_DISPLAY_NAME"]
        _user_sort_cols = [*_role_sort_cols, "USER_NAME"]

        for name in VIOLATION_SHEETS + [DETAILS_SHEET]:
            if name not in results or results[name].height == 0:
                continue

            _sort_cols = _user_sort_cols if "USER" in name else _role_sort_cols
            _available_sort = [c for c in _sort_cols if c in results[name].columns]
            df = results[name].sort(_available_sort, nulls_last=True) if _available_sort else results[name]

            if df.height <= EXCEL_MAX_ROWS:
                ws = wb.add_worksheet(name[:31])
                for ci, col in enumerate(df.columns):
                    ws.write(0, ci, col)
                for ri, row in enumerate(df.iter_rows(), 1):
                    ws.write_row(ri, 0, list(row))
            else:
                parts = (df.height + EXCEL_MAX_ROWS - 1) // EXCEL_MAX_ROWS
                for p in range(parts):
                    chunk = df[p * EXCEL_MAX_ROWS : (p + 1) * EXCEL_MAX_ROWS]
                    ws = wb.add_worksheet(f"{name[:25]} P{p + 1}")
                    for ci, col in enumerate(chunk.columns):
                        ws.write(0, ci, col)
                    for ri, row in enumerate(chunk.iter_rows(), 1):
                        ws.write_row(ri, 0, list(row))

            _log.info("Exported '%s': %d rows", name, results[name].height)

        wb.close()
        buf.seek(0)
        _log.info("FP export complete: %.1f MB", buf.getbuffer().nbytes / 1e6)
        return EngineResult(success=True, data=buf)

    except Exception as exc:
        _log.error("export_results failed: %s", exc, exc_info=True)
        return EngineResult(success=False, errors=[f"Export failed: {exc}"])
