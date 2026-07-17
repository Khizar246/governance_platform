import { useMemo, useState } from 'react'
import { SearchX } from 'lucide-react'
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
  'Role Testing Bot (Beta)': 2,
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
  { id: 'r-1009', analyst: 'Mohd Khizar',   tool: 'Role Testing Bot (Beta)',     project: 'Project Falcon — Abu Dhabi National Energy', date: '2026-06-27', approvedBy: 'Kishlaya Kumar',  revenue: 0,    status: 'Non-billable', files: 12, durationMin: 8.5 },
  { id: 'r-1010', analyst: 'Anu Ansar',     tool: 'Role Testing Bot (Beta)',     project: 'Project Orion — Al Rajhi Banking',          date: '2026-06-25', approvedBy: 'Nitika',         revenue: 0,    status: 'Non-billable', files: 7,  durationMin: 5.1 },
]

// ── Helpers ──────────────────────────────────────────────────────────────────
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_STYLE: Record<RunRecord['status'], { dotCls: string; pillCls: string }> = {
  Billed:         { dotCls: 'bg-green-600', pillCls: 'bg-green-100 text-green-700' },
  'Non-billable': { dotCls: 'bg-amber-600', pillCls: 'bg-amber-100 text-amber-700' },
}

type SortKey = 'date' | 'revenue' | 'tool' | 'project' | 'status'

// ── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div
      className={`flex-1 min-w-[200px] bg-white border rounded-lg px-5 py-[18px] ${accent ? 'border-gold-muted shadow-[0_1px_0_#FFF3CC_inset]' : 'border-slate-200 shadow-none'}`}
    >
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em]">
        {label}
      </div>
      <div className="font-serif text-[28px] font-semibold text-navy mt-2 leading-none">
        {value}
      </div>
      <div className="text-[11.5px] text-slate-400 mt-2">{sub}</div>
    </div>
  )
}

// ── Icons ────────────────────────────────────────────────────────────────────
function IconAdmin({ cls, s }: { cls?: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden className={cls}>
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="6" r="2" fill="#0F1E3D" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15" cy="12" r="2" fill="#0F1E3D" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8" cy="18" r="2" fill="#0F1E3D" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}
function IconZip({ cls, s }: { cls?: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden className={cls}>
      <path d="M12 3v10m0 0l-3.5-3.5M12 13l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
function IconSearch({ cls, s }: { cls?: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden className={cls}>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
function SortArrow({ dir }: { dir: 'asc' | 'desc' | null }) {
  if (!dir) return <span className="text-slate-300 text-[9px] ml-1">▲▼</span>
  return <span className="text-navy text-[9px] ml-1">{dir === 'asc' ? '▲' : '▼'}</span>
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
      const av: string | number = a[sortKey] as string | number
      const bv: string | number = b[sortKey] as string | number
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
      className={`sticky top-0 z-[1] bg-navy text-white px-4 py-[11px] text-[10.5px] font-bold tracking-[0.06em] uppercase whitespace-nowrap select-none ${align === 'right' ? 'text-right' : 'text-left'} ${k ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {label}{k && <SortArrow dir={sortKey === k ? sortDir : null} />}
    </th>
  )

  const selectClass =
    'select-caret py-2 pr-[30px] pl-3 rounded border border-slate-200 bg-white text-[12.5px] text-slate-700 cursor-pointer'

  return (
    <div>
      <PageHeader
        icon={<IconAdmin cls="text-ey-yellow" s={20} />}
        title="Admin Panel"
        subtitle="Tool usage records, project assignments and SOD revenue tracking."
      />

      {/* ── KPI cards ── */}
      <div className="flex gap-[14px] flex-wrap mb-[22px]">
        <KpiCard accent label="Total SOD Revenue" value={kpis.revenue} sub={kpis.revenueSub} />
        <KpiCard label="Analyst Hours Saved" value={`${kpis.hoursSaved} hrs`} sub="vs. manual analysis" />
        <KpiCard label="Total Tool Runs" value={String(kpis.totalRuns)} sub="Across all tools" />
        <KpiCard label="Total Files Processed" value={String(kpis.filesProcessed)} sub="Uploads + outputs" />
        <KpiCard label="Projects Served" value={String(kpis.projects)} sub="Distinct engagements" />
      </div>

      {/* ── Toolbar ── */}
      <div className="flex gap-2.5 flex-wrap items-center mb-[14px]">
        <div className="relative flex-1 min-w-[240px] max-w-[360px]">
          <span className="absolute left-[11px] top-1/2 -translate-y-1/2">
            <IconSearch cls="text-slate-400" s={15} />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search project, employee, approver…"
            className="w-full py-[9px] pr-3 pl-[34px] rounded border border-slate-200 bg-white text-[12.5px] text-slate-700 outline-none"
          />
        </div>
        <select value={toolFilter} onChange={(e) => setToolFilter(e.target.value)} className={selectClass}>
          {tools.map((t) => <option key={t} value={t}>{t === 'All' ? 'All tools' : t}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectClass}>
          {statuses.map((s) => <option key={s} value={s}>{s === 'All' ? 'All statuses' : s}</option>)}
        </select>
        <span className="ml-auto text-xs text-slate-400">
          {rows.length} of {RUNS.length} runs
        </span>
      </div>

      {/* ── Table ── */}
      <div
        className="bg-white border border-slate-200 rounded-lg overflow-hidden"
      >
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full border-collapse text-[12.5px]">
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
                    className={`${i % 2 === 0 ? 'bg-white' : 'bg-surface-page'} border-t border-slate-100`}
                  >
                    <td className="px-4 py-[11px] text-navy font-semibold whitespace-nowrap">{r.analyst}</td>
                    <td className="px-4 py-[11px] text-slate-600 whitespace-nowrap">{r.tool}</td>
                    <td className="px-4 py-[11px] text-slate-700 min-w-[220px]">{r.project}</td>
                    <td className="px-4 py-[11px] text-slate-400 whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="px-4 py-[11px] text-slate-600 whitespace-nowrap">{r.approvedBy}</td>
                    <td className={`px-4 py-[11px] text-right whitespace-nowrap font-semibold ${r.revenue > 0 ? 'text-green-700' : 'text-slate-300'}`}>
                      {r.revenue > 0 ? USD.format(r.revenue) : '—'}
                    </td>
                    <td className="px-4 py-[11px] whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full text-[11px] font-semibold ${st.pillCls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${st.dotCls}`} />
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-[11px] text-right whitespace-nowrap">
                      <a
                        href={`/api/admin/runs/${r.id}/download-zip`}
                        download={`run-${r.id}.zip`}
                        title={`Download ${r.files} file(s) as ZIP`}
                        className="inline-flex items-center gap-1.5 px-[11px] py-1.5 rounded-[7px] border border-slate-200 bg-white text-navy text-[11.5px] font-semibold no-underline transition-all [transition-duration:130ms] hover:bg-navy hover:text-ey-yellow hover:border-navy"
                      >
                        <IconZip s={14} /> ZIP
                      </a>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <SearchX size={32} strokeWidth={1.5} className="text-slate-300" />
                      <div className="space-y-1">
                        <p className="text-[13px] font-medium text-slate-500">No runs match your filters</p>
                        <p className="text-xs text-slate-400">Adjust the search text or the tool/status filters above</p>
                      </div>
                      <button
                        onClick={() => { setSearch(''); setToolFilter('All'); setStatusFilter('All') }}
                        className="text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-300 hover:border-slate-400 bg-white px-3 py-1.5 rounded transition-colors duration-150"
                      >
                        Clear search &amp; filters
                      </button>
                    </div>
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
