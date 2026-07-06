import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import { ROUTES } from '../../utils/constants'

export default function AppLayout() {
  const location = useLocation()
  const isHome = location.pathname === ROUTES.HOME

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
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            background: '#F7F6F3',
          }}
        >
          <div style={{ maxWidth: 1400, margin: '0 auto', padding: isHome ? '14px 32px 14px' : '28px 32px' }}>
            <div className="fade-in">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
