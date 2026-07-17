"""Unit tests for shared/validators.py.

validate_upload is async and takes a Starlette/FastAPI UploadFile; each case
wraps in-memory bytes in an UploadFile and drives the coroutine with
asyncio.run (no pytest-asyncio needed). Every branch of the size/extension/
magic-byte ladder is exercised, plus the pure validate_dataframe_schema helper.
"""

import asyncio
import io

from starlette.datastructures import UploadFile

from config import ALLOWED_EXTENSIONS
from shared.validators import validate_upload, validate_dataframe_schema

_XLSX_MAGIC = b"\x50\x4B\x03\x04"
_XLS_MAGIC = b"\xD0\xCF\x11\xE0"
_UTF8_BOM = b"\xEF\xBB\xBF"


def _check(filename: str, data: bytes, max_size: int = 1_000_000):
    file = UploadFile(filename=filename, file=io.BytesIO(data))
    return asyncio.run(validate_upload(file, max_size, ALLOWED_EXTENSIONS))


# ── Extension gate (checked before content) ───────────────────────────────────

def test_unsupported_extension_rejected():
    ok, msg = _check("report.pdf", _XLSX_MAGIC + b"body")
    assert not ok
    assert "unsupported extension" in msg


def test_no_extension_rejected():
    ok, msg = _check("noext", b"anything")
    assert not ok
    assert "unsupported extension" in msg


def test_extension_case_insensitive():
    ok, _ = _check("REPORT.XLSX", _XLSX_MAGIC + b"body")
    assert ok


# ── Empty / oversize ──────────────────────────────────────────────────────────

def test_empty_file_rejected():
    ok, msg = _check("data.csv", b"")
    assert not ok
    assert "empty" in msg


def test_oversize_rejected():
    ok, msg = _check("data.csv", b"a,b\n1,2\n", max_size=3)
    assert not ok
    assert "exceeds" in msg


def test_exactly_at_limit_accepted():
    data = b"a,b\n1,2"
    ok, _ = _check("data.csv", data, max_size=len(data))
    assert ok


# ── Magic-byte checks per extension ───────────────────────────────────────────

def test_xlsx_valid_magic_accepted():
    ok, _ = _check("book.xlsx", _XLSX_MAGIC + b"rest of zip")
    assert ok


def test_xlsx_wrong_magic_rejected():
    ok, msg = _check("book.xlsx", b"not a real xlsx")
    assert not ok
    assert "valid Excel (.xlsx)" in msg


def test_xls_valid_magic_accepted():
    ok, _ = _check("book.xls", _XLS_MAGIC + b"ole body")
    assert ok


def test_xls_wrong_magic_rejected():
    ok, msg = _check("book.xls", b"plain text pretending")
    assert not ok
    assert "valid Excel (.xls)" in msg


def test_csv_with_xlsx_binary_rejected():
    ok, msg = _check("data.csv", _XLSX_MAGIC + b"actually excel")
    assert not ok
    assert "contains Excel binary data" in msg


def test_csv_with_xls_binary_rejected():
    ok, msg = _check("data.csv", _XLS_MAGIC + b"actually excel")
    assert not ok
    assert "contains Excel binary data" in msg


# ── CSV text acceptance ───────────────────────────────────────────────────────

def test_csv_plain_text_accepted():
    ok, _ = _check("data.csv", b"user,role\nalice,admin\n")
    assert ok


def test_csv_utf8_bom_accepted():
    ok, _ = _check("data.csv", _UTF8_BOM + b"user,role\nalice,admin\n")
    assert ok


def test_csv_high_byte_text_accepted():
    # Latin-1 accented bytes are not valid UTF-8 but are not "non-printable"
    # control bytes, so the printable-ratio guard must still accept them.
    ok, _ = _check("data.csv", b"name\nJos\xe9 Garc\xeda\n")
    assert ok


def test_csv_too_many_control_bytes_rejected():
    # The non-printable-ratio guard only runs on bytes that FAIL utf-8 decoding.
    # 0xFF is invalid utf-8; 0x01 is a control byte counted as non-printable —
    # interleaving them makes the sample undecodable AND mostly non-printable.
    ok, msg = _check("data.csv", bytes([0xFF, 0x01]) * 100)
    assert not ok
    assert "non-printable" in msg


# ── validate_dataframe_schema (pure) ──────────────────────────────────────────

def test_schema_all_present():
    ok, missing = validate_dataframe_schema({"A", "B", "C"}, {"A", "B"}, "f")
    assert ok
    assert missing == []


def test_schema_missing_reported():
    ok, missing = validate_dataframe_schema({"A"}, {"A", "B", "C"}, "f")
    assert not ok
    assert set(missing) == {"B", "C"}


def test_schema_case_and_whitespace_insensitive():
    ok, missing = validate_dataframe_schema({" role name ", "USER"}, {"Role Name", "user"}, "f")
    assert ok
    assert missing == []
