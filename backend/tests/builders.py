"""In-memory file builders for SOD & SA validation tests.

Produces a *valid baseline* set of uploads that passes every validation phase,
plus small mutators that break exactly one thing so a single test isolates a
single validation rule. Everything stays in memory (BytesIO) — no disk writes,
no live server.

The baseline data is intentionally tiny and self-consistent:
  - Role Hierarchy maps one privilege (PRIV1) under role R1.
  - The ruleset's SoD control uses two distinct entitlements (ENT_A / ENT_B),
    each mapped to a DIFFERENT privilege, so the shared-privilege integrity gate
    passes.
  - User Role assigns R1 to one user.
  - FP DB has the two required sheets with one row each.
"""

from __future__ import annotations

import io

import pandas as pd

# ── Baseline data (valid; passes all phases) ────────────────────────────────

ROLE_HIERARCHY_ROWS = [
    # TOP_ROLE_CODE, TOP_ROLE_NAME, ROLE_CODE, ROLE_NAME, PRIVILEGE_CODE, PRIVILEGE_NAME
    ("TR1", "Top Role 1", "R1", "Role One", "PC1", "PRIV1"),
    ("TR1", "Top Role 1", "R1", "Role One", "PC2", "PRIV2"),
]
ROLE_HIERARCHY_COLS = [
    "TOP_ROLE_CODE", "TOP_ROLE_NAME", "ROLE_CODE", "ROLE_NAME",
    "PRIVILEGE_CODE", "PRIVILEGE_NAME",
]

USER_ROLE_ROWS = [("user1", "Role One")]
USER_ROLE_COLS = ["User Name", "Assigned Role Name"]

# SoD Ruleset: control uses ENT_A (LHS) vs ENT_B (RHS).
SOD_ROWS = [("CTRL_SOD_1", "ENT_A", "ENT_B")]
SOD_COLS = ["Control Name", "LHS Entitlement", "RHS Entitlement"]

SA_ROWS = [("CTRL_SA_1", "ENT_A")]
SA_COLS = ["Control Name", "Entitlement"]

# Entitlement → Privilege. ENT_A → PRIV1, ENT_B → PRIV2 (disjoint → no overlap).
MAPPING_ROWS = [("ENT_A", "PRIV1"), ("ENT_B", "PRIV2")]
MAPPING_COLS = ["Entitlement Name", "Privilege Code"]

# Optional Bucket Details sheet (used by Observation tests).
BUCKET_DETAILS_COLS = ["Bucket Name", "Risk", "EY Recommendations"]

FP_NOACTION_ROWS = [("PRIV1", "Known safe")]
FP_NOACTION_COLS = ["PRIVILEGE_NAME", "False Positive Reason"]
FP_WORKAREA_ROWS = [("PRIV2", "WA1")]
FP_WORKAREA_COLS = ["PRIVILEGE_NAME", "WORK_AREA_PRIVILEGE_CODE"]


def _df(rows, cols) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=cols)


# ── Encoders ────────────────────────────────────────────────────────────────

def _xlsx_bytes(sheets: dict[str, pd.DataFrame]) -> bytes:
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        for name, df in sheets.items():
            df.to_excel(xw, sheet_name=name, index=False)
    return buf.getvalue()


# ── Baseline builders (return raw bytes) ────────────────────────────────────

def role_hierarchy_xlsx() -> bytes:
    return _xlsx_bytes({"Sheet1": _df(ROLE_HIERARCHY_ROWS, ROLE_HIERARCHY_COLS)})


def user_role_xlsx() -> bytes:
    return _xlsx_bytes({"Sheet1": _df(USER_ROLE_ROWS, USER_ROLE_COLS)})


def ruleset_sheets() -> dict[str, pd.DataFrame]:
    """Mutable dict of the ruleset's sheets so tests can drop/edit one."""
    return {
        "SoD Ruleset": _df(SOD_ROWS, SOD_COLS),
        "SA Ruleset": _df(SA_ROWS, SA_COLS),
        "Entitlement to Privilege": _df(MAPPING_ROWS, MAPPING_COLS),
    }


def ruleset_xlsx(sheets: dict[str, pd.DataFrame] | None = None) -> bytes:
    return _xlsx_bytes(sheets if sheets is not None else ruleset_sheets())


def fp_sheets() -> dict[str, pd.DataFrame]:
    return {
        "No_action_Privileges": _df(FP_NOACTION_ROWS, FP_NOACTION_COLS),
        "WorkArea_Privileges": _df(FP_WORKAREA_ROWS, FP_WORKAREA_COLS),
    }


def fp_db_xlsx(sheets: dict[str, pd.DataFrame] | None = None) -> bytes:
    return _xlsx_bytes(sheets if sheets is not None else fp_sheets())
