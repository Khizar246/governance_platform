import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../utils/constants'

const TOOLS = [
  {
    route: ROUTES.RULESET_MAPPING,
    icon: IconRuleset,
    name: 'Ruleset Mapping',
    desc: 'Map client SoD and SA ruleset controls to EY controls using privilege-set Jaccard similarity.',
    accent: '#7C3AED',
    tag: 'Mapping',
    tagStyle: { background: '#EDE9FE', color: '#5B21B6' },
    runtime: '20 sec',
    files: '2 XLSX',
  },
  {
    route: ROUTES.FP_ANALYSIS,
    icon: IconFP,
    name: 'False Positive Analysis',
    desc: '3-level FP classification — False Positive, Single Leg, True Conflict — at privilege or aggregated entitlement level.',
    accent: '#2563EB',
    tag: 'Analysis',
    tagStyle: { background: '#DBEAFE', color: '#1D4ED8' },
    runtime: '28 sec',
    files: '2 XLSX',
  },
  {
    route: ROUTES.ORACLE_COMPARATOR,
    icon: IconOracle,
    name: 'Oracle Comparator',
    desc: 'Bi-directional RBAC and DSP comparison across Oracle Fusion environments using native set operations.',
    accent: '#16A34A',
    tag: 'Compare',
    tagStyle: { background: '#DCFCE7', color: '#15803D' },
    runtime: '22 sec',
    files: '2–4 CSV',
  },
  {
    route: ROUTES.SOD_SA,
    icon: IconSod,
    name: 'SOD & SA Analysis',
    desc: 'Segregation of Duties and Sensitive Access violation detection at role and user level with chunked processing.',
    accent: '#D97706',
    tag: 'Compliance',
    tagStyle: { background: '#FEE2E2', color: '#991B1B' },
    runtime: '45 sec',
    files: '2–3 files',
  },
]

const KPIS = [
  { label: 'FP Analysis',         value: 12, accent: '#2563EB', icon: IconFP },
  { label: 'Ruleset Mapping',     value: 18, accent: '#7C3AED', icon: IconRuleset },
  { label: 'Oracle Comparator',   value: 9,  accent: '#16A34A', icon: IconOracle },
  { label: 'SOD & SA Runs',       value: 8,  accent: '#D97706', icon: IconSod },
]


// ── Icons ─────────────────────────────────────────────────────────────────────
function IconRuleset({ c, s }: { c: string; s: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden><rect x="3" y="3" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.6"/><path d="M17.5 14v7M14 17.5h7" stroke={c} strokeWidth="1.6" strokeLinecap="round"/></svg>
}
function IconFP({ c, s }: { c: string; s: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="12" r="9" stroke={c} strokeWidth="1.6"/><circle cx="12" cy="12" r="3.5" stroke={c} strokeWidth="1.6"/><circle cx="12" cy="12" r="1" fill={c}/></svg>
}
function IconOracle({ c, s }: { c: string; s: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="11" cy="11" r="7" stroke={c} strokeWidth="1.6"/><path d="M20 20l-3.5-3.5" stroke={c} strokeWidth="2" strokeLinecap="round"/></svg>
}
function IconSod({ c, s }: { c: string; s: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 3l9 4.5v5c0 5-3.6 9.7-9 11-5.4-1.3-9-6-9-11V7.5L12 3z" stroke={c} strokeWidth="1.6"/><path d="M9 12l2 2 4-4" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function IconArrow({ c, s }: { c: string; s: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden><line x1="5" y1="12" x2="19" y2="12" stroke={c} strokeWidth="1.6" strokeLinecap="round"/><polyline points="12,5 19,12 12,19" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Home() {
  const navigate = useNavigate()
  const [hovTool, setHovTool] = useState<string | null>(null)

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* ── Greeting ── */}
      <div style={{ marginBottom: 0 }}>
        <h1 style={{ fontFamily: "'Lora', serif", fontSize: 26, fontWeight: 600, color: '#0F1E3D', lineHeight: 1.2 }}>
          Good morning, Mohd Khizar
        </h1>
        <p style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>
          {today} · <span style={{ color: '#16A34A', fontWeight: 500 }}>● All systems operational</span>
        </p>
      </div>

      {/* ── KPI row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {KPIS.map((k) => {
          const Icon = k.icon
          return (
            <div
              key={k.label}
              style={{
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: 12,
                padding: '18px 20px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {k.label}
                </span>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#F0EFE9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon c="#64748B" s={15} />
                </div>
              </div>
              <div>
                <span style={{ fontFamily: "'Lora', serif", fontSize: 36, fontWeight: 600, color: '#0F1E3D', lineHeight: 1 }}>
                  {k.value}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: k.accent }} />
                  <span style={{ fontSize: 11, color: '#64748B' }}>Total runs</span>
                </div>
              </div>
              <div style={{ height: 3, background: '#F1F0EA', borderRadius: 2 }}>
                <div style={{ height: '100%', width: `${Math.min(100, k.value * 4)}%`, background: k.accent, borderRadius: 2 }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Tools ── */}
      <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
            Tools
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {TOOLS.map((tool) => {
              const Icon = tool.icon
              const isH = hovTool === tool.route
              return (
                <div
                  key={tool.route}
                  onClick={() => navigate(tool.route)}
                  onMouseEnter={() => setHovTool(tool.route)}
                  onMouseLeave={() => setHovTool(null)}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: 12,
                    padding: '16px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: isH ? '0 4px 16px rgba(0,0,0,0.10)' : 'none',
                    transform: isH ? 'translateY(-1px)' : 'none',
                  }}
                >
                  <div
                    style={{
                      width: 44, height: 44,
                      borderRadius: 10,
                      background: '#0F1E3D',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon c="#FFD100" s={20} />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{tool.name}</span>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center',
                        padding: '2px 8px', borderRadius: 4,
                        fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
                        ...tool.tagStyle,
                      }}>
                        {tool.tag}
                      </span>
                    </div>
                    <p style={{ fontSize: 12.5, color: '#64748B', lineHeight: 1.5, marginBottom: 5 }}>{tool.desc}</p>
                    <p style={{ fontSize: 11, color: '#94A3B8' }}>Avg {tool.runtime} · {tool.files}</p>
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(tool.route) }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '8px 16px', borderRadius: 8,
                      fontSize: 13, fontWeight: 500, cursor: 'pointer',
                      background: '#0F1E3D', color: '#FFD100',
                      border: 'none', flexShrink: 0,
                      transition: 'background 0.15s',
                    }}
                  >
                    Launch <IconArrow c="#FFD100" s={13} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
    </div>
  )
}
