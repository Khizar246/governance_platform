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
import LoadingOverlay from '../components/common/LoadingOverlay'
import DownloadButton from '../components/common/DownloadButton'
import ConfirmDialog from '../components/common/ConfirmDialog'
import {
  uploadFiles, runAnalysis, getStatus, downloadResults, cancelJob,
  getSummary, getSheetResults, getFilterOptions,
} from '../api/sodSaAnalysis'
import type { SODSASummaryData, SODSATopItem } from '../api/sodSaAnalysis'
import HelpAccordion, { HelpStep, HelpPill, TemplateDownloads } from '../components/common/HelpAccordion'
import type { SODSASummary } from '../types'
import { POLL_INTERVAL_MS } from '../utils/constants'

type Step = 'type' | 'upload' | 'running' | 'results' | 'error'
type AnalysisType = 'role' | 'user' | 'both'
type SODRow = Record<string, unknown>

const STEPS = ['Analysis Type', 'Upload Files', 'Processing', 'Results']
const STEP_INDEX: Record<Step, number> = { type: 0, upload: 1, running: 2, results: 3, error: 0 }

type Stage = { label: string; minPercent: number }

const ALL_SHEET_IDS = ['ROLE_SOD', 'ROLE_SA', 'USER_SOD', 'USER_SA']
const SHEET_LABELS: Record<string, string> = {
  ROLE_SOD: 'Role SoD', ROLE_SA: 'Role SA', USER_SOD: 'User SoD', USER_SA: 'User SA',
}

const TYPE_CARDS = [
  {
    id: 'role' as AnalysisType,
    icon: Shield,
    title: 'Role Analysis',
    description: 'Detect SOD and SA violations at the role level. Requires Role Hierarchy and Ruleset files only.',
    accentColor: '#EAB308',
    iconBg: 'bg-yellow-50',
    iconColor: 'text-[#EAB308]',
    meta: '2 files required',
    recommended: false,
  },
  {
    id: 'user' as AnalysisType,
    icon: Users,
    title: 'User Analysis',
    description: 'Detect violations assigned to specific users. Requires all three files including User Role Membership.',
    accentColor: '#3B82F6',
    iconBg: 'bg-blue-50',
    iconColor: 'text-[#3B82F6]',
    meta: '3 files required',
    recommended: false,
  },
  {
    id: 'both' as AnalysisType,
    icon: Layers,
    title: 'Role + User',
    description: 'Full analysis: detect violations at both role and user level. Most comprehensive option.',
    accentColor: '#22C55E',
    iconBg: 'bg-green-50',
    iconColor: 'text-[#22C55E]',
    meta: '3 files required',
    recommended: true,
  },
]

// ── Column definitions ─────────────────────────────────────────────────────────

const ROLE_COLUMNS: ColumnDef<SODRow>[] = [
  { id: 'CONTROL_NAME',               accessorKey: 'CONTROL_NAME',               header: 'Control Name' },
  { id: 'ENTITLEMENT',                accessorKey: 'ENTITLEMENT',                header: 'Entitlement' },
  { id: 'ROLE_DISPLAY_NAME',          accessorKey: 'ROLE_DISPLAY_NAME',          header: 'Role Name' },
  { id: 'INHERITED_ROLE_DISPLAY_NAME',accessorKey: 'INHERITED_ROLE_DISPLAY_NAME',header: 'Inherited Role' },
  { id: 'PRIVILEGE_DISPLAY_NAME',     accessorKey: 'PRIVILEGE_DISPLAY_NAME',     header: 'Privilege Name' },
]

const USER_COLUMNS: ColumnDef<SODRow>[] = [
  { id: 'CONTROL_NAME',               accessorKey: 'CONTROL_NAME',               header: 'Control Name' },
  { id: 'ENTITLEMENT',                accessorKey: 'ENTITLEMENT',                header: 'Entitlement' },
  { id: 'ROLE_DISPLAY_NAME',          accessorKey: 'ROLE_DISPLAY_NAME',          header: 'Role Name' },
  { id: 'INHERITED_ROLE_DISPLAY_NAME',accessorKey: 'INHERITED_ROLE_DISPLAY_NAME',header: 'Inherited Role' },
  { id: 'PRIVILEGE_DISPLAY_NAME',     accessorKey: 'PRIVILEGE_DISPLAY_NAME',     header: 'Privilege Name' },
  { id: 'USER_NAME',                  accessorKey: 'USER_NAME',                  header: 'User Name' },
]

const ROLE_DEFAULT_SORT = [
  { id: 'CONTROL_NAME',                desc: false },
  { id: 'ENTITLEMENT',                 desc: false },
  { id: 'ROLE_DISPLAY_NAME',           desc: false },
  { id: 'INHERITED_ROLE_DISPLAY_NAME', desc: false },
  { id: 'PRIVILEGE_DISPLAY_NAME',      desc: false },
]

const USER_DEFAULT_SORT = [
  { id: 'CONTROL_NAME',                desc: false },
  { id: 'ENTITLEMENT',                 desc: false },
  { id: 'ROLE_DISPLAY_NAME',           desc: false },
  { id: 'INHERITED_ROLE_DISPLAY_NAME', desc: false },
  { id: 'PRIVILEGE_DISPLAY_NAME',      desc: false },
  { id: 'USER_NAME',                   desc: false },
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
  const [step, setStep] = useState<Step>('type')
  const [analysisType, setAnalysisType] = useState<AnalysisType | null>(null)
  const [roleHierarchyFile, setRoleHierarchyFile] = useState<File | null>(null)
  const [rulesetFile, setRulesetFile] = useState<File | null>(null)
  const [userRoleFile, setUserRoleFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [summary, setSummary] = useState<SODSASummary | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [uploadError, setUploadError] = useState('')
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

  const stages = useMemo((): Stage[] => {
    if (analysisType === 'role') return [
      { label: 'Initialising',                    minPercent: 0  },
      { label: 'Building Entitlement Mappings',   minPercent: 5  },
      { label: 'Checking SOD Violations',         minPercent: 30 },
      { label: 'Checking SA Violations',          minPercent: 65 },
      { label: 'Finalising',                      minPercent: 95 },
    ]
    if (analysisType === 'user') return [
      { label: 'Initialising',                     minPercent: 0  },
      { label: 'Expanding User-Role Memberships',  minPercent: 5  },
      { label: 'Building User Entitlements',       minPercent: 10 },
      { label: 'SOD Violations (chunked)',         minPercent: 20 },
      { label: 'SA Violations (chunked)',          minPercent: 58 },
      { label: 'Finalising',                       minPercent: 95 },
    ]
    return [  // 'both'
      { label: 'Initialising',                      minPercent: 0  },
      { label: 'Role — Entitlement Mappings',        minPercent: 2  },
      { label: 'Role — SOD & SA Checks',             minPercent: 15 },
      { label: 'User — Expanding Memberships',       minPercent: 52 },
      { label: 'User — Building Entitlements',       minPercent: 55 },
      { label: 'User — SOD Violations (chunked)',    minPercent: 60 },
      { label: 'User — SA Violations (chunked)',     minPercent: 79 },
    ]
  }, [analysisType])

  const needsUserRole = analysisType === 'user' || analysisType === 'both'

  const canRun =
    roleHierarchyFile !== null &&
    rulesetFile !== null &&
    (!needsUserRole || userRoleFile !== null) &&
    !isUploading

  // ── Poll for job completion ──────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'running' || !jobId) return
    const interval = setInterval(async () => {
      try {
        const status = await getStatus(jobId)
        setProgress(status.progress)
        setProgressMessage(status.progress_message)
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
  const analyzedSheetIds = useMemo(
    () => ALL_SHEET_IDS.filter(id => sodSaSummaryData?.sheet_counts[id]),
    [sodSaSummaryData],
  )

  const selectedCard = TYPE_CARDS.find(c => c.id === analysisType)

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleSelectType = useCallback((t: AnalysisType) => {
    setAnalysisType(t)
    if (t === 'role') setUserRoleFile(null)
    setStep('upload')
  }, [])

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab)
    setPage(1)
    setActiveFilters({})
  }, [])

  const handleRunAnalysis = useCallback(async () => {
    if (!roleHierarchyFile || !rulesetFile || !analysisType) return
    setIsUploading(true)
    setUploadProgress(0)
    setUploadError('')
    try {
      const urFile = needsUserRole ? userRoleFile : null
      const resp = await uploadFiles(roleHierarchyFile, rulesetFile, urFile, setUploadProgress)
      if (resp.errors?.length) { setUploadError(resp.errors[0]); return }
      const id = resp.job_id
      setJobId(id)
      await runAnalysis(id, { analysis_type: analysisType })
      setStep('running')
      setProgress(0)
      setProgressMessage('Starting SOD & SA analysis…')
    } catch (err: unknown) {
      setUploadError(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          'Upload or run failed. Please try again.',
      )
    } finally {
      setIsUploading(false)
    }
  }, [roleHierarchyFile, rulesetFile, userRoleFile, analysisType, needsUserRole])

  const handleTryAgain = useCallback(async () => {
    if (!jobId || !analysisType) { setStep('upload'); return }
    try {
      await runAnalysis(jobId, { analysis_type: analysisType })
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
  }, [jobId, analysisType])

  const handleReset = useCallback(async () => {
    if (jobId) { try { await cancelJob(jobId) } catch { /* ignore */ } }
    setStep('type')
    setAnalysisType(null)
    setRoleHierarchyFile(null)
    setRulesetFile(null)
    setUserRoleFile(null)
    setUploadProgress(0)
    setIsUploading(false)
    setJobId(null)
    setProgress(0)
    setProgressMessage('')
    setSummary(null)
    setErrors([])
    setUploadError('')
    setConfirmReset(false)
    setSodSaSummaryData(null)
    setActiveTab('')
    setPageRows([])
    setPage(1)
    setPageSize(50)
    setTotal(0)
    setDataLoading(false)
    setFilterResetKey(0)
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
          <HelpStep num={2} text="Upload the Role Hierarchy CSV/XLSX — export from Oracle Fusion via Security Console → Roles → Export Hierarchy. Required columns: TOP_ROLE_CODE, TOP_ROLE_NAME, ROLE_TYPE_CODE, ROLE_CODE, ROLE_NAME, PRIVILEGE_CODE, PRIVILEGE_NAME." />
          <HelpStep num={3} text="Upload the SOD SA Ruleset XLSX — the standard EY ruleset file. Must contain three sheets: SoD Ruleset, SA Ruleset, and Entitlement to Privilege." />
          <HelpStep num={4} text="If running User Analysis, also upload the User Role Membership CSV. Required columns: User Name, Assigned Role Name." />
          <HelpStep num={5} text="Click Run Analysis. A progress bar shows chunked processing. Export the output before closing — results are not stored between sessions." />
        </HelpAccordion>
        <HelpAccordion title="How the Tool Works" icon={<Layers size={14} color="#0F1E3D" />} accentColor="#0F1E3D">
          <p style={{ fontSize: 13, color: '#64748B', lineHeight: 1.7, marginBottom: 12 }}>The engine flattens the role hierarchy and checks every resolved privilege combination against the ruleset:</p>
          <HelpPill label="Hierarchy flattening" note="Starting from each top-level role, the tool recursively resolves all inherited sub-roles down to leaf privileges, producing a flat privilege set per role." />
          <HelpPill label="SoD detection" note="Every pair of privileges within a role's flat set is checked against the SoD Ruleset. Matching pairs are recorded as violations with the conflicting function names." />
          <HelpPill label="SA detection" note="Each individual privilege is checked against the SA Ruleset independently. Sensitive access violations are reported separately from SoD." />
          <HelpPill label="User expansion" note="When User Analysis is included, each user's assigned roles are resolved through the hierarchy and the same checks applied, attributing violations to named users." />
          <p style={{ fontSize: 12.5, color: '#94A3B8', marginTop: 10, lineHeight: 1.6 }}>Large hierarchies are processed in chunks to avoid memory limits — the progress bar reflects chunk completion, not individual row count.</p>
        </HelpAccordion>
        <TemplateDownloads templates={[
          ['Role Hierarchy Template',        'XLSX', '/api/templates/sod-sa-analysis/role_hierarchy_template.xlsx'],
          ['SOD SA Ruleset Template',         'XLSX', '/api/templates/sod-sa-analysis/ruleset_template.xlsx'],
          ['User Role Membership Template',   'XLSX', '/api/templates/sod-sa-analysis/user_roles_template.xlsx'],
        ]} />
      </div>

      <StepIndicator steps={STEPS} currentStep={STEP_INDEX[step]} />

      <div className="relative">

        {/* ── Step 0: Analysis Type ──────────────────────────────────────── */}
        {step === 'type' && (
          <div className="slide-in grid grid-cols-3 gap-4">
            {TYPE_CARDS.map(({ id, icon: Icon, title, description, accentColor, iconBg, iconColor, meta, recommended }) => (
              <button
                key={id}
                onClick={() => handleSelectType(id)}
                style={{ borderLeftColor: accentColor }}
                className={clsx(
                  'relative flex flex-col text-left p-6 rounded-xl cursor-pointer',
                  'bg-white border border-gray-200 border-l-[3px] shadow-sm',
                  'focus:outline-none hover:shadow-md transition-shadow duration-150',
                  analysisType === id ? 'ring-2 ring-ey-yellow/60 shadow-md' : '',
                )}
              >
                {recommended && (
                  <span className="absolute top-3 right-3 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-ey-yellow text-gray-900 leading-none">
                    Recommended
                  </span>
                )}
                <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center mb-4', iconBg)}>
                  <Icon size={20} className={iconColor} strokeWidth={1.5} />
                </div>
                <h3 className="text-[15px] font-semibold text-gray-800 mb-2">{title}</h3>
                <p className="text-[13px] text-gray-500 leading-relaxed flex-1">{description}</p>
                <div className="flex items-center justify-between mt-4">
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{meta}</span>
                  <span className="text-[13px] text-gray-400">Select →</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── Step 1: Upload Files ───────────────────────────────────────── */}
        {step === 'upload' && analysisType && (
          <div className="slide-in space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="label-uppercase mb-2">Role Hierarchy Report</p>
                <FileUpload
                  label="Role Hierarchy CSV / XLSX"
                  hint="Columns: TOP_ROLE_CODE, ROLE_CODE, PRIVILEGE_CODE, etc."
                  status={roleHierarchyFile ? 'success' : 'idle'}
                  fileInfo={roleHierarchyFile ? { name: roleHierarchyFile.name, size: roleHierarchyFile.size } : null}
                  onUpload={setRoleHierarchyFile}
                  onRemove={() => setRoleHierarchyFile(null)}
                />
              </div>
              <div>
                <p className="label-uppercase mb-2">SOD SA Ruleset</p>
                <FileUpload
                  label="Ruleset XLSX"
                  accept=".xlsx,.xls"
                  hint="Must contain SoD Ruleset, SA Ruleset, Entitlement to Privilege sheets"
                  status={rulesetFile ? 'success' : 'idle'}
                  fileInfo={rulesetFile ? { name: rulesetFile.name, size: rulesetFile.size } : null}
                  onUpload={setRulesetFile}
                  onRemove={() => setRulesetFile(null)}
                />
              </div>
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
                  onUpload={setUserRoleFile}
                  onRemove={() => setUserRoleFile(null)}
                />
              </div>
            )}

            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-[13px] text-gray-600">
              <span>
                <span className="font-medium">Analysis Type:</span>{' '}
                {selectedCard?.title}
              </span>
              <button
                className="ml-auto text-[#3B82F6] hover:underline text-[12px]"
                onClick={() => setStep('type')}
              >
                Change
              </button>
            </div>

            {isUploading && (
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Validating files and ruleset structure…</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-300 ease-out"
                    style={{ width: `${uploadProgress}%`, background: '#EAB308' }}
                  />
                </div>
              </div>
            )}

            {uploadError && (
              <div className="flex items-start gap-2 p-3 bg-error-light rounded border border-error/30 text-sm text-error">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span className="flex-1">{uploadError}</span>
                <button onClick={() => setUploadError('')} className="text-error/60 hover:text-error shrink-0">
                  <X size={14} />
                </button>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button className="btn-secondary" onClick={() => setStep('type')}>← Change Type</button>
              <button
                className="btn-gold"
                disabled={!canRun || isUploading}
                onClick={handleRunAnalysis}
              >
                {isUploading ? 'Uploading…' : 'Run Analysis →'}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Processing ─────────────────────────────────────────── */}
        {step === 'running' && (
          <div className="slide-in relative min-h-[320px]">
            <LoadingOverlay
              message={progressMessage || 'Detecting SOD & SA violations…'}
              progress={progress}
              stages={analysisType ? stages : undefined}
              progressMessage={progressMessage}
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
                    columns={activeTab.startsWith('USER') ? USER_COLUMNS : ROLE_COLUMNS}
                    defaultSorting={activeTab.startsWith('USER') ? USER_DEFAULT_SORT : ROLE_DEFAULT_SORT}
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
