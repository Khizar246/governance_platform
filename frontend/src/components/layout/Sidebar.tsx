import { NavLink } from 'react-router-dom'
import { ROUTES } from '../../utils/constants'
import { useAppStore } from '../../stores/useAppStore'

const NAV_ITEMS = [
  { to: ROUTES.HOME,                icon: IconHome,   label: 'Dashboard',            accent: '#E8A900' },
  { to: ROUTES.FP_ANALYSIS,         icon: IconFP,     label: 'FP Analysis',          accent: '#2563EB' },
  { to: ROUTES.ENTITLEMENT_MAPPING, icon: IconMap,    label: 'Entitlement Mapping',  accent: '#E8A900' },
  { to: ROUTES.ORACLE_COMPARATOR,   icon: IconOracle, label: 'Oracle Role Comparison', accent: '#16A34A' },
  { to: ROUTES.SOD_SA,              icon: IconSod,    label: 'SOD & SA Analysis',    accent: '#D97706' },
]

// ── SVG Icons ────────────────────────────────────────────────────────────────
function IconHome({ c, s }: { c: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" stroke={c} strokeWidth="1.6"/>
      <path d="M9 21V12h6v9" stroke={c} strokeWidth="1.6"/>
    </svg>
  )
}
function IconMap({ c, s }: { c: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke={c} strokeWidth="1.6"/>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" stroke={c} strokeWidth="1.6"/>
    </svg>
  )
}
function IconFP({ c, s }: { c: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke={c} strokeWidth="1.6"/>
      <circle cx="12" cy="12" r="3.5" stroke={c} strokeWidth="1.6"/>
      <circle cx="12" cy="12" r="1" fill={c}/>
    </svg>
  )
}
function IconOracle({ c, s }: { c: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke={c} strokeWidth="1.6"/>
      <path d="M20 20l-3.5-3.5" stroke={c} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}
function IconSod({ c, s }: { c: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3l9 4.5v5c0 5-3.6 9.7-9 11-5.4-1.3-9-6-9-11V7.5L12 3z" stroke={c} strokeWidth="1.6"/>
      <path d="M9 12l2 2 4-4" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function IconChevron({ collapsed, c }: { collapsed: boolean; c: string }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden
      style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.22s' }}>
      <path d="M9 6l6 6-6 6" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function IconLock({ c, s }: { c: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" stroke={c} strokeWidth="1.5"/>
      <path d="M7 11V7a5 5 0 0110 0v4" stroke={c} strokeWidth="1.5"/>
    </svg>
  )
}

export default function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed)

  const w = collapsed ? 60 : 232

  return (
    <aside
      style={{
        width: w,
        minWidth: w,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#FFFFFF',
        borderRight: '1px solid #E2E8F0',
        transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1), min-width 0.22s cubic-bezier(0.4,0,0.2,1)',
        overflow: 'hidden',
        zIndex: 20,
        flexShrink: 0,
      }}
    >
      {/* ── Logo ── */}
      <div
        style={{
          padding: collapsed ? '18px 14px' : '18px 18px 14px',
          borderBottom: '1px solid #F1F0EA',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 36, height: 36,
            background: '#0F1E3D',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: collapsed ? 0 : 10,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="#FFD100" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        {!collapsed && (
          <>
            <p style={{ fontFamily: "'Lora', serif", fontSize: 13, fontWeight: 600, color: '#0F1E3D', letterSpacing: '0.01em', lineHeight: 1.2 }}>
              Access Governance
            </p>
            <p style={{ fontSize: 9.5, color: '#94A3B8', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 }}>
              Platform · Enterprise
            </p>
          </>
        )}
      </div>

      {/* ── Nav groups ── */}
      <nav
        style={{
          flex: 1,
          padding: '10px 10px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        <div style={{ marginBottom: 6 }}>
          {!collapsed && (
            <div
              style={{
                fontSize: 9.5, fontWeight: 600, color: '#94A3B8',
                textTransform: 'uppercase', letterSpacing: '0.12em',
                padding: '6px 8px 6px', marginBottom: 2,
              }}
            >
              Governance
            </div>
          )}
          {NAV_ITEMS.map((item) => {
            const IconComp = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === ROUTES.HOME}
                title={collapsed ? item.label : undefined}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: collapsed ? '7px 0' : '7px 8px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  borderRadius: 7,
                  border: isActive ? '1px solid #E8C84D' : '1px solid transparent',
                  width: '100%',
                  cursor: 'pointer',
                  textDecoration: 'none',
                  background: isActive ? '#FFF3CC' : 'transparent',
                  transition: 'all 0.13s',
                  marginBottom: 2,
                })}
              >
                {({ isActive }) => (
                  <>
                    <div
                      style={{
                        width: 28, height: 28,
                        borderRadius: 6,
                        background: isActive ? '#E8A900' : '#F0EFE9',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        transition: 'background 0.13s',
                      }}
                    >
                      <IconComp s={14} c={isActive ? '#FFFFFF' : '#64748B'} />
                    </div>
                    {!collapsed && (
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: isActive ? 600 : 400,
                          color: isActive ? '#0F1E3D' : '#334155',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.label}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            )
          })}
        </div>
      </nav>

      {/* ── Footer ── */}
      <div
        style={{
          padding: '10px 10px 12px',
          borderTop: '1px solid #F1F0EA',
          flexShrink: 0,
        }}
      >
        {/* Trust badges */}
        {!collapsed && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {[
              { label: 'TLS 1.3', bg: '#DCFCE7', color: '#16A34A' },
              { label: 'SOC2',    bg: '#DBEAFE', color: '#2563EB' },
            ].map(({ label, bg, color }) => (
              <span
                key={label}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 7px', borderRadius: 4,
                  fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em',
                  background: bg, color,
                }}
              >
                <IconLock c={color} s={9} /> {label}
              </span>
            ))}
          </div>
        )}

        {/* User card */}
        {!collapsed && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 8,
              background: '#F0EFE9',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                width: 32, height: 32, borderRadius: '50%',
                background: '#0F1E3D',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: '#FFD100',
                flexShrink: 0,
              }}
            >
              MK
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0F1E3D' }}>Mohd Khizar</div>
              <div style={{ fontSize: 10.5, color: '#94A3B8' }}>EY · Analyst</div>
            </div>
          </div>
        )}

        {/* Collapse toggle */}
        <button
          onClick={() => setSidebarCollapsed(!collapsed)}
          style={{
            display: 'flex', alignItems: 'center', gap: 9,
            padding: collapsed ? '8px 0' : '8px 8px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            borderRadius: 7, border: 'none',
            background: 'transparent', cursor: 'pointer',
            width: '100%', transition: 'background 0.13s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#F0EFE9' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          <IconChevron collapsed={collapsed} c="#94A3B8" />
          {!collapsed && (
            <span style={{ fontSize: 11.5, color: '#94A3B8' }}>Collapse sidebar</span>
          )}
        </button>
      </div>
    </aside>
  )
}
