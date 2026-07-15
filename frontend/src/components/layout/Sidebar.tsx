import { NavLink } from 'react-router-dom'
import { ROUTES } from '../../utils/constants'
import { useAppStore } from '../../stores/useAppStore'

const NAV_ITEMS = [
  { to: ROUTES.HOME,                icon: IconHome,    label: 'Dashboard',            accent: '#E8A900' },
  { to: ROUTES.RULESET_MAPPING,     icon: IconRuleset, label: 'Ruleset Mapping',      accent: '#7C3AED' },
  { to: ROUTES.ORACLE_COMPARATOR,   icon: IconOracle,  label: 'Oracle Role Comparison', accent: '#16A34A' },
  { to: ROUTES.SOD_SA,              icon: IconSod,     label: 'SOD & SA Analysis',    accent: '#D97706' },
  { to: ROUTES.ROLE_TESTING,        icon: IconBot,     label: 'Role Testing Bot',     accent: '#0EA5E9' },
]

const RESOURCE_ITEMS = [
  { to: ROUTES.DOWNLOADS, icon: IconDownload, label: 'Downloads',   accent: '#0EA5E9' },
  { to: ROUTES.ADMIN,     icon: IconAdmin,    label: 'Admin Panel', accent: '#64748B' },
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
function IconRuleset({ c, s }: { c: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.6"/>
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.6"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.6"/>
      <path d="M17.5 14v7M14 17.5h7" stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  )
}
function IconBot({ c, s }: { c: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="8" width="16" height="11" rx="2.5" stroke={c} strokeWidth="1.6"/>
      <path d="M12 4v4" stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
      <circle cx="12" cy="3.5" r="1.3" stroke={c} strokeWidth="1.6"/>
      <circle cx="9" cy="13" r="1.2" fill={c}/>
      <circle cx="15" cy="13" r="1.2" fill={c}/>
    </svg>
  )
}
function IconChevron({ collapsed, c }: { collapsed: boolean; c: string }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden
      className={`transition-transform duration-[220ms] ${collapsed ? 'rotate-0' : 'rotate-180'}`}>
      <path d="M9 6l6 6-6 6" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function IconDownload({ c, s }: { c: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  )
}
function IconAdmin({ c, s }: { c: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h16" stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
      <circle cx="9" cy="6" r="2" fill="#FFFFFF" stroke={c} strokeWidth="1.6"/>
      <circle cx="15" cy="12" r="2" fill="#FFFFFF" stroke={c} strokeWidth="1.6"/>
      <circle cx="8" cy="18" r="2" fill="#FFFFFF" stroke={c} strokeWidth="1.6"/>
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

type NavItem = { to: string; icon: (p: { c: string; s: number }) => JSX.Element; label: string; accent: string }

function NavGroup({ title, items, collapsed }: { title: string; items: NavItem[]; collapsed: boolean }) {
  return (
    <div className="mb-1.5">
      {!collapsed && (
        <div className="text-[9.5px] font-semibold text-[#94A3B8] uppercase tracking-[0.12em] px-2 py-1.5 mb-0.5">
          {title}
        </div>
      )}
      {items.map((item) => {
        const IconComp = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === ROUTES.HOME}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) => [
              'flex items-center gap-[9px] rounded-[7px] border w-full cursor-pointer no-underline transition-all duration-[130ms] mb-0.5',
              collapsed ? 'py-[7px] px-0 justify-center' : 'py-[7px] px-2 justify-start',
              isActive ? 'border-[#E8C84D] bg-[#FFF3CC]' : 'border-transparent bg-transparent',
            ].join(' ')}
          >
            {({ isActive }) => (
              <>
                <div
                  className={`w-7 h-7 rounded-[6px] flex items-center justify-center shrink-0 transition-colors duration-[130ms] ${isActive ? 'bg-[#E8A900]' : 'bg-[#F0EFE9]'}`}
                >
                  <IconComp s={14} c={isActive ? '#FFFFFF' : '#64748B'} />
                </div>
                {!collapsed && (
                  <span
                    className={`text-[13px] whitespace-nowrap ${isActive ? 'font-semibold text-[#0F1E3D]' : 'font-normal text-[#334155]'}`}
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
  )
}

export default function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed)

  return (
    <aside
      className={`h-full flex flex-col bg-white border-r border-[#E2E8F0] transition-[width,min-width] duration-[220ms] ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden z-20 shrink-0 ${collapsed ? 'w-[60px] min-w-[60px]' : 'w-[232px] min-w-[232px]'}`}
    >
      {/* ── Logo ── */}
      <div
        className={`border-b border-[#F1F0EA] shrink-0 ${collapsed ? 'px-[14px] py-[18px]' : 'pt-[18px] px-[18px] pb-[14px]'}`}
      >
        <div
          className={`w-9 h-9 bg-[#0F1E3D] rounded flex items-center justify-center ${collapsed ? 'mb-0' : 'mb-2.5'}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="#FFD100" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        {!collapsed && (
          <>
            <p className="font-serif text-[13px] font-semibold text-[#0F1E3D] tracking-[0.01em] leading-[1.2]">
              Access Governance
            </p>
            <p className="text-[9.5px] text-[#94A3B8] tracking-[0.12em] uppercase mt-0.5">
              Platform · Enterprise
            </p>
          </>
        )}
      </div>

      {/* ── Nav groups ── */}
      <nav className="flex-1 p-2.5 overflow-y-auto flex flex-col gap-0">
        <NavGroup title="Governance" items={NAV_ITEMS} collapsed={collapsed} />
        <NavGroup title="Resources" items={RESOURCE_ITEMS} collapsed={collapsed} />
      </nav>

      {/* ── Footer ── */}
      <div className="pt-2.5 px-2.5 pb-3 border-t border-[#F1F0EA] shrink-0">
        {/* Trust badges */}
        {!collapsed && (
          <div className="flex gap-1.5 mb-2.5 flex-wrap">
            {[
              { label: 'TLS 1.3', cls: 'bg-[#DCFCE7] text-[#16A34A]', iconColor: '#16A34A' },
              { label: 'SOC2',    cls: 'bg-[#DBEAFE] text-[#2563EB]', iconColor: '#2563EB' },
            ].map(({ label, cls, iconColor }) => (
              <span
                key={label}
                className={`inline-flex items-center gap-1 px-[7px] py-0.5 rounded-[4px] text-[9.5px] font-semibold tracking-[0.04em] ${cls}`}
              >
                <IconLock c={iconColor} s={9} /> {label}
              </span>
            ))}
          </div>
        )}

        {/* User card */}
        {!collapsed && (
          <div className="flex items-center gap-2 px-2.5 py-2 rounded bg-[#F0EFE9] mb-2">
            <div className="w-8 h-8 rounded-full bg-[#0F1E3D] flex items-center justify-center text-[11px] font-bold text-[#FFD100] shrink-0">
              MK
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold text-[#0F1E3D]">Mohd Khizar</div>
              <div className="text-[10.5px] text-[#94A3B8]">EY · Analyst</div>
            </div>
          </div>
        )}

        {/* Collapse toggle */}
        <button
          onClick={() => setSidebarCollapsed(!collapsed)}
          className={`flex items-center gap-[9px] rounded-[7px] border-none bg-transparent cursor-pointer w-full transition-colors duration-[130ms] hover:bg-[#F0EFE9] ${collapsed ? 'py-2 px-0 justify-center' : 'py-2 px-2 justify-start'}`}
        >
          <IconChevron collapsed={collapsed} c="#94A3B8" />
          {!collapsed && (
            <span className="text-[11.5px] text-[#94A3B8]">Collapse sidebar</span>
          )}
        </button>
      </div>
    </aside>
  )
}
