import { useMemo, useState } from 'react'
import PageHeader from '../components/layout/PageHeader'

// ── Data model ───────────────────────────────────────────────────────────────
interface RunRecord {
  id: string
  analyst: string
  tool: string
  project: string
  date: string        // ISO yyyy-mm-dd for sorting
  approvedBy: string
  revenue: number     // 0 = non-billable
  status: 'Billed' | 'Non-billable'
  files: number       // # files involved (uploads + output)
  durationMin: number // processing time, minutes
}

// Manual hours each tool run saves vs. doing the analysis by hand.
const HOURS_SAVED_BY_TOOL: Record<string, number> = {
  'SOD & SA Analysis': 9,
  'SOD & SA Analysis (with FP)': 18,
  'Ruleset Mapping': 5,
  'Oracle Comparator': 3,
}

const RUNS: RunRecord[] = [
  { id: 'r-1001', analyst: 'Mohd Khizar',   tool: 'SOD & SA Analysis (with FP)', project: 'Project Falcon — Abu Dhabi National Energy', date: '2026-05-03', approvedBy: 'Kishlaya Kumar',  revenue: 4200, status: 'Billed',       files: 3, durationMin: 6.2 },
  { id: 'r-1002', analyst: 'Anu Ansar',     tool: 'SOD & SA Analysis',           project: 'Project Orion — Al Rajhi Banking',          date: '2026-04-28', approvedBy: 'Nitika',         revenue: 3800, status: 'Billed',       files: 3, durationMin: 5.4 },
  { id: 'r-1003', analyst: 'Lakshay Yadav', tool: 'Ruleset Mapping',             project: 'Project Falcon — Abu Dhabi National Energy', date: '2026-04-25', approvedBy: 'Rashika Angrula', revenue: 0,    status: 'Non-billable', files: 2, durationMin: 2.1 },
  { id: 'r-1004', analyst: 'Shambhavi',     tool: 'Oracle Comparator',           project: 'Project Orion — Al Rajhi Banking',          date: '2026-04-22', approvedBy: 'Nitika',         revenue: 0,    status: 'Non-billable', files: 2, durationMin: 1.8 },
  { id: 'r-1005', analyst: 'Mohd Khizar',   tool: 'SOD & SA Analysis (with FP)', project: 'Project Meridian — DEWA',                   date: '2026-04-18', approvedBy: 'Kishlaya Kumar',  revenue: 5100, status: 'Billed',       files: 4, durationMin: 7.9 },
  { id: 'r-1006', analyst: 'Anu Ansar',     tool: 'Oracle Comparator',           project: 'Project Meridian — DEWA',                   date: '2026-04-15', approvedBy: 'Rashika Angrula', revenue: 0,    status: 'Non-billable', files: 2, durationMin: 3.3 },
  { id: 'r-1007', analyst: 'Lakshay Yadav', tool: 'SOD & SA Analysis',           project: 'Project Atlas — Emirates NBD',              date: '2026-04-11', approvedBy: 'Nitika',         revenue: 2700, status: 'Billed',       files: 3, durationMin: 6.7 },
  { id: 'r-1008', analyst: 'Shambhavi',     tool: 'Ruleset Mapping',             project: 'Project Atlas — Emirates NBD',              date: '2026-04-08', approvedBy: 'Kishlaya Kumar',  revenue: 0,    status: 'Non-billable', files: 2, durationMin: 4.0 },
]

// ── Helpers ──────────────────────────────────────────────────────────────────
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_STYLE: Record<RunRecord['status'], { dot: string; bg: string; color: string }> = {
  Billed:         { dot: '#16A34A', bg: '#DCFCE7', color: '#15803D' },
  'Non-billable': { dot: '#D97706', bg: '#FEF3C7', color: '#B45309' },
}

type SortKey = 'date' | 'revenue' | 'tool' | 'project' | 'status'

// ── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 200,
        background: '#FFFFFF',
        border: accent ? '1px solid #E8C84D' : '1px solid #E2E8F0',
        borderRadius: 12,
        padding: '18px 20px',
        boxShadow: accent ? '0 1px 0 #FFF3CC inset' : 'none',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {label}
      </div>
      <div style={{ fontFamily: "'Lora', serif", fontSize: 28, fontWeight: 600, color: '#0F1E3D', marginTop: 8, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 8 }}>{sub}</div>
    </div>
  )
}

// ── Icons ────────────────────────────────────────────────────────────────────
function IconAdmin({ c, s }: { c: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h16" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="6" r="2" fill="#0F1E3D" stroke={c} strokeWidth="1.6" />
      <circle cx="15" cy="12" r="2" fill="#0F1E3D" stroke={c} strokeWidth="1.6" />
      <circle cx="8" cy="18" r="2" fill="#0F1E3D" stroke={c} strokeWidth="1.6" />
    </svg>
  )
}
function IconZip({ c, s }: { c: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v10m0 0l-3.5-3.5M12 13l3.5-3.5" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
function IconSearch({ c, s }: { c: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke={c} strokeWidth="1.6" />
      <path d="M20 20l-3.5-3.5" stroke={c} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
function SortArrow({ dir }: { dir: 'asc' | 'desc' | null }) {
  if (!dir) return <span style={{ color: '#CBD5E1', fontSize: 9, marginLeft: 4 }}>▲▼</span>
  return <span style={{ color: '#0F1E3D', fontSize: 9, marginLeft: 4 }}>{dir === 'asc' ? '▲' : '▼'}</span>
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function AdminPanel() {
  const [search, setSearch] = useState('')
  const [toolFilter, setToolFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const tools = useMemo(() => ['All', ...Array.from(new Set(RUNS.map((r) => r.tool)))], [])
  const statuses = ['All', 'Billed', 'Non-billable']

  // KPIs (revenue-focused, like the reference screenshot)
  const kpis = useMemo(() => {
    const billed = RUNS.filter((r) => r.status === 'Billed')
    const revenue = billed.reduce((s, r) => s + r.revenue, 0)
    const billedProjects = new Set(billed.map((r) => r.project)).size
    const filesProcessed = RUNS.reduce((s, r) => s + r.files, 0)
    const projects = new Set(RUNS.map((r) => r.project)).size
    const hoursSaved = RUNS.reduce((s, r) => s + (HOURS_SAVED_BY_TOOL[r.tool] ?? 0), 0)
    return {
      revenue: USD.format(revenue),
      revenueSub: `${billedProjects} billed project${billedProjects === 1 ? '' : 's'}`,
      totalRuns: RUNS.length,
      filesProcessed,
      projects,
      hoursSaved,
    }
  }, [])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = RUNS.filter((r) => {
      if (toolFilter !== 'All' && r.tool !== toolFilter) return false
      if (statusFilter !== 'All' && r.status !== statusFilter) return false
      if (q && !(`${r.analyst} ${r.tool} ${r.project} ${r.approvedBy}`.toLowerCase().includes(q))) return false
      return true
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      let av: string | number = a[sortKey] as string | number
      let bv: string | number = b[sortKey] as string | number
      if (sortKey === 'revenue') { av = a.revenue; bv = b.revenue }
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [search, toolFilter, statusFilter, sortKey, sortDir])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir(k === 'date' || k === 'revenue' ? 'desc' : 'asc') }
  }

  const TH = ({ label, k, align = 'left' }: { label: string; k?: SortKey; align?: 'left' | 'right' }) => (
    <th
      onClick={k ? () => toggleSort(k) : undefined}
      style={{
        position: 'sticky', top: 0, zIndex: 1,
        background: '#0F1E3D', color: '#FFFFFF',
        textAlign: align, padding: '11px 16px',
        fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
        whiteSpace: 'nowrap', cursor: k ? 'pointer' : 'default', userSelect: 'none',
      }}
    >
      {label}{k && <SortArrow dir={sortKey === k ? sortDir : null} />}
    </th>
  )

  const selectStyle: React.CSSProperties = {
    appearance: 'none',
    padding: '8px 30px 8px 12px',
    borderRadius: 8, border: '1px solid #E2E8F0', background: '#FFFFFF',
    fontSize: 12.5, color: '#334155', cursor: 'pointer',
    backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2364748B\' stroke-width=\'2\'><path d=\'M6 9l6 6 6-6\'/></svg>")',
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
  }

  return (
    <div>
      <PageHeader
        icon={<IconAdmin c="#FFD100" s={20} />}
        title="Admin Panel"
        subtitle="Tool usage records, project assignments and SOD revenue tracking."
      />

      {/* ── KPI cards ── */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
        <KpiCard accent label="Total SOD Revenue" value={kpis.revenue} sub={kpis.revenueSub} />
        <KpiCard label="Analyst Hours Saved" value={`${kpis.hoursSaved} hrs`} sub="vs. manual analysis" />
        <KpiCard label="Total Tool Runs" value={String(kpis.totalRuns)} sub="Across all tools" />
        <KpiCard label="Total Files Processed" value={String(kpis.filesProcessed)} sub="Uploads + outputs" />
        <KpiCard label="Projects Served" value={String(kpis.projects)} sub="Distinct engagements" />
      </div>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 240, maxWidth: 360 }}>
          <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }}>
            <IconSearch c="#94A3B8" s={15} />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search project, employee, approver…"
            style={{
              width: '100%', padding: '9px 12px 9px 34px',
              borderRadius: 8, border: '1px solid #E2E8F0', background: '#FFFFFF',
              fontSize: 12.5, color: '#334155', outline: 'none',
            }}
          />
        </div>
        <select value={toolFilter} onChange={(e) => setToolFilter(e.target.value)} style={selectStyle}>
          {tools.map((t) => <option key={t} value={t}>{t === 'All' ? 'All tools' : t}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
          {statuses.map((s) => <option key={s} value={s}>{s === 'All' ? 'All statuses' : s}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94A3B8' }}>
          {rows.length} of {RUNS.length} runs
        </span>
      </div>

      {/* ── Table ── */}
      <div
        style={{
          background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden',
        }}
      >
        <div style={{ maxHeight: 520, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                <TH label="Employee" />
                <TH label="Tool Used" k="tool" />
                <TH label="Project" k="project" />
                <TH label="Date" k="date" />
                <TH label="Approved By" />
                <TH label="SOD Revenue" k="revenue" align="right" />
                <TH label="Status" k="status" />
                <TH label="Result" align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const st = STATUS_STYLE[r.status]
                return (
                  <tr
                    key={r.id}
                    style={{ background: i % 2 === 0 ? '#FFFFFF' : '#FAF9F6', borderTop: '1px solid #EEF1F5' }}
                  >
                    <td style={{ padding: '11px 16px', color: '#0F1E3D', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.analyst}</td>
                    <td style={{ padding: '11px 16px', color: '#475569', whiteSpace: 'nowrap' }}>{r.tool}</td>
                    <td style={{ padding: '11px 16px', color: '#334155', minWidth: 220 }}>{r.project}</td>
                    <td style={{ padding: '11px 16px', color: '#94A3B8', whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                    <td style={{ padding: '11px 16px', color: '#475569', whiteSpace: 'nowrap' }}>{r.approvedBy}</td>
                    <td style={{ padding: '11px 16px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: r.revenue > 0 ? '#15803D' : '#CBD5E1' }}>
                      {r.revenue > 0 ? USD.format(r.revenue) : '—'}
                    </td>
                    <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: st.bg, color: st.color, fontSize: 11, fontWeight: 600 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.dot }} />
                        {r.status}
                      </span>
                    </td>
                    <td style={{ padding: '11px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <a
                        href={`/api/admin/runs/${r.id}/download-zip`}
                        download={`run-${r.id}.zip`}
                        title={`Download ${r.files} file(s) as ZIP`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '6px 11px', borderRadius: 7,
                          border: '1px solid #E2E8F0', background: '#FFFFFF',
                          color: '#0F1E3D', fontSize: 11.5, fontWeight: 600, textDecoration: 'none',
                          transition: 'all 0.13s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#0F1E3D'; e.currentTarget.style.color = '#FFD100'; e.currentTarget.style.borderColor = '#0F1E3D' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = '#FFFFFF'; e.currentTarget.style.color = '#0F1E3D'; e.currentTarget.style.borderColor = '#E2E8F0' }}
                      >
                        <IconZip c="currentColor" s={14} /> ZIP
                      </a>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: '40px 16px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
                    No runs match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
