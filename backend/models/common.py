"""Shared Pydantic models used across all governance tools."""

from datetime import datetime
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
    tool: str = ""
    status: JobStatus
    progress: int = 0                    # 0–100
    progress_message: str = ""
    created_at: datetime
    errors: list[str] = []
    warnings: list[str] = []
    results: dict[str, Any] = {}         # Populated when status == "complete"


class FilePreview(BaseModel):
    filename: str
    rows: int
    columns: list[str]
    preview: list[dict[str, Any]]        # First 5 rows as list of dicts
    duplicates: int = 0                  # Duplicate row count detected at upload
    warnings: list[str] = []


class UploadResponse(BaseModel):
    job_id: str
    files: dict[str, FilePreview]
    status: JobStatus = JobStatus.VALIDATING
    errors: list[str] = []
    warnings: list[str] = []


class AnalysisResponse(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    job_id: str
    status: JobStatus
    summary: dict[str, Any]             # Tool-specific summary data (serialised from tool summary model)
    errors: list[str] = []
    warnings: list[str] = []


class ErrorResponse(BaseModel):
    error: bool = True
    message: str
    code: str
    details: list[str] = []
