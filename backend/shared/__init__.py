"""Shared utilities: logging, file I/O, validation, and Excel export.

Import each sub-module directly; heavy dependencies (pandas, polars, xlsxwriter)
are only loaded when the sub-module is actually imported by a router or engine.
"""
