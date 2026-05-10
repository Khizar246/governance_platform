import { useState, useEffect, useCallback, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { clsx } from 'clsx'
import { GitMerge, AlertCircle, CheckCircle2, RefreshCw, X, Info, Layers } from 'lucide-react'
import { toast } from 'sonner'
import PageHeader from '../components/layout/PageHeader'
import FileUpload from '../components/common/FileUpload'
import StepIndicator from '../components/common/StepIndicator'
import StatCard from '../components/common/StatCard'
import LoadingOverlay from '../components/common/LoadingOverlay'
import DownloadButton from '../components/common/DownloadButton'
import DataTable from '../components/common/DataTable'
import ConfirmDialog from '../components/common/ConfirmDialog'
import HelpAccordion, { HelpStep, HelpPill, TemplateDownloads } from '../components/common/HelpAccordion'
import {
  uploadFiles, runAnalysis, getStatus, downloadResults, cancelJob,
  getResults, getFilterOptions,
} from '../api/rulesetMapping'
import type { ResultTab } from '../api/rulesetMapping'
import type { UploadResponse, RulesetMappingSummary } from '../types'
import { POLL_INTERVAL_MS } from '../utils/constants'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// ── Column definitions ────────────────────────────────────────────────────────

const MATCH_TYPE_DESCRIPTIONS: Record<string, string> = {
  'Client Control Name': 'The control name as defined in the client SoD/SA ruleset.',
  'EY Control Name': 'The best-matching EY control. "Direct" = found in EY ruleset. "Derived" = constructed from the EY Entitlement-to-Privilege sheet. "—" = no match.',
  'Confidence Score': 'Jaccard similarity between the client and EY privilege sets: |C ∩ E| / |C ∪ E| × 100%. 100% = perfect bilateral match.',
  'Match Type': '"Direct" if matched to an existing EY control. "Derived" if the EY control was constructed from the E2P sheet. "Unmatched" if no mapping was possible.',
}

const ENT_DESCRIPTIONS: Record<string, string> = {
  'Client Entitlement': 'The entitlement name as defined in the client\'s access control system.',
  'EY Entitlement Match': 'The best-matching EY standard entitlement. \'—\' means no EY entitlement shares any privilege with this client entitlement.',
  'Privilege Match Count': 'Number of client privileges found in the matched EY entitlement, expressed as matched/total.',
  'Jaccard Similarity (%)': 'Overlap ÷ union of the two privilege sets.',
  'Match Confidence': 'Tier based on client privilege coverage: High ≥ 75%, Medium 40–74%, Low < 40%, None = no shared privileges.',
  'Runner-Up EY Entitlements': 'The 2nd and 3rd best EY candidates with their match counts and Jaccard scores.',
}

function matchTypeCell(info: { getValue: () => unknown }) {
  const val = String(info.getValue() ?? '')
  const cls =
    val === 'Direct'    ? 'bg-green-100 text-green-700 border border-green-200' :
    val === 'Derived'   ? 'bg-yellow-100 text-yellow-700 border border-yellow-200' :
    val === 'Unmatched' ? 'bg-red-100 text-red-600 border border-red-200' :
    'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>
      {val}
    </span>
  )
}

function makeControlColumns(descriptions: Record<string, string>): ColumnDef<Record<string, unknown>>[] {
  return ['Client Control Name', 'EY Control Name', 'Confidence Score', 'Match Type'].map(key => ({
    accessorKey: key,
    header: () => (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1 cursor-help">
            {key}
            <Info size={10} className="text-gray-400 shrink-0" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          {descriptions[key]}
        </TooltipContent>
      </Tooltip>
    ),
    cell: key === 'Match Type' ? matchTypeCell : (info: { getValue: () => unknown }) => {
      const val = info.getValue()
      return val === null || val === undefined ? '' : String(val)
    },
  }))
}

const SOD_COLUMNS = makeControlColumns(MATCH_TYPE_DESCRIPTIONS)
const SA_COLUMNS  = makeControlColumns(MATCH_TYPE_DESCRIPTIONS)

const ENT_COLUMNS: ColumnDef<Record<string, unknown>>[] = [
  'Client Entitlement',
  'EY Entitlement Match',
  'Privilege Match Count',
  'Jaccard Similarity (%)',
  'Match Confidence',
  'Runner-Up EY Entitlements',
].map(key => ({
  accessorKey: key,
  header: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1 cursor-help">
          {key}
          <Info size={10} className="text-gray-400 shrink-0" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">{ENT_DESCRIPTIONS[key]}</TooltipContent>
    </Tooltip>
  ),
  cell: (info: { getValue: () => unknown }) => {
    const val = info.getValue()
    return val === null || val === undefined ? '' : String(val)
  },
}))

const TAB_COLUMNS: Record<ResultTab, ColumnDef<Record<string, unknown>>[]> = {
  sod: SOD_COLUMNS,
  sa:  SA_COLUMNS,
  ent: ENT_COLUMNS,
}

// ── Step / tab types ──────────────────────────────────────────────────────────

type Step = 'upload' | 'preview' | 'running' | 'results' | 'error'

const STEPS = ['Upload', 'Preview', 'Analysis', 'Results']
const STEP_INDEX: Record<Step, number> = { upload: 0, preview: 1, running: 2, results: 3, error: 0 }

const STAGES = [
  { label: 'Initialising',                   minPercent: 0  },
  { label: 'Step 1 — Entitlement Mapping',   minPercent: 1  },
  { label: 'Step 2 — SoD Control Matching',  minPercent: 30 },
  { label: 'Step 3 — SA Control Matching',   minPercent: 65 },
  { label: 'Building Summary',               minPercent: 90 },
  { label: 'Finalising',                     minPercent: 95 },
]

const TABS: { id: ResultTab; label: string }[] = [
  { id: 'sod', label: 'SoD Mapping' },
  { id: 'sa',  label: 'SA Mapping' },
  { id: 'ent', label: 'Entitlement Mapping' },
]

// ── Preview cards config ──────────────────────────────────────────────────────

const PREVIEW_CARDS: { key: string; label: string }[] = [
  { key: 'client_sod', label: 'Client — SoD Ruleset' },
  { key: 'client_sa',  label: 'Client — SA Ruleset' },
  { key: 'client_e2p', label: 'Client — Entitlement to Privilege' },
  { key: 'ey_sod',     label: 'EY — SoD Ruleset' },
  { key: 'ey_sa',      label: 'EY — SA Ruleset' },
  { key: 'ey_e2p',     label: 'EY — Entitlement to Privilege' },
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function RulesetMapping() {
  const [step, setStep]                   = useState<Step>('upload')
  const [clientFile, setClientFile]       = useState<File | null>(null)
  const [eyFile, setEyFile]               = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploading, setIsUploading]     = useState(false)
  const [uploadResponse, setUploadResponse] = useState<UploadResponse | null>(null)
  const [jobId, setJobId]                 = useState<string | null>(null)
  const [progress, setProgress]           = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [summary, setSummary]             = useState<RulesetMappingSummary | null>(null)
  const [errors, setErrors]               = useState<string[]>([])
  const [uploadError, setUploadError]     = useState('')
  const [activeTab, setActiveTab]         = useState<ResultTab>('sod')
  const [confirmReset, setConfirmReset]   = useState(false)
  const [tableRows, setTableRows]         = useState<Record<string, unknown>[]>([])
  const [page, setPage]                   = useState(1)
  const [pageSize, setPageSize]           = useState(50)
  const [total, setTotal]                 = useState(0)
  const [isLoadingResults, setIsLoadingResults] = useState(false)
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({})

  const hasActiveFilters = Object.values(activeFilters).some(v => v.length > 0)

  // Polling
  useEffect(() => {
    if (step !== 'running' || !jobId) return
    const interval = setInterval(async () => {
      try {
        const s = await getStatus(jobId)
        setProgress(s.progress)
        setProgressMessage(s.progress_message)
        if (s.status === 'complete') {
          clearInterval(interval)
          setSummary(s.results as unknown as RulesetMappingSummary)
          setStep('results')
          toast.success('Mapping complete!')
        } else if (s.status === 'failed') {
          clearInterval(interval)
          setErrors(s.errors)
          setStep('error')
          toast.error(s.errors[0] || 'Analysis failed.')
        }
      } catch {
        // network hiccup — keep polling
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [step, jobId])

  // Fetch results page
  useEffect(() => {
    if (step !== 'results' || !jobId) return
    let cancelled = false
    setIsLoadingResults(true)
    getResults(jobId, { page, pageSize, tab: activeTab, filters: activeFilters })
      .then(res => {
        if (!cancelled) {
          setTableRows(res.data)
          setTotal(res.total)
          setIsLoadingResults(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast.error('Failed to load results.')
          setIsLoadingResults(false)
        }
      })
    return () => { cancelled = true }
  }, [step, jobId, activeTab, page, pageSize, activeFilters])

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
    setActiveTab('sod')
    setConfirmReset(false)
    setTableRows([])
    setPage(1)
    setPageSize(50)
    setTotal(0)
    setIsLoadingResults(false)
    setActiveFilters({})
  }, [jobId])

  const tabCounts = useMemo<Record<ResultTab, number>>(() => {
    if (!summary) return { sod: 0, sa: 0, ent: 0 }
    return {
      sod: summary.sod_total,
      sa:  summary.sa_total,
      ent: summary.ent_total,
    }
  }, [summary])

  return (
    <div>
      <PageHeader
        icon={<GitMerge size={24} />}
        title="Ruleset Mapping"
        subtitle="Map client SoD and SA controls to EY controls using privilege-set Jaccard similarity"
      />

      <div style={{ marginBottom: 20 }}>
        <HelpAccordion title="How to Use This Tool" icon={<Info size={14} color="#2563EB" />} accentColor="#2563EB">
          <HelpStep num={1} text="Download the templates below and populate them with your client and EY ruleset data. Each file must contain exactly three sheets: 'SoD Ruleset', 'SA Ruleset', and 'Entitlement to Privilege'." />
          <HelpStep num={2} text="SoD Ruleset columns: Control Name, Risk Ranking, LHS Entitlement, RHS Entitlement, Module(s). SA Ruleset columns: Control Name, Risk Ranking, Entitlement, Side, Module(s). Entitlement to Privilege columns: Entitlement Name, Privilege Name, Privilege Code." />
          <HelpStep num={3} text="Upload both the Client Ruleset and EY Ruleset .xlsx files. The tool validates all required sheets and columns are present before allowing you to proceed." />
          <HelpStep num={4} text="Click Run Mapping. Progress is tracked across three pipeline steps. Once complete, review results across the SoD Mapping, SA Mapping, and Entitlement Mapping tabs, then download the 3-tab Excel report." />
        </HelpAccordion>
        <HelpAccordion title="How the Tool Works" icon={<Layers size={14} color="#0F1E3D" />} accentColor="#0F1E3D">
          <p style={{ fontSize: 13, color: '#64748B', lineHeight: 1.7, marginBottom: 12 }}>The mapping pipeline runs three steps. Privilege codes from the Entitlement to Privilege sheet are the source of truth for all matching.</p>
          <HelpPill label="Step 1 — Entitlement Mapping (0–30%)" note="Each client entitlement is matched to the best-fitting EY entitlement by comparing their Privilege Code sets. Jaccard similarity (|intersection| ÷ |union|) determines the score. This lookup table is used by Steps 2 and 3." />
          <HelpPill label="Step 2 — SoD Control Matching (30–65%)" note="For each client SoD control, privileges for both LHS and RHS entitlements are combined into set C. Every EY SoD control is scored by Jaccard(C, E). Best non-zero score → Direct match. Zero → fall back to Step 1 mapping to construct a Derived EY control name ([EY_LHS] AND [EY_RHS]). If neither entitlement maps → Unmatched." />
          <HelpPill label="Step 3 — SA Control Matching (65–90%)" note="Each client SA entitlement is looked up via the Step 1 mapping to find the corresponding EY entitlement. If that EY entitlement appears in the EY SA Ruleset → Direct match. If it exists only in EY E2P → Derived. If no mapping was found → Unmatched." />
          <p style={{ fontSize: 12.5, color: '#94A3B8', marginTop: 10, lineHeight: 1.6 }}>Confidence Score = Jaccard similarity × 100%, rounded to the nearest integer. 100% = every client privilege is present in the matched EY set and vice versa. "—" and Unmatched rows always show 0%.</p>
        </HelpAccordion>
        <TemplateDownloads templates={[
          ['Client Ruleset Template', 'XLSX', '/api/templates/ruleset-mapping/client_ruleset_template.xlsx'],
          ['EY Ruleset Template',     'XLSX', '/api/templates/ruleset-mapping/ey_ruleset_template.xlsx'],
        ]} />
      </div>

      <StepIndicator steps={STEPS} currentStep={STEP_INDEX[step]} />

      <div className="relative">

        {/* ── Upload ─────────────────────────────────────────────────────── */}
        {step === 'upload' && (
          <div className="slide-in space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="label-uppercase mb-2">Client Ruleset (.xlsx)</p>
                <FileUpload
                  label="Client Ruleset XLSX"
                  hint="3 sheets required: SoD Ruleset, SA Ruleset, Entitlement to Privilege"
                  status={clientFile ? 'success' : 'idle'}
                  fileInfo={clientFile ? { name: clientFile.name, size: clientFile.size } : null}
                  onUpload={setClientFile}
                  onRemove={() => setClientFile(null)}
                />
              </div>
              <div>
                <p className="label-uppercase mb-2">EY Ruleset (.xlsx)</p>
                <FileUpload
                  label="EY Ruleset XLSX"
                  hint="3 sheets required: SoD Ruleset, SA Ruleset, Entitlement to Privilege"
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
                  <div
                    className="h-full rounded-full transition-[width] duration-300 ease-out"
                    style={{ width: `${uploadProgress}%`, background: '#FFD100' }}
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

        {/* ── Preview ────────────────────────────────────────────────────── */}
        {step === 'preview' && uploadResponse && (
          <div className="slide-in space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {PREVIEW_CARDS.map(({ key, label }) => {
                const info = uploadResponse.files[key]
                if (!info) return null
                return (
                  <div key={key} className="card">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 size={14} className="text-success shrink-0" />
                      <span className="text-xs font-semibold text-gray-700 truncate">{label}</span>
                      {info.duplicates > 0 && (
                        <span className="ml-auto text-[10px] font-medium text-warning bg-warning-light border border-warning/20 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                          {info.duplicates} dupes
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-gray-500 mb-2">
                      <span className="font-medium text-gray-700">{info.rows.toLocaleString()}</span> rows ·{' '}
                      <span>{info.columns.length}</span> cols
                    </div>
                    <div className="pt-2 border-t border-gray-100">
                      <p className="text-[10px] text-gray-400 font-mono break-words line-clamp-2">
                        {info.columns.join(', ')}
                      </p>
                    </div>
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
              <button className="btn-gold" onClick={handleRun}>Run Mapping →</button>
            </div>
          </div>
        )}

        {/* ── Running ────────────────────────────────────────────────────── */}
        {step === 'running' && (
          <div className="slide-in relative min-h-[320px]">
            <LoadingOverlay
              message={progressMessage || 'Running ruleset mapping pipeline…'}
              progress={progress}
              stages={STAGES}
              progressMessage={progressMessage}
            />
          </div>
        )}

        {/* ── Results ────────────────────────────────────────────────────── */}
        {step === 'results' && summary && (
          <div className="slide-in space-y-5">
            {/* Summary StatCards */}
            <div className="grid grid-cols-4 gap-3">
              <StatCard
                value={summary.sod_direct}
                label="SoD Direct"
                badge={{ text: 'Direct', variant: 'success' }}
              />
              <StatCard
                value={summary.sod_derived}
                label="SoD Derived"
                badge={{ text: 'Derived', variant: 'warning' }}
              />
              <StatCard
                value={summary.sa_direct}
                label="SA Direct"
                badge={{ text: 'Direct', variant: 'success' }}
              />
              <StatCard
                value={summary.sa_derived}
                label="SA Derived"
                badge={{ text: 'Derived', variant: 'warning' }}
              />
            </div>

            {/* Tab bar + Clear All Filters */}
            <div className="flex items-center border-b border-gray-200">
              <nav className="-mb-px flex flex-1 gap-0">
                {TABS.map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => { setActiveTab(id); setPage(1); setActiveFilters({}) }}
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
              <button
                onClick={() => { setActiveFilters({}); setPage(1) }}
                disabled={!hasActiveFilters}
                className="flex items-center gap-1 mr-4 text-[11px] text-gray-500 hover:text-gray-700 transition-colors disabled:text-gray-300 disabled:cursor-default"
              >
                <X size={11} /> Clear All Filters
              </button>
            </div>

            <DataTable
              data={tableRows}
              columns={TAB_COLUMNS[activeTab]}
              maxHeight="400px"
              emptyMessage="No results in this category"
              isLoading={isLoadingResults}
              serverSide={{
                total,
                page,
                pageSize,
                onPageChange: (p) => setPage(p),
                onPageSizeChange: (sz) => { setPageSize(sz); setPage(1) },
              }}
              serverSideFilters={{
                values: activeFilters,
                onChange: (colId, vals) => {
                  setActiveFilters(prev => ({ ...prev, [colId]: vals }))
                  setPage(1)
                },
                onFetchOptions: (colId) => {
                  const others = Object.fromEntries(
                    Object.entries(activeFilters).filter(([k]) => k !== colId),
                  )
                  return getFilterOptions(jobId!, activeTab, colId, others)
                },
              }}
            />

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
                  return downloadResults(jobId!, `Ruleset_Mapping_${ts}.xlsx`)
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
                <button className="btn-primary" onClick={handleRun}>Try Again</button>
                <button className="btn-secondary" onClick={handleReset}>← Start Over</button>
              </div>
            </div>
          </div>
        )}

      </div>

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
