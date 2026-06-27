"""Ruleset Mapping Engine (Tool 5).

Maps SoD and SA ruleset controls between a Client ruleset and the EY ruleset in
BOTH directions (Client→EY and EY→Client), using:
  Step 1 — Entitlement-to-entitlement mapping (delegates to existing engine)
  Step 2 — SoD control matching via per-leg Jaccard similarity on privilege-code sets
  Step 3 — SA control matching via entitlement mapping result

The core mapping is a pure function of (source, target). `run_ruleset_mapping`
calls it twice — once per direction — so "missing controls", "missing privileges"
and the recommendations are recomputed relative to whichever ruleset is the source.

Pure Python/Pandas — no FastAPI, no Pydantic, no HTTP.
"""

import io
from typing import Callable

import pandas as pd

from engines.entitlement_mapping_engine import run_mapping, EngineResult

# Per-leg similarity threshold. A SoD/SA control matches only if every required
# leg independently meets this Jaccard score — a strong match on one leg must NOT
# compensate for an unrelated second leg (Enhancement 4).
LEG_THRESHOLD = 0.60


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


def _jaccard(a: set, b: set) -> float:
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


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
    cols: dict[str, str],
    cb: Callable,
    pct_lo: int,
    pct_hi: int,
) -> pd.DataFrame:
    """Map each source SoD control to the best target SoD control.

    Two-leg matching (Enhancement 4): each control has two legs (LHS/RHS). For a
    candidate target control, both legs are scored INDEPENDENTLY by per-entitlement
    Jaccard, trying both LHS/RHS pairings; the control's score against that target
    is the weaker (min) of the chosen pairing's two legs. A target qualifies as a
    Direct match only if BOTH chosen legs clear LEG_THRESHOLD — so a strong match
    on one leg can never carry an unrelated second leg.

    Derived Control (Enhancement 5): only an inferred SoD pair. When no target SoD
    control qualifies but both source legs map to target entitlements, the inferred
    control "[T_LHS] AND [T_RHS]" is created and labelled "Derived Control".
    """
    cb(pct_lo, "SoD: building target control privilege index…")

    tgt_ctrl_col = _find_col_pd(tgt_sod_df, "Control Name")
    tgt_lhs_col  = _find_col_pd(tgt_sod_df, "LHS Entitlement")
    tgt_rhs_col  = _find_col_pd(tgt_sod_df, "RHS Entitlement")

    # Pre-build target control → (lhs_ent, rhs_ent) keeping legs SEPARATE so we can
    # score each leg independently (the old engine unioned them, masking one leg).
    tgt_controls: list[tuple[str, str, str]] = []
    for _, row in tgt_sod_df.iterrows():
        ctrl = row[tgt_ctrl_col]
        if pd.isna(ctrl):
            continue
        lhs = str(row[tgt_lhs_col]) if pd.notna(row[tgt_lhs_col]) else ""
        rhs = str(row[tgt_rhs_col]) if pd.notna(row[tgt_rhs_col]) else ""
        tgt_controls.append((str(ctrl), lhs, rhs))

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

        pL = src_priv_groups.get(lhs_ent, set())
        pR = src_priv_groups.get(rhs_ent, set())

        # Both legs must have resolvable privileges to be matchable.
        if not pL or not pR:
            results.append({
                cols["src_ctrl"]:   src_ctrl,
                cols["tgt_ctrl"]:   "—",
                "Confidence Score": "0%",
                "Match Type":       "Unmatched",
                "Missing Privileges": "",
            })
            continue

        best_ctrl   = None
        best_min    = -1.0
        best_union  = float("inf")
        best_pair   = None   # (tgt_ent_for_lhs, tgt_ent_for_rhs)

        for tgt_ctrl, eL, eR in tgt_controls:
            qL = tgt_priv_groups.get(eL, set())
            qR = tgt_priv_groups.get(eR, set())

            # Try both leg pairings; each pairing is limited by its weaker leg.
            straight = (min(_jaccard(pL, qL), _jaccard(pR, qR)), eL, eR)
            swapped  = (min(_jaccard(pL, qR), _jaccard(pR, qL)), eR, eL)
            min_leg, ent_for_lhs, ent_for_rhs = max(straight, swapped, key=lambda x: x[0])

            # Both legs of the chosen pairing must clear the threshold.
            if min_leg < LEG_THRESHOLD:
                continue

            union_size = len((pL | pR) | (qL | qR))
            if min_leg > best_min or (min_leg == best_min and union_size < best_union):
                best_min   = min_leg
                best_ctrl  = tgt_ctrl
                best_union = union_size
                best_pair  = (ent_for_lhs, ent_for_rhs)

        if best_ctrl is not None:
            missing = _missing_privs_text(
                pL | pR, list(best_pair), tgt_priv_groups,
            )
            results.append({
                cols["src_ctrl"]:   src_ctrl,
                cols["tgt_ctrl"]:   best_ctrl,
                "Confidence Score": f"{round(best_min * 100)}%",
                "Match Type":       "Direct",
                "Missing Privileges": missing,
            })
            continue

        # Derived path — inferred SoD pair (no score gate).
        tgt_lhs_ent = ent_mapping.get(lhs_ent, "—")
        tgt_rhs_ent = ent_mapping.get(rhs_ent, "—")

        if tgt_lhs_ent != "—" and tgt_rhs_ent != "—":
            derived_name = f"[{tgt_lhs_ent}] AND [{tgt_rhs_ent}]"
            E_derived = (
                tgt_priv_groups.get(tgt_lhs_ent, set()) |
                tgt_priv_groups.get(tgt_rhs_ent, set())
            )
            missing = _missing_privs_text(
                pL | pR, [tgt_lhs_ent, tgt_rhs_ent], tgt_priv_groups,
            )
            results.append({
                cols["src_ctrl"]:   src_ctrl,
                cols["tgt_ctrl"]:   derived_name,
                "Confidence Score": f"{round(_jaccard(pL | pR, E_derived) * 100)}%",
                "Match Type":       "Derived Control",
                "Missing Privileges": missing,
            })
        else:
            results.append({
                cols["src_ctrl"]:   src_ctrl,
                cols["tgt_ctrl"]:   "—",
                "Confidence Score": "0%",
                "Match Type":       "Unmatched",
                "Missing Privileges": "",
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
    cols: dict[str, str],
    cb: Callable,
    pct_lo: int,
    pct_hi: int,
) -> pd.DataFrame:
    """Map each source SA control to the best target SA control.

    SA controls are NEVER labelled "Derived" (Enhancement 5). An SA control is a
    Direct match only when its entitlement maps to a target entitlement that is an
    actual target SA control AND the per-entitlement Jaccard clears LEG_THRESHOLD;
    otherwise it is Unmatched.
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

        # Must map to a target entitlement that is itself a target SA control.
        if tgt_ent == "—" or tgt_ent not in tgt_ent_to_ctrl:
            results.append(unmatched)
            continue

        src_privs = src_priv_groups.get(src_ent, set())
        tgt_privs = tgt_priv_groups.get(tgt_ent, set())
        score = _jaccard(src_privs, tgt_privs)

        if score < LEG_THRESHOLD:
            results.append(unmatched)
            continue

        results.append({
            cols["src_ctrl"]:   src_ctrl,
            cols["tgt_ctrl"]:   tgt_ent_to_ctrl[tgt_ent],
            "Confidence Score": f"{round(score * 100)}%",
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


def _build_missing_privileges(sod_df: pd.DataFrame, sa_df: pd.DataFrame, cols: dict[str, str]) -> pd.DataFrame:
    """Flatten the per-row Missing Privileges recommendations of matched controls
    into a dedicated sheet (Enhancement 3): source control, matched target control,
    and the privileges to add.
    """
    rows: list[dict] = []
    for kind, df in [("SoD", sod_df), ("SA", sa_df)]:
        if df.empty:
            continue
        matched = df[df["Match Type"].isin(["Direct", "Derived Control"])]
        for _, r in matched.iterrows():
            missing = str(r.get("Missing Privileges", "") or "")
            if missing.strip():
                rows.append({
                    "Source Control":      r[cols["src_ctrl"]],
                    "Matched Control":     r[cols["tgt_ctrl"]],
                    "Control Type":        kind,
                    "Missing Privileges":  missing,
                })
    return pd.DataFrame(
        rows, columns=["Source Control", "Matched Control", "Control Type", "Missing Privileges"]
    )


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

    cols = {
        "src_ctrl": f"{label_src} Control Name",
        "tgt_ctrl": f"{label_tgt} Control Name",
    }

    sod_lo = pct_lo + int(span * 0.30)
    sod_hi = pct_lo + int(span * 0.65)
    sa_hi  = pct_lo + int(span * 0.90)

    sod_df = _map_sod_controls(
        src_sod_df, tgt_sod_df, src_priv_groups, tgt_priv_groups,
        ent_mapping, cols, cb, sod_lo, sod_hi,
    )
    sa_df = _map_sa_controls(
        src_sa_df, tgt_sa_df, src_priv_groups, tgt_priv_groups,
        ent_mapping, cols, cb, sod_hi, sa_hi,
    )

    missing_ctrl_df = _build_missing_controls(sod_df, sa_df, cols)
    missing_priv_df = _build_missing_privileges(sod_df, sa_df, cols)

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
            (c2e["missing_ctrl_df"], "Missing Controls in Client"),
            (c2e["missing_priv_df"], "Missing Privileges (C to EY)"),
            (e2c["sod_df"],          "SoD Mapping (EY to Client)"),
            (e2c["sa_df"],           "SA Mapping (EY to Client)"),
            (e2c["missing_ctrl_df"], "Missing Controls in EY"),
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
