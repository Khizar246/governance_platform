import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import { Target, AlertCircle, RefreshCw, X, List, Package, Info, Layers } from 'lucide-react'
import { toast } from 'sonner'
import type { ColumnDef } from '@tanstack/react-table'
import PageHeader from '../components/layout/PageHeader'
import FileUpload from '../components/common/FileUpload'
import StepIndicator from '../components/common/StepIndicator'
import DataTable from '../components/common/DataTable'
import LoadingOverlay from '../components/common/LoadingOverlay'
import DownloadButton from '../components/common/DownloadButton'
import ConfirmDialog from '../components/common/ConfirmDialog'
import Badge from '../components/common/Badge'
import { Checkbox } from '@/components/ui/checkbox'
import { uploadFiles, runAnalysis, getStatus, downloadResults, cancelJob, getSheetResults, getFilterOptions } from '../api/fpAnalysis'
import HelpAccordion, { HelpStep, HelpPill, TemplateDownloads } from '../components/common/HelpAccordion'
import type { FPAnalysisSummary, FPSheetSummary } from '../types'
import { POLL_INTERVAL_MS } from '../utils/constants'

type Step = 'mode' | 'sheets' | 'upload' | 'running' | 'results' | 'error'
type Mode = 'privilege' | 'entitlement'
type FPRow = Record<string, unknown>

const STEPS = ['Mode', 'Configure', 'Upload', 'Results']
const STEP_INDEX: Record<Step, number> = { mode: 0, sheets: 1, upload: 2, running: 2, results: 3, error: 0 }

const STAGES = [
  { label: 'Initialising',          minPercent: 0  },
  { label: 'Loading Input Data',    minPercent: 3  },
  { label: 'Level 1 — FP Lookup',  minPercent: 12 },
  { label: 'Level 2 — Work-Area',  minPercent: 25 },
  { label: 'Level 3 — SL / TC',   minPercent: 55 },
  { label: 'Finalising',            minPercent: 95 },
]

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
    description: 'Classify each individual privilege pair as False Positive, Single Leg, or True Conflict. Most granular — recommended for detailed audit reports.',
    accentColor: '#3B82F6',
    iconBg: 'bg-blue-50',
    iconColor: 'text-[#3B82F6]',
    tag: 'Granular',
  },
  {
    id: 'entitlement' as Mode,
    icon: Package,
    title: 'Entitlement Level',
    description: 'Classify entire entitlement groups based on their constituent privileges. Higher-level view — recommended for management reporting.',
    accentColor: '#22C55E',
    iconBg: 'bg-green-50',
    iconColor: 'text-[#22C55E]',
    tag: 'High-Level',
  },
]

// ── Column definitions ─────────────────────────────────────────────────────────

function fpClassCell({ getValue }: { getValue: () => unknown }) {
  const v = String(getValue() ?? '')
  const cls =
    v === 'YES'        ? 'bg-green-100 text-green-700'
    : v === 'SL'       ? 'bg-yellow-100 text-yellow-700'
    : v === 'True Conflict' ? 'bg-red-100 text-red-700'
    : 'bg-gray-100 text-gray-500'
  const label = v === 'YES' ? 'False Positive' : v || '—'
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${cls}`}>
      {label}
    </span>
  )
}

const ROLE_COLUMNS: ColumnDef<FPRow>[] = [
  { id: 'CONTROL_NAME',                accessorKey: 'CONTROL_NAME',                header: 'Control Name' },
  { id: 'ENTITLEMENT',                 accessorKey: 'ENTITLEMENT',                 header: 'Entitlement' },
  { id: 'ROLE_DISPLAY_NAME',           accessorKey: 'ROLE_DISPLAY_NAME',           header: 'Role Name' },
  { id: 'INHERITED_ROLE_DISPLAY_NAME', accessorKey: 'INHERITED_ROLE_DISPLAY_NAME', header: 'Inherited Role' },
  { id: 'PRIVILEGE_DISPLAY_NAME',      accessorKey: 'PRIVILEGE_DISPLAY_NAME',      header: 'Privilege Name' },
  { id: 'FP?', accessorFn: (row) => row['FP?'], header: 'Classification', cell: fpClassCell },
  { id: 'Reason',                      accessorKey: 'Reason',                      header: 'Reason' },
]

const USER_COLUMNS: ColumnDef<FPRow>[] = [
  { id: 'CONTROL_NAME',                accessorKey: 'CONTROL_NAME',                header: 'Control Name' },
  { id: 'ENTITLEMENT',                 accessorKey: 'ENTITLEMENT',                 header: 'Entitlement' },
  { id: 'ROLE_DISPLAY_NAME',           accessorKey: 'ROLE_DISPLAY_NAME',           header: 'Role Name' },
  { id: 'INHERITED_ROLE_DISPLAY_NAME', accessorKey: 'INHERITED_ROLE_DISPLAY_NAME', header: 'Inherited Role' },
  { id: 'PRIVILEGE_DISPLAY_NAME',      accessorKey: 'PRIVILEGE_DISPLAY_NAME',      header: 'Privilege Name' },
  { id: 'USER_NAME',                   accessorKey: 'USER_NAME',                   header: 'User Name' },
  { id: 'FP?', accessorFn: (row) => row['FP?'], header: 'Classification', cell: fpClassCell },
  { id: 'Reason',                      accessorKey: 'Reason',                      header: 'Reason' },
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

// ── Component ──────────────────────────────────────────────────────────────────

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

  // Results step state
  const [activeTab, setActiveTab] = useState<string>('')
  const [pageRows, setPageRows] = useState<FPRow[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [total, setTotal] = useState(0)
  const [dataLoading, setDataLoading] = useState(false)
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({})
  const hasActiveFilters = Object.values(activeFilters).some(v => v.length > 0)

  // Poll for analysis completion
  useEffect(() => {
    if (step !== 'running' || !jobId) return
    const interval = setInterval(async () => {
      try {
        const status = await getStatus(jobId)
        setProgress(status.progress)
        setProgressMessage(status.progress_message)
        if (status.status === 'complete') {
          clearInterval(interval)
          const fpSummary = status.results as unknown as FPAnalysisSummary
          setSummary(fpSummary)
          const firstSheet = ALL_SHEET_IDS.find(id => (fpSummary.sheets_analyzed ?? []).includes(id)) ?? ''
          setActiveTab(firstSheet)
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

  // Fetch current page on demand
  useEffect(() => {
    if (step !== 'results' || !jobId || !activeTab) return
    let cancelled = false
    setDataLoading(true)
    getSheetResults(jobId, activeTab, page, pageSize, '', '', activeFilters)
      .then(res => {
        if (!cancelled) {
          setPageRows(res.data as FPRow[])
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

  // ── Derived values ─────────────────────────────────────────────────────────

  const analyzedSheetIds = useMemo(() => {
    if (!summary) return []
    const analyzed = new Set(summary.sheets_analyzed)
    return ALL_SHEET_IDS.filter(id => analyzed.has(id))
  }, [summary])

  const summaryBySheetId = useMemo((): Record<string, FPSheetSummary> => {
    if (!summary) return {}
    const map: Record<string, FPSheetSummary> = {}
    for (const s of summary.sheet_summaries as FPSheetSummary[]) {
      const id = ALL_SHEET_IDS.find(k => SHEET_LABELS[k] === s.sheet)
      if (id) map[id] = s
    }
    return map
  }, [summary])

  const activeColumns = useMemo(
    () => (activeTab.startsWith('USER') ? USER_COLUMNS : ROLE_COLUMNS),
    [activeTab],
  )

  const activeDefaultSort = useMemo(
    () => (activeTab.startsWith('USER') ? USER_DEFAULT_SORT : ROLE_DEFAULT_SORT),
    [activeTab],
  )

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSelectMode = useCallback((m: Mode) => {
    setMode(m)
    setStep('sheets')
  }, [])

  const toggleSheet = (id: string) =>
    setSelectedSheets(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id],
    )

  const handleRunAnalysis = useCallback(async () => {
    if (!sodFile || !fpDbFile) return
    setIsUploading(true)
    setUploadProgress(0)
    setUploadError('')
    try {
      const resp = await uploadFiles(sodFile, fpDbFile, setUploadProgress)
      if (resp.errors?.length) { setUploadError(resp.errors[0]); return }
      const id = resp.job_id
      setJobId(id)
      await runAnalysis(id, { mode, sheets: selectedSheets })
      setStep('running')
      setProgress(0)
      setProgressMessage('Starting FP analysis…')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to start analysis.'
      setUploadError(msg)
    } finally {
      setIsUploading(false)
    }
  }, [sodFile, fpDbFile, mode, selectedSheets])

  const handleTryAgain = useCallback(async () => {
    if (!jobId) { setStep('upload'); return }
    try {
      await runAnalysis(jobId, { mode, sheets: selectedSheets })
      setStep('running')
      setProgress(0)
      setProgressMessage('Retrying analysis…')
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to retry.',
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
    setActiveTab('')
    setPageRows([])
    setPage(1)
    setPageSize(50)
    setTotal(0)
    setDataLoading(false)
    setActiveFilters({})
  }, [jobId])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        icon={<Target size={24} />}
        title="False Positive Analysis"
        subtitle="3-level FP classification — False Positive · Single Leg · True Conflict"
      />

      <div style={{ marginBottom: 20 }}>
        <HelpAccordion title="How to Use This Tool" icon={<Info size={14} color="#2563EB" />} accentColor="#2563EB">
          <HelpStep num={1} text="Choose a mode. Privilege Level analyses each individual privilege pair — use for detailed audit reports. Entitlement Level aggregates up to the entitlement — use for management summaries." />
          <HelpStep num={2} text="On the Configure screen, select which violation sheets from the SOD output you want to include. You can run Role-only, User-only, or both together." />
          <HelpStep num={3} text="Upload the SOD Analysis Output XLSX (produced by the SOD & SA Analysis tool — must contain sheets ROLE_DETAILS, ROLE_SOD, ROLE_SA, USER_SOD, USER_SA) and the FP Database XLSX (sheets: No_action_Privileges, WorkArea_Privileges)." />
          <HelpStep num={4} text="Click Run Analysis. Results classify every violation row as False Positive, Single Leg, or True Conflict. Export before closing — results are not stored between sessions." />
        </HelpAccordion>
        <HelpAccordion title="How the Tool Works" icon={<Layers size={14} color="#0F1E3D" />} accentColor="#0F1E3D">
          <p style={{ fontSize: 13, color: '#64748B', lineHeight: 1.7, marginBottom: 12 }}>Each privilege pair from the SOD output is looked up against the FP Database and placed into one of three buckets:</p>
          <HelpPill label="False Positive" note="Both privileges appear in the No_action_Privileges sheet — the conflict is known-safe and can be removed from the report." />
          <HelpPill label="Single Leg" note="Only one privilege is in the FP database. The conflict is partially mitigated but still requires a compensating control note." />
          <HelpPill label="True Conflict" note="Neither privilege is in the FP database. This is a live violation that must appear in the final deliverable." />
          <p style={{ fontSize: 12.5, color: '#94A3B8', marginTop: 10, lineHeight: 1.6 }}>At Entitlement Level, an entitlement is only marked False Positive if every constituent privilege pair within it is FP — a single True Conflict escalates the whole entitlement.</p>
        </HelpAccordion>
        <TemplateDownloads templates={[
          ['FP Database Template',        'XLSX', '/api/templates/fp-analysis/fp_database_template.xlsx'],
          ['SOD Analysis Output Template', 'XLSX', '/api/templates/fp-analysis/sod_analysis_template.xlsx'],
        ]} />
      </div>

      <StepIndicator steps={STEPS} currentStep={STEP_INDEX[step]} />

      <div className="relative">

        {/* ── Step 0: Mode Selection ─────────────────────────────────── */}
        {step === 'mode' && (
          <div className="slide-in grid grid-cols-2 gap-5">
            {MODE_CARDS.map(({ id, icon: Icon, title, description, accentColor, iconBg, iconColor, tag }) => (
              <button
                key={id}
                onClick={() => handleSelectMode(id)}
                style={{ borderLeftColor: accentColor }}
                className={clsx(
                  'flex flex-col text-left p-6 rounded-xl cursor-pointer',
                  'bg-white border border-gray-200 border-l-[3px] shadow-sm',
                  'focus:outline-none hover:shadow-md transition-shadow duration-150',
                )}
              >
                <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center mb-4', iconBg)}>
                  <Icon size={20} className={iconColor} strokeWidth={1.5} />
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-[15px] font-semibold text-gray-800">{title}</h3>
                  <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{tag}</span>
                </div>
                <p className="text-[13px] text-gray-500 leading-relaxed flex-1">{description}</p>
                <span className="mt-4 text-[13px] font-medium text-gray-400 self-start">Select →</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Step 1: Sheet Configuration ───────────────────────────── */}
        {step === 'sheets' && (
          <div className="slide-in space-y-4">
            <div className="card">
              <div className="flex items-center gap-3 mb-5">
                <span className="label-uppercase">Mode:</span>
                <Badge text={mode === 'privilege' ? 'Privilege Level' : 'Entitlement Level'} variant="info" />
              </div>

              <p className="label-uppercase mb-4">Violation Sheets to Analyse</p>

              <div className="grid grid-cols-2 gap-6">
                {SHEET_GROUPS.map(({ label, ids }) => (
                  <div key={label}>
                    <p className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-3">{label}</p>
                    <div className="space-y-2">
                      {ids.map(id => {
                        const checked = selectedSheets.includes(id)
                        return (
                          <div
                            key={id}
                            onClick={() => toggleSheet(id)}
                            className={clsx(
                              'flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer select-none transition-colors border',
                              checked
                                ? 'bg-blue-50 border-blue-200'
                                : 'bg-gray-50 border-gray-200 hover:bg-gray-100',
                            )}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleSheet(id)}
                              onClick={e => e.stopPropagation()}
                              className="data-[state=checked]:bg-[#3B82F6] data-[state=checked]:border-[#3B82F6]"
                            />
                            <span className={clsx('text-sm font-medium', checked ? 'text-blue-700' : 'text-gray-600')}>
                              {SHEET_LABELS[id]}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {selectedSheets.length === 0 && (
                <p className="text-[13px] text-error mt-4">Select at least one violation sheet to continue.</p>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <button className="btn-secondary" onClick={() => setStep('mode')}>← Change Mode</button>
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

        {/* ── Step 2: Upload Files ───────────────────────────────────── */}
        {step === 'upload' && (
          <div className="slide-in space-y-4">
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

            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-[13px] text-gray-600">
              <span><span className="font-medium">Mode:</span> {mode === 'privilege' ? 'Privilege Level' : 'Entitlement Level'}</span>
              <span className="text-gray-300">·</span>
              <span><span className="font-medium">Sheets:</span> {selectedSheets.map(s => SHEET_LABELS[s]).join(', ')}</span>
              <button className="ml-auto text-[#3B82F6] hover:underline text-[12px]" onClick={() => setStep('sheets')}>
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
                    className="h-full rounded-full transition-[width] duration-300 ease-out"
                    style={{ width: `${uploadProgress}%`, background: '#3B82F6' }}
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
              <button className="btn-secondary" onClick={() => setStep('sheets')}>← Back</button>
              <button
                className="btn-gold"
                disabled={!sodFile || !fpDbFile || isUploading}
                onClick={handleRunAnalysis}
              >
                {isUploading ? 'Uploading…' : 'Run Analysis →'}
              </button>
            </div>
          </div>
        )}

        {/* ── Running ───────────────────────────────────────────────── */}
        {step === 'running' && (
          <div className="slide-in relative min-h-[320px]">
            <LoadingOverlay
              message={progressMessage || 'Running 3-level FP classification…'}
              progress={progress}
              stages={STAGES}
              progressMessage={progressMessage}
            />
          </div>
        )}

        {/* ── Results ───────────────────────────────────────────────── */}
        {step === 'results' && summary && (
          <div className="slide-in space-y-5">

            {/* Mode badge + sheet count */}
            <div className="flex items-center gap-3">
              <span className="label-uppercase">Mode:</span>
              <Badge
                text={summary.mode === 'privilege' ? 'Privilege Level' : 'Entitlement Level'}
                variant="info"
              />
              <span className="text-[13px] text-gray-400 ml-auto">
                {analyzedSheetIds.length} sheet{analyzedSheetIds.length !== 1 ? 's' : ''} analysed
              </span>
            </div>

            {/* Summary cards — one per analyzed sheet */}
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: `repeat(${analyzedSheetIds.length}, 1fr)` }}
            >
              {analyzedSheetIds.map(id => {
                const s = summaryBySheetId[id]
                if (!s) return null
                return (
                  <div key={id} className="card p-4">
                    <div className="text-[12px] font-semibold text-gray-500 uppercase tracking-[0.06em] mb-3">
                      {SHEET_LABELS[id]}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      <div>
                        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-[0.06em] mb-0.5">Total</div>
                        <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 22, fontWeight: 600, color: '#0F1E3D', lineHeight: 1.2 }}>
                          {s.total.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-[0.06em] mb-0.5">False Positive</div>
                        <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 22, fontWeight: 600, color: '#16A34A', lineHeight: 1.2 }}>
                          {s.fp_count.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-[0.06em] mb-0.5">Single Leg</div>
                        <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 22, fontWeight: 600, color: '#D97706', lineHeight: 1.2 }}>
                          {s.sl_count.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-[0.06em] mb-0.5">True Conflict</div>
                        <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 22, fontWeight: 600, color: '#DC2626', lineHeight: 1.2 }}>
                          {s.tc_count.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Tabbed DataTable */}
            <div className="card p-0 overflow-hidden">
              {/* Tab bar */}
              <div className="flex items-center border-b border-gray-200 bg-white">
                <div className="flex flex-1">
                  {analyzedSheetIds.map(id => (
                    <button
                      key={id}
                      onClick={() => { setActiveTab(id); setPage(1); setActiveFilters({}) }}
                      className={clsx(
                        'px-5 py-3 text-[13px] font-medium transition-colors border-b-2',
                        activeTab === id
                          ? 'border-[#2563EB] text-[#2563EB]'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                      )}
                    >
                      {SHEET_LABELS[id]}
                    </button>
                  ))}
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
                  columns={activeColumns}
                  defaultSorting={activeDefaultSort}
                  isLoading={dataLoading}
                  emptyMessage="No violations for this sheet"
                  maxHeight="480px"
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
                  return downloadResults(jobId!, `FP_Analysis_${summary.mode}_${ts}.xlsx`)
                }}
              />
            </div>
          </div>
        )}

        {/* ── Error ─────────────────────────────────────────────────── */}
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
