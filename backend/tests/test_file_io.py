"""Unit tests for shared/file_io.py — CSV/Excel loaders + normalisation.

Every loader is pure (bytes in, DataFrame out) so tests build inputs in memory.
Covers: whitespace-strip + uppercase + dedupe + empty-row removal, text-only
column loading, the CSV encoding fallback order (cp1252 must win before the
latin1 catch-all), the Excel→Polars bridge with column_rename, sheet-name
listing, and FileFormatError on unreadable input.
"""

import io
import logging

import pandas as pd
import polars as pl
import pytest

from shared.file_io import (
    load_csv_to_polars,
    load_excel_to_polars,
    load_excel_to_pandas,
    get_excel_sheet_names,
)
from exceptions import FileFormatError

_LOG = logging.getLogger("test_file_io")
_LOG.addHandler(logging.NullHandler())


def _xlsx(df: pd.DataFrame, sheet_name: str = "Sheet1") -> bytes:
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        df.to_excel(xw, index=False, sheet_name=sheet_name)
    return buf.getvalue()


# ── load_csv_to_polars ────────────────────────────────────────────────────────

def test_csv_strips_uppercases_and_dedupes():
    csv = b"a,b\n hi , x \nHI,X\nbye,y\n"
    df = load_csv_to_polars(csv, "f.csv", _LOG)
    # " hi "/"HI" collapse to one uppercased row after strip; "bye" stays.
    assert df.to_dicts() == [{"a": "HI", "b": "X"}, {"a": "BYE", "b": "Y"}]


def test_csv_drops_fully_empty_rows():
    csv = b"a,b\nx,y\n,\n"
    df = load_csv_to_polars(csv, "f.csv", _LOG)
    assert df.height == 1


def test_csv_columns_loaded_as_text():
    # Numeric-looking values must stay strings (dtype str) for downstream joins.
    csv = b"id\n001\n42\n"
    df = load_csv_to_polars(csv, "f.csv", _LOG)
    assert df["id"].dtype in (pl.Utf8, pl.String)
    assert df.to_series().to_list() == ["001", "42"]


def test_csv_cp1252_decodes_before_latin1_fallback():
    # cp1252 smart quotes (0x93/0x94) must decode as real chars, not latin1 mojibake.
    data = "name\n“quoted”\n".encode("cp1252")
    df = load_csv_to_polars(data, "s.csv", _LOG)
    val = df.to_dicts()[0]["name"]
    # Real curly quotes survive (uppercased); latin1 would have produced two
    # separate mojibake bytes instead of the single smart-quote characters.
    assert "“" in val and "”" in val


# ── load_excel_to_polars ──────────────────────────────────────────────────────

def test_excel_to_polars_normalises_and_renames():
    raw = _xlsx(pd.DataFrame({"Col One": [" a "], "Col Two": ["b"]}), "S1")
    df = load_excel_to_polars(raw, "x.xlsx", "S1", {"Col One": "RENAMED"}, _LOG)
    assert df.columns == ["RENAMED", "Col Two"]
    assert df.to_dicts() == [{"RENAMED": "A", "Col Two": "B"}]


def test_excel_to_polars_rename_is_case_insensitive():
    raw = _xlsx(pd.DataFrame({"role name": ["x"]}), "S1")
    # Mapping key differs in case/whitespace from the actual header.
    df = load_excel_to_polars(raw, "x.xlsx", "S1", {" Role Name ": "ROLE"}, _LOG)
    assert "ROLE" in df.columns


def test_excel_to_polars_bad_bytes_raises():
    with pytest.raises(FileFormatError):
        load_excel_to_polars(b"not an excel file", "bad.xlsx", "S1", None, _LOG)


# ── load_excel_to_pandas ──────────────────────────────────────────────────────

def test_excel_to_pandas_normalises_str_dtype_columns():
    # _normalise_pandas now uses is_string_dtype, so the pandas `str` dtype
    # from pd.read_excel(dtype=str) IS stripped + uppercased — consistent with
    # the Polars loader. (Previously `== object` skipped this dtype, leaving
    # Ruleset Mapping's values un-normalised; see AUDIT.md §Testing.)
    raw = _xlsx(pd.DataFrame({"H": [" v "]}), "S1")
    df = load_excel_to_pandas(raw, "x.xlsx", "S1", _LOG)
    assert df["H"].tolist() == ["V"]


def test_excel_to_pandas_dedupes_case_whitespace_variants():
    # After normalisation, case/whitespace variants collapse to one row — this
    # is what lets the Ruleset engine match entitlement names like the other tools.
    raw = _xlsx(pd.DataFrame({"name": [" AP Manager ", "ap manager"]}), "S1")
    df = load_excel_to_pandas(raw, "x.xlsx", "S1", _LOG)
    assert df["name"].tolist() == ["AP MANAGER"]


def test_excel_to_pandas_bad_bytes_raises():
    with pytest.raises(FileFormatError):
        load_excel_to_pandas(b"garbage", "bad.xlsx", "S1", _LOG)


# ── get_excel_sheet_names ─────────────────────────────────────────────────────

def test_get_excel_sheet_names():
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        pd.DataFrame({"a": [1]}).to_excel(xw, index=False, sheet_name="First")
        pd.DataFrame({"b": [2]}).to_excel(xw, index=False, sheet_name="Second")
    assert get_excel_sheet_names(buf.getvalue()) == ["First", "Second"]


def test_get_excel_sheet_names_bad_bytes_raises():
    with pytest.raises(FileFormatError):
        get_excel_sheet_names(b"not excel")
