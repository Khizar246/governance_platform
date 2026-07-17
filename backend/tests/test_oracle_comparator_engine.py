"""Engine tests for the Oracle Comparator.

Synthetic two-environment fixtures where every match/mismatch is known by
construction. Covers: compare() status + mismatch-reason semantics, dedup,
the DSP grant-end-date flag, run_analysis type gating and column
normalization, worker step events, and the Excel report (sheets + summary
counts).

Run:
    backend/venv/Scripts/python.exe -m pytest backend/tests/test_oracle_comparator_engine.py -v
"""
from __future__ import annotations

import io

import pandas as pd
import polars as pl

from engines.oracle_comparator_engine import compare, generate_report, run_analysis
from services.analysis_workers import run_oracle_comparator_job


# ── Fixtures ───────────────────────────────────────────────────────────────────
# ENV1 (Prod) RBAC:
#   duty pairs:  (AP Manager ← AP Clerk), (GL User ← GL Base)
#   privileges:  AP Manager: Create Invoice, Approve Invoice; GL User: Post Journal
# ENV2 (UAT) RBAC:
#   duty pairs:  (AP Manager ← AP Clerk), (Inventory User ← Inv Base)
#   privileges:  AP Manager: Create Invoice, Void Invoice; Inventory User: Count Stock

def _rbac_env1() -> pl.DataFrame:
    return pl.DataFrame({
        "ROLE NAME":           ["AP Manager", "AP Manager", "GL User"],
        "ENTITLEMENT":         ["Create Invoice", "Approve Invoice", "Post Journal"],
        "INHERITED ROLE NAME": ["AP Clerk", "AP Clerk", "GL Base"],
    })


def _rbac_env2() -> pl.DataFrame:
    return pl.DataFrame({
        "ROLE NAME":           ["AP Manager", "AP Manager", "Inventory User"],
        "ENTITLEMENT":         ["Create Invoice", "Void Invoice", "Count Stock"],
        "INHERITED ROLE NAME": ["AP Clerk", "AP Clerk", "Inv Base"],
    })


def _dsp(rows: list[tuple[str, str, str, str, str, str]]) -> pl.DataFrame:
    return pl.DataFrame(
        rows,
        schema=["ROLE NAME", "INHERITED ROLE NAME", "GRANT END DATE",
                "OBJECT NAME", "FUNCTION NAME", "INSTANCE SET NAME"],
        orient="row",
    )


def _status_of(df: pl.DataFrame, **key: str) -> str:
    out = df
    for col, val in key.items():
        out = out.filter(pl.col(col.replace("_", " ")) == val)
    assert out.height == 1, f"expected exactly 1 row for {key}, got {out.height}"
    return out["Status"][0]


def _reason_of(df: pl.DataFrame, **key: str) -> str:
    out = df
    for col, val in key.items():
        out = out.filter(pl.col(col.replace("_", " ")) == val)
    assert out.height == 1
    return out["Reason"][0]


# ── compare(): status + reason semantics ──────────────────────────────────────

def test_compare_match_gets_exists_status():
    res = compare(_rbac_env1(), _rbac_env2(), "privilege", "UAT")
    assert _status_of(res, ROLE_NAME="AP Manager", ENTITLEMENT="Create Invoice") == "Exists in UAT"
    assert _reason_of(res, ROLE_NAME="AP Manager", ENTITLEMENT="Create Invoice") == "Match found"


def test_compare_missing_value_names_the_absent_column():
    res = compare(_rbac_env1(), _rbac_env2(), "privilege", "UAT")
    # AP Manager exists in UAT, but "Approve Invoice" appears nowhere in UAT.
    assert _status_of(res, ROLE_NAME="AP Manager", ENTITLEMENT="Approve Invoice") == "Missing in UAT"
    assert _reason_of(res, ROLE_NAME="AP Manager", ENTITLEMENT="Approve Invoice") == \
        "Value(s) missing in UAT: ENTITLEMENT"


def test_compare_fully_absent_row_names_every_column():
    res = compare(_rbac_env1(), _rbac_env2(), "duty_role", "UAT")
    # Neither "GL User" nor "GL Base" appears anywhere in UAT.
    assert _reason_of(res, ROLE_NAME="GL User", INHERITED_ROLE_NAME="GL Base") == \
        "Value(s) missing in UAT: ROLE NAME, INHERITED ROLE NAME"


def test_compare_combination_not_found_reason():
    # Both values exist individually in the target, but never on the same row.
    src = pl.DataFrame({"ROLE NAME": ["R1"], "ENTITLEMENT": ["E1"]})
    tgt = pl.DataFrame({"ROLE NAME": ["R1", "R2"], "ENTITLEMENT": ["E2", "E1"]})
    res = compare(src, tgt, "privilege", "UAT")
    assert _reason_of(res, ROLE_NAME="R1", ENTITLEMENT="E1") == \
        "Combination not found in UAT (individual values exist separately)"


def test_compare_deduplicates_source_rows():
    src = pl.concat([_rbac_env1(), _rbac_env1()])  # every row twice
    res = compare(src, _rbac_env2(), "privilege", "UAT")
    assert res.height == 3  # 3 unique (role, entitlement) pairs, not 6


def test_compare_counts_split_correctly():
    res = compare(_rbac_env1(), _rbac_env2(), "privilege", "UAT")
    assert res.filter(pl.col("Status") == "Exists in UAT").height == 1
    assert res.filter(pl.col("Status") == "Missing in UAT").height == 2


def test_compare_dsp_grant_end_date_flag():
    env1 = _dsp([
        ("R1", "Base", "2027-01-01",        "ObjA", "FnA", "SetA"),
        ("R2", "Base", "No Data Available", "ObjB", "FnB", "SetB"),
    ])
    res = compare(env1, env1, "dsp", "UAT")
    flags = {r["ROLE NAME"]: r["Is grant end date available?"] for r in res.to_dicts()}
    assert flags == {"R1": "Yes", "R2": "No"}


# ── run_analysis(): type gating + normalization + failure path ────────────────

def test_run_analysis_rbac_produces_both_directions():
    res = run_analysis(
        {"rbac_file1": _rbac_env1(), "rbac_file2": _rbac_env2()},
        "rbac", "Prod", "UAT",
    )
    assert res.success
    r1to2, r2to1 = res.data
    assert set(r1to2) == {"duty_role", "privilege"}
    assert set(r2to1) == {"duty_role", "privilege"}
    # Directions are asymmetric: UAT-only rows are missing only in the 2→1 view.
    assert r2to1["privilege"].filter(
        (pl.col("ROLE NAME") == "Inventory User") & (pl.col("Status") == "Missing in Prod")
    ).height == 1


def test_run_analysis_dsp_only_runs_dsp():
    dsp = _dsp([("R1", "Base", "2027-01-01", "ObjA", "FnA", "SetA")])
    res = run_analysis({"dsp_file1": dsp, "dsp_file2": dsp}, "dsp", "Prod", "UAT")
    assert res.success
    r1to2, _ = res.data
    assert set(r1to2) == {"dsp"}


def test_run_analysis_normalizes_column_names():
    messy = _rbac_env1().rename({
        "ROLE NAME": " role name ", "ENTITLEMENT": "entitlement",
        "INHERITED ROLE NAME": "Inherited Role Name",
    })
    res = run_analysis({"rbac_file1": messy, "rbac_file2": _rbac_env2()}, "rbac", "P", "U")
    assert res.success
    assert res.data[0]["privilege"].filter(pl.col("Status") == "Exists in U").height == 1


def test_run_analysis_missing_file_fails_cleanly():
    res = run_analysis({"rbac_file1": _rbac_env1()}, "rbac", "Prod", "UAT")
    assert not res.success
    assert res.errors


# ── Worker: step events + payload shape ───────────────────────────────────────

class _FakeQueue:
    def __init__(self) -> None:
        self.items: list[tuple] = []

    def put(self, item: tuple) -> None:
        self.items.append(item)


def test_worker_emits_monotonic_steps_and_payload():
    q = _FakeQueue()
    payload = run_oracle_comparator_job(
        "job-1", q,
        {"rbac_file1": _rbac_env1(), "rbac_file2": _rbac_env2()},
        "rbac", "Prod", "UAT",
    )
    assert set(payload) == {"summary", "result_dfs", "output_bytes", "output_filename"}
    assert payload["summary"]["comparisons"]  # non-empty summary rows
    assert payload["output_bytes"][:2] == b"PK"  # xlsx magic bytes

    steps = [m[2] for m in q.items if m[0] == "step"]
    assert steps == sorted(steps), f"step events must be monotonic, got {steps}"
    assert steps[0] == 1 and steps[-1] == 6
    assert {2, 3} <= set(steps)  # rbac runs duty-role + privilege steps
    assert 4 not in steps        # no DSP step on an rbac-only run


# ── generate_report(): sheets + summary counts ────────────────────────────────

def test_generate_report_sheets_and_summary_counts():
    res = run_analysis(
        {"rbac_file1": _rbac_env1(), "rbac_file2": _rbac_env2()},
        "rbac", "Prod", "UAT",
    )
    r1to2, r2to1 = res.data
    report = generate_report(r1to2, r2to1, "Prod", "UAT")
    assert report.success

    buf = io.BytesIO(report.data)
    sheets = pd.ExcelFile(buf).sheet_names
    assert sheets == [
        "Summary",
        "Prod_to_UAT_Duty_Role", "Prod_to_UAT_Privilege",
        "UAT_to_Prod_Duty_Role", "UAT_to_Prod_Privilege",
    ]

    summary = pd.read_excel(io.BytesIO(report.data), sheet_name="Summary")
    row = summary[(summary["Analysis Type"] == "Privilege")
                  & (summary["Direction"] == "Prod → UAT")].iloc[0]
    # ENV1 has 3 unique privilege pairs; only (AP Manager, Create Invoice) exists in UAT.
    assert row["Total Records"] == 3
    assert row["Matches"] == 1
    assert row["Missing"] == 2
    assert row["Match Rate (%)"] == 33.3


# ── Router /run: trusts stored job.config, not client-resent body (Q-1) ───────

def _seed_oracle_job(analysis_type="rbac", env1="Prod", env2="UAT", with_config=True):
    """Create an Oracle job with files + (optionally) upload config, as /upload would."""
    from services.job_manager import job_manager
    job = job_manager.create_job("oracle_comparator")
    job_manager.store_files(job.id, {"rbac_file1": _rbac_env1(), "rbac_file2": _rbac_env2()})
    if with_config:
        job_manager.set_config(job.id, {
            "analysis_type": analysis_type, "env1_name": env1, "env2_name": env2,
        })
    return job.id


def test_run_uses_stored_config_ignoring_client_body(client, monkeypatch):
    # /run must submit the analysis with the config captured at upload — NOT the
    # (here deliberately wrong) analysis_type/env names resent in the request body.
    from services import analysis_pool as pool_mod

    captured: dict = {}

    def _fake_submit(job_id, fn, files, analysis_type, env1_name, env2_name, on_done):
        captured.update(analysis_type=analysis_type, env1=env1_name, env2=env2_name)
        from services.job_manager import job_manager
        from models.common import JobStatus
        job_manager.set_status(job_id, JobStatus.RUNNING, "queued")

    monkeypatch.setattr(pool_mod.analysis_pool, "submit", _fake_submit)
    monkeypatch.setattr("routers.oracle_comparator.analysis_pool.submit", _fake_submit)

    job_id = _seed_oracle_job(analysis_type="rbac", env1="Prod", env2="UAT")
    resp = client.post(f"/api/oracle-comparator/run/{job_id}", json={
        "analysis_type": "dsp",       # lie — files are RBAC
        "env1_name": "HACKED",
        "env2_name": "HACKED2",
    })
    assert resp.status_code == 200
    assert captured == {"analysis_type": "rbac", "env1": "Prod", "env2": "UAT"}


def test_run_rejects_job_with_missing_config(client):
    # A job whose config was never set (shouldn't happen via /upload) is rejected,
    # not run against unknown parameters.
    job_id = _seed_oracle_job(with_config=False)
    resp = client.post(f"/api/oracle-comparator/run/{job_id}", json={
        "analysis_type": "rbac", "env1_name": "Prod", "env2_name": "UAT",
    })
    assert resp.status_code == 400
    assert resp.json()["code"] == "FILES_NOT_FOUND"


def test_results_missing_cache_returns_400_not_ready_not_404(client):
    # Q-1 status-code alignment: an existing job whose results aren't cached yet
    # returns 400 NOT_READY (like SOD & SA / Ruleset), not a blanket 404.
    job_id = _seed_oracle_job()
    resp = client.get(f"/api/oracle-comparator/results/{job_id}",
                      params={"direction": "1to2", "comparison_type": "duty_role"})
    assert resp.status_code == 400
    assert resp.json()["code"] == "NOT_READY"


def test_results_unknown_job_still_404(client):
    # A genuinely unknown job_id still surfaces as 404 (via get_job).
    resp = client.get("/api/oracle-comparator/results/no-such-job",
                      params={"direction": "1to2", "comparison_type": "duty_role"})
    assert resp.status_code == 404


# ── job_manager.try_begin_run: atomic compare-and-set for the /run 409 race ────

def test_try_begin_run_claims_once_then_rejects():
    from services.job_manager import job_manager
    from models.common import JobStatus

    job = job_manager.create_job("oracle_comparator")

    # First claim wins and flips the job to RUNNING; the second is rejected —
    # this is what makes two simultaneous /run POSTs safe (one 200, one 409).
    assert job_manager.try_begin_run(job.id) is True
    assert job_manager.get_job(job.id).status == JobStatus.RUNNING
    assert job_manager.try_begin_run(job.id) is False


def test_try_begin_run_missing_job_returns_false():
    from services.job_manager import job_manager
    assert job_manager.try_begin_run("no-such-job") is False
