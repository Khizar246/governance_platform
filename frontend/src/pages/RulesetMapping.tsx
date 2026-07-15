import { useState, useEffect, useCallback, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { clsx } from 'clsx'
import { GitMerge, AlertCircle, CheckCircle2, RefreshCw, X, Info } from 'lucide-react'
import { toast } from 'sonner'
import PageHeader from '../components/layout/PageHeader'
import FileUpload from '../components/common/FileUpload'
import StepIndicator from '../components/common/StepIndicator'
import StatCard from '../components/common/StatCard'
import LoadingOverlay from '../components/common/LoadingOverlay'
import type { ProgressStep } from '../components/common/LoadingOverlay'
import DownloadButton from '../components/common/DownloadButton'
import DataTable from '../components/common/DataTable'
import ConfirmDialog from '../components/common/ConfirmDialog'
import HelpAccordion, { HelpStep, SchemaTable } from '../components/common/HelpAccordion'
import {
  uploadFiles, runAnalysis, getStatus, downloadResults, cancelJob,
  getResults, getFilterOptions,
} from '../api/rulesetMapping'
import type { ResultTab, Direction } from '../api/rulesetMapping'
import type { UploadResponse, RulesetMappingSummary } from '../types'
import { POLL_INTERVAL_MS } from '../utils/constants'
import useScrollToTopOnChange from '../utils/useScrollToTopOnChange'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// ── Column definitions ────────────────────────────────────────────────────────

// Column header descriptions. Control-name headers are direction-dependent, so we
// match on a token suffix ("Control Name" / "Entitlement") rather than exact names.
const COLUMN_DESCRIPTIONS: Record<string, string> = {
  'Control Name': 'A SoD/SA control name. The source column is the ruleset being mapped FROM; the matched column is the best target match.',
  'Confidence Score': 'Per-leg Jaccard similarity of privilege sets × 100%. For SoD it is the weaker of the two legs (both must clear 60%). 100% = identical privilege sets.',
  'Match Type': '"Direct" = matched an existing target control (both SoD legs ≥ 60%). "Derived Control" = an inferred SoD pair (both entitlements map but no control pairs them; SoD only). "Unmatched" = no valid mapping.',
  'Missing Privileges': 'Privileges present in the matched target entitlement but absent from the source entitlement — the privileges to add, grouped by entitlement.',
  'Missing Privilege': 'A single target privilege absent from the source entitlement — one row per missing privilege. These are the privileges to add to bring the source entitlement in line with its matched target entitlement.',
  'Entitlement': 'An entitlement name from the source ruleset, or its best target match.',
  'Privilege Match Count': 'Number of source privileges found in the matched target entitlement (matched/total).',
  'Jaccard Similarity (%)': 'Overlap ÷ union of the two privilege sets.',
  'Confidence Score (%)': 'Weighted composite match score: 0.65×Jaccard + 0.20×module match + 0.10×coverage + 0.05×name (module match = 1 when the source and target entitlement share the same Module, else 0; coverage = matched ÷ source privilege count; name = abbreviation-aware entitlement-name similarity). The match is selected, and its confidence tier derived, from this score.',
  'Client Privilege Count': 'Number of distinct privileges held by the source entitlement.',
  'EY Privilege Count': 'Number of distinct privileges held by the matched target entitlement.',
  'EY Privileges Missing in Client': 'Privileges in the matched target entitlement that the source entitlement lacks — the target-side gap.',
  'Client Privileges Missing in EY': 'Privileges in the source entitlement absent from the matched target entitlement — the source-side gap.',
  'Match Confidence': 'Tier for mapped entitlements (composite score ≥ 30%): High ≥ 70%, Medium 50–69%, Low 30–49%. Below 30% the entitlement is "Not Mapped".',
  'Runner-Up EY Entitlements': 'The 2nd and 3rd best target candidates with their match counts and composite confidence scores.',
  'Control Type': 'Whether the missing control is a SoD or SA control.',
  'Source Control': 'The control in the source ruleset that was matched.',
  'Matched Control': 'The best-matching control in the target ruleset.',
}

function describeColumn(key: string): string {
  if (COLUMN_DESCRIPTIONS[key]) return COLUMN_DESCRIPTIONS[key]
  for (const token of ['Control Name', 'Entitlement Match', 'Entitlement']) {
    if (key.includes(token)) return COLUMN_DESCRIPTIONS[token === 'Entitlement Match' ? 'Entitlement' : token]
  }
  return key
}

function matchTypeCell(info: { getValue: () => unknown }) {
  const val = String(info.getValue() ?? '')
  const cls =
    val === 'Direct'          ? 'bg-green-100 text-green-700 border border-green-200' :
    val === 'Derived Control' ? 'bg-yellow-100 text-yellow-700 border border-yellow-200' :
    val === 'Unmatched'       ? 'bg-red-100 text-red-600 border border-red-200' :
    'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>
      {val}
    </span>
  )
}

// Build TanStack columns from the actual row keys returned by the API. Headers are
// direction-aware (the source/target labels change), so columns are derived at
// render time from the data rather than hardcoded.
function buildColumns(rows: Record<string, unknown>[]): ColumnDef<Record<string, unknown>>[] {
  const keys = rows.length > 0 ? Object.keys(rows[0]) : []
  return keys.map(key => ({
    accessorKey: key,
    header: () => (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1 cursor-help">
            {key}
            <Info size={10} className="text-gray-400 shrink-0" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">{describeColumn(key)}</TooltipContent>
      </Tooltip>
    ),
    cell: key === 'Match Type' ? matchTypeCell : (info: { getValue: () => unknown }) => {
      const val = info.getValue()
      return val === null || val === undefined ? '' : String(val)
    },
  }))
}

// ── Step / tab types ──────────────────────────────────────────────────────────

type Step = 'upload' | 'preview' | 'running' | 'results' | 'error'

const STEPS = ['Upload', 'Preview', 'Analysis', 'Results']
const STEP_INDEX: Record<Step, number> = { upload: 0, preview: 1, running: 2, results: 3, error: 0 }

const PROGRESS_STEPS: ProgressStep[] = [
  { step: 1, label: 'Loading rulesets',                phase: 1 },
  { step: 2, label: 'Mapping entitlements',            phase: 2 },
  { step: 3, label: 'Matching SoD controls',           phase: 2 },
  { step: 4, label: 'Matching SA controls',            phase: 2 },
  { step: 5, label: 'Building summary',                phase: 3 },
  { step: 6, label: 'Writing Excel report',            phase: 4 },
]

const TABS: { id: ResultTab; label: string }[] = [
  { id: 'sod',          label: 'SoD Mapping' },
  { id: 'sa',           label: 'SA Mapping' },
  { id: 'ent',          label: 'Entitlement Mapping' },
  { id: 'missing_ctrl', label: 'Missing Controls' },
  { id: 'missing_priv', label: 'Missing Privileges' },
]

const DIRECTIONS: { id: Direction; label: string }[] = [
  { id: 'c2e', label: 'Client → EY' },
  { id: 'e2c', label: 'EY → Client' },
]

// The Missing Controls tab lists source controls with no target match, so its
// label depends on the active direction (which ruleset is the source).
function tabLabel(id: ResultTab, label: string, direction: Direction): string {
  if (id === 'missing_ctrl') {
    return direction === 'c2e' ? 'Client Controls Missing in EY' : 'EY Controls Missing in Client'
  }
  return label
}

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
  useScrollToTopOnChange(step)
  const [clientFile, setClientFile]       = useState<File | null>(null)
  const [eyFile, setEyFile]               = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploading, setIsUploading]     = useState(false)
  const [uploadResponse, setUploadResponse] = useState<UploadResponse | null>(null)
  const [jobId, setJobId]                 = useState<string | null>(null)
  const [progress, setProgress]           = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [currentStep, setCurrentStep]     = useState(0)
  const [summary, setSummary]             = useState<RulesetMappingSummary | null>(null)
  const [errors, setErrors]               = useState<string[]>([])
  const [uploadError, setUploadError]     = useState('')
  const [uploadErrorDetails, setUploadErrorDetails] = useState<string[]>([])
  const [activeTab, setActiveTab]         = useState<ResultTab>('sod')
  const [direction, setDirection]         = useState<Direction>('c2e')
  const [confirmReset, setConfirmReset]   = useState(false)
  const [tableRows, setTableRows]         = useState<Record<string, unknown>[]>([])
  const [page, setPage]                   = useState(1)
  const [pageSize, setPageSize]           = useState(50)
  const [total, setTotal]                 = useState(0)
  const [isLoadingResults, setIsLoadingResults] = useState(false)
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({})

  const hasActiveFilters = Object.values(activeFilters).some(v => v.length > 0)
  const columns = useMemo(() => buildColumns(tableRows), [tableRows])

  // Polling
  useEffect(() => {
    if (step !== 'running' || !jobId) return
    const interval = setInterval(async () => {
      try {
        const s = await getStatus(jobId)
        setProgress(s.progress)
        setProgressMessage(s.progress_message)
        setCurrentStep(s.step ?? 0)
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
    getResults(jobId, { page, pageSize, tab: activeTab, direction, filters: activeFilters })
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
  }, [step, jobId, activeTab, direction, page, pageSize, activeFilters])

  const handleUpload = useCallback(async () => {
    if (!clientFile || !eyFile) return
    setIsUploading(true)
    setUploadProgress(0)
    setUploadError('')
    setUploadErrorDetails([])
    try {
      const resp = await uploadFiles(clientFile, eyFile, setUploadProgress)
      if (resp.errors?.length) {
        setUploadError(resp.errors[0])
        setUploadErrorDetails(resp.errors.slice(1))
        return
      }
      setUploadResponse(resp)
      setJobId(resp.job_id)
      setStep('preview')
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { message?: string; details?: string[] } } })?.response?.data
      setUploadError(data?.message || 'Upload failed.')
      setUploadErrorDetails(Array.isArray(data?.details) ? data.details : [])
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
    setCurrentStep(0)
    setSummary(null)
    setErrors([])
    setUploadError('')
    setUploadErrorDetails([])
    setActiveTab('sod')
    setDirection('c2e')
    setConfirmReset(false)
    setTableRows([])
    setPage(1)
    setPageSize(50)
    setTotal(0)
    setIsLoadingResults(false)
    setActiveFilters({})
  }, [jobId])

  const tabCounts = useMemo<Record<ResultTab, number>>(() => {
    const empty = { sod: 0, sa: 0, ent: 0, missing_ctrl: 0, missing_priv: 0 }
    if (!summary) return empty
    // Prefer the per-direction block; fall back to the flat (Client→EY) keys.
    const c = (direction === 'c2e' ? summary.c2e : summary.e2c) ?? summary
    return {
      sod:          c.sod_total ?? 0,
      sa:           c.sa_total ?? 0,
      ent:          c.ent_total ?? 0,
      missing_ctrl: c.missing_ctrl_total ?? 0,
      missing_priv: c.missing_priv_total ?? 0,
    }
  }, [summary, direction])

  return (
    <div>
      <PageHeader
        icon={<GitMerge size={24} />}
        title="Ruleset Mapping"
        subtitle="Map client SoD and SA controls to EY controls using privilege-set Jaccard similarity"
      />

      <div className="mb-5">
        <HelpAccordion title="How to Use This Tool" icon={<Info size={14} color="#2563EB" />} accentColor="#2563EB">
          <HelpStep num={1} text="This tool compares two ruleset files — one from your Client and one from EY — and matches up their controls. Download the two blank template files from the Downloads page (sidebar → Resources) and fill them in first." />
          <HelpStep num={2} text="Each file needs these 3 sheets. The table below shows every column each sheet needs — Required columns must be present or the upload will fail; Optional columns can be left out and the mapping will still run." />
          <HelpStep num={3} text="Upload both files, then click Validate & Preview. If anything is missing, the tool tells you exactly what and where — fix it and upload again." />
          <HelpStep num={4} text="Click Run Mapping once both files pass. The results page lets you flip between Client → EY and EY → Client, and shows matched controls, missing controls, and missing privileges. Download the finished Excel report from there." />
          <SchemaTable
            fileLabel="Client Ruleset (.xlsx) — and EY Ruleset (.xlsx), same 3 sheets"
            rows={[
              { sheet: 'SoD Ruleset', column: 'Control Name', status: 'Required', note: 'The name of the control, e.g. "SOD-001".' },
              { sheet: 'SoD Ruleset', column: 'LHS Entitlement', status: 'Required', note: 'One side of the conflicting access.' },
              { sheet: 'SoD Ruleset', column: 'RHS Entitlement', status: 'Required', note: 'The other side of the conflicting access.' },
              { sheet: 'SoD Ruleset', column: 'Risk Ranking', status: 'Optional', note: 'High, Medium, or Low.' },
              { sheet: 'SoD Ruleset', column: 'Module(s)', status: 'Optional', note: 'Which Oracle module this control belongs to, e.g. "Payables".' },
              { sheet: 'SA Ruleset', column: 'Control Name', status: 'Required', note: 'The name of the control.' },
              { sheet: 'SA Ruleset', column: 'Entitlement', status: 'Required', note: 'The single sensitive access this control watches.' },
              { sheet: 'SA Ruleset', column: 'Risk Ranking', status: 'Optional', note: 'High, Medium, or Low.' },
              { sheet: 'SA Ruleset', column: 'Side', status: 'Optional', note: 'A label for which side this access sits on.' },
              { sheet: 'SA Ruleset', column: 'Module(s)', status: 'Optional', note: 'Which Oracle module this control belongs to.' },
              { sheet: 'Entitlement to Privilege', column: 'Entitlement Name', status: 'Required', note: 'Must match the entitlement names used in SOD & SA Controls.' },
              { sheet: 'Entitlement to Privilege', column: 'Privilege Code', status: 'Required', note: 'The exact Oracle privilege code — this is what the tool actually matches on.' },
              { sheet: 'Entitlement to Privilege', column: 'Module', status: 'Required', note: 'Which Oracle module this privilege belongs to. Used to improve match accuracy.' },
              { sheet: 'Entitlement to Privilege', column: 'Privilege Name', status: 'Optional', note: 'The plain-English name of the privilege.' },
            ]}
          />
        </HelpAccordion>
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
                    className="h-full rounded-full transition-[width] duration-300 ease-out w-[var(--w)] bg-ey-yellow"
                    style={{ '--w': `${uploadProgress}%` } as React.CSSProperties}
                  />
                </div>
              </div>
            )}

            {uploadError && (
              <div className="flex items-start gap-2 p-3 bg-error-light rounded border border-error/30 text-sm text-error">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1.5">
                  <span>{uploadError}</span>
                  {uploadErrorDetails.length > 0 && (
                    <ul className="list-disc pl-5 space-y-0.5">
                      {uploadErrorDetails.map((d, i) => (
                        <li key={i} className="break-words">{d}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  onClick={() => { setUploadError(''); setUploadErrorDetails([]) }}
                  className="text-error/60 hover:text-error shrink-0"
                >
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
              currentStep={currentStep}
              steps={PROGRESS_STEPS}
              withFp={false}
            />
          </div>
        )}

        {/* ── Results ────────────────────────────────────────────────────── */}
        {step === 'results' && summary && (
          <div className="slide-in space-y-5">
            {/* Direction toggle — recomputes every report relative to the source ruleset */}
            <div className="flex items-center gap-3">
              <span className="label-uppercase">Mapping Direction</span>
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                {DIRECTIONS.map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => {
                      if (id === direction) return
                      setDirection(id)
                      setActiveTab('sod')
                      setPage(1)
                      setActiveFilters({})
                    }}
                    className={clsx(
                      'px-3.5 py-1.5 text-[13px] font-medium rounded-md transition-colors duration-150',
                      direction === id
                        ? 'bg-white text-gray-800 shadow-sm border border-gray-200'
                        : 'text-gray-500 hover:text-gray-700',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Summary StatCards (active direction) */}
            {(() => {
              const c = (direction === 'c2e' ? summary.c2e : summary.e2c) ?? summary
              return (
                <div className="grid grid-cols-4 gap-3">
                  <StatCard value={c.sod_direct ?? 0} label="SoD Direct" badge={{ text: 'Direct', variant: 'success' }} />
                  <StatCard value={c.sod_derived ?? 0} label="SoD Derived" badge={{ text: 'Derived', variant: 'warning' }} />
                  <StatCard value={c.missing_ctrl_total ?? 0} label="Missing Controls" badge={{ text: 'Gap', variant: 'error' }} />
                  <StatCard value={c.missing_priv_total ?? 0} label="Privilege Gaps" badge={{ text: 'Recommend', variant: 'warning' }} />
                </div>
              )
            })()}

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
                    {tabLabel(id, label, direction)}
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
              columns={columns}
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
                  return getFilterOptions(jobId!, activeTab, direction, colId, others)
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
