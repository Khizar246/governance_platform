import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { Target, AlertCircle, RefreshCw, X, List, Package } from 'lucide-react'
import { toast } from 'sonner'
import PageHeader from '../components/layout/PageHeader'
import FileUpload from '../components/common/FileUpload'
import StepIndicator from '../components/common/StepIndicator'
import StatCard from '../components/common/StatCard'
import LoadingOverlay from '../components/common/LoadingOverlay'
import DownloadButton from '../components/common/DownloadButton'
import ConfirmDialog from '../components/common/ConfirmDialog'
import Badge from '../components/common/Badge'
import { uploadFiles, runAnalysis, getStatus, downloadResults, cancelJob } from '../api/fpAnalysis'
import type { FPAnalysisSummary, FPSheetSummary } from '../types'
import { POLL_INTERVAL_MS } from '../utils/constants'

type Step = 'mode' | 'sheets' | 'upload' | 'running' | 'results' | 'error'
type Mode = 'privilege' | 'entitlement'

const STEPS = ['Mode', 'Sheets', 'Upload', 'Results']
const STEP_INDEX: Record<Step, number> = { mode: 0, sheets: 1, upload: 2, running: 2, results: 3, error: 0 }

const ALL_SHEET_IDS = ['ROLE_SOD', 'ROLE_SA', 'USER_SOD', 'USER_SA']
const SHEET_LABELS: Record<string, string> = {
  ROLE_SOD: 'Role SoD', ROLE_SA: 'Role SA', USER_SOD: 'User SoD', USER_SA: 'User SA',
}
const SHEET_GROUPS = [
  { label: 'Role Analysis', ids: ['ROLE_SOD', 'ROLE_SA'] },
  { label: 'User Analysis', ids: ['USER_SOD', 'USER_SA'] },
]

const MODE_CARDS = [
  {
    id: 'privilege' as Mode,
    icon: List,
    title: 'Privilege Level',
    description:
      'Classify each individual privilege pair as False Positive, Single Leg, or True Conflict. Most granular — recommended for detailed audit reports.',
    accentClass: 'border-l-info',
    iconColor: 'text-info',
  },
  {
    id: 'entitlement' as Mode,
    icon: Package,
    title: 'Entitlement Level',
    description:
      'Classify entire entitlement groups based on their constituent privileges. Higher-level view — recommended for management reporting.',
    accentClass: 'border-l-success',
    iconColor: 'text-success',
  },
]

export default function FPAnalysis() {
  const [step, setStep] = useState<Step>('mode')
  const [mode, setMode] = useState<Mode>('privilege')
  const [selectedSheets, setSelectedSheets] = useState<string[]>([...ALL_SHEET_IDS])
  const [sodFile, setSodFile] = useState<File | null>(null)
  const [fpDbFile, setFpDbFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [summary, setSummary] = useState<FPAnalysisSummary | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [uploadError, setUploadError] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)

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
          setSummary(status.results as unknown as FPAnalysisSummary)
          setStep('results')
          toast.success('FP analysis complete!')
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

  const handleSelectMode = useCallback((m: Mode) => {
    setMode(m)
    setStep('sheets')
  }, [])

  const toggleSheet = (id: string) =>
    setSelectedSheets(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id],
    )

  // Upload files + immediately kick off analysis
  const handleRunAnalysis = useCallback(async () => {
    if (!sodFile || !fpDbFile) return
    setIsUploading(true)
    setUploadProgress(0)
    setUploadError('')
    try {
      const resp = await uploadFiles(sodFile, fpDbFile, setUploadProgress)
      if (resp.errors?.length) {
        setUploadError(resp.errors[0])
        return
      }
      const id = resp.job_id
      setJobId(id)
      await runAnalysis(id, { mode, sheets: selectedSheets })
      setStep('running')
      setProgress(0)
      setProgressMessage('Starting FP analysis…')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to start analysis.'
      setUploadError(msg)
    } finally {
      setIsUploading(false)
    }
  }, [sodFile, fpDbFile, mode, selectedSheets])

  // Retry: re-run if files still on server, otherwise return to upload
  const handleTryAgain = useCallback(async () => {
    if (!jobId) { setStep('upload'); return }
    try {
      await runAnalysis(jobId, { mode, sheets: selectedSheets })
      setStep('running')
      setProgress(0)
      setProgressMessage('Retrying analysis…')
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          'Failed to retry.',
      )
    }
  }, [jobId, mode, selectedSheets])

  const handleReset = useCallback(async () => {
    if (jobId) { try { await cancelJob(jobId) } catch { /* ignore */ } }
    setStep('mode')
    setMode('privilege')
    setSelectedSheets([...ALL_SHEET_IDS])
    setSodFile(null)
    setFpDbFile(null)
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
        icon={<Target size={24} />}
        title="False Positive Analysis"
        subtitle="3-level FP classification — False Positive · Single Leg · True Conflict"
      />

      <StepIndicator steps={STEPS} currentStep={STEP_INDEX[step]} />

      <div className="relative">
        {/* ── Step 0: Mode Selection ─────────────────────────────── */}
        {step === 'mode' && (
          <div className="grid grid-cols-2 gap-4">
            {MODE_CARDS.map(({ id, icon: Icon, title, description, accentClass, iconColor }) => (
              <button
                key={id}
                onClick={() => handleSelectMode(id)}
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
                <span className="mt-auto pt-3 text-sm text-gray-400 group-hover:text-ey-yellow transition-colors self-start">
                  Select →
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ── Step 1: Sheet Configuration ───────────────────────── */}
        {step === 'sheets' && (
          <div className="space-y-4">
            <div className="card">
              <div className="flex items-center gap-3 mb-4">
                <span className="label-uppercase">Mode:</span>
                <Badge
                  text={mode === 'privilege' ? 'Privilege Level' : 'Entitlement Level'}
                  variant="info"
                />
              </div>
              <p className="label-uppercase mb-3">Violation Sheets to Analyse</p>
              <div className="grid grid-cols-2 gap-6">
                {SHEET_GROUPS.map(({ label, ids }) => (
                  <div key={label}>
                    <p className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-2">{label}</p>
                    <div className="space-y-2">
                      {ids.map(id => (
                        <label
                          key={id}
                          className={clsx(
                            'flex items-center gap-3 px-3 py-2 rounded cursor-pointer select-none transition-colors border',
                            selectedSheets.includes(id)
                              ? 'bg-info-light border-info/30 text-info'
                              : 'bg-gray-100 border-gray-200 text-gray-600 hover:bg-gray-200',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="accent-info"
                            checked={selectedSheets.includes(id)}
                            onChange={() => toggleSheet(id)}
                          />
                          <span className="text-sm font-medium">{SHEET_LABELS[id]}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {selectedSheets.length === 0 && (
                <p className="text-[13px] text-error mt-3">Select at least one violation sheet to continue.</p>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <button className="btn-secondary" onClick={() => setStep('mode')}>
                ← Change Mode
              </button>
              <button
                className="btn-primary"
                disabled={selectedSheets.length === 0}
                onClick={() => setStep('upload')}
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Upload Files ──────────────────────────────── */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="label-uppercase mb-2">SOD Analysis Output</p>
                <FileUpload
                  label="SOD Output XLSX"
                  accept=".xlsx,.xls"
                  hint={`Sheets required: ROLE_DETAILS, ${selectedSheets.map(s => SHEET_LABELS[s]).join(', ')}`}
                  status={sodFile ? 'success' : 'idle'}
                  fileInfo={sodFile ? { name: sodFile.name, size: sodFile.size } : null}
                  onUpload={setSodFile}
                  onRemove={() => setSodFile(null)}
                />
              </div>
              <div>
                <p className="label-uppercase mb-2">FP Database</p>
                <FileUpload
                  label="FP Database XLSX"
                  accept=".xlsx,.xls"
                  hint="Sheets required: No_action_Privileges, WorkArea_Privileges"
                  status={fpDbFile ? 'success' : 'idle'}
                  fileInfo={fpDbFile ? { name: fpDbFile.name, size: fpDbFile.size } : null}
                  onUpload={setFpDbFile}
                  onRemove={() => setFpDbFile(null)}
                />
              </div>
            </div>

            {/* Config summary bar */}
            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded text-[13px] text-gray-600">
              <span>
                <span className="font-medium">Mode:</span>{' '}
                {mode === 'privilege' ? 'Privilege Level' : 'Entitlement Level'}
              </span>
              <span className="text-gray-300">·</span>
              <span>
                <span className="font-medium">Sheets:</span>{' '}
                {selectedSheets.map(s => SHEET_LABELS[s]).join(', ')}
              </span>
              <button
                className="ml-auto text-info hover:underline text-[12px]"
                onClick={() => setStep('sheets')}
              >
                Change
              </button>
            </div>

            {isUploading && (
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Uploading and validating…</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-info transition-all duration-200"
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
              <button className="btn-secondary" onClick={() => setStep('sheets')}>
                ← Back
              </button>
              <button
                className="btn-primary"
                disabled={!sodFile || !fpDbFile || isUploading}
                onClick={handleRunAnalysis}
              >
                {isUploading ? 'Uploading…' : 'Run Analysis →'}
              </button>
            </div>
          </div>
        )}

        {/* ── Running ─────────────────────────────────────────── */}
        {step === 'running' && (
          <div className="relative min-h-[320px]">
            <LoadingOverlay
              message={progressMessage || 'Running 3-level FP classification…'}
              progress={progress}
            />
          </div>
        )}

        {/* ── Results ─────────────────────────────────────────── */}
        {step === 'results' && summary && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <span className="label-uppercase">Mode:</span>
              <Badge
                text={summary.mode === 'privilege' ? 'Privilege Level' : 'Entitlement Level'}
                variant="info"
              />
            </div>

            <div className="space-y-4">
              {(summary.sheet_summaries as FPSheetSummary[]).map(s => (
                <div key={s.sheet} className="card">
                  <p className="text-sm font-semibold text-gray-800 mb-3">{s.sheet}</p>
                  <div className="grid grid-cols-5 gap-3">
                    <StatCard value={s.total} label="Total Violations" />
                    <StatCard
                      value={s.fp_count}
                      label="False Positive"
                      badge={{ text: 'FP', variant: 'success' }}
                    />
                    <StatCard
                      value={s.sl_count}
                      label="Single Leg"
                      badge={{ text: 'SL', variant: 'warning' }}
                    />
                    <StatCard
                      value={s.tc_count}
                      label="True Conflict"
                      badge={{ text: 'TC', variant: 'error' }}
                    />
                    <StatCard
                      value={`${s.reduction_pct}%`}
                      label="FP + SL Reduction"
                      badge={{
                        text: s.reduction_pct >= 50 ? 'High' : 'Low',
                        variant: s.reduction_pct >= 50 ? 'success' : 'warning',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2">
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
                  return downloadResults(jobId!, `FP_Analysis_${summary.mode}_${ts}.xlsx`)
                }}
              />
            </div>
          </div>
        )}

        {/* ── Error ───────────────────────────────────────────── */}
        {step === 'error' && (
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
        title="Start New Analysis?"
        message="This will clear the current results and return to mode selection."
        confirmLabel="Yes, Start Over"
        cancelLabel="Keep Results"
        destructive
        onConfirm={handleReset}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}
