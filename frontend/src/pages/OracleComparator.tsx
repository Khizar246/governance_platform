import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Search, AlertCircle, CheckCircle2, RefreshCw, X,
  Users, Database, Layers, Info,
} from 'lucide-react'
import { toast } from 'sonner'
import type { ColumnDef } from '@tanstack/react-table'
import PageHeader from '../components/layout/PageHeader'
import FileUpload from '../components/common/FileUpload'
import StepIndicator from '../components/common/StepIndicator'
import DataTable from '../components/common/DataTable'
import LoadingOverlay from '../components/common/LoadingOverlay'
import type { ProgressStep } from '../components/common/LoadingOverlay'
import DownloadButton from '../components/common/DownloadButton'
import ConfirmDialog from '../components/common/ConfirmDialog'
import HelpAccordion, { HelpStep, SchemaTable } from '../components/common/HelpAccordion'
import Badge from '../components/common/Badge'
import { uploadFiles, runAnalysis, getStatus, downloadResults, cancelJob, getResults, getFilterOptions } from '../api/oracleComparator'
import type { OracleComparatorSummary } from '../types'
import { POLL_INTERVAL_MS } from '../utils/constants'
import useScrollToTopOnChange from '../utils/useScrollToTopOnChange'

type Step = 'type' | 'upload' | 'running' | 'results' | 'error'
type AnalysisType = 'rbac' | 'dsp' | 'both'
type OracleRow = Record<string, unknown>

const STEPS = ['Analysis Type', 'Upload Files', 'Results']
const STEP_INDEX: Record<Step, number> = { type: 0, upload: 1, running: 1, results: 2, error: 0 }

const PROGRESS_STEPS: ProgressStep[] = [
  { step: 1, label: 'Loading environment files',      phase: 1 },
  { step: 2, label: 'Validating schema',              phase: 1 },
  { step: 3, label: 'Comparing duty roles',           phase: 2 },
  { step: 4, label: 'Comparing privileges',           phase: 2 },
  { step: 5, label: 'Building comparison summary',    phase: 3 },
  { step: 6, label: 'Writing Excel report',           phase: 4 },
]

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
    description: 'Compare duty roles, inherited role assignments, and privilege-to-role mappings between two Oracle environments.',
    accentClass: 'border-l-green-500',
    iconBg: 'bg-green-50',
    iconColor: 'text-green-500',
    meta: '2 RBAC files',
    recommended: false,
  },
  {
    id: 'dsp' as AnalysisType,
    icon: Database,
    title: 'DSP Analysis',
    description: 'Compare data security policies, condition statements, and column-level access controls across environments.',
    accentClass: 'border-l-blue-500',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-500',
    meta: '2 DSP files',
    recommended: false,
  },
  {
    id: 'both' as AnalysisType,
    icon: Layers,
    title: 'Complete Analysis',
    description: 'Full bi-directional comparison covering both RBAC and DSP. Requires two pairs of files plus environment names.',
    accentClass: 'border-l-yellow-500',
    iconBg: 'bg-yellow-50',
    iconColor: 'text-yellow-500',
    meta: '4 files total',
    recommended: true,
  },
]

const PLACEHOLDER_COLS: ColumnDef<OracleRow>[] = Array.from({ length: 5 }, (_, i) => ({
  id: `ph-${i}`,
  accessorKey: `ph-${i}`,
  header: '',
}))

function statusCell({ getValue }: { getValue: () => unknown }) {
  const v = String(getValue() ?? '')
  const isMatch = v.toLowerCase().includes('exists')
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${isMatch ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {v}
    </span>
  )
}

function matchRatePill(rate: number) {
  const cls =
    rate >= 90 ? 'bg-[rgba(34,197,94,0.1)] text-green-500'
    : rate >= 60 ? 'bg-[rgba(234,179,8,0.1)] text-yellow-500'
    : 'bg-[rgba(239,68,68,0.1)] text-red-500'
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>
      {rate}%
    </span>
  )
}

export default function OracleComparator() {
  const [step, setStep] = useState<Step>('type')
  useScrollToTopOnChange(step)
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
  const [currentStep, setCurrentStep] = useState(0)
  const [summary, setSummary] = useState<OracleComparatorSummary | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [uploadError, setUploadError] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)

  // Results detail table state
  const [selectedDir, setSelectedDir] = useState<'1to2' | '2to1'>('1to2')
  const [selectedType, setSelectedType] = useState('')
  const [detailRows, setDetailRows] = useState<OracleRow[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [total, setTotal] = useState(0)
  const [detailLoading, setDetailLoading] = useState(false)
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({})
  const hasActiveFilters = Object.values(activeFilters).some(v => v.length > 0)

  const needsRbac = analysisType === 'rbac' || analysisType === 'both'
  const needsDsp  = analysisType === 'dsp'  || analysisType === 'both'

  const canRun =
    env1Name.trim() !== '' &&
    env2Name.trim() !== '' &&
    env1Name.trim() !== env2Name.trim() &&
    (!needsRbac || (rbacFile1 !== null && rbacFile2 !== null)) &&
    (!needsDsp  || (dspFile1  !== null && dspFile2  !== null))

  // Poll for analysis completion
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
          const result = s.results as unknown as OracleComparatorSummary
          setSummary(result)
          const firstType = Array.from(new Set(result.comparisons.map(c => c.comp_type)))[0] ?? ''
          setSelectedType(firstType)
          setSelectedDir('1to2')
          setStep('results')
          toast.success('Comparison complete!')
        } else if (s.status === 'failed') {
          clearInterval(interval)
          setErrors(s.errors)
          setStep('error')
          toast.error(s.errors[0] || 'Analysis failed.')
        }
      } catch { /* keep polling */ }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [step, jobId])

  // Fetch current page on demand
  useEffect(() => {
    if (step !== 'results' || !jobId || !selectedType) return
    let cancelled = false
    setDetailLoading(true)
    getResults(jobId, selectedDir, selectedType, page, pageSize, undefined, undefined, activeFilters)
      .then(res => {
        if (!cancelled) {
          setDetailRows(res.rows)
          setTotal(res.total)
          setDetailLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetailRows([])
          setTotal(0)
          setDetailLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [step, jobId, selectedDir, selectedType, page, pageSize, activeFilters])

  const handleSelectType = useCallback((t: AnalysisType) => {
    setAnalysisType(t)
    if (t === 'rbac') { setDspFile1(null);  setDspFile2(null) }
    if (t === 'dsp')  { setRbacFile1(null); setRbacFile2(null) }
    setStep('upload')
  }, [])

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
          dspFile1:  needsDsp  ? dspFile1!  : undefined,
          dspFile2:  needsDsp  ? dspFile2!  : undefined,
          env1Name: env1Name.trim(),
          env2Name: env2Name.trim(),
          analysisType,
        },
        setUploadProgress,
      )
      if (resp.errors?.length) { setUploadError(resp.errors[0]); return }
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
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to start comparison.'
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
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to retry.',
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
    setDspFile1(null);  setDspFile2(null)
    setUploadProgress(0)
    setIsUploading(false)
    setJobId(null)
    setProgress(0)
    setProgressMessage('')
    setCurrentStep(0)
    setSummary(null)
    setErrors([])
    setUploadError('')
    setConfirmReset(false)
    setSelectedDir('1to2')
    setSelectedType('')
    setDetailRows([])
    setPage(1)
    setPageSize(50)
    setTotal(0)
    setDetailLoading(false)
    setActiveFilters({})
  }, [jobId])

  const availableCompTypes = useMemo(() => {
    if (!summary) return []
    return Array.from(new Set(summary.comparisons.map(c => c.comp_type)))
  }, [summary])

  const detailColumns = useMemo((): ColumnDef<OracleRow>[] => {
    if (detailRows.length === 0) return PLACEHOLDER_COLS
    return Object.keys(detailRows[0]).map(key => {
      const col: ColumnDef<OracleRow> = {
        id: key,
        accessorKey: key,
        header: key.replace(/_/g, ' '),
      }
      if (key === 'Status') col.cell = statusCell
      return col
    })
  }, [detailRows])

  return (
    <div>
      <PageHeader
        icon={<Search size={24} />}
        title="Oracle Comparator"
        subtitle="Compare duty roles, privileges, and DSP across two Oracle environments"
      />

      <div className="mb-5">
        <HelpAccordion title="How to Use This Tool" icon={<Info size={14} className="text-blue-600" />} accentColor="#2563EB">
          <HelpStep num={1} text="This tool compares two Oracle environments — like Production and a test environment — and shows what's different between them. Pick RBAC (roles and privileges), DSP (data security policies), or Complete (both)." />
          <HelpStep num={2} text="Give each environment a short name, like 'Production' and 'UAT'. These names show up in the results so you know which side is which." />
          <HelpStep num={3} text="Export the files from Oracle Fusion and upload them. The tables below show exactly which columns each file needs. The tool checks for these columns as soon as you upload and will tell you right away if any are missing." />
          <HelpStep num={4} text="Click Run Comparison. The results show what exists only in Environment 1, only in Environment 2, and in both. Download the Excel report when you're done." />
          <div className="flex items-start gap-2 mb-[14px] px-3 py-[9px] rounded-[7px] bg-blue-50 border border-blue-200">
            <Info size={13} className="text-blue-700 mt-0.5 shrink-0" />
            <span className="text-[12.5px] text-blue-700 leading-[1.5]">
              In most cases, the files you export directly from Oracle Fusion already match the format below — you can upload them as-is without any changes.
            </span>
          </div>
          <SchemaTable
            fileLabel="RBAC files (Environment 1 and Environment 2) — .csv, .xlsx, or .xls"
            rows={[
              { column: 'ROLE NAME', status: 'Required', note: 'The name of the role.' },
              { column: 'ENTITLEMENT', status: 'Required', note: 'The privilege or access granted to the role.' },
              { column: 'INHERITED ROLE NAME', status: 'Required', note: 'A role this role picks up access from, if any.' },
            ]}
          />
          <SchemaTable
            fileLabel="DSP files (Environment 1 and Environment 2) — .csv, .xlsx, or .xls"
            rows={[
              { column: 'ROLE NAME', status: 'Required', note: 'The name of the role.' },
              { column: 'INHERITED ROLE NAME', status: 'Required', note: 'A role this role picks up access from, if any.' },
              { column: 'GRANT END DATE', status: 'Required', note: 'When this access grant expires, if it does.' },
              { column: 'OBJECT NAME', status: 'Required', note: 'The data object this policy protects.' },
              { column: 'FUNCTION NAME', status: 'Required', note: 'The function this policy applies to.' },
              { column: 'INSTANCE SET NAME', status: 'Required', note: 'Which specific records this policy covers.' },
            ]}
          />
        </HelpAccordion>
      </div>

      <StepIndicator steps={STEPS} currentStep={STEP_INDEX[step]} />

      <div className="relative">

        {/* ── Step 0: Analysis Type ──────────────────────────────────── */}
        {step === 'type' && (
          <div className="slide-in grid grid-cols-3 gap-4">
            {TYPE_CARDS.map(({ id, icon: Icon, title, description, accentClass, iconBg, iconColor, meta, recommended }) => (
              <button
                key={id}
                onClick={() => handleSelectType(id)}
                className={clsx(
                  'relative flex flex-col text-left p-6 rounded-xl cursor-pointer',
                  'bg-white border border-gray-200 border-l-[3px] shadow-sm',
                  'focus:outline-none hover:shadow-md transition-shadow duration-150',
                  accentClass,
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

        {/* ── Step 1: Upload Files ───────────────────────────────────── */}
        {step === 'upload' && (
          <div className="slide-in space-y-5">
            {/* Environment names */}
            <div className="card">
              <p className="label-uppercase mb-3">Environment Names</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-uppercase block mb-1.5">Environment 1</label>
                  <input
                    type="text"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:border-ey-yellow focus:ring-1 focus:ring-ey-yellow/40 transition-colors"
                    placeholder="e.g. Production"
                    value={env1Name}
                    onChange={e => setEnv1Name(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label-uppercase block mb-1.5">Environment 2</label>
                  <input
                    type="text"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:border-ey-yellow focus:ring-1 focus:ring-ey-yellow/40 transition-colors"
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

            {/* Config summary bar */}
            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-[13px] text-gray-600">
              <span>
                <span className="font-medium">Type:</span>{' '}
                {TYPE_CARDS.find(c => c.id === analysisType)?.title}
              </span>
              <button
                className="ml-auto text-blue-500 hover:underline text-[12px]"
                onClick={() => setStep('type')}
              >
                Change
              </button>
            </div>

            {isUploading && (
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Uploading files…</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-300 ease-out bg-green-500 w-[var(--w)]"
                    style={{ '--w': `${uploadProgress}%` } as React.CSSProperties}
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
                {isUploading ? 'Uploading…' : 'Run Comparison →'}
              </button>
            </div>
          </div>
        )}

        {/* ── Running ───────────────────────────────────────────────── */}
        {step === 'running' && (
          <div className="slide-in relative min-h-[320px]">
            <LoadingOverlay
              message={progressMessage || 'Comparing environments…'}
              progress={progress}
              currentStep={currentStep}
              steps={PROGRESS_STEPS}
              withFp={false}
            />
          </div>
        )}

        {/* ── Results ───────────────────────────────────────────────── */}
        {step === 'results' && summary && (
          <div className="slide-in space-y-5">

            {/* Header */}
            <div className="flex items-center gap-3">
              <CheckCircle2 size={16} className="text-success" />
              <span className="text-[15px] font-semibold text-gray-800">{summary.env1_name}</span>
              <span className="text-sm text-gray-400">vs</span>
              <span className="text-[15px] font-semibold text-gray-800">{summary.env2_name}</span>
              <Badge
                text={summary.analysis_type === 'both' ? 'Complete' : summary.analysis_type.toUpperCase()}
                variant="info"
              />
            </div>

            {/* Summary table */}
            <div className="card">
              <p className="text-card-title mb-3">Summary</p>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {(['Analysis Type', 'Direction', 'Total Records', 'Matches', 'Missing', 'Match Rate %'] as const).map(h => (
                        <th
                          key={h}
                          className={clsx(
                            'px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide',
                            h === 'Analysis Type' || h === 'Direction' ? 'text-left' : 'text-right',
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.comparisons.map((row, i) => (
                      <tr
                        key={`${row.comp_type}-${row.direction}`}
                        className={clsx('border-b border-gray-100 last:border-0', i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60')}
                      >
                        <td className="px-4 py-3 text-[13px] font-medium text-gray-700">
                          {COMP_TYPE_LABELS[row.comp_type] ?? row.comp_type}
                        </td>
                        <td className="px-4 py-3 text-[13px] text-gray-600 whitespace-nowrap">
                          {row.direction}
                        </td>
                        <td className="px-4 py-3 text-[13px] text-gray-700 text-right font-mono tabular-nums">
                          {row.total.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-[13px] text-right font-mono tabular-nums text-green-500">
                          {row.matches.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-[13px] text-right font-mono tabular-nums">
                          <span className={row.missing > 0 ? 'text-red-500' : 'text-gray-400'}>
                            {row.missing.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {matchRatePill(row.match_rate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Detail table card */}
            <div className="card p-0 overflow-hidden">

              {/* Control bar */}
              <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-b border-gray-200 bg-white">

                {/* Direction selector */}
                <div className="flex items-center gap-2">
                  <span className="label-uppercase text-gray-500 shrink-0">Direction:</span>
                  <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-[13px]">
                    <button
                      onClick={() => { setSelectedDir('1to2'); setPage(1); setActiveFilters({}) }}
                      className={clsx(
                        'px-3 py-1.5 font-medium transition-colors whitespace-nowrap',
                        selectedDir === '1to2'
                          ? 'bg-navy text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50',
                      )}
                    >
                      {summary.env1_name} → {summary.env2_name}
                    </button>
                    <button
                      onClick={() => { setSelectedDir('2to1'); setPage(1); setActiveFilters({}) }}
                      className={clsx(
                        'px-3 py-1.5 font-medium transition-colors whitespace-nowrap border-l border-gray-200',
                        selectedDir === '2to1'
                          ? 'bg-navy text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50',
                      )}
                    >
                      {summary.env2_name} → {summary.env1_name}
                    </button>
                  </div>
                </div>

                {/* Type selector */}
                <div className="flex items-center gap-2">
                  <span className="label-uppercase text-gray-500 shrink-0">Type:</span>
                  <div className="flex gap-1.5">
                    {availableCompTypes.map(ct => (
                      <button
                        key={ct}
                        onClick={() => { setSelectedType(ct); setPage(1); setActiveFilters({}) }}
                        className={clsx(
                          'px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors whitespace-nowrap',
                          selectedType === ct
                            ? 'bg-ey-yellow border-ey-yellow text-gray-900'
                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50',
                        )}
                      >
                        {COMP_TYPE_LABELS[ct] ?? ct}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Clear All Filters */}
                <button
                  onClick={() => { setActiveFilters({}); setPage(1) }}
                  disabled={!hasActiveFilters}
                  className="flex items-center gap-1 ml-auto text-[11px] text-gray-500 hover:text-gray-700 transition-colors disabled:text-gray-300 disabled:cursor-default"
                >
                  <X size={11} /> Clear All Filters
                </button>
              </div>

              {/* DataTable */}
              <div className="p-4">
                <DataTable
                  data={detailRows}
                  columns={detailColumns}
                  isLoading={detailLoading}
                  maxHeight="460px"
                  emptyMessage="No records for this selection"
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
                      return getFilterOptions(jobId!, selectedDir, selectedType, colId, others)
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
                <RefreshCw size={14} /> New Comparison
              </button>
              <DownloadButton
                onClick={async () => {
                  const now = new Date()
                  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
                  return downloadResults(jobId!, `Oracle_Comparison_${summary.env1_name}_vs_${summary.env2_name}_${ts}.xlsx`)
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
                  <p className="text-sm font-semibold text-error mb-1">Comparison Failed</p>
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
