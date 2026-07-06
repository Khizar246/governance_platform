import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, ChevronRight, Clock, DollarSign, Download, Users } from 'lucide-react'
import { toPng } from 'html-to-image'
import { toast } from 'sonner'
import { ROUTES } from '../utils/constants'

// ── Palette (chart series colors validated: CVD ΔE ≥ 12, contrast ≥ 3:1 on white) ──
const NAVY = '#0F1E3D'
const INK = '#0F172A'
const SEC = '#64748B'
const TER = '#94A3B8'
const BORDER = '#E2E8F0'
const GOLD_DEEP = '#E8A900'
const GREEN = '#16A34A'

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconRuleset({ c, s }: { c: string; s: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden><rect x="3" y="3" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.6"/><path d="M17.5 14v7M14 17.5h7" stroke={c} strokeWidth="1.6" strokeLinecap="round"/></svg>
}
function IconOracle({ c, s }: { c: string; s: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="11" cy="11" r="7" stroke={c} strokeWidth="1.6"/><path d="M20 20l-3.5-3.5" stroke={c} strokeWidth="2" strokeLinecap="round"/></svg>
}
function IconSod({ c, s }: { c: string; s: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 3l9 4.5v5c0 5-3.6 9.7-9 11-5.4-1.3-9-6-9-11V7.5L12 3z" stroke={c} strokeWidth="1.6"/><path d="M9 12l2 2 4-4" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function IconBot({ c, s }: { c: string; s: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden><rect x="4" y="8" width="16" height="11" rx="2.5" stroke={c} strokeWidth="1.6"/><path d="M12 4v4" stroke={c} strokeWidth="1.6" strokeLinecap="round"/><circle cx="12" cy="3.5" r="1.3" stroke={c} strokeWidth="1.6"/><circle cx="9" cy="13" r="1.2" fill={c}/><circle cx="15" cy="13" r="1.2" fill={c}/></svg>
}

// ── Sample data (static; realistic monthly volumes) ──────────────────────────
const MONTHS = ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul']

const TOOLS = [
  {
    route: ROUTES.SOD_SA, name: 'SOD & SA Analysis', color: '#D97706',
    icon: IconSod, runs: [7, 9, 8, 11, 6, 9, 10, 12, 9, 11, 10, 12],
    hoursPerRun: 16, lastRun: '2 h ago', status: 'operational' as const,
  },
  {
    route: ROUTES.RULESET_MAPPING, name: 'Ruleset Mapping', color: '#7C3AED',
    icon: IconRuleset, runs: [6, 8, 7, 9, 8, 5, 7, 9, 8, 6, 9, 8],
    hoursPerRun: 12, lastRun: '5 h ago', status: 'operational' as const,
  },
  {
    route: ROUTES.ORACLE_COMPARATOR, name: 'Oracle Role Comparison', color: '#16A34A',
    icon: IconOracle, runs: [2, 0, 3, 1, 0, 2, 4, 1, 0, 2, 1, 2],
    hoursPerRun: 8, lastRun: 'Yesterday', status: 'operational' as const,
  },
  {
    route: ROUTES.ROLE_TESTING, name: 'Role Testing Bot', color: '#0284C7',
    icon: IconBot, runs: [0, 0, 0, 2, 4, 3, 5, 6, 4, 5, 6, 5],
    hoursPerRun: 4, lastRun: 'Yesterday', status: 'beta' as const,
  },
]

const MONTHLY_TOTALS = MONTHS.map((_, i) => TOOLS.reduce((sum, t) => sum + t.runs[i], 0))
const MONTHLY_HOURS = MONTHS.map((_, i) => TOOLS.reduce((sum, t) => sum + t.runs[i] * t.hoursPerRun, 0))
const CLIENTS_SPARK = [14, 15, 15, 16, 15, 16, 17, 16, 17, 18, 17, 18]
const REVENUE_SPARK = [310, 325, 318, 340, 332, 348, 355, 370, 362, 381, 390, 420]

const STATUS_BADGE = {
  operational: { label: 'Operational', bg: '#DCFCE7', color: '#15803D' },
  beta: { label: 'Beta', bg: '#E0F2FE', color: '#0369A1' },
  degraded: { label: 'Degraded', bg: '#FEF3C7', color: '#B45309' },
}

const CARD: React.CSSProperties = {
  background: '#FFFFFF',
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
}

function CardTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{title}</h2>
      {sub && <p style={{ fontSize: 11.5, color: SEC, marginTop: 1 }}>{sub}</p>}
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

function ToolUsageChart({ months, series, height = 152 }: { months: string[]; series: { name: string; color: string; data: number[] }[]; height?: number }) {
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
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg width={w} height={H} role="img" aria-label="Runs per month by tool" style={{ display: 'block' }}
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
        <div style={{
          position: 'absolute', top: 2, pointerEvents: 'none',
          left: Math.min(Math.max(xOf(hover), 105), w - 105), transform: 'translateX(-50%)',
          background: '#FFFFFF', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '7px 9px',
          boxShadow: '0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.05)', minWidth: 186,
        }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: SEC, marginBottom: 4 }}>{months[hover]}</div>
          {series.map((s) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: '#334155', flex: 1 }}>{s.name}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: INK, fontVariantNumeric: 'tabular-nums' }}>{s.data[hover]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function HoursDonut({ items, total }: { items: { name: string; color: string; hours: number }[]; total: number }) {
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, flex: 1, justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label="Hours saved per tool">
          {arcs.map((a, i) => (
            <path key={items[i].name} d={a.d} fill="none" stroke={items[i].color} strokeWidth={stroke}
              opacity={active === null || active === i ? 1 : 0.35} style={{ transition: 'opacity 150ms ease' }}
              onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} />
          ))}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span style={{ fontFamily: "'Lora', serif", fontSize: 19, fontWeight: 600, color: NAVY, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {total.toLocaleString()}
          </span>
          <span style={{ fontSize: 8.5, fontWeight: 600, color: TER, letterSpacing: '0.08em', marginTop: 2 }}>HRS</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
        {items.map((it, i) => (
          <div key={it.name} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: active === null || active === i ? 1 : 0.45, transition: 'opacity 150ms ease' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: it.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#334155', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: INK, fontVariantNumeric: 'tabular-nums' }}>{it.hours.toLocaleString()}h</span>
            <span style={{ fontSize: 10, color: TER, width: 26, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {Math.round((it.hours / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MostUsedBars({ items }: { items: { name: string; color: string; runs: number }[] }) {
  const sorted = [...items].sort((a, b) => b.runs - a.runs)
  const max = Math.max(...sorted.map((it) => it.runs), 1)
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', marginTop: 4 }}>
      {sorted.map((it) => (
        <div key={it.name} style={{ display: 'grid', gridTemplateColumns: '156px minmax(0, 1fr) 34px', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</span>
          <div style={{ height: 14, background: '#F1F5F9', borderRadius: 999 }}>
            <div style={{ height: '100%', width: `${(it.runs / max) * 100}%`, background: it.color, borderRadius: 999, minWidth: 14 }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: INK, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{it.runs}</span>
        </div>
      ))}
    </div>
  )
}

function Meter({ label, value, pct, fill, track }: { label: string; value: string; pct: number; fill: string; track: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 11.5, color: '#334155' }}>{label}</span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: INK, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      </div>
      <div style={{ height: 6, background: track, borderRadius: 3 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: fill, borderRadius: 3 }} />
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
  const seriesView = TOOLS.map((t) => ({ name: t.name, color: t.color, data: t.runs.slice(from) }))
  const windowRuns = TOOLS.map((t) => t.runs.slice(from).reduce((a, b) => a + b, 0))
  const windowHours = TOOLS.map((t, i) => windowRuns[i] * t.hoursPerRun)
  const totalRuns = windowRuns.reduce((a, b) => a + b, 0)
  const totalHours = windowHours.reduce((a, b) => a + b, 0)
  const platformHours = Math.round(totalRuns * 0.6)
  const manualHours = totalHours + platformHours
  const effortCut = Math.round((1 - platformHours / manualHours) * 100)
  const workWeeks = Math.round(totalHours / 40)
  const donutItems = TOOLS.map((t, i) => ({ name: t.name, color: t.color, hours: windowHours[i] }))
  const barItems = TOOLS.map((t, i) => ({ name: t.name, color: t.color, runs: windowRuns[i] }))
  const toolsByUsage = TOOLS.map((t, i) => ({ t, runs: windowRuns[i] })).sort((a, b) => b.runs - a.runs).map((x) => x.t)

  const kpis = [
    { label: 'Total runs', value: totalRuns.toLocaleString(), unit: '', delta: '+4%', icon: Activity, accent: NAVY, spark: MONTHLY_TOTALS.slice(from) },
    { label: 'Hours saved', value: totalHours.toLocaleString(), unit: 'h', delta: '+8%', icon: Clock, accent: GREEN, spark: MONTHLY_HOURS.slice(from) },
    { label: 'Clients served', value: '18', unit: '', delta: '+6%', icon: Users, accent: NAVY, spark: CLIENTS_SPARK.slice(from) },
    { label: 'Revenue earned', value: '$420', unit: 'K', delta: '+8%', icon: DollarSign, accent: GOLD_DEEP, spark: REVENUE_SPARK.slice(from) },
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
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>

      {/* ── Greeting + controls ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: "'Lora', serif", fontSize: 20, fontWeight: 600, color: NAVY, lineHeight: 1.2 }}>
            {greeting}, Mohd Khizar
          </h1>
          <p style={{ fontSize: 11.5, color: SEC, marginTop: 2 }}>
            {today} · <span style={{ color: GREEN, fontWeight: 500 }}>● All systems operational</span>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', background: '#F0EFE9', borderRadius: 8, padding: 3 }}>
            {(['6M', '12M'] as const).map((r) => (
              <button key={r} onClick={() => setRange(r)}
                style={{
                  padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: range === r ? `1px solid ${BORDER}` : '1px solid transparent',
                  background: range === r ? '#FFFFFF' : 'transparent',
                  color: range === r ? INK : SEC,
                  boxShadow: range === r ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  transition: 'all 150ms ease',
                }}>
                {r}
              </button>
            ))}
          </div>
          <button onClick={exportReport}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8,
              fontSize: 12.5, fontWeight: 500, cursor: 'pointer', background: '#FFFFFF', color: '#334155',
              border: `1px solid ${BORDER}`, transition: 'background 150ms ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFC')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#FFFFFF')}>
            <Download size={13} strokeWidth={2} /> Export report
          </button>
        </div>
      </div>

      {/* ── KPI row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 11 }}>
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} style={{ ...CARD, padding: '13px 15px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: TER, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {k.label}
                </span>
                <div style={{ width: 24, height: 24, borderRadius: 7, background: `${k.accent}14`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={13} color={k.accent} strokeWidth={2} />
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <span style={{ fontFamily: "'Lora', serif", fontSize: 27, fontWeight: 600, color: NAVY, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {k.value}
                </span>
                {k.unit && (
                  <span style={{ fontFamily: "'Lora', serif", fontSize: 16, fontWeight: 600, color: SEC, marginLeft: 2 }}>{k.unit}</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
                <span style={{ fontSize: 10.5, color: SEC, whiteSpace: 'nowrap' }}>
                  <span style={{ fontWeight: 600, color: GREEN }}>▲ {k.delta}</span> vs last month
                </span>
                <Sparkline data={k.spark} color={k.accent} />
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Usage, hours saved, automation ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 11 }}>
        <div style={{ ...CARD, padding: 16, gridColumn: 'span 2', display: 'flex', flexDirection: 'column' }}>
          <CardTitle title="Tool usage over time" sub={`Runs per month · ${periodLabel}`} />
          <div style={{ marginTop: 10, flex: 1 }}>
            <ToolUsageChart months={monthsView} series={seriesView} height={176} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
            {TOOLS.map((t) => (
              <span key={t.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#334155' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color }} />
                {t.name}
              </span>
            ))}
          </div>
        </div>

        <div style={{ ...CARD, padding: 16, display: 'flex', flexDirection: 'column' }}>
          <CardTitle title="Hours saved per tool" sub={`Analyst effort reclaimed · ${periodLabel}`} />
          <HoursDonut items={donutItems} total={totalHours} />
        </div>

        <div style={{ ...CARD, padding: 16, display: 'flex', flexDirection: 'column' }}>
          <CardTitle title="Automation impact" sub={`Across all four tools · ${periodLabel}`} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: "'Lora', serif", fontSize: 29, fontWeight: 600, color: NAVY, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {totalHours.toLocaleString()}<span style={{ fontSize: 17, color: SEC }}> h</span>
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: '#15803D', background: '#DCFCE7', padding: '2px 8px', borderRadius: 999 }}>
              {effortCut}% less effort
            </span>
          </div>
          <p style={{ fontSize: 11, color: SEC, marginTop: 5 }}>
            Saved — about {workWeeks} analyst work-weeks.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12, flex: 1, justifyContent: 'center' }}>
            <Meter label="Done by hand" value={`${manualHours.toLocaleString()} h`} pct={100} fill="#94A3B8" track="#F1F5F9" />
            <Meter label="With the platform" value={`${platformHours.toLocaleString()} h`} pct={Math.max((platformHours / manualHours) * 100, 3)} fill={GOLD_DEEP} track="#FFF3CC" />
          </div>
          <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 10, marginTop: 10, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 10.5, color: SEC }}>{totalRuns} runs</span>
            <span style={{ fontSize: 10.5, color: SEC, fontVariantNumeric: 'tabular-nums' }}>
              ≈ {(totalHours / totalRuns).toFixed(1)} h saved per run
            </span>
          </div>
        </div>
      </div>

      {/* ── Most used + tool health ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 11 }}>
        <div style={{ ...CARD, padding: 16, display: 'flex', flexDirection: 'column' }}>
          <CardTitle title="Most used tools" sub={`Total runs · ${periodLabel}`} />
          <MostUsedBars items={barItems} />
        </div>

        <div style={{ ...CARD, padding: '12px 12px' }}>
          <div style={{ padding: '4px 8px 6px' }}>
            <CardTitle title="Tool health" sub="Engine status & last activity" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {toolsByUsage.map((t) => {
              const Icon = t.icon
              const badge = STATUS_BADGE[t.status]
              const isH = hovHealth === t.route
              return (
                <div key={t.route} onClick={() => navigate(t.route)}
                  onMouseEnter={() => setHovHealth(t.route)} onMouseLeave={() => setHovHealth(null)}
                  role="link" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(t.route) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '5px 8px', borderRadius: 8,
                    cursor: 'pointer', background: isH ? '#F8FAFC' : 'transparent', transition: 'background 150ms ease',
                  }}>
                  <div style={{ width: 26, height: 26, borderRadius: 7, background: `${t.color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon c={t.color} s={13} />
                  </div>
                  <span style={{ fontSize: 12.5, color: INK, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.name}
                  </span>
                  <span style={{ fontSize: 11, color: SEC, whiteSpace: 'nowrap' }}>Last run {t.lastRun}</span>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999,
                    fontSize: 10.5, fontWeight: 600, background: badge.bg, color: badge.color, flexShrink: 0,
                  }}>
                    ● {badge.label}
                  </span>
                  <ChevronRight size={13} color={isH ? SEC : '#CBD5E1'} style={{ flexShrink: 0, transition: 'color 150ms ease' }} />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
