"""FastAPI application entry point for the EY Access Governance Platform.

Responsibilities:
- CORS configuration for the Vite dev server
- Request ID middleware (UUID per request, echoed in response headers)
- Request size limit middleware (200 MB hard cap)
- Global GovernanceError exception handler → structured JSON
- Lifespan: creates temp/ and logs/ on startup, cancels cleanup task on shutdown
- Background TTL cleanup task (runs every 5 minutes)
- Router registration for the governance tools
"""

import uuid
import asyncio
import logging
import pathlib
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from config import TEMP_DIR, LOG_DIR, CLEANUP_INTERVAL_SECONDS, MAX_UPLOAD_SIZE_BYTES
from exceptions import GovernanceError

logger = logging.getLogger("governance_platform")


# ── Access-log noise filter ───────────────────────────────────────────────────
# The frontend polls GET /api/{tool}/status/{job_id} every 1.5 s, which floods
# uvicorn's access log with identical "200 OK" lines and buries the useful
# per-step analysis logs. Drop ONLY those polling lines; every other access log
# (uploads, runs, downloads, errors) is kept.

class _SuppressStatusPolling(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        # uvicorn.access logs with args = (client_addr, method, full_path, http_version, status_code)
        if isinstance(args, tuple) and len(args) >= 3:
            method, path = args[1], args[2]
            if method == "GET" and isinstance(path, str) and "/status/" in path:
                return False
        return True


logging.getLogger("uvicorn.access").addFilter(_SuppressStatusPolling())


# ── Request ID middleware ─────────────────────────────────────────────────────

class RequestIDMiddleware(BaseHTTPMiddleware):
    """Attach a UUID request ID to each request; echo it in the response header."""

    async def dispatch(self, request: Request, call_next) -> Response:
        req_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = req_id
        return response


# ── Request size limit middleware ─────────────────────────────────────────────

class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """Return 413 before reading the body if Content-Length exceeds the cap."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next) -> Response:
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > self.max_bytes:
            return JSONResponse(
                status_code=413,
                content={
                    "error": True,
                    "message": "File exceeds maximum size of 200 MB.",
                    "code": "FILE_TOO_LARGE",
                    "details": [],
                },
            )
        return await call_next(request)


# ── Background cleanup loop ───────────────────────────────────────────────────

async def _cleanup_loop() -> None:
    """Remove expired jobs every CLEANUP_INTERVAL_SECONDS."""
    from services.job_manager import job_manager  # deferred to avoid circular import

    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
        try:
            removed = job_manager.cleanup_expired()
            if removed:
                logger.info(f"Cleanup: removed {removed} expired job(s)")
        except Exception as exc:
            logger.error(f"Cleanup error: {exc}", exc_info=True)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create required directories on startup; cancel cleanup task on shutdown."""
    TEMP_DIR.mkdir(exist_ok=True)
    LOG_DIR.mkdir(exist_ok=True)
    logger.info("EY Access Governance Platform started — temp/ and logs/ ready")

    cleanup_task = asyncio.create_task(_cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass
        logger.info("EY Access Governance Platform shutdown complete")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="EY Access Governance Platform",
    version="1.0.0",
    description="Unified Oracle access governance analysis platform",
    lifespan=lifespan,
)

# Middleware — registration order: outermost middleware added last
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestSizeLimitMiddleware, max_bytes=MAX_UPLOAD_SIZE_BYTES)
app.add_middleware(RequestIDMiddleware)


# ── Exception handlers ────────────────────────────────────────────────────────

_STATUS_CODES: dict[str, int] = {
    "VALIDATION_ERROR": 400,
    "FILE_FORMAT_ERROR": 400,
    "JOB_NOT_FOUND": 404,
    "PROCESSING_ERROR": 500,
    "SERVICE_UNAVAILABLE": 503,
    "INTERNAL_ERROR": 500,
}


@app.exception_handler(GovernanceError)
async def governance_error_handler(request: Request, exc: GovernanceError) -> JSONResponse:
    status = _STATUS_CODES.get(exc.code, 500)
    return JSONResponse(
        status_code=status,
        content={
            "error": True,
            "message": exc.message,
            "code": exc.code,
            "details": exc.details,
        },
    )


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(f"Unhandled exception on {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": True,
            "message": "An unexpected error occurred. Please check your input files and try again.",
            "code": "INTERNAL_ERROR",
            "details": [],
        },
    )


# ── Routers ───────────────────────────────────────────────────────────────────

from routers import oracle_comparator, sod_sa_analysis, ruleset_mapping  # noqa: E402

app.include_router(oracle_comparator.router)
app.include_router(sod_sa_analysis.router)
app.include_router(ruleset_mapping.router)

_TEMPLATES_DIR = pathlib.Path(__file__).parent / "templates"
_TEMPLATES_DIR.mkdir(exist_ok=True)
app.mount("/api/templates", StaticFiles(directory=str(_TEMPLATES_DIR)), name="templates")


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health", tags=["System"])
async def health() -> dict:
    """Liveness probe — returns 200 if the server is up."""
    from services.job_manager import job_manager
    return {"status": "ok", "version": "1.0.0", "jobs": job_manager.get_stats()}
