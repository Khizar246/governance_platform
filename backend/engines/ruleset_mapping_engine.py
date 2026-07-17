"""Ruleset Mapping Engine.

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
import logging
from typing import Callable

import pandas as pd

from engines.entitlement_mapping_engine import run_mapping
from engines.result import EngineResult

# stdlib-only module logger (engines stay framework-free); preserves the traceback
# when an exception is converted into EngineResult(success=False).
_log = logging.getLogger("governance.ruleset_mapping_engine")

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


# ── Plain-English readability text for the Excel report (Task 3) ──────────────────
# Sheet-level description: what the sheet shows, how to read it, key assumptions.
# Keyed by an exact sheet name. Kept in plain English (no formulas/jargon).
_SHEET_DESCRIPTIONS: dict[str, str] = {
    "SoD Mapping (Client to EY)": (
        "What this shows: each Segregation-of-Duties control in the CLIENT ruleset and the "
        "matching control in the EY standard ruleset. How to read it: a higher Confidence Score "
        "means a stronger match; 'Direct' means we found an existing EY control that pairs the same "
        "two access areas, 'Derived Control' means both areas matched but no single EY control pairs "
        "them (so we describe the pair), and 'Unmatched' means we could not confidently map it. "
        "'Missing Privileges' lists access the EY control expects that the client control does not grant."
    ),
    "SA Mapping (Client to EY)": (
        "What this shows: each Sensitive-Access control in the CLIENT ruleset and the matching EY "
        "standard control. How to read it: a higher Confidence Score means a stronger match; 'Direct' "
        "means it maps to an existing EY control and 'Unmatched' means it could not be confidently "
        "mapped. 'Missing Privileges' lists access the EY control expects that the client does not grant."
    ),
    "SoD Mapping (EY to Client)": (
        "What this shows: the reverse view — each EY standard Segregation-of-Duties control and the "
        "matching CLIENT control. Read it the same way as the Client-to-EY sheet; here the EY ruleset "
        "is the starting point, so 'Unmatched' means the client has no equivalent control."
    ),
    "SA Mapping (EY to Client)": (
        "What this shows: the reverse view — each EY standard Sensitive-Access control and the matching "
        "CLIENT control. 'Unmatched' means the client has no equivalent control."
    ),
    "Client Controls Missing in EY": (
        "What this shows: client controls (Segregation-of-Duties or Sensitive-Access) that have no "
        "confident match in the EY standard ruleset. These are candidates to review — either the EY "
        "standard does not cover them, or the underlying access did not line up well enough to map."
    ),
    "EY Controls Missing in Client": (
        "What this shows: EY standard controls that have no confident match in the client ruleset. "
        "These are gaps in the client's ruleset compared to the EY standard — controls the client may "
        "be missing."
    ),
    "Missing Privileges (C to EY)": (
        "What this shows: for every client entitlement that mapped to an EY entitlement, the individual "
        "EY privileges that the client entitlement does NOT include — one privilege per row. Use this to "
        "see exactly what access to add to bring a client entitlement in line with the EY standard."
    ),
    "Missing Privileges (EY to C)": (
        "What this shows: the reverse view — for every EY entitlement that mapped to a client entitlement, "
        "the individual client privileges the EY entitlement does not include, one per row."
    ),
    "Entitlement Mapping (C to EY)": (
        "What this shows: each CLIENT entitlement matched to its best-fitting EY standard entitlement. "
        "How to read it: the Confidence Score (%) combines how much the access overlaps, whether the two "
        "entitlements belong to the same Module, and how much of the client's access the EY entitlement "
        "covers. Match Confidence turns that score into a simple High / Medium / Low label; 'Not Mapped' "
        "means no EY entitlement was a close enough fit. Entitlements with the same Module are favoured "
        "when the access overlap is similar."
    ),
    "Entitlement Mapping (EY to C)": (
        "What this shows: the reverse view — each EY standard entitlement matched to its best-fitting "
        "client entitlement. Read the Confidence Score and Match Confidence the same way as the "
        "Client-to-EY sheet."
    ),
}

# Column-level one-line descriptors, matched by a token in the (direction-aware) header.
# Plain English; first matching token wins.
_COLUMN_DESCRIPTORS: list[tuple[str, str]] = [
    ("Confidence Score", "How strong the match is, as a percentage — higher is a better match."),
    ("Match Type", "Direct = matched an existing control; Derived Control = an inferred pair; Unmatched = no confident match."),
    ("Match Confidence", "Simple label from the score: High / Medium / Low, or Not Mapped if too weak."),
    ("Missing Privileges", "Access the matched target expects but the source does not grant, grouped by entitlement."),
    ("Missing Privilege", "A single piece of access the matched target has that the source is missing (one per row)."),
    ("Privilege Match Count", "How many of the source's access items were found in the matched entitlement (matched / total)."),
    ("Jaccard Similarity", "How much the two access sets overlap relative to their combined size."),
    ("Client Privilege Count", "Number of distinct access items in the source entitlement."),
    ("EY Privilege Count", "Number of distinct access items in the matched entitlement."),
    ("EY Privileges Missing in Client", "Access in the matched entitlement that the source entitlement lacks."),
    ("Client Privileges Missing in EY", "Access in the source entitlement absent from the matched entitlement."),
    ("Runner-Up", "The next-best alternative matches, with their counts and scores."),
    ("Control Type", "Whether the control is a Segregation-of-Duties (SoD) or Sensitive-Access (SA) control."),
    ("Entitlement Match", "The best-matching entitlement in the other ruleset, or 'Not Mapped'."),
    ("Control Name", "The control being mapped (source) or its best match (target)."),
    ("Entitlement", "An entitlement name — a named group of access privileges."),
]


def _column_descriptor(col: str) -> str:
    """Plain-English one-liner for a (possibly direction-aware) column header."""
    for token, text in _COLUMN_DESCRIPTORS:
        if token in col:
            return text
    return ""


def _write_sheet(writer, df: pd.DataFrame, sheet_name: str, hdr_fmt,
                 desc_fmt, col_desc_fmt) -> None:
    """Write one DataFrame to a sheet, prefixed by a plain-English sheet description
    row and a per-column descriptor row, then the styled header + data.

    Layout: row 0 = sheet description (merged), row 1 = column descriptors,
    row 2 = column headers, row 3+ = data.
    """
    n_cols = max(1, len(df.columns))
    # Data starts on row 3 (0-indexed); header lands on row 2.
    df.to_excel(writer, sheet_name=sheet_name, index=False, startrow=2)
    ws = writer.sheets[sheet_name]

    # Row 0 — sheet-level description, merged across all columns.
    sheet_desc = _SHEET_DESCRIPTIONS.get(sheet_name, "")
    if len(df.columns) > 1:
        ws.merge_range(0, 0, 0, n_cols - 1, sheet_desc, desc_fmt)
    else:
        ws.write(0, 0, sheet_desc, desc_fmt)
    ws.set_row(0, 60)

    # Row 1 — per-column descriptors; Row 2 — styled headers; size columns.
    for ci, col in enumerate(df.columns):
        ws.write(1, ci, _column_descriptor(col), col_desc_fmt)
        ws.write(2, ci, col, hdr_fmt)
        max_len = df[col].astype(str).map(len).max() if len(df) else 0
        ws.set_column(ci, ci, min(max(len(str(col)), max_len) + 3, 60))
    ws.set_row(1, 42)


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
        # Plain-English sheet description (row 0) and per-column descriptor (row 1).
        desc_fmt = wb.add_format({
            "italic": True, "text_wrap": True, "valign": "top",
            "bg_color": "#F2F7FB", "border": 1, "font_size": 10,
        })
        col_desc_fmt = wb.add_format({
            "italic": True, "text_wrap": True, "valign": "top",
            "bg_color": "#FBFBF0", "border": 1, "font_size": 9, "font_color": "#555555",
        })

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
            _write_sheet(writer, df, name, hdr_fmt, desc_fmt, col_desc_fmt)

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
        _log.error("run_ruleset_mapping failed", exc_info=True)
        return EngineResult(success=False, errors=[str(exc)])
