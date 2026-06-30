"""Unit tests for entitlement mapping: name-similarity helper, Module-aware
composite scoring, name as a final tiebreaker, and the Manufacturing regression.

Run:
    backend/venv/Scripts/python.exe -m pytest backend/tests/test_entitlement_name_similarity.py -v
"""
from __future__ import annotations

from engines.entitlement_mapping_engine import (
    normalized_name_similarity,
    _normalize_name_tokens,
)


def test_abbreviation_expands_to_full_phrase():
    # "AP" must expand so it matches the spelled-out form
    assert "accounts" in _normalize_name_tokens("Process AP Payments")
    assert "payable" in _normalize_name_tokens("Process AP Payments")


def test_ap_and_ar_are_disjoint():
    # The core swap-fix invariant: AP and AR must NOT normalize alike.
    ap = _normalize_name_tokens("Process AP Payments")
    ar = _normalize_name_tokens("Process AR Payments")
    assert ap != ar
    assert "payable" in ap and "payable" not in ar
    assert "receivable" in ar and "receivable" not in ap


def test_identical_names_score_one():
    assert normalized_name_similarity("Process AP Payments", "Process AP Payments") == 1.0


def test_ap_vs_ar_scores_low():
    # Differ by one letter as raw strings, but semantically distinct after expansion.
    assert normalized_name_similarity("Process AP Payments", "Process AR Payments") < 0.75


def test_abbrev_matches_spelled_out():
    # "Create Maintain AP Invoice" ~= "Create Maintain Accounts Payable Invoice"
    score = normalized_name_similarity(
        "Create Maintain AP Invoice",
        "Create Maintain Accounts Payable Invoice",
    )
    assert score > 0.9


import pandas as pd

from engines.entitlement_mapping_engine import run_mapping


def _df(rows):
    """Rows are (Entitlement Name, Privilege Code, Module). Module may be ""."""
    return pd.DataFrame(rows, columns=["Entitlement Name", "Privilege Code", "Module"])


def _match_for(result_df, client_ent):
    row = result_df[result_df["Client Entitlement"] == client_ent].iloc[0]
    return row["EY Entitlement Match"]


def test_ap_ar_disambiguated_by_name_tiebreaker():
    # Both AP and AR client entitlements share identical privilege overlap with both
    # EY candidates and the same (blank) module, so composite scores tie — name
    # similarity is the FINAL tiebreaker and must keep AP→AP, AR→AR.
    client = _df([
        ("Process AP Payments", "P1", ""),
        ("Process AP Payments", "P2", ""),
        ("Process AR Payments", "P3", ""),
        ("Process AR Payments", "P4", ""),
    ])
    ey = _df([
        ("Process AP Payments", "P1", ""),
        ("Process AP Payments", "P2", ""),
        ("Process AP Payments", "P3", ""),
        ("Process AP Payments", "P4", ""),
        ("Process AR Payments", "P1", ""),
        ("Process AR Payments", "P2", ""),
        ("Process AR Payments", "P3", ""),
        ("Process AR Payments", "P4", ""),
    ])
    res = run_mapping(client, ey)
    assert res.success
    assert _match_for(res.data, "Process AP Payments") == "Process AP Payments"
    assert _match_for(res.data, "Process AR Payments") == "Process AR Payments"


def test_module_match_breaks_a_priv_tie():
    # Two EY candidates with identical privilege overlap; the one sharing the client's
    # Module wins via the 20% module term (name is irrelevant here).
    client = _df([
        ("Client Ent X", "P1", "Fixed Assets"),
        ("Client Ent X", "P2", "Fixed Assets"),
    ])
    ey = _df([
        ("EY Alpha", "P1", "Accounts Payable"),
        ("EY Alpha", "P2", "Accounts Payable"),
        ("EY Beta",  "P1", "Fixed Assets"),
        ("EY Beta",  "P2", "Fixed Assets"),
    ])
    res = run_mapping(client, ey)
    assert res.success
    assert _match_for(res.data, "Client Ent X") == "EY Beta"


def test_module_match_outweighs_better_privilege_fit():
    # EY "Asset Configuration" is a stronger pure-privilege fit, but client
    # "Asset Reimbursement" shares the Module with EY "Asset Reimbursement", and the
    # 20% module bonus tips the composite back to the correctly-named entitlement.
    client = _df([
        ("Asset Reimbursement", "A1", "Fixed Assets"),
        ("Asset Reimbursement", "A2", "Fixed Assets"),
        ("Asset Reimbursement", "A3", "Fixed Assets"),
    ])
    ey = _df([
        ("Asset Configuration", "A1", "General Ledger"),
        ("Asset Configuration", "A2", "General Ledger"),
        ("Asset Configuration", "A3", "General Ledger"),
        ("Asset Reimbursement", "A1", "Fixed Assets"),
        ("Asset Reimbursement", "A2", "Fixed Assets"),
        ("Asset Reimbursement", "A3", "Fixed Assets"),
    ])
    res = run_mapping(client, ey)
    assert res.success
    assert _match_for(res.data, "Asset Reimbursement") == "Asset Reimbursement"


def test_manufacturing_regression_resolved():
    # The known regression: client "Process Manufacturing Transactions" was mapping to
    # EY "Process Inventory Transaction". With the same Module ("Manufacturing") shared
    # only with the correct EY entitlement, the 20% module term must pull it to
    # "Process Manufacturing Transaction".
    client = _df([
        ("Process Manufacturing Transactions", "M1", "Manufacturing"),
        ("Process Manufacturing Transactions", "M2", "Manufacturing"),
        ("Process Manufacturing Transactions", "M3", "Manufacturing"),
    ])
    ey = _df([
        # Inventory shares heavy privilege overlap (the old, wrong winner)…
        ("Process Inventory Transaction", "M1", "Inventory"),
        ("Process Inventory Transaction", "M2", "Inventory"),
        ("Process Inventory Transaction", "M3", "Inventory"),
        ("Process Inventory Transaction", "M4", "Inventory"),
        # …Manufacturing shares the same Module as the client.
        ("Process Manufacturing Transaction", "M1", "Manufacturing"),
        ("Process Manufacturing Transaction", "M2", "Manufacturing"),
    ])
    res = run_mapping(client, ey)
    assert res.success
    assert _match_for(res.data, "Process Manufacturing Transactions") == \
        "Process Manufacturing Transaction"


def test_match_confidence_has_no_none_tier():
    # Task 2: the "None" tier is removed. A zero-overlap entitlement now reads
    # "Not Mapped" (never "None").
    client = _df([("Lonely Ent", "Z1", "Misc")])
    ey = _df([("EY Unrelated", "Q1", "Other")])
    res = run_mapping(client, ey)
    assert res.success
    row = res.data[res.data["Client Entitlement"] == "Lonely Ent"].iloc[0]
    assert row["Match Confidence"] == "Not Mapped"
    assert "None" not in set(res.data["Match Confidence"])


def test_match_confidence_column_after_score():
    # Task 3c: Match Confidence sits immediately after Confidence Score (%).
    client = _df([("Ent A", "P1", "M")])
    ey = _df([("Ent A", "P1", "M")])
    res = run_mapping(client, ey)
    assert res.success
    cols = list(res.data.columns)
    assert cols.index("Match Confidence") == cols.index("Confidence Score (%)") + 1
