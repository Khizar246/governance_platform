"""Tests for two audit fixes:

C-11a — a No_action_Privileges row with a blank "False Positive Reason" must
still tag its privilege as FP, using the placeholder reason text.

X-2 / C-12 — CSV columns always load as text (matching the Excel loaders'
dtype=str), and cp1252 files decode correctly (cp1252 is tried before the
never-fail latin1 fallback).
"""

import logging

import polars as pl

from engines.sod_sa_engine import _fp_level1
from shared.file_io import load_csv_to_polars

logger = logging.getLogger("test_csv_loading_and_fp_reason")

_PLACEHOLDER = (
    "False Positive – The FP database does not contain a False Positive "
    "reason for this record."
)


def _pending_frame() -> pl.DataFrame:
    return pl.DataFrame({
        "_row_nr": [0, 1, 2],
        "_fp_keys": [["PRIV_A"], ["PRIV_B"], ["PRIV_C"]],
        "Potential FP": ["", "", ""],
        "Reason": ["", "", ""],
    })


def test_blank_fp_reason_gets_placeholder():
    na = pl.DataFrame({
        "PRIVILEGE_NAME": ["PRIV_A", "PRIV_B"],
        "FALSE POSITIVE REASON": ["DOCUMENTED REASON", None],
    })
    out = _fp_level1(_pending_frame(), na).sort("_row_nr")
    # Both DB rows tag FP — the blank reason no longer skips the row.
    assert out["Potential FP"].to_list() == ["FP", "FP", ""]
    reasons = out["Reason"].to_list()
    assert reasons[0] == "DOCUMENTED REASON"
    assert reasons[1] == _PLACEHOLDER
    assert reasons[2] == ""


def test_fp_db_with_entirely_null_reason_column():
    # An all-empty Excel column can arrive as a Null-dtype column.
    na = pl.DataFrame({
        "PRIVILEGE_NAME": ["PRIV_A"],
        "FALSE POSITIVE REASON": [None],
    })
    out = _fp_level1(_pending_frame(), na).sort("_row_nr")
    assert out["Potential FP"].to_list() == ["FP", "", ""]
    assert out["Reason"].to_list()[0] == _PLACEHOLDER


def test_csv_columns_load_as_text():
    df = load_csv_to_polars(b"ROLE,COUNT\nAdmin,10\nUser,20\n", "x.csv", logger)
    assert all(dt == pl.Utf8 for dt in df.dtypes)
    assert df["COUNT"].to_list() == ["10", "20"]


def test_csv_cp1252_special_characters_decode_correctly():
    raw = "NAME,NOTE\nCafé,€ budget\n".encode("cp1252")
    df = load_csv_to_polars(raw, "x.csv", logger)
    assert df["NAME"].to_list() == ["CAFÉ"]
    assert df["NOTE"].to_list() == ["€ BUDGET"]


def test_csv_utf8_still_decodes_first_try():
    df = load_csv_to_polars("NAME\nCafé\n".encode("utf-8"), "x.csv", logger)
    assert df["NAME"].to_list() == ["CAFÉ"]
