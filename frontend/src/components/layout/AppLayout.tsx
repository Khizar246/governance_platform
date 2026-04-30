import { Outlet } from 'react-router-dom'
import { useEffect } from 'react'
import Sidebar from './Sidebar'
import { useAppStore } from '../../stores/useAppStore'

export default function AppLayout() {
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed)

  // Auto-collapse sidebar below 1200px viewport width
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1199px)')
    const onChange = (e: MediaQueryListEvent) => setSidebarCollapsed(e.matches)
    setSidebarCollapsed(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [setSidebarCollapsed])

  return (
    <div className="flex h-screen overflow-hidden bg-ey-white">
      <Sidebar />
      <main className="flex-1 overflow-auto min-w-0">
        <div className="max-w-[1400px] mx-auto px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
