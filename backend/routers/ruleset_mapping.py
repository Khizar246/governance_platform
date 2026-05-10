"""Ruleset Mapping API router (Tool 5).

Endpoints:
  POST   /api/ruleset-mapping/upload              — upload client + EY ruleset files
  POST   /api/ruleset-mapping/run/{job_id}        — run full mapping pipeline
  GET    /api/ruleset-mapping/status/{job_id}
  GET    /api/ruleset-mapping/results/{job_id}    — paginated, tab=sod|sa|ent
  GET    /api/ruleset-mapping/filter-options/{job_id}
  GET    /api/ruleset-mapping/download/{job_id}
  DELETE /api/ruleset-mapping/job/{job_id}
"""

import logging
import threading

import pandas as pd
import polars as pl
from fastapi import APIRouter, Request, UploadFile, File
from fastapi.responses import JSONResponse, StreamingResponse

from config import MAX_UPLOAD_SIZE_BYTES, output_filename
from models.common import UploadResponse, AnalysisResponse, JobResponse, JobStatus, FilePreview
from services.job_manager import job_manager
from shared.file_io import load_excel_to_pandas, get_excel_sheet_names
from shared.validators import validate_upload, validate_dataframe_schema
from engines.ruleset_mapping_engine import run_ruleset_mapping

router = APIRouter(prefix="/api/ruleset-mapping", tags=["Ruleset Mapping"])
logger = logging.getLogger("governance_platform.ruleset_mapping")

_XLSX_ONLY = {".xlsx"}

REQUIRED_SHEETS = ["SoD Ruleset", "SA Ruleset", "Entitlement to Privilege"]

SHEET_REQUIRED_COLS: dict[str, set[str]] = {
    "SoD Ruleset": {
        "Control Name", "Risk Ranking", "LHS Entitlement", "RHS Entitlement", "Module(s)",
    },
    "SA Ruleset": {
        "Control Name", "Risk Ranking", "Entitlement", "Side", "Module(s)",
    },
    "Entitlement to Privilege": {
        "Entitlement Name", "Privilege Name", "Privilege Code",
    },
}

# Stores 3-tab result DataFrames per job_id; cleared on DELETE.
_result_dfs: dict[str, dict[str, pl.DataFrame]] = {}

_SORT_COLS = {
    "sod": "Client Control Name",
    "sa":  "Client Control Name",
    "ent": "Client Entitlement",
}


def _find_sheet(sheet_names: list[str], target: str) -> str | None:
    """Case-insensitive sheet name lookup. Returns actual name or None."""
    t = target.strip().upper()
    for name in sheet_names:
        if name.strip().upper() == t:
            return name
    return None


def _build_preview(df: pd.DataFrame, filename: str) -> FilePreview:
    preview = df.head(5).fillna("").to_dict(orient="records")
    return FilePreview(
        filename=filename,
        rows=len(df),
        columns=list(df.columns),
        preview=preview,
        duplicates=int(df.duplicated().sum()),
    )


def _run_thread(
    job_id: str,
    client_sod_df: pd.DataFrame,
    client_sa_df:  pd.DataFrame,
    client_e2p_df: pd.DataFrame,
    ey_sod_df:     pd.DataFrame,
    ey_sa_df:      pd.DataFrame,
    ey_e2p_df:     pd.DataFrame,
) -> None:
    try:
        cb = job_manager.make_progress_callback(job_id)
        result = run_ruleset_mapping(
            client_sod_df, client_sa_df, client_e2p_df,
            ey_sod_df,     ey_sa_df,     ey_e2p_df,
            progress_callback=cb,
        )

        if not result.success:
            job_manager.fail_job(job_id, result.errors)
            return

        data      = result.data
        sod_df    = data["sod_df"]
        sa_df     = data["sa_df"]
        ent_df    = data["ent_df"]
        excel_buf = data["excel_buffer"]
        summary   = data["summary"]

        _result_dfs[job_id] = {
            "sod": pl.from_pandas(sod_df.fillna("")),
            "sa":  pl.from_pandas(sa_df.fillna("")),
            "ent": pl.from_pandas(ent_df.fillna("")),
        }

        job_manager.complete_job(
            job_id, summary, excel_buf,
            output_filename("Ruleset_Mapping"),
        )

    except Exception as exc:
        logger.error("Ruleset mapping thread error: %s", exc, exc_info=True)
        job_manager.fail_job(job_id, [str(exc)])


@router.post("/upload", response_model=UploadResponse)
async def upload(
    client_file: UploadFile = File(..., description="Client Ruleset XLSX"),
    ey_file:     UploadFile = File(..., description="EY Ruleset XLSX"),
):
    errors: list[str] = []

    for uf, label in [(client_file, "Client Ruleset"), (ey_file, "EY Ruleset")]:
        ok, msg = await validate_upload(uf, MAX_UPLOAD_SIZE_BYTES, _XLSX_ONLY)
        if not ok:
            errors.append(f"{label}: {msg}")

    if errors:
        return JSONResponse(
            status_code=400,
            content={
                "error": True, "message": errors[0],
                "code": "VALIDATION_ERROR", "details": errors,
            },
        )

    client_bytes = await client_file.read()
    ey_bytes     = await ey_file.read()
    client_name  = client_file.filename or "client.xlsx"
    ey_name      = ey_file.filename or "ey.xlsx"

    # Validate sheet structure for both files
    loaded: dict[str, pd.DataFrame] = {}
    for file_bytes, filename, label in [
        (client_bytes, client_name, "Client Ruleset"),
        (ey_bytes,     ey_name,     "EY Ruleset"),
    ]:
        try:
            sheet_names = get_excel_sheet_names(file_bytes)
        except Exception as exc:
            return JSONResponse(
                status_code=400,
                content={"error": True, "message": str(exc), "code": "FILE_FORMAT_ERROR", "details": []},
            )

        prefix = "client" if label == "Client Ruleset" else "ey"

        for target_sheet in REQUIRED_SHEETS:
            actual_sheet = _find_sheet(sheet_names, target_sheet)
            if actual_sheet is None:
                errors.append(
                    f"{label} ('{filename}') is missing required sheet: '{target_sheet}'"
                )
                continue

            try:
                df = load_excel_to_pandas(file_bytes, filename, actual_sheet, logger)
            except Exception as exc:
                errors.append(f"{label}: {exc}")
                continue

            required_cols = SHEET_REQUIRED_COLS[target_sheet]
            valid, missing = validate_dataframe_schema(set(df.columns), required_cols, label)
            if not valid:
                for col in missing:
                    errors.append(
                        f"{label} ('{filename}'), sheet '{target_sheet}': "
                        f"missing required column '{col}'"
                    )
                continue

            key = f"{prefix}_{target_sheet.lower().replace(' ', '_').replace('(', '').replace(')', '')}"
            loaded[key] = df

    if errors:
        return JSONResponse(
            status_code=400,
            content={
                "error": True, "message": errors[0],
                "code": "VALIDATION_ERROR", "details": errors,
            },
        )

    # Map the loaded DataFrames to canonical keys
    client_sod_df = loaded["client_sod_ruleset"]
    client_sa_df  = loaded["client_sa_ruleset"]
    client_e2p_df = loaded["client_entitlement_to_privilege"]
    ey_sod_df     = loaded["ey_sod_ruleset"]
    ey_sa_df      = loaded["ey_sa_ruleset"]
    ey_e2p_df     = loaded["ey_entitlement_to_privilege"]

    job = job_manager.create_job("ruleset_mapping")
    job_manager.store_files(job.id, {
        "client_sod_df": client_sod_df,
        "client_sa_df":  client_sa_df,
        "client_e2p_df": client_e2p_df,
        "ey_sod_df":     ey_sod_df,
        "ey_sa_df":      ey_sa_df,
        "ey_e2p_df":     ey_e2p_df,
    })
    job_manager.set_status(job.id, JobStatus.VALIDATING, "Files validated.")

    return UploadResponse(
        job_id=job.id,
        files={
            "client_sod": _build_preview(client_sod_df, f"{client_name} › SoD Ruleset"),
            "client_sa":  _build_preview(client_sa_df,  f"{client_name} › SA Ruleset"),
            "client_e2p": _build_preview(client_e2p_df, f"{client_name} › Entitlement to Privilege"),
            "ey_sod":     _build_preview(ey_sod_df,     f"{ey_name} › SoD Ruleset"),
            "ey_sa":      _build_preview(ey_sa_df,      f"{ey_name} › SA Ruleset"),
            "ey_e2p":     _build_preview(ey_e2p_df,     f"{ey_name} › Entitlement to Privilege"),
        },
        status=JobStatus.VALIDATING,
    )


@router.post("/run/{job_id}", response_model=AnalysisResponse)
async def run(job_id: str):
    job = job_manager.get_job(job_id)

    files = job.files
    required_keys = ["client_sod_df", "client_sa_df", "client_e2p_df", "ey_sod_df", "ey_sa_df", "ey_e2p_df"]
    if any(files.get(k) is None for k in required_keys):
        return JSONResponse(
            status_code=400,
            content={
                "error": True,
                "message": "Files not found. Please upload again.",
                "code": "FILES_NOT_FOUND",
                "details": [],
            },
        )

    threading.Thread(
        target=_run_thread,
        args=(
            job_id,
            files["client_sod_df"], files["client_sa_df"], files["client_e2p_df"],
            files["ey_sod_df"],     files["ey_sa_df"],     files["ey_e2p_df"],
        ),
        daemon=True,
    ).start()

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


@router.get("/filter-options/{job_id}")
async def filter_options(request: Request, job_id: str, column: str, tab: str = "sod"):
    """Distinct values for one column after applying all other active column filters."""
    if job_id not in _result_dfs or tab not in _result_dfs[job_id]:
        job_manager.get_job(job_id)
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Results not ready.", "code": "NOT_READY", "details": []},
        )

    df: pl.DataFrame = _result_dfs[job_id][tab]
    _reserved = {"column", "tab"}
    for _col, _val in dict(request.query_params).items():
        if _col not in _reserved and _col != column and _col in df.columns and _val:
            _vals = [v.strip() for v in _val.split(",") if v.strip()]
            if _vals:
                df = df.filter(pl.col(_col).is_in(_vals))

    if column not in df.columns:
        return {"values": []}
    return {
        "values": (
            df.select(column).drop_nulls().unique().sort(column)
            .to_series().cast(pl.Utf8).to_list()
        )
    }


@router.get("/results/{job_id}")
async def results_page(
    request: Request,
    job_id: str,
    tab: str = "sod",
    page: int = 1,
    page_size: int = 50,
):
    if job_id not in _result_dfs or tab not in _result_dfs.get(job_id, {}):
        job_manager.get_job(job_id)
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Results not ready.", "code": "NOT_READY", "details": []},
        )

    df: pl.DataFrame = _result_dfs[job_id][tab]

    _reserved = {"page", "page_size", "tab"}
    for _col, _val in dict(request.query_params).items():
        if _col not in _reserved and _col in df.columns and _val:
            _vals = [v.strip() for v in _val.split(",") if v.strip()]
            if _vals:
                df = df.filter(pl.col(_col).is_in(_vals))

    sort_col = _SORT_COLS.get(tab)
    if sort_col and sort_col in df.columns:
        df = df.sort(sort_col)

    total     = df.height
    page_size = max(1, page_size)
    page      = max(1, page)
    start     = (page - 1) * page_size
    return {"data": df.slice(start, page_size).to_dicts(), "total": total, "page": page, "page_size": page_size}


@router.delete("/job/{job_id}")
async def cancel(job_id: str):
    job_manager.get_job(job_id)
    job_manager.delete_job(job_id)
    _result_dfs.pop(job_id, None)
    return {"message": "Job deleted."}
