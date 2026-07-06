"""Pure business logic engines — no FastAPI or Pydantic imports.

Each engine receives DataFrames/dicts and returns DataFrames/dicts/BytesIO.
Import each engine directly; polars/pandas are loaded lazily when an engine module
is first imported by a router.
"""
