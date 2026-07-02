import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Shield, AlertCircle, CheckCircle2, RefreshCw, X,
  Users, Layers, Info,
} from 'lucide-react'
import { toast } from 'sonner'
import type { ColumnDef } from '@tanstack/react-table'
import PageHeader from '../components/layout/PageHeader'
import FileUpload from '../components/common/FileUpload'
import StepIndicator from '../components/common/StepIndicator'
import DataTable from '../components/common/DataTable'
import LoadingOverlay, { type ProgressStep } from '../components/common/LoadingOverlay'
import DownloadButton from '../components/common/DownloadButton'
import ConfirmDialog from '../components/common/ConfirmDialog'
import {
  uploadFiles, runAnalysis, getStatus, downloadResults, cancelJob,
  getSummary, getSheetResults, getFilterOptions, getSeededFileSize,
} from '../api/sodSaAnalysis'
import type { SODSASummaryData, SODSATopItem } from '../api/sodSaAnalysis'
import HelpAccordion, { HelpStep, HelpPill, TemplateDownloads } from '../components/common/HelpAccordion'
import type { SODSASummary } from '../types'
import { POLL_INTERVAL_MS } from '../utils/constants'

type Step = 'config' | 'upload' | 'running' | 'results' | 'error'
type AnalysisType = 'role' | 'user' | 'both'
type SODRow = Record<string, unknown>
type IntegrityItem = { control: string; privileges: string[]; lhs: string; rhs: string }

const STEPS = ['Configure Analysis', 'Upload Files', 'Processing', 'Results']
const STEP_INDEX: Record<Step, number> = { config: 0, upload: 1, running: 2, results: 3, error: 0 }

// The four analyses the user can toggle independently. Ticking any User box
// requires the User Role Membership file; the role/user/both "type" is derived.
const ANALYSIS_OPTIONS: { id: string; group: 'Role-level' | 'User-level'; label: string; sublabel: string }[] = [
  { id: 'role_sod', group: 'Role-level', label: 'Role · Segregation of Duties', sublabel: 'SoD conflicts resolved within each role' },
  { id: 'role_sa',  group: 'Role-level', label: 'Role · Sensitive Access',      sublabel: 'Sensitive access granted at role level' },
  { id: 'user_sod', group: 'User-level', label: 'User · Segregation of Duties', sublabel: 'SoD conflicts attributed to named users' },
  { id: 'user_sa',  group: 'User-level', label: 'User · Sensitive Access',      sublabel: 'Sensitive access attributed to named users' },
]

const ALL_SHEET_IDS = ['ROLE_SOD', 'ROLE_SA', 'USER_SOD', 'USER_SA']
const SHEET_LABELS: Record<string, string> = {
  ROLE_SOD: 'Role SoD',
  ROLE_SA: 'Role SA',
  USER_SOD: 'User SoD',
  USER_SA: 'User SA',
  GROUP_MAPPING: 'User Groups',
}

// ── Column definitions ─────────────────────────────────────────────────────────

const ROLE_COLUMNS: ColumnDef<SODRow>[] = [
  { id: 'CONTROL_NAME',               accessorKey: 'CONTROL_NAME',               header: 'Control Name' },
  { id: 'ENTITLEMENT',                accessorKey: 'ENTITLEMENT',                header: 'Entitlement' },
  { id: 'ROLE_DISPLAY_NAME',          accessorKey: 'ROLE_DISPLAY_NAME',          header: 'Role Name' },
  { id: 'INHERITED_ROLE_DISPLAY_NAME',accessorKey: 'INHERITED_ROLE_DISPLAY_NAME',header: 'Inherited Role' },
  { id: 'PRIVILEGE_DISPLAY_NAME',     accessorKey: 'PRIVILEGE_DISPLAY_NAME',     header: 'Privilege Name' },
  {
    id: 'Potential FP',
    accessorKey: 'Potential FP',
    header: 'Potential FP',
    cell: ({ getValue }) => {
      const val = getValue() as string
      const bgColors: Record<string, string> = {
        'FP': 'bg-green-100 text-green-800',
        'SL': 'bg-yellow-100 text-yellow-800',
        'TC': 'bg-red-100 text-red-800',
        'NOT ANALYSED': 'bg-gray-100 text-gray-800',
      }
      return val ? <span className={`px-2.5 py-1 rounded text-xs font-medium ${bgColors[val] || 'bg-gray-100 text-gray-700'}`}>{val}</span> : null
    },
  },
  { id: 'Reason',                     accessorKey: 'Reason',                     header: 'FP Reason' },
]

const USER_COLUMNS: ColumnDef<SODRow>[] = [
  { id: 'CONTROL_NAME',               accessorKey: 'CONTROL_NAME',               header: 'Control Name' },
  { id: 'ENTITLEMENT',                accessorKey: 'ENTITLEMENT',                header: 'Entitlement' },
  { id: 'ROLE_DISPLAY_NAME',          accessorKey: 'ROLE_DISPLAY_NAME',          header: 'Role Name' },
  { id: 'INHERITED_ROLE_DISPLAY_NAME',accessorKey: 'INHERITED_ROLE_DISPLAY_NAME',header: 'Inherited Role' },
  { id: 'PRIVILEGE_DISPLAY_NAME',     accessorKey: 'PRIVILEGE_DISPLAY_NAME',     header: 'Privilege Name' },
  { id: 'GROUP_NAME',                 accessorKey: 'GROUP_NAME',                 header: 'User Group' },
  { id: 'USER_NAME',                  accessorKey: 'USER_NAME',                  header: 'User Name' },
  {
    id: 'Potential FP',
    accessorKey: 'Potential FP',
    header: 'Potential FP',
    cell: ({ getValue }) => {
      const val = getValue() as string
      const bgColors: Record<string, string> = {
        'FP': 'bg-green-100 text-green-800',
        'SL': 'bg-yellow-100 text-yellow-800',
        'TC': 'bg-red-100 text-red-800',
        'NOT ANALYSED': 'bg-gray-100 text-gray-800',
      }
      return val ? <span className={`px-2.5 py-1 rounded text-xs font-medium ${bgColors[val] || 'bg-gray-100 text-gray-700'}`}>{val}</span> : null
    },
  },
  { id: 'Reason',                     accessorKey: 'Reason',                     header: 'FP Reason' },
]

const GROUP_MAPPING_COLUMNS: ColumnDef<SODRow>[] = [
  { id: 'GROUP_NAME',                 accessorKey: 'GROUP_NAME',                 header: 'Group Name' },
  { id: 'ROLE_NAME',                  accessorKey: 'ROLE_NAME',                  header: 'Role Name' },
  { id: 'NO_OF_USERS_IN_GROUP',       accessorKey: 'NO_OF_USERS_IN_GROUP',       header: 'No. of Users' },
]

const ROLE_DEFAULT_SORT = [
  { id: 'CONTROL_NAME',                desc: false },
  { id: 'ENTITLEMENT',                 desc: false },
  { id: 'ROLE_DISPLAY_NAME',           desc: false },
  { id: 'INHERITED_ROLE_DISPLAY_NAME', desc: false },
  { id: 'PRIVILEGE_DISPLAY_NAME',      desc: false },
  { id: 'Potential FP',                desc: false },
]

const USER_DEFAULT_SORT = [
  { id: 'CONTROL_NAME',                desc: false },
  { id: 'ENTITLEMENT',                 desc: false },
  { id: 'ROLE_DISPLAY_NAME',           desc: false },
  { id: 'INHERITED_ROLE_DISPLAY_NAME', desc: false },
  { id: 'PRIVILEGE_DISPLAY_NAME',      desc: false },
  { id: 'GROUP_NAME',                  desc: false },
  { id: 'USER_NAME',                   desc: false },
  { id: 'Potential FP',                desc: false },
]

// ── Insight card ───────────────────────────────────────────────────────────────

function InsightCard({ title, items }: { title: string; items: SODSATopItem[] }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <span className="text-[10.5px] font-semibold text-gray-500 uppercase tracking-[0.08em]">{title}</span>
      </div>
      <div className="divide-y divide-gray-50">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <span
              className="flex items-center justify-center shrink-0 rounded text-[10px] font-bold text-white"
              style={{ width: 18, height: 18, minWidth: 18, background: '#0F1E3D' }}
            >
              {i + 1}
            </span>
            <span className="text-[12.5px] text-gray-700 flex-1 truncate min-w-0" title={item.name}>
              {item.name}
            </span>
            <span style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 14, fontWeight: 700, color: '#EAB308', flexShrink: 0 }}>
              {item.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SODSAAnalysis() {
  const [step, setStep] = useState<Step>('config')
  const [withFp, setWithFp] = useState(false)
  const [withObservation, setWithObservation] = useState(false)
  const [selectedAnalyses, setSelectedAnalyses] = useState<string[]>(['role_sod', 'role_sa', 'user_sod', 'user_sa'])
  const [roleHierarchyFile, setRoleHierarchyFile] = useState<File | null>(null)
  const [rulesetFile, setRulesetFile] = useState<File | null>(null)
  const [userRoleFile, setUserRoleFile] = useState<File | null>(null)
  const [fpDbFile, setFpDbFile] = useState<File | null>(null)
  const [rulesetSeeded, setRulesetSeeded] = useState(false)
  const [fpDbSeeded, setFpDbSeeded] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [currentStep, setCurrentStep] = useState(0)
  const [summary, setSummary] = useState<SODSASummary | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [uploadError, setUploadError] = useState('')
  const [uploadErrorDetails, setUploadErrorDetails] = useState<string[]>([])
  const [integrityItems, setIntegrityItems] = useState<IntegrityItem[]>([])
  const [entitlementWarnings, setEntitlementWarnings] = useState<{ entitlement: string; controls: string[] }[]>([])
  const [recommendedWarnings, setRecommendedWarnings] = useState<string[]>([])
  const [stagedJobId, setStagedJobId] = useState<string | null>(null)
  const [validationFailed, setValidationFailed] = useState(false)
  const [seededSizes, setSeededSizes] = useState<{ ruleset: number; fpDb: number }>({ ruleset: 0, fpDb: 0 })
  const [confirmReset, setConfirmReset] = useState(false)

  // Results step state
  const [sodSaSummaryData, setSodSaSummaryData] = useState<SODSASummaryData | null>(null)
  const [activeTab, setActiveTab] = useState('')
  const [pageRows, setPageRows] = useState<SODRow[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [total, setTotal] = useState(0)
  const [dataLoading, setDataLoading] = useState(false)
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({})
  const hasActiveFilters = Object.values(activeFilters).some(v => v.length > 0)

  // Derive the role/user/both "type" from whichever analyses are ticked.
  const analysisType = useMemo<AnalysisType | null>(() => {
    const hasRole = selectedAnalyses.some(a => a.startsWith('role_'))
    const hasUser = selectedAnalyses.some(a => a.startsWith('user_'))
    if (hasRole && hasUser) return 'both'
    if (hasRole) return 'role'
    if (hasUser) return 'user'
    return null
  }, [selectedAnalyses])

  const progressSteps = useMemo((): ProgressStep[] => {
    const hasRole = selectedAnalyses.some(a => a.startsWith('role_'))
    const hasUser = selectedAnalyses.some(a => a.startsWith('user_')) && analysisType !== 'role'
    const steps: ProgressStep[] = [
      { step: 1,  label: 'Importing files',                    phase: 1 },
      { step: 2,  label: 'Validating sheets and columns',      phase: 1 },
      { step: 3,  label: 'Initiating SOD SA Analysis',         phase: 2 },
    ]
    if (hasRole) {
      steps.push({ step: 4, label: 'Performing role SOD analysis', phase: 2 })
      steps.push({ step: 5, label: 'Performing role SA analysis',  phase: 2 })
    }
    if (hasUser) {
      steps.push({ step: 6, label: 'Performing user SOD analysis', phase: 2 })
      steps.push({ step: 7, label: 'Performing user SA analysis',  phase: 2 })
    }
    if (withFp) {
      steps.push({ step: 8,  label: 'Initiating False Positive Analysis', phase: 3 })
      if (hasRole) {
        steps.push({ step: 9,  label: 'FP analysis on role SOD', phase: 3 })
        steps.push({ step: 10, label: 'FP analysis on role SA',  phase: 3 })
      }
      if (hasUser) {
        steps.push({ step: 11, label: 'FP analysis on user SOD', phase: 3 })
        steps.push({ step: 12, label: 'FP analysis on user SA',  phase: 3 })
      }
    }
    steps.push({ step: 13, label: 'Preparing Excel export',   phase: 4 })
    steps.push({ step: 14, label: 'Building Excel report',    phase: 4 })
    steps.push({ step: 15, label: 'Writing summary sheet',    phase: 4 })
    if (hasUser) {
      steps.push({ step: 16, label: 'Writing user group mapping sheet', phase: 4 })
    }
    if (hasRole) {
      steps.push({ step: 17, label: 'Writing role SOD sheet', phase: 4 })
      steps.push({ step: 18, label: 'Writing role SA sheet',  phase: 4 })
    }
    if (hasUser) {
      steps.push({ step: 19, label: 'Writing user SOD sheet', phase: 4 })
      steps.push({ step: 20, label: 'Writing user SA sheet',  phase: 4 })
    }
    if (withObservation && hasRole) {
      steps.push({ step: 21, label: 'Writing observation tab', phase: 4 })
    }
    steps.push({ step: 22, label: 'Finalising workbook',       phase: 4 })
    return steps
  }, [selectedAnalyses, analysisType, withFp, withObservation])

  const needsUserRole = analysisType === 'user' || analysisType === 'both'

  const canRun =
    roleHierarchyFile !== null &&
    (rulesetFile !== null || rulesetSeeded) &&
    (!needsUserRole || userRoleFile !== null) &&
    (!withFp || fpDbFile !== null || fpDbSeeded) &&
    !isUploading

  // ── Poll for job completion ──────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'running' || !jobId) return
    const interval = setInterval(async () => {
      try {
        const status = await getStatus(jobId)
        setProgress(status.progress)
        setProgressMessage(status.progress_message)
        setCurrentStep(status.step ?? 0)
        if (status.status === 'complete') {
          clearInterval(interval)
          setSummary(status.results as unknown as SODSASummary)
          setStep('results')
          toast.success('SOD & SA analysis complete!')
        } else if (status.status === 'failed') {
          clearInterval(interval)
          setErrors(status.errors)
          setStep('error')
          toast.error(status.errors[0] || 'Analysis failed.')
        }
      } catch { /* keep polling */ }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [step, jobId])

  // Real byte sizes for the bundled seeded files (shown in the upload cards).
  useEffect(() => {
    Promise.all([
      getSeededFileSize('/api/seeded/ruleset.xlsx').catch(() => 0),
      getSeededFileSize('/api/seeded/fp_database.xlsx').catch(() => 0),
    ]).then(([ruleset, fpDb]) => setSeededSizes({ ruleset, fpDb }))
  }, [])

  // ── Fetch summary when results appear ────────────────────────────────────────
  useEffect(() => {
    if (step !== 'results' || !jobId) return
    let cancelled = false
    getSummary(jobId)
      .then(data => {
        if (cancelled) return
        setSodSaSummaryData(data)
        const sheetIds = ALL_SHEET_IDS.filter(id => data.sheet_counts[id])
        if (sheetIds[0]) setActiveTab(sheetIds[0])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [step, jobId])

  // ── Fetch current page on demand ──────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'results' || !jobId || !activeTab) return
    let cancelled = false
    setDataLoading(true)
    getSheetResults(jobId, activeTab, page, pageSize, '', activeFilters)
      .then(res => {
        if (!cancelled) {
          setPageRows(res.data as SODRow[])
          setTotal(res.total)
          setDataLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPageRows([])
          setTotal(0)
          setDataLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [step, jobId, activeTab, page, pageSize, activeFilters])

  // ── Derived ──────────────────────────────────────────────────────────────────
  const analyzedSheetIds = useMemo(() => {
    if (!sodSaSummaryData) return []
    const violations = ALL_SHEET_IDS.filter(id => sodSaSummaryData.sheet_counts[id])
    const groups: string[] = []
    if (sodSaSummaryData.sheet_counts['GROUP_MAPPING']) groups.push('GROUP_MAPPING')
    return [...violations, ...groups]
  }, [sodSaSummaryData])

  const analysisTypeLabel =
    analysisType === 'role' ? 'Role-level only'
    : analysisType === 'user' ? 'User-level only'
    : analysisType === 'both' ? 'Role + User'
    : '—'

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const toggleAnalysis = useCallback((id: string, checked: boolean) => {
    setSelectedAnalyses(prev => checked ? [...prev, id] : prev.filter(a => a !== id))
  }, [])

  const handleContinueToUpload = useCallback(() => {
    if (selectedAnalyses.length === 0) {
      toast.error('Select at least one analysis to run.')
      return
    }
    // Drop the user-role file if no user-level analysis is selected
    if (!selectedAnalyses.some(a => a.startsWith('user_'))) setUserRoleFile(null)
    if (!withFp) { setFpDbFile(null); setFpDbSeeded(false) }
    setStep('upload')
  }, [selectedAnalyses, withFp])

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab)
    setPage(1)
    setActiveFilters({})
  }, [])

  const startRun = useCallback(async (id: string) => {
    setJobId(id)
    await runAnalysis(id, { analysis_type: analysisType, with_fp: withFp, selected_analyses: selectedAnalyses, with_observation: withObservation })
    setStep('running')
    setProgress(0)
    setProgressMessage('Starting SOD & SA analysis…')
  }, [analysisType, withFp, selectedAnalyses, withObservation])

  const handleRunAnalysis = useCallback(async () => {
    if (!roleHierarchyFile || !(rulesetFile || rulesetSeeded) || !analysisType) return
    setIsUploading(true)
    setUploadError('')
    setUploadErrorDetails([])
    setIntegrityItems([])
    setEntitlementWarnings([])
    setRecommendedWarnings([])
    setStagedJobId(null)
    setJobId(null)
    // Show the Processing step while uploading/validating; validation failures
    // drop the user back on the Upload step with the error rendered there.
    setStep('running')
    setProgress(0)
    setCurrentStep(0)
    setProgressMessage('Uploading and validating files…')
    let uploadOk = false
    try {
      const urFile = needsUserRole ? userRoleFile : null
      const fpFile = withFp ? fpDbFile : null
      const seedFp = withFp && fpDbSeeded
      const resp = await uploadFiles(roleHierarchyFile, rulesetFile, urFile, fpFile, rulesetSeeded, seedFp)
      if (resp.errors?.length) {
        setUploadError(resp.errors[0])
        setValidationFailed(true)
        setStep('upload')
        return
      }
      uploadOk = true
      setEntitlementWarnings(resp.entitlement_warnings ?? [])
      const recommended = (resp.warnings ?? []).filter((w) => w.includes('Missing recommended column'))
      const id = resp.job_id
      // If recommended ruleset columns are missing, pause on the upload step and
      // let the user review the warning before proceeding (export won't be client-ready).
      if (recommended.length > 0) {
        setRecommendedWarnings(recommended)
        setStagedJobId(id)
        setStep('upload')
        return
      }
      await startRun(id)
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { message?: string; details?: string[]; integrity_items?: IntegrityItem[] } } })?.response?.data
      setUploadError(data?.message || 'Upload or run failed. Please try again.')
      setUploadErrorDetails(Array.isArray(data?.details) ? data.details : [])
      setIntegrityItems(Array.isArray(data?.integrity_items) ? data.integrity_items : [])
      if (!uploadOk) setValidationFailed(true)
      setStep('upload')
    } finally {
      setIsUploading(false)
    }
  }, [roleHierarchyFile, rulesetFile, rulesetSeeded, userRoleFile, fpDbFile, fpDbSeeded, analysisType, needsUserRole, withFp, startRun])

  const handleProceedAnyway = useCallback(async () => {
    if (!stagedJobId) return
    setIsUploading(true)
    setUploadError('')
    setStep('running')
    setProgress(0)
    setCurrentStep(0)
    setProgressMessage('Starting SOD & SA analysis…')
    try {
      await startRun(stagedJobId)
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { message?: string; details?: string[] } } })?.response?.data
      setUploadError(data?.message || 'Run failed. Please try again.')
      setUploadErrorDetails(Array.isArray(data?.details) ? data.details : [])
      setStep('upload')
    } finally {
      setIsUploading(false)
    }
  }, [stagedJobId, startRun])

  const handleTryAgain = useCallback(async () => {
    if (!jobId || !analysisType) { setStep('upload'); return }
    try {
      await runAnalysis(jobId, { analysis_type: analysisType, with_fp: withFp, selected_analyses: selectedAnalyses, with_observation: withObservation })
      setStep('running')
      setProgress(0)
      setProgressMessage('Restarting SOD & SA analysis…')
      setErrors([])
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          'Failed to restart. Please start over.',
      )
    }
  }, [jobId, analysisType, withFp, selectedAnalyses])

  const handleReset = useCallback(async () => {
    if (jobId) { try { await cancelJob(jobId) } catch { /* ignore */ } }
    setStep('config')
    setWithFp(false)
    setWithObservation(false)
    setSelectedAnalyses(['role_sod', 'role_sa', 'user_sod', 'user_sa'])
    setRoleHierarchyFile(null)
    setRulesetFile(null)
    setUserRoleFile(null)
    setFpDbFile(null)
    setRulesetSeeded(false)
    setFpDbSeeded(false)
    setIsUploading(false)
    setJobId(null)
    setProgress(0)
    setProgressMessage('')
    setCurrentStep(0)
    setSummary(null)
    setErrors([])
    setUploadError('')
    setUploadErrorDetails([])
    setIntegrityItems([])
    setEntitlementWarnings([])
    setValidationFailed(false)
    setStagedJobId(null)
    setRecommendedWarnings([])
    setConfirmReset(false)
    setSodSaSummaryData(null)
    setActiveTab('')
    setPageRows([])
    setPage(1)
    setPageSize(50)
    setTotal(0)
    setDataLoading(false)
  }, [jobId])

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        icon={<Shield size={24} />}
        title="SOD & SA Analysis"
        subtitle="Segregation of Duties and Sensitive Access violation detection at role and user level"
      />

      <div style={{ marginBottom: 20 }}>
        <HelpAccordion title="How to Use This Tool" icon={<Info size={14} color="#2563EB" />} accentColor="#2563EB">
          <HelpStep num={1} text="Choose your scope. Role Analysis needs 2 files and is faster. User Analysis needs 3 files and attributes violations to individual users. Role + User is the recommended default for client deliverables." />
          <HelpStep num={2} text="Upload the Role Hierarchy CSV/XLSX — export from Oracle Fusion via Security Console → Roles → Export Hierarchy. Required columns: TOP_ROLE_CODE, TOP_ROLE_NAME, ROLE_CODE, ROLE_NAME, PRIVILEGE_CODE, PRIVILEGE_NAME." />
          <HelpStep num={3} text="Upload the SOD SA Ruleset XLSX — the standard EY ruleset file. Must contain three sheets: SoD Ruleset, SA Ruleset, and Entitlement to Privilege." />
          <HelpStep num={4} text="If running User Analysis, also upload the User Role Membership CSV/XLSX. Required columns: User Name, Assigned Role Name." />
          <HelpStep num={5} text="If False-Positive Detection is enabled, upload the FP Database XLSX. It must contain two sheets: No_action_Privileges (columns: PRIVILEGE_NAME, False Positive Reason) and WorkArea_Privileges (columns: PRIVILEGE_NAME, WORK_AREA_PRIVILEGE_CODE). PRIVILEGE_NAME must match the privilege codes in the role hierarchy." />
          <HelpStep num={6} text="Click Run Analysis. A progress bar shows the processing milestones. Export the output before closing — results are not stored between sessions." />
        </HelpAccordion>
        <HelpAccordion title="How the Tool Works" icon={<Layers size={14} color="#0F1E3D" />} accentColor="#0F1E3D">
          <p style={{ fontSize: 13, color: '#64748B', lineHeight: 1.7, marginBottom: 12 }}>The engine joins the pre-flattened role hierarchy with the entitlement mapping, then checks every resolved privilege combination against the ruleset:</p>
          <HelpPill label="Hierarchy join" note="The role hierarchy export from Oracle Fusion is already flattened — each row maps a top-level role to an inherited sub-role and its leaf privileges. The engine joins this flat structure with the Entitlement-to-Privilege mapping to resolve each role's full entitlement set." />
          <HelpPill label="SoD detection" note="Each role's entitlement set is checked against the SoD Ruleset. A violation occurs when the role holds privileges that satisfy both the LHS and RHS entitlements of a control. Violations are recorded with the conflicting control and entitlement names." />
          <HelpPill label="SA detection" note="Each individual privilege is checked against the SA Ruleset independently. Sensitive access violations are reported separately from SoD." />
          <HelpPill label="User expansion" note="When User Analysis is included, each user's assigned roles are resolved through the hierarchy and the same SoD and SA checks applied, attributing violations to named users." />
          <HelpPill label="False-positive pipeline" note="When enabled, violations are classified in three levels: Level 1 marks any privilege listed in No_action_Privileges as FP. Level 2 checks if the role or user holds the work-area gatekeeping privilege (WORK_AREA_PRIVILEGE_CODE) required to navigate to the activity — if the privilege is absent, the conflict cannot be exploited and is marked FP. Level 3 classifies remaining violations: one conflicting entitlement → SL (single-leg), two or more → True Conflict." />
          <HelpPill label="User grouping" note="Users sharing an identical role portfolio are assigned a shared group name, reducing noise in large datasets. The User Groups tabs show each group's member roles and the number of users in the group." />
          <p style={{ fontSize: 12.5, color: '#94A3B8', marginTop: 10, lineHeight: 1.6 }}>The progress bar reflects pipeline milestones (mapping, SOD check, SA check, FP pipeline, export), not individual row counts.</p>
        </HelpAccordion>
        <TemplateDownloads templates={[
          ['Role Hierarchy Template',        'XLSX', '/api/templates/sod-sa-analysis/role_hierarchy_template.xlsx'],
          ['SOD SA Ruleset Template',        'XLSX', '/api/templates/sod-sa-analysis/ruleset_template.xlsx'],
          ['User Role Membership Template',  'XLSX', '/api/templates/sod-sa-analysis/user_roles_template.xlsx'],
          ['FP Database Template',           'XLSX', '/api/templates/sod-sa-analysis/fp_database_template.xlsx'],
        ]} />
      </div>

      <StepIndicator steps={STEPS} currentStep={STEP_INDEX[step]} />

      <div className="relative">

        {/* ── Step 0: Configure Analysis ─────────────────────────────────── */}
        {step === 'config' && (
          <div className="slide-in max-w-3xl mx-auto space-y-5">
            <div>
              <h3 className="text-[15px] font-semibold text-gray-800">Select the analyses to run</h3>
              <p className="text-[13px] text-gray-500 mt-1">
                Tick any combination. Choosing a User-level analysis requires the User Role Membership file.
              </p>
            </div>

            {(['Role-level', 'User-level'] as const).map(group => {
              const GroupIcon = group === 'Role-level' ? Layers : Users
              return (
                <div key={group}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <GroupIcon size={15} className="text-gray-400" strokeWidth={1.7} />
                    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.08em]">{group}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {ANALYSIS_OPTIONS.filter(o => o.group === group).map(opt => {
                      const checked = selectedAnalyses.includes(opt.id)
                      return (
                        <label
                          key={opt.id}
                          className={clsx(
                            'flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-shadow duration-150',
                            checked
                              ? 'bg-ey-yellow/5 border-ey-yellow/60 shadow-sm'
                              : 'bg-white border-gray-200 hover:shadow-sm',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={e => toggleAnalysis(opt.id, e.target.checked)}
                            className="mt-0.5 w-4 h-4 accent-ey-yellow shrink-0"
                          />
                          <span className="flex flex-col">
                            <span className="text-[14px] font-medium text-gray-800 leading-tight">{opt.label}</span>
                            <span className="text-[12px] text-gray-500 mt-1 leading-snug">{opt.sublabel}</span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            <label className="flex items-start gap-3 p-4 rounded-xl border border-blue-200 bg-blue-50/60 cursor-pointer">
              <input
                type="checkbox"
                checked={withFp}
                onChange={e => setWithFp(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0"
              />
              <span className="flex flex-col">
                <span className="text-[14px] font-medium text-gray-800 leading-tight">False-Positive Detection</span>
                <span className="text-[12px] text-gray-500 mt-1 leading-snug">
                  Apply 3-level false-positive filtering and user grouping. Requires the FP Database file.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50/60 cursor-pointer">
              <input
                type="checkbox"
                checked={withObservation}
                onChange={e => setWithObservation(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-amber-500 shrink-0"
              />
              <span className="flex flex-col">
                <span className="text-[14px] font-medium text-gray-800 leading-tight">Include Observation Tab</span>
                <span className="text-[12px] text-gray-500 mt-1 leading-snug">
                  Adds an Observations &amp; Recommendations tab to the output, with one block per Control Bucket (SOD only). Requires the Bucket Details sheet in the ruleset.
                </span>
              </span>
            </label>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-4">
                <span className="text-[12px] text-gray-500">
                  Scope: <span className="font-medium text-gray-700">{analysisTypeLabel}</span>
                  {selectedAnalyses.length === 0 && <span className="text-error ml-1">· select at least one</span>}
                </span>
              </div>
              <button
                className="btn-gold"
                disabled={selectedAnalyses.length === 0}
                onClick={handleContinueToUpload}
              >
                Continue to Upload →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Upload Files ───────────────────────────────────────── */}
        {step === 'upload' && analysisType && (
          <div className="slide-in space-y-5">
            <div className={clsx('grid gap-4', withFp ? 'grid-cols-3' : 'grid-cols-2')}>
              <div>
                <p className="label-uppercase mb-2">Role Hierarchy Report</p>
                <FileUpload
                  label="Role Hierarchy CSV / XLSX"
                  hint="Columns: TOP_ROLE_CODE, ROLE_CODE, PRIVILEGE_CODE, etc."
                  status={roleHierarchyFile ? 'success' : 'idle'}
                  fileInfo={roleHierarchyFile ? { name: roleHierarchyFile.name, size: roleHierarchyFile.size } : null}
                  onUpload={(f) => { setRoleHierarchyFile(f); setValidationFailed(false) }}
                  onRemove={() => setRoleHierarchyFile(null)}
                />
              </div>
              <div>
                <p className="label-uppercase mb-2">SOD SA Ruleset</p>
                <FileUpload
                  label="Ruleset XLSX"
                  accept=".xlsx,.xls"
                  hint="Must contain SoD Ruleset, SA Ruleset, Entitlement to Privilege sheets"
                  status={rulesetFile || rulesetSeeded ? 'success' : 'idle'}
                  fileInfo={
                    rulesetFile ? { name: rulesetFile.name, size: rulesetFile.size }
                    : rulesetSeeded ? { name: 'Seeded ruleset (bundled)', size: seededSizes.ruleset }
                    : null
                  }
                  onUpload={(f) => { setRulesetFile(f); setRulesetSeeded(false); setValidationFailed(false) }}
                  onRemove={() => { setRulesetFile(null); setRulesetSeeded(false) }}
                />
                {!rulesetFile && (
                  <button
                    type="button"
                    onClick={() => { setRulesetSeeded(s => !s); setRulesetFile(null); setValidationFailed(false) }}
                    className="mt-2 text-[12px] text-[#3B82F6] hover:underline"
                  >
                    {rulesetSeeded ? 'Use my own file instead' : 'Use seeded ruleset →'}
                  </button>
                )}
              </div>
              {withFp && (
                <div>
                  <p className="label-uppercase mb-2">FP Database</p>
                  <FileUpload
                    label="FP Database XLSX"
                    accept=".xlsx,.xls"
                    hint="Must contain No_action_Privileges and WorkArea_Privileges sheets"
                    status={fpDbFile || fpDbSeeded ? 'success' : 'idle'}
                    fileInfo={
                      fpDbFile ? { name: fpDbFile.name, size: fpDbFile.size }
                      : fpDbSeeded ? { name: 'Seeded FP Database (bundled)', size: seededSizes.fpDb }
                      : null
                    }
                    onUpload={(f) => { setFpDbFile(f); setFpDbSeeded(false); setValidationFailed(false) }}
                    onRemove={() => { setFpDbFile(null); setFpDbSeeded(false) }}
                  />
                  {!fpDbFile && (
                    <button
                      type="button"
                      onClick={() => { setFpDbSeeded(s => !s); setFpDbFile(null); setValidationFailed(false) }}
                      className="mt-2 text-[12px] text-[#3B82F6] hover:underline"
                    >
                      {fpDbSeeded ? 'Use my own file instead' : 'Use seeded FP Database →'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {needsUserRole && (
              <div>
                <p className="label-uppercase mb-2">
                  User Role Membership
                  <span className="ml-2 text-[11px] text-error normal-case font-normal">(required for user analysis)</span>
                </p>
                <FileUpload
                  label="User Role CSV / XLSX"
                  hint="Columns: User Name, Assigned Role Name"
                  status={userRoleFile ? 'success' : 'idle'}
                  fileInfo={userRoleFile ? { name: userRoleFile.name, size: userRoleFile.size } : null}
                  onUpload={(f) => { setUserRoleFile(f); setValidationFailed(false) }}
                  onRemove={() => setUserRoleFile(null)}
                />
              </div>
            )}

            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-[13px] text-gray-600">
              <span>
                <span className="font-medium">Selected:</span>{' '}
                {selectedAnalyses.length} {selectedAnalyses.length === 1 ? 'analysis' : 'analyses'}
                {' · '}
                <span className="font-medium">Scope:</span> {analysisTypeLabel}
                {withFp && <span className="ml-1 text-blue-600">· FP detection on</span>}
                {withObservation && <span className="ml-1 text-amber-600">· Observation tab on</span>}
              </span>
              <button
                className="ml-auto text-[#3B82F6] hover:underline text-[12px]"
                onClick={() => setStep('config')}
              >
                Change
              </button>
            </div>

            {uploadError && (
              <div className="flex items-start gap-2 p-3 bg-error-light rounded border border-error/30 text-sm text-error">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1.5">
                  <span>{uploadError}</span>
                  {integrityItems.length > 0 ? (
                    <div className="space-y-2.5 pt-1">
                      {integrityItems.map((item, i) => (
                        <div key={i}>
                          <p className="font-semibold break-words">• {item.control}</p>
                          <div className="pl-5 space-y-0.5 mt-0.5">
                            <p className="break-words">
                              Privilege{item.privileges.length > 1 ? 's' : ''}: {item.privileges.join(', ')}
                            </p>
                            <p className="break-words">
                              Mapped to both entitlements: <span className="font-semibold">{item.lhs}</span> and{' '}
                              <span className="font-semibold">{item.rhs}</span>
                            </p>
                          </div>
                        </div>
                      ))}
                      <p className="pt-1">
                        These entitlement-to-privilege mappings should be corrected and the file re-uploaded.
                      </p>
                    </div>
                  ) : uploadErrorDetails.length > 0 ? (
                    <ul className="list-disc pl-5 space-y-0.5">
                      {uploadErrorDetails.map((d, i) => (
                        <li key={i} className="break-words">{d}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <button
                  onClick={() => { setUploadError(''); setUploadErrorDetails([]); setIntegrityItems([]) }}
                  className="text-error/60 hover:text-error shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {entitlementWarnings.length > 0 && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 rounded border border-amber-300/50 text-sm text-amber-900">
                <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-600" />
                <div className="flex-1 space-y-2">
                  <div className="font-medium">Missing Entitlement Mappings</div>
                  <div className="text-xs text-amber-800/80 mb-2">
                    The following entitlements are referenced in your controls but have no mapping in the 'Entitlement to Privilege' tab. Controls using these entitlements will not appear in your analysis results.
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {entitlementWarnings.map((warn, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1.5fr] gap-3 p-2 bg-white rounded border border-amber-200/40">
                        <div className="font-medium text-amber-900">{warn.entitlement}</div>
                        <div className="text-amber-800/70 truncate" title={warn.controls.join(', ')}>
                          {warn.controls.join(', ')}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-amber-700 mt-2 pt-1 border-t border-amber-200/40">
                    You can update the mapping tab and re-upload, or continue with the analysis — these controls will be excluded.
                  </div>
                </div>
                <button
                  onClick={() => setEntitlementWarnings([])}
                  className="text-amber-600/60 hover:text-amber-700 shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {recommendedWarnings.length > 0 && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 rounded border border-amber-300/50 text-sm text-amber-900">
                <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-600" />
                <div className="flex-1 space-y-2">
                  <div className="font-medium">Recommended columns missing from your ruleset</div>
                  <div className="text-xs text-amber-800/80 mb-2">
                    Your files passed validation, and the analysis is ready to run. However, the columns listed
                    below are missing and will be populated with placeholder values in the export. You may proceed
                    with the analysis, but for a client-ready export, we recommend adding these columns to your
                    ruleset and re-uploading the files.
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-xs">
                    {recommendedWarnings.map((w, i) => (
                      <li key={i} className="break-words">{w.replace(/^Ruleset -> /, '')}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button className="btn-secondary" onClick={() => setStep('config')}>← Back to Analysis Config</button>
              {stagedJobId ? (
                <button className="btn-gold" disabled={isUploading} onClick={handleProceedAnyway}>
                  {isUploading ? 'Starting…' : 'Proceed with Analysis →'}
                </button>
              ) : (
                <button
                  className="btn-gold"
                  disabled={!canRun || validationFailed}
                  onClick={handleRunAnalysis}
                >
                  {isUploading ? 'Uploading…' : 'Run Analysis →'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Processing ─────────────────────────────────────────── */}
        {step === 'running' && (
          <div className="slide-in relative min-h-[320px]">
            <LoadingOverlay
              message={progressMessage || 'Detecting SOD & SA violations…'}
              progress={progress}
              currentStep={currentStep}
              steps={progressSteps}
              withFp={withFp}
            />
          </div>
        )}

        {/* ── Step 3: Results ────────────────────────────────────────────── */}
        {step === 'results' && summary && (
          <div className="slide-in space-y-5">

            {/* Scope bar */}
            <div className="flex items-center gap-3 flex-wrap px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-[13px] text-gray-600">
              <CheckCircle2 size={14} className="text-success shrink-0" />
              <span className="font-medium">
                {summary.analysis_type === 'role'
                  ? 'Role Analysis'
                  : summary.analysis_type === 'user'
                  ? 'User Analysis'
                  : 'Role + User (Full)'}
              </span>
              {summary.total_roles_analyzed > 0 && (
                <span className="text-gray-400">· {summary.total_roles_analyzed.toLocaleString()} roles analyzed</span>
              )}
              {summary.total_users_analyzed > 0 && (
                <span className="text-gray-400">· {summary.total_users_analyzed.toLocaleString()} users analyzed</span>
              )}
            </div>


            {/* Top Insights */}
            {(() => {
              if (!sodSaSummaryData) return null
              const insightItems: { title: string; items: SODSATopItem[] }[] = [
                ...(sodSaSummaryData.top_roles_sod?.length ? [{ title: 'Top 5 Roles with Most SOD Conflicts', items: sodSaSummaryData.top_roles_sod! }] : []),
                ...(sodSaSummaryData.top_users_sod?.length ? [{ title: 'Top 5 Users with Most SOD Conflicts', items: sodSaSummaryData.top_users_sod! }] : []),
                ...(sodSaSummaryData.top_sod_controls?.length ? [{ title: 'Top 5 SOD Controls with Most Roles in Violation', items: sodSaSummaryData.top_sod_controls! }] : []),
                ...(sodSaSummaryData.top_sa_controls?.length ? [{ title: 'Top 5 SA Controls with Most Roles in Violation', items: sodSaSummaryData.top_sa_controls! }] : []),
              ]
              if (insightItems.length === 0) return null
              return (
                <div>
                  <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.08em] mb-3">Top Insights</div>
                  <div className="grid grid-cols-2 gap-4">
                    {insightItems.map(({ title, items }) => (
                      <InsightCard key={title} title={title} items={items} />
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Tabbed DataTable */}
            {sodSaSummaryData && analyzedSheetIds.length > 0 && (
              <div className="card p-0 overflow-hidden">
                {/* Tab bar */}
                <div className="flex items-center border-b border-gray-200 bg-white">
                  <div className="flex flex-1">
                    {analyzedSheetIds.map(id => {
                      const count = sodSaSummaryData.sheet_counts[id]?.total_violations ?? 0
                      return (
                        <button
                          key={id}
                          onClick={() => handleTabChange(id)}
                          className={clsx(
                            'flex items-center gap-2 px-5 py-3 text-[13px] font-medium transition-colors border-b-2',
                            activeTab === id
                              ? 'border-[#EAB308] text-[#0F1E3D] font-semibold'
                              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                          )}
                        >
                          {SHEET_LABELS[id]}
                          <span className={clsx(
                            'text-[11px] px-1.5 py-0.5 rounded-full font-semibold',
                            activeTab === id ? 'bg-[#EAB308]/15 text-[#B45309]' : 'bg-gray-100 text-gray-400',
                          )}>
                            {count.toLocaleString()}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <button
                    onClick={() => { setActiveFilters({}); setPage(1) }}
                    disabled={!hasActiveFilters}
                    className="flex items-center gap-1 mr-4 text-[11px] text-gray-500 hover:text-gray-700 transition-colors disabled:text-gray-300 disabled:cursor-default"
                  >
                    <X size={11} /> Clear All Filters
                  </button>
                </div>

                {/* Table */}
                <div className="p-4">
                  <DataTable
                    data={pageRows}
                    columns={(() => {
                      if (activeTab.startsWith('GROUP')) return GROUP_MAPPING_COLUMNS
                      const isSod = activeTab === 'ROLE_SOD' || activeTab === 'USER_SOD'
                      const base = activeTab.startsWith('USER') ? USER_COLUMNS : ROLE_COLUMNS
                      if (!withObservation || !isSod) return base
                      const bucketCol: ColumnDef<SODRow> = { id: 'CONTROL_BUCKET', accessorKey: 'CONTROL_BUCKET', header: 'Control Bucket' }
                      return [base[0], bucketCol, ...base.slice(1)]
                    })()}
                    defaultSorting={
                      activeTab.startsWith('GROUP')
                        ? [{ id: 'GROUP_NAME', desc: false }]
                        : activeTab.startsWith('USER')
                        ? USER_DEFAULT_SORT
                        : ROLE_DEFAULT_SORT
                    }
                    isLoading={dataLoading}
                    emptyMessage="No violations found"
                    maxHeight="460px"
                    serverSide={{
                      total,
                      page,
                      pageSize,
                      onPageChange: (p) => setPage(p),
                      onPageSizeChange: (sz) => { setPageSize(sz); setPage(1) },
                    }}
                    serverSideFilters={{
                      values: activeFilters,
                      onChange: (colId, vals) => { setActiveFilters(prev => ({ ...prev, [colId]: vals })); setPage(1) },
                      onFetchOptions: (colId) => {
                        const others = Object.fromEntries(Object.entries(activeFilters).filter(([k]) => k !== colId))
                        return getFilterOptions(jobId!, activeTab, colId, others)
                      },
                    }}
                  />
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-1">
              <button
                className="btn-secondary flex items-center gap-2"
                onClick={() => setConfirmReset(true)}
              >
                <RefreshCw size={14} /> Start New Analysis
              </button>
              <DownloadButton
                onClick={async () => {
                  const now = new Date()
                  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
                  return downloadResults(jobId!, `SOD_SA_Analysis_${summary.analysis_type}_${ts}.xlsx`)
                }}
              />
            </div>
          </div>
        )}

        {/* ── Error ──────────────────────────────────────────────────────── */}
        {step === 'error' && (
          <div className="slide-in">
            <div className="card border-error/30 bg-error-light/20">
              <div className="flex gap-3">
                <AlertCircle size={20} className="text-error shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-error mb-1">Analysis Failed</p>
                  {errors.map((e, i) => (
                    <p key={i} className="text-[13px] text-error/80">{e}</p>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button className="btn-primary" onClick={handleTryAgain}>Try Again</button>
                <button className="btn-secondary" onClick={handleReset}>← Start Over</button>
              </div>
            </div>
          </div>
        )}

      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Start New Analysis?"
        message="This will clear the current results and return to the type selection step."
        confirmLabel="Yes, Start Over"
        cancelLabel="Keep Results"
        destructive
        onConfirm={handleReset}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}
