import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Shield, AlertCircle, CheckCircle2, RefreshCw, X,
  Users, Layers, BarChart2, Info,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Cell, ResponsiveContainer,
} from 'recharts'
import PageHeader from '../components/layout/PageHeader'
import FileUpload from '../components/common/FileUpload'
import StepIndicator from '../components/common/StepIndicator'
import StatCard from '../components/common/StatCard'
import LoadingOverlay from '../components/common/LoadingOverlay'
import DownloadButton from '../components/common/DownloadButton'
import ConfirmDialog from '../components/common/ConfirmDialog'
import { uploadFiles, runAnalysis, getStatus, downloadResults, cancelJob } from '../api/sodSaAnalysis'
import HelpAccordion, { HelpStep, HelpPill, TemplateDownloads } from '../components/common/HelpAccordion'
import type { SODSASummary } from '../types'
import { POLL_INTERVAL_MS } from '../utils/constants'

type Step = 'type' | 'upload' | 'running' | 'results' | 'error'
type AnalysisType = 'role' | 'user' | 'both'

const STEPS = ['Analysis Type', 'Upload Files', 'Processing', 'Results']
const STEP_INDEX: Record<Step, number> = { type: 0, upload: 1, running: 2, results: 3, error: 0 }

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

  const needsUserRole = analysisType === 'user' || analysisType === 'both'

  const canRun =
    roleHierarchyFile !== null &&
    rulesetFile !== null &&
    (!needsUserRole || userRoleFile !== null) &&
    !isUploading

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

  const handleSelectType = useCallback((t: AnalysisType) => {
    setAnalysisType(t)
    if (t === 'role') setUserRoleFile(null)
    setStep('upload')
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
  }, [jobId])

  const chartData = useMemo(() => {
    if (!summary) return []
    const items: { name: string; count: number }[] = []
    if (summary.analysis_type !== 'user') {
      items.push({ name: 'SOD Roles', count: summary.violations.role_sod })
      items.push({ name: 'SA Roles',  count: summary.violations.role_sa })
    }
    if (summary.analysis_type !== 'role') {
      items.push({ name: 'SOD Users', count: summary.violations.user_sod })
      items.push({ name: 'SA Users',  count: summary.violations.user_sa })
    }
    return items
  }, [summary])

  const selectedCard = TYPE_CARDS.find(c => c.id === analysisType)

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
        <TemplateDownloads templates={[['Role Hierarchy Template', 'CSV'], ['SOD SA Ruleset Template', 'XLSX'], ['User Role Membership Template', 'CSV']]} />
      </div>

      <StepIndicator steps={STEPS} currentStep={STEP_INDEX[step]} />

      <div className="relative">

          {/* ── Step 0: Analysis Type ─────────────────────────────────────── */}
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

          {/* ── Step 1: Upload Files ──────────────────────────────────────── */}
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

          {/* ── Step 2: Processing ────────────────────────────────────────── */}
          {step === 'running' && (
            <div className="slide-in relative min-h-[320px]">
              <LoadingOverlay
                message={progressMessage || 'Detecting SOD & SA violations…'}
                progress={progress}
              />
            </div>
          )}

          {/* ── Step 3: Results ───────────────────────────────────────────── */}
          {step === 'results' && summary && (
            <div className="slide-in space-y-5">
              {/* Scope summary bar */}
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
                  <span className="text-gray-400">· {summary.total_roles_analyzed.toLocaleString()} roles</span>
                )}
                {summary.total_users_analyzed > 0 && (
                  <span className="text-gray-400">· {summary.total_users_analyzed.toLocaleString()} users</span>
                )}
              </div>

              {/* StatCards */}
              <div className={clsx(
                'grid gap-4',
                summary.analysis_type === 'both' ? 'grid-cols-4' : 'grid-cols-2',
              )}>
                {summary.analysis_type !== 'user' && (
                  <>
                    <StatCard
                      value={summary.violations.role_sod}
                      label="SOD Role Violations"
                      badge={{
                        text: summary.violations.role_sod > 0 ? 'Violations Found' : 'Clean',
                        variant: summary.violations.role_sod > 0 ? 'error' : 'success',
                      }}
                    />
                    <StatCard
                      value={summary.violations.role_sa}
                      label="SA Role Violations"
                      badge={{
                        text: summary.violations.role_sa > 0 ? 'Violations Found' : 'Clean',
                        variant: summary.violations.role_sa > 0 ? 'error' : 'success',
                      }}
                    />
                  </>
                )}
                {summary.analysis_type !== 'role' && (
                  <>
                    <StatCard
                      value={summary.violations.user_sod}
                      label="SOD User Violations"
                      badge={{
                        text: summary.violations.user_sod > 0 ? 'Violations Found' : 'Clean',
                        variant: summary.violations.user_sod > 0 ? 'error' : 'success',
                      }}
                    />
                    <StatCard
                      value={summary.violations.user_sa}
                      label="SA User Violations"
                      badge={{
                        text: summary.violations.user_sa > 0 ? 'Violations Found' : 'Clean',
                        variant: summary.violations.user_sa > 0 ? 'error' : 'success',
                      }}
                    />
                  </>
                )}
              </div>

              {/* Horizontal BarChart */}
              <div className="card">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart2 size={16} className="text-gray-400" />
                  <span className="text-card-title">Violation Breakdown</span>
                  <span className="ml-auto text-body-sm text-gray-400">Distinct entities with violations</span>
                </div>
                <ResponsiveContainer width="100%" height={chartData.length * 52 + 16}>
                  <BarChart
                    layout="vertical"
                    data={chartData}
                    barSize={20}
                    margin={{ top: 4, right: 48, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E4E4E7" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: '#A1A1AA' }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={88}
                      tick={{ fontSize: 12, fill: '#71717A' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <RechartsTooltip
                      contentStyle={{ background: '#fff', border: '1px solid #E4E4E7', borderRadius: 6, fontSize: 13 }}
                      formatter={(v: number) => [v.toLocaleString(), 'Violations']}
                      cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {chartData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.count > 0 ? '#EF4444' : '#22C55E'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

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

          {/* ── Error ─────────────────────────────────────────────────────── */}
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
