"""Unit tests for group-aware SL/TC classification in the 3-leg FP pipeline.

These call run_fp_pipeline directly with hand-built Polars frames that mimic
the violation frames produced by check_sod_violations_3leg — i.e. they carry
the internal `_GROUP_ID` / `_N_GROUPS` columns. The last test uses a frame
WITHOUT those columns to pin the legacy 2-leg entitlement-count behavior.
"""
from __future__ import annotations

import polars as pl

from engines.sod_sa_engine import run_fp_pipeline


# Minimal 3-leg violation frame: legacy columns plus _GROUP_ID / _N_GROUPS.
def _viol3(rows: list[dict]) -> pl.DataFrame:
    base = {
        "CONTROL_NAME": "",
        "ENTITLEMENT": "",
        "ROLE_NAME": "",
        "INHERITED_ROLE_NAME": "",
        "PRIVILEGE_NAME": "",
        "_GROUP_ID": 1,
        "_N_GROUPS": 1,
    }
    return pl.DataFrame([{**base, **r} for r in rows])


def _noaction(rows: list[tuple[str, str]]) -> pl.DataFrame:
    return pl.DataFrame(rows, schema=["PRIVILEGE_NAME", "FALSE POSITIVE REASON"], orient="row")


_EMPTY_NA = pl.DataFrame(schema=["PRIVILEGE_NAME", "FALSE POSITIVE REASON"])
_EMPTY_WA = pl.DataFrame(schema=["PRIVILEGE_NAME", "WORK_AREA_PRIVILEGE_CODE"])
_EMPTY_HIER = pl.DataFrame(schema=["ROLE_NAME", "PRIVILEGE_NAME", "INHERITED_ROLE_NAME"])


def _run(df: pl.DataFrame, no_action: pl.DataFrame = _EMPTY_NA) -> pl.DataFrame:
    return run_fp_pipeline(
        df, no_action, _EMPTY_WA, _EMPTY_HIER, entity_col="ROLE_NAME", is_sod=True
    )


def _fp_of(out: pl.DataFrame, entitlement: str) -> tuple[str, str]:
    row = out.filter(pl.col("ENTITLEMENT") == entitlement)
    return row["Potential FP"][0], row["Reason"][0]


def test_or_only_control_all_rows_sl_before_levels_1_2():
    # OR-only control (_N_GROUPS == 1): every row is SL with the SA-style reason,
    # even though P1 is in the no-action DB — level 0 runs before level 1.
    df = _viol3([
        {"CONTROL_NAME": "C_OR", "ENTITLEMENT": "E1", "ROLE_NAME": "R1",
         "PRIVILEGE_NAME": "P1", "_GROUP_ID": 1, "_N_GROUPS": 1},
        {"CONTROL_NAME": "C_OR", "ENTITLEMENT": "E2", "ROLE_NAME": "R1",
         "PRIVILEGE_NAME": "P2", "_GROUP_ID": 1, "_N_GROUPS": 1},
    ])
    out = _run(df, _noaction([("P1", "known safe")]))
    for ent in ("E1", "E2"):
        fp, reason = _fp_of(out, ent)
        assert fp == "SL", f"{ent}: expected SL, got {fp!r}"
        assert "functions as Sensitive Access" in reason
    # Internal group columns must not leak from the pipeline.
    assert "_GROUP_ID" not in out.columns and "_N_GROUPS" not in out.columns


def test_and_or_one_group_fpd_remaining_or_alternatives_are_sl():
    # E1 AND (E2 OR E3): E1 FP'd at level 1 → only group 2 survives with 2
    # entitlements → SL, not TC (the reported bug).
    df = _viol3([
        {"CONTROL_NAME": "C_AO", "ENTITLEMENT": "E1", "ROLE_NAME": "R1",
         "PRIVILEGE_NAME": "P1", "_GROUP_ID": 1, "_N_GROUPS": 2},
        {"CONTROL_NAME": "C_AO", "ENTITLEMENT": "E2", "ROLE_NAME": "R1",
         "PRIVILEGE_NAME": "P2", "_GROUP_ID": 2, "_N_GROUPS": 2},
        {"CONTROL_NAME": "C_AO", "ENTITLEMENT": "E3", "ROLE_NAME": "R1",
         "PRIVILEGE_NAME": "P3", "_GROUP_ID": 2, "_N_GROUPS": 2},
    ])
    out = _run(df, _noaction([("P1", "known safe")]))
    assert _fp_of(out, "E1")[0] == "FP"
    for ent in ("E2", "E3"):
        fp, reason = _fp_of(out, ent)
        assert fp == "SL", f"{ent}: expected SL, got {fp!r}"
        assert "Only one leg of the control remains" in reason
        assert "'R1'" in reason


def test_and_or_nothing_fpd_is_tc():
    # E1 AND (E2 OR E3), nothing FP'd → both groups survive → TC everywhere.
    df = _viol3([
        {"CONTROL_NAME": "C_AO", "ENTITLEMENT": "E1", "ROLE_NAME": "R1",
         "PRIVILEGE_NAME": "P1", "_GROUP_ID": 1, "_N_GROUPS": 2},
        {"CONTROL_NAME": "C_AO", "ENTITLEMENT": "E2", "ROLE_NAME": "R1",
         "PRIVILEGE_NAME": "P2", "_GROUP_ID": 2, "_N_GROUPS": 2},
        {"CONTROL_NAME": "C_AO", "ENTITLEMENT": "E3", "ROLE_NAME": "R1",
         "PRIVILEGE_NAME": "P3", "_GROUP_ID": 2, "_N_GROUPS": 2},
    ])
    out = _run(df)
    for ent in ("E1", "E2", "E3"):
        fp, reason = _fp_of(out, ent)
        assert fp == "TC", f"{ent}: expected TC, got {fp!r}"
        assert "multiple conflicting legs" in reason


def test_and_and_one_of_three_legs_fpd_still_tc():
    # E1 AND E2 AND E3 (3 groups): one leg FP'd → 2 groups survive → still TC.
    df = _viol3([
        {"CONTROL_NAME": "C_AA", "ENTITLEMENT": "E1", "ROLE_NAME": "R1",
         "PRIVILEGE_NAME": "P1", "_GROUP_ID": 1, "_N_GROUPS": 3},
        {"CONTROL_NAME": "C_AA", "ENTITLEMENT": "E2", "ROLE_NAME": "R1",
         "PRIVILEGE_NAME": "P2", "_GROUP_ID": 2, "_N_GROUPS": 3},
        {"CONTROL_NAME": "C_AA", "ENTITLEMENT": "E3", "ROLE_NAME": "R1",
         "PRIVILEGE_NAME": "P3", "_GROUP_ID": 3, "_N_GROUPS": 3},
    ])
    out = _run(df, _noaction([("P1", "known safe")]))
    assert _fp_of(out, "E1")[0] == "FP"
    assert _fp_of(out, "E2")[0] == "TC"
    assert _fp_of(out, "E3")[0] == "TC"


def test_and_and_two_of_three_legs_fpd_is_sl():
    # E1 AND E2 AND E3: two legs FP'd → 1 group survives → SL.
    df = _viol3([
        {"CONTROL_NAME": "C_AA", "ENTITLEMENT": "E1", "ROLE_NAME": "R1",
         "PRIVILEGE_NAME": "P1", "_GROUP_ID": 1, "_N_GROUPS": 3},
        {"CONTROL_NAME": "C_AA", "ENTITLEMENT": "E2", "ROLE_NAME": "R1",
         "PRIVILEGE_NAME": "P2", "_GROUP_ID": 2, "_N_GROUPS": 3},
        {"CONTROL_NAME": "C_AA", "ENTITLEMENT": "E3", "ROLE_NAME": "R1",
         "PRIVILEGE_NAME": "P3", "_GROUP_ID": 3, "_N_GROUPS": 3},
    ])
    out = _run(df, _noaction([("P1", "known safe"), ("P2", "also safe")]))
    assert _fp_of(out, "E1")[0] == "FP"
    assert _fp_of(out, "E2")[0] == "FP"
    fp, reason = _fp_of(out, "E3")
    assert fp == "SL"
    assert "Only one leg of the control remains" in reason


def test_legacy_frame_without_group_columns_keeps_entitlement_count():
    # 2-leg shape (no _GROUP_ID/_N_GROUPS): one entitlement FP'd → 1 pending
    # entitlement → SL with the legacy reason text.
    base = {"CONTROL_NAME": "C_2L", "ROLE_NAME": "R1", "INHERITED_ROLE_NAME": ""}
    df = pl.DataFrame([
        {**base, "ENTITLEMENT": "E1", "PRIVILEGE_NAME": "P1"},
        {**base, "ENTITLEMENT": "E2", "PRIVILEGE_NAME": "P2"},
    ])
    out = _run(df, _noaction([("P1", "known safe")]))
    assert _fp_of(out, "E1")[0] == "FP"
    fp, reason = _fp_of(out, "E2")
    assert fp == "SL"
    assert "Only one entitlement remains" in reason

    # Nothing FP'd → 2 pending entitlements → legacy TC reason.
    out2 = _run(df)
    for ent in ("E1", "E2"):
        fp, reason = _fp_of(out2, ent)
        assert fp == "TC", f"{ent}: expected TC, got {fp!r}"
        assert "Both entitlements required by the control are present" in reason
