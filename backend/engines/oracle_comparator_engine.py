"""Oracle Comparator Engine — ported from Role Comparison/app.py.

Comparison algorithm: native Polars anti-join + semi-join (no string-key concat).
  - semi_join  → rows present in target   → "Exists in {env}"
  - anti_join  → rows missing from target → "Missing in {env}" + per-column diagnosis

Comparison types: duty_role, privilege, dsp (with grant-end-date post-processing).
Excel report: Summary sheet + per-direction per-type detail sheets with conditional coloring.

Pure Polars engine. Pandas only at the Excel I/O boundary.
No FastAPI, no Pydantic, no HTTP.
"""

import io
from dataclasses import dataclass, field
from typing import Any, Callable

import pandas as pd
import polars as pl

# ── Constants (ported verbatim from Role Comparison/app.py) ──────────────────

COMPARISON_COLUMNS = {
    "duty_role": ["ROLE NAME", "INHERITED ROLE NAME"],
    "privilege":  ["ROLE NAME", "ENTITLEMENT"],
    "dsp": [
        "ROLE NAME", "INHERITED ROLE NAME", "GRANT END DATE",
        "OBJECT NAME", "FUNCTION NAME", "INSTANCE SET NAME",
    ],
}

FILE_CONFIGS = {
    "rbac": {
        "required_columns": ["ROLE NAME", "ENTITLEMENT", "INHERITED ROLE NAME"],
        "display_name": "RBAC File",
    },
    "dsp": {
        "required_columns": [
            "ROLE NAME", "INHERITED ROLE NAME", "GRANT END DATE",
            "OBJECT NAME", "FUNCTION NAME", "INSTANCE SET NAME",
        ],
        "display_name": "DSP File",
    },
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

def _normalize_cols(df: pl.DataFrame) -> pl.DataFrame:
    """Rename all columns: strip whitespace + uppercase. Mirrors source process_file()."""
    return df.rename({c: c.strip().upper() for c in df.columns})


# ── Core comparison engine ────────────────────────────────────────────────────

def compare(
    df_source: pl.DataFrame,
    df_target: pl.DataFrame,
    comp_type: str,
    target_env_name: str,
) -> pl.DataFrame:
    """Compare source against target using native Polars anti-join + semi-join.

    Instead of concatenating columns into a string key:
      - semi_join  → rows present in target   → "Exists in {target}"
      - anti_join  → rows missing from target  → "Missing in {target}"

    For each missing row the mismatch reason uses structured per-column detection:
    checks whether individual column values are absent from target, or whether
    every individual value exists but the combination does not.

    Ported verbatim from Role Comparison/app.py.
    """
    cols = COMPARISON_COLUMNS[comp_type]

    # Deduplicate on the actual column combination
    src = df_source.select(cols).unique()
    tgt = df_target.select(cols).unique()

    # ── Matches ───────────────────────────────────────────────────────────────
    matched = src.join(tgt, on=cols, how="semi").with_columns(
        pl.lit(f"Exists in {target_env_name}").alias("Status"),
        pl.lit("Match found").alias("Reason"),
    )

    # ── Missing ───────────────────────────────────────────────────────────────
    missing = src.join(tgt, on=cols, how="anti")

    if missing.is_empty():
        result = matched
    else:
        # Vectorised per-column presence check for structured mismatch diagnosis:
        # collect the names of columns whose value is absent from the target,
        # then build the reason string in one expression.
        absent_names = pl.concat_list([
            pl.when(
                ~pl.col(c).cast(pl.Utf8).fill_null("None").str.strip_chars()
                  .is_in(tgt[c].cast(pl.Utf8).drop_nulls().unique().to_list())
            ).then(pl.lit(c)).otherwise(pl.lit(None, dtype=pl.Utf8))
            for c in cols
        ]).list.drop_nulls()

        missing = missing.with_columns(
            pl.lit(f"Missing in {target_env_name}").alias("Status"),
            pl.when(absent_names.list.len() > 0)
              .then(
                  pl.lit(f"Value(s) missing in {target_env_name}: ")
                  + absent_names.list.join(", ")
              )
              .otherwise(pl.lit(
                  f"Combination not found in {target_env_name} "
                  f"(individual values exist separately)"
              ))
              .alias("Reason"),
        )

        result = pl.concat([matched, missing], how="diagonal")

    # ── DSP: grant-end-date availability flag ─────────────────────────────────
    if comp_type == "dsp" and "GRANT END DATE" in result.columns:
        result = result.with_columns(
            pl.when(
                pl.col("GRANT END DATE")
                  .cast(pl.Utf8)
                  .str.strip_chars()
                  .str.to_uppercase()
                  == "NO DATA AVAILABLE"
            )
            .then(pl.lit("No"))
            .otherwise(pl.lit("Yes"))
            .alias("Is grant end date available?")
        )

    return result


# ── Analysis orchestrator ─────────────────────────────────────────────────────

def run_analysis(
    files: dict[str, pl.DataFrame],
    analysis_type: str,
    env1_name: str,
    env2_name: str,
    progress_callback: Callable[[int, str], None] | None = None,
) -> EngineResult:
    """Run all required comparisons for the given analysis_type.

    Args:
        files:         dict keyed by "rbac_file1", "rbac_file2", "dsp_file1", "dsp_file2"
        analysis_type: "rbac" | "dsp" | "both"
        env1_name:     display name for environment 1
        env2_name:     display name for environment 2
        progress_callback: called with (percent, message) at key milestones

    Returns:
        EngineResult with .data = (results_1to2, results_2to1)
        Each is a dict[comp_type_str, pl.DataFrame].
    """
    def _cb(pct: int, msg: str) -> None:
        if progress_callback:
            progress_callback(pct, msg)

    try:
        comp_types: list[tuple[str, str]] = []
        if analysis_type in ("rbac", "both"):
            comp_types.extend([("duty_role", "rbac"), ("privilege", "rbac")])
        if analysis_type in ("dsp", "both"):
            comp_types.append(("dsp", "dsp"))

        results_1to2: dict[str, pl.DataFrame] = {}
        results_2to1: dict[str, pl.DataFrame] = {}
        total = len(comp_types)

        _cb(3, "Loading environment files…")

        for i, (comp_type, file_type) in enumerate(comp_types):
            pct = 10 + int(i / total * 80) if total else 10
            label = comp_type.replace("_", " ").title()
            _cb(pct, f"Comparing {label}: {env1_name} vs {env2_name}…")

            df1 = _normalize_cols(files[f"{file_type}_file1"])
            df2 = _normalize_cols(files[f"{file_type}_file2"])

            results_1to2[comp_type] = compare(df1, df2, comp_type, env2_name)
            results_2to1[comp_type] = compare(df2, df1, comp_type, env1_name)

        _cb(95, "Analysis complete.")
        return EngineResult(success=True, data=(results_1to2, results_2to1))

    except Exception as exc:
        return EngineResult(success=False, errors=[str(exc)])


# ── Excel report generation ───────────────────────────────────────────────────

def generate_report(
    results_1to2: dict[str, pl.DataFrame],
    results_2to1: dict[str, pl.DataFrame],
    env1: str,
    env2: str,
) -> EngineResult:
    """Build Excel workbook with Summary + per-direction per-type detail sheets.

    Returns EngineResult with .data = bytes of the completed workbook.
    Ported verbatim from Role Comparison/app.py — xlsxwriter via pandas ExcelWriter.
    """
    try:
        buf = io.BytesIO()

        # strings_to_formulas=False: cell values that begin with '=' must be
        # written as text, never as live formulas (formula-injection guard).
        with pd.ExcelWriter(
            buf,
            engine="xlsxwriter",
            engine_kwargs={"options": {"strings_to_formulas": False, "strings_to_urls": False}},
        ) as writer:
            wb = writer.book
            hdr_fmt   = wb.add_format({"bold": True, "bg_color": "#D7E4BC", "border": 1})
            match_fmt = wb.add_format({"bg_color": "#d4edda"})
            miss_fmt  = wb.add_format({"bg_color": "#f8d7da"})

            # ── Summary sheet ─────────────────────────────────────────────────
            summary_rows: list[dict] = []
            for direction, results in [
                (f"{env1} → {env2}", results_1to2),
                (f"{env2} → {env1}", results_2to1),
            ]:
                for ctype, df in results.items():
                    if df is None:
                        continue
                    total = len(df)
                    matches = df.filter(pl.col("Status").str.contains("Exists")).height
                    summary_rows.append({
                        "Analysis Type":  ctype.replace("_", " ").title(),
                        "Direction":      direction,
                        "Total Records":  total,
                        "Matches":        matches,
                        "Missing":        total - matches,
                        "Match Rate (%)": round(matches / total * 100, 1) if total else 0,
                    })

            if summary_rows:
                sdf = pd.DataFrame(summary_rows)
                sdf.to_excel(writer, sheet_name="Summary", index=False)
                ws = writer.sheets["Summary"]
                for ci, col in enumerate(sdf.columns):
                    ws.write(0, ci, col, hdr_fmt)
                    w = min(
                        max(len(str(col)), sdf[col].astype(str).map(len).max()) + 3,
                        30,
                    )
                    ws.set_column(ci, ci, w)

            # ── Detail sheets ─────────────────────────────────────────────────
            label_map = {
                "duty_role": "Duty_Role",
                "privilege": "Privilege",
                "dsp":       "DSP",
            }

            for results, names in [
                (results_1to2, (env1, env2)),
                (results_2to1, (env2, env1)),
            ]:
                for ctype, df in results.items():
                    if df is None:
                        continue
                    pdf = df.to_pandas()
                    sheet = (
                        f"{names[0][:10]}_to_{names[1][:10]}_{label_map[ctype]}"
                    )[:31]
                    pdf.to_excel(writer, sheet_name=sheet, index=False)

                    ws = writer.sheets[sheet]
                    for ci, col in enumerate(pdf.columns):
                        ws.write(0, ci, col, hdr_fmt)
                        max_len = max(
                            len(str(col)),
                            pdf[col].astype(str).map(len).max() if len(pdf) else 0,
                        )
                        ws.set_column(ci, ci, min(max_len + 3, 50))

                    if "Status" in pdf.columns:
                        status_ci = list(pdf.columns).index("Status")
                        for ri in range(len(pdf)):
                            val = str(pdf.iloc[ri, status_ci])
                            fmt = match_fmt if "Exists" in val else miss_fmt
                            ws.write(ri + 1, status_ci, val, fmt)

        buf.seek(0)
        return EngineResult(success=True, data=buf.read())

    except Exception as exc:
        return EngineResult(success=False, errors=[f"Report generation failed: {exc}"])
