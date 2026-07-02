"""Validation tests for the SOD & SA Analysis upload/run flow.

Each test builds a valid baseline upload, breaks exactly ONE thing, and asserts
the response status code, JSON `code`, and that the expected message substring
(from inventory.SCENARIOS) appears. One test per documented scenario.

Run:
    backend/venv/Scripts/python.exe -m pytest backend/tests/test_sod_sa_validation.py -v
"""

from __future__ import annotations

import pandas as pd
import pytest

from tests import builders as b
from tests.inventory import SCENARIOS

_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_BY_ID = {s.id: s for s in SCENARIOS}


def _S(sid):
    return _BY_ID[sid]


# Standard valid parts ((filename, bytes, content_type) tuples) ----------------

def rh(name="role_hierarchy.xlsx", data=None, ct=_XLSX):
    return (name, b.role_hierarchy_xlsx() if data is None else data, ct)


def rs(name="ruleset.xlsx", sheets=None, ct=_XLSX):
    return (name, b.ruleset_xlsx(sheets), ct)


def ur(name="user_role.xlsx", data=None, ct=_XLSX):
    return (name, b.user_role_xlsx() if data is None else data, ct)


def fp(name="fp_db.xlsx", sheets=None, ct=_XLSX):
    return (name, b.fp_db_xlsx(sheets), ct)


def _assert(resp, scenario):
    assert resp.status_code == scenario.http, (
        f"[{scenario.id}] expected HTTP {scenario.http}, got {resp.status_code}: {resp.text[:400]}"
    )
    body = resp.json()
    if scenario.code:
        assert body.get("code") == scenario.code, (
            f"[{scenario.id}] expected code {scenario.code}, got {body.get('code')}: {body}"
        )
    assert scenario.expect in resp.text, (
        f"[{scenario.id}] expected text {scenario.expect!r} not found in: {resp.text[:600]}"
    )


# ── Phase 0 ──────────────────────────────────────────────────────────────────

def test_ext_unsupported(upload):
    r = upload(role_hierarchy=rh("role_hierarchy.txt"), ruleset=rs())
    _assert(r, _S("ext_unsupported"))


def test_empty_file(upload):
    r = upload(role_hierarchy=rh("role_hierarchy.xlsx", data=b""), ruleset=rs())
    _assert(r, _S("empty_file"))


def test_xlsx_bad_magic(upload):
    r = upload(role_hierarchy=rh(), ruleset=("ruleset.xlsx", b"not a real xlsx", _XLSX))
    _assert(r, _S("xlsx_bad_magic"))


def test_xls_bad_magic(upload):
    r = upload(role_hierarchy=rh(), ruleset=("ruleset.xls", b"not a real xls", "application/vnd.ms-excel"))
    _assert(r, _S("xls_bad_magic"))


def test_csv_is_excel(upload):
    # A real xlsx renamed to .csv → magic bytes reveal Excel binary.
    r = upload(role_hierarchy=("role_hierarchy.csv", b.role_hierarchy_xlsx(), "text/csv"), ruleset=rs())
    _assert(r, _S("csv_is_excel"))


def test_ruleset_csv_ext(upload):
    r = upload(role_hierarchy=rh(), ruleset=("ruleset.csv", b.role_hierarchy_xlsx(), "text/csv"))
    _assert(r, _S("ruleset_csv_ext"))


def test_no_ruleset_no_seed(upload):
    r = upload(role_hierarchy=rh())  # no ruleset, no seed flag
    _assert(r, _S("no_ruleset_no_seed"))


# ── Phase 1 (missing sheets / columns) ───────────────────────────────────────

def test_rh_missing_col(upload):
    df = b._df(b.ROLE_HIERARCHY_ROWS, b.ROLE_HIERARCHY_COLS).drop(columns=["PRIVILEGE_CODE"])
    data = b._xlsx_bytes({"Sheet1": df})
    r = upload(role_hierarchy=rh(data=data), ruleset=rs())
    _assert(r, _S("rh_missing_col"))


def test_ur_missing_col(upload):
    df = b._df(b.USER_ROLE_ROWS, b.USER_ROLE_COLS).drop(columns=["Assigned Role Name"])
    data = b._xlsx_bytes({"Sheet1": df})
    r = upload(role_hierarchy=rh(), ruleset=rs(), user_role=ur(data=data))
    _assert(r, _S("ur_missing_col"))


def test_ruleset_missing_sheet(upload):
    sheets = b.ruleset_sheets()
    del sheets["SA Ruleset"]
    r = upload(role_hierarchy=rh(), ruleset=rs(sheets=sheets))
    _assert(r, _S("ruleset_missing_sheet"))


def test_ruleset_missing_col(upload):
    sheets = b.ruleset_sheets()
    sheets["SoD Ruleset"] = sheets["SoD Ruleset"].drop(columns=["LHS Entitlement"])
    r = upload(role_hierarchy=rh(), ruleset=rs(sheets=sheets))
    _assert(r, _S("ruleset_missing_col"))


def test_mapping_missing_col(upload):
    sheets = b.ruleset_sheets()
    sheets["Entitlement to Privilege"] = sheets["Entitlement to Privilege"].drop(columns=["Privilege Code"])
    r = upload(role_hierarchy=rh(), ruleset=rs(sheets=sheets))
    _assert(r, _S("mapping_missing_col"))


def test_fp_missing_sheet(upload):
    sheets = b.fp_sheets()
    del sheets["WorkArea_Privileges"]
    r = upload(role_hierarchy=rh(), ruleset=rs(), fp_db=fp(sheets=sheets))
    _assert(r, _S("fp_missing_sheet"))


def test_fp_missing_col(upload):
    sheets = b.fp_sheets()
    sheets["No_action_Privileges"] = sheets["No_action_Privileges"].drop(columns=["False Positive Reason"])
    r = upload(role_hierarchy=rh(), ruleset=rs(), fp_db=fp(sheets=sheets))
    _assert(r, _S("fp_missing_col"))


def test_multi_schema_aggregated(upload):
    rh_df = b._df(b.ROLE_HIERARCHY_ROWS, b.ROLE_HIERARCHY_COLS).drop(columns=["ROLE_CODE"])
    rh_data = b._xlsx_bytes({"Sheet1": rh_df})
    sheets = b.ruleset_sheets()
    del sheets["SoD Ruleset"]
    r = upload(role_hierarchy=rh(data=rh_data), ruleset=rs(sheets=sheets))
    _assert(r, _S("multi_schema_aggregated"))


# ── Phase 2 (load & data) ────────────────────────────────────────────────────

def test_rh_zero_rows(upload):
    df = b._df([], b.ROLE_HIERARCHY_COLS)
    data = b._xlsx_bytes({"Sheet1": df})
    r = upload(role_hierarchy=rh(data=data), ruleset=rs())
    _assert(r, _S("rh_zero_rows"))


def test_sod_zero_rows(upload):
    sheets = b.ruleset_sheets()
    sheets["SoD Ruleset"] = b._df([], b.SOD_COLS)
    r = upload(role_hierarchy=rh(), ruleset=rs(sheets=sheets))
    _assert(r, _S("sod_zero_rows"))


def test_sod_empty_cell(upload):
    sheets = b.ruleset_sheets()
    rows = [("", "ENT_A", "ENT_B")]  # blank Control Name
    sheets["SoD Ruleset"] = b._df(rows, b.SOD_COLS)
    r = upload(role_hierarchy=rh(), ruleset=rs(sheets=sheets))
    _assert(r, _S("sod_empty_cell"))


def test_mapping_empty_cell(upload):
    sheets = b.ruleset_sheets()
    rows = [("ENT_A", "PRIV1"), ("ENT_B", "")]  # blank Privilege Code
    sheets["Entitlement to Privilege"] = b._df(rows, b.MAPPING_COLS)
    r = upload(role_hierarchy=rh(), ruleset=rs(sheets=sheets))
    _assert(r, _S("mapping_empty_cell"))


# ── Phase 3 (integrity) ──────────────────────────────────────────────────────

def test_shared_privilege(upload):
    sheets = b.ruleset_sheets()
    # Map PRIV1 to BOTH ENT_A and ENT_B → both legs of CTRL_SOD_1 share PRIV1.
    rows = [("ENT_A", "PRIV1"), ("ENT_B", "PRIV1")]
    sheets["Entitlement to Privilege"] = b._df(rows, b.MAPPING_COLS)
    r = upload(role_hierarchy=rh(), ruleset=rs(sheets=sheets))
    _assert(r, _S("shared_privilege"))
    items = r.json()["integrity_items"]
    assert len(items) == 1
    assert items[0]["privileges"] == ["PRIV1"]
    assert items[0]["lhs"] == "ENT_A"
    assert items[0]["rhs"] == "ENT_B"


# ── Phase 4 (run-time) ───────────────────────────────────────────────────────

def test_run_no_user_file(client, upload):
    # Upload WITHOUT a user-role file, then run with analysis_type=both.
    r = upload(role_hierarchy=rh(), ruleset=rs())
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    run = client.post(f"/api/sod-sa/run/{job_id}", json={
        "analysis_type": "both", "with_fp": False,
        "selected_analyses": ["user_sod"], "with_observation": False,
    })
    _assert(run, _S("run_no_user_file"))


def test_run_bad_selected(client, upload):
    r = upload(role_hierarchy=rh(), ruleset=rs())
    job_id = r.json()["job_id"]
    run = client.post(f"/api/sod-sa/run/{job_id}", json={
        "analysis_type": "role", "with_fp": False,
        "selected_analyses": ["role_xyz"], "with_observation": False,
    })
    _assert(run, _S("run_bad_selected"))


def test_run_already_running(client, upload):
    r = upload(role_hierarchy=rh(), ruleset=rs(), user_role=ur())
    job_id = r.json()["job_id"]
    payload = {
        "analysis_type": "role", "with_fp": False,
        "selected_analyses": ["role_sod", "role_sa"], "with_observation": False,
    }
    first = client.post(f"/api/sod-sa/run/{job_id}", json=payload)
    assert first.status_code == 200, first.text
    # Second call: the job may have already finished on this tiny dataset, so a
    # 409 is the documented behaviour while RUNNING; if it already completed the
    # endpoint accepts a re-run. Force the racing condition by forcing status.
    from services.job_manager import job_manager
    from models.common import JobStatus
    job_manager.set_status(job_id, JobStatus.RUNNING, "forced for test")
    second = client.post(f"/api/sod-sa/run/{job_id}", json=payload)
    _assert(second, _S("run_already_running"))


def test_obs_missing_inputs(client, upload):
    # Baseline ruleset has no Control Bucket col and no Bucket Details sheet.
    r = upload(role_hierarchy=rh(), ruleset=rs())
    job_id = r.json()["job_id"]
    run = client.post(f"/api/sod-sa/run/{job_id}", json={
        "analysis_type": "role", "with_fp": False,
        "selected_analyses": ["role_sod"], "with_observation": True,
    })
    _assert(run, _S("obs_missing_inputs"))


def test_obs_bucket_xref(client, upload):
    sheets = b.ruleset_sheets()
    sod = sheets["SoD Ruleset"].copy()
    sod["Control Bucket"] = ["BUCKET_X"]  # references a bucket not in details
    sheets["SoD Ruleset"] = sod
    sheets["Bucket Details"] = b._df([("BUCKET1", "High", "Review")], b.BUCKET_DETAILS_COLS)
    r = upload(role_hierarchy=rh(), ruleset=rs(sheets=sheets))
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    run = client.post(f"/api/sod-sa/run/{job_id}", json={
        "analysis_type": "role", "with_fp": False,
        "selected_analyses": ["role_sod"], "with_observation": True,
    })
    _assert(run, _S("obs_bucket_xref"))


# ── Non-blocking warnings ────────────────────────────────────────────────────

def test_warn_no_user_file(upload):
    r = upload(role_hierarchy=rh(), ruleset=rs())  # no user role
    _assert(r, _S("warn_no_user_file"))


def test_warn_recommended_col(upload):
    sheets = b.ruleset_sheets()
    sod = sheets["SoD Ruleset"].copy()
    sod["Risk Ranking"] = ["High"]
    sheets["SoD Ruleset"] = sod.drop(columns=["Risk Ranking"])  # ensure absent
    r = upload(role_hierarchy=rh(), ruleset=rs(sheets=sheets))
    _assert(r, _S("warn_recommended_col"))


def test_warn_missing_entitlement(upload):
    sheets = b.ruleset_sheets()
    # Add a SA control that references ENT_UNMAPPED with no mapping row.
    sa = b._df([("CTRL_SA_1", "ENT_A"), ("CTRL_SA_2", "ENT_UNMAPPED")], b.SA_COLS)
    sheets["SA Ruleset"] = sa
    r = upload(role_hierarchy=rh(), ruleset=rs(sheets=sheets))
    _assert(r, _S("warn_missing_entitlement"))


def test_inventory_fully_covered():
    """Guard: every inventory scenario has a matching test_ function."""
    import tests.test_sod_sa_validation as mod
    defined = {n[len("test_"):] for n in dir(mod) if n.startswith("test_")}
    missing = [s.id for s in SCENARIOS if s.id not in defined]
    assert not missing, f"Scenarios without a test: {missing}"
