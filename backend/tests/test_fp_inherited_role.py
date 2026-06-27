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


def test_fp_keys_dropped_from_pipeline_output():
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


def _run(df, no_action, work_area, role_hier, entity_col="ROLE_NAME", is_sod=False,
         user_role_df=None):
    return run_fp_pipeline(df, no_action, work_area, role_hier, entity_col, is_sod,
                           user_role_df=user_role_df)


def test_level1_matches_inherited_role_only_violation():
    # Violation came via inherited-role path: PRIVILEGE_NAME empty, inherited set.
    df = _viol([{"CONTROL_NAME": "C", "ENTITLEMENT": "E", "ROLE_NAME": "R1",
                 "PRIVILEGE_NAME": "", "INHERITED_ROLE_NAME": "IR_SAFE"}])
    out = _run(
        df,
        _noaction([("IR_SAFE", "Inherited role grants directly")]),
        pl.DataFrame(schema=["PRIVILEGE_NAME", "WORK_AREA_PRIVILEGE_CODE"]),
        _role_hier([("R1", "", "IR_SAFE")]),
    )
    assert out["Potential FP"][0] == "FP"
    assert "Inherited role grants directly" in out["Reason"][0]


def test_level1_matches_when_only_inherited_in_db_but_row_has_both():
    df = _viol([{"CONTROL_NAME": "C", "ENTITLEMENT": "E", "ROLE_NAME": "R1",
                 "PRIVILEGE_NAME": "PX", "INHERITED_ROLE_NAME": "IR_SAFE"}])
    out = _run(
        df,
        _noaction([("IR_SAFE", "via inherited")]),
        pl.DataFrame(schema=["PRIVILEGE_NAME", "WORK_AREA_PRIVILEGE_CODE"]),
        _role_hier([("R1", "PX", "IR_SAFE")]),
    )
    assert out["Potential FP"][0] == "FP"


def test_level1_no_row_duplication_when_both_keys_in_db():
    df = _viol([{"CONTROL_NAME": "C", "ENTITLEMENT": "E", "ROLE_NAME": "R1",
                 "PRIVILEGE_NAME": "PX", "INHERITED_ROLE_NAME": "IR_SAFE"}])
    out = _run(
        df,
        _noaction([("PX", "via priv"), ("IR_SAFE", "via inherited")]),
        pl.DataFrame(schema=["PRIVILEGE_NAME", "WORK_AREA_PRIVILEGE_CODE"]),
        _role_hier([("R1", "PX", "IR_SAFE")]),
    )
    assert out.height == 1
    assert out["Potential FP"][0] == "FP"


def test_level1_privilege_only_unchanged():
    df = _viol([{"CONTROL_NAME": "C", "ENTITLEMENT": "E", "ROLE_NAME": "R1",
                 "PRIVILEGE_NAME": "PX", "INHERITED_ROLE_NAME": ""}])
    out = _run(
        df,
        _noaction([("PX", "known safe")]),
        pl.DataFrame(schema=["PRIVILEGE_NAME", "WORK_AREA_PRIVILEGE_CODE"]),
        _role_hier([("R1", "PX", "")]),
    )
    assert out["Potential FP"][0] == "FP"
    assert "known safe" in out["Reason"][0]


def test_level2_inherited_role_subject_to_wa_rule_and_not_held_is_fp():
    # Violation via inherited role IR_GATE; WA rule keyed on IR_GATE requires code WA9.
    # Entity R1 does NOT hold WA9 -> Level 2 marks FP.
    df = _viol([{"CONTROL_NAME": "C", "ENTITLEMENT": "E", "ROLE_NAME": "R1",
                 "PRIVILEGE_NAME": "", "INHERITED_ROLE_NAME": "IR_GATE"}])
    out = _run(
        df,
        pl.DataFrame(schema=["PRIVILEGE_NAME", "FALSE POSITIVE REASON"]),
        _workarea([("IR_GATE", "WA9")]),
        _role_hier([("R1", "", "IR_GATE")]),  # R1 holds IR_GATE but not WA9
    )
    assert out["Potential FP"][0] == "FP"
    assert "work-area" in out["Reason"][0]
