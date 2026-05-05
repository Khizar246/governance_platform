"""Entitlement Mapping Engine — ported from Entitlement Analysis/app.py.

Algorithm: map each client entitlement to the best-matching EY entitlement using:
  1. Privilege overlap count (primary sort)
  2. Jaccard similarity (secondary — penalises bloated EY entitlements)

Pure Python/Pandas — no FastAPI, no Pydantic, no HTTP.
"""

from dataclasses import dataclass, field
from typing import Any, Callable

import pandas as pd


COLUMN_DESCRIPTIONS: dict[str, str] = {
    "Client Entitlement": (
        "The entitlement name as defined in the client's access control system."
    ),
    "EY Entitlement Match": (
        "The best-matching EY standard entitlement, selected by overlap count then "
        "Jaccard similarity. '—' means no EY entitlement shares any privilege with "
        "this client entitlement."
    ),
    "Privilege Match Count": (
        "Number of client privileges found in the matched EY entitlement, expressed "
        "as matched/total (e.g. '3/5' means 3 of the client's 5 privileges were found "
        "in the EY entitlement)."
    ),
    "Jaccard Similarity (%)": (
        "Overlap ÷ union of the two privilege sets. High Jaccard means the EY "
        "entitlement closely mirrors the client's scope. Low Jaccard means the EY "
        "entitlement contains many privileges beyond what the client holds."
    ),
    "Match Confidence": (
        "Tier based on the percentage of client privileges covered by the match. "
        "High = 75%+, Medium = 40–74%, Low = <40%, None = 0% overlap."
    ),
    "Runner-Up EY Entitlements": (
        "The 2nd and 3rd best EY entitlement candidates, with their match counts and "
        "Jaccard scores. Useful when the best match is imperfect — a runner-up may "
        "cover privileges the best match misses."
    ),
}


@dataclass
class EngineResult:
    """Structured return type for all engine functions."""
    success: bool
    data: Any = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _find_col(df: pd.DataFrame, target: str) -> str:
    """Case-insensitive column name lookup. Returns the actual column name."""
    t = target.strip().upper()
    for col in df.columns:
        if col.strip().upper() == t:
            return col
    raise KeyError(
        f"Required column '{target}' not found. "
        f"Available columns: {list(df.columns)}"
    )


def run_mapping(
    client_df: pd.DataFrame,
    ey_df: pd.DataFrame,
    progress_callback: Callable[[int, str], None] | None = None,
) -> EngineResult:
    """Full entitlement mapping pipeline.

    Args:
        client_df: Pandas DataFrame with columns [Entitlement Name, Privilege Code]
        ey_df:     Pandas DataFrame with the same two columns for the EY ruleset
        progress_callback: Called at key milestones with (percent: int, message: str)

    Returns:
        EngineResult whose .data is a pd.DataFrame of per-entitlement mapping rows.
    """
    def _cb(pct: int, msg: str) -> None:
        if progress_callback:
            progress_callback(pct, msg)

    try:
        _cb(5, f"Indexing {len(client_df):,} client rows and {len(ey_df):,} EY rows…")

        # Locate columns case-insensitively
        c_ent_col  = _find_col(client_df, "Entitlement Name")
        c_priv_col = _find_col(client_df, "Privilege Code")
        e_ent_col  = _find_col(ey_df, "Entitlement Name")
        e_priv_col = _find_col(ey_df, "Privilege Code")

        # Group privileges per entitlement — groupby+set auto-deduplicates
        client_groups: dict[str, set] = (
            client_df.groupby(c_ent_col)[c_priv_col].apply(set).to_dict()
        )
        ey_groups: dict[str, set] = (
            ey_df.groupby(e_ent_col)[e_priv_col].apply(set).to_dict()
        )
        all_ey_privs: set = set(ey_df[e_priv_col])

        total = len(client_groups)
        _cb(10, f"Scoring {total:,} client entitlements against {len(ey_groups):,} EY entitlements…")

        mapping_results: list[dict] = []
        report_step = max(1, total // 20)  # report every ~5%

        for idx, (c_ent, c_privs) in enumerate(client_groups.items()):

            if idx % report_step == 0:
                pct = 10 + int(idx / total * 70) if total else 10
                _cb(pct, f"Processing entitlement {idx + 1:,}/{total:,}…")

            # ── Zero-overlap shortcut ─────────────────────────────────────────
            if not c_privs & all_ey_privs:
                mapping_results.append({
                    "Client Entitlement":        c_ent,
                    "EY Entitlement Match":      "—",
                    "Privilege Match Count":     f"0/{len(c_privs)}",
                    "Jaccard Similarity (%)":    "0%",
                    "Match Confidence":          "None",
                    "Runner-Up EY Entitlements": "",
                })
                continue

            # ── Score every EY entitlement ────────────────────────────────────
            # Sort: overlap count DESC → Jaccard DESC
            scored: list[tuple] = []
            for e_ent, e_privs in ey_groups.items():
                matched = c_privs & e_privs
                if not matched:
                    continue
                overlap_count = len(matched)
                union_size    = len(c_privs | e_privs)
                jaccard       = overlap_count / union_size if union_size else 0
                scored.append((e_ent, matched, overlap_count, jaccard))

            scored.sort(key=lambda x: (x[2], x[3]), reverse=True)

            best_ent, matched_privs, _, best_jaccard = scored[0]

            # Runner-ups (2nd & 3rd)
            runners = [
                f"{s[0]} ({s[2]}/{len(c_privs)}, J:{round(s[3] * 100)}%)"
                for s in scored[1:3]
            ]

            matched_count = len(matched_privs)
            overlap_pct   = round(matched_count / len(c_privs) * 100)
            jaccard_pct   = round(best_jaccard * 100)

            # ── Match confidence tier (based on privilege coverage %) ─────────
            if overlap_pct >= 75:
                confidence = "High"
            elif overlap_pct >= 40:
                confidence = "Medium"
            else:
                confidence = "Low"

            mapping_results.append({
                "Client Entitlement":        c_ent,
                "EY Entitlement Match":      best_ent,
                "Privilege Match Count":     f"{matched_count}/{len(c_privs)}",
                "Jaccard Similarity (%)":    f"{jaccard_pct}%",
                "Match Confidence":          confidence,
                "Runner-Up EY Entitlements": " | ".join(runners) if runners else "",
            })

        _cb(85, "Building results DataFrame…")
        result_df = pd.DataFrame(mapping_results)

        _cb(95, "Analysis complete.")
        return EngineResult(success=True, data=result_df)

    except Exception as exc:
        return EngineResult(success=False, errors=[str(exc)])
