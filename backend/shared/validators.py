"""File and DataFrame validation utilities.

validate_upload takes a FastAPI UploadFile (called from routers).
All other functions are pure Python with no framework imports.
"""

from fastapi import UploadFile


_XLSX_MAGIC = b"\x50\x4B\x03\x04"  # ZIP/OOXML
_XLS_MAGIC = b"\xD0\xCF\x11\xE0"   # OLE compound document
_UTF8_BOM = b"\xEF\xBB\xBF"
_HEADER_READ = 512


async def validate_upload(
    file: UploadFile,
    max_size: int,
    allowed_extensions: set[str],
) -> tuple[bool, str]:
    """Validate an uploaded file for size, extension, and magic bytes.

    Checks (in order):
      1. Not empty (0 bytes)
      2. Extension in allowed_extensions
      3. Size <= max_size
      4. Magic bytes match extension
    Returns (True, "") on success or (False, "error message") on failure.
    """
    filename = file.filename or ""
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""

    if ext not in allowed_extensions:
        return False, (
            f"'{filename}' has unsupported extension '{ext}'. "
            f"Allowed: {', '.join(sorted(allowed_extensions))}"
        )

    await file.seek(0)
    content = await file.read()
    await file.seek(0)

    if not content:
        return False, f"'{filename}' appears to be empty (0 bytes)."

    size = len(content)
    header = content[:_HEADER_READ]

    if size > max_size:
        mb = size / (1024 * 1024)
        max_mb = max_size / (1024 * 1024)
        return False, f"'{filename}' is {mb:.1f} MB — exceeds the {max_mb:.0f} MB limit."

    if ext in {".xlsx"}:
        if not header.startswith(_XLSX_MAGIC):
            return False, f"'{filename}' does not appear to be a valid Excel (.xlsx) file."
    elif ext in {".xls"}:
        if not header.startswith(_XLS_MAGIC):
            return False, f"'{filename}' does not appear to be a valid Excel (.xls) file."
    elif ext == ".csv":
        if header.startswith(_XLSX_MAGIC):
            return False, f"'{filename}' is saved as CSV but contains Excel binary data. Please export as CSV."
        if header.startswith(_XLS_MAGIC):
            return False, f"'{filename}' is saved as CSV but contains Excel binary data. Please export as CSV."
        # CSV: allow UTF-8 BOM or printable text
        sample = header[len(_UTF8_BOM):] if header.startswith(_UTF8_BOM) else header
        try:
            sample.decode("utf-8")
        except UnicodeDecodeError:
            # Allow latin-1 compatible bytes (bytes < 0x80 or high-byte text)
            non_printable = sum(
                1 for b in sample if b < 0x09 or (0x0E <= b <= 0x1F)
            )
            if non_printable > len(sample) * 0.05:
                return False, (
                    f"'{filename}' does not appear to be a valid text/CSV file "
                    "(too many non-printable bytes)."
                )

    return True, ""


def validate_dataframe_schema(
    df_columns: set[str],
    required_columns: set[str],
    file_label: str,
) -> tuple[bool, list[str]]:
    """Check that all required columns are present (case-insensitive, whitespace-stripped).

    Returns (is_valid, list_of_missing_column_names).
    """
    normalised_present = {c.strip().upper() for c in df_columns}
    missing = [
        col for col in required_columns
        if col.strip().upper() not in normalised_present
    ]
    if missing:
        return False, missing
    return True, []
