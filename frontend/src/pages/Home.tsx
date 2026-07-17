import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, ChevronRight, Clock, DollarSign, Download, Users } from 'lucide-react'
import { toPng } from 'html-to-image'
import { toast } from 'sonner'
import { ROUTES } from '../utils/constants'

// ── Palette (chart series colors validated: CVD ΔE ≥ 12, contrast ≥ 3:1 on white) ──
// Hex constants are kept only where SVG attributes / component props need them.
const NAVY = '#0F1E3D'
const SEC = '#64748B'
const TER = '#94A3B8'
const GOLD_DEEP = '#E8A900'
const GREEN = '#16A34A'

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconRuleset({ cls, s }: { cls: string; s: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden className={cls}><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6"/><path d="M17.5 14v7M14 17.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
}
function IconOracle({ cls, s }: { cls: string; s: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden className={cls}><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6"/><path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
}
function IconSod({ cls, s }: { cls: string; s: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden className={cls}><path d="M12 3l9 4.5v5c0 5-3.6 9.7-9 11-5.4-1.3-9-6-9-11V7.5L12 3z" stroke="currentColor" strokeWidth="1.6"/><path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function IconBot({ cls, s }: { cls: string; s: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden className={cls}><rect x="4" y="8" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.6"/><path d="M12 4v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="12" cy="3.5" r="1.3" stroke="currentColor" strokeWidth="1.6"/><circle cx="9" cy="13" r="1.2" fill="currentColor"/><circle cx="15" cy="13" r="1.2" fill="currentColor"/></svg>
}

// ── Sample data (static; realistic monthly volumes) ──────────────────────────
const MONTHS = ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul']

const TOOLS = [
  {
    route: ROUTES.SOD_SA, name: 'SOD & SA Analysis', color: '#D97706',
    bgCls: 'bg-amber-600', textCls: 'text-amber-600', tintCls: 'bg-amber-600/10',
    icon: IconSod, runs: [7, 9, 8, 11, 6, 9, 10, 12, 9, 11, 10, 12],
    hoursPerRun: 16, lastRun: '2 h ago', status: 'operational' as const,
  },
  {
    route: ROUTES.RULESET_MAPPING, name: 'Ruleset Mapping', color: '#7C3AED',
    bgCls: 'bg-violet-600', textCls: 'text-violet-600', tintCls: 'bg-violet-600/10',
    icon: IconRuleset, runs: [6, 8, 7, 9, 8, 5, 7, 9, 8, 6, 9, 8],
    hoursPerRun: 12, lastRun: '5 h ago', status: 'operational' as const,
  },
  {
    route: ROUTES.ORACLE_COMPARATOR, name: 'Oracle Role Comparison', color: '#16A34A',
    bgCls: 'bg-green-600', textCls: 'text-green-600', tintCls: 'bg-green-600/10',
    icon: IconOracle, runs: [2, 0, 3, 1, 0, 2, 4, 1, 0, 2, 1, 2],
    hoursPerRun: 8, lastRun: 'Yesterday', status: 'operational' as const,
  },
  {
    route: ROUTES.ROLE_TESTING, name: 'Role Testing Bot', color: '#2563EB',
    bgCls: 'bg-blue-600', textCls: 'text-blue-600', tintCls: 'bg-blue-600/10',
    icon: IconBot, runs: [0, 0, 0, 2, 4, 3, 5, 6, 4, 5, 6, 5],
    hoursPerRun: 4, lastRun: 'Yesterday', status: 'beta' as const,
  },
]

const MONTHLY_TOTALS = MONTHS.map((_, i) => TOOLS.reduce((sum, t) => sum + t.runs[i], 0))
const MONTHLY_HOURS = MONTHS.map((_, i) => TOOLS.reduce((sum, t) => sum + t.runs[i] * t.hoursPerRun, 0))
const CLIENTS_SPARK = [14, 15, 15, 16, 15, 16, 17, 16, 17, 18, 17, 18]
const REVENUE_SPARK = [310, 325, 318, 340, 332, 348, 355, 370, 362, 381, 390, 420]

const STATUS_BADGE = {
  operational: { label: 'Operational', cls: 'bg-green-100 text-green-700' },
  beta: { label: 'Beta', cls: 'bg-blue-100 text-blue-700' },
  degraded: { label: 'Degraded', cls: 'bg-amber-100 text-amber-700' },
}

// shadow-card matches the old inline boxShadow exactly (see tailwind.config.ts)
const CARD_CLASS = 'bg-white border border-slate-200 rounded-lg shadow-card'

function CardTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 className="text-[13.5px] font-semibold text-slate-900">{title}</h2>
      {sub && <p className="text-[11.5px] text-slate-500 mt-px">{sub}</p>}
    </div>
  )
}

// ── Chart pieces ──────────────────────────────────────────────────────────────
function Sparkline({ data, color, w = 70, h = 24 }: { data: number[]; color: string; w?: number; h?: number }) {
  const min = Math.min(...data)
  const range = Math.max(...data) - min || 1
  const px = (i: number) => 3 + (i / (data.length - 1)) * (w - 9)
  const py = (v: number) => 3 + (1 - (v - min) / range) * (h - 9)
  const pts = data.map((v, i) => `${px(i)},${py(v)}`)
  const area = `M${px(0)},${h - 2} L${pts.join(' L')} L${px(data.length - 1)},${h - 2} Z`
  return (
    <svg width={w} height={h} aria-hidden>
      <path d={area} fill={color} opacity={0.08} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={px(data.length - 1)} cy={py(data[data.length - 1])} r={2.5} fill={color} stroke="#FFFFFF" strokeWidth={1.4} />
    </svg>
  )
}

function ToolUsageChart({ months, series, height = 152 }: { months: string[]; series: { name: string; color: string; bgCls: string; data: number[] }[]; height?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(420)
  const [hover, setHover] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const H = height
  const padL = 26, padR = 12, padT = 8, padB = 20
  const innerW = Math.max(w - padL - padR, 100)
  const innerH = H - padT - padB
  const yMax = 12
  const ticks = [0, 4, 8, 12]
  const n = months.length
  const xOf = (i: number) => padL + (i / (n - 1)) * innerW
  const yOf = (v: number) => padT + innerH - (v / yMax) * innerH
  const labelEvery = innerW / (n - 1) < 40 ? 2 : 1

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ix = Math.round((e.clientX - rect.left - padL) / (innerW / (n - 1)))
    setHover(Math.min(Math.max(ix, 0), n - 1))
  }

  return (
    <div ref={wrapRef} className="relative">
      <svg width={w} height={H} role="img" aria-label="Runs per month by tool" className="block"
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={padL + innerW} y1={yOf(t)} y2={yOf(t)} stroke="#F1F5F9" strokeWidth={1} />
            <text x={padL - 7} y={yOf(t) + 3.5} textAnchor="end" fontSize={10} fill={TER}>{t}</text>
          </g>
        ))}
        {months.map((m, i) => (
          i % labelEvery === 0
            ? <text key={m} x={xOf(i)} y={H - 6} textAnchor="middle" fontSize={10} fill={TER}>{m}</text>
            : null
        ))}
        {hover !== null && (
          <line x1={xOf(hover)} x2={xOf(hover)} y1={padT} y2={padT + innerH} stroke="#CBD5E1" strokeWidth={1} />
        )}
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round"
            points={s.data.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' ')} />
        ))}
        {series.map((s) => {
          const i = hover ?? n - 1
          return <circle key={s.name} cx={xOf(i)} cy={yOf(s.data[i])} r={3.5} fill={s.color} stroke="#FFFFFF" strokeWidth={2} />
        })}
      </svg>
      {hover !== null && (
        <div
          className="absolute top-0.5 pointer-events-none left-[var(--tt-left)] -translate-x-1/2 bg-white border border-slate-200 rounded px-[9px] py-[7px] shadow-lg min-w-[186px]"
          style={{ '--tt-left': `${Math.min(Math.max(xOf(hover), 105), w - 105)}px` } as React.CSSProperties}
        >
          <div className="text-[10.5px] font-semibold text-slate-500 mb-1">{months[hover]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${s.bgCls}`} />
              <span className="text-[11px] text-slate-700 flex-1">{s.name}</span>
              <span className="text-[11px] font-semibold text-slate-900 tabular-nums">{s.data[hover]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function HoursDonut({ items, total }: { items: { name: string; color: string; bgCls: string; hours: number }[]; total: number }) {
  const [active, setActive] = useState<number | null>(null)
  const size = 110, stroke = 17
  const r = (size - stroke) / 2
  const cx = size / 2, cy = size / 2
  const gap = 0.05 // rad — surface gap between slices

  const arcs = useMemo(() => {
    let acc = -Math.PI / 2
    return items.map((it) => {
      const sweep = (it.hours / total) * Math.PI * 2
      const a0 = acc + gap / 2
      const a1 = acc + sweep - gap / 2
      acc += sweep
      const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)]
      const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)]
      return { d: `M ${p0[0]} ${p0[1]} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p1[0]} ${p1[1]}` }
    })
  }, [items, total, cx, cy, r])

  return (
    <div className="flex flex-col items-center gap-2.5 flex-1 justify-center">
      <div className="relative w-[110px] h-[110px]">
        <svg width={size} height={size} role="img" aria-label="Hours saved per tool">
          {arcs.map((a, i) => (
            <path key={items[i].name} d={a.d} fill="none" stroke={items[i].color} strokeWidth={stroke}
              opacity={active === null || active === i ? 1 : 0.35} className="transition-opacity duration-150"
              onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="font-serif text-[19px] font-semibold text-navy leading-none tabular-nums">
            {total.toLocaleString()}
          </span>
          <span className="text-[8.5px] font-semibold text-slate-400 tracking-[0.08em] mt-0.5">HRS</span>
        </div>
      </div>
      <div className="flex flex-col gap-2 w-full">
        {items.map((it, i) => (
          <div key={it.name} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
            className={`flex items-center gap-1.5 transition-opacity duration-150 ${active === null || active === i ? 'opacity-100' : 'opacity-[0.45]'}`}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${it.bgCls}`} />
            <span className="text-[11px] text-slate-700 flex-1 min-w-0 truncate">{it.name}</span>
            <span className="text-[11.5px] font-semibold text-slate-900 tabular-nums">{it.hours.toLocaleString()}h</span>
            <span className="text-[10px] text-slate-400 w-[26px] text-right tabular-nums">
              {Math.round((it.hours / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MostUsedBars({ items }: { items: { name: string; bgCls: string; runs: number }[] }) {
  const sorted = [...items].sort((a, b) => b.runs - a.runs)
  const max = Math.max(...sorted.map((it) => it.runs), 1)
  return (
    <div className="flex-1 flex flex-col justify-evenly mt-1">
      {sorted.map((it) => (
        <div key={it.name} className="grid [grid-template-columns:156px_minmax(0,1fr)_34px] items-center gap-2.5">
          <span className="text-[12.5px] text-slate-700 truncate">{it.name}</span>
          <div className="h-[14px] bg-slate-100 rounded-full">
            <div
              className={`h-full rounded-full min-w-[14px] w-[var(--w)] ${it.bgCls}`}
              style={{ '--w': `${(it.runs / max) * 100}%` } as React.CSSProperties}
            />
          </div>
          <span className="text-[13px] font-semibold text-slate-900 text-right tabular-nums">{it.runs}</span>
        </div>
      ))}
    </div>
  )
}

function Meter({ label, value, pct, fillCls, trackCls }: { label: string; value: string; pct: number; fillCls: string; trackCls: string }) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-[11.5px] text-slate-700">{label}</span>
        <span className="text-[11.5px] font-semibold text-slate-900 tabular-nums">{value}</span>
      </div>
      <div className={`h-1.5 rounded-[3px] ${trackCls}`}>
        <div
          className={`h-full rounded-[3px] w-[var(--w)] ${fillCls}`}
          style={{ '--w': `${pct}%` } as React.CSSProperties}
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Home() {
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState<'6M' | '12M'>('6M')
  const [hovHealth, setHovHealth] = useState<string | null>(null)

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  // Everything below derives from the selected window so all cards stay consistent
  const from = range === '6M' ? 6 : 0
  const periodLabel = range === '6M' ? 'last 6 months' : 'last 12 months'
  const monthsView = MONTHS.slice(from)
  const seriesView = TOOLS.map((t) => ({ name: t.name, color: t.color, bgCls: t.bgCls, data: t.runs.slice(from) }))
  const windowRuns = TOOLS.map((t) => t.runs.slice(from).reduce((a, b) => a + b, 0))
  const windowHours = TOOLS.map((t, i) => windowRuns[i] * t.hoursPerRun)
  const totalRuns = windowRuns.reduce((a, b) => a + b, 0)
  const totalHours = windowHours.reduce((a, b) => a + b, 0)
  const platformHours = Math.round(totalRuns * 0.6)
  const manualHours = totalHours + platformHours
  const effortCut = Math.round((1 - platformHours / manualHours) * 100)
  const workWeeks = Math.round(totalHours / 40)
  const donutItems = TOOLS.map((t, i) => ({ name: t.name, color: t.color, bgCls: t.bgCls, hours: windowHours[i] }))
  const barItems = TOOLS.map((t, i) => ({ name: t.name, bgCls: t.bgCls, runs: windowRuns[i] }))
  const toolsByUsage = TOOLS.map((t, i) => ({ t, runs: windowRuns[i] })).sort((a, b) => b.runs - a.runs).map((x) => x.t)

  const kpis = [
    { label: 'Total runs', value: totalRuns.toLocaleString(), unit: '', delta: '+4%', icon: Activity, accent: NAVY, textCls: 'text-navy', tintCls: 'bg-navy/10', spark: MONTHLY_TOTALS.slice(from) },
    { label: 'Hours saved', value: totalHours.toLocaleString(), unit: 'h', delta: '+8%', icon: Clock, accent: GREEN, textCls: 'text-green-600', tintCls: 'bg-green-600/10', spark: MONTHLY_HOURS.slice(from) },
    { label: 'Clients served', value: '18', unit: '', delta: '+6%', icon: Users, accent: NAVY, textCls: 'text-navy', tintCls: 'bg-navy/10', spark: CLIENTS_SPARK.slice(from) },
    { label: 'Revenue earned', value: '$420', unit: 'K', delta: '+8%', icon: DollarSign, accent: GOLD_DEEP, textCls: 'text-ey-yellow-hover', tintCls: 'bg-ey-yellow-hover/10', spark: REVENUE_SPARK.slice(from) },
  ]

  const exportReport = async () => {
    const node = rootRef.current
    if (!node) return
    try {
      const dataUrl = await toPng(node, { pixelRatio: 2, backgroundColor: '#F7F6F3' })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = 'governance-dashboard.png'
      a.click()
    } catch {
      toast.error('Could not export the dashboard image')
    }
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-[11px]">

      {/* ── Greeting + controls ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-[20px] font-semibold text-navy leading-[1.2]">
            {greeting}, Mohd Khizar
          </h1>
          <p className="text-[11.5px] text-slate-500 mt-0.5">
            {today} · <span className="text-green-600 font-medium">● All systems operational</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-surface-panel rounded p-[3px]">
            {(['6M', '12M'] as const).map((r) => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-3 py-1 rounded-[6px] text-[12px] font-semibold cursor-pointer border transition-all duration-150 ${
                  range === r
                    ? 'border-slate-200 bg-white text-slate-900 shadow-[0_1px_2px_rgba(0,0,0,0.05)]'
                    : 'border-transparent bg-transparent text-slate-500 shadow-none'
                }`}>
                {r}
              </button>
            ))}
          </div>
          <button onClick={exportReport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12.5px] font-medium cursor-pointer bg-white text-slate-700 border border-slate-200 transition-colors duration-150 hover:bg-slate-50">
            <Download size={13} strokeWidth={2} /> Export report
          </button>
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-4 gap-[11px]">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className={`${CARD_CLASS} px-[15px] py-[13px]`}>
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-[0.08em]">
                  {k.label}
                </span>
                <div className={`w-6 h-6 rounded-[7px] flex items-center justify-center ${k.tintCls}`}>
                  <Icon size={13} className={k.textCls} strokeWidth={2} />
                </div>
              </div>
              <div className="mt-2">
                <span className="font-serif text-[27px] font-semibold text-navy leading-none tabular-nums">
                  {k.value}
                </span>
                {k.unit && (
                  <span className="font-serif text-[16px] font-semibold text-slate-500 ml-0.5">{k.unit}</span>
                )}
              </div>
              <div className="flex items-end justify-between gap-2 mt-2">
                <span className="text-[10.5px] text-slate-500 whitespace-nowrap">
                  <span className="font-semibold text-green-600">▲ {k.delta}</span> vs last month
                </span>
                <Sparkline data={k.spark} color={k.accent} />
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Usage, hours saved, automation ── */}
      <div className="grid grid-cols-4 gap-[11px]">
        <div className={`${CARD_CLASS} p-4 col-span-2 flex flex-col`}>
          <CardTitle title="Tool usage over time" sub={`Runs per month · ${periodLabel}`} />
          <div className="mt-2.5 flex-1">
            <ToolUsageChart months={monthsView} series={seriesView} height={176} />
          </div>
          <div className="flex items-center justify-center gap-[14px] flex-wrap mt-2">
            {TOOLS.map((t) => (
              <span key={t.name} className="inline-flex items-center gap-[5px] text-[11.5px] text-slate-700">
                <span className={`w-2 h-2 rounded-full ${t.bgCls}`} />
                {t.name}
              </span>
            ))}
          </div>
        </div>

        <div className={`${CARD_CLASS} p-4 flex flex-col`}>
          <CardTitle title="Hours saved per tool" sub={`Analyst effort reclaimed · ${periodLabel}`} />
          <HoursDonut items={donutItems} total={totalHours} />
        </div>

        <div className={`${CARD_CLASS} p-4 flex flex-col`}>
          <CardTitle title="Automation impact" sub={`Across all four tools · ${periodLabel}`} />
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="font-serif text-[29px] font-semibold text-navy leading-none tabular-nums">
              {totalHours.toLocaleString()}<span className="text-[17px] text-slate-500"> h</span>
            </span>
            <span className="text-[10.5px] font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
              {effortCut}% less effort
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-[5px]">
            Saved — about {workWeeks} analyst work-weeks.
          </p>
          <div className="flex flex-col gap-3 mt-3 flex-1 justify-center">
            <Meter label="Done by hand" value={`${manualHours.toLocaleString()} h`} pct={100} fillCls="bg-slate-400" trackCls="bg-slate-100" />
            <Meter label="With the platform" value={`${platformHours.toLocaleString()} h`} pct={Math.max((platformHours / manualHours) * 100, 3)} fillCls="bg-ey-yellow-hover" trackCls="bg-gold-light" />
          </div>
          <div className="border-t border-slate-100 pt-2.5 mt-2.5 flex justify-between gap-2">
            <span className="text-[10.5px] text-slate-500">{totalRuns} runs</span>
            <span className="text-[10.5px] text-slate-500 tabular-nums">
              ≈ {(totalHours / totalRuns).toFixed(1)} h saved per run
            </span>
          </div>
        </div>
      </div>

      {/* ── Most used + tool health ── */}
      <div className="grid grid-cols-2 gap-[11px]">
        <div className={`${CARD_CLASS} p-4 flex flex-col`}>
          <CardTitle title="Most used tools" sub={`Total runs · ${periodLabel}`} />
          <MostUsedBars items={barItems} />
        </div>

        <div className={`${CARD_CLASS} p-3`}>
          <div className="pt-1 px-2 pb-1.5">
            <CardTitle title="Tool health" sub="Engine status & last activity" />
          </div>
          <div className="flex flex-col gap-1">
            {toolsByUsage.map((t) => {
              const Icon = t.icon
              const badge = STATUS_BADGE[t.status]
              const isH = hovHealth === t.route
              return (
                <div key={t.route} onClick={() => navigate(t.route)}
                  onMouseEnter={() => setHovHealth(t.route)} onMouseLeave={() => setHovHealth(null)}
                  role="link" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(t.route) }}
                  className={`flex items-center gap-2.5 px-2 py-[5px] rounded cursor-pointer transition-colors duration-150 ${isH ? 'bg-slate-50' : 'bg-transparent'}`}>
                  <div className={`w-[26px] h-[26px] rounded-[7px] flex items-center justify-center shrink-0 ${t.tintCls}`}>
                    <Icon cls={t.textCls} s={13} />
                  </div>
                  <span className="text-[12.5px] text-slate-900 flex-1 min-w-0 truncate">
                    {t.name}
                  </span>
                  <span className="text-[11px] text-slate-500 whitespace-nowrap">Last run {t.lastRun}</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold shrink-0 ${badge.cls}`}>
                    ● {badge.label}
                  </span>
                  <ChevronRight size={13} color={isH ? SEC : '#CBD5E1'} className="shrink-0 transition-colors duration-150" />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
