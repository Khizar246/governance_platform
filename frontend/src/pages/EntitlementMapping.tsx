import { useState, useEffect, useCallback, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { clsx } from 'clsx'
import { Link, AlertCircle, CheckCircle2, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import PageHeader from '../components/layout/PageHeader'
import FileUpload from '../components/common/FileUpload'
import StepIndicator from '../components/common/StepIndicator'
import StatCard from '../components/common/StatCard'
import LoadingOverlay from '../components/common/LoadingOverlay'
import DownloadButton from '../components/common/DownloadButton'
import DataTable from '../components/common/DataTable'
import ConfirmDialog from '../components/common/ConfirmDialog'
import { uploadFiles, runAnalysis, getStatus, downloadResults, cancelJob } from '../api/entitlementMapping'
import type { UploadResponse, EntitlementMappingSummary } from '../types'
import { POLL_INTERVAL_MS } from '../utils/constants'

type Step = 'upload' | 'preview' | 'running' | 'results' | 'error'
type TabId = 'all' | 'exact' | 'superset' | 'partial' | 'no_match'

const STEPS = ['Upload', 'Preview', 'Analysis', 'Results']
const STEP_INDEX: Record<Step, number> = { upload: 0, preview: 1, running: 2, results: 3, error: 0 }

const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'exact', label: 'Exact' },
  { id: 'superset', label: 'Superset' },
  { id: 'partial', label: 'Partial' },
  { id: 'no_match', label: 'No Match' },
]

export default function EntitlementMapping() {
  const [step, setStep] = useState<Step>('upload')
  const [clientFile, setClientFile] = useState<File | null>(null)
  const [eyFile, setEyFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadResponse, setUploadResponse] = useState<UploadResponse | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [summary, setSummary] = useState<EntitlementMappingSummary | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [uploadError, setUploadError] = useState('')
  const [activeTab, setActiveTab] = useState<TabId>('all')
  const [confirmReset, setConfirmReset] = useState(false)

  // Poll for progress while running
  useEffect(() => {
    if (step !== 'running' || !jobId) return
    const interval = setInterval(async () => {
      try {
        const status = await getStatus(jobId)
        setProgress(status.progress)
        setProgressMessage(status.progress_message)
        if (status.status === 'complete') {
          clearInterval(interval)
          setSummary(status.results as unknown as EntitlementMappingSummary)
          setStep('results')
          toast.success('Mapping complete!')
        } else if (status.status === 'failed') {
          clearInterval(interval)
          setErrors(status.errors)
          setStep('error')
          toast.error(status.errors[0] || 'Analysis failed.')
        }
      } catch {
        // network hiccup — keep polling
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [step, jobId])

  const handleUpload = useCallback(async () => {
    if (!clientFile || !eyFile) return
    setIsUploading(true)
    setUploadProgress(0)
    setUploadError('')
    try {
      const resp = await uploadFiles(clientFile, eyFile, setUploadProgress)
      if (resp.errors?.length) {
        setUploadError(resp.errors[0])
        return
      }
      setUploadResponse(resp)
      setJobId(resp.job_id)
      setStep('preview')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Upload failed.'
      setUploadError(msg)
    } finally {
      setIsUploading(false)
    }
  }, [clientFile, eyFile])

  const handleRun = useCallback(async () => {
    if (!jobId) return
    try {
      await runAnalysis(jobId)
      setStep('running')
      setProgress(0)
      setProgressMessage('Starting analysis…')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to start analysis.'
      toast.error(msg)
    }
  }, [jobId])

  const handleReset = useCallback(async () => {
    if (jobId) {
      try { await cancelJob(jobId) } catch { /* ignore */ }
    }
    setStep('upload')
    setClientFile(null)
    setEyFile(null)
    setUploadProgress(0)
    setIsUploading(false)
    setUploadResponse(null)
    setJobId(null)
    setProgress(0)
    setProgressMessage('')
    setSummary(null)
    setErrors([])
    setUploadError('')
    setActiveTab('all')
    setConfirmReset(false)
  }, [jobId])

  // Tab counts derived from summary
  const tabCounts = useMemo<Record<TabId, number>>(() => {
    if (!summary) return { all: 0, exact: 0, superset: 0, partial: 0, no_match: 0 }
    return {
      all: summary.total_mappings,
      exact: summary.exact_matches,
      superset: summary.supersets,
      partial: summary.partial_matches,
      no_match: summary.no_matches,
    }
  }, [summary])

  // Filtered rows for the preview DataTable
  const filteredRows = useMemo(() => {
    if (!summary?.results_preview) return []
    const rows = summary.results_preview
    switch (activeTab) {
      case 'exact':
        return rows.filter(r => String(r['Comment'] ?? '').toLowerCase().startsWith('exact match'))
      case 'superset':
        return rows.filter(r => String(r['Comment'] ?? '').toLowerCase().includes('superset'))
      case 'no_match':
        return rows.filter(r => String(r['EY Entitlement Match'] ?? '') === '—')
      case 'partial': {
        return rows.filter(r => {
          const match = String(r['EY Entitlement Match'] ?? '')
          const comment = String(r['Comment'] ?? '').toLowerCase()
          return match !== '—' && !comment.startsWith('exact match') && !comment.includes('superset')
        })
      }
      default:
        return rows
    }
  }, [summary, activeTab])

  // Column definitions derived from results_preview row keys
  const previewColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    if (!summary?.results_preview?.length) return []
    return Object.keys(summary.results_preview[0]).map(key => ({
      accessorKey: key,
      header: key,
      cell: info => {
        const val = info.getValue()
        return val === null || val === undefined ? '' : String(val)
      },
    }))
  }, [summary])

  return (
    <div>
      <PageHeader
        icon={<Link size={24} />}
        title="Entitlement Mapping"
        subtitle="Map client entitlements to EY rulesets using privilege overlap and Jaccard similarity"
      />

      <StepIndicator steps={STEPS} currentStep={STEP_INDEX[step]} />

      <div className="relative">
        {/* ── Upload Step ─────────────────────────────────────────────── */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="label-uppercase mb-2">Client Entitlement File</p>
                <FileUpload
                  label="Client CSV / XLSX"
                  hint="Columns required: Access Entitlement Name, Access Point Code"
                  status={clientFile ? 'success' : 'idle'}
                  fileInfo={clientFile ? { name: clientFile.name, size: clientFile.size } : null}
                  onUpload={setClientFile}
                  onRemove={() => setClientFile(null)}
                />
              </div>
              <div>
                <p className="label-uppercase mb-2">EY Ruleset File</p>
                <FileUpload
                  label="EY CSV / XLSX"
                  hint="Columns required: Access Entitlement Name, Access Point Code"
                  status={eyFile ? 'success' : 'idle'}
                  fileInfo={eyFile ? { name: eyFile.name, size: eyFile.size } : null}
                  onUpload={setEyFile}
                  onRemove={() => setEyFile(null)}
                />
              </div>
            </div>

            {isUploading && (
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Uploading…</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                  <div className="h-full bg-ey-yellow transition-all duration-200" style={{ width: `${uploadProgress}%` }} />
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

            <div className="flex justify-end pt-2">
              <button
                className="btn-primary"
                disabled={!clientFile || !eyFile || isUploading}
                onClick={handleUpload}
              >
                {isUploading ? 'Uploading…' : 'Validate & Preview →'}
              </button>
            </div>
          </div>
        )}

        {/* ── Preview Step ─────────────────────────────────────────────── */}
        {step === 'preview' && uploadResponse && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {[
                { key: 'client_file', label: 'Client File' },
                { key: 'ey_file', label: 'EY Ruleset' },
              ].map(({ key, label }) => {
                const info = uploadResponse.files[key]
                if (!info) return null
                return (
                  <div key={key} className="card">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle2 size={16} className="text-success" />
                      <span className="text-sm font-semibold text-gray-800">{label}</span>
                    </div>
                    <div className="space-y-1 text-[13px] text-gray-600">
                      <p className="truncate font-medium text-gray-700">{info.filename}</p>
                      <p>{info.rows.toLocaleString()} rows · {info.columns.length} columns</p>
                      {info.duplicates > 0 && (
                        <p className="text-warning">{info.duplicates.toLocaleString()} duplicate rows detected</p>
                      )}
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="label-uppercase mb-1">Columns</p>
                      <p className="text-[12px] text-gray-500 font-mono break-words">{info.columns.join(', ')}</p>
                    </div>
                    {info.preview.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <p className="label-uppercase mb-2">Preview ({Math.min(5, info.preview.length)} rows)</p>
                        <div className="overflow-x-auto rounded border border-gray-200">
                          <table className="w-full text-[12px]">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-200">
                                {info.columns.slice(0, 5).map(col => (
                                  <th
                                    key={col}
                                    className="px-2 py-1.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap"
                                  >
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {info.preview.slice(0, 5).map((row, i) => (
                                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                  {info.columns.slice(0, 5).map(col => (
                                    <td
                                      key={col}
                                      className="px-2 py-1.5 text-gray-600 max-w-[140px] truncate"
                                      title={String(row[col] ?? '')}
                                    >
                                      {String(row[col] ?? '')}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {uploadResponse.warnings?.length > 0 && (
              <div className="flex gap-2 p-3 bg-warning-light rounded border border-warning/30 text-sm text-warning">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <div>{uploadResponse.warnings.join(' · ')}</div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button className="btn-secondary" onClick={handleReset}>← Back</button>
              <button className="btn-primary" onClick={handleRun}>Run Mapping</button>
            </div>
          </div>
        )}

        {/* ── Running Step ─────────────────────────────────────────────── */}
        {step === 'running' && (
          <div className="relative min-h-[320px]">
            <LoadingOverlay
              message={progressMessage || 'Analysing entitlement mappings…'}
              progress={progress}
            />
          </div>
        )}

        {/* ── Results Step ─────────────────────────────────────────────── */}
        {step === 'results' && summary && (
          <div className="space-y-5">
            {/* Stat cards */}
            <div className="grid grid-cols-5 gap-3">
              <StatCard value={summary.total_mappings} label="Total Mappings" />
              <StatCard
                value={summary.exact_matches}
                label="Exact Matches"
                badge={{ text: 'High', variant: 'success' }}
              />
              <StatCard
                value={summary.supersets}
                label="EY Supersets"
                badge={{ text: 'High', variant: 'success' }}
              />
              <StatCard
                value={summary.partial_matches}
                label="Partial Matches"
                badge={{ text: 'Medium', variant: 'warning' }}
              />
              <StatCard
                value={summary.no_matches}
                label="No Match"
                badge={{ text: 'None', variant: 'error' }}
              />
            </div>

            {/* Tab bar */}
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex gap-0">
                {TABS.map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={clsx(
                      'px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors duration-150',
                      activeTab === id
                        ? 'border-ey-yellow text-gray-800'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                    )}
                  >
                    {label}
                    <span
                      className={clsx(
                        'ml-2 text-[11px] px-1.5 py-0.5 rounded-full font-medium',
                        activeTab === id ? 'bg-ey-yellow/20 text-gray-700' : 'bg-gray-100 text-gray-500',
                      )}
                    >
                      {tabCounts[id]}
                    </span>
                  </button>
                ))}
              </nav>
            </div>

            {/* Results preview table */}
            <div>
              {filteredRows.length > 0 && previewColumns.length > 0 ? (
                <>
                  <DataTable
                    data={filteredRows}
                    columns={previewColumns}
                    defaultPageSize={25}
                    maxHeight="400px"
                    emptyMessage="No results in this category"
                  />
                  <p className="text-[12px] text-gray-400 mt-2">
                    Showing first {summary.results_preview.length} rows. Download the full report for complete results.
                  </p>
                </>
              ) : (
                <div className="text-center text-sm text-gray-400 py-10 border border-gray-200 rounded">
                  No results in this category
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-1">
              <button
                className="btn-secondary flex items-center gap-2"
                onClick={() => setConfirmReset(true)}
              >
                <RefreshCw size={14} />
                Start New Mapping
              </button>
              <DownloadButton
                onClick={async () => {
                  const now = new Date()
                  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
                  return downloadResults(jobId!, `Entitlement_Mapping_${ts}.xlsx`)
                }}
              />
            </div>
          </div>
        )}

        {/* ── Error Step ─────────────────────────────────────────────── */}
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
              <button className="btn-primary" onClick={handleRun}>Try Again</button>
              <button className="btn-secondary" onClick={handleReset}>← Start Over</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Confirm Reset Dialog ─────────────────────────────────────── */}
      <ConfirmDialog
        open={confirmReset}
        title="Start New Mapping?"
        message="This will clear the current results and return to the upload step. This action cannot be undone."
        confirmLabel="Yes, Start Over"
        cancelLabel="Keep Results"
        destructive
        onConfirm={handleReset}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}
