import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Search, AlertCircle, CheckCircle2, RefreshCw, X,
  Users, Database, Layers, BarChart2, Info,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
} from 'recharts'
import PageHeader from '../components/layout/PageHeader'
import FileUpload from '../components/common/FileUpload'
import StepIndicator from '../components/common/StepIndicator'
import LoadingOverlay from '../components/common/LoadingOverlay'
import DownloadButton from '../components/common/DownloadButton'
import ConfirmDialog from '../components/common/ConfirmDialog'
import Badge from '../components/common/Badge'
import { uploadFiles, runAnalysis, getStatus, downloadResults, cancelJob } from '../api/oracleComparator'
import HelpAccordion, { HelpStep, HelpPill, TemplateDownloads } from '../components/common/HelpAccordion'
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
    description: 'Compare duty roles, inherited role assignments, and privilege-to-role mappings between two Oracle environments.',
    accentColor: '#22C55E',
    iconBg: 'bg-green-50',
    iconColor: 'text-[#22C55E]',
    meta: '2 RBAC files',
    recommended: false,
  },
  {
    id: 'dsp' as AnalysisType,
    icon: Database,
    title: 'DSP Analysis',
    description: 'Compare data security policies, condition statements, and column-level access controls across environments.',
    accentColor: '#3B82F6',
    iconBg: 'bg-blue-50',
    iconColor: 'text-[#3B82F6]',
    meta: '2 DSP files',
    recommended: false,
  },
  {
    id: 'both' as AnalysisType,
    icon: Layers,
    title: 'Complete Analysis',
    description: 'Full bi-directional comparison covering both RBAC and DSP. Requires two pairs of files plus environment names.',
    accentColor: '#EAB308',
    iconBg: 'bg-yellow-50',
    iconColor: 'text-[#EAB308]',
    meta: '4 files total',
    recommended: true,
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
  const [activeTab, setActiveTab] = useState('all')

  const needsRbac = analysisType === 'rbac' || analysisType === 'both'
  const needsDsp  = analysisType === 'dsp'  || analysisType === 'both'

  const canRun =
    env1Name.trim() !== '' &&
    env2Name.trim() !== '' &&
    env1Name.trim() !== env2Name.trim() &&
    (!needsRbac || (rbacFile1 !== null && rbacFile2 !== null)) &&
    (!needsDsp  || (dspFile1  !== null && dspFile2  !== null))

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
    setSummary(null)
    setErrors([])
    setUploadError('')
    setConfirmReset(false)
    setActiveTab('all')
  }, [jobId])

  const dir1Label = summary ? `${summary.env1_name} → ${summary.env2_name}` : ''
  const dir2Label = summary ? `${summary.env2_name} → ${summary.env1_name}` : ''

  const availableCompTypes = useMemo(() => {
    if (!summary) return []
    return Array.from(new Set(summary.comparisons.map(c => c.comp_type)))
  }, [summary])

  const tabs = useMemo(() => [
    { id: 'all', label: 'All' },
    ...availableCompTypes.map(t => ({ id: t, label: COMP_TYPE_LABELS[t] ?? t })),
  ], [availableCompTypes])

  const tableRows = useMemo<ComparisonTypeSummary[]>(() => {
    if (!summary) return []
    return activeTab === 'all'
      ? summary.comparisons
      : summary.comparisons.filter(c => c.comp_type === activeTab)
  }, [summary, activeTab])

  const chartData = useMemo(() => {
    if (!summary) return []
    return availableCompTypes.map(ct => {
      const d1 = summary.comparisons.find(c => c.comp_type === ct && c.direction === dir1Label)
      const d2 = summary.comparisons.find(c => c.comp_type === ct && c.direction === dir2Label)
      return {
        name: COMP_TYPE_LABELS[ct] ?? ct,
        forward: d1?.match_rate ?? 0,
        reverse: d2?.match_rate ?? 0,
      }
    })
  }, [summary, availableCompTypes, dir1Label, dir2Label])

  return (
    <div>
      <PageHeader
        icon={<Search size={24} />}
        title="Oracle Comparator"
        subtitle="Compare duty roles, privileges, and DSP across two Oracle environments"
      />

      <div style={{ marginBottom: 20 }}>
        <HelpAccordion title="How to Use This Tool" icon={<Info size={14} color="#2563EB" />} accentColor="#2563EB">
          <HelpStep num={1} text="Choose your analysis type. RBAC Analysis compares duty roles, inherited role assignments, and privilege-to-role mappings. DSP Analysis compares data security policies and column-level grants. Complete Analysis covers both and is recommended for production-to-UAT sign-off." />
          <HelpStep num={2} text="Enter a short label for each environment (e.g. 'Production', 'UAT') — these labels appear in the output to distinguish which side each row belongs to." />
          <HelpStep num={3} text="Export the required files from Oracle Fusion. For RBAC: Security Console → Roles → Export. For DSP: Security Console → Data Security Policies → Export. Upload each file to its corresponding zone." />
          <HelpStep num={4} text="Click Run Comparison. The output lists objects unique to each environment and those present in both. Export before closing." />
        </HelpAccordion>
        <HelpAccordion title="How the Tool Works" icon={<Layers size={14} color="#0F1E3D" />} accentColor="#0F1E3D">
          <p style={{ fontSize: 13, color: '#64748B', lineHeight: 1.7, marginBottom: 12 }}>The comparator performs a bi-directional set difference between the two environment exports:</p>
          <HelpPill label="RBAC comparison" note="Computes (Env1 − Env2), (Env2 − Env1), and the intersection across duty roles, inherited role links, and privilege-to-role mappings." />
          <HelpPill label="DSP comparison" note="Applies the same set logic to data security policies: object name, condition statement, and column-level access grants compared independently." />
          <HelpPill label="Key matching" note="Rows are matched on a composite key of ROLE NAME + ENTITLEMENT (RBAC) or ROLE NAME + OBJECT NAME (DSP). Whitespace and case are normalised before matching." />
          <p style={{ fontSize: 12.5, color: '#94A3B8', marginTop: 10, lineHeight: 1.6 }}>Particularly useful for post-migration checks — anything in Env1 but absent from Env2 is a potential missed configuration.</p>
        </HelpAccordion>
        <TemplateDownloads templates={[['RBAC Export Template', 'CSV'], ['DSP Export Template', 'CSV']]} />
      </div>

      <StepIndicator steps={STEPS} currentStep={STEP_INDEX[step]} />

      <div className="relative">

          {/* ── Step 0: Analysis Type ──────────────────────────────────── */}
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
                  className="ml-auto text-[#3B82F6] hover:underline text-[12px]"
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
                      className="h-full rounded-full transition-[width] duration-300 ease-out"
                      style={{ width: `${uploadProgress}%`, background: '#22C55E' }}
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
              />
            </div>
          )}

          {/* ── Results ───────────────────────────────────────────────── */}
          {step === 'results' && summary && (
            <div className="slide-in space-y-5">
              {/* Environment header */}
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

              {/* Grouped BarChart — match rates per direction per comp type */}
              {chartData.length > 0 && (
                <div className="card">
                  <div className="flex items-center gap-2 mb-4">
                    <BarChart2 size={16} className="text-gray-400" />
                    <span className="text-card-title">Match Rate Comparison</span>
                    <span className="ml-auto text-body-sm text-gray-400">% of items matched per direction</span>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={chartData}
                      barSize={20}
                      barGap={4}
                      barCategoryGap="35%"
                      margin={{ top: 4, right: 8, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E4E4E7" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 12, fill: '#71717A' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fontSize: 11, fill: '#A1A1AA' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={v => `${v}%`}
                      />
                      <RechartsTooltip
                        contentStyle={{ background: '#fff', border: '1px solid #E4E4E7', borderRadius: 6, fontSize: 13 }}
                        formatter={(v: number) => [`${v}%`]}
                        cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                      />
                      <Legend
                        iconType="circle"
                        iconSize={8}
                        formatter={value => <span style={{ fontSize: 12, color: '#71717A' }}>{value}</span>}
                      />
                      <Bar dataKey="forward" name={`${summary.env1_name} →`} fill="#3B82F6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="reverse" name={`← ${summary.env2_name}`} fill="#22C55E" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Tabbed detail table */}
              <div>
                {availableCompTypes.length > 1 && (
                  <div className="border-b border-gray-200 mb-0">
                    <nav className="-mb-px flex gap-0">
                      {tabs.map(({ id, label }) => (
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
                        </button>
                      ))}
                    </nav>
                  </div>
                )}

                <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                          Direction
                        </th>
                        {activeTab === 'all' && (
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                            Type
                          </th>
                        )}
                        <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                          Total
                        </th>
                        <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                          Matches
                        </th>
                        <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                          Missing
                        </th>
                        <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                          Match Rate
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((row, i) => (
                        <tr
                          key={`${row.comp_type}-${row.direction}`}
                          className={clsx(
                            'border-b border-gray-100 last:border-0',
                            i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60',
                          )}
                        >
                          <td className="px-4 py-3 text-[13px] font-medium text-gray-700 whitespace-nowrap">
                            {row.direction}
                          </td>
                          {activeTab === 'all' && (
                            <td className="px-4 py-3 text-[13px] text-gray-500">
                              {COMP_TYPE_LABELS[row.comp_type] ?? row.comp_type}
                            </td>
                          )}
                          <td className="px-4 py-3 text-[13px] text-gray-700 text-right font-mono tabular-nums">
                            {row.total.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-[13px] text-right font-mono tabular-nums text-[#22C55E]">
                            {row.matches.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-[13px] text-right font-mono tabular-nums">
                            <span className={row.missing > 0 ? 'text-[#EF4444]' : 'text-gray-400'}>
                              {row.missing.toLocaleString()}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={clsx(
                              'text-[11px] font-semibold px-2 py-0.5 rounded-full',
                              row.match_rate >= 90
                                ? 'bg-[rgba(34,197,94,0.1)] text-[#22C55E]'
                                : row.match_rate >= 60
                                  ? 'bg-[rgba(234,179,8,0.1)] text-[#EAB308]'
                                  : 'bg-[rgba(239,68,68,0.1)] text-[#EF4444]',
                            )}>
                              {row.match_rate}%
                            </span>
                          </td>
                        </tr>
                      ))}
                      {tableRows.length === 0 && (
                        <tr>
                          <td
                            colSpan={activeTab === 'all' ? 6 : 5}
                            className="px-4 py-10 text-center text-sm text-gray-400"
                          >
                            No comparison data
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

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
