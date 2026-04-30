import { useState, useEffect, useCallback } from 'react'
import { Shield, AlertCircle, RefreshCw, X, Users, Layers } from 'lucide-react'
import { toast } from 'sonner'
import PageHeader from '../components/layout/PageHeader'
import FileUpload from '../components/common/FileUpload'
import StepIndicator from '../components/common/StepIndicator'
import StatCard from '../components/common/StatCard'
import LoadingOverlay from '../components/common/LoadingOverlay'
import DownloadButton from '../components/common/DownloadButton'
import ConfirmDialog from '../components/common/ConfirmDialog'
import { uploadFiles, runAnalysis, getStatus, downloadResults, cancelJob } from '../api/sodSaAnalysis'
import type { SODSASummary } from '../types'
import { POLL_INTERVAL_MS } from '../utils/constants'

type Step = 'type' | 'upload' | 'running' | 'results' | 'error'
type AnalysisType = 'role' | 'user' | 'both'

const STEPS = ['Analysis Type', 'Upload Files', 'Processing', 'Results']
const STEP_INDEX: Record<Step, number> = { type: 0, upload: 1, running: 2, results: 3, error: 0 }

interface TypeOption {
  value: AnalysisType
  label: string
  hint: string
  icon: React.ReactNode
  borderActive: string
  iconActive: string
}

const TYPE_OPTIONS: TypeOption[] = [
  {
    value: 'role',
    label: 'Role Analysis',
    hint: 'Detect SOD and SA violations at the role level. Requires Role Hierarchy and Ruleset files only.',
    icon: <Shield size={28} />,
    borderActive: 'border-warning',
    iconActive: 'text-warning',
  },
  {
    value: 'user',
    label: 'User Analysis',
    hint: 'Detect violations assigned to specific users. Requires all three files including User Role Membership.',
    icon: <Users size={28} />,
    borderActive: 'border-info',
    iconActive: 'text-info',
  },
  {
    value: 'both',
    label: 'Role + User',
    hint: 'Full analysis: detect violations at both role and user level. Most comprehensive option.',
    icon: <Layers size={28} />,
    borderActive: 'border-success',
    iconActive: 'text-success',
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

  const needsUserRole = analysisType === 'user' || analysisType === 'both'

  const canRun =
    roleHierarchyFile !== null &&
    rulesetFile !== null &&
    (!needsUserRole || userRoleFile !== null) &&
    !isUploading

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

  return (
    <div>
      <PageHeader
        icon={<Shield size={24} />}
        title="SOD & SA Analysis"
        subtitle="Segregation of Duties and Sensitive Access violation detection at role and user level"
      />

      <StepIndicator steps={STEPS} currentStep={STEP_INDEX[step]} />

      {/* ── Step 0: Analysis Type ── */}
      {step === 'type' && (
        <div className="space-y-5">
          <p className="text-sm text-gray-500">
            Select the scope of your analysis to determine which files are required.
          </p>
          <div className="grid grid-cols-3 gap-4">
            {TYPE_OPTIONS.map(({ value, label, hint, icon, borderActive, iconActive }) => (
              <button
                key={value}
                onClick={() => handleSelectType(value)}
                className={`flex flex-col items-start p-5 rounded-lg border-2 text-left transition-all duration-150 bg-white hover:shadow-card-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ey-yellow focus-visible:ring-offset-2 ${
                  analysisType === value
                    ? `${borderActive} shadow-card`
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <span className={`mb-3 ${analysisType === value ? iconActive : 'text-gray-400'}`}>
                  {icon}
                </span>
                <span className="text-[15px] font-semibold text-gray-800 mb-1.5">{label}</span>
                <span className="text-[13px] text-gray-500 leading-relaxed">{hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 1: Upload Files ── */}
      {step === 'upload' && analysisType && (
        <div className="space-y-5">
          {/* Config summary bar */}
          <div className="flex items-center gap-3 px-4 py-3 bg-gray-100 rounded-lg">
            <span className="label-uppercase">Analysis Type:</span>
            <span className="text-sm font-semibold text-gray-800">
              {analysisType === 'role'
                ? 'Role Analysis'
                : analysisType === 'user'
                ? 'User Analysis'
                : 'Role + User (Full)'}
            </span>
            <button
              onClick={() => setStep('type')}
              className="ml-auto text-xs text-gray-400 hover:text-gray-600 underline transition-colors"
            >
              Change
            </button>
          </div>

          {/* Required files */}
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

          {/* Conditional user-role file */}
          {needsUserRole && (
            <div>
              <p className="label-uppercase mb-2">
                User Role Membership
                <span className="ml-2 text-[11px] text-error normal-case font-normal">
                  (required for user analysis)
                </span>
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

          {/* Upload progress */}
          {isUploading && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Validating files and ruleset structure…</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-warning transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Upload error */}
          {uploadError && (
            <div className="flex items-start gap-2 p-3 bg-error-light rounded border border-error/30 text-sm text-error">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span className="flex-1">{uploadError}</span>
              <button
                onClick={() => setUploadError('')}
                className="text-error/60 hover:text-error shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button className="btn-secondary" onClick={() => setStep('type')}>
              ← Back
            </button>
            <button className="btn-primary" disabled={!canRun} onClick={handleRunAnalysis}>
              {isUploading ? 'Uploading…' : 'Run Analysis →'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Processing ── */}
      {step === 'running' && (
        <div className="relative min-h-[320px]">
          <LoadingOverlay
            message={progressMessage || 'Detecting SOD & SA violations…'}
            progress={progress}
          />
        </div>
      )}

      {/* ── Step 3: Results ── */}
      {step === 'results' && summary && (
        <div className="space-y-5">
          {/* Scope summary bar */}
          <div className="flex items-center gap-3 flex-wrap px-4 py-3 bg-gray-100 rounded-lg">
            <span className="label-uppercase">Analysis Scope:</span>
            <span className="text-sm font-semibold text-gray-800">
              {summary.analysis_type === 'role'
                ? 'Role Analysis'
                : summary.analysis_type === 'user'
                ? 'User Analysis'
                : 'Role + User (Full)'}
            </span>
            {summary.total_roles_analyzed > 0 && (
              <span className="text-sm text-gray-500">
                · {summary.total_roles_analyzed.toLocaleString()} roles analysed
              </span>
            )}
            {summary.total_users_analyzed > 0 && (
              <span className="text-sm text-gray-500">
                · {summary.total_users_analyzed.toLocaleString()} users analysed
              </span>
            )}
          </div>

          {/* SOD violations */}
          <div className="card">
            <p className="text-sm font-semibold text-gray-800 mb-3">Segregation of Duties (SOD)</p>
            <div className="grid grid-cols-2 gap-3">
              {summary.analysis_type !== 'user' && (
                <StatCard
                  value={summary.violations.role_sod}
                  label="Role Violations"
                  badge={{
                    text: summary.violations.role_sod > 0 ? 'Violations Found' : 'Clean',
                    variant: summary.violations.role_sod > 0 ? 'error' : 'success',
                  }}
                />
              )}
              {summary.analysis_type !== 'role' && (
                <StatCard
                  value={summary.violations.user_sod}
                  label="User Violations"
                  badge={{
                    text: summary.violations.user_sod > 0 ? 'Violations Found' : 'Clean',
                    variant: summary.violations.user_sod > 0 ? 'error' : 'success',
                  }}
                />
              )}
            </div>
          </div>

          {/* SA violations */}
          <div className="card">
            <p className="text-sm font-semibold text-gray-800 mb-3">Sensitive Access (SA)</p>
            <div className="grid grid-cols-2 gap-3">
              {summary.analysis_type !== 'user' && (
                <StatCard
                  value={summary.violations.role_sa}
                  label="Role Violations"
                  badge={{
                    text: summary.violations.role_sa > 0 ? 'Violations Found' : 'Clean',
                    variant: summary.violations.role_sa > 0 ? 'error' : 'success',
                  }}
                />
              )}
              {summary.analysis_type !== 'role' && (
                <StatCard
                  value={summary.violations.user_sa}
                  label="User Violations"
                  badge={{
                    text: summary.violations.user_sa > 0 ? 'Violations Found' : 'Clean',
                    variant: summary.violations.user_sa > 0 ? 'error' : 'success',
                  }}
                />
              )}
            </div>
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

      {/* ── Error ── */}
      {step === 'error' && (
        <div className="card border-error/30 bg-error-light/20">
          <div className="flex gap-3">
            <AlertCircle size={20} className="text-error shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-error mb-1">Analysis Failed</p>
              {errors.map((e, i) => (
                <p key={i} className="text-[13px] text-error/80">
                  {e}
                </p>
              ))}
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button className="btn-primary" onClick={handleTryAgain}>
              Try Again
            </button>
            <button className="btn-secondary" onClick={handleReset}>
              ← Start Over
            </button>
          </div>
        </div>
      )}

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
