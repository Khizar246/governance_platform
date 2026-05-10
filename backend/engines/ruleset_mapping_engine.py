"""Ruleset Mapping Engine (Tool 5).

Maps client SoD and SA ruleset controls to EY controls using:
  Step 1 — Entitlement-to-entitlement mapping (delegates to existing engine)
  Step 2 — SoD control matching via Jaccard similarity on privilege-code sets
  Step 3 — SA control matching via entitlement mapping result

Pure Python/Pandas — no FastAPI, no Pydantic, no HTTP.
"""

import io
from typing import Callable

import pandas as pd

from engines.entitlement_mapping_engine import run_mapping, EngineResult


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


def _map_sod_controls(
    client_sod_df: pd.DataFrame,
    ey_sod_df: pd.DataFrame,
    client_priv_groups: dict[str, set[str]],
    ey_priv_groups: dict[str, set[str]],
    ent_mapping: dict[str, str],
    cb: Callable,
) -> pd.DataFrame:
    """Step 2: map each client SoD control to the best EY SoD control."""
    cb(30, "Step 2/3: Building EY SoD control privilege index…")

    # Pre-build EY control → privilege set (union LHS + RHS entitlement privs)
    ey_ctrl_col = _find_col_pd(ey_sod_df, "Control Name")
    ey_lhs_col  = _find_col_pd(ey_sod_df, "LHS Entitlement")
    ey_rhs_col  = _find_col_pd(ey_sod_df, "RHS Entitlement")

    ey_control_privs: dict[str, set[str]] = {}
    for _, row in ey_sod_df.iterrows():
        ctrl = row[ey_ctrl_col]
        if pd.isna(ctrl):
            continue
        ctrl = str(ctrl)
        ey_control_privs.setdefault(ctrl, set())
        lhs = row[ey_lhs_col]
        rhs = row[ey_rhs_col]
        if pd.notna(lhs):
            ey_control_privs[ctrl] |= ey_priv_groups.get(str(lhs), set())
        if pd.notna(rhs):
            ey_control_privs[ctrl] |= ey_priv_groups.get(str(rhs), set())

    c_ctrl_col = _find_col_pd(client_sod_df, "Control Name")
    c_lhs_col  = _find_col_pd(client_sod_df, "LHS Entitlement")
    c_rhs_col  = _find_col_pd(client_sod_df, "RHS Entitlement")

    total = len(client_sod_df)
    report_step = max(1, total // 20)
    results: list[dict] = []

    for idx, (_, row) in enumerate(client_sod_df.iterrows()):
        if idx % report_step == 0:
            pct = 32 + int(idx / total * 30) if total else 32
            cb(pct, f"SoD: processing control {idx + 1:,}/{total:,}…")

        client_ctrl = str(row[c_ctrl_col]) if pd.notna(row[c_ctrl_col]) else ""
        lhs_ent     = str(row[c_lhs_col]) if pd.notna(row[c_lhs_col]) else ""
        rhs_ent     = str(row[c_rhs_col]) if pd.notna(row[c_rhs_col]) else ""

        C = client_priv_groups.get(lhs_ent, set()) | client_priv_groups.get(rhs_ent, set())

        # Edge case 4: no resolvable privileges → Unmatched immediately
        if not C:
            results.append({
                "Client Control Name": client_ctrl,
                "EY Control Name":     "—",
                "Confidence Score":    "0%",
                "Match Type":          "Unmatched",
            })
            continue

        # Score every EY SoD control
        best_ey_ctrl    = None
        best_jaccard    = 0.0
        best_union_size = float("inf")

        for ey_ctrl, E in ey_control_privs.items():
            union_size = len(C | E)
            if union_size == 0:
                continue
            j = len(C & E) / union_size
            if j > best_jaccard or (j == best_jaccard and union_size < best_union_size):
                best_jaccard    = j
                best_ey_ctrl    = ey_ctrl
                best_union_size = union_size

        # Direct match
        if best_jaccard > 0:
            results.append({
                "Client Control Name": client_ctrl,
                "EY Control Name":     best_ey_ctrl,
                "Confidence Score":    f"{round(best_jaccard * 100)}%",
                "Match Type":          "Direct",
            })
            continue

        # Derived / Unmatched path
        ey_lhs_ent = ent_mapping.get(lhs_ent, "—")
        ey_rhs_ent = ent_mapping.get(rhs_ent, "—")

        if ey_lhs_ent != "—" and ey_rhs_ent != "—":
            derived_name = f"[{ey_lhs_ent}] AND [{ey_rhs_ent}]"
            E_derived = (
                ey_priv_groups.get(ey_lhs_ent, set()) |
                ey_priv_groups.get(ey_rhs_ent, set())
            )
            j_derived = _jaccard(C, E_derived)
            results.append({
                "Client Control Name": client_ctrl,
                "EY Control Name":     derived_name,
                "Confidence Score":    f"{round(j_derived * 100)}%",
                "Match Type":          "Derived",
            })
        else:
            results.append({
                "Client Control Name": client_ctrl,
                "EY Control Name":     "—",
                "Confidence Score":    "0%",
                "Match Type":          "Unmatched",
            })

    cols = ["Client Control Name", "EY Control Name", "Confidence Score", "Match Type"]
    return pd.DataFrame(results, columns=cols) if results else pd.DataFrame(columns=cols)


def _map_sa_controls(
    client_sa_df: pd.DataFrame,
    ey_sa_df: pd.DataFrame,
    client_priv_groups: dict[str, set[str]],
    ey_priv_groups: dict[str, set[str]],
    ent_mapping: dict[str, str],
    cb: Callable,
) -> pd.DataFrame:
    """Step 3: map each client SA control to the best EY SA control."""
    cb(65, "Step 3/3: Building EY SA control lookup…")

    # Pre-build {ey_entitlement → first EY SA control name}
    ey_sa_ctrl_col = _find_col_pd(ey_sa_df, "Control Name")
    ey_sa_ent_col  = _find_col_pd(ey_sa_df, "Entitlement")

    ey_ent_to_ctrl: dict[str, str] = {}
    for _, row in ey_sa_df.iterrows():
        ey_ent  = row[ey_sa_ent_col]
        ey_ctrl = row[ey_sa_ctrl_col]
        if pd.notna(ey_ent) and pd.notna(ey_ctrl):
            ey_ent = str(ey_ent)
            if ey_ent not in ey_ent_to_ctrl:
                ey_ent_to_ctrl[ey_ent] = str(ey_ctrl)

    c_ctrl_col = _find_col_pd(client_sa_df, "Control Name")
    c_ent_col  = _find_col_pd(client_sa_df, "Entitlement")

    total = len(client_sa_df)
    report_step = max(1, total // 20)
    results: list[dict] = []

    for idx, (_, row) in enumerate(client_sa_df.iterrows()):
        if idx % report_step == 0:
            pct = 67 + int(idx / total * 22) if total else 67
            cb(pct, f"SA: processing control {idx + 1:,}/{total:,}…")

        client_ctrl = str(row[c_ctrl_col]) if pd.notna(row[c_ctrl_col]) else ""
        client_ent  = str(row[c_ent_col]) if pd.notna(row[c_ent_col]) else ""

        ey_ent = ent_mapping.get(client_ent, "—")

        if ey_ent == "—":
            results.append({
                "Client Control Name": client_ctrl,
                "EY Control Name":     "—",
                "Confidence Score":    "0%",
                "Match Type":          "Unmatched",
            })
            continue

        C = client_priv_groups.get(client_ent, set())
        E = ey_priv_groups.get(ey_ent, set())
        confidence = round(_jaccard(C, E) * 100)

        if ey_ent in ey_ent_to_ctrl:
            ey_ctrl_name = ey_ent_to_ctrl[ey_ent]
            match_type   = "Direct"
        else:
            ey_ctrl_name = ey_ent
            match_type   = "Derived"

        results.append({
            "Client Control Name": client_ctrl,
            "EY Control Name":     ey_ctrl_name,
            "Confidence Score":    f"{confidence}%",
            "Match Type":          match_type,
        })

    cols = ["Client Control Name", "EY Control Name", "Confidence Score", "Match Type"]
    return pd.DataFrame(results, columns=cols) if results else pd.DataFrame(columns=cols)


def _build_excel(sod_df: pd.DataFrame, sa_df: pd.DataFrame, ent_df: pd.DataFrame) -> io.BytesIO:
    """Build a 3-tab Excel workbook and return as BytesIO."""
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="xlsxwriter") as writer:
        wb = writer.book
        hdr_fmt = wb.add_format({"bold": True, "bg_color": "#D7E4BC", "border": 1})

        for df, sheet_name in [
            (sod_df, "SoD Control Mapping"),
            (sa_df,  "SA Control Mapping"),
            (ent_df, "Entitlement Mapping"),
        ]:
            df.to_excel(writer, sheet_name=sheet_name, index=False)
            ws = writer.sheets[sheet_name]
            for ci, col in enumerate(df.columns):
                ws.write(0, ci, col, hdr_fmt)
                max_len = (
                    df[col].astype(str).map(len).max()
                    if len(df) else 0
                )
                ws.set_column(ci, ci, min(max(len(str(col)), max_len) + 3, 60))

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
    """Full ruleset mapping pipeline.

    Returns EngineResult whose .data is a dict:
        {
            "sod_df":       pd.DataFrame,
            "sa_df":        pd.DataFrame,
            "ent_df":       pd.DataFrame,
            "excel_buffer": io.BytesIO,
            "summary":      dict,
        }
    """
    def _cb(pct: int, msg: str) -> None:
        if progress_callback:
            progress_callback(pct, msg)

    try:
        # ── Step 1: Entitlement Mapping (0%→30%) ─────────────────────────────
        _cb(1, "Step 1/3: Running entitlement mapping…")
        ent_result = run_mapping(
            client_e2p_df,
            ey_e2p_df,
            progress_callback=_scale_cb(progress_callback, 1, 30),
        )
        if not ent_result.success:
            return EngineResult(
                success=False,
                errors=["Entitlement mapping failed: " + "; ".join(ent_result.errors)],
            )

        ent_df: pd.DataFrame = ent_result.data

        # Build privilege lookup dicts from raw E2P DataFrames
        c_e2p_ent_col  = _find_col_pd(client_e2p_df, "Entitlement Name")
        c_e2p_priv_col = _find_col_pd(client_e2p_df, "Privilege Code")
        e_e2p_ent_col  = _find_col_pd(ey_e2p_df, "Entitlement Name")
        e_e2p_priv_col = _find_col_pd(ey_e2p_df, "Privilege Code")

        client_priv_groups = _build_priv_groups(client_e2p_df, c_e2p_ent_col, c_e2p_priv_col)
        ey_priv_groups     = _build_priv_groups(ey_e2p_df, e_e2p_ent_col, e_e2p_priv_col)

        # Extract best-match mapping: {client_entitlement → ey_entitlement or "—"}
        ent_mapping: dict[str, str] = {}
        for _, r in ent_df.iterrows():
            ent_mapping[str(r["Client Entitlement"])] = str(r["EY Entitlement Match"])

        # ── Step 2: SoD Control Mapping (30%→65%) ────────────────────────────
        sod_df = _map_sod_controls(
            client_sod_df, ey_sod_df,
            client_priv_groups, ey_priv_groups, ent_mapping,
            _cb,
        )

        # ── Step 3: SA Control Mapping (65%→90%) ─────────────────────────────
        sa_df = _map_sa_controls(
            client_sa_df, ey_sa_df,
            client_priv_groups, ey_priv_groups, ent_mapping,
            _cb,
        )

        # ── Summary (90%→95%) ─────────────────────────────────────────────────
        _cb(90, "Building summary…")

        def _count(df: pd.DataFrame, match_type: str) -> int:
            if df.empty or "Match Type" not in df.columns:
                return 0
            return int((df["Match Type"] == match_type).sum())

        summary = {
            "sod_total":     len(sod_df),
            "sod_direct":    _count(sod_df, "Direct"),
            "sod_derived":   _count(sod_df, "Derived"),
            "sod_unmatched": _count(sod_df, "Unmatched"),
            "sa_total":      len(sa_df),
            "sa_direct":     _count(sa_df, "Direct"),
            "sa_derived":    _count(sa_df, "Derived"),
            "sa_unmatched":  _count(sa_df, "Unmatched"),
            "ent_total":     len(ent_df),
        }

        # ── Excel output (95%→100%) ───────────────────────────────────────────
        _cb(95, "Generating Excel report…")
        excel_buf = _build_excel(sod_df, sa_df, ent_df)

        _cb(99, "Complete.")
        return EngineResult(
            success=True,
            data={
                "sod_df":       sod_df,
                "sa_df":        sa_df,
                "ent_df":       ent_df,
                "excel_buffer": excel_buf,
                "summary":      summary,
            },
        )

    except Exception as exc:
        return EngineResult(success=False, errors=[str(exc)])
