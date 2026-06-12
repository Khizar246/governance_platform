"""Generate a large synthetic stress-test dataset for the SOD & SA Analysis tool.

Outputs (Data/SODSAAnalysis/StressTest/):
  role_hierarchy_stress.csv   flat role hierarchy (~500k rows, 1,000 top roles)
  user_roles_stress.csv       user-role memberships (~10,000 users, many-to-many)
  ruleset_stress.xlsx         3 sheets: SoD Ruleset / SA Ruleset / Entitlement to Privilege
  fp_database_stress.xlsx     2 sheets: No_action_Privileges / WorkArea_Privileges

Injected edge cases:
  A. Many-to-many: user cohorts share IDENTICAL role sets (exercises GROUP_NAME
     grouping); superusers hold 40-80 roles; popular roles held by 100s of users.
  B. Dirty data: special-character / foreign-script / formula-probe user names,
     role display names and privilege display names ("N/A" intentionally becomes
     null through the CSV loader's null_values list).
  C. Direct top-role -> privilege rows: ROLE_CODE / ROLE_NAME blank.
  D. Truncated hierarchy rows: PRIVILEGE_CODE / PRIVILEGE_NAME blank (incl.
     dead-end child roles that map to no privilege anywhere).
  Plus: duplicate rows, orphan user assignments to non-existent roles, blank
  supplementary ruleset cells (placeholder fill), blank/NaN work-area values.

Seeded violations: a known set of (SOD control, top role) pairs is force-injected
so the run is guaranteed to produce verifiable ROLE_SOD hits.

Run with the backend interpreter:
  backend/venv/Scripts/python.exe scripts/generate_sod_sa_stress_data.py [--skip-verify]
"""

from __future__ import annotations

import io
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "Data" / "SODSAAnalysis" / "StressTest"

SEED = 42

# ── Scale knobs ───────────────────────────────────────────────────────────────
N_USERS = 10_000
N_TOP_ROLES = 1_000
N_CHILD_ROLES = 2_500
N_PRIVILEGES = 12_000          # 30 verbs x 20 qualifiers x 20 nouns
N_ENTITLEMENTS = 600
N_SOD_CONTROLS = 250
N_SA_CONTROLS = 150

CHILDREN_PER_ROLE = (20, 60)
PRIVS_PER_CHILD = (8, 16)
DIRECT_ROWS_PER_ROLE = (1, 8)      # edge case C
TRUNCATED_ROWS_PER_ROLE = (1, 6)   # edge case D
N_DEADEND_CHILDREN = 50            # children that never resolve to a privilege
N_COHORTS = 150                    # identical-role-set user groups
COHORT_SIZE = (5, 60)
COHORT_ROLES = (3, 20)
N_SUPERUSERS = 100
SUPERUSER_ROLES = (40, 80)
SINGLE_ROLES_GEOM_P = 0.22         # ~4-5 roles avg for ordinary users
N_ORPHAN_ROWS = 300                # assignments to roles absent from hierarchy
DUP_FRACTION = 0.01
N_SEEDED_CONTROLS = 25             # guaranteed SOD violations
SEEDED_ROLES_PER_CONTROL = 4

rng = np.random.default_rng(SEED)

# ── Name pools ────────────────────────────────────────────────────────────────
VERBS = ["Create", "Edit", "Delete", "Approve", "Submit", "View", "Manage", "Post",
         "Release", "Reconcile", "Transfer", "Close", "Open", "Override", "Configure",
         "Audit", "Export", "Import", "Schedule", "Cancel", "Hold", "Match", "Apply",
         "Void", "Reverse", "Adjust", "Allocate", "Certify", "Review", "Process"]
QUALIFIERS = ["Master", "Batch", "Standard", "Intercompany", "Manual", "Recurring",
              "Foreign", "Restricted", "Global", "Local", "Draft", "Final", "Pending",
              "Archived", "Consolidated", "Statutory", "Internal", "External",
              "Primary", "Secondary"]
NOUNS = ["Supplier", "Invoice", "Payment", "Journal", "Ledger", "Asset", "Customer",
         "Receipt", "Order", "Requisition", "Contract", "Budget", "Expense",
         "Bank Account", "Tax Code", "Period", "Credit Memo", "User Account",
         "Role", "Workflow"]
DEPTS = ["AP", "AR", "GL", "FA", "PO", "INV", "HR", "IT", "TRES", "TAX", "PAY", "SEC"]
JOB_FUNCS = ["Manager", "Clerk", "Analyst", "Supervisor", "Director", "Specialist",
             "Administrator", "Auditor", "Officer", "Lead"]
MODULES = ["Payables", "Receivables", "General Ledger", "Fixed Assets", "Procurement",
           "Inventory", "HR Core", "Security Console", "Cash Management", "Tax"]
RISKS = ["Critical", "High", "Medium", "Low"]
FIRST = ["james", "mary", "wei", "fatima", "carlos", "aisha", "ivan", "yuki", "priya",
         "lucas", "emma", "noah", "sofia", "omar", "chen", "anna", "raj", "leila",
         "marco", "nina", "david", "sara", "tom", "kira"]
LAST = ["smith", "garcia", "wang", "khan", "mueller", "rossi", "tanaka", "petrov",
        "okafor", "santos", "kim", "nguyen", "ali", "brown", "silva", "kumar",
        "novak", "haddad", "jensen", "moreau", "lopez", "weber", "sato", "oconnor"]

# Exact dirty tokens requested + realistic extras (used verbatim, once each)
DIRTY_USER_TOKENS = [
    "User_!@#$", "*_*", "N/A", "---", "O'Connor-Smyth", "张伟", "محمد.الأحمد",
    "Иван_Иванов", "Müller.José", "=SUM(A1:A99)", "=CMD|' /C calc'!A0",
    "  padded.user  ", "NULL", 'quote"name"', "comma,name", "semi;colon",
    "<script>alert(1)</script>", "ñandú.pérez", "12345", "user\\backslash",
]
DIRTY_SUFFIXES = ["!@#", "_*_", "''", "##", "···", "™", "()", "%%", "?!", "&&"]


def _dirty_some(names: list[str], count: int, tag: str) -> list[int]:
    """Append special-character noise to `count` random entries. Returns indices."""
    idx = rng.choice(len(names), size=count, replace=False)
    for j, i in enumerate(idx):
        names[i] = f"{names[i]} {DIRTY_SUFFIXES[j % len(DIRTY_SUFFIXES)]} {tag}{i}"
    return list(idx)


# ── Builders ──────────────────────────────────────────────────────────────────

def build_privileges() -> tuple[list[str], list[str]]:
    codes = [f"PRIV_{i:05d}" for i in range(N_PRIVILEGES)]
    names = [
        f"{VERBS[i // 400]} {QUALIFIERS[(i // 20) % 20]} {NOUNS[i % 20]}"
        for i in range(N_PRIVILEGES)
    ]
    _dirty_some(names, 60, "P")
    return codes, names


def build_children() -> tuple[list[str], list[str]]:
    codes = [f"DUTY_{i:04d}" for i in range(N_CHILD_ROLES)]
    names = [
        f"{VERBS[i % 30]} {NOUNS[(i // 30) % 20]} Duty {i:04d}"
        for i in range(N_CHILD_ROLES)
    ]
    _dirty_some(names, 25, "D")
    # Dead-end children: appear in hierarchy but resolve to nothing (edge case D)
    dead_codes = [f"DUTY_DEAD_{i:03d}" for i in range(N_DEADEND_CHILDREN)]
    dead_names = [f"Dead End Duty {i:03d}" for i in range(N_DEADEND_CHILDREN)]
    return codes + dead_codes, names + dead_names


def build_top_roles() -> tuple[list[str], list[str], list[str]]:
    codes, names = [], []
    for i in range(N_TOP_ROLES):
        dept = DEPTS[i % len(DEPTS)]
        func = JOB_FUNCS[(i // len(DEPTS)) % len(JOB_FUNCS)]
        codes.append(f"ROLE_{dept}_{func.upper()}_{i:04d}")
        names.append(f"{dept} {func} {i:04d}")
    _dirty_some(names, 20, "R")
    types = rng.choice(["JOB", "ABSTRACT", "DATA"], size=N_TOP_ROLES, p=[0.7, 0.2, 0.1])
    return codes, names, list(types)


def build_entitlement_mapping(priv_codes, priv_names, child_codes, child_names) -> pd.DataFrame:
    """Entitlement to Privilege sheet. Maps mostly to privilege codes; ~15% of
    entitlements also map to child role codes (exercises hierarchy join path 1)."""
    ent_names = [
        f"{VERBS[i % 30]} {NOUNS[(i // 30) % 20]} Access E{i:03d}"
        for i in range(N_ENTITLEMENTS)
    ]
    rows = []
    for i, ent in enumerate(ent_names):
        for p in rng.choice(N_PRIVILEGES, size=rng.integers(2, 5), replace=False):
            rows.append((ent, priv_names[p], priv_codes[p]))
        if rng.random() < 0.15:
            for c in rng.choice(N_CHILD_ROLES, size=rng.integers(1, 3), replace=False):
                rows.append((ent, child_names[c], child_codes[c]))
    return pd.DataFrame(rows, columns=["Entitlement Name", "Privilege Name", "Privilege Code"])


def build_controls(ent_names: list[str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    n = len(ent_names)
    # SoD: pairs of distinct entitlements
    lhs = rng.integers(0, n, size=N_SOD_CONTROLS)
    rhs = (lhs + rng.integers(1, n, size=N_SOD_CONTROLS)) % n
    sod = pd.DataFrame({
        "Control Name": [f"SOD-{DEPTS[i % len(DEPTS)]}-{i:03d}" for i in range(N_SOD_CONTROLS)],
        "Risk Ranking": rng.choice(RISKS, size=N_SOD_CONTROLS, p=[0.1, 0.3, 0.4, 0.2]),
        "LHS Entitlement": [ent_names[i] for i in lhs],
        "RHS Entitlement": [ent_names[i] for i in rhs],
        "Module(s)": rng.choice(MODULES, size=N_SOD_CONTROLS),
        "Risk Description": [f"Risk of combining {ent_names[a]} with {ent_names[b]}"
                             for a, b in zip(lhs, rhs)],
    })
    # Blank supplementary cells (engine fills EMPTY_PLACEHOLDER)
    sod.loc[sod.sample(n=12, random_state=SEED).index, "Risk Description"] = ""
    sod.loc[sod.sample(n=8, random_state=SEED + 1).index, "Module(s)"] = ""

    sa_idx = rng.choice(n, size=N_SA_CONTROLS, replace=False)
    sa = pd.DataFrame({
        "Control Name": [f"SA-{DEPTS[i % len(DEPTS)]}-{i:03d}" for i in range(N_SA_CONTROLS)],
        "Risk Ranking": rng.choice(RISKS, size=N_SA_CONTROLS, p=[0.2, 0.4, 0.3, 0.1]),
        "Entitlement": [ent_names[i] for i in sa_idx],
        "Side": "LHS",
        "Module(s)": rng.choice(MODULES, size=N_SA_CONTROLS),
        "Risk Description": [f"Sensitive access to {ent_names[i]}" for i in sa_idx],
    })
    sa.loc[sa.sample(n=7, random_state=SEED).index, "Risk Description"] = ""
    return sod, sa


def build_hierarchy(role_codes, role_names, role_types, child_codes, child_names,
                    priv_codes, priv_names, mapping_df, sod_df):
    """Flat role hierarchy CSV + the seeded guaranteed-violation manifest."""
    n_children_total = len(child_codes)

    # Each child role has a fixed privilege set (realistic: duties are reusable)
    real_children = n_children_total - N_DEADEND_CHILDREN
    counts = rng.integers(*PRIVS_PER_CHILD, size=real_children, endpoint=True)
    child_priv = pd.DataFrame({
        "child": np.repeat(np.arange(real_children), counts),
        "priv": rng.integers(0, N_PRIVILEGES, size=counts.sum()),
    }).drop_duplicates()

    # Top role -> children assignment
    counts = rng.integers(*CHILDREN_PER_ROLE, size=N_TOP_ROLES, endpoint=True)
    role_child = pd.DataFrame({
        "role": np.repeat(np.arange(N_TOP_ROLES), counts),
        "child": rng.integers(0, real_children, size=counts.sum()),
    }).drop_duplicates()

    hier = role_child.merge(child_priv, on="child")

    def _frame(role_i, child_i, priv_i):
        return pd.DataFrame({
            "TOP_ROLE_CODE": np.take(role_codes, role_i),
            "TOP_ROLE_NAME": np.take(role_names, role_i),
            "ROLE_TYPE_CODE": np.take(role_types, role_i),
            "ROLE_CODE": np.take(child_codes, child_i) if child_i is not None else "",
            "ROLE_NAME": np.take(child_names, child_i) if child_i is not None else "",
            "PRIVILEGE_CODE": np.take(priv_codes, priv_i) if priv_i is not None else "",
            "PRIVILEGE_NAME": np.take(priv_names, priv_i) if priv_i is not None else "",
        })

    frames = [_frame(hier["role"].to_numpy(), hier["child"].to_numpy(), hier["priv"].to_numpy())]

    # Edge case C: direct top-role -> privilege rows (blank middle tier).
    # Half use entitlement-mapped privileges so the direct path provably resolves.
    mapped_privs = mapping_df.loc[
        mapping_df["Privilege Code"].str.startswith("PRIV_"), "Privilege Code"
    ].map(lambda c: int(c.split("_")[1])).unique()
    counts = rng.integers(*DIRECT_ROWS_PER_ROLE, size=N_TOP_ROLES, endpoint=True)
    role_i = np.repeat(np.arange(N_TOP_ROLES), counts)
    priv_i = np.where(
        rng.random(counts.sum()) < 0.5,
        rng.choice(mapped_privs, size=counts.sum()),
        rng.integers(0, N_PRIVILEGES, size=counts.sum()),
    )
    n_direct = counts.sum()
    frames.append(_frame(role_i, None, priv_i))

    # Edge case D: truncated rows — child present, privilege blank.
    # 30% use dead-end children that never appear with a privilege anywhere.
    counts = rng.integers(*TRUNCATED_ROWS_PER_ROLE, size=N_TOP_ROLES, endpoint=True)
    role_i = np.repeat(np.arange(N_TOP_ROLES), counts)
    child_i = np.where(
        rng.random(counts.sum()) < 0.3,
        rng.integers(real_children, n_children_total, size=counts.sum()),
        rng.integers(0, real_children, size=counts.sum()),
    )
    n_trunc = counts.sum()
    frames.append(_frame(role_i, child_i, None))

    # Seeded guaranteed SOD violations: give chosen roles a privilege from BOTH
    # legs of chosen controls, as direct rows.
    ent_priv = mapping_df[mapping_df["Privilege Code"].str.startswith("PRIV_")]
    ent_to_priv = ent_priv.groupby("Entitlement Name")["Privilege Code"].first()
    seeded = []
    seed_rows = []
    ctrl_pick = rng.choice(len(sod_df), size=N_SEEDED_CONTROLS, replace=False)
    for ci in ctrl_pick:
        ctrl = sod_df.iloc[ci]
        lhs_p, rhs_p = ent_to_priv[ctrl["LHS Entitlement"]], ent_to_priv[ctrl["RHS Entitlement"]]
        for ri in rng.choice(N_TOP_ROLES, size=SEEDED_ROLES_PER_CONTROL, replace=False):
            for p in (lhs_p, rhs_p):
                pi = int(p.split("_")[1])
                seed_rows.append((role_codes[ri], role_names[ri], role_types[ri],
                                  "", "", priv_codes[pi], priv_names[pi]))
            seeded.append((ctrl["Control Name"], role_codes[ri]))
    frames.append(pd.DataFrame(seed_rows, columns=frames[0].columns))

    df = pd.concat(frames, ignore_index=True)
    dups = df.sample(frac=DUP_FRACTION, random_state=SEED)
    df = pd.concat([df, dups], ignore_index=True).sample(frac=1, random_state=SEED).reset_index(drop=True)
    print(f"  hierarchy: {len(df):,} rows ({n_direct:,} direct-C, {n_trunc:,} truncated-D, "
          f"{len(seed_rows):,} seeded, {len(dups):,} dups)")
    return df, seeded


def build_users(role_codes, role_names) -> pd.DataFrame:
    base = [f"{FIRST[i % 24]}.{LAST[(i // 24) % 24]}{i:05d}" for i in range(N_USERS)]
    # Dirty names: exact tokens once each, then patterned noise up to ~2%
    for j, tok in enumerate(DIRTY_USER_TOKENS):
        base[j] = tok
    extra = rng.choice(np.arange(len(DIRTY_USER_TOKENS), N_USERS), size=180, replace=False)
    for j, i in enumerate(extra):
        base[i] = f"{base[i]}{DIRTY_SUFFIXES[j % len(DIRTY_SUFFIXES)]}"

    rows = []  # (user_idx, role_idx)
    cursor = 0

    # Cohorts: identical role sets (GROUP_NAME grouping test)
    for _ in range(N_COHORTS):
        size = rng.integers(*COHORT_SIZE, endpoint=True)
        size = min(size, N_USERS - N_SUPERUSERS - cursor)
        if size <= 0:
            break
        role_set = rng.choice(N_TOP_ROLES, size=rng.integers(*COHORT_ROLES, endpoint=True),
                              replace=False)
        for u in range(cursor, cursor + size):
            rows.extend((u, r) for r in role_set)
        cursor += size
    n_cohort_users = cursor

    # Superusers: dozens of roles each
    for u in range(cursor, cursor + N_SUPERUSERS):
        for r in rng.choice(N_TOP_ROLES, size=rng.integers(*SUPERUSER_ROLES, endpoint=True),
                            replace=False):
            rows.append((u, r))
    cursor += N_SUPERUSERS

    # Ordinary users: geometric role counts (most light, long tail)
    n_roles = np.clip(rng.geometric(SINGLE_ROLES_GEOM_P, size=N_USERS - cursor), 1, 15)
    for u, k in zip(range(cursor, N_USERS), n_roles):
        for r in rng.choice(N_TOP_ROLES, size=k, replace=False):
            rows.append((u, r))

    u_i, r_i = np.array([r[0] for r in rows]), np.array([r[1] for r in rows])
    df = pd.DataFrame({
        "User Name": np.take(base, u_i),
        "Assigned Role Name": np.take(role_codes, r_i),
        "Assigned Role Display Name": np.take(role_names, r_i),
    })

    # Orphan assignments to roles that don't exist in the hierarchy
    orphan_users = rng.choice(np.arange(n_cohort_users, N_USERS), size=N_ORPHAN_ROWS)
    orphans = pd.DataFrame({
        "User Name": np.take(base, orphan_users),
        "Assigned Role Name": [f"ROLE_GHOST_{i:03d}" for i in range(N_ORPHAN_ROWS)],
        "Assigned Role Display Name": [f"Ghost Role {i:03d}" for i in range(N_ORPHAN_ROWS)],
    })
    dups = df[df["User Name"].isin(np.take(base, np.arange(n_cohort_users, N_USERS)))] \
        .sample(frac=DUP_FRACTION, random_state=SEED)
    df = pd.concat([df, orphans, dups], ignore_index=True) \
        .sample(frac=1, random_state=SEED).reset_index(drop=True)
    print(f"  users: {df['User Name'].nunique():,} unique users, {len(df):,} rows "
          f"({n_cohort_users:,} in cohorts, {N_SUPERUSERS} superusers, "
          f"{N_ORPHAN_ROWS} orphan rows, {len(dups):,} dups)")
    return df


def build_fp_db(mapping_df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """FP database built from entitlement-mapped privilege display names so the
    3-level FP pipeline actually matches violation rows."""
    mapped = mapping_df[mapping_df["Privilege Code"].str.startswith("PRIV_")]
    names = mapped["Privilege Name"].str.upper().unique()
    reasons = ["Monitoring control only; no transactional impact",
               "Access is read-only by design",
               "Mitigated by downstream approval workflow",
               "Required system privilege; usage is audited"]
    no_action = pd.DataFrame({
        "PRIVILEGE_DISPLAY_NAME": rng.choice(names, size=200, replace=False),
        "FALSE POSITIVE REASON": rng.choice(reasons, size=200),
    })
    wa_names = rng.choice(names, size=160, replace=False)
    wa_values = [f"VIEW {NOUNS[i % 20].upper()} DASHBOARD" for i in range(160)]
    work_area = pd.DataFrame({
        "PRIVILEGE_DISPLAY_NAME": wa_names,
        "WORK_AREA_PRIVILEGE": wa_values,
    })
    # Invalid WA values the engine must filter out
    work_area.loc[work_area.sample(n=10, random_state=SEED).index, "WORK_AREA_PRIVILEGE"] = ""
    work_area.loc[work_area.sample(n=5, random_state=SEED + 1).index, "WORK_AREA_PRIVILEGE"] = "NaN"
    return no_action, work_area


# ── Output ────────────────────────────────────────────────────────────────────

_XLSX_OPTS = {"options": {"strings_to_formulas": False, "strings_to_urls": False}}


def write_outputs(hier, users, sod, sa, mapping, no_action, work_area):
    OUT.mkdir(parents=True, exist_ok=True)
    hier.to_csv(OUT / "role_hierarchy_stress.csv", index=False, encoding="utf-8-sig")
    users.to_csv(OUT / "user_roles_stress.csv", index=False, encoding="utf-8-sig")
    with pd.ExcelWriter(OUT / "ruleset_stress.xlsx", engine="xlsxwriter",
                        engine_kwargs=_XLSX_OPTS) as xw:
        sod.to_excel(xw, sheet_name="SoD Ruleset", index=False)
        sa.to_excel(xw, sheet_name="SA Ruleset", index=False)
        mapping.to_excel(xw, sheet_name="Entitlement to Privilege", index=False)
    with pd.ExcelWriter(OUT / "fp_database_stress.xlsx", engine="xlsxwriter",
                        engine_kwargs=_XLSX_OPTS) as xw:
        no_action.to_excel(xw, sheet_name="No_action_Privileges", index=False)
        work_area.to_excel(xw, sheet_name="WorkArea_Privileges", index=False)
    for f in sorted(OUT.glob("*")):
        print(f"  wrote {f.name} ({f.stat().st_size / 1e6:.1f} MB)")


# ── Verification: run the real engine on the generated files ────────────────

def verify(seeded: list[tuple[str, str]]):
    sys.path.insert(0, str(ROOT / "backend"))
    import polars as pl
    from engines.sod_sa_engine import (
        load_ruleset_sheets, analyze_roles, analyze_users,
        upper_values, apply_rename, INPUT_COLUMN_RENAME, REQUIRED_COLUMNS,
    )

    def load_csv(path: Path) -> pl.DataFrame:
        # Mirrors shared/file_io.load_csv_to_polars (incl. null_values)
        text = path.read_bytes().decode("utf-8-sig")
        return pl.read_csv(io.StringIO(text), infer_schema_length=10_000,
                           ignore_errors=True, null_values=["", "N/A", "n/a", "NA"])

    rh = apply_rename(upper_values(load_csv(OUT / "role_hierarchy_stress.csv")),
                      INPUT_COLUMN_RENAME["role"])
    ur = apply_rename(upper_values(load_csv(OUT / "user_roles_stress.csv")),
                      INPUT_COLUMN_RENAME["user"])
    assert not (REQUIRED_COLUMNS["role"] - set(rh.columns)), "hierarchy schema mismatch"
    assert not (REQUIRED_COLUMNS["user"] - set(ur.columns)), "user schema mismatch"

    sod, sa, mapping, errors = load_ruleset_sheets(
        (OUT / "ruleset_stress.xlsx").read_bytes(), "ruleset_stress.xlsx")
    assert not errors, f"ruleset load failed: {errors}"

    t0 = time.time()
    role_sod, role_sa = analyze_roles(rh, sod, sa, mapping)
    print(f"  ROLE_SOD={role_sod.height:,}  ROLE_SA={role_sa.height:,}  "
          f"({time.time() - t0:.1f}s)")

    hits = {(r["CONTROL_NAME"], r["ROLE_NAME"])
            for r in role_sod.select(["CONTROL_NAME", "ROLE_NAME"]).unique().to_dicts()}
    missing = [(c, r) for c, r in seeded if (c.upper(), r.upper()) not in hits]
    assert not missing, f"{len(missing)} seeded violations not detected: {missing[:5]}"
    print(f"  all {len(seeded)} seeded (control, role) violations detected")

    t0 = time.time()
    user_sod, user_sa = analyze_users(rh, ur, sod, sa, mapping)
    print(f"  USER_SOD={user_sod.height:,}  USER_SA={user_sa.height:,}  "
          f"({time.time() - t0:.1f}s)")
    print(f"  distinct violating users: {user_sod['USER_NAME'].n_unique():,}")


def main():
    t0 = time.time()
    print("Building reference pools…")
    priv_codes, priv_names = build_privileges()
    child_codes, child_names = build_children()
    role_codes, role_names, role_types = build_top_roles()
    mapping = build_entitlement_mapping(priv_codes, priv_names, child_codes, child_names)
    ent_names = mapping["Entitlement Name"].unique().tolist()
    sod, sa = build_controls(ent_names)
    print(f"  {len(mapping):,} entitlement-privilege rows, {len(sod)} SOD + {len(sa)} SA controls")

    print("Building role hierarchy…")
    hier, seeded = build_hierarchy(role_codes, role_names, role_types,
                                   child_codes, child_names, priv_codes, priv_names,
                                   mapping, sod)
    print("Building user-role memberships…")
    users = build_users(role_codes, role_names)
    no_action, work_area = build_fp_db(mapping)

    print("Writing files…")
    write_outputs(hier, users, sod, sa, mapping, no_action, work_area)

    if "--skip-verify" not in sys.argv:
        print("Verifying with the real engine…")
        verify(seeded)
    print(f"Done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
