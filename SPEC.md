# SPEC.md — Design & Technical Reference

Read ONLY the section you need. Do NOT load this entire file.

---

## §Colors

```
Cream (bg):    #F7F6F3  (main app background)
Surface:       #FFFFFF  (cards, panels, sidebar)
Navy:          #0F1E3D  (primary text, nav active, CTAs)
Navy Mid:      #1B2E52  (hover states on navy)
Navy Light:    #243760  (secondary navy accents)

Gold:          #E8A900  (active state borders, icon fills, accents)
Gold Bright:   #FFD100  (EY brand yellow, btn-gold background)
Gold Light:    #FFF3CC  (subtle gold tint backgrounds)

Text:
  t0: #0F172A  (primary)
  t1: #64748B  (secondary)
  t2: #94A3B8  (tertiary / placeholder)

Success: #16A34A  bg: rgba(22,163,74,0.1)
Warning: #D97706  bg: rgba(217,119,6,0.1)
Error:   #DC2626  bg: rgba(220,38,38,0.1)
Info:    #2563EB  bg: rgba(37,99,235,0.1)

Tool accents (left borders, icon pills):
  FP Analysis:         #2563EB (blue)
  Entitlement Mapping: #E8A900 (gold)
  Oracle Comparator:   #16A34A (green)
  SOD & SA Analysis:   #D97706 (amber)
```

---

## §Typography

```
Font Sans:  'DM Sans', system-ui, sans-serif       (all UI text)
Font Serif: 'Lora', Georgia, serif                 (stat values, KPI numbers)
Font Mono:  'DM Sans', Consolas, monospace

Display:      28px/600 DM Sans, tracking -0.01em
Page Title:   22px/600 DM Sans
Section:      16px/600 DM Sans
Card Title:   14px/500 DM Sans
Body:         13px/400 DM Sans
Body Small:   12px/400 DM Sans
Label:        11px/600 DM Sans, uppercase, tracking 0.08em
Stat Large:   36px/600 Lora serif, navy (#0F1E3D)
Stat Small:   22px/600 Lora serif
Badge:        10.5px/500 DM Sans
```

---

## §Spacing

4px grid: 2, 4, 8, 12, 16, 20, 24, 32, 48

---

## §Elevation

```
shadow-sm:   0 1px 2px rgba(0,0,0,0.04)
shadow-md:   0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)
shadow-lg:   0 4px 16px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)
shadow-xl:   0 8px 32px rgba(0,0,0,0.12)
```

Radius: 6px (sm), 8px (md), 12px (lg), 16px (xl)

---

## §Motion

All animation is CSS-only. No framer-motion / motion library.

```
Page enter:   .fade-in — opacity 0→1, translateY 8px→0, 0.3s ease
Step change:  .slide-in — opacity 0→1, translateX 16px→0, 0.25s ease
Card hover:   CSS :hover — translateY(-2px), shadow upgrade, transition 0.2s ease
Progress bar: CSS transition-[width] 0.4s ease
Skeleton:     .animate-shimmer — gradient sweep 1.6s infinite
Fade up:      .animate-fade-up — opacity 0→1, translateY 8px→0, 0.25s ease
```

---

## §Sidebar

Light panel, white background, 232px expanded / 60px collapsed. CSS transition 0.22s ease.

Layout top to bottom:
- Logo pill: navy bg, "AG" gold letter, "Access Governance / Platform" DM Sans text
- Nav label: "GOVERNANCE" (11px uppercase, tracked, gray)
- 5 nav items (flat, no sub-groups):
  1. Dashboard
  2. FP Analysis
  3. Entitlement Mapping
  4. Oracle Role Comparison
  5. SOD & SA Analysis
- Spacer (flex-grow)
- Trust badges (expanded only): "● TLS 1.3" + "● SOC2" (11px, green dot)
- User card (expanded only): "MK" avatar pill, "Mohd Khizar", "EY Analyst"
- Collapse toggle button (bottom of sidebar)

Nav item states:
- Default: gray text/icon
- Hover: light gray background tint
- Active: 3px gold left border, gold text/icon, light gold background tint

---

## §PageHeader

Compact single row: colored tool icon (20px, per-tool accent color) + navy title (22px/600) + "|" separator + gray-500 subtitle (13px). Height 48px, border-b gray-200, mb-24.

---

## §StepIndicator

Horizontal connected circles. States:
- Completed: green filled circle + white checkmark icon
- Active: gold outline ring + CSS pulse animation (scale 1→1.4 opacity fade, 1.2s infinite)
- Upcoming: gray-300 outline circle

Connector lines: green if completed, gray if not. CSS transitions for state changes.

---

## §FileUpload

4 states (react-dropzone):
- Idle: dashed gray-300 border, upload icon, hint text
- Dragging: gold border + gold-light bg tint (dragover)
- Uploading: CSS transition-[width] progress bar, filename
- Success: green border + check icon, file metadata, remove button
- Error: red border + error message + retry button

---

## §StatCard

White bg, gray-200 border, radius-lg, shadow-sm, p-20. Layout:
- Optional icon (16px, gray-400)
- Label: 11px DM Sans uppercase gray-500
- Value: 36px Lora serif, navy
- Optional trend: TrendingUp/Down/Minus icon + colored text
- Optional badge

Hover: CSS transition — translateY(-2px) + shadow-lg upgrade, 0.2s ease.

---

## §DataTable

TanStack Table + shadcn Table primitives.
- Sticky header: bg-gray-50, 11px uppercase, z-10
- **Excel-style column filters** (portaled dropdown, `position:fixed`):
  - Client-side mode: filter icon button per column; click opens dropdown with search box + checkbox list of all unique values computed from data; multi-select; Select All / Clear; Done button.
  - Server-side mode with `selectOptions`: radio single-select dropdown from predefined options; closes on selection.
  - Server-side mode text columns: plain text input (unique values unavailable server-side).
  - Active filter: gold border + "N selected" label on button.
  - Custom `multiSelectFilter` registered as default TanStack filterFn.
- Sort arrows: ChevronUp/Down/ChevronsUpDown
- Zebra rows: white/gray-50 alternating
- Hover: bg-gray-100
- Truncate long cells + Radix Tooltip for raw text > 30 chars
- Skeleton loading state: 8 rows with variable-width shimmer cells
- Empty state: icon + title + description
- Pagination: 25/50/100 rows per page, prev/next, row range display
- Props: `serverSide` (disables client pagination; accepts total/page/pageSize/callbacks), `serverSideFilters` (values + onChange + optional selectOptions)

---

## §Home

Dashboard layout (fade-in on mount):

1. **Greeting panel** — "Good morning/afternoon, Mohd Khizar" + current date + "● All systems operational" status badge.

2. **KPI cards row** (4 columns, equal width):
   - Entitlement Mapping runs
   - FP Analysis runs
   - Oracle Comparator runs
   - SOD & SA runs
   - Each: label (label-caps) + icon + Lora stat value + thin progress bar

3. **Tools section** (label "Tools" + 4 full-width stacked cards):
   - Each card: colored icon pill, tool name, badge tag, description, runtime + file count metadata, "Launch →" button
   - Hover: CSS translateY(-2px) + shadow-lg, 0.2s transition

---

## §EntitlementMapping

4 steps: Upload → Preview → Running → Results

- **Upload**: dual FileUpload (Client Entitlements + EY Ruleset)
- **Preview**: dedup warning badges, mini preview tables for each file
- **Running**: LoadingOverlay with CSS progress bar
- **Results**: 4 StatCards (Exact / Superset / Partial / No Match counts) → tab bar (All / Exact / Superset / Partial / No Match with count badges) → server-side paginated DataTable (6 columns: Client Entitlement, EY Entitlement Match, Privilege Match Count, Jaccard Similarity %, Match Confidence, Runner-Up EY Entitlements; per-column Excel-style filters; Match Confidence has gold select dropdown with High/Medium/Low/None; text columns use text inputs; column headers have Tooltip info icon on hover) → DownloadButton. No charts.

CSS slide-in step transitions. ConfirmDialog on reset. HelpAccordion above StepIndicator.

---

## §FPAnalysis

4 steps: Mode → Configure → Upload → Results

- **Mode**: 2 selection cards (Privilege Level / Entitlement Level) with colored left border, selected ring highlight
- **Configure**: grouped shadcn Checkbox list for violation sheets
- **Upload**: dual FileUpload (SOD Output + FP Database), config summary bar
- **Results**: compact summary cards row (one card per analyzed sheet only; 2×2 grid inside: Total / False Positive / Single Leg / True Conflict in Lora serif, color-coded) → tab bar (one tab per analyzed sheet) → **client-side DataTable** (all rows pre-fetched at once via `page_size=100000`; Excel-style multi-select filters on all columns; FP? column shows badge cell — "False Positive" / "SL" / "True Conflict"; client-side pagination 25/50/100) → DownloadButton. No charts.

CSS slide-in step transitions. ConfirmDialog on reset. HelpAccordion above StepIndicator.

---

## §OracleComparator

3 steps: Type → Upload → Results

- **Type**: 3 selection cards (RBAC / DSP / Both), "Recommended" badge on Both card, selected ring highlight
- **Upload**: 2 or 4 FileUploads depending on type, environment name text inputs, config summary bar
- **Results**: summary card (inline HTML table: Analysis Type / Direction / Total Records / Matches / Missing / Match Rate pill ≥90% green, ≥60% amber, else red) → detail card with control bar (Direction navy button-group selector using env names; Type gold pill selectors; Status select All/Exists/Missing; search input with 350ms debounce) → server-side paginated DataTable (columns derived from first row; Status column rendered as green/red pill badge) → DownloadButton. No charts.

CSS slide-in step transitions. ConfirmDialog on reset. HelpAccordion above StepIndicator.

---

## §SODSAAnalysis

4 steps: Type → Upload → Running → Results

- **Type**: 3 selection cards (Role Only / User Only / Both), "Recommended" badge on Both card
- **Upload**: 2 or 3 FileUploads depending on type (Role+User needs role_hierarchy, user_roles, ruleset), config summary bar
- **Running**: LoadingOverlay with CSS progress bar + live chunk messages via progressMessage prop
- **Results**: scope bar (analysis type label + roles/users count) → per-sheet violation stat cards (1–4 dynamic grid; red/green top border; Lora 36px violation count + divider + Unique Roles/Users below) → Top Insights 2×2 InsightCard grid (top_roles_sod, top_users_sod, top_sod_controls, top_sa_controls; rank badge + name + gold count; only cards with data shown) → tabbed server-side paginated DataTable (tab badge shows violation count; gold active indicator; search input above table; ROLE sheets: 5 cols; USER sheets: 6 cols with USER_NAME) → DownloadButton. No charts.

CSS slide-in step transitions. ConfirmDialog on reset. HelpAccordion above StepIndicator.

---

## §ErrorHandling

- Network: toast "Unable to connect. Check server is running."
- Upload fail: inline in FileUpload component, not toast.
- Analysis fail: error state in results area + "Try Again" + "Start Over".
- Download fail: toast + button resets.
- Stale job (404): "Session expired. Start new analysis." Reset to step 0.

---

## §Downloads

Filename: `{ToolName}_{Context}_{YYYYMMDD_HHMMSS}.xlsx`
Flow: click → button loading state → GET blob → temp `<a>` → trigger → button success flash (2s) → reset.

---

## §Backend

- Routers: upload → validate → run → status → download → cancel
- File validation order: empty check → extension → size → magic bytes → load → schema → preview
- Job manager: in-memory dict, UUID keys, TTL 1hr, max 20 jobs, cleanup every 5min
- Progress callbacks from engines: specific messages, not generic
- Structured errors: `{error: true, message, code, details[]}`
- Engine files: pure Python + Pandas/Polars only. Never import FastAPI or Pydantic.
