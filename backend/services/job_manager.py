"""Thread-safe in-memory job store with TTL cleanup.

Each job tracks: status, progress, stored DataFrames, results, and Excel output.
Jobs are keyed by UUID and expire after JOB_TTL_SECONDS.
"""

import io
import uuid
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from config import MAX_CONCURRENT_JOBS, JOB_TTL_SECONDS
from exceptions import JobNotFoundError, GovernanceError
from models.common import JobStatus, JobResponse


@dataclass
class Job:
    id: str
    status: JobStatus
    created_at: datetime
    tool: str = ""
    progress: int = 0
    progress_message: str = ""
    files: dict[str, Any] = field(default_factory=dict)     # Loaded DataFrames (released after export)
    config: dict[str, Any] = field(default_factory=dict)    # Run configuration from the /run request
    results: dict[str, Any] = field(default_factory=dict)   # Analysis summary (serialisable dict)
    output_buffer: io.BytesIO | None = None                  # Completed Excel export
    output_filename: str = ""
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class JobManager:
    """Thread-safe in-memory job store with TTL cleanup."""

    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._total_created: int = 0
        # Router-level result caches (dicts keyed by job_id). Registered caches
        # are purged whenever a job is deleted or expires, so cached result
        # DataFrames cannot outlive their job.
        self._result_caches: list[dict[str, Any]] = []

    def register_result_cache(self, cache: dict[str, Any]) -> None:
        """Register a router-level result cache for automatic purging."""
        with self._lock:
            self._result_caches.append(cache)

    def _purge_result_caches(self, job_id: str) -> None:
        """Remove a job's entry from every registered result cache (lock held by caller)."""
        for cache in self._result_caches:
            cache.pop(job_id, None)

    # ── Job lifecycle ──────────────────────────────────────────────────────────

    def create_job(self, tool: str) -> Job:
        """Create a new job and store it. Raises GovernanceError if concurrent cap exceeded."""
        with self._lock:
            active = sum(
                1 for j in self._jobs.values()
                if j.status not in (JobStatus.COMPLETE, JobStatus.FAILED)
            )
            if active >= MAX_CONCURRENT_JOBS:
                raise GovernanceError(
                    "Server is busy processing other analyses. Please try again in a few minutes.",
                    code="SERVICE_UNAVAILABLE",
                )
            job = Job(
                id=str(uuid.uuid4()),
                status=JobStatus.PENDING,
                created_at=datetime.now(timezone.utc),
                tool=tool,
            )
            self._jobs[job.id] = job
            self._total_created += 1
            return job

    def get_job(self, job_id: str) -> Job:
        """Return job by ID. Raises JobNotFoundError if absent or expired."""
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            raise JobNotFoundError(job_id)
        return job

    def delete_job(self, job_id: str) -> None:
        """Remove a job and free its memory (called by DELETE endpoint and TTL cleanup)."""
        with self._lock:
            self._jobs.pop(job_id, None)
            self._purge_result_caches(job_id)

    # ── State mutation helpers (called by routers) ─────────────────────────────

    def set_status(self, job_id: str, status: JobStatus, message: str = "") -> None:
        """Set job status explicitly. Used by routers for UPLOADING / VALIDATING transitions."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = status
                if message:
                    job.progress_message = message

    def store_files(self, job_id: str, files: dict[str, Any]) -> None:
        """Store loaded DataFrames in the job. Called after validation passes."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.files = files

    def set_config(self, job_id: str, config: dict[str, Any]) -> None:
        """Store the run configuration supplied by the frontend /run request."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.config = config

    def add_warning(self, job_id: str, warning: str) -> None:
        """Append a warning message to the job (non-fatal issues surfaced to the user)."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.warnings.append(warning)

    # ── Progress tracking (called by engines via callback) ─────────────────────

    def update_progress(self, job_id: str, progress: int, message: str) -> None:
        """Update job progress percent and message. Called by engine progress callbacks."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.progress = min(max(progress, 0), 100)
                job.progress_message = message
                job.status = JobStatus.RUNNING

    def make_progress_callback(self, job_id: str) -> Callable[[int, str], None]:
        """Return a closure suitable for passing to engine functions as `progress_callback`.

        Engines call: progress_callback(percent: int, message: str)
        """
        def _callback(percent: int, message: str) -> None:
            self.update_progress(job_id, percent, message)
        return _callback

    # ── Terminal state transitions ─────────────────────────────────────────────

    def complete_job(
        self,
        job_id: str,
        results: dict[str, Any],
        output: io.BytesIO,
        filename: str,
    ) -> None:
        """Mark job complete with serialisable results + downloadable Excel output."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.COMPLETE
                job.progress = 100
                job.progress_message = "Analysis complete."
                job.results = results
                job.output_buffer = output
                job.output_filename = filename
                job.files = {}  # release DataFrames to free memory

    def fail_job(self, job_id: str, errors: list[str]) -> None:
        """Mark job failed with error messages. Files are retained so the job can be retried."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.FAILED
                job.errors = errors

    # ── Response serialisation ─────────────────────────────────────────────────

    def to_job_response(self, job: Job) -> JobResponse:
        """Convert a Job dataclass into a JobResponse Pydantic model."""
        return JobResponse(
            job_id=job.id,
            tool=job.tool,
            status=job.status,
            progress=job.progress,
            progress_message=job.progress_message,
            created_at=job.created_at,
            errors=list(job.errors),
            warnings=list(job.warnings),
            results=dict(job.results),
        )

    # ── Maintenance ────────────────────────────────────────────────────────────

    def cleanup_expired(self) -> int:
        """Remove jobs older than JOB_TTL_SECONDS. Returns count removed.

        Holds the lock for the entire read+delete to avoid TOCTOU race.
        """
        now = datetime.now(timezone.utc)
        with self._lock:
            expired = [
                jid for jid, job in self._jobs.items()
                if (now - job.created_at).total_seconds() > JOB_TTL_SECONDS
            ]
            for jid in expired:
                self._jobs.pop(jid, None)
                self._purge_result_caches(jid)
        return len(expired)

    def get_stats(self) -> dict[str, int]:
        """Return active job count, total stored, and total ever created."""
        with self._lock:
            active = sum(
                1 for j in self._jobs.values()
                if j.status not in (JobStatus.COMPLETE, JobStatus.FAILED)
            )
            return {
                "active_jobs": active,
                "total_jobs": len(self._jobs),
                "total_created": self._total_created,
            }


# Module-level singleton — imported by main.py and all routers
job_manager = JobManager()
