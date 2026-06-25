import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'

import AppLayout from './components/layout/AppLayout'
import ErrorBoundary from './components/common/ErrorBoundary'
import Home from './pages/Home'
import OracleComparator from './pages/OracleComparator'
import SODSAAnalysis from './pages/SODSAAnalysis'
import RulesetMapping from './pages/RulesetMapping'
import Downloads from './pages/Downloads'
import AdminPanel from './pages/AdminPanel'
import { ROUTES } from './utils/constants'

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Toaster position="top-right" richColors closeButton />
        <Routes>
          <Route element={<AppLayout />}>
            <Route path={ROUTES.HOME} element={<ErrorBoundary><Home /></ErrorBoundary>} />
            <Route path={ROUTES.ORACLE_COMPARATOR} element={<ErrorBoundary><OracleComparator /></ErrorBoundary>} />
            <Route path={ROUTES.SOD_SA} element={<ErrorBoundary><SODSAAnalysis /></ErrorBoundary>} />
            <Route path={ROUTES.RULESET_MAPPING} element={<ErrorBoundary><RulesetMapping /></ErrorBoundary>} />
            <Route path={ROUTES.DOWNLOADS} element={<ErrorBoundary><Downloads /></ErrorBoundary>} />
            <Route path={ROUTES.ADMIN} element={<ErrorBoundary><AdminPanel /></ErrorBoundary>} />
            <Route path="*" element={<Navigate to={ROUTES.HOME} replace />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
