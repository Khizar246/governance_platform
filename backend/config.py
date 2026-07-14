"""Application configuration constants for the EY Access Governance Platform."""

import os
from pathlib import Path
from datetime import datetime

# ── File handling ─────────────────────────────────────────────────────────────
MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024  # 200 MB

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls"}

TEMP_DIR = Path("temp")
LOG_DIR = Path("logs")

# ── Job management ────────────────────────────────────────────────────────────
# Caps queue ADMISSION (jobs not yet complete/failed), not simultaneous
# execution — heavy analyses execute at most ANALYSIS_POOL_WORKERS at a time
# and queue FIFO beyond that.
MAX_CONCURRENT_JOBS = 15
JOB_TTL_SECONDS = 3600        # 1 hour
CLEANUP_INTERVAL_SECONDS = 300  # 5 minutes

# ── Analysis worker pool ──────────────────────────────────────────────────────
# Heavy analyses (SOD & SA, Oracle Comparator) run in separate worker processes
# so they cannot starve the web server's event loop. Polars is capped per
# worker so N workers don't each grab every core.
ANALYSIS_POOL_WORKERS = int(os.getenv("ANALYSIS_POOL_WORKERS", "3"))
POLARS_THREADS_PER_WORKER = int(
    os.getenv("POLARS_THREADS_PER_WORKER", str(max(2, (os.cpu_count() or 8) // 3)))
)

# ── Role Testing Bot (Tool 4) ─────────────────────────────────────────────────
# Per-job screenshot folders live under TEMP_DIR/role-testing/{job_id}.
ROLE_TESTING_SHOTS_DIR = TEMP_DIR / "role-testing"


def output_filename(tool_name: str, context: str = "") -> str:
    """Return a timestamped output filename: {ToolName}_{Context}_{YYYYMMDD_HHMMSS}.xlsx"""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    if context:
        return f"{tool_name}_{context}_{ts}.xlsx"
    return f"{tool_name}_{ts}.xlsx"
