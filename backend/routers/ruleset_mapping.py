"""Ruleset Mapping API router.

Endpoints:
  POST   /api/ruleset-mapping/upload              — upload client + EY ruleset files
  POST   /api/ruleset-mapping/run/{job_id}        — run full mapping pipeline
  GET    /api/ruleset-mapping/status/{job_id}
  GET    /api/ruleset-mapping/results/{job_id}    — paginated, tab=sod|sa|ent
  GET    /api/ruleset-mapping/filter-options/{job_id}
  GET    /api/ruleset-mapping/download/{job_id}
  DELETE /api/ruleset-mapping/job/{job_id}
"""

import threading

import pandas as pd
import polars as pl
from fastapi import APIRouter, Request, UploadFile, File
from fastapi.responses import JSONResponse

from config import MAX_UPLOAD_SIZE_BYTES, output_filename
from exceptions import JobNotFoundError
from models.common import UploadResponse, AnalysisResponse, JobResponse, JobStatus, FilePreview
from services.job_manager import job_manager
from shared.download import stream_job_output
from shared.file_io import load_excel_to_pandas, get_excel_sheet_names
from shared.query_filters import apply_column_filters
from shared.validators import validate_upload, validate_dataframe_schema
from shared.logger import get_logger
from engines.ruleset_mapping_engine import run_ruleset_mapping

router = APIRouter(prefix="/api/ruleset-mapping", tags=["Ruleset Mapping"])
logger = get_logger("ruleset_mapping")

_XLSX_ONLY = {".xlsx"}

REQUIRED_SHEETS = ["SoD Ruleset", "SA Ruleset", "Entitlement to Privilege"]

SHEET_REQUIRED_COLS: dict[str, set[str]] = {
    "SoD Ruleset": {
        "Control Name", "LHS Entitlement", "RHS Entitlement",
    },
    "SA Ruleset": {
        "Control Name", "Entitlement",
    },
    "Entitlement to Privilege": {
        "Entitlement Name", "Privilege Code", "Module",
    },
}

# Recommended-but-optional columns. Their absence does NOT block the upload; it
# raises a non-blocking warning shown on the preview step (analysis still proceeds).
SHEET_RECOMMENDED_COLS: dict[str, set[str]] = {
    "SoD Ruleset": {"Risk Ranking", "Module(s)"},
    "SA Ruleset": {"Risk Ranking", "Side", "Module(s)"},
    "Entitlement to Privilege": {"Privilege Name"},
}

# Stores per-direction result DataFrames per job_id; purged on DELETE and on TTL
# expiry. Shape: {job_id: {"c2e": {tab: pl.DataFrame}, "e2c": {tab: pl.DataFrame}}}.
_result_dfs: dict[str, dict[str, dict[str, pl.DataFrame]]] = {}
job_manager.register_result_cache(_result_dfs)

# Sort column per tab is direction-aware (the source control/entitlement column
# carries the active source label). Resolved at query time from the actual columns.
_SORT_TAB_FALLBACK = {
    "sod":          ["Control Name"],
    "sa":           ["Control Name"],
    "ent":          ["Entitlement"],
    "missing_ctrl": ["Control Name"],
    "missing_priv": ["Source Control"],
}


def _resolve_sort_col(df: pl.DataFrame, tab: str) -> str | None:
    """Pick the first column whose name contains the tab's fallback token."""
    for token in _SORT_TAB_FALLBACK.get(tab, []):
        for col in df.columns:
            if token in col:
                return col
    return None


def _find_sheet(sheet_names: list[str], target: str) -> str | None:
    """Case-insensitive sheet name lookup. Returns actual name or None."""
    t = target.strip().upper()
    for name in sheet_names:
        if name.strip().upper() == t:
            return name
    return None


def _build_preview(df: pd.DataFrame, filename: str) -> FilePreview:
    return FilePreview(
        filename=filename,
        rows=len(df),
        columns=list(df.columns),
    )


def _step_for_progress(pct: int, msg: str) -> int:
    """Map an engine progress message onto the frontend checklist step ids.

    The engine runs Client→EY over pct 1–48 and EY→Client over 48–92; the
    SoD/SA messages carry no direction label, so direction comes from pct.
    Returns 0 when the message doesn't mark a new step (keep the current one).
    """
    first_direction = pct < 48
    if "running entitlement mapping" in msg:
        return 2 if first_direction else 5
    if msg.startswith("SoD"):
        return 3 if first_direction else 6
    if msg.startswith("SA"):
        return 4 if first_direction else 7
    if msg.startswith("Building summary"):
        return 8
    if msg.startswith("Generating Excel report"):
        return 9
    return 0


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
        logger.info(f"[{job_id}] Starting Ruleset Mapping: client_sod={client_sod_df.shape[0]} rows, client_sa={client_sa_df.shape[0]} rows, client_e2p={client_e2p_df.shape[0]} rows, ey_sod={ey_sod_df.shape[0]} rows, ey_sa={ey_sa_df.shape[0]} rows, ey_e2p={ey_e2p_df.shape[0]} rows")
        raw_cb = job_manager.make_progress_callback(job_id)

        def cb(pct: int, msg: str) -> None:
            step = _step_for_progress(pct, msg)
            if step:
                job_manager.set_step(job_id, step)
            raw_cb(pct, msg)

        job_manager.set_step(job_id, 1)
        raw_cb(1, "Loading rulesets…")
        result = run_ruleset_mapping(
            client_sod_df, client_sa_df, client_e2p_df,
            ey_sod_df,     ey_sa_df,     ey_e2p_df,
            progress_callback=cb,
        )

        if not result.success:
            logger.error(f"[{job_id}] Ruleset Mapping failed: {result.errors}")
            job_manager.fail_job(job_id, result.errors)
            return

        data      = result.data
        c2e       = data["c2e"]
        e2c       = data["e2c"]
        excel_buf = data["excel_buffer"]
        summary   = data["summary"]

        logger.info(
            f"[{job_id}] Mapping complete - C→EY SoD: {c2e['sod_df'].shape[0]}, SA: {c2e['sa_df'].shape[0]}; "
            f"EY→C SoD: {e2c['sod_df'].shape[0]}, SA: {e2c['sa_df'].shape[0]}"
        )

        def _dir_cache(d: dict) -> dict[str, pl.DataFrame]:
            return {
                "sod":          pl.from_pandas(d["sod_df"].fillna("")),
                "sa":           pl.from_pandas(d["sa_df"].fillna("")),
                "ent":          pl.from_pandas(d["ent_df"].fillna("")),
                "missing_ctrl": pl.from_pandas(d["missing_ctrl_df"].fillna("")),
                "missing_priv": pl.from_pandas(d["missing_priv_df"].fillna("")),
            }

        # Cancelled mid-run: the job is gone, so caching results here would
        # orphan them (DELETE's cache purge has already run).
        try:
            job_manager.get_job(job_id)
        except JobNotFoundError:
            logger.info(f"[{job_id}] Job deleted while running; discarding results")
            return

        _result_dfs[job_id] = {
            "c2e": _dir_cache(c2e),
            "e2c": _dir_cache(e2c),
        }

        output_file = output_filename("Ruleset_Mapping")
        logger.info(f"[{job_id}] Ruleset Mapping complete. Output file: {output_file}")
        job_manager.complete_job(job_id, summary, excel_buf, output_file)

        # If DELETE raced the two lines above, its cache purge may have run
        # before our insert — an orphaned entry would never be TTL-purged.
        try:
            job_manager.get_job(job_id)
        except JobNotFoundError:
            _result_dfs.pop(job_id, None)

    except Exception as exc:
        logger.error(f"[{job_id}] Ruleset Mapping failed with exception", exc_info=True)
        job_manager.fail_job(job_id, [str(exc)])


@router.post("/upload", response_model=UploadResponse)
async def upload(
    client_file: UploadFile = File(..., description="Client Ruleset XLSX"),
    ey_file:     UploadFile = File(..., description="EY Ruleset XLSX"),
):
    logger.info(f"Ruleset Mapping upload initiated. Files: {client_file.filename}, {ey_file.filename}")
    errors: list[str] = []

    for uf, label in [(client_file, "Client Ruleset"), (ey_file, "EY Ruleset")]:
        ok, msg = await validate_upload(uf, MAX_UPLOAD_SIZE_BYTES, _XLSX_ONLY)
        if not ok:
            errors.append(f"{label}: {msg}")

    if errors:
        logger.error(f"Ruleset Mapping upload validation failed: {errors}")
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

    # ── Validate sheet structure for both files (collect all errors) ───────────
    loaded: dict[str, pd.DataFrame] = {}
    warnings: list[str] = []
    for file_bytes, filename, label in [
        (client_bytes, client_name, "Client Ruleset"),
        (ey_bytes,     ey_name,     "EY Ruleset"),
    ]:
        # Try to get sheet names; if it fails, collect the error and continue
        sheet_names: list[str] = []
        try:
            sheet_names = get_excel_sheet_names(file_bytes)
            logger.info(f"Loaded {label} sheet names: {sheet_names}")
        except Exception as exc:
            logger.error(f"Failed to load {label} sheet names: {exc}", exc_info=True)
            errors.append(f"{label} ('{filename}'): Failed to read sheet names: {exc}")
            continue

        prefix = "client" if label == "Client Ruleset" else "ey"

        for target_sheet in REQUIRED_SHEETS:
            actual_sheet = _find_sheet(sheet_names, target_sheet)
            if actual_sheet is None:
                errors.append(
                    f"{label} ('{filename}'): Missing required sheet '{target_sheet}'"
                )
                continue

            try:
                df = load_excel_to_pandas(file_bytes, filename, actual_sheet, logger)
                logger.info(f"Loaded {label} {actual_sheet}: {df.shape[0]} rows, {df.shape[1]} columns")
            except Exception as exc:
                logger.error(f"Failed to load {label} {actual_sheet}: {exc}", exc_info=True)
                errors.append(f"{label} ('{filename}'), sheet '{actual_sheet}': {exc}")
                continue

            required_cols = SHEET_REQUIRED_COLS[target_sheet]
            valid, missing = validate_dataframe_schema(set(df.columns), required_cols, label)
            if not valid:
                for col in missing:
                    errors.append(
                        f"{label} ('{filename}'), sheet '{target_sheet}': "
                        f"Missing required column '{col}'"
                    )
                continue

            recommended_cols = SHEET_RECOMMENDED_COLS.get(target_sheet, set())
            _, missing_recommended = validate_dataframe_schema(set(df.columns), recommended_cols, label)
            for col in missing_recommended:
                warnings.append(
                    f"{label} ('{filename}'), sheet '{target_sheet}': "
                    f"Missing recommended column '{col}'"
                )

            key = f"{prefix}_{target_sheet.lower().replace(' ', '_').replace('(', '').replace(')', '')}"
            loaded[key] = df

    if errors:
        logger.error(f"Ruleset Mapping upload failed with {len(errors)} error(s): {errors}")
        return JSONResponse(
            status_code=400,
            content={
                "error": True, "message": f"Found {len(errors)} validation error(s). See details below.",
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
    logger.info(f"[{job.id}] Created job for Ruleset Mapping")
    job_manager.store_files(job.id, {
        "client_sod_df": client_sod_df,
        "client_sa_df":  client_sa_df,
        "client_e2p_df": client_e2p_df,
        "ey_sod_df":     ey_sod_df,
        "ey_sa_df":      ey_sa_df,
        "ey_e2p_df":     ey_e2p_df,
    })
    job_manager.set_status(job.id, JobStatus.VALIDATING, "Files validated.")
    logger.info(f"[{job.id}] Files stored and validated. Ready for mapping.")

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
        warnings=warnings,
    )


@router.post("/run/{job_id}", response_model=AnalysisResponse)
async def run(job_id: str):
    job = job_manager.get_job(job_id)

    if job.status == JobStatus.RUNNING:
        return JSONResponse(
            status_code=409,
            content={"error": True, "message": "Analysis is already running for this job.", "code": "ALREADY_RUNNING", "details": []},
        )

    files = job.files
    required_keys = ["client_sod_df", "client_sa_df", "client_e2p_df", "ey_sod_df", "ey_sa_df", "ey_e2p_df"]
    if any(files.get(k) is None for k in required_keys):
        logger.error(f"[{job_id}] Run requested but missing required files")
        return JSONResponse(
            status_code=400,
            content={
                "error": True,
                "message": "Files not found. Please upload again.",
                "code": "FILES_NOT_FOUND",
                "details": [],
            },
        )

    # Atomically claim the job right before spawning the thread. The early check
    # above is the fast path; this compare-and-set closes the check-then-act race
    # where two simultaneous POSTs both pass and start duplicate threads.
    if not job_manager.try_begin_run(job_id):
        return JSONResponse(
            status_code=409,
            content={"error": True, "message": "Analysis is already running for this job.", "code": "ALREADY_RUNNING", "details": []},
        )

    logger.info(f"[{job_id}] Starting mapping thread")
    threading.Thread(
        target=_run_thread,
        args=(
            job_id,
            files["client_sod_df"], files["client_sa_df"], files["client_e2p_df"],
            files["ey_sod_df"],     files["ey_sa_df"],     files["ey_e2p_df"],
        ),
        daemon=True,
    ).start()

    return AnalysisResponse(job_id=job_id, status=JobStatus.RUNNING)


@router.get("/status/{job_id}", response_model=JobResponse)
async def status(job_id: str):
    return job_manager.to_job_response(job_manager.get_job(job_id))


@router.get("/download/{job_id}")
async def download(job_id: str):
    return stream_job_output(job_id)


@router.get("/filter-options/{job_id}")
async def filter_options(request: Request, job_id: str, column: str, tab: str = "sod", direction: str = "c2e"):
    """Distinct values for one column after applying all other active column filters."""
    direction = direction if direction in ("c2e", "e2c") else "c2e"
    if (
        job_id not in _result_dfs
        or direction not in _result_dfs[job_id]
        or tab not in _result_dfs[job_id][direction]
    ):
        job_manager.get_job(job_id)
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Results not ready.", "code": "NOT_READY", "details": []},
        )

    df: pl.DataFrame = _result_dfs[job_id][direction][tab]
    df = apply_column_filters(
        df,
        dict(request.query_params),
        reserved={"column", "tab", "direction"},
        exclude_column=column,
    )

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
    direction: str = "c2e",
    page: int = 1,
    page_size: int = 50,
):
    direction = direction if direction in ("c2e", "e2c") else "c2e"
    if (
        job_id not in _result_dfs
        or direction not in _result_dfs.get(job_id, {})
        or tab not in _result_dfs.get(job_id, {}).get(direction, {})
    ):
        job_manager.get_job(job_id)
        return JSONResponse(
            status_code=400,
            content={"error": True, "message": "Results not ready.", "code": "NOT_READY", "details": []},
        )

    df: pl.DataFrame = _result_dfs[job_id][direction][tab]

    df = apply_column_filters(
        df, dict(request.query_params), reserved={"page", "page_size", "tab", "direction"}
    )

    sort_col = _resolve_sort_col(df, tab)
    if sort_col:
        df = df.sort(sort_col)

    total     = df.height
    # Upper bound guards the server from serialising an entire sheet in one
    # response (frontend's largest page is 200).
    page_size = min(max(1, page_size), 500)
    page      = max(1, page)
    start     = (page - 1) * page_size
    return {"data": df.slice(start, page_size).to_dicts(), "total": total, "page": page, "page_size": page_size}


@router.delete("/job/{job_id}")
async def cancel(job_id: str):
    job_manager.get_job(job_id)
    job_manager.delete_job(job_id)  # also purges this router's registered result cache
    return {"message": "Job deleted."}
