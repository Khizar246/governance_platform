import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import { ROUTES } from '../../utils/constants'

const ROUTE_META: Record<string, string> = {
  [ROUTES.HOME]:              'Dashboard',
  [ROUTES.RULESET_MAPPING]:   'Ruleset Mapping',
  [ROUTES.ORACLE_COMPARATOR]: 'Oracle Comparator',
  [ROUTES.SOD_SA]:            'SOD & SA Analysis',
}

function Topbar({ pathname }: { pathname: string }) {
  const label = ROUTE_META[pathname] ?? 'Dashboard'

  return (
    <div
      style={{
        height: 56,
        background: '#FFFFFF',
        borderBottom: '1px solid #E2E8F0',
        display: 'flex',
        alignItems: 'center',
        padding: '0 28px',
        gap: 12,
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: '#0F1E3D' }}>{label}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11.5, color: '#94A3B8' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </span>
      </div>
    </div>
  )
}

export default function AppLayout() {
  const location = useLocation()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        height: '100vh',
        overflow: 'hidden',
        background: '#F7F6F3',
      }}
    >
      <Sidebar />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <Topbar pathname={location.pathname} />

        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            background: '#F7F6F3',
          }}
        >
          <div style={{ maxWidth: 1400, margin: '0 auto', padding: '28px 32px' }}>
            <div className="fade-in">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
