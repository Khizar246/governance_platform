"""Decode and apply the column-filter query params sent by the frontend tables.

Wire protocol (shared by all three file tools): each active column filter is one
query param whose value is a JSON array of strings, e.g. ``col=["A","B, C",""]``.
JSON keeps three things unambiguous that the old comma-joined encoding lost:
values containing commas, the empty string (the "[Empty]" option), and the empty
selection ``[]`` — which means "exclude every row", distinct from the param being
absent (= no filter on that column).
"""

import json

import polars as pl


def parse_filter_param(raw: str) -> list[str] | None:
    """Decode one column-filter query param value.

    Returns the list of selected values (possibly empty = exclude-all), or None
    when the value is not a JSON array of strings — unknown or legacy params are
    ignored by callers rather than misapplied.
    """
    try:
        vals = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(vals, list) or not all(isinstance(v, str) for v in vals):
        return None
    return vals


def apply_column_filters(
    df: pl.DataFrame,
    query_params: dict[str, str],
    reserved: set[str],
    exclude_column: str | None = None,
) -> pl.DataFrame:
    """Apply every column filter present in ``query_params`` to ``df``.

    ``reserved`` names the endpoint's own params (page, sheet, …); anything else
    that names a real column and parses as a filter is applied. Filter values
    arrive as strings (that is what /filter-options serialises), so columns are
    compared as strings via a Utf8 cast.
    """
    for col, raw in query_params.items():
        if col in reserved or col == exclude_column or col not in df.columns:
            continue
        vals = parse_filter_param(raw)
        if vals is None:
            continue
        if not vals:
            # Empty selection: the user unchecked every value — no row matches.
            return df.head(0)
        df = df.filter(pl.col(col).cast(pl.Utf8).is_in(vals))
    return df
