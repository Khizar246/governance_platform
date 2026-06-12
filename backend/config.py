"""Application configuration constants for the EY Access Governance Platform."""

from pathlib import Path
from datetime import datetime

# ── File handling ─────────────────────────────────────────────────────────────
MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024  # 200 MB

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls"}

ALLOWED_MIME_TYPES = {
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
}

TEMP_DIR = Path("temp")
LOG_DIR = Path("logs")

# ── Job management ────────────────────────────────────────────────────────────
# Each job holds full DataFrames (and on completion the exported workbook) in
# memory until the TTL, so the concurrency cap is deliberately conservative.
MAX_CONCURRENT_JOBS = 5
JOB_TTL_SECONDS = 3600        # 1 hour
CLEANUP_INTERVAL_SECONDS = 300  # 5 minutes


def output_filename(tool_name: str, context: str = "") -> str:
    """Return a timestamped output filename: {ToolName}_{Context}_{YYYYMMDD_HHMMSS}.xlsx"""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    if context:
        return f"{tool_name}_{context}_{ts}.xlsx"
    return f"{tool_name}_{ts}.xlsx"
