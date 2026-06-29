"""Ruleset Mapping Engine (Tool 5).

Maps SoD and SA ruleset controls between a Client ruleset and the EY ruleset in
BOTH directions (Client→EY and EY→Client), using:
  Step 1 — Entitlement-to-entitlement mapping (delegates to existing engine), which
           yields each source entitlement's best target match + blended confidence
  Step 2 — SoD control matching: a control maps when BOTH its entitlements resolved
           to a real target match (engine applied MATCH_THRESHOLD) — Direct if a
           real target control pairs them, else Derived
  Step 3 — SA control matching: maps when its single entitlement resolved to a real
           target match that is itself a target SA control

The core mapping is a pure function of (source, target). `run_ruleset_mapping`
calls it twice — once per direction — so "missing controls", "missing privileges"
and the recommendations are recomputed relative to whichever ruleset is the source.

Pure Python/Pandas — no FastAPI, no Pydantic, no HTTP.
"""

import io
from typing import Callable

import pandas as pd

from engines.entitlement_mapping_engine import run_mapping, EngineResult

# Sentinel values the entitlement engine writes in the match column when there is
# no usable mapping: "—" (no shared privilege) or "Not Mapped" (best candidate
# below MATCH_THRESHOLD). A SoD/SA control maps only when every entitlement it
# depends on resolved to a real target entitlement (the engine already applied the
# confidence threshold — this is the single source of truth).
_UNMAPPED = {"—", "Not Mapped", ""}


def _is_mapped(ent_name: str) -> bool:
    """True when the entitlement engine produced a real target match for this name."""
    return ent_name not in _UNMAPPED


def _find_col_pd(df: pd.DataFrame, target: str) -> str:
    """Case-insensitive column name lookup. Returns the actual column name."""
    t = target.strip().upper()
    for col in df.columns:
        if col.strip().upper() == t:
            return col
    raise KeyError(
        f"Required column '{target}' not found. "
        f"Available columns: {list(df.columns)}"
    )


def _scale_cb(cb: Callable | None, start: int, end: int) -> Callable:
    """Wrap a progress callback to map [0,100] into [start, end]."""
    def _inner(pct: int, msg: str) -> None:
        if cb:
            cb(start + int(pct / 100 * (end - start)), msg)
    return _inner


def _build_priv_groups(df: pd.DataFrame, ent_col: str, priv_col: str) -> dict[str, set[str]]:
    """Build {entitlement_name → set(privilege_codes)} from an E2P DataFrame.

    Drops rows where either column is null before grouping.
    """
    df_clean = df[[ent_col, priv_col]].dropna()
    if df_clean.empty:
        return {}
    return df_clean.groupby(ent_col)[priv_col].apply(set).to_dict()


def _missing_privs_text(
    src_privs: set[str],
    tgt_ent_names: list[str],
    tgt_priv_groups: dict[str, set[str]],
) -> str:
    """Recommendation string: target-side privileges absent from the source set,
    grouped by the matched target entitlement that supplies them (Enhancement 3).

    e.g. "Approve Invoices: PRIV_C, PRIV_D | Post GL: PRIV_E".
    Privileges already held by the source are excluded.
    """
    parts: list[str] = []
    for ent in tgt_ent_names:
        if not ent or ent == "—":
            continue
        extra = sorted(tgt_priv_groups.get(ent, set()) - src_privs)
        if extra:
            parts.append(f"{ent}: {', '.join(extra)}")
    return " | ".join(parts)


def _map_sod_controls(
    src_sod_df: pd.DataFrame,
    tgt_sod_df: pd.DataFrame,
    src_priv_groups: dict[str, set[str]],
    tgt_priv_groups: dict[str, set[str]],
    ent_mapping: dict[str, str],
    ent_confidence: dict[str, float],
    cols: dict[str, str],
    cb: Callable,
    pct_lo: int,
    pct_hi: int,
) -> pd.DataFrame:
    """Map each source SoD control to a target SoD control via entitlement confidence.

    Each source control has two entitlements (LHS/RHS). The control maps only when
    BOTH entitlements resolved to a real target match in `ent_mapping` (the engine
    already dropped sub-threshold matches to "Not Mapped") — a strong match on one
    entitlement can never carry a weak second one. The control's Confidence Score is
    the weaker (min) of the two entitlement confidences (`ent_confidence`).

    When both entitlements qualify:
      • Direct — a real target SoD control already pairs those two matched EY
        entitlements as its two legs (either LHS/RHS order).
      • Derived Control — both qualify but no existing target control pairs them, so
        the inferred control "[T_LHS] AND [T_RHS]" is created.
    If either entitlement is unmapped or below threshold → Unmatched (no Derived).
    """
    cb(pct_lo, "SoD: building target control index…")

    tgt_ctrl_col = _find_col_pd(tgt_sod_df, "Control Name")
    tgt_lhs_col  = _find_col_pd(tgt_sod_df, "LHS Entitlement")
    tgt_rhs_col  = _find_col_pd(tgt_sod_df, "RHS Entitlement")

    # Index target SoD controls by the unordered pair of their two entitlements, so
    # a Direct match is "is there a real control pairing these two EY entitlements?"
    tgt_pair_to_ctrl: dict[frozenset, str] = {}
    for _, row in tgt_sod_df.iterrows():
        ctrl = row[tgt_ctrl_col]
        if pd.isna(ctrl):
            continue
        lhs = str(row[tgt_lhs_col]) if pd.notna(row[tgt_lhs_col]) else ""
        rhs = str(row[tgt_rhs_col]) if pd.notna(row[tgt_rhs_col]) else ""
        key = frozenset((lhs, rhs))
        tgt_pair_to_ctrl.setdefault(key, str(ctrl))

    src_ctrl_col = _find_col_pd(src_sod_df, "Control Name")
    src_lhs_col  = _find_col_pd(src_sod_df, "LHS Entitlement")
    src_rhs_col  = _find_col_pd(src_sod_df, "RHS Entitlement")

    total = len(src_sod_df)
    report_step = max(1, total // 20)
    results: list[dict] = []

    for idx, (_, row) in enumerate(src_sod_df.iterrows()):
        if idx % report_step == 0 and total:
            cb(pct_lo + int(idx / total * (pct_hi - pct_lo)),
               f"SoD: processing control {idx + 1:,}/{total:,}…")

        src_ctrl = str(row[src_ctrl_col]) if pd.notna(row[src_ctrl_col]) else ""
        lhs_ent  = str(row[src_lhs_col]) if pd.notna(row[src_lhs_col]) else ""
        rhs_ent  = str(row[src_rhs_col]) if pd.notna(row[src_rhs_col]) else ""

        unmatched = {
            cols["src_ctrl"]:   src_ctrl,
            cols["tgt_ctrl"]:   "—",
            "Confidence Score": "0%",
            "Match Type":       "Unmatched",
            "Missing Privileges": "",
        }

        tgt_lhs_ent = ent_mapping.get(lhs_ent, "—")
        tgt_rhs_ent = ent_mapping.get(rhs_ent, "—")

        # Gate: both entitlements must have resolved to a real target entitlement
        # (the engine already enforced the confidence threshold). Applies to Derived
        # controls too — a derived pair still needs both entitlements mapped.
        if not _is_mapped(tgt_lhs_ent) or not _is_mapped(tgt_rhs_ent):
            results.append(unmatched)
            continue

        ctrl_conf = round(min(ent_confidence.get(lhs_ent, 0.0),
                              ent_confidence.get(rhs_ent, 0.0)))
        missing = _missing_privs_text(
            src_priv_groups.get(lhs_ent, set()) | src_priv_groups.get(rhs_ent, set()),
            [tgt_lhs_ent, tgt_rhs_ent], tgt_priv_groups,
        )

        # Direct if a real target control pairs the two matched EY entitlements;
        # otherwise an inferred Derived Control.
        existing_ctrl = tgt_pair_to_ctrl.get(frozenset((tgt_lhs_ent, tgt_rhs_ent)))
        if existing_ctrl is not None:
            results.append({
                cols["src_ctrl"]:   src_ctrl,
                cols["tgt_ctrl"]:   existing_ctrl,
                "Confidence Score": f"{ctrl_conf}%",
                "Match Type":       "Direct",
                "Missing Privileges": missing,
            })
        else:
            results.append({
                cols["src_ctrl"]:   src_ctrl,
                cols["tgt_ctrl"]:   f"[{tgt_lhs_ent}] AND [{tgt_rhs_ent}]",
                "Confidence Score": f"{ctrl_conf}%",
                "Match Type":       "Derived Control",
                "Missing Privileges": missing,
            })

    out_cols = [cols["src_ctrl"], cols["tgt_ctrl"], "Confidence Score",
                "Match Type", "Missing Privileges"]
    return pd.DataFrame(results, columns=out_cols)


def _map_sa_controls(
    src_sa_df: pd.DataFrame,
    tgt_sa_df: pd.DataFrame,
    src_priv_groups: dict[str, set[str]],
    tgt_priv_groups: dict[str, set[str]],
    ent_mapping: dict[str, str],
    ent_confidence: dict[str, float],
    cols: dict[str, str],
    cb: Callable,
    pct_lo: int,
    pct_hi: int,
) -> pd.DataFrame:
    """Map each source SA control to the best target SA control.

    SA controls are NEVER labelled "Derived" (Enhancement 5). An SA control is a
    Direct match only when its entitlement resolved to a real target match (engine
    applied MATCH_THRESHOLD) that is itself an actual target SA control; otherwise
    it is Unmatched.
    """
    cb(pct_lo, "SA: building target control lookup…")

    tgt_ctrl_col = _find_col_pd(tgt_sa_df, "Control Name")
    tgt_ent_col  = _find_col_pd(tgt_sa_df, "Entitlement")

    # {target_entitlement → first target SA control name}
    tgt_ent_to_ctrl: dict[str, str] = {}
    for _, row in tgt_sa_df.iterrows():
        ent  = row[tgt_ent_col]
        ctrl = row[tgt_ctrl_col]
        if pd.notna(ent) and pd.notna(ctrl):
            ent = str(ent)
            if ent not in tgt_ent_to_ctrl:
                tgt_ent_to_ctrl[ent] = str(ctrl)

    src_ctrl_col = _find_col_pd(src_sa_df, "Control Name")
    src_ent_col  = _find_col_pd(src_sa_df, "Entitlement")

    total = len(src_sa_df)
    report_step = max(1, total // 20)
    results: list[dict] = []

    for idx, (_, row) in enumerate(src_sa_df.iterrows()):
        if idx % report_step == 0 and total:
            cb(pct_lo + int(idx / total * (pct_hi - pct_lo)),
               f"SA: processing control {idx + 1:,}/{total:,}…")

        src_ctrl = str(row[src_ctrl_col]) if pd.notna(row[src_ctrl_col]) else ""
        src_ent  = str(row[src_ent_col]) if pd.notna(row[src_ent_col]) else ""

        tgt_ent = ent_mapping.get(src_ent, "—")

        unmatched = {
            cols["src_ctrl"]:   src_ctrl,
            cols["tgt_ctrl"]:   "—",
            "Confidence Score": "0%",
            "Match Type":       "Unmatched",
            "Missing Privileges": "",
        }

        # Must map to a real target entitlement (engine already applied the
        # confidence threshold) that is itself a target SA control.
        if not _is_mapped(tgt_ent) or tgt_ent not in tgt_ent_to_ctrl:
            results.append(unmatched)
            continue

        src_privs = src_priv_groups.get(src_ent, set())
        results.append({
            cols["src_ctrl"]:   src_ctrl,
            cols["tgt_ctrl"]:   tgt_ent_to_ctrl[tgt_ent],
            "Confidence Score": f"{round(ent_confidence.get(src_ent, 0.0))}%",
            "Match Type":       "Direct",
            "Missing Privileges": _missing_privs_text(src_privs, [tgt_ent], tgt_priv_groups),
        })

    out_cols = [cols["src_ctrl"], cols["tgt_ctrl"], "Confidence Score",
                "Match Type", "Missing Privileges"]
    return pd.DataFrame(results, columns=out_cols)


def _build_missing_controls(
    sod_df: pd.DataFrame,
    sa_df: pd.DataFrame,
    cols: dict[str, str],
) -> pd.DataFrame:
    """List every source control (SoD + SA) with no Direct/Derived match in the
    target ruleset (Enhancement 2). Works for both SoD and SA controls.
    """
    rows: list[dict] = []
    for kind, df in [("SoD", sod_df), ("SA", sa_df)]:
        if df.empty:
            continue
        unmatched = df[df["Match Type"] == "Unmatched"]
        for _, r in unmatched.iterrows():
            rows.append({
                "Control Name": r[cols["src_ctrl"]],
                "Control Type": kind,
            })
    return pd.DataFrame(rows, columns=["Control Name", "Control Type"])


def _build_missing_privileges(
    ent_mapping: dict[str, str],
    src_priv_groups: dict[str, set[str]],
    tgt_priv_groups: dict[str, set[str]],
    label_src: str,
    label_tgt: str,
) -> pd.DataFrame:
    """Per-entitlement privilege gaps, one privilege per row.

    For each source entitlement that resolved to a real target match (the engine
    already applied the confidence threshold), list every target privilege the
    source entitlement lacks (tgt_privs - src_privs) as its own row. Entitlements
    with no missing privileges are omitted.

    Columns (direction-aware): "{src} Entitlement", "Best Matched {tgt} Entitlement",
    "Missing Privilege".
    """
    src_col = f"{label_src} Entitlement"
    tgt_col = f"Best Matched {label_tgt} Entitlement"
    cols_out = [src_col, tgt_col, "Missing Privilege"]

    rows: list[dict] = []
    for src_ent, tgt_ent in ent_mapping.items():
        if not _is_mapped(tgt_ent):
            continue
        missing = sorted(
            tgt_priv_groups.get(tgt_ent, set()) - src_priv_groups.get(src_ent, set())
        )
        for priv in missing:
            rows.append({src_col: src_ent, tgt_col: tgt_ent, "Missing Privilege": priv})

    return pd.DataFrame(rows, columns=cols_out)


def _map_direction(
    src_sod_df: pd.DataFrame,
    src_sa_df:  pd.DataFrame,
    src_e2p_df: pd.DataFrame,
    tgt_sod_df: pd.DataFrame,
    tgt_sa_df:  pd.DataFrame,
    tgt_e2p_df: pd.DataFrame,
    label_src:  str,
    label_tgt:  str,
    cb: Callable,
    pct_lo: int,
    pct_hi: int,
) -> dict:
    """Run the full mapping pipeline for ONE direction (source → target).

    Returns {sod_df, sa_df, ent_df, missing_ctrl_df, missing_priv_df, counts}.
    Column headers are direction-aware: the source control column is named
    "{label_src} Control Name" and the matched column "{label_tgt} Control Name".
    """
    span = pct_hi - pct_lo

    # ── Entitlement mapping (source → target) ───────────────────────────────────
    cb(pct_lo, f"{label_src}→{label_tgt}: running entitlement mapping…")
    ent_result = run_mapping(
        src_e2p_df, tgt_e2p_df,
        progress_callback=_scale_cb(cb, pct_lo, pct_lo + int(span * 0.30)),
    )
    if not ent_result.success:
        raise RuntimeError("Entitlement mapping failed: " + "; ".join(ent_result.errors))
    ent_df: pd.DataFrame = ent_result.data

    # Rename the generic Client/EY entitlement headers to the active direction.
    ent_df = ent_df.rename(columns={
        "Client Entitlement":   f"{label_src} Entitlement",
        "EY Entitlement Match": f"{label_tgt} Entitlement Match",
    })

    # Privilege lookup dicts from raw E2P DataFrames.
    src_priv_groups = _build_priv_groups(
        src_e2p_df, _find_col_pd(src_e2p_df, "Entitlement Name"),
        _find_col_pd(src_e2p_df, "Privilege Code"),
    )
    tgt_priv_groups = _build_priv_groups(
        tgt_e2p_df, _find_col_pd(tgt_e2p_df, "Entitlement Name"),
        _find_col_pd(tgt_e2p_df, "Privilege Code"),
    )

    # {source_entitlement → best target_entitlement or "—"} from the renamed df.
    ent_mapping: dict[str, str] = {
        str(r[f"{label_src} Entitlement"]): str(r[f"{label_tgt} Entitlement Match"])
        for _, r in ent_df.iterrows()
    }
    # {source_entitlement → blended confidence score (0-100)} — drives control
    # matching: used only to display the control's Confidence Score (the mapped/
    # not-mapped decision is the entitlement engine's, read from the match column).
    ent_confidence: dict[str, float] = {
        str(r[f"{label_src} Entitlement"]):
            float(str(r["Confidence Score (%)"]).rstrip("%") or 0)
        for _, r in ent_df.iterrows()
    }

    cols = {
        "src_ctrl": f"{label_src} Control Name",
        "tgt_ctrl": f"{label_tgt} Control Name",
    }

    sod_lo = pct_lo + int(span * 0.30)
    sod_hi = pct_lo + int(span * 0.65)
    sa_hi  = pct_lo + int(span * 0.90)

    sod_df = _map_sod_controls(
        src_sod_df, tgt_sod_df, src_priv_groups, tgt_priv_groups,
        ent_mapping, ent_confidence, cols, cb, sod_lo, sod_hi,
    )
    sa_df = _map_sa_controls(
        src_sa_df, tgt_sa_df, src_priv_groups, tgt_priv_groups,
        ent_mapping, ent_confidence, cols, cb, sod_hi, sa_hi,
    )

    missing_ctrl_df = _build_missing_controls(sod_df, sa_df, cols)
    missing_priv_df = _build_missing_privileges(
        ent_mapping, src_priv_groups, tgt_priv_groups,
        label_src, label_tgt,
    )

    def _count(df: pd.DataFrame, mt: str) -> int:
        if df.empty or "Match Type" not in df.columns:
            return 0
        return int((df["Match Type"] == mt).sum())

    counts = {
        "sod_total":     len(sod_df),
        "sod_direct":    _count(sod_df, "Direct"),
        "sod_derived":   _count(sod_df, "Derived Control"),
        "sod_unmatched": _count(sod_df, "Unmatched"),
        "sa_total":      len(sa_df),
        "sa_direct":     _count(sa_df, "Direct"),
        "sa_derived":    0,  # SA is never Derived (Enhancement 5)
        "sa_unmatched":  _count(sa_df, "Unmatched"),
        "ent_total":     len(ent_df),
        "missing_ctrl_total": len(missing_ctrl_df),
        "missing_priv_total": len(missing_priv_df),
    }

    return {
        "sod_df":          sod_df,
        "sa_df":           sa_df,
        "ent_df":          ent_df,
        "missing_ctrl_df": missing_ctrl_df,
        "missing_priv_df": missing_priv_df,
        "counts":          counts,
    }


def _write_sheet(writer, df: pd.DataFrame, sheet_name: str, hdr_fmt) -> None:
    """Write one DataFrame to a sheet with the styled header + auto-sized columns."""
    df.to_excel(writer, sheet_name=sheet_name, index=False)
    ws = writer.sheets[sheet_name]
    for ci, col in enumerate(df.columns):
        ws.write(0, ci, col, hdr_fmt)
        max_len = df[col].astype(str).map(len).max() if len(df) else 0
        ws.set_column(ci, ci, min(max(len(str(col)), max_len) + 3, 60))


def _build_excel(c2e: dict, e2c: dict) -> io.BytesIO:
    """Build the single bidirectional workbook (8 mapping/report sheets + the two
    entitlement-mapping sheets) and return it as BytesIO.
    """
    buf = io.BytesIO()
    # strings_to_formulas=False / strings_to_urls=False: values beginning with '='
    # (or URLs) are written as text, never live formulas (formula-injection guard).
    with pd.ExcelWriter(
        buf,
        engine="xlsxwriter",
        engine_kwargs={"options": {"strings_to_formulas": False, "strings_to_urls": False}},
    ) as writer:
        wb = writer.book
        hdr_fmt = wb.add_format({"bold": True, "bg_color": "#D7E4BC", "border": 1})

        # Excel sheet names are capped at 31 chars — keep every name within the limit.
        sheets = [
            (c2e["sod_df"],          "SoD Mapping (Client to EY)"),
            (c2e["sa_df"],           "SA Mapping (Client to EY)"),
            (c2e["missing_ctrl_df"], "Client Controls Missing in EY"),
            (c2e["missing_priv_df"], "Missing Privileges (C to EY)"),
            (e2c["sod_df"],          "SoD Mapping (EY to Client)"),
            (e2c["sa_df"],           "SA Mapping (EY to Client)"),
            (e2c["missing_ctrl_df"], "EY Controls Missing in Client"),
            (e2c["missing_priv_df"], "Missing Privileges (EY to C)"),
            (c2e["ent_df"],          "Entitlement Mapping (C to EY)"),
            (e2c["ent_df"],          "Entitlement Mapping (EY to C)"),
        ]
        for df, name in sheets:
            _write_sheet(writer, df, name, hdr_fmt)

    buf.seek(0)
    return buf


def run_ruleset_mapping(
    client_sod_df: pd.DataFrame,
    client_sa_df:  pd.DataFrame,
    client_e2p_df: pd.DataFrame,
    ey_sod_df:     pd.DataFrame,
    ey_sa_df:      pd.DataFrame,
    ey_e2p_df:     pd.DataFrame,
    progress_callback: Callable[[int, str], None] | None = None,
) -> EngineResult:
    """Full bidirectional ruleset mapping pipeline.

    Returns EngineResult whose .data is a dict:
        {
            "c2e":          {sod_df, sa_df, ent_df, missing_ctrl_df, missing_priv_df, counts},
            "e2c":          {...},
            "excel_buffer": io.BytesIO,
            "summary":      dict,
        }
    """
    def _cb(pct: int, msg: str) -> None:
        if progress_callback:
            progress_callback(pct, msg)

    try:
        # Direction 1 — Client → EY  (1%→48%)
        c2e = _map_direction(
            client_sod_df, client_sa_df, client_e2p_df,
            ey_sod_df, ey_sa_df, ey_e2p_df,
            "Client", "EY", _cb, 1, 48,
        )
        # Direction 2 — EY → Client  (48%→92%)
        e2c = _map_direction(
            ey_sod_df, ey_sa_df, ey_e2p_df,
            client_sod_df, client_sa_df, client_e2p_df,
            "EY", "Client", _cb, 48, 92,
        )

        _cb(93, "Building summary…")
        # Flat keys mirror the Client→EY direction so the existing StatCards keep
        # working; per-direction blocks expose both directions to the frontend.
        summary = {
            **c2e["counts"],
            "c2e": c2e["counts"],
            "e2c": e2c["counts"],
        }

        _cb(95, "Generating Excel report…")
        excel_buf = _build_excel(c2e, e2c)

        _cb(99, "Complete.")
        return EngineResult(
            success=True,
            data={
                "c2e":          c2e,
                "e2c":          e2c,
                "excel_buffer": excel_buf,
                "summary":      summary,
            },
        )

    except Exception as exc:
        return EngineResult(success=False, errors=[str(exc)])
