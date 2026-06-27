"""Unit tests for inherited-role FP matching in run_fp_pipeline.

These call the engine directly with hand-built Polars frames that mimic the
violation frames produced by check_sod_violations_vectorized / check_sa_violations.
"""
from __future__ import annotations

import polars as pl

from engines.sod_sa_engine import run_fp_pipeline


# Minimal violation frame matching the columns FP levels read:
# CONTROL_NAME, ENTITLEMENT, ROLE_NAME, INHERITED_ROLE_NAME, PRIVILEGE_NAME.
def _viol(rows: list[dict]) -> pl.DataFrame:
    base = {
        "CONTROL_NAME": "",
        "ENTITLEMENT": "",
        "ROLE_NAME": "",
        "INHERITED_ROLE_NAME": "",
        "PRIVILEGE_NAME": "",
    }
    return pl.DataFrame([{**base, **r} for r in rows])


def _noaction(rows: list[tuple[str, str]]) -> pl.DataFrame:
    return pl.DataFrame(rows, schema=["PRIVILEGE_NAME", "FALSE POSITIVE REASON"], orient="row")


def _workarea(rows: list[tuple[str, str]]) -> pl.DataFrame:
    return pl.DataFrame(rows, schema=["PRIVILEGE_NAME", "WORK_AREA_PRIVILEGE_CODE"], orient="row")


def _role_hier(rows: list[tuple[str, str, str]]) -> pl.DataFrame:
    return pl.DataFrame(
        rows, schema=["ROLE_NAME", "PRIVILEGE_NAME", "INHERITED_ROLE_NAME"], orient="row"
    )


def test_fp_keys_column_present_during_pipeline_and_dropped_after():
    df = _viol([{"CONTROL_NAME": "C", "ENTITLEMENT": "E", "ROLE_NAME": "R1",
                 "PRIVILEGE_NAME": "PX", "INHERITED_ROLE_NAME": "IR"}])
    out = run_fp_pipeline(
        df,
        no_action_df=pl.DataFrame(schema=["PRIVILEGE_NAME", "FALSE POSITIVE REASON"]),
        work_area_df=pl.DataFrame(schema=["PRIVILEGE_NAME", "WORK_AREA_PRIVILEGE_CODE"]),
        role_hierarchy_df=_role_hier([("R1", "PX", "IR")]),
        entity_col="ROLE_NAME",
        is_sod=False,
    )
    assert "_fp_keys" not in out.columns
    assert "Potential FP" in out.columns and "Reason" in out.columns
