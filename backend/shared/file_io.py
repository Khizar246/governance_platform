"""File loading utilities — CSV and Excel to Polars/Pandas DataFrames.

Consolidates loading patterns from all four source tools:
  - Encoding detection for CSV (utf-8, utf-8-sig, latin1, cp1252, iso-8859-1)
  - Pandas ↔ Polars bridge for Excel files
  - Whitespace stripping and uppercase normalisation on all string columns
  - Empty row removal
"""

import io
from logging import Logger

import pandas as pd
import polars as pl

from exceptions import FileFormatError


_CSV_ENCODINGS = ["utf-8", "utf-8-sig", "latin1", "cp1252", "iso-8859-1"]


def _normalise_polars(df: pl.DataFrame) -> pl.DataFrame:
    """Strip whitespace, uppercase all string columns, drop fully-null rows."""
    exprs = []
    for col_name in df.columns:
        if df[col_name].dtype == pl.Utf8 or df[col_name].dtype == pl.String:
            exprs.append(
                pl.col(col_name).str.strip_chars().str.to_uppercase().alias(col_name)
            )
    if exprs:
        df = df.with_columns(exprs)
    # Remove rows where every value is null or empty string
    has_data = pl.lit(False)
    for col_name in df.columns:
        if df[col_name].dtype in (pl.Utf8, pl.String):
            has_data = has_data | (
                pl.col(col_name).is_not_null() & (pl.col(col_name) != "")
            )
        else:
            has_data = has_data | pl.col(col_name).is_not_null()
    return df.filter(has_data)


def _normalise_pandas(df: pd.DataFrame) -> pd.DataFrame:
    """Strip whitespace, uppercase all string columns, drop fully-null rows."""
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].astype(str).str.strip().str.upper()
            df[col] = df[col].replace({"NAN": None, "NONE": None, "": None})
    df = df.dropna(how="all")
    return df


def load_csv_to_polars(
    file_bytes: bytes,
    filename: str,
    logger: Logger,
) -> pl.DataFrame:
    """Load CSV with encoding detection. Try: utf-8, utf-8-sig, latin1, cp1252, iso-8859-1.

    Strips whitespace and uppercases all string columns.
    Removes completely empty rows.
    Raises FileFormatError on failure.
    """
    last_err: Exception | None = None
    for encoding in _CSV_ENCODINGS:
        try:
            text = file_bytes.decode(encoding)
            df = pl.read_csv(
                io.StringIO(text),
                infer_schema_length=10_000,
                ignore_errors=True,
                null_values=["", "N/A", "n/a", "NA"],
            )
            logger.debug("Loaded '%s' as CSV with encoding=%s, shape=%s", filename, encoding, df.shape)
            return _normalise_polars(df)
        except Exception as exc:
            last_err = exc
            logger.debug("CSV encoding '%s' failed for '%s': %s", encoding, filename, exc)
            continue

    raise FileFormatError(
        f"Could not read '{filename}' as a CSV file. "
        f"Tried encodings: {', '.join(_CSV_ENCODINGS)}. "
        f"Last error: {last_err}"
    )


def load_excel_to_polars(
    file_bytes: bytes,
    filename: str,
    sheet_name: str | None,
    column_rename: dict | None,
    logger: Logger,
) -> pl.DataFrame:
    """Load Excel via Pandas bridge → Polars.

    Strips whitespace and uppercases all string columns.
    Applies column_rename if provided.
    Removes completely empty rows.
    Raises FileFormatError with specific message on failure.
    """
    try:
        kwargs: dict = {
            "io": io.BytesIO(file_bytes),
            "dtype": str,
            "keep_default_na": False,
            "na_values": ["", "N/A", "n/a", "NA"],
        }
        if sheet_name is not None:
            kwargs["sheet_name"] = sheet_name

        pdf = pd.read_excel(**kwargs)
        logger.debug(
            "Loaded '%s' (sheet=%s) via Pandas bridge, shape=%s",
            filename, sheet_name, pdf.shape,
        )
    except Exception as exc:
        raise FileFormatError(
            f"Could not read '{filename}' as an Excel file "
            f"(sheet={sheet_name!r}): {exc}"
        ) from exc

    pdf = _normalise_pandas(pdf)

    if column_rename:
        normalised_rename = {
            k.strip().upper(): v for k, v in column_rename.items()
        }
        col_map = {c: normalised_rename.get(c.strip().upper(), c) for c in pdf.columns}
        pdf = pdf.rename(columns=col_map)

    try:
        df = pl.from_pandas(pdf)
    except Exception as exc:
        raise FileFormatError(
            f"Could not convert '{filename}' from Pandas to Polars: {exc}"
        ) from exc

    return _normalise_polars(df)


def load_csv_to_pandas(
    file_bytes: bytes,
    filename: str,
    logger: Logger,
) -> pd.DataFrame:
    """Same as load_csv_to_polars but returns a Pandas DataFrame. Used by Tool 1."""
    last_err: Exception | None = None
    for encoding in _CSV_ENCODINGS:
        try:
            text = file_bytes.decode(encoding)
            df = pd.read_csv(
                io.StringIO(text),
                dtype=str,
                keep_default_na=False,
                na_values=["", "N/A", "n/a", "NA"],
            )
            logger.debug("Loaded '%s' as CSV/Pandas with encoding=%s, shape=%s", filename, encoding, df.shape)
            return _normalise_pandas(df)
        except Exception as exc:
            last_err = exc
            logger.debug("CSV/Pandas encoding '%s' failed for '%s': %s", encoding, filename, exc)
            continue

    raise FileFormatError(
        f"Could not read '{filename}' as a CSV file. "
        f"Tried encodings: {', '.join(_CSV_ENCODINGS)}. "
        f"Last error: {last_err}"
    )


def load_excel_to_pandas(
    file_bytes: bytes,
    filename: str,
    sheet_name: str | None,
    logger: Logger,
) -> pd.DataFrame:
    """Load Excel and return a Pandas DataFrame. Used by Tool 1 export."""
    try:
        kwargs: dict = {
            "io": io.BytesIO(file_bytes),
            "dtype": str,
            "keep_default_na": False,
            "na_values": ["", "N/A", "n/a", "NA"],
        }
        if sheet_name is not None:
            kwargs["sheet_name"] = sheet_name

        df = pd.read_excel(**kwargs)
        logger.debug(
            "Loaded '%s' (sheet=%s) as Pandas DataFrame, shape=%s",
            filename, sheet_name, df.shape,
        )
        return _normalise_pandas(df)
    except Exception as exc:
        raise FileFormatError(
            f"Could not read '{filename}' as an Excel file "
            f"(sheet={sheet_name!r}): {exc}"
        ) from exc


def get_excel_sheet_names(file_bytes: bytes) -> list[str]:
    """Return the list of sheet names in an Excel file."""
    try:
        xf = pd.ExcelFile(io.BytesIO(file_bytes))
        return xf.sheet_names
    except Exception as exc:
        raise FileFormatError(f"Could not read Excel sheet names: {exc}") from exc
