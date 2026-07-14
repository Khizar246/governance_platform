"""Worker-process analysis jobs for the heavy tools (SOD & SA, Oracle Comparator).

These functions execute inside ProcessPoolExecutor workers (Windows spawn), so
this module must import cleanly with no side effects and must NOT import
FastAPI, main, or services.job_manager. Progress flows back to the web process
through a Manager queue; results return as the task's pickled payload.

Queue message shapes:
    ("progress", job_id, percent, message)
    ("step", job_id, step_number)

Return payload shape (both jobs):
    {"summary": dict, "result_dfs": dict, "output_bytes": bytes, "output_filename": str}
"""

from typing import Optional

import polars as pl

from config import output_filename
from models.sod_sa_analysis import ViolationCounts, SODSASummary
from models.oracle_comparator import ComparisonTypeSummary, OracleComparatorSummary
from engines.sod_sa_engine import (
    analyze_roles, analyze_users, export_results,
    run_fp_pipeline, compute_user_groups,
)
from engines.oracle_comparator_engine import run_analysis, generate_report
from shared.logger import get_logger


class AnalysisJobError(Exception):
    """Engine-reported failure (result.success == False). Carries the user-facing
    error list and must survive pickling across the process boundary, so the
    list is passed to Exception.__init__ (pickle reconstructs from .args)."""

    def __init__(self, errors: list[str]):
        super().__init__(errors)
        self.errors = errors

    def __str__(self) -> str:
        return "; ".join(self.errors)


# Columns exposed per sheet through the SOD & SA paginated results endpoint.
# Lives here (not in the router) because both the worker cache build and the
# router's results endpoint need it.
_ROLE_COLS = ["CONTROL_NAME", "CONTROL_BUCKET", "ENTITLEMENT", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_DISPLAY_NAME", "PRIVILEGE_DISPLAY_NAME", "Potential FP", "Reason"]
_USER_COLS = ["CONTROL_NAME", "CONTROL_BUCKET", "ENTITLEMENT", "ROLE_DISPLAY_NAME", "INHERITED_ROLE_DISPLAY_NAME", "PRIVILEGE_DISPLAY_NAME", "GROUP_NAME", "USER_NAME", "Potential FP", "Reason"]
SHEET_COLS = {
    "ROLE_SOD": _ROLE_COLS,
    "ROLE_SA":  _ROLE_COLS,
    "USER_SOD": _USER_COLS,
    "USER_SA":  _USER_COLS,
    "GROUP_MAPPING": ["GROUP_NAME", "ROLE_NAME", "NO_OF_USERS_IN_GROUP"],
}


def run_sod_sa_job(
    job_id: str,
    progress_queue,
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
    bucket_details_df: Optional[pl.DataFrame] = None,
    with_3leg: bool = False,
    procurement_df: Optional[pl.DataFrame] = None,
) -> dict:
    logger = get_logger("sod_sa_analysis")
    try:
        logger.info(f"[{job_id}] Starting SOD & SA Analysis: analysis_type={analysis_type}, with_fp={with_fp}, selected_analyses={selected_analyses}, with_3leg={with_3leg}")
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

        def callback(pct: int, msg: str) -> None:
            progress_queue.put(("progress", job_id, pct, msg))

        def _set_step(n: int) -> None:
            progress_queue.put(("step", job_id, n))

        def _step(n: int, pct: int, msg: str) -> None:
            """Advance step counter and update progress in one call."""
            _set_step(n)
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
                _set_step(5 if "SA violations" in msg else 4)
                callback(pct // 2, msg)

            def user_callback(pct: int, msg: str) -> None:
                _set_step(7 if "SA violations" in msg else 6)
                callback(50 + pct // 2, msg)
        elif analysis_type == "role":
            def role_callback(pct: int, msg: str) -> None:
                _set_step(5 if "SA violations" in msg else 4)
                callback(pct, msg)
            user_callback = None
        else:  # "user"
            role_callback = None
            def user_callback(pct: int, msg: str) -> None:
                _set_step(7 if "SA violations" in msg else 6)
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
                three_leg=with_3leg,
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
                three_leg=with_3leg,
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
                    procurement_df=procurement_df,
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
                    procurement_df=procurement_df,
                )
        # FP disabled: leave DataFrames without FP columns; engine and cache
        # populate will both omit them from output when fp_enabled=False.

        # Strip internal group-metadata columns (3-leg SOD frames carry
        # _GROUP_ID/_N_GROUPS). run_fp_pipeline already drops them after FP
        # runs; this covers FP-disabled runs (no-op otherwise).
        if not role_sod.is_empty():
            role_sod = role_sod.drop([c for c in role_sod.columns if c.startswith("_")])
        if not user_sod.is_empty():
            user_sod = user_sod.drop([c for c in user_sod.columns if c.startswith("_")])

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
            _cols = SHEET_COLS.get(_sheet_name, [])
            _available = [c for c in _cols if c in _df.columns]
            if _available:
                cache[_sheet_name] = _df.select(_available)

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
            _set_step(n)
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
            with_observation=with_observation,
            bucket_details_df=bucket_details_df,
        )
        if not export_result.success:
            logger.error(f"[{job_id}] Export failed: {export_result.errors}")
            raise AnalysisJobError(export_result.errors)

        _step(22, 98, "Finalising workbook…")
        output_file = output_filename("SOD_SA_Analysis", analysis_type.capitalize())
        logger.info(f"[{job_id}] SOD & SA analysis complete. Output file: {output_file}")
        return {
            "summary": summary,
            "result_dfs": cache,
            "output_bytes": export_result.data.getvalue(),
            "output_filename": output_file,
        }

    except AnalysisJobError:
        raise
    except Exception:
        logger.error(f"[{job_id}] SOD & SA analysis failed with exception", exc_info=True)
        raise


def run_oracle_comparator_job(
    job_id: str,
    progress_queue,
    files: dict,
    analysis_type: str,
    env1_name: str,
    env2_name: str,
) -> dict:
    logger = get_logger("oracle_comparator")
    try:
        logger.info(f"[{job_id}] Starting Oracle Comparator: analysis_type={analysis_type}, env1={env1_name}, env2={env2_name}")
        logger.info(f"[{job_id}] Input files: {list(files.keys())}")

        def callback(pct: int, msg: str) -> None:
            progress_queue.put(("progress", job_id, pct, msg))

        result = run_analysis(files, analysis_type, env1_name, env2_name, progress_callback=callback)

        if not result.success:
            logger.error(f"[{job_id}] Oracle Comparator analysis failed: {result.errors}")
            raise AnalysisJobError(result.errors)

        results_1to2, results_2to1 = result.data

        result_dfs = {
            "1to2": {ct: df for ct, df in results_1to2.items() if df is not None},
            "2to1": {ct: df for ct, df in results_2to1.items() if df is not None},
        }

        report_result = generate_report(results_1to2, results_2to1, env1_name, env2_name)
        if not report_result.success:
            logger.error(f"[{job_id}] Report generation failed: {report_result.errors}")
            raise AnalysisJobError(report_result.errors)

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

        fname = output_filename("Oracle_Comparison", f"{env1_name}_vs_{env2_name}")
        logger.info(f"[{job_id}] Oracle Comparator complete. Output file: {fname}")
        return {
            "summary": summary,
            "result_dfs": result_dfs,
            "output_bytes": report_result.data,
            "output_filename": fname,
        }

    except AnalysisJobError:
        raise
    except Exception:
        logger.error(f"[{job_id}] Oracle Comparator failed with exception", exc_info=True)
        raise
