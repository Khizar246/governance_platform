# STATUS.md — Project State Tracker

Last updated: 2026-05-05 (session 14 — SOD SA results step revamp)

## Current Phase: PRODUCTION-READY — ALL COMPLETE

## Architecture

```
Governance_Platform/
├── backend/
│   ├── main.py              # FastAPI entry
│   ├── config.py            # App config
│   ├── exceptions.py        # Custom exceptions
│   ├── engines/             # Pure business logic (NO FastAPI imports)
│   │   ├── entitlement_mapping_engine.py  (Pandas)
│   │   ├── fp_analysis_engine.py          (Polars)
│   │   ├── oracle_comparator_engine.py    (Polars)
│   │   └── sod_sa_engine.py               (Polars)
│   ├── routers/             # API endpoints (one per tool + __init__)
│   ├── models/              # Pydantic models (common + one per tool)
│   ├── services/job_manager.py
│   └── shared/              # file_io, validators, logger, excel_export
├── frontend/
│   ├── src/
│   │   ├── pages/           # Home, EntitlementMapping, FPAnalysis, OracleComparator, SODSAAnalysis
│   │   ├── components/common/  # FileUpload, DataTable, StatCard, StepIndicator, DownloadButton,
│   │   │                       # LoadingOverlay, EmptyState, LoadingSkeleton, HelpAccordion,
│   │   │                       # Badge, ConfirmDialog, Tooltip, ErrorBoundary
│   │   ├── components/layout/  # AppLayout, Sidebar, PageHeader
│   │   ├── components/ui/      # 17 shadcn primitives (button, dialog, checkbox, table, etc.)
│   │   ├── api/             # Axios client + tool API functions (4 tools)
│   │   ├── hooks/           # useFileUpload, useAnalysis
│   │   ├── stores/          # useAppStore (Zustand)
│   │   ├── types/           # index.ts (shared TypeScript types)
│   │   ├── utils/           # constants.ts, formatters.ts
│   │   ├── lib/             # utils.ts (cn() helper)
│   │   ├── App.tsx          # Route definitions
│   │   └── main.tsx         # React entry
│   └── ...
├── Data/                    # Sample XLSX datasets (4 tool folders, 11 files)
│   ├── EntitlementMapping/  # client_entitlements.xlsx, ey_ruleset.xlsx
│   ├── FPAnalysis/          # sod_analysis.xlsx, fp_database.xlsx
│   ├── OracleComparator/    # env1_prod_rbac.xlsx, env2_uat_rbac.xlsx, env1_prod_dsp.xlsx, env2_uat_dsp.xlsx
│   └── SODSAAnalysis/       # user_roles.xlsx, role_hierarchy.xlsx, ruleset.xlsx
```

## Known Bugs (Fix in order)

### BUG-1: SOD/SA Dashboard Metrics Wrong
- **Status:** FIXED
- **Problem:** Shows total row count instead of distinct entity counts
- **Fix:** `backend/routers/sod_sa_analysis.py` `_run_thread` — replaced `.height` with `.select("ROLE_NAME").unique().height` for role counts and `.select("USER_NAME").unique().height` for user counts in `ViolationCounts`.

### BUG-2: Entitlement Analysis Column Naming
- **Status:** FIXED
- **Problem:** Engine looked for `"Access Entitlement Name"` / `"Access Point Code"` but input files use `"Entitlement Name"` / `"Privilege Name"` / `"Privilege Code"`.
- **Fix:** `entitlement_mapping_engine.py` — `_find_col` calls updated to `"Entitlement Name"` + `"Privilege Code"`. `entitlement_mapping.py` router — `_REQUIRED_COLS` updated to `{"Entitlement Name", "Privilege Name", "Privilege Code"}`.

### BUG-3: NULL String Handling in SOD SA
- **Status:** FIXED
- **Problem:** `"null"` / `"NULL"` were listed as null sentinels in all four loaders in `shared/file_io.py`, causing Pandas/Polars to convert the string to an actual null before any code could preserve it.
- **Fix:** Removed `"NULL"` and `"null"` from `null_values` / `na_values` in all four functions (`load_csv_to_polars`, `load_excel_to_polars`, `load_csv_to_pandas`, `load_excel_to_pandas`). The string now survives as `"NULL"` after uppercasing and is treated as real data by the engine. `sod_sa_engine.py` `load_ruleset_sheets` was already safe (uses `keep_default_na=False` with no `na_values`).

### BUG-4: FP Analysis Weak Error Messages
- **Status:** FIXED
- **Problem:** Multiple gaps: violation sheets in SOD file had no column checks; FP Database sheets had no column checks; `validate_fp` was defined but never called; `validate_sod` messages named neither the file nor checked `DETAILS_SHEET` columns.
- **Fix:**
  - `fp_analysis_engine.py` `load_sod_file`: added column validation for each violation sheet present in the SOD file; messages now name the file and sheet.
  - `fp_analysis_engine.py` `load_fp_database`: added column validation for `No_action_Privileges` (`PRIVILEGE_DISPLAY_NAME`, `FALSE POSITIVE REASON`) and `WorkArea_Privileges` (`WORK_AREA_PRIVILEGE`) immediately after load.
  - `fp_analysis_engine.py` `validate_sod`: added `DETAILS_SHEET` column check; all messages now prefix with "SOD file".
  - `fp_analysis.py` router: imported `validate_fp` and call it in `/run` before starting the thread, so mode-specific FP Database column errors surface as HTTP 400s.

## UI Redesign

### Phase: DEPENDENCIES — COMPLETE
- Installed: recharts, react-dropzone, tailwindcss-animate, class-variance-authority, all @radix-ui/* primitives, @tanstack/react-table, lucide-react, sonner, clsx, tailwind-merge, date-fns, @types/node
- Created: `frontend/components.json` (shadcn config)
- Created: `frontend/src/lib/utils.ts` (cn() helper)
- Created: `frontend/src/components/ui/` — 17 shadcn primitives
- Updated: `tailwind.config.ts`, `src/index.css`, `tsconfig.app.json`, `vite.config.ts`
- Note: framer-motion / motion library was installed then fully removed; all animation is now CSS-only.

### Phase: LAYOUT — COMPLETE
- AppLayout.tsx — 2-column flex (Sidebar + content). Topbar (56px) shows current page title + date. Content area max-width 1400px, cream bg `#F7F6F3`, fade-in wrapper.
- Sidebar.tsx — Light (white bg), flat single nav group "GOVERNANCE", 5 items, 232px/60px expanded/collapsed, gold active state, trust badges + user card in footer.
- PageHeader.tsx — Compact row: colored icon + navy title (22px/600) + pipe + gray subtitle (13px). 48px height, border-b, mb-24.

### Phase: SHARED COMPONENTS — COMPLETE
- StepIndicator.tsx — Completed: green + checkmark. Active: gold ring + CSS pulse. Upcoming: gray-300 outline. CSS transitions.
- FileUpload.tsx — react-dropzone. 4 keyed states: idle / dragging (gold border) / uploading (CSS progress bar) / success (green) / error (red). Managed via CSS classes.
- Badge.tsx — 5 semantic variants (success/warning/error/info/neutral), all color tokens resolved.
- DownloadButton.tsx — idle/loading/success icon states, CSS transitions.
- LoadingOverlay.tsx — backdrop-blur, CSS transition-[width] progress bar, percentage label.
- EmptyState.tsx — fade-in, EY gold button, icon + title + description + action.
- LoadingSkeleton.tsx — shimmer keyframe; 3 variants: card, table-row, stat.
- HelpAccordion.tsx — collapsible help sections with HelpStep, HelpPill, TemplateDownloads sub-exports; used on all 4 tool pages between PageHeader and StepIndicator.
- DataTable.tsx — TanStack Table + shadcn Table. Sticky header, per-column filters, sort, zebra rows, pagination (25/50/100), tooltip on truncated cells, skeleton loading state, empty state.
- StatCard.tsx — Lora serif stat value, label-caps label, optional trend + badge. CSS hover lift.
- ConfirmDialog.tsx — shadcn Dialog, used for reset confirmation on all tool pages.

### Phase: PAGES — COMPLETE
- Home.tsx — Greeting + KPI row (4 cards with Lora stats + progress bars) + 4 tool launch cards.
- EntitlementMapping.tsx — 4 steps: Upload → Preview → Running → Results. Dual FileUpload, StatCards (4), Recharts BarChart, tabbed DataTable (5 tabs), DownloadButton. HelpAccordion present.
- FPAnalysis.tsx — 4 steps: Mode → Configure (sheet checkboxes) → Upload → Results. Compact summary cards (one per analyzed sheet, 2×2 metric grid inside), tabbed DataTable (server-side pagination, column filters, FP? select filter), DownloadButton. HelpAccordion present.
- OracleComparator.tsx — 3 steps: Type → Upload → Results. Conditional 2/4 file upload, Recharts grouped BarChart, tabbed comparison table with color-coded match rate pills. HelpAccordion present.
- SODSAAnalysis.tsx — 4 steps: Type → Upload → Running → Results. Conditional 2/3 file upload, server-side paginated DataTable (tabbed per analyzed sheet), InsightCard grid, per-sheet stat cards, live chunk messages in LoadingOverlay. HelpAccordion present.

## Completed Work

- [x] Backend: All 4 engines ported and working
- [x] Backend: All 4 routers working
- [x] Backend: Shared modules (file_io, validators, logger, excel_export)
- [x] Backend: Job manager with TTL cleanup
- [x] Backend: Pydantic models
- [x] Frontend: All 5 pages built and functional
- [x] Frontend: All common components built (13 total)
- [x] Frontend: 17 shadcn UI primitives
- [x] Frontend: API client layer (4 tool APIs)
- [x] Frontend: Custom hooks (useFileUpload, useAnalysis)
- [x] Frontend: Zustand store (useAppStore)
- [x] Frontend: Layout shell (Sidebar, AppLayout, PageHeader)
- [x] Frontend: HelpAccordion on all 4 tool pages
- [x] Full end-to-end flow working for all 4 tools
- [x] Sample XLSX datasets under Data/ (11 files, 4 tool folders)
- [x] Light cream theme — all framer-motion removed, CSS transitions throughout

## Log

- 2026-05-05: Final review pass — verified all 4 tools: no charts/graphs, correct output pattern (summary stats → table(s) → download). EntitlementMapping/OracleComparator/SODSAAnalysis use true server-side pagination; FPAnalysis is client-side (all data pre-fetched). EntitlementMapping Excel includes "How to Read This Report" sheet ✅. Column tooltips in EntitlementMapping headers ✅. 7 removed columns absent from entire frontend src ✅. SPEC.md updated: all 4 tool Results sections rewritten to match actual implementation (no more Recharts references); §DataTable updated to document Excel-style filter system. STATUS.md FPAnalysis pagination description corrected.
- 2026-05-05: Excel-style column filters — DataTable.tsx: replaced plain text `<input>` column filters with Excel-style dropdown (portal, `position:fixed`). Client-side mode: filter button opens dropdown showing all unique column values (computed from data via accessorKey), checkbox multi-select, search box, Select All, Clear/Done footer; TanStack custom `multiSelectFilter` fn registered as default filterFn. Server-side mode with `selectOptions`: filter button opens dropdown with radio single-select (predefined options), closes on selection. Server-side text columns: unchanged plain text input. Active filter state: gold border + "N selected" label. Dropdown closes on outside click (deferred listener) and ESC. Verified: tsc --noEmit clean, vite build clean.

- 2026-05-03: Created STATUS.md. Identified 4 bugs. UI redesign planned after bug fixes.
- 2026-05-03: Fixed BUG-1 — SOD/SA dashboard metrics now show distinct role/user counts.
- 2026-05-03: Fixed BUG-2 — Entitlement mapping engine now reads "Entitlement Name" + "Privilege Code"; router validates all three expected columns.
- 2026-05-03: Fixed BUG-3 — Removed "null"/"NULL" from null sentinel lists in all four file_io.py loaders; string now preserved as "NULL" through the pipeline.
- 2026-05-03: Fixed BUG-4 — FP analysis now gives specific column/sheet/file error messages at upload and run time; validate_fp now wired into the /run endpoint.
- 2026-05-03: UI DEPENDENCIES complete — all shadcn primitives, recharts, react-dropzone installed; @/ alias, CSS vars, tailwind animate plugin configured.
- 2026-05-03: EY theme applied — tailwind.config.ts and index.css configured.
- 2026-05-03: AppLayout.tsx, PageHeader.tsx, Sidebar.tsx redesigned.
- 2026-05-03: All common components redesigned (FileUpload, StepIndicator, StatCard, DataTable, Badge, DownloadButton, LoadingOverlay, EmptyState, LoadingSkeleton).
- 2026-05-03: All 4 tool pages redesigned (EntitlementMapping, OracleComparator, FPAnalysis, SODSAAnalysis).
- 2026-05-03: LIGHT CREAM THEME MIGRATION — Full overhaul to cream #F7F6F3. All framer-motion removed; CSS transitions throughout. Fonts switched to DM Sans + Lora. Sidebar switched from dark to light/white. Home.tsx, AppLayout, Sidebar, PageHeader, all common components and pages updated.
- 2026-05-04: Dashboard/Sidebar/UI cleanup — Home.tsx: removed Platform Status panel and SOD alert; tool cards full-width. Sidebar: collapsed to single flat nav group. HelpAccordion.tsx created; added to all 4 tool pages.
- 2026-05-04: Sample XLSX datasets generated in Data/ (11 files across 4 tool folders). AccessGovernancePlatform.jsx deleted (replaced by Vite/React TSX app).
- 2026-05-04: STATUS.md and SPEC.md synced to actual codebase state.
- 2026-05-05: Entitlement mapping results UI cleanup — removed Recharts BarChart and all recharts/BarChart2 imports from EntitlementMapping.tsx; removed chartData useMemo; results step is now StatCards → search/confidence filter → tab bar → DataTable. Removed results_preview from EntitlementMappingSummary type (no longer consumed). Fixed HelpAccordion: removed stale "Name-Based Match" and "Coverage Combination" HelpPills; corrected confidence thresholds to 75%/40%; fixed HelpStep 4 text. Verified no removed column names (Privilege Overlap %, Entitlement Name Similarity %, Missing Privileges, Extra Privileges in EY, Coverage Combination, Comment) appear anywhere in frontend src.
- 2026-05-05: Entitlement mapping server-side pagination — added `GET /results/{job_id}` endpoint with page/page_size/tab/search/confidence query params; router stores full result records in `_result_rows` after analysis completes; `_is_full_coverage` extracted to module level; DELETE endpoint now clears result cache; DataTable extended with optional `serverSide` prop (disables client pagination, hides per-column filters); EntitlementMapping results step fetches pages from server with search input + confidence dropdown; tab counts still come from summary (full-dataset counts); Excel download unchanged.
- 2026-05-05: Entitlement mapping output cleanup — removed 7 columns (Privilege Overlap %, Entitlement Name Similarity %, Missing Privileges, Missing Privileges Found In, Extra Privileges in EY, Coverage Combination, Comment). Match Confidence now based solely on privilege coverage % (High ≥75%, Medium ≥40%, Low <40%, None). Removed name similarity from scoring sort; sort is now overlap count DESC → Jaccard DESC. Added COLUMN_DESCRIPTIONS constant to engine. Excel export now includes "How to Read This Report" sheet with column reference, confidence tier guide, and matching explanation. Router summary stats updated to derive exact/superset counts from Privilege Match Count + Jaccard instead of removed Comment column.
- 2026-05-05: Tooltip visibility fix — TooltipContent default style changed from white bg/dark text (bg-popover/text-popover-foreground) to navy bg/white text (#0F1E3D bg, white text). Added normal-case and tracking-normal to prevent uppercase/letter-spacing inheritance from sticky header div. Affects all tooltips (column header descriptions + cell truncation tooltips in DataTable).
- 2026-05-05: Tooltip clipping fix + per-column Excel-style filters — tooltip.tsx: removed overflow-hidden, added whitespace-normal, increased collisionPadding default to 12 and sideOffset to 6; column header tooltips set to side="bottom". EntitlementMapping: removed global search/confidence filter bar; replaced with per-column server-side filters (text inputs on 5 columns, confidence dropdown on Match Confidence). DataTable: added ServerSideFilters interface + serverSideFilters prop; renders select or text filter per column in server-side mode. Backend results_page: replaced search param with client_filter + ey_filter + pmc_filter + jaccard_filter + runner_up_filter. API client getResults updated accordingly.
- 2026-05-05: Tooltip portal fix — wrapped TooltipPrimitive.Content in TooltipPrimitive.Portal in tooltip.tsx. Root cause: @radix-ui/react-tooltip v1.x does not auto-portal, so content rendered inline inside the <th> and was clipped by the table's overflow:auto container.
- 2026-05-05: FP analysis backend results cache — fp_analysis.py router: added _ROLE_COLS / _USER_COLS column constants; added _result_dfs cache (job_id → sheet → list[dict]); _run_thread now populates cache after analysis; DELETE endpoint clears cache. New endpoints: GET /summary/{job_id} returns per-sheet {total, false_positive_count, single_leg_count, true_conflict_count} for analyzed sheets only; GET /results/{job_id} returns paginated rows for a single sheet with optional search + fp_filter params. Note: backend supports server-side pagination but frontend uses client-side mode (pre-fetches all rows at once via page_size=100000).
- 2026-05-05: FP analysis results step redesign — removed Recharts PieChart donut, StatCard grids, and reduction % metric entirely. Results step now: (1) compact summary cards row (one per analyzed sheet only, 2×2 grid inside each card showing Total/FP/SL/TC in Lora serif with color-coded values); (2) tabbed DataTable — CLIENT-SIDE mode: all rows for each sheet fetched once with page_size=100000, stored in allSheetData; DataTable receives full array, uses built-in client pagination (25/50/100) and now Excel-style multi-select filters on all columns; fpClassCell badge renderer; (3) Download button. Added getSheetResults() to fpAnalysis.ts API. Removed recharts import and StatCard import from FPAnalysis.tsx.
- 2026-05-05: Oracle Comparator server-side pagination — oracle_comparator.py router: added _result_data cache (job_id → direction → comp_type → list[dict]); _run_thread now populates cache after analysis completes (before complete_job releases DataFrames); DELETE endpoint clears cache. New endpoints: GET /summary/{job_id} returns OracleComparatorSummary (analysis_type, env1/env2 names, comparisons list with total/matches/missing/match_rate per type+direction); GET /results/{job_id} returns paginated rows for a given direction (1to2/2to1) and comparison_type (duty_role/privilege/dsp) with optional status_filter and search params.
- 2026-05-05: Oracle Comparator results step redesign — removed Recharts grouped BarChart and all recharts imports. Results step now: (1) Summary card with inline table showing Analysis Type / Direction / Total Records / Matches / Missing / Match Rate % for all comparison rows; (2) Detail table card with control bar containing Direction button-group selector (navy active state, env names from user input), Type pill selectors (gold active, only available types shown), Status select filter (All/Exists/Missing), 350ms-debounced search input; (3) DataTable with server-side pagination fetching from GET /results/{job_id}; (4) Download button unchanged. Added getResults() to oracleComparator.ts API. Columns derived dynamically from first row; Status column rendered as green/red pill badge. PLACEHOLDER_COLS (5 cols) used for skeleton display while loading.
- 2026-05-05: SOD SA server-side pagination + summary endpoints — sod_sa_analysis.py router: added _ROLE_COLS / _USER_COLS / _SHEET_COLS column constants; added _result_dfs cache (job_id → sheet → list[dict]); _run_thread now populates cache before export (selected cols per sheet: ROLE_SOD/ROLE_SA expose CONTROL_NAME, ENTITLEMENT, ROLE_NAME, INHERITED_ROLE_NAME, PRIVILEGE_NAME; USER_SOD/USER_SA add USER_NAME); DELETE endpoint clears cache. New GET /summary/{job_id}: per-sheet total_violations + unique_roles/users, top_roles_sod, top_users_sod, top_sod_controls, top_sa_controls (all top-5 by unique control/role/user count, derived from sheets actually analyzed). New GET /results/{job_id}: paginated rows for one sheet with optional search param (across all exposed columns).
- 2026-05-05: SOD SA results step revamp — removed Recharts BarChart, StatCard grid, and BarChart2 import entirely. Results step now: (1) scope bar; (2) per-sheet violation stat cards (1–4 dynamic grid, red/green top border, Lora 36px violation count + unique roles/users below divider, shown only for analyzed sheets); (3) Top Insights 2×2 grid of InsightCard components (rank badge + name + gold count — shows top_roles_sod, top_users_sod, top_sod_controls, top_sa_controls, only renders cards that have data); (4) tabbed DataTable (tab badge shows count, gold active indicator, 350ms debounce search input, server-side pagination via serverSide prop — ROLE_SOD/ROLE_SA use 5-col ROLE_COLUMNS, USER_SOD/USER_SA use 6-col USER_COLUMNS); (5) download + reset buttons unchanged. sodSaAnalysis.ts extended with SODSASummaryData/SODSATopItem/SODSASheetCount interfaces and getSummary() / getSheetResults() API functions.
