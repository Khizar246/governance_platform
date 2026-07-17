"""Pydantic models for the Role Testing Bot tool.

Note: `password` is accepted in the run request, lives only in the in-memory job
config for the run's duration, and is never written to disk, logged, or echoed in
any response.
"""

from typing import Optional

from pydantic import AnyHttpUrl, BaseModel, Field, PositiveInt


class RoleTestingRunConfig(BaseModel):
    url: AnyHttpUrl
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    max_elements: Optional[PositiveInt] = None
    overall_timeout_seconds: Optional[PositiveInt] = None
    headless: bool = True           # run Chrome headless (off for local review)
    capture_tasks: bool = False     # drill into each task inside a work area


class CapturedScreenshot(BaseModel):
    index: int
    title: str
    filename: Optional[str] = None     # served via GET /image/{job_id}/{filename}
    status: str                        # captured | captured_no_task | skipped | error


class RoleTestingSummary(BaseModel):
    total: int
    captured: int
    failed: int
    skipped: int
    screenshots: list[CapturedScreenshot]
    # Engine warnings (e.g. run cut short by the overall timeout). Travels into
    # the /results payload and the ZIP's summary.json so a truncated run is
    # never mistaken for a complete one.
    warnings: list[str] = []
