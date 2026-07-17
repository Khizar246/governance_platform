"""Blank Privilege Code rows are ignored entirely by the entitlement mapper (AUDIT C-1).

A blank cell is not a privilege: it must never create overlap between two
entitlements, never inflate privilege counts, and an entitlement whose rows are
ALL blank never enters the mapping output at all (user ruling 2026-07-16:
"ignore this row completely because there is nothing to match").
"""

import pandas as pd

from engines.entitlement_mapping_engine import run_mapping


def _e2p(rows):
    return pd.DataFrame(rows, columns=["Entitlement Name", "Privilege Code", "Module"])


CLIENT = _e2p([
    ("GHOST", None, "M1"),                                  # only a blank row
    ("MIXED", "R1", "M1"), ("MIXED", None, "M1"),           # one real + one blank
    ("CLEAN", "R2", "M1"),                                  # untouched control row
    ("HALFGHOST", "RX", "M2"), ("HALFGHOST", None, "M2"),   # real priv with no EY counterpart
])
EY = _e2p([
    ("EY REAL", "R1", "M1"), ("EY REAL", "R2", "M1"),
    ("EY BLANK HOST", None, "M1"), ("EY BLANK HOST", "R3", "M1"),
    ("EY ALL BLANK", None, "M2"),
])


def _run() -> pd.DataFrame:
    result = run_mapping(CLIENT.copy(), EY.copy())
    assert result.success, result.errors
    return result.data.set_index("Client Entitlement")


def test_all_blank_entitlement_is_omitted_entirely():
    # Pre-fix: GHOST matched "EY ALL BLANK" at 75% High purely via the shared blank.
    assert "GHOST" not in _run().index


def test_blank_cells_never_create_a_match():
    # Pre-fix: HALFGHOST's blank row phantom-matched "EY ALL BLANK" at 58% Medium.
    row = _run().loc["HALFGHOST"]
    assert row["Match Confidence"] == "Not Mapped"
    assert row["EY Entitlement Match"] == "—"
    assert row["Client Privilege Count"] == 1


def test_blank_rows_do_not_inflate_counts_or_dilute_scores():
    # Pre-fix: the blank made this 1/2 at 48% Low; the real match is 1/1.
    row = _run().loc["MIXED"]
    assert row["EY Entitlement Match"] == "EY REAL"
    assert row["Privilege Match Count"] == "1/1"
    assert row["Client Privilege Count"] == 1


def test_ey_side_blank_rows_ignored_in_counts():
    row = _run().loc["MIXED"]
    assert row["EY Privilege Count"] == 2  # EY REAL's real privileges only


def test_clean_rows_unaffected():
    row = _run().loc["CLEAN"]
    assert row["EY Entitlement Match"] == "EY REAL"
    assert row["Match Confidence"] == "Medium"
    assert row["Confidence Score (%)"] == "64%"
