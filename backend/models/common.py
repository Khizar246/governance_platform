"""Shared Pydantic models used across all governance tools."""

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict


class JobStatus(str, Enum):
    PENDING = "pending"
    UPLOADING = "uploading"
    VALIDATING = "validating"
    RUNNING = "running"
    COMPLETE = "complete"
    FAILED = "failed"


class JobResponse(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    job_id: str
    status: JobStatus
    progress: int = 0                    # 0–100
    progress_message: str = ""
    step: int = 0                        # Explicit step number (tool-specific; 0 = not started)
    errors: list[str] = []
    warnings: list[str] = []
    results: dict[str, Any] = {}         # Populated when status == "complete"


class FilePreview(BaseModel):
    filename: str
    rows: int
    columns: list[str]


class UploadResponse(BaseModel):
    job_id: str
    files: dict[str, FilePreview]
    status: JobStatus = JobStatus.VALIDATING
    warnings: list[str] = []
    entitlement_warnings: list[dict] = []


class AnalysisResponse(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    job_id: str
    status: JobStatus
