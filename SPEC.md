# SPEC.md — Design & Technical Reference

Read ONLY the section you need. Do NOT load this entire file.

---

## §Colors

```
EY Yellow:       #FFE600  (accent only: CTAs, active states)
Yellow Hover:    #E6CF00
Yellow Subtle:   rgba(255,230,0,0.08)
Yellow Glow:     rgba(255,230,0,0.15)

Dark (sidebar):  #0A0A0F / #111118 / #1A1A24 / #252530 / #35354A
Light (content): #FAFAFA / #F4F4F5 / #E4E4E7 / #D4D4D8 / #A1A1AA / #71717A / #52525B / #3F3F46 / #27272A / #18181B

Success: #22C55E  bg: rgba(34,197,94,0.1)
Warning: #EAB308  bg: rgba(234,179,8,0.1)
Error:   #EF4444  bg: rgba(239,68,68,0.1)
Info:    #3B82F6  bg: rgba(59,130,246,0.1)
```

---

## §Typography

```
Font Sans:  'Inter', system-ui, sans-serif
Font Mono:  'JetBrains Mono', 'Consolas', monospace

Display:      28px/700 Inter, tracking -0.02em
Page Title:   22px/700 Inter, tracking -0.01em
Section:      16px/600 Inter
Card Title:   15px/600 Inter
Body:         14px/400 Inter
Body Small:   13px/400 Inter
Label:        11px/600 Inter, uppercase, tracking 0.05em
Stat Large:   32px/700 JetBrains Mono, tabular-nums
Stat Small:   20px/600 JetBrains Mono, tabular-nums
Badge:        11px/500 Inter
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
shadow-glow: 0 0 20px var(--ey-yellow-glow)
```

Glass: `bg-white/60 backdrop-blur-xl border border-white/20`

Radius: 6px (sm), 8px (md), 12px (lg), 16px (xl)

---

## §Motion

```
Page enter:     opacity 0→1, y 8→0, 200ms
Card hover:     translateY(-2px), shadow upgrade, 200ms
Stagger:        staggerChildren 0.05s
Spring:         stiffness 300, damping 30
Counter:        0→target, 600ms spring
Skeleton:       shimmer gradient sweep 1.5s infinite
Step transition: AnimatePresence mode="wait", exit x→-20, enter x 20→0
```

---

## §Sidebar

Dark panel, 260px fixed width. Layout top to bottom:

- EY branding: "EY" (22px bold yellow) + "Access Governance" (12px gray-400) + "Platform" (12px gray-500)
- Separator (1px slate-700)
- Section label "GOVERNANCE" (11px uppercase gray-500)
- Nav: Dashboard, Entitlement Mapping, FP Analysis
- Section label "SECURITY INTELLIGENCE"
- Nav: Oracle Comparator, SOD & SA Analysis
- Spacer (flex-grow)
- Separator
- Trust: "● Secure Processing" + "● Local Data Only" (11px green dot, gray-500)
- Version: "v1.0.0 Enterprise" (11px gray-600)

Nav states: default (gray-400), hover (bg slate-700/50, text gray-200), active (left 3px yellow border, bg yellow-subtle, text white, icon yellow). Use Motion layoutId for active indicator.

---

## §PageHeader

Compact single row: icon (20px gray-400) + title (22px/700) + "|" + subtitle (14px gray-500). Height 48px, border-b gray-200, mb-24.

---

## §StepIndicator

Horizontal connected circles. Completed: green + checkmark. Active: yellow ring + pulse. Upcoming: gray-300 outline. Motion layoutId for active dot.

---

## §FileUpload

4 states: Idle (dashed gray-300 border, upload icon, hint text), Dragging (yellow border, yellow-subtle bg), Uploading (progress bar, filename), Success (green border, check, metadata, remove button), Error (red border, error message, retry). Use react-dropzone.

---

## §StatCard

White bg, gray-200 border, radius-lg, shadow-sm, p-20. Icon + label (13px gray-500), AnimatedCounter value (32px mono), optional trend + badge. Hover: shadow-lg + translateY(-2px).

---

## §DataTable

TanStack Table + shadcn Table. Sticky header (bg-gray-50, 11px uppercase). Sort arrows. Per-column filter. Pagination (25/50/100). Zebra rows. Row hover bg-gray-100. Truncate + tooltip. Loading skeleton rows. Empty state.

---

## §Home

Dashboard layout: greeting + KPI cards (AnimatedCounter, placeholder values ok) + 2x2 tool cards. Tool cards: white bg, 4px colored left border (unique per tool), icon in colored circle, title, description, metadata bullets (input types, avg runtime), "Launch →" link. Hover: translateY(-3) + shadow-lg. Stagger reveal. Trust bar at bottom.

---

## §EntitlementMapping

4 steps: Upload (dual FileUpload) → Preview (mini tables, dedup warning) → Analyze (LoadingOverlay with progress) → Results (4 StatCards + Recharts bar + tabbed DataTable + download). AnimatePresence step transitions.

---

## §FPAnalysis

4 steps: Mode (two GlassCards) → Configure (grouped checkboxes) → Upload (dual FileUpload) → Results (per-sheet summary + donut chart + reduction % counter + download).

---

## §OracleComparator

3 steps: Type (3 cards, "Recommended" badge on Complete) → Upload (dynamic uploaders + env name inputs) → Results (bi-directional match rates + grouped bar chart + tabbed tables + download).

---

## §SODSAAnalysis

4 steps: Type (3 cards) → Upload (2-3 FileUploads) → Analyze (progress with chunk messages) → Results (summary stats + horizontal bar chart top controls + download).

---

## §ErrorHandling

- Network: toast "Unable to connect. Check server is running."
- Upload fail: inline in FileUpload component, not toast.
- Analysis fail: error in results area + "Try Again" + "Start Over".
- Download fail: toast + button resets.
- Stale job (404): "Session expired. Start new analysis." Reset step 0.

---

## §Downloads

Filename: `{ToolName}_{Context}_{YYYYMMDD_HHMMSS}.xlsx`
Flow: click → button loading → GET blob → temp `<a>` → trigger → button success flash (2s) → reset.

---

## §Backend

- Routers: upload → validate → run → status → download → cancel
- File validation order: empty check → extension → size → magic bytes → load → schema → preview
- Job manager: in-memory dict, UUID keys, TTL 1hr, max 20 jobs, cleanup every 5min
- Progress callbacks from engines: specific messages, not generic
- Structured errors: {error: true, message, code, details[]}
