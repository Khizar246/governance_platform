"""Entitlement Mapping API router (Tool 1).

Endpoints:
  POST /api/entitlement-mapping/upload       — upload client + EY files
  POST /api/entitlement-mapping/run/{job_id} — run mapping analysis
  GET  /api/entitlement-mapping/status/{job_id}
  GET  /api/entitlement-mapping/download/{job_id}
  DELETE /api/entitlement-mapping/job/{job_id}
"""

import io
import logging
import threading

import pandas as pd
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse, StreamingResponse

from config import MAX_UPLOAD_SIZE_BYTES, ALLOWED_EXTENSIONS, output_filename
from models.common import UploadResponse, AnalysisResponse, JobResponse, JobStatus, FilePreview
from services.job_manager import job_manager
from shared.file_io import load_csv_to_pandas, load_excel_to_pandas
from shared.validators import validate_upload
from engines.entitlement_mapping_engine import run_mapping, COLUMN_DESCRIPTIONS

router = APIRouter(prefix="/api/entitlement-mapping", tags=["Entitlement Mapping"])
logger = logging.getLogger("governance_platform.entitlement_mapping")

_REQUIRED_COLS = {"Entitlement Name", "Privilege Name", "Privilege Code"}

# Stores full result records per job_id for paginated access; cleared on DELETE.
_result_rows: dict[str, list[dict]] = {}


def _is_full_coverage(s: str) -> bool:
    parts = str(s).split("/")
    if len(parts) != 2:
        return False
    try:
        return int(parts[0]) == int(parts[1]) and int(parts[1]) > 0
    except ValueError:
        return False


def _build_preview(df: pd.DataFrame, filename: str) -> FilePreview:
    preview = df.head(5).fillna("").to_dict(orient="records")
    return FilePreview(
        filename=filename,
        rows=len(df),
        columns=list(df.columns),
        preview=preview,
        duplicates=int(df.duplicated().sum()),
    )


def _load_file(file_bytes: bytes, filename: str) -> pd.DataFrame:
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if ext == ".csv":
        return load_csv_to_pandas(file_bytes, filename, logger)
    return load_excel_to_pandas(file_bytes, filename, None, logger)


def _run_thread(job_id: str, client_df: pd.DataFrame, ey_df: pd.DataFrame) -> None:
    try:
        callback = job_manager.make_progress_callback(job_id)
        result = run_mapping(client_df, ey_df, progress_callback=callback)

        if not result.success:
            job_manager.fail_job(job_id, result.errors)
            return

        result_df: pd.DataFrame = result.data

        total = len(result_df)
        no_matches = int((result_df["EY Entitlement Match"] == "—").sum())

        full_cov = result_df["Privilege Match Count"].apply(_is_full_coverage)
        exact = int((full_cov & (result_df["Jaccard Similarity (%)"] == "100%")).sum())
        supersets = int((full_cov & (result_df["Jaccard Similarity (%)"] != "100%")).sum())
        partial = max(0, total - exact - supersets - no_matches)

        summary = {
            "total_mappings": total,
            "exact_matches": exact,
            "supersets": supersets,
            "partial_matches": partial,
            "no_matches": no_matches,
            "results_preview": result_df.head(20).fillna("").to_dict(orient="records"),
        }

        _result_rows[job_id] = result_df.fillna("").to_dict(orient="records")

        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="xlsxwriter") as writer:
            wb = writer.book
            hdr_fmt = wb.add_format({"bold": True, "bg_color": "#D7E4BC", "border": 1})
            result_df.to_excel(writer, sheet_name="Entitlement Mapping", index=False)
            ws = writer.sheets["Entitlement Mapping"]
            for ci, col in enumerate(result_df.columns):
                ws.write(0, ci, col, hdr_fmt)
                max_len = (
                    result_df[col].astype(str).map(len).max()
                    if len(result_df) else 0
                )
                ws.set_column(ci, ci, min(max(len(str(col)), max_len) + 3, 60))

            # ── "How to Read This Report" sheet ───────────────────────────────
            doc_ws = wb.add_worksheet("How to Read This Report")
            doc_ws.set_column(0, 0, 28)
            doc_ws.set_column(1, 1, 82)

            sec_fmt  = wb.add_format({"bold": True, "font_size": 11})
            wrap_fmt = wb.add_format({"text_wrap": True, "valign": "top"})
            col_hdr  = wb.add_format({"bold": True, "bg_color": "#D7E4BC", "border": 1})

            r = 0
            doc_ws.write(r, 0, "About This Report", sec_fmt); r += 2

            doc_ws.write(r, 0, "What this tool does", sec_fmt); r += 1
            doc_ws.write(r, 0, (
                "The Entitlement Mapping tool compares each client access entitlement "
                "against EY's standard entitlement ruleset to find the closest match. "
                "For each client entitlement it identifies which EY entitlement shares "
                "the most privileges."
            ), wrap_fmt)
            doc_ws.set_row(r, 48); r += 2

            doc_ws.write(r, 0, "How matching works", sec_fmt); r += 1
            doc_ws.write(r, 0, (
                "Candidates are ranked by (1) overlap count — the number of client "
                "privileges found in the EY entitlement — as the primary criterion, "
                "then (2) Jaccard similarity as a tiebreaker to penalise bloated EY "
                "entitlements. When two EY entitlements cover the same client privileges, "
                "the smaller, more focused one ranks higher."
            ), wrap_fmt)
            doc_ws.set_row(r, 60); r += 2

            doc_ws.write(r, 0, "Match Confidence tiers", sec_fmt); r += 1
            for tier, desc in [
                ("High",   "75% or more of the client's privileges are covered."),
                ("Medium", "40–74% of client privileges covered."),
                ("Low",    "Fewer than 40% of client privileges covered."),
                ("None",   "No client privilege exists anywhere in the EY ruleset."),
            ]:
                doc_ws.write(r, 0, tier)
                doc_ws.write(r, 1, desc)
                r += 1
            r += 1

            doc_ws.write(r, 0, "Runner-Up entitlements", sec_fmt); r += 1
            doc_ws.write(r, 0, (
                "The 2nd and 3rd best EY candidates are shown for each row. Useful "
                "when the best match is imperfect: a runner-up may cover the privileges "
                "the best match misses, and combining entitlements may achieve full coverage."
            ), wrap_fmt)
            doc_ws.set_row(r, 48); r += 2

            doc_ws.write(r, 0, "Column Reference", sec_fmt); r += 1
            doc_ws.write(r, 0, "Column", col_hdr)
            doc_ws.write(r, 1, "Description", col_hdr)
            r += 1
            for col_name, col_desc in COLUMN_DESCRIPTIONS.items():
                doc_ws.write(r, 0, col_name)
                doc_ws.write(r, 1, col_desc, wrap_fmt)
                doc_ws.set_row(r, 42)
                r += 1

        buf.seek(0)

        job_manager.complete_job(job_id, summary, buf, output_filename("Entitlement_Mapping"))

    except Exception as exc:
        logger.error("Entitlement mapping thread error: %s", exc, exc_info=True)
        job_manager.fail_job(job_id, [str(exc)])


@router.post("/upload", response_model=UploadResponse)
async def upload(
    client_file: UploadFile = File(..., description="Client entitlement CSV/XLSX"),
    ey_file: UploadFile = File(..., description="EY ruleset CSV/XLSX"),
):
    errors: list[str] = []

    for uf, label in [(client_file, "Client file"), (ey_file, "EY ruleset")]:
        ok, msg = await validate_upload(uf, MAX_UPLOAD_SIZE_BYTES, ALLOWED_EXTENSIONS)
        if not ok:
            errors.append(f"{label}: {msg}")

    if errors:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": errors[0], "code": "VALIDATION_ERROR", "details": errors},
        )

    client_bytes = await client_file.read()
    ey_bytes = await ey_file.read()

    try:
        client_df = _load_file(client_bytes, client_file.filename or "client.csv")
        ey_df = _load_file(ey_bytes, ey_file.filename or "ey.csv")
    except Exception as exc:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": str(exc), "code": "FILE_FORMAT_ERROR", "details": []},
        )

    for df, label in [(client_df, "Client file"), (ey_df, "EY ruleset")]:
        present = {c.strip().upper() for c in df.columns}
        missing = [c for c in _REQUIRED_COLS if c.strip().upper() not in present]
        if missing:
            errors.append(f"{label} is missing required columns: {missing}")

    if errors:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": errors[0], "code": "VALIDATION_ERROR", "details": errors},
        )

    job = job_manager.create_job("entitlement_mapping")
    job_manager.store_files(job.id, {"client_df": client_df, "ey_df": ey_df})
    job_manager.set_status(job.id, JobStatus.VALIDATING, "Files validated.")

    return UploadResponse(
        job_id=job.id,
        files={
            "client_file": _build_preview(client_df, client_file.filename or "client.csv"),
            "ey_file": _build_preview(ey_df, ey_file.filename or "ey.csv"),
        },
        status=JobStatus.VALIDATING,
    )


@router.post("/run/{job_id}", response_model=AnalysisResponse)
async def run(job_id: str):
    job = job_manager.get_job(job_id)

    client_df = job.files.get("client_df")
    ey_df = job.files.get("ey_df")
    if client_df is None or ey_df is None:
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Files not found. Please upload again.", "code": "FILES_NOT_FOUND", "details": []},
        )

    threading.Thread(target=_run_thread, args=(job_id, client_df, ey_df), daemon=True).start()

    return AnalysisResponse(job_id=job_id, status=JobStatus.RUNNING, summary={})


@router.get("/status/{job_id}", response_model=JobResponse)
async def status(job_id: str):
    return job_manager.to_job_response(job_manager.get_job(job_id))


@router.get("/download/{job_id}")
async def download(job_id: str):
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

    job.output_buffer.seek(0)
    return StreamingResponse(
        job.output_buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{job.output_filename}"'},
    )


@router.get("/results/{job_id}")
async def results_page(
    job_id: str,
    page: int = 1,
    page_size: int = 50,
    tab: str = "all",
    client_filter: str = "",
    ey_filter: str = "",
    confidence: str = "",
    pmc_filter: str = "",
    jaccard_filter: str = "",
    runner_up_filter: str = "",
):
    if job_id not in _result_rows:
        job_manager.get_job(job_id)  # raises 404 if job is gone entirely
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Results not ready.", "code": "NOT_READY", "details": []},
        )

    rows: list[dict] = _result_rows[job_id]

    if tab == "exact":
        rows = [r for r in rows if _is_full_coverage(r.get("Privilege Match Count", "")) and r.get("Jaccard Similarity (%)", "") == "100%"]
    elif tab == "superset":
        rows = [r for r in rows if _is_full_coverage(r.get("Privilege Match Count", "")) and r.get("Jaccard Similarity (%)", "") != "100%"]
    elif tab == "no_match":
        rows = [r for r in rows if r.get("EY Entitlement Match", "") == "—"]
    elif tab == "partial":
        rows = [r for r in rows if r.get("EY Entitlement Match", "") != "—" and not _is_full_coverage(r.get("Privilege Match Count", ""))]

    if client_filter:
        q = client_filter.lower()
        rows = [r for r in rows if q in str(r.get("Client Entitlement", "")).lower()]
    if ey_filter:
        q = ey_filter.lower()
        rows = [r for r in rows if q in str(r.get("EY Entitlement Match", "")).lower()]
    if confidence:
        rows = [r for r in rows if r.get("Match Confidence", "") == confidence]
    if pmc_filter:
        q = pmc_filter.lower()
        rows = [r for r in rows if q in str(r.get("Privilege Match Count", "")).lower()]
    if jaccard_filter:
        q = jaccard_filter.lower()
        rows = [r for r in rows if q in str(r.get("Jaccard Similarity (%)", "")).lower()]
    if runner_up_filter:
        q = runner_up_filter.lower()
        rows = [r for r in rows if q in str(r.get("Runner-Up EY Entitlements", "")).lower()]

    total = len(rows)
    page_size = max(1, min(page_size, 200))
    page = max(1, page)
    start = (page - 1) * page_size
    return {"data": rows[start: start + page_size], "total": total, "page": page, "page_size": page_size}


@router.delete("/job/{job_id}")
async def cancel(job_id: str):
    job_manager.get_job(job_id)
    job_manager.delete_job(job_id)
    _result_rows.pop(job_id, None)
    return {"message": "Job deleted."}
