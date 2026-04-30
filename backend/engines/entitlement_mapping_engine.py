"""Entitlement Mapping Engine — ported from Entitlement Analysis/app.py.

Algorithm: map each client entitlement to the best-matching EY entitlement using:
  1. Privilege overlap count (primary sort)
  2. Jaccard similarity (secondary — penalises bloated EY entitlements)
  3. Name similarity via rapidfuzz token_sort_ratio (tertiary tiebreak)
  4. Coverage combination check (can best + runner-up(s) achieve 100% coverage?)
  5. Reverse privilege index for precise "missing privilege found in" reporting

Pure Python/Pandas — no FastAPI, no Pydantic, no HTTP.
"""

from dataclasses import dataclass, field
from itertools import combinations
from typing import Any, Callable

import pandas as pd
from rapidfuzz import fuzz


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


def find_coverage_combination(
    c_privs: set,
    best_ent: str,
    ey_groups: dict,
    max_combo: int = 3,
) -> str:
    """Check whether best + 1–2 runner-up EY entitlements can fully cover client privileges.

    Returns a human-readable combination string, or empty string if not achievable.
    Ported verbatim from source Entitlement Analysis/app.py.
    """
    best_privs = ey_groups[best_ent]
    remaining = c_privs - best_privs
    if not remaining:
        return ""

    helpers = []
    for e_ent, e_privs in ey_groups.items():
        if e_ent == best_ent:
            continue
        overlap_with_remaining = remaining & e_privs
        if overlap_with_remaining:
            helpers.append((e_ent, overlap_with_remaining))

    if not helpers:
        return ""

    helpers.sort(key=lambda x: len(x[1]), reverse=True)

    # Single helper covers everything?
    for h_ent, h_covered in helpers:
        if h_covered >= remaining:
            return f"{best_ent} + {h_ent}"

    # Pair of helpers (cap search space at 10 to stay fast)
    if max_combo >= 3 and len(helpers) >= 2:
        for (h1_ent, h1_cov), (h2_ent, h2_cov) in combinations(helpers[:10], 2):
            if (h1_cov | h2_cov) >= remaining:
                return f"{best_ent} + {h1_ent} + {h2_ent}"

    return ""


def run_mapping(
    client_df: pd.DataFrame,
    ey_df: pd.DataFrame,
    progress_callback: Callable[[int, str], None] | None = None,
) -> EngineResult:
    """Full entitlement mapping pipeline.

    Args:
        client_df: Pandas DataFrame with columns [Access Entitlement Name, Access Point Code]
        ey_df:     Pandas DataFrame with the same two columns for the EY ruleset
        progress_callback: Called at key milestones with (percent: int, message: str)

    Returns:
        EngineResult whose .data is a pd.DataFrame of per-entitlement mapping rows.

    Ported from Entitlement Analysis/app.py with EngineResult wrapping and progress reporting.
    """
    def _cb(pct: int, msg: str) -> None:
        if progress_callback:
            progress_callback(pct, msg)

    try:
        _cb(5, f"Indexing {len(client_df):,} client rows and {len(ey_df):,} EY rows…")

        # Locate columns case-insensitively (file_io normalises values but not names)
        c_ent_col  = _find_col(client_df, "Access Entitlement Name")
        c_priv_col = _find_col(client_df, "Access Point Code")
        e_ent_col  = _find_col(ey_df, "Access Entitlement Name")
        e_priv_col = _find_col(ey_df, "Access Point Code")

        # Group privileges per entitlement — groupby+set auto-deduplicates
        client_groups: dict[str, set] = (
            client_df.groupby(c_ent_col)[c_priv_col].apply(set).to_dict()
        )
        ey_groups: dict[str, set] = (
            ey_df.groupby(e_ent_col)[e_priv_col].apply(set).to_dict()
        )
        all_ey_privs: set = set(ey_df[e_priv_col])

        # Reverse index: privilege → [EY entitlements that contain it]
        priv_to_ey: dict[str, list[str]] = {}
        for e_ent, e_privs in ey_groups.items():
            for p in e_privs:
                priv_to_ey.setdefault(p, []).append(e_ent)

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
                    "Client Entitlement":               c_ent,
                    "EY Entitlement Match":             "—",
                    "Privilege Match Count":            f"0/{len(c_privs)}",
                    "Privilege Overlap (%)":            "0%",
                    "Jaccard Similarity (%)":           "0%",
                    "Entitlement Name Similarity (%)":  "0%",
                    "Match Confidence":                 "None",
                    "Missing Privileges":               ", ".join(sorted(c_privs)),
                    "Missing Privileges Found In":      "",
                    "Extra Privileges in EY":           "",
                    "Coverage Combination":             "",
                    "Runner-Up EY Entitlements":        "",
                    "Comment":                          "No client privileges exist anywhere in the EY ruleset",
                })
                continue

            # ── Score every EY entitlement ────────────────────────────────────
            # Sort priority: overlap count DESC → Jaccard DESC → name similarity DESC
            scored: list[tuple] = []
            for e_ent, e_privs in ey_groups.items():
                matched = c_privs & e_privs
                if not matched:
                    continue
                overlap_count = len(matched)
                union_size    = len(c_privs | e_privs)
                jaccard       = overlap_count / union_size if union_size else 0
                name_sim      = fuzz.token_sort_ratio(c_ent, e_ent)
                scored.append((e_ent, matched, overlap_count, jaccard, name_sim))

            scored.sort(key=lambda x: (x[2], x[3], x[4]), reverse=True)

            best_ent, matched_privs, _, best_jaccard, best_name_sim = scored[0]

            # Runner-ups (2nd & 3rd)
            runners = [
                f"{s[0]} ({s[2]}/{len(c_privs)}, J:{round(s[3] * 100)}%)"
                for s in scored[1:3]
            ]

            # ── Derived metrics ───────────────────────────────────────────────
            matched_count = len(matched_privs)
            missing_privs = c_privs - matched_privs
            extra_privs   = ey_groups[best_ent] - c_privs
            overlap_pct   = round(matched_count / len(c_privs) * 100)
            jaccard_pct   = round(best_jaccard * 100)
            name_sim_pct  = round(best_name_sim)

            # ── Where do missing privileges live in EY? ───────────────────────
            missing_found_in: dict[str, list[str]] = {}
            missing_nowhere = 0
            for priv in sorted(missing_privs):
                hosts = [e for e in priv_to_ey.get(priv, []) if e != best_ent]
                if hosts:
                    for h in hosts:
                        missing_found_in.setdefault(h, []).append(priv)
                else:
                    missing_nowhere += 1

            missing_found_str = "; ".join(
                f"{ent} ({', '.join(privs)})"
                for ent, privs in missing_found_in.items()
            )

            # ── Coverage combination ──────────────────────────────────────────
            coverage_combo = ""
            if missing_privs:
                coverage_combo = find_coverage_combination(c_privs, best_ent, ey_groups)

            # ── Match confidence tier ─────────────────────────────────────────
            if overlap_pct >= 100:
                confidence = "High"
            elif overlap_pct >= 75:
                confidence = "High"
            elif overlap_pct >= 40:
                confidence = "Medium"
            else:
                confidence = "Low"

            # ── Comment ───────────────────────────────────────────────────────
            comment_parts: list[str] = []
            if matched_count == len(c_privs) and len(extra_privs) == 0:
                comment_parts.append("Exact match")
            elif matched_count == len(c_privs) and len(extra_privs) > 0:
                comment_parts.append("EY entitlement is a superset (covers all client privileges)")
            elif matched_count < len(c_privs):
                if missing_nowhere > 0:
                    comment_parts.append(
                        f"{missing_nowhere} client privilege(s) not present anywhere in EY ruleset"
                    )
                if missing_found_in:
                    total_found = sum(len(v) for v in missing_found_in.values())
                    comment_parts.append(
                        f"{total_found} missing privilege(s) found under other EY entitlements"
                    )
                if coverage_combo:
                    comment_parts.append(f"Full coverage possible via: {coverage_combo}")

            mapping_results.append({
                "Client Entitlement":               c_ent,
                "EY Entitlement Match":             best_ent,
                "Privilege Match Count":            f"{matched_count}/{len(c_privs)}",
                "Privilege Overlap (%)":            f"{overlap_pct}%",
                "Jaccard Similarity (%)":           f"{jaccard_pct}%",
                "Entitlement Name Similarity (%)":  f"{name_sim_pct}%",
                "Match Confidence":                 confidence,
                "Missing Privileges":               ", ".join(sorted(missing_privs)) if missing_privs else "",
                "Missing Privileges Found In":      missing_found_str,
                "Extra Privileges in EY":           ", ".join(sorted(extra_privs)) if extra_privs else "",
                "Coverage Combination":             coverage_combo,
                "Runner-Up EY Entitlements":        " | ".join(runners) if runners else "",
                "Comment":                          ". ".join(comment_parts),
            })

        _cb(85, "Building results DataFrame…")
        result_df = pd.DataFrame(mapping_results)

        _cb(95, "Analysis complete.")
        return EngineResult(success=True, data=result_df)

    except Exception as exc:
        return EngineResult(success=False, errors=[str(exc)])
