import { NavLink } from 'react-router-dom'
import { Home, Link, Target, Search, Shield } from 'lucide-react'
import { clsx } from 'clsx'
import { ROUTES } from '../../utils/constants'
import { useAppStore } from '../../stores/useAppStore'

const NAV_ITEMS = [
  { to: ROUTES.HOME, icon: Home, label: 'Home' },
  { to: ROUTES.ENTITLEMENT_MAPPING, icon: Link, label: 'Entitlement Map' },
  { to: ROUTES.FP_ANALYSIS, icon: Target, label: 'FP Analysis' },
  { to: ROUTES.ORACLE_COMPARATOR, icon: Search, label: 'Oracle Compare' },
  { to: ROUTES.SOD_SA, icon: Shield, label: 'SOD & SA' },
]

export default function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)

  return (
    <aside
      className={clsx(
        'flex flex-col shrink-0 transition-all duration-150',
        'bg-[#2E2E38] text-white',   // EY Black — matches gray-800 token
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      {/* ── Brand ── */}
      <div
        className={clsx(
          'shrink-0 border-b border-[#3D3D47]',
          collapsed ? 'px-0 py-5 flex justify-center' : 'px-4 py-5',
        )}
      >
        {collapsed ? (
          <span className="text-ey-yellow font-bold text-xl leading-none">EY</span>
        ) : (
          <>
            <div className="text-ey-yellow font-bold text-xl leading-tight">EY</div>
            <div className="text-gray-400 text-[12px] mt-0.5 leading-tight">Access Governance</div>
          </>
        )}
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === ROUTES.HOME}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              clsx(
                // Base
                'flex items-center gap-3 py-2.5 text-sm transition-all duration-150 border-l-[3px]',
                // Layout: collapsed = icon-only centered, expanded = left-padded
                collapsed ? 'justify-center' : null,
                // State
                isActive
                  ? [
                      'border-ey-yellow bg-[rgba(255,230,0,0.08)] text-white',
                      // In expanded mode offset left padding by 3px border so icon aligns to 16px grid
                      !collapsed && 'pl-[13px] pr-4',
                    ]
                  : [
                      'border-transparent text-gray-400',
                      'hover:bg-[#3D3D47] hover:text-gray-200',
                      !collapsed && 'px-4',
                    ],
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={18}
                  className={clsx('shrink-0', isActive ? 'text-ey-yellow' : '')}
                />
                {!collapsed && <span className="truncate">{label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Version ── */}
      <div
        className={clsx(
          'shrink-0 border-t border-[#3D3D47] py-3',
          collapsed ? 'flex justify-center' : 'px-4',
        )}
      >
        {collapsed ? (
          <span className="text-[#747480] text-[11px]">v1</span>
        ) : (
          <span className="text-[#747480] text-[11px]">v1.0.0</span>
        )}
      </div>
    </aside>
  )
}
