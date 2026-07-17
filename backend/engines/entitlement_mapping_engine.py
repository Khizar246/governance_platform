"""Entitlement Mapping Engine — ported from Entitlement Analysis/app.py.

Algorithm: map each client entitlement to the best-matching EY entitlement by a
weighted composite confidence score:
  score = 0.65 · Jaccard + 0.20 · module_match + 0.10 · coverage + 0.05 · name_sim
  (coverage = matched / client_total; module_match = 1.0 when the two entitlements
   share the same normalized Module name, else 0.0; name_sim = abbreviation-aware
   entitlement-name similarity)
Selection sorts by this composite score, then a SOFT name-priority re-ranker
promotes a near-exact name match (name_sim >= NAME_PRIORITY_FLOOR) when it is within
NAME_PRIORITY_MARGIN of the leader — this recovers near-subset mismatches that raw
overlap would win. When the best score is below MATCH_THRESHOLD the entitlement is
reported as "Not Mapped"; this is the single source of truth that downstream
control/SA mapping keys off.

Pure Python/Pandas — no FastAPI, no Pydantic, no HTTP.
"""

from typing import Callable

import logging
import re

import pandas as pd
from rapidfuzz import fuzz

from engines.result import EngineResult

# stdlib-only module logger (engines stay framework-free); preserves the traceback
# when an exception is converted into EngineResult(success=False).
_log = logging.getLogger("governance.entitlement_mapping_engine")

# Minimum blended confidence (%) for an entitlement to count as mapped. Below this,
# the match column reads "Not Mapped". Downstream SoD/SA control mapping depends on
# this gate — a control maps only when its entitlement(s) are mapped here.
# Calibrated against known cases: a correct match scored 31% and a wrong one 21%,
# so 30 separates them. Revisit with more labelled examples if matches drift.
MATCH_THRESHOLD = 30

# Composite confidence weights (must sum to 1.0). Jaccard dominates; an exact
# Module-name match adds a fixed bonus; privilege coverage and abbreviation-aware
# name similarity are the smaller terms.
W_JACCARD  = 0.65
W_MODULE   = 0.20
W_COVERAGE = 0.10
W_NAME     = 0.05

# Soft name-priority re-ranker. After sorting by composite, a trailing candidate
# whose name is a near-exact match (name_sim >= NAME_PRIORITY_FLOOR) AND whose
# composite is within NAME_PRIORITY_MARGIN of the leader is promoted over the
# leader. This recovers the case where a client entitlement's privileges are a
# near-subset of a LARGER, differently-named EY entitlement (which would otherwise
# win on raw overlap) — e.g. client "Maintain Supplier Master" vs the bloated
# "Process Supplier Portal Transaction". The margin guard keeps name from ever
# overriding a clearly-better privilege match.
NAME_PRIORITY_FLOOR  = 0.90
NAME_PRIORITY_MARGIN = 0.30


# Abbreviation/synonym map for name-similarity scoring. Keys are lowercase tokens
# as they appear in entitlement names; values are the spelled-out phrase they
# expand to before token comparison. AP and AR MUST expand to disjoint tokens so
# "Process AP Payments" and "Process AR Payments" do not look alike. Seed list —
# extend as new abbreviations appear in client/EY entitlement names.
ABBREVIATION_MAP: dict[str, str] = {
    "ap":     "accounts payable",
    "ar":     "accounts receivable",
    "gl":     "general ledger",
    "po":     "purchase order",
    "inv":    "invoice",
    "invs":   "invoices",
    "maint":  "maintain",
    "mgmt":   "management",
    "mgr":    "manager",
    "recpt":  "receipt",
    "rcpt":   "receipt",
    "pmt":    "payment",
    "pmts":   "payments",
    "config": "configuration",
    "admin":  "administration",
    "acct":   "account",
    "accts":  "accounts",
    "fa":     "fixed assets",
    "wip":    "work in progress",
}

_TOKEN_SPLIT = re.compile(r"[^a-z0-9]+")


def _normalize_name_tokens(name: str) -> set[str]:
    """Lowercase, strip punctuation, expand abbreviations, return a token set."""
    tokens: set[str] = set()
    for raw in _TOKEN_SPLIT.split(name.lower()):
        if not raw:
            continue
        expanded = ABBREVIATION_MAP.get(raw, raw)
        tokens.update(expanded.split())
    return tokens


def normalized_name_similarity(a: str, b: str) -> float:
    """Similarity (0.0–1.0) of two entitlement names after abbreviation expansion."""
    ta = _normalize_name_tokens(a)
    tb = _normalize_name_tokens(b)
    if not ta or not tb:
        return 0.0
    return fuzz.token_sort_ratio(" ".join(sorted(ta)), " ".join(sorted(tb))) / 100.0


def _normalize_module(value: object) -> str:
    """Normalize a Module name for exact comparison: trimmed, lowercased.

    Returns "" for blanks/NaN so an absent module never matches another absent one.
    """
    if value is None:
        return ""
    s = str(value).strip()
    if not s or s.lower() in {"nan", "none"}:
        return ""
    return s.lower()


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
        client_df: Pandas DataFrame with columns [Entitlement Name, Privilege Code, Module]
        ey_df:     Pandas DataFrame with the same three columns for the EY ruleset
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
        c_mod_col  = _find_col(client_df, "Module")
        e_mod_col  = _find_col(ey_df, "Module")

        # A blank Privilege Code is not a privilege — there is nothing to match
        # on, so the row is ignored entirely (an entitlement whose rows are ALL
        # blank therefore never enters the mapping). Without this, None survives
        # into the privilege sets and two entitlements "sharing" a blank cell
        # score as a real match. Mirrors _build_priv_groups' dropna() in
        # ruleset_mapping_engine.
        client_df = client_df[client_df[c_priv_col].notna()]
        ey_df     = ey_df[ey_df[e_priv_col].notna()]

        # Group privileges per entitlement — groupby+set auto-deduplicates
        client_groups: dict[str, set] = (
            client_df.groupby(c_ent_col)[c_priv_col].apply(set).to_dict()
        )
        ey_groups: dict[str, set] = (
            ey_df.groupby(e_ent_col)[e_priv_col].apply(set).to_dict()
        )
        all_ey_privs: set = set(ey_df[e_priv_col])

        # One Module per entitlement: first non-blank value in the group (rows of an
        # entitlement share a Module in practice). Normalized for exact comparison.
        def _module_groups(df: pd.DataFrame, ent_col: str, mod_col: str) -> dict[str, str]:
            out: dict[str, str] = {}
            for ent, sub in df.groupby(ent_col)[mod_col]:
                norm = ""
                for v in sub:
                    norm = _normalize_module(v)
                    if norm:
                        break
                out[str(ent)] = norm
            return out

        client_modules = _module_groups(client_df, c_ent_col, c_mod_col)
        ey_modules      = _module_groups(ey_df, e_ent_col, e_mod_col)

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
                    "Client Entitlement":              c_ent,
                    "EY Entitlement Match":            "—",
                    "Privilege Match Count":           f"0/{len(c_privs)}",
                    "Jaccard Similarity (%)":          "0%",
                    "Confidence Score (%)":            "0%",
                    "Match Confidence":                "Not Mapped",
                    "Client Privilege Count":          len(c_privs),
                    "EY Privilege Count":              0,
                    "EY Privileges Missing in Client": 0,
                    "Client Privileges Missing in EY": len(c_privs),
                    "Runner-Up EY Entitlements":       "",
                })
                continue

            # ── Score every EY entitlement ────────────────────────────────────
            # Composite = 0.65·Jaccard + 0.20·module_match + 0.10·coverage + 0.05·name_sim,
            # where coverage = matched / client_total, module_match = 1.0 when the two
            # entitlements share the same normalized Module name (else 0.0), and name_sim
            # is the abbreviation-aware entitlement-name similarity.
            # Selection sorts by composite DESC, then overlap count DESC, then name_sim DESC.
            c_module = client_modules.get(c_ent, "")
            scored: list[tuple] = []
            for e_ent, e_privs in ey_groups.items():
                matched = c_privs & e_privs
                if not matched:
                    continue
                overlap_count = len(matched)
                union_size    = len(c_privs | e_privs)
                jaccard       = overlap_count / union_size if union_size else 0
                coverage      = overlap_count / len(c_privs) if c_privs else 0
                e_module      = ey_modules.get(e_ent, "")
                module_match  = 1.0 if (c_module and c_module == e_module) else 0.0
                name_sim      = normalized_name_similarity(c_ent, e_ent)
                composite     = (W_JACCARD * jaccard + W_MODULE * module_match
                                 + W_COVERAGE * coverage + W_NAME * name_sim)
                scored.append((e_ent, matched, overlap_count, jaccard, e_privs, composite, name_sim))

            scored.sort(key=lambda x: (x[5], x[2], x[6]), reverse=True)

            # ── Soft name-priority re-ranker ──────────────────────────────────
            # Among candidates within NAME_PRIORITY_MARGIN of the leader's composite,
            # prefer one whose name is a near-exact match (name_sim >= floor). This
            # rescues the "client privileges are a near-subset of a larger,
            # differently-named EY entitlement" pattern that raw overlap would win,
            # without letting name override a clearly-better privilege match.
            leader_composite = scored[0][5]
            close = [
                s for s in scored
                if leader_composite - s[5] <= NAME_PRIORITY_MARGIN
                and s[6] >= NAME_PRIORITY_FLOOR
            ]
            if close:
                chosen = max(close, key=lambda x: (x[6], x[5]))
                if chosen is not scored[0]:
                    scored = [chosen] + [s for s in scored if s is not chosen]

            best_ent, matched_privs, _, best_jaccard, best_e_privs, best_composite = scored[0][:6]

            # Runner-ups (2nd & 3rd) — show composite confidence and overlap.
            runners = [
                f"{s[0]} ({s[2]}/{len(c_privs)}, {round(s[5] * 100)}%)"
                for s in scored[1:3]
            ]

            matched_count   = len(matched_privs)
            jaccard_pct     = round(best_jaccard * 100)
            confidence_pct  = round(best_composite * 100)

            # ── Match decision + confidence tier (composite confidence score %) ──
            # Below MATCH_THRESHOLD the best candidate is too weak to trust, so the
            # entitlement is reported as "Not Mapped" (the numeric columns are kept
            # for transparency). This is the single source of truth for "is this
            # entitlement mapped?" — downstream control/SA/missing-priv logic keys
            # off the match column being a real entitlement name.
            if confidence_pct < MATCH_THRESHOLD:
                best_ent   = "Not Mapped"
                confidence = "Not Mapped"
            elif confidence_pct >= 70:
                confidence = "High"
            elif confidence_pct >= 50:
                confidence = "Medium"
            else:
                confidence = "Low"

            mapping_results.append({
                "Client Entitlement":              c_ent,
                "EY Entitlement Match":            best_ent,
                "Privilege Match Count":           f"{matched_count}/{len(c_privs)}",
                "Jaccard Similarity (%)":          f"{jaccard_pct}%",
                "Confidence Score (%)":            f"{confidence_pct}%",
                "Match Confidence":                confidence,
                "Client Privilege Count":          len(c_privs),
                "EY Privilege Count":              len(best_e_privs),
                "EY Privileges Missing in Client": len(best_e_privs - c_privs),
                "Client Privileges Missing in EY": len(c_privs - best_e_privs),
                "Runner-Up EY Entitlements":       " | ".join(runners) if runners else "",
            })

        _cb(85, "Building results DataFrame…")
        result_df = pd.DataFrame(mapping_results)

        _cb(95, "Analysis complete.")
        return EngineResult(success=True, data=result_df)

    except Exception as exc:
        _log.error("run_mapping failed", exc_info=True)
        return EngineResult(success=False, errors=[str(exc)])
