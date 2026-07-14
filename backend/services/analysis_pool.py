"""Bounded process pool for heavy analysis execution (SOD & SA, Oracle Comparator).

Analyses run in separate worker processes so they cannot starve the web
server's event loop; jobs submitted beyond the pool size queue FIFO inside the
executor. Progress travels back over a Manager queue drained by a daemon
thread into job_manager; results return as the task's pickled payload and are
applied by a done-callback in the web process.
"""

import io
import threading
import multiprocessing
from concurrent.futures import Future, ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from logging import Logger
from typing import Any, Callable

from config import ANALYSIS_POOL_WORKERS, POLARS_THREADS_PER_WORKER
from exceptions import JobNotFoundError
from models.common import JobStatus
from services.job_manager import job_manager
from services.analysis_workers import AnalysisJobError
from services.pool_init import worker_init
from shared.logger import get_logger

logger = get_logger("analysis_pool")

_QUEUED_MESSAGE = "Queued — waiting for an analysis worker…"


class AnalysisPool:
    """Lazily-started ProcessPoolExecutor + progress-queue drainer."""

    def __init__(self) -> None:
        self._executor: ProcessPoolExecutor | None = None
        self._manager = None
        self._queue = None
        self._lock = threading.Lock()

    def _ensure_started(self) -> None:
        with self._lock:
            if self._executor is not None:
                return
            self._manager = multiprocessing.Manager()
            self._queue = self._manager.Queue()
            self._executor = ProcessPoolExecutor(
                max_workers=ANALYSIS_POOL_WORKERS,
                initializer=worker_init,
                initargs=(POLARS_THREADS_PER_WORKER,),
            )
            threading.Thread(target=self._drain, args=(self._queue,), daemon=True).start()
            logger.info(
                f"Analysis pool started: {ANALYSIS_POOL_WORKERS} workers, "
                f"{POLARS_THREADS_PER_WORKER} polars threads each"
            )

    @staticmethod
    def _drain(queue) -> None:
        """Forward worker progress messages into job_manager until sentinel/EOF."""
        while True:
            try:
                msg = queue.get()
            except (EOFError, OSError, BrokenPipeError):
                return  # manager shut down
            if msg is None:
                return
            try:
                if msg[0] == "progress":
                    _, job_id, pct, text = msg
                    job_manager.update_progress(job_id, pct, text)
                elif msg[0] == "step":
                    _, job_id, n = msg
                    job_manager.set_step(job_id, n)
            except Exception:
                logger.error(f"Failed to apply progress message {msg!r}", exc_info=True)

    def submit(
        self,
        job_id: str,
        fn: Callable[..., dict],
        *args: Any,
        on_done: Callable[[Future], None],
    ) -> Future:
        """Queue an analysis job. Marks the job RUNNING immediately so duplicate
        /run calls hit the existing 409 guard while the job waits for a worker."""
        self._ensure_started()
        job_manager.set_status(job_id, JobStatus.RUNNING, _QUEUED_MESSAGE)
        try:
            future = self._executor.submit(fn, job_id, self._queue, *args)
        except BrokenProcessPool:
            # A crashed worker (e.g. OOM) poisons the whole executor; rebuild
            # once so one bad job doesn't take the pool down for good.
            logger.error("Analysis pool broken — restarting executor", exc_info=True)
            with self._lock:
                self._executor.shutdown(wait=False, cancel_futures=True)
                self._executor = ProcessPoolExecutor(
                    max_workers=ANALYSIS_POOL_WORKERS,
                    initializer=worker_init,
                    initargs=(POLARS_THREADS_PER_WORKER,),
                )
            future = self._executor.submit(fn, job_id, self._queue, *args)
        future.add_done_callback(on_done)
        return future

    def shutdown(self) -> None:
        with self._lock:
            if self._executor is None:
                return
            try:
                self._queue.put(None)
            except Exception:
                pass
            self._executor.shutdown(wait=False, cancel_futures=True)
            self._manager.shutdown()
            self._executor = None
            self._manager = None
            self._queue = None
            logger.info("Analysis pool shut down")


def make_done_callback(
    job_id: str,
    result_cache: dict[str, Any],
    tool_logger: Logger,
) -> Callable[[Future], None]:
    """Completion handler run in the web process: populate the router's result
    cache and finish the job, or map worker failures onto fail_job."""

    def _on_done(future: Future) -> None:
        if future.cancelled():
            return
        try:
            payload = future.result()
        except AnalysisJobError as exc:
            tool_logger.error(f"[{job_id}] Analysis failed: {exc.errors}")
            job_manager.fail_job(job_id, exc.errors)
            return
        except Exception as exc:
            tool_logger.error(f"[{job_id}] Analysis failed with exception: {exc}")
            job_manager.fail_job(job_id, [str(exc)])
            return

        try:
            job_manager.get_job(job_id)
        except JobNotFoundError:
            tool_logger.info(f"[{job_id}] Job deleted while running; discarding results")
            return

        result_cache[job_id] = payload["result_dfs"]
        job_manager.complete_job(
            job_id,
            payload["summary"],
            io.BytesIO(payload["output_bytes"]),
            payload["output_filename"],
        )
        # If DELETE raced the two lines above, its cache purge may have run
        # before our insert — an orphaned entry would never be TTL-purged.
        try:
            job_manager.get_job(job_id)
        except JobNotFoundError:
            result_cache.pop(job_id, None)

    return _on_done


# Module-level singleton — imported by heavy-tool routers and main.py
analysis_pool = AnalysisPool()
