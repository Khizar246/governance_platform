import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import { Search, AlertCircle, CheckCircle2, RefreshCw, X, Users, Database, Layers } from 'lucide-react'
import { toast } from 'sonner'
import PageHeader from '../components/layout/PageHeader'
import FileUpload from '../components/common/FileUpload'
import StepIndicator from '../components/common/StepIndicator'
import StatCard from '../components/common/StatCard'
import LoadingOverlay from '../components/common/LoadingOverlay'
import DownloadButton from '../components/common/DownloadButton'
import ConfirmDialog from '../components/common/ConfirmDialog'
import { uploadFiles, runAnalysis, getStatus, downloadResults, cancelJob } from '../api/oracleComparator'
import type { OracleComparatorSummary, ComparisonTypeSummary } from '../types'
import { POLL_INTERVAL_MS } from '../utils/constants'

type Step = 'type' | 'upload' | 'running' | 'results' | 'error'
type AnalysisType = 'rbac' | 'dsp' | 'both'

const STEPS = ['Analysis Type', 'Upload Files', 'Results']
const STEP_INDEX: Record<Step, number> = { type: 0, upload: 1, running: 1, results: 2, error: 0 }

const COMP_TYPE_LABELS: Record<string, string> = {
  duty_role: 'Duty Roles',
  privilege: 'Privileges',
  dsp: 'DSP',
}

const TYPE_CARDS = [
  {
    id: 'rbac' as AnalysisType,
    icon: Users,
    title: 'RBAC Analysis',
    description:
      'Compare duty roles, inherited role assignments, and privilege-to-role mappings between two Oracle environments.',
    accentClass: 'border-l-success',
    iconColor: 'text-success',
    files: '2 RBAC files',
  },
  {
    id: 'dsp' as AnalysisType,
    icon: Database,
    title: 'DSP Analysis',
    description:
      'Compare data security policies, condition statements, and column-level access controls across environments.',
    accentClass: 'border-l-info',
    iconColor: 'text-info',
    files: '2 DSP files',
  },
  {
    id: 'both' as AnalysisType,
    icon: Layers,
    title: 'Complete Analysis',
    description:
      'Full bi-directional comparison covering both RBAC and DSP. Requires two pairs of files plus environment names.',
    accentClass: 'border-l-warning',
    iconColor: 'text-warning',
    files: '4 files total',
  },
]

export default function OracleComparator() {
  const [step, setStep] = useState<Step>('type')
  const [analysisType, setAnalysisType] = useState<AnalysisType>('rbac')
  const [env1Name, setEnv1Name] = useState('')
  const [env2Name, setEnv2Name] = useState('')
  const [rbacFile1, setRbacFile1] = useState<File | null>(null)
  const [rbacFile2, setRbacFile2] = useState<File | null>(null)
  const [dspFile1, setDspFile1] = useState<File | null>(null)
  const [dspFile2, setDspFile2] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [summary, setSummary] = useState<OracleComparatorSummary | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [uploadError, setUploadError] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [activeCompType, setActiveCompType] = useState<string>('all')

  const needsRbac = analysisType === 'rbac' || analysisType === 'both'
  const needsDsp = analysisType === 'dsp' || analysisType === 'both'

  const canRun =
    env1Name.trim() !== '' &&
    env2Name.trim() !== '' &&
    env1Name.trim() !== env2Name.trim() &&
    (!needsRbac || (rbacFile1 !== null && rbacFile2 !== null)) &&
    (!needsDsp || (dspFile1 !== null && dspFile2 !== null))

  // Poll while analysis runs
  useEffect(() => {
    if (step !== 'running' || !jobId) return
    const interval = setInterval(async () => {
      try {
        const status = await getStatus(jobId)
        setProgress(status.progress)
        setProgressMessage(status.progress_message)
        if (status.status === 'complete') {
          clearInterval(interval)
          setSummary(status.results as unknown as OracleComparatorSummary)
          setStep('results')
          toast.success('Comparison complete!')
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
    // Reset files that don't apply to new type
    if (t === 'rbac') { setDspFile1(null); setDspFile2(null) }
    if (t === 'dsp') { setRbacFile1(null); setRbacFile2(null) }
    setStep('upload')
  }, [])

  // Upload files + immediately kick off analysis
  const handleRunAnalysis = useCallback(async () => {
    if (!canRun) return
    setIsUploading(true)
    setUploadProgress(0)
    setUploadError('')
    try {
      const resp = await uploadFiles(
        {
          rbacFile1: needsRbac ? rbacFile1! : undefined,
          rbacFile2: needsRbac ? rbacFile2! : undefined,
          dspFile1: needsDsp ? dspFile1! : undefined,
          dspFile2: needsDsp ? dspFile2! : undefined,
          env1Name: env1Name.trim(),
          env2Name: env2Name.trim(),
          analysisType,
        },
        setUploadProgress,
      )
      if (resp.errors?.length) {
        setUploadError(resp.errors[0])
        return
      }
      const id = resp.job_id
      setJobId(id)
      await runAnalysis(id, {
        analysis_type: analysisType,
        env1_name: env1Name.trim(),
        env2_name: env2Name.trim(),
      })
      setStep('running')
      setProgress(0)
      setProgressMessage('Starting comparison…')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to start comparison.'
      setUploadError(msg)
    } finally {
      setIsUploading(false)
    }
  }, [canRun, needsRbac, needsDsp, rbacFile1, rbacFile2, dspFile1, dspFile2, env1Name, env2Name, analysisType])

  const handleTryAgain = useCallback(async () => {
    if (!jobId) { setStep('upload'); return }
    try {
      await runAnalysis(jobId, {
        analysis_type: analysisType,
        env1_name: env1Name.trim(),
        env2_name: env2Name.trim(),
      })
      setStep('running')
      setProgress(0)
      setProgressMessage('Retrying comparison…')
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          'Failed to retry.',
      )
    }
  }, [jobId, analysisType, env1Name, env2Name])

  const handleReset = useCallback(async () => {
    if (jobId) { try { await cancelJob(jobId) } catch { /* ignore */ } }
    setStep('type')
    setAnalysisType('rbac')
    setEnv1Name('')
    setEnv2Name('')
    setRbacFile1(null); setRbacFile2(null)
    setDspFile1(null); setDspFile2(null)
    setUploadProgress(0)
    setIsUploading(false)
    setJobId(null)
    setProgress(0)
    setProgressMessage('')
    setSummary(null)
    setErrors([])
    setUploadError('')
    setConfirmReset(false)
    setActiveCompType('all')
  }, [jobId])

  // Derived: unique comparison types available in results
  const availableCompTypes = useMemo(() => {
    if (!summary) return []
    return Array.from(new Set(summary.comparisons.map(c => c.comp_type)))
  }, [summary])

  // Derived: comparisons filtered by active tab
  const filteredComps = useMemo<ComparisonTypeSummary[]>(() => {
    if (!summary) return []
    return activeCompType === 'all'
      ? summary.comparisons
      : summary.comparisons.filter(c => c.comp_type === activeCompType)
  }, [summary, activeCompType])

  // Derived: group filtered comparisons by direction
  const dir1Label = summary ? `${summary.env1_name} → ${summary.env2_name}` : ''
  const dir2Label = summary ? `${summary.env2_name} → ${summary.env1_name}` : ''
  const dir1Comps = filteredComps.filter(c => c.direction === dir1Label)
  const dir2Comps = filteredComps.filter(c => c.direction === dir2Label)

  return (
    <div>
      <PageHeader
        icon={<Search size={24} />}
        title="Oracle Comparator"
        subtitle="Compare duty roles, privileges, and DSP across two Oracle environments"
      />

      <StepIndicator steps={STEPS} currentStep={STEP_INDEX[step]} />

      <div className="relative">
        {/* ── Step 0: Analysis Type Selection ────────────────────── */}
        {step === 'type' && (
          <div className="grid grid-cols-3 gap-4">
            {TYPE_CARDS.map(({ id, icon: Icon, title, description, accentClass, iconColor, files }) => (
              <button
                key={id}
                onClick={() => handleSelectType(id)}
                className={clsx(
                  'flex flex-col text-left p-5 bg-white border border-gray-300 border-l-[3px]',
                  accentClass,
                  'rounded shadow-card hover:shadow-card-hover transition-all duration-150',
                  'focus:outline-none focus:ring-2 focus:ring-ey-yellow',
                )}
              >
                <div className={clsx('mb-3', iconColor)}>
                  <Icon size={28} strokeWidth={1.5} />
                </div>
                <h3 className="text-base font-semibold text-gray-800 mb-2">{title}</h3>
                <p className="text-[13px] text-gray-500 leading-relaxed line-clamp-3">{description}</p>
                <div className="mt-auto pt-3 flex items-center justify-between w-full">
                  <span className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">{files}</span>
                  <span className="text-sm text-gray-400">Select →</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── Step 1: Upload Files ───────────────────────────────── */}
        {step === 'upload' && (
          <div className="space-y-5">
            {/* Environment names */}
            <div className="card">
              <p className="label-uppercase mb-3">Environment Names</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-uppercase block mb-1">Environment 1</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-ey-yellow"
                    placeholder="e.g. Production"
                    value={env1Name}
                    onChange={e => setEnv1Name(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label-uppercase block mb-1">Environment 2</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-ey-yellow"
                    placeholder="e.g. Development"
                    value={env2Name}
                    onChange={e => setEnv2Name(e.target.value)}
                  />
                </div>
              </div>
              {env1Name.trim() && env2Name.trim() && env1Name.trim() === env2Name.trim() && (
                <p className="text-[12px] text-warning mt-2">
                  Both environments have the same name — please use distinct names.
                </p>
              )}
            </div>

            {/* RBAC files */}
            {needsRbac && (
              <div>
                <p className="label-uppercase mb-2">RBAC Files</p>
                <div className="grid grid-cols-2 gap-4">
                  <FileUpload
                    label={`${env1Name || 'Environment 1'} RBAC`}
                    hint="Columns required: ROLE NAME, ENTITLEMENT, INHERITED ROLE NAME"
                    status={rbacFile1 ? 'success' : 'idle'}
                    fileInfo={rbacFile1 ? { name: rbacFile1.name, size: rbacFile1.size } : null}
                    onUpload={setRbacFile1}
                    onRemove={() => setRbacFile1(null)}
                  />
                  <FileUpload
                    label={`${env2Name || 'Environment 2'} RBAC`}
                    hint="Columns required: ROLE NAME, ENTITLEMENT, INHERITED ROLE NAME"
                    status={rbacFile2 ? 'success' : 'idle'}
                    fileInfo={rbacFile2 ? { name: rbacFile2.name, size: rbacFile2.size } : null}
                    onUpload={setRbacFile2}
                    onRemove={() => setRbacFile2(null)}
                  />
                </div>
              </div>
            )}

            {/* DSP files */}
            {needsDsp && (
              <div>
                <p className="label-uppercase mb-2">DSP Files</p>
                <div className="grid grid-cols-2 gap-4">
                  <FileUpload
                    label={`${env1Name || 'Environment 1'} DSP`}
                    hint="Data security policy export from Oracle Fusion"
                    status={dspFile1 ? 'success' : 'idle'}
                    fileInfo={dspFile1 ? { name: dspFile1.name, size: dspFile1.size } : null}
                    onUpload={setDspFile1}
                    onRemove={() => setDspFile1(null)}
                  />
                  <FileUpload
                    label={`${env2Name || 'Environment 2'} DSP`}
                    hint="Data security policy export from Oracle Fusion"
                    status={dspFile2 ? 'success' : 'idle'}
                    fileInfo={dspFile2 ? { name: dspFile2.name, size: dspFile2.size } : null}
                    onUpload={setDspFile2}
                    onRemove={() => setDspFile2(null)}
                  />
                </div>
              </div>
            )}

            {isUploading && (
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Uploading files…</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-success transition-all duration-200"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

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
                ← Change Type
              </button>
              <button
                className="btn-primary"
                disabled={!canRun || isUploading}
                onClick={handleRunAnalysis}
              >
                {isUploading ? 'Uploading…' : 'Run Comparison →'}
              </button>
            </div>
          </div>
        )}

        {/* ── Running ──────────────────────────────────────────── */}
        {step === 'running' && (
          <div className="relative min-h-[320px]">
            <LoadingOverlay
              message={progressMessage || 'Comparing environments…'}
              progress={progress}
            />
          </div>
        )}

        {/* ── Results ──────────────────────────────────────────── */}
        {step === 'results' && summary && (
          <div className="space-y-5">
            {/* Environment header */}
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <CheckCircle2 size={16} className="text-success" />
              <span className="font-semibold text-gray-800">{summary.env1_name}</span>
              <span className="text-gray-400">vs</span>
              <span className="font-semibold text-gray-800">{summary.env2_name}</span>
              <span className="text-gray-400">·</span>
              <span className="capitalize">{summary.analysis_type} analysis</span>
            </div>

            {/* Comparison type tabs */}
            {availableCompTypes.length > 1 && (
              <div className="border-b border-gray-200">
                <nav className="-mb-px flex gap-0">
                  {[{ id: 'all', label: 'All' }, ...availableCompTypes.map(t => ({ id: t, label: COMP_TYPE_LABELS[t] ?? t }))].map(
                    ({ id, label }) => (
                      <button
                        key={id}
                        onClick={() => setActiveCompType(id)}
                        className={clsx(
                          'px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors duration-150',
                          activeCompType === id
                            ? 'border-ey-yellow text-gray-800'
                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                        )}
                      >
                        {label}
                      </button>
                    ),
                  )}
                </nav>
              </div>
            )}

            {/* Direction 1 */}
            {dir1Comps.length > 0 && (
              <div className="card">
                <p className="text-sm font-semibold text-gray-800 mb-3">
                  {summary.env1_name} → {summary.env2_name}
                  <span className="ml-2 text-[11px] text-gray-400 font-normal">
                    (items in {summary.env1_name} checked against {summary.env2_name})
                  </span>
                </p>
                <div
                  className="grid gap-x-6 gap-y-4"
                  style={{ gridTemplateColumns: `repeat(${Math.min(dir1Comps.length, 2)}, minmax(0, 1fr))` }}
                >
                  {dir1Comps.map(c => (
                    <div key={c.comp_type} className="space-y-2">
                      <p className="label-uppercase">{COMP_TYPE_LABELS[c.comp_type] ?? c.comp_type}</p>
                      <div className="grid grid-cols-3 gap-2">
                        <StatCard value={c.total} label="Total" />
                        <StatCard
                          value={c.matches}
                          label="Matches"
                          badge={{
                            text: `${c.match_rate}%`,
                            variant:
                              c.match_rate >= 90 ? 'success' : c.match_rate >= 60 ? 'warning' : 'error',
                          }}
                        />
                        <StatCard
                          value={c.missing}
                          label="Missing"
                          badge={{
                            text: c.missing === 0 ? 'None' : 'Gap',
                            variant: c.missing === 0 ? 'success' : 'error',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Direction 2 */}
            {dir2Comps.length > 0 && (
              <div className="card">
                <p className="text-sm font-semibold text-gray-800 mb-3">
                  {summary.env2_name} → {summary.env1_name}
                  <span className="ml-2 text-[11px] text-gray-400 font-normal">
                    (items in {summary.env2_name} checked against {summary.env1_name})
                  </span>
                </p>
                <div
                  className="grid gap-x-6 gap-y-4"
                  style={{ gridTemplateColumns: `repeat(${Math.min(dir2Comps.length, 2)}, minmax(0, 1fr))` }}
                >
                  {dir2Comps.map(c => (
                    <div key={c.comp_type} className="space-y-2">
                      <p className="label-uppercase">{COMP_TYPE_LABELS[c.comp_type] ?? c.comp_type}</p>
                      <div className="grid grid-cols-3 gap-2">
                        <StatCard value={c.total} label="Total" />
                        <StatCard
                          value={c.matches}
                          label="Matches"
                          badge={{
                            text: `${c.match_rate}%`,
                            variant:
                              c.match_rate >= 90 ? 'success' : c.match_rate >= 60 ? 'warning' : 'error',
                          }}
                        />
                        <StatCard
                          value={c.missing}
                          label="Missing"
                          badge={{
                            text: c.missing === 0 ? 'None' : 'Gap',
                            variant: c.missing === 0 ? 'success' : 'error',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[12px] text-gray-400">
              Download the full report for row-level comparison details.
            </p>

            <div className="flex items-center justify-between pt-1">
              <button
                className="btn-secondary flex items-center gap-2"
                onClick={() => setConfirmReset(true)}
              >
                <RefreshCw size={14} /> New Comparison
              </button>
              <DownloadButton
                onClick={async () => {
                  const now = new Date()
                  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
                  const e1 = summary.env1_name
                  const e2 = summary.env2_name
                  return downloadResults(jobId!, `Oracle_Comparison_${e1}_vs_${e2}_${ts}.xlsx`)
                }}
              />
            </div>
          </div>
        )}

        {/* ── Error ────────────────────────────────────────────── */}
        {step === 'error' && (
          <div className="card border-error/30 bg-error-light/20">
            <div className="flex gap-3">
              <AlertCircle size={20} className="text-error shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-error mb-1">Comparison Failed</p>
                {errors.map((e, i) => (
                  <p key={i} className="text-[13px] text-error/80">{e}</p>
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
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Start New Comparison?"
        message="This will clear the current results and return to type selection."
        confirmLabel="Yes, Start Over"
        cancelLabel="Keep Results"
        destructive
        onConfirm={handleReset}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}
