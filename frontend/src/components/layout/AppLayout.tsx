import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import { ROUTES } from '../../utils/constants'

export default function AppLayout() {
  const location = useLocation()
  const isHome = location.pathname === ROUTES.HOME

  return (
    <div className="flex flex-row h-screen overflow-hidden bg-surface-page">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-surface-page">
          <div className={`max-w-[1400px] mx-auto px-8 ${isHome ? 'py-3.5' : 'py-7'}`}>
            <div className="fade-in">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
