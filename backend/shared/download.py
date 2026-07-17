"""Shared /download endpoint body — streams a completed job's output buffer.

All four tools' /download/{job_id} endpoints are identical apart from the
media type (xlsx vs zip); each router delegates here.
"""

import io

from fastapi.responses import JSONResponse, StreamingResponse

from models.common import JobStatus
from services.job_manager import job_manager

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def stream_job_output(job_id: str, media_type: str = XLSX_MEDIA_TYPE):
    """Return the job's output as an attachment, or the NOT_READY/NOT_FOUND error."""
    job = job_manager.get_job(job_id)

    if job.status != JobStatus.COMPLETE:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Analysis is not complete yet.", "code": "NOT_READY", "details": []},
        )
    if job.output_buffer is None:
        return JSONResponse(
            status_code=404,
            content={"error": True, "message": "Download not available.", "code": "NOT_FOUND", "details": []},
        )

    # Copy per request: concurrent downloads sharing one BytesIO corrupt each
    # other (each seek(0) rewinds the stream the other is mid-way through).
    return StreamingResponse(
        io.BytesIO(job.output_buffer.getvalue()),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{job.output_filename}"'},
    )
