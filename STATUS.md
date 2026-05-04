# STATUS.md — Project State Tracker

Last updated: 2026-05-04 (session 4)

## Current Phase: LIGHT THEME MIGRATION — COMPLETE

## Architecture

```
Governance_Platform/
├── backend/
│   ├── main.py              # FastAPI entry
│   ├── config.py             # App config
│   ├── exceptions.py         # Custom exceptions
│   ├── engines/              # Pure business logic (NO FastAPI imports)
│   │   ├── entitlement_mapping_engine.py  (Pandas)
│   │   ├── fp_analysis_engine.py          (Polars)
│   │   ├── oracle_comparator_engine.py    (Polars)
│   │   └── sod_sa_engine.py               (Polars)
│   ├── routers/              # API endpoints
│   ├── models/               # Pydantic models
│   ├── services/job_manager.py
│   └── shared/               # file_io, validators, logger, excel_export
├── frontend/
│   ├── src/
│   │   ├── pages/            # Home, EntitlementMapping, FPAnalysis, OracleComparator, SODSAAnalysis
│   │   ├── components/common/ # FileUpload, DataTable, StatCard, StepIndicator, etc.
│   │   ├── components/layout/ # AppLayout, Sidebar, PageHeader
│   │   ├── api/              # Axios client + tool API functions
│   │   └── ...
│   └── ...
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

## UI Redesign (After bugs fixed)

### Phase: DEPENDENCIES
- **Status:** COMPLETE
- Installed: motion, recharts, react-dropzone, tailwindcss-animate, class-variance-authority, all @radix-ui/* primitives, @types/node (already had: @tanstack/react-table, lucide-react, sonner, clsx, tailwind-merge, date-fns)
- Created: `frontend/components.json` (shadcn config, Radix library, neutral base, cssVariables)
- Created: `frontend/src/lib/utils.ts` (cn() helper)
- Created: `frontend/src/components/ui/` — 17 components: button, dialog, dropdown-menu, input, label, tabs, checkbox, switch, tooltip, separator, scroll-area, skeleton, sheet, badge, select, table, popover
- Updated: `tailwind.config.ts` — added `darkMode: ["class"]`, shadcn CSS-variable color system, `md` borderRadius, `tailwindcss-animate` plugin
- Updated: `src/index.css` — added shadcn CSS variables (:root + .dark blocks), `@apply border-border` global reset
- Updated: `tsconfig.app.json` — added baseUrl + `@/*` path alias
- Updated: `vite.config.ts` — added path.resolve alias for `@/`

### Phase: LAYOUT
- **Status:** DONE
- Redesign: Sidebar.tsx — DONE (glassmorphism, grouped nav by category, per-tool colored accents, user card, collapse toggle, inline SVG icons)
- Redesign: AppLayout.tsx — DONE (dark bg #06060d, flex row layout, Topbar with TLS/SOC2 badges + user pill, route-aware accent color)
- Redesign: PageHeader.tsx — DONE (dark text/border, inline styles)

### Phase: SHARED COMPONENTS
- **Status:** IN PROGRESS
- StepIndicator.tsx — DONE
- FileUpload.tsx — DONE
- Badge.tsx — DONE
- DownloadButton.tsx — DONE
- LoadingOverlay.tsx — DONE
- EmptyState.tsx — DONE
- LoadingSkeleton.tsx — DONE (new file, card/table-row/stat shimmer variants)
- Add new: AnimatedCounter, GlassCard
- Refer to SPEC.md for each component's design spec

### Phase: PAGES
- **Status:** IN PROGRESS
- Home.tsx → DONE (dark theme, KPI row, horizontal tool cards with hover lift+colored shadow, Platform Status panel, alert badge)
- EntitlementMapping.tsx — DONE
- FPAnalysis.tsx — DONE
- OracleComparator.tsx — DONE
- SODSAAnalysis.tsx — DONE

## Completed Work

- [x] Backend: All 4 engines ported and working
- [x] Backend: All 4 routers working
- [x] Backend: Shared modules (file_io, validators, logger, excel_export)
- [x] Backend: Job manager with TTL cleanup
- [x] Backend: Pydantic models
- [x] Frontend: All 5 pages built and functional
- [x] Frontend: All common components built
- [x] Frontend: API client layer
- [x] Frontend: Layout shell (sidebar, header)
- [x] Full end-to-end flow working for all 4 tools
- [x] Sample datasets created under Data/ for all 4 tools

## Log

- 2026-05-03: Created STATUS.md. Identified 4 bugs. UI redesign planned after bug fixes.
- 2026-05-03: Fixed BUG-1 — SOD/SA dashboard metrics now show distinct role/user counts.
- 2026-05-03: Fixed BUG-2 — Entitlement mapping engine now reads "Entitlement Name" + "Privilege Code"; router validates all three expected columns.
- 2026-05-03: Fixed BUG-3 — Removed "null"/"NULL" from null sentinel lists in all four file_io.py loaders; string now preserved as "NULL" through the pipeline.
- 2026-05-03: Fixed BUG-4 — FP analysis now gives specific column/sheet/file error messages at upload and run time; validate_fp now wired into the /run endpoint.
- 2026-05-03: UI DEPENDENCIES complete — all shadcn primitives, motion, recharts, react-dropzone installed; @/ alias, CSS vars, tailwind animate plugin configured.
- 2026-05-03: EY theme applied — tailwind.config.ts and index.css updated to SPEC §Colors, §Typography, §Elevation.
- 2026-05-03: AppLayout.tsx — switched to CSS Grid (260px fixed sidebar + 1fr content), gray-50 bg, max-w-[1400px] centered, AnimatePresence page transitions (opacity+y, 200ms). Removed sidebar-collapse useEffect (fixed layout).
- 2026-05-03: PageHeader.tsx — updated to SPEC §PageHeader: 22px/700 title, 14px gray-500 subtitle, 20px gray-400 icon, h-12 mb-24 border-b.
- 2026-05-03: FileUpload.tsx — redesigned per SPEC §FileUpload: react-dropzone replaces manual drag events; 4 keyed states in AnimatePresence (fade+y, 180ms); idle/dragging (yellow border+bg on hover), uploading (Motion-animated progress bar), success (green border+bg, metadata, remove), error (red border+bg, message, retry via hidden ref input). Props interface unchanged.
- 2026-05-03: StepIndicator.tsx — redesigned per SPEC §StepIndicator: Motion layoutId="step-active-dot" for smooth inter-step transitions (spring 300/30), Motion pulse ring on active (scale 1→1.65, opacity 0.7→0, 1.2s infinite), green filled circle + white checkmark for completed, gray-300 outline for upcoming, connector lines green/gray.
- 2026-05-03: StatCard.tsx — redesigned per SPEC §StatCard: motion.div wrapper with whileHover translateY(-2px) + shadow-lg (200ms), inline AnimatedCounter (useMotionValue + animate spring 300/30, .on('change') subscriber renders tabular-nums stat-value), optional icon (gray-400, 16px), label-caps label, optional trend (TrendingUp/Down/Minus icon + colored text), optional badge.
- 2026-05-03: DataTable.tsx — redesigned per SPEC §DataTable: TanStack Table + shadcn TableRow/TableHead/TableCell primitives; sticky header (bg-gray-50, 11px uppercase, z-10); per-column filter inputs inline in each th (stopPropagation prevents sort trigger); sort arrows (ChevronUp/Down/ChevronsUpDown); zebra rows (white/gray-50); hover:bg-gray-100; Radix Tooltip on cells with raw text > 30 chars; 8-row Skeleton loading state with variable widths; Database icon empty state with title+description; pagination (25/50/100, prev/next, row range); new optional isLoading prop; global filter removed in favour of per-column filters.
- 2026-05-03: Badge.tsx — fixed color tokens (bg-success-light → bg-success-bg etc.); all 5 semantic variants now resolve correctly against tailwind config.
- 2026-05-03: DownloadButton.tsx — fixed hover/active class names (yellow-hover → ey-yellow-hover, dropped non-existent yellow-active); added AnimatePresence icon transitions (scale 0.7→1, 150ms) between idle/loading/success states.
- 2026-05-03: LoadingOverlay.tsx — upgraded to backdrop-blur-md + bg-white/70; replaced static progress div with motion.div spring animation (stiffness 60, damping 20); added percentage label (text-label, uppercase).
- 2026-05-03: EmptyState.tsx — wrapped in motion.div fade-in (opacity 0→1, y 8→0, 200ms); updated button to EY yellow with hover state; typography updated to text-card-title + text-body-sm.
- 2026-05-03: LoadingSkeleton.tsx — new component; tailwind.config.ts extended with shimmer keyframe (backgroundPosition sweep 1.5s infinite); three variants: card (icon block + 3 text lines), table-row (5 variable-width cells), stat (label + large number + sub-label).
- 2026-05-03: EntitlementMapping.tsx — redesigned per SPEC §EntitlementMapping: 4-step workflow (Upload/Preview/Running/Results + Error), StepIndicator, AnimatePresence mode="wait" x-slide transitions, dual FileUpload with dedup warning badges in preview cards, mini preview tables, 4 StatCards (exact/superset/partial/no-match), Recharts BarChart (match distribution, cell colors), 5-tab DataTable (All/Exact/Superset/Partial/No Match with counts), DownloadButton, ConfirmDialog on reset.
- 2026-05-03: OracleComparator.tsx — redesigned per SPEC §OracleComparator: AnimatePresence x-slide on all steps; 3 GlassCards (motion.button whileHover lift, colored borderLeftColor inline style, icon in colored pill); "Recommended" badge (bg-ey-yellow, absolute top-right) on Complete/both card; selected ring highlight on back-navigation; upload step with rounded-lg inputs + focus:ring-ey-yellow, config summary bar, motion progress bar; Recharts grouped BarChart (forward/reverse match rates per comp_type, domain 0-100, tickFormatter %, two Bar components with fill #3B82F6/#22C55E); tabbed HTML table (tabs shown when >1 comp_type, "All" + per-type tabs, ey-yellow active border); table columns: Direction / Type (All tab only) / Total / Matches / Missing / Match Rate (color-coded pill ≥90 green, ≥60 amber, else red); DownloadButton, ConfirmDialog on reset.
- 2026-05-03: FPAnalysis.tsx — redesigned per SPEC §FPAnalysis: AnimatePresence x-slide transitions on all steps; GlassCard mode selection (bg-white/80 backdrop-blur-sm, colored left border, motion whileHover lift, selected ring); shadcn Checkbox (data-[state=checked] blue) replacing HTML inputs in grouped sheet config; upload step with motion progress bar + config summary bar; results with per-sheet StatCard grids (4 cols), Recharts PieChart donut (FP/SL/TC aggregate), AnimatedPct spring counter (56px mono) + animated progress bar for overall reduction %, DownloadButton, ConfirmDialog on reset.
- 2026-05-03: SODSAAnalysis.tsx — redesigned per SPEC §SODSAAnalysis: AnimatePresence x-slide on all steps; 3 GlassCards (motion.button whileHover lift, colored borderLeftColor, icon in colored pill, "Recommended" badge on Role+User card); upload step with conditional 2-or-3 FileUploads, config summary bar, motion progress bar; running step shows live chunk messages via progressMessage in LoadingOverlay; results with conditional StatCard grid (2-col or 4-col based on analysis_type), Recharts horizontal BarChart (layout="vertical", Cell fill red/green per violation count), DownloadButton, ConfirmDialog on reset.
- 2026-05-03: DARK THEME MIGRATION — Complete overhaul matching reference HTML design: (1) index.css: DM Sans font, body bg #06060d, CSS variables remapped to dark, dark scrollbar, bg-white/bg-white-80 CSS overrides. (2) tailwind.config.ts: gray scale remapped to dark palette, green/red/blue/amber/yellow light variants remapped to dark tints, shadow tokens updated for dark. (3) Sidebar.tsx: full glassmorphism redesign — grouped nav (Governance / Security Intelligence), per-tool colored accents (yellow/blue/green/amber), active left-bar indicator, user card, collapse toggle. (4) AppLayout.tsx: flex layout + Topbar (56px) with route-aware page icon, TLS 1.3 + SOC2 trust badges, user pill. (5) PageHeader.tsx: dark inline styles. (6) Home.tsx: complete rewrite — greeting, KPI row with colored gradients, horizontal tool cards with hover translate+shadow, Platform Status panel, alert.
- 2026-05-03: Frontend review — fixed 5 cross-cutting issues: (1) index.css: added .label-uppercase class (alias for .label-caps) — was used in all 4 redesigned pages but never defined, causing silent no-op styling. (2) tailwind.config.ts: added error-light, warning-light, success-light, info-light color tokens — pages use bg-error-light/bg-warning-light but only *-bg aliases existed; also added shadow-card, shadow-card-hover (Home.tsx), shadow-dropdown (ConfirmDialog.tsx). (3) Sidebar.tsx: fixed w-60 (240px) → w-[260px] to match AppLayout's 260px CSS Grid column — 20px gap between dark sidebar and content was visible. All routes, API paths, @/ aliases, component imports verified correct.
- 2026-05-04: Dashboard/Sidebar/UI cleanup + help sections — (1) Home.tsx: removed Platform Status panel, Platform info card, and SOD alert; tool cards now full-width. (2) Sidebar.tsx: collapsed two NAV_GROUPS (Governance + Security Intelligence) into a single flat NAV_ITEMS array; order is now Dashboard → FP Analysis → Entitlement Mapping → Oracle Role Comparison → SOD & SA Analysis. (3) Created HelpAccordion.tsx shared component (accordion, HelpStep, HelpPill, TemplateDownloads exports). (4) All 4 React tool pages: added "How to Use" + "How the Tool Works" collapsible sections + TemplateDownloads between PageHeader and StepIndicator. (5) AccessGovernancePlatform.jsx: reordered NAV to match — FP Analysis before Entitlement Mapping.
- 2026-05-04: Sample datasets generated under Data/ — 19 files across 4 tool folders; privilege codes, entitlement names, role hierarchy, and SOD/SA rules are internally consistent; FP test data designed to produce L1/L2/L3 FP classifications; Oracle Comparator PROD vs UAT data has deliberate mismatches; generate_sample_data.py at project root regenerates all files.
- 2026-05-04: LIGHT CREAM THEME MIGRATION — Full overhaul from dark #06060d to light cream #F7F6F3. All motion/react and framer-motion references removed from every file. (1) index.css: Lora + DM Sans fonts, light CSS variables, .btn-gold (gold bg + navy text), .btn-primary changed to navy+gold, .card light, .stat-value Lora serif, CSS animations fade-in/slide-in replacing AnimatePresence. (2) tailwind.config.ts: font-serif Lora, standard light gray scale, light semantic colors. (3) Sidebar.tsx: white bg, navy logo, gold active highlight, TLS/SOC2 trust badges. (4) AppLayout.tsx, PageHeader.tsx: light inline styles, fade-in wrapper. (5) All common components (StatCard, FileUpload, StepIndicator, DownloadButton, LoadingOverlay, EmptyState, LoadingSkeleton): motion removed, CSS transitions replacing spring animations. (6) Home.tsx: Lora h1, 4 KPI cards, tool cards, status panel, amber alert. (7) EntitlementMapping, FPAnalysis, OracleComparator, SODSAAnalysis: AnimatePresence wrappers removed, all motion.div/motion.button replaced with div+slide-in class, all progress bars converted to CSS transition-[width], AnimatedPct removed, Run action buttons changed to btn-gold, selection cards changed from bg-white/80 backdrop-blur to bg-white.
