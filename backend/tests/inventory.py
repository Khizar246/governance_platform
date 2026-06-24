"""Single source of truth for every SOD & SA validation scenario.

Both the pytest suite (`test_sod_sa_validation.py`) and the Word-doc generator
(`generate_validation_doc.py`) consume this list, so the documented expected
message and the asserted expected message can never drift apart.

Each Scenario records:
  id            short stable id (also the pytest test id)
  category      grouping for the doc (one table per category)
  scenario      human title
  file          which uploaded file the tester corrupts
  how_to_break  manual step the tester performs to trigger it
  http          expected HTTP status code
  code          expected JSON `code` field ("" when not applicable, e.g. 422/200)
  expect        substring that MUST appear in the response (exact error text or
                a detail line); for warnings, the warning string

The pytest tests build the matching broken upload in-memory and assert
http + code + that `expect` appears in the response body.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Scenario:
    id: str
    category: str
    scenario: str
    file: str
    how_to_break: str
    http: int
    code: str
    expect: str


# Categories (ordering preserved in the doc)
PHASE0 = "Phase 0 — Per-file checks (extension, size, magic bytes, seed flags)"
PHASE1 = "Phase 1 — Upfront schema scan (missing sheets / columns)"
PHASE2 = "Phase 2 — Load & data checks (zero rows, empty critical cells)"
PHASE3 = "Phase 3 — Data integrity (shared privilege on both legs)"
PHASE4 = "Phase 4 — Run-time checks (config, state, observation)"
WARN = "Non-blocking warnings (upload still succeeds — must NOT block)"


SCENARIOS: list[Scenario] = [
    # ── Phase 0 ──────────────────────────────────────────────────────────────
    Scenario("ext_unsupported", PHASE0,
             "Unsupported file extension",
             "Role Hierarchy",
             "Rename the Role Hierarchy file to a .txt (or any non csv/xls/xlsx) extension and upload it.",
             400, "VALIDATION_ERROR",
             "has unsupported extension"),
    Scenario("empty_file", PHASE0,
             "Empty (0-byte) file",
             "Role Hierarchy",
             "Upload a 0-byte file named role_hierarchy.xlsx (e.g. create an empty file).",
             400, "VALIDATION_ERROR",
             "appears to be empty (0 bytes)"),
    Scenario("xlsx_bad_magic", PHASE0,
             "Fake .xlsx (not real Excel)",
             "Ruleset",
             "Save a plain-text file, rename it to ruleset.xlsx, and upload. The ZIP signature is missing.",
             400, "VALIDATION_ERROR",
             "does not appear to be a valid Excel (.xlsx) file"),
    Scenario("xls_bad_magic", PHASE0,
             "Fake .xls (not real Excel)",
             "Ruleset",
             "Save a plain-text file, rename it to ruleset.xls, and upload. The OLE signature is missing.",
             400, "VALIDATION_ERROR",
             "does not appear to be a valid Excel (.xls) file"),
    Scenario("csv_is_excel", PHASE0,
             "Excel binary saved as .csv",
             "Role Hierarchy",
             "Take a real .xlsx file and just rename it to role_hierarchy.csv, then upload.",
             400, "VALIDATION_ERROR",
             "is saved as CSV but contains Excel binary data"),
    Scenario("ruleset_csv_ext", PHASE0,
             "Ruleset uploaded as .csv (only xls/xlsx allowed)",
             "Ruleset",
             "Rename the ruleset to ruleset.csv and upload — the Ruleset slot only accepts .xls/.xlsx.",
             400, "VALIDATION_ERROR",
             "has unsupported extension"),
    Scenario("no_ruleset_no_seed", PHASE0,
             "No ruleset uploaded and seed not requested",
             "Ruleset",
             "Upload Role Hierarchy only; leave the Ruleset slot empty and do not tick 'use seeded ruleset'.",
             400, "VALIDATION_ERROR",
             "no file uploaded and the seeded ruleset was not requested"),

    # ── Phase 1 (missing sheets / columns) ───────────────────────────────────
    Scenario("rh_missing_col", PHASE1,
             "Role Hierarchy missing a required column",
             "Role Hierarchy",
             "Delete the PRIVILEGE_CODE column header from the Role Hierarchy file.",
             400, "SCHEMA_VALIDATION_ERROR",
             "Role Hierarchy -> Missing Column: PRIVILEGE_CODE"),
    Scenario("ur_missing_col", PHASE1,
             "User Role missing a required column",
             "User Role",
             "Delete the 'Assigned Role Name' column header from the User Role file.",
             400, "SCHEMA_VALIDATION_ERROR",
             "User Role -> Missing Column: Assigned Role Name"),
    Scenario("ruleset_missing_sheet", PHASE1,
             "Ruleset missing a required sheet",
             "Ruleset",
             "Delete the entire 'SA Ruleset' sheet/tab from the ruleset workbook.",
             400, "SCHEMA_VALIDATION_ERROR",
             "Ruleset -> Missing Sheet: SA Ruleset"),
    Scenario("ruleset_missing_col", PHASE1,
             "Ruleset sheet missing a required column",
             "Ruleset",
             "On the 'SoD Ruleset' sheet, delete the 'LHS Entitlement' column header.",
             400, "SCHEMA_VALIDATION_ERROR",
             "Ruleset -> SoD Ruleset -> Missing Column: LHS Entitlement"),
    Scenario("mapping_missing_col", PHASE1,
             "Entitlement-to-Privilege missing a required column",
             "Ruleset",
             "On the 'Entitlement to Privilege' sheet, delete the 'Privilege Code' column header.",
             400, "SCHEMA_VALIDATION_ERROR",
             "Ruleset -> Entitlement to Privilege -> Missing Column: Privilege Code"),
    Scenario("fp_missing_sheet", PHASE1,
             "FP Database missing a required sheet",
             "FP Database",
             "Delete the 'WorkArea_Privileges' sheet from the FP Database workbook.",
             400, "SCHEMA_VALIDATION_ERROR",
             "FP Database -> Missing Sheet: WorkArea_Privileges"),
    Scenario("fp_missing_col", PHASE1,
             "FP Database sheet missing a required column",
             "FP Database",
             "On 'No_action_Privileges', delete the 'False Positive Reason' column header.",
             400, "SCHEMA_VALIDATION_ERROR",
             "FP Database -> No_action_Privileges -> Missing Column: False Positive Reason"),
    Scenario("multi_schema_aggregated", PHASE1,
             "Multiple schema issues reported together",
             "Role Hierarchy + Ruleset",
             "Break two things at once (e.g. drop ROLE_CODE from Role Hierarchy AND drop the SoD Ruleset sheet). Both appear in one error list.",
             400, "SCHEMA_VALIDATION_ERROR",
             "Found 2 schema issue(s) across your files"),

    # ── Phase 2 (load & data) ────────────────────────────────────────────────
    Scenario("rh_zero_rows", PHASE2,
             "Role Hierarchy has headers but no data rows",
             "Role Hierarchy",
             "Keep all column headers but delete every data row from the Role Hierarchy file.",
             400, "FILE_FORMAT_ERROR",
             "Role Hierarchy: contains no data rows after loading."),
    Scenario("sod_zero_rows", PHASE2,
             "SoD Ruleset sheet has no data rows",
             "Ruleset",
             "On the 'SoD Ruleset' sheet, keep headers but delete every data row.",
             400, "FILE_FORMAT_ERROR",
             "Ruleset -> SoD Ruleset: contains no data rows after loading."),
    Scenario("sod_empty_cell", PHASE2,
             "Critical cell left blank in SoD Ruleset",
             "Ruleset",
             "On 'SoD Ruleset', blank out a 'Control Name' cell on a data row (leave the row otherwise filled).",
             400, "FILE_FORMAT_ERROR",
             "empty cell(s)"),
    Scenario("mapping_empty_cell", PHASE2,
             "Critical cell left blank in Entitlement-to-Privilege",
             "Ruleset",
             "On 'Entitlement to Privilege', blank out a 'Privilege Code' cell on a data row.",
             400, "FILE_FORMAT_ERROR",
             "empty cell(s)"),

    # ── Phase 3 (integrity) ──────────────────────────────────────────────────
    Scenario("shared_privilege", PHASE3,
             "One privilege mapped to BOTH legs of a SoD control",
             "Ruleset",
             "On 'Entitlement to Privilege', map the same Privilege Code to BOTH entitlements used by one SoD control (e.g. map PRIV1 to both ENT_A and ENT_B).",
             400, "DATA_INTEGRITY_ERROR",
             "mapped to both"),

    # ── Phase 4 (run-time) ───────────────────────────────────────────────────
    Scenario("run_no_user_file", PHASE4,
             "User analysis requested but no user-role file",
             "(run config)",
             "Upload without a User Role file, then run with analysis_type 'user' or 'both'.",
             400, "VALIDATION_ERROR",
             "User-role file was not uploaded. Cannot run user-level analysis."),
    Scenario("run_bad_selected", PHASE4,
             "Invalid selected_analyses value",
             "(run config)",
             "Send a run request whose selected_analyses contains an unknown value (e.g. 'role_xyz').",
             422, "",
             "Invalid analysis types"),
    Scenario("run_already_running", PHASE4,
             "Run requested while job already running",
             "(run config)",
             "Trigger /run twice quickly for the same job; the second returns 409.",
             409, "ALREADY_RUNNING",
             "Analysis is already running for this job."),
    Scenario("obs_missing_inputs", PHASE4,
             "Observation requested without Control Bucket / Bucket Details",
             "Ruleset + run config",
             "Upload a ruleset with no 'Control Bucket' column and no 'Bucket Details' sheet, then run with the Observation option ON.",
             400, "SCHEMA_VALIDATION_ERROR",
             "Missing Sheet: Bucket Details"),
    Scenario("obs_bucket_xref", PHASE4,
             "Control Bucket value missing from Bucket Details",
             "Ruleset + run config",
             "Add a 'Control Bucket' column with value 'BUCKET_X' on SoD Ruleset and a Bucket Details sheet that does NOT contain 'BUCKET_X'; run with Observation ON.",
             400, "SCHEMA_VALIDATION_ERROR",
             "Missing Bucket Details row for: BUCKET_X"),

    # ── Non-blocking warnings ────────────────────────────────────────────────
    Scenario("warn_no_user_file", WARN,
             "No user-role file provided (warning only)",
             "(omit User Role)",
             "Upload without a User Role file. Upload still succeeds; a warning is returned.",
             200, "",
             "No user-role file provided. User-level analysis will not be available."),
    Scenario("warn_recommended_col", WARN,
             "Recommended ruleset column missing (warning only)",
             "Ruleset",
             "Remove the 'Risk Ranking' column from SoD Ruleset. Upload still succeeds with a recommended-column warning.",
             200, "",
             "Missing recommended column: Risk Ranking"),
    Scenario("warn_missing_entitlement", WARN,
             "Entitlement used in a control has no mapping (warning only)",
             "Ruleset",
             "Reference an entitlement in a control that has no row in 'Entitlement to Privilege'. Upload succeeds; an entitlement warning is returned.",
             200, "",
             "ENT_UNMAPPED"),
]


def by_category() -> dict[str, list[Scenario]]:
    out: dict[str, list[Scenario]] = {}
    for s in SCENARIOS:
        out.setdefault(s.category, []).append(s)
    return out
