"""Pydantic models for the Role Testing Bot tool (Tool 4).

Note: `password` is accepted in the run request, lives only in the in-memory job
config for the run's duration, and is never written to disk, logged, or echoed in
any response.
"""

from typing import Optional

from pydantic import BaseModel


class RoleTestingRunConfig(BaseModel):
    url: str
    username: str
    password: str
    max_elements: Optional[int] = None
    overall_timeout_seconds: Optional[int] = None


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
