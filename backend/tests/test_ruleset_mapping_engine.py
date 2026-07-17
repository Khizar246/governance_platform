"""Engine tests for Ruleset Mapping — the outer control-matching engine.

The inner entitlement engine has its own suite (test_entitlement_name_similarity);
here entitlement matches are made certain by construction (identical name +
identical privileges + same module → confident Direct match) so the tests pin
the CONTROL-level semantics: Direct vs Derived vs Unmatched for SoD, the
never-Derived rule for SA, missing-controls/missing-privileges sheets,
direction-aware headers, summary counts, and the Excel workbook.

Run:
    backend/venv/Scripts/python.exe -m pytest backend/tests/test_ruleset_mapping_engine.py -v
"""
from __future__ import annotations

import pandas as pd
import pytest

from engines.ruleset_mapping_engine import run_ruleset_mapping


# ── Fixtures ───────────────────────────────────────────────────────────────────
# Shared entitlements (identical on both sides → certain matches):
#   Create Payments   → P1, P2   (Payables)
#   Approve Payments  → P3, P4   (Payables)
#   Maintain Suppliers→ P5, P6 client / P5, P6, P7 EY  (Procurement; P7 = gap)
# Client-only: "Client Special Ent" (Z1, Z2) — nothing similar on the EY side.
#
# Client SoD:  C-SOD-1 Create+Approve  → EY-SOD-1 pairs the same two → Direct
#              C-SOD-2 Create+Maintain → no EY control pairs them    → Derived
#              C-SOD-3 Special+Approve → LHS entitlement unmapped    → Unmatched
# Client SA:   C-SA-1 Maintain Suppliers → EY-SA-1 on same ent → Direct
#              C-SA-2 Create Payments    → ent maps, no EY SA control → Unmatched
#              C-SA-3 Client Special Ent → ent unmapped               → Unmatched

def _sod(rows: list[tuple[str, str, str]]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=["Control Name", "LHS Entitlement", "RHS Entitlement"])


def _sa(rows: list[tuple[str, str]]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=["Control Name", "Entitlement"])


def _e2p(rows: list[tuple[str, str, str]]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=["Entitlement Name", "Privilege Code", "Module"])


def _client_frames() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    sod = _sod([
        ("C-SOD-1", "Create Payments", "Approve Payments"),
        ("C-SOD-2", "Create Payments", "Maintain Suppliers"),
        ("C-SOD-3", "Client Special Ent", "Approve Payments"),
    ])
    sa = _sa([
        ("C-SA-1", "Maintain Suppliers"),
        ("C-SA-2", "Create Payments"),
        ("C-SA-3", "Client Special Ent"),
    ])
    e2p = _e2p([
        ("Create Payments",    "P1", "Payables"),
        ("Create Payments",    "P2", "Payables"),
        ("Approve Payments",   "P3", "Payables"),
        ("Approve Payments",   "P4", "Payables"),
        ("Maintain Suppliers", "P5", "Procurement"),
        ("Maintain Suppliers", "P6", "Procurement"),
        ("Client Special Ent", "Z1", "Misc"),
        ("Client Special Ent", "Z2", "Misc"),
    ])
    return sod, sa, e2p


def _ey_frames() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    sod = _sod([
        ("EY-SOD-1", "Create Payments", "Approve Payments"),
    ])
    sa = _sa([
        ("EY-SA-1", "Maintain Suppliers"),
    ])
    e2p = _e2p([
        ("Create Payments",    "P1", "Payables"),
        ("Create Payments",    "P2", "Payables"),
        ("Approve Payments",   "P3", "Payables"),
        ("Approve Payments",   "P4", "Payables"),
        ("Maintain Suppliers", "P5", "Procurement"),
        ("Maintain Suppliers", "P6", "Procurement"),
        ("Maintain Suppliers", "P7", "Procurement"),
    ])
    return sod, sa, e2p


@pytest.fixture(scope="module")
def result():
    """One full bidirectional run shared by every test in this module."""
    c_sod, c_sa, c_e2p = _client_frames()
    e_sod, e_sa, e_e2p = _ey_frames()
    res = run_ruleset_mapping(c_sod, c_sa, c_e2p, e_sod, e_sa, e_e2p)
    assert res.success, res.errors
    return res.data


def _row(df: pd.DataFrame, src_col: str, name: str) -> pd.Series:
    rows = df[df[src_col] == name]
    assert len(rows) == 1, f"expected 1 row for {name}, got {len(rows)}"
    return rows.iloc[0]


# ── SoD control matching (Client → EY) ────────────────────────────────────────

def test_sod_direct_match_finds_existing_ey_control(result):
    r = _row(result["c2e"]["sod_df"], "Client Control Name", "C-SOD-1")
    assert r["Match Type"] == "Direct"
    assert r["EY Control Name"] == "EY-SOD-1"
    assert r["Confidence Score"] != "0%"


def test_sod_derived_when_no_ey_control_pairs_the_entitlements(result):
    r = _row(result["c2e"]["sod_df"], "Client Control Name", "C-SOD-2")
    assert r["Match Type"] == "Derived Control"
    assert r["EY Control Name"] == "[Create Payments] AND [Maintain Suppliers]"


def test_sod_unmatched_when_one_entitlement_has_no_mapping(result):
    r = _row(result["c2e"]["sod_df"], "Client Control Name", "C-SOD-3")
    assert r["Match Type"] == "Unmatched"
    assert r["EY Control Name"] == "—"
    assert r["Confidence Score"] == "0%"


# ── SA control matching (Client → EY) ─────────────────────────────────────────

def test_sa_direct_match(result):
    r = _row(result["c2e"]["sa_df"], "Client Control Name", "C-SA-1")
    assert r["Match Type"] == "Direct"
    assert r["EY Control Name"] == "EY-SA-1"


def test_sa_unmatched_when_ent_maps_but_no_ey_sa_control_exists(result):
    # "Create Payments" maps as an entitlement, but EY has no SA control on it.
    r = _row(result["c2e"]["sa_df"], "Client Control Name", "C-SA-2")
    assert r["Match Type"] == "Unmatched"


def test_sa_is_never_derived(result):
    for direction in ("c2e", "e2c"):
        types = set(result[direction]["sa_df"]["Match Type"])
        assert types <= {"Direct", "Unmatched"}, types


# ── Missing controls / missing privileges ─────────────────────────────────────

def test_missing_controls_lists_every_unmatched_control(result):
    mc = result["c2e"]["missing_ctrl_df"]
    got = set(zip(mc["Control Name"], mc["Control Type"]))
    assert got == {("C-SOD-3", "SoD"), ("C-SA-2", "SA"), ("C-SA-3", "SA")}


def test_missing_privileges_lists_the_ey_gap_one_per_row(result):
    mp = result["c2e"]["missing_priv_df"]
    assert list(mp.columns) == [
        "Client Entitlement", "Best Matched EY Entitlement", "Missing Privilege",
    ]
    # Only gap by construction: EY "Maintain Suppliers" has P7, client's doesn't.
    assert mp.to_dict(orient="records") == [{
        "Client Entitlement": "Maintain Suppliers",
        "Best Matched EY Entitlement": "Maintain Suppliers",
        "Missing Privilege": "P7",
    }]


# ── Direction awareness ────────────────────────────────────────────────────────

def test_reverse_direction_swaps_headers_and_maps_back(result):
    e2c_sod = result["e2c"]["sod_df"]
    assert list(e2c_sod.columns)[:2] == ["EY Control Name", "Client Control Name"]
    # EY-SOD-1 pairs Create+Approve — the client's C-SOD-1 pairs the same two.
    r = _row(e2c_sod, "EY Control Name", "EY-SOD-1")
    assert r["Match Type"] == "Direct"
    assert r["Client Control Name"] == "C-SOD-1"


# ── Summary counts ─────────────────────────────────────────────────────────────

def test_counts_match_the_constructed_fixture(result):
    c = result["c2e"]["counts"]
    assert c["sod_total"] == 3 and c["sod_direct"] == 1
    assert c["sod_derived"] == 1 and c["sod_unmatched"] == 1
    assert c["sa_total"] == 3 and c["sa_direct"] == 1
    assert c["sa_derived"] == 0 and c["sa_unmatched"] == 2
    assert c["missing_ctrl_total"] == 3
    assert c["missing_priv_total"] == 1


def test_summary_exposes_flat_and_per_direction_blocks(result):
    summary = result["summary"]
    assert summary["sod_total"] == summary["c2e"]["sod_total"] == 3
    assert "e2c" in summary
    assert summary["e2c"]["sod_total"] == 1  # EY side has one SoD control


# ── Excel workbook ─────────────────────────────────────────────────────────────

def test_excel_workbook_has_all_ten_sheets(result):
    xls = pd.ExcelFile(result["excel_buffer"])
    assert xls.sheet_names == [
        "SoD Mapping (Client to EY)",
        "SA Mapping (Client to EY)",
        "Client Controls Missing in EY",
        "Missing Privileges (C to EY)",
        "SoD Mapping (EY to Client)",
        "SA Mapping (EY to Client)",
        "EY Controls Missing in Client",
        "Missing Privileges (EY to C)",
        "Entitlement Mapping (C to EY)",
        "Entitlement Mapping (EY to C)",
    ]


def test_excel_data_starts_below_the_description_rows(result):
    # Layout contract: row 0 = sheet description, row 1 = column descriptors,
    # row 2 = headers, row 3+ = data (readers skip the first two rows).
    df = pd.read_excel(
        result["excel_buffer"], sheet_name="SoD Mapping (Client to EY)", header=2,
    )
    assert list(df.columns)[:2] == ["Client Control Name", "EY Control Name"]
    assert set(df["Client Control Name"]) == {"C-SOD-1", "C-SOD-2", "C-SOD-3"}
