"""Excel export utilities used by all four engine export functions.

Auto-splits sheets that exceed EXCEL_MAX_ROWS (1,048,000 rows).
Sheet names are truncated to 31 characters (Excel limit).
"""

import io
from logging import Logger

import pandas as pd
import polars as pl
import xlsxwriter


_SHEET_NAME_MAX = 31


def _truncate_sheet_name(name: str) -> str:
    return name[:_SHEET_NAME_MAX]


def write_polars_to_workbook(
    workbook: xlsxwriter.Workbook,
    sheet_name: str,
    df: pl.DataFrame,
    max_rows: int = 1_048_000,
) -> int:
    """Write a Polars DataFrame to one or more sheets in an xlsxwriter Workbook.

    Auto-splits into Part1, Part2, … if df.height > max_rows.
    Sheet names are truncated to 31 chars.
    Returns the number of sheets created.
    """
    if df.height == 0:
        ws = workbook.add_worksheet(_truncate_sheet_name(sheet_name))
        for col_idx, col_name in enumerate(df.columns):
            ws.write(0, col_idx, col_name)
        return 1

    if df.height <= max_rows:
        ws = workbook.add_worksheet(_truncate_sheet_name(sheet_name))
        _write_polars_sheet(ws, df)
        return 1

    # Auto-split
    chunks = []
    offset = 0
    while offset < df.height:
        chunks.append(df.slice(offset, max_rows))
        offset += max_rows

    base = sheet_name[: _SHEET_NAME_MAX - len(f" Part{len(chunks)}")]
    for part_num, chunk in enumerate(chunks, start=1):
        part_name = _truncate_sheet_name(f"{base} Part{part_num}")
        ws = workbook.add_worksheet(part_name)
        _write_polars_sheet(ws, chunk)

    return len(chunks)


def _write_polars_sheet(ws: xlsxwriter.workbook.Worksheet, df: pl.DataFrame) -> None:
    """Write headers + data rows from a Polars DataFrame into an xlsxwriter worksheet."""
    columns = df.columns
    for col_idx, col_name in enumerate(columns):
        ws.write(0, col_idx, col_name)

    pandas_df = df.to_pandas()
    for row_idx, row in enumerate(pandas_df.itertuples(index=False), start=1):
        for col_idx, value in enumerate(row):
            if pd.isna(value) if not isinstance(value, str) else False:
                ws.write(row_idx, col_idx, None)
            else:
                ws.write(row_idx, col_idx, value)


def write_pandas_to_buffer(df: pd.DataFrame, sheet_name: str) -> io.BytesIO:
    """Write a Pandas DataFrame to a BytesIO Excel buffer using openpyxl.

    Used by Tool 1 (Entitlement Mapping) which keeps Pandas throughout.
    """
    buffer = io.BytesIO()
    safe_name = _truncate_sheet_name(sheet_name)
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name=safe_name, index=False)
    buffer.seek(0)
    return buffer


def finalize_workbook(workbook: xlsxwriter.Workbook, buffer: io.BytesIO) -> io.BytesIO:
    """Close the xlsxwriter workbook, seek the buffer to 0, and return it."""
    workbook.close()
    buffer.seek(0)
    return buffer
