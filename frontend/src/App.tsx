import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'

import AppLayout from './components/layout/AppLayout'
import ErrorBoundary from './components/common/ErrorBoundary'
import Home from './pages/Home'
import { ROUTES } from './utils/constants'

// Lightweight fallback shown while a lazy route chunk downloads. Kept minimal
// (no heavy imports) so it doesn't get pulled into the initial bundle.
function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-ey-yellow" />
    </div>
  )
}

// Lazy-load the secondary pages so each tool's code (DataTable, upload, polling,
// and its heavy deps) loads on navigation instead of shipping in the initial
// bundle. Home stays eager — it's the default route, needed on first paint.
const OracleComparator = lazy(() => import('./pages/OracleComparator'))
const SODSAAnalysis    = lazy(() => import('./pages/SODSAAnalysis'))
const RulesetMapping   = lazy(() => import('./pages/RulesetMapping'))
const RoleTestingBot   = lazy(() => import('./pages/RoleTestingBot'))
const Downloads        = lazy(() => import('./pages/Downloads'))
const AdminPanel       = lazy(() => import('./pages/AdminPanel'))

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Toaster position="top-right" richColors closeButton />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path={ROUTES.HOME} element={<ErrorBoundary><Home /></ErrorBoundary>} />
              <Route path={ROUTES.ORACLE_COMPARATOR} element={<ErrorBoundary><OracleComparator /></ErrorBoundary>} />
              <Route path={ROUTES.SOD_SA} element={<ErrorBoundary><SODSAAnalysis /></ErrorBoundary>} />
              <Route path={ROUTES.RULESET_MAPPING} element={<ErrorBoundary><RulesetMapping /></ErrorBoundary>} />
              <Route path={ROUTES.ROLE_TESTING} element={<ErrorBoundary><RoleTestingBot /></ErrorBoundary>} />
              <Route path={ROUTES.DOWNLOADS} element={<ErrorBoundary><Downloads /></ErrorBoundary>} />
              <Route path={ROUTES.ADMIN} element={<ErrorBoundary><AdminPanel /></ErrorBoundary>} />
              <Route path="*" element={<Navigate to={ROUTES.HOME} replace />} />
            </Route>
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
