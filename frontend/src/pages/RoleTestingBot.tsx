import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { Info, Lock, Camera, AlertTriangle, ImageOff, RotateCcw, X } from 'lucide-react'

import PageHeader from '../components/layout/PageHeader'
import StepIndicator from '../components/common/StepIndicator'
import DownloadButton from '../components/common/DownloadButton'
import ConfirmDialog from '../components/common/ConfirmDialog'
import HelpAccordion, { HelpStep } from '../components/common/HelpAccordion'
import { POLL_INTERVAL_MS } from '../utils/constants'
import useScrollToTopOnChange from '../utils/useScrollToTopOnChange'
import {
  runBot, getStatus, getResults, imageUrl, downloadZip, cancelJob,
} from '../api/roleTesting'
import type { RoleTestingSummary, CapturedScreenshot } from '../types'

type Step = 'config' | 'running' | 'results' | 'error'
const STEPS = ['Configure', 'Processing', 'Results']
const STEP_INDEX: Record<Step, number> = { config: 0, running: 1, results: 2, error: 1 }

const STATUS_STYLE: Record<string, { cls: string; label: string }> = {
  captured:         { cls: 'bg-green-100 text-green-600', label: 'Captured' },
  captured_no_task: { cls: 'bg-amber-100 text-amber-700', label: 'No task panel' },
}

export default function RoleTestingBot() {
  const [step, setStep] = useState<Step>('config')
  useScrollToTopOnChange(step)

  // Configure
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [maxElements, setMaxElements] = useState('')
  const [timeoutMin, setTimeoutMin] = useState('')
  const [headless, setHeadless] = useState(true)
  const [captureTasks, setCaptureTasks] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Job
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')

  // Results
  const [summary, setSummary] = useState<RoleTestingSummary | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  const [isStarting, setIsStarting] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  const canStart =
    url.trim() !== '' && username.trim() !== '' && password !== '' && !isStarting

  // ── Poll /status while running ──
  useEffect(() => {
    if (step !== 'running' || !jobId) return
    // Ignore responses that resolve after the user cancels (which changes `step`
    // and runs this cleanup) — otherwise a late completion would flip the page to
    // results for a job that was just deleted.
    let cancelled = false
    const interval = setInterval(async () => {
      try {
        const s = await getStatus(jobId)
        if (cancelled) return
        setProgress(s.progress)
        setProgressMessage(s.progress_message)
        if (s.status === 'complete') {
          clearInterval(interval)
          try {
            const res = await getResults(jobId)
            if (cancelled) return
            setSummary(res)
            setStep('results')
            toast.success('Screenshots captured.')
          } catch {
            if (cancelled) return
            setErrors(['Run completed but results could not be loaded.'])
            setStep('error')
          }
        } else if (s.status === 'failed') {
          clearInterval(interval)
          setErrors(s.errors.length ? s.errors : ['The bot run failed.'])
          setStep('error')
          toast.error(s.errors[0] || 'The bot run failed.')
        }
      } catch (e) {
        if (cancelled) return
        if ((e as { response?: { status?: number } })?.response?.status === 404) {
          // Job TTL-purged or backend restarted — polling can never recover.
          clearInterval(interval)
          toast.error('Session expired — please start a new run.')
          handleReset()
        }
        /* otherwise transient — keep polling */
      }
    }, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [step, jobId])

  const handleStart = useCallback(async () => {
    if (!canStart) return
    // Guard against double-clicks: a second POST would spawn a second
    // server-side Chrome job and orphan the first one.
    setIsStarting(true)
    try {
      const maxEl = maxElements.trim() ? parseInt(maxElements, 10) : null
      const timeoutSec = timeoutMin.trim() ? Math.round(parseFloat(timeoutMin) * 60) : null
      const res = await runBot({
        url: url.trim(),
        username: username.trim(),
        password,
        max_elements: Number.isFinite(maxEl as number) ? maxEl : null,
        overall_timeout_seconds: Number.isFinite(timeoutSec as number) ? timeoutSec : null,
        headless,
        capture_tasks: captureTasks,
      })
      setJobId(res.job_id)
      setPassword('')  // drop the password from memory once it's been submitted
      setProgress(0)
      setProgressMessage('Launching browser…')
      setStep('running')
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(msg || 'Could not start the bot.')
    } finally {
      setIsStarting(false)
    }
  }, [canStart, url, username, password, maxElements, timeoutMin, headless, captureTasks])

  const handleReset = useCallback(async () => {
    if (jobId) { try { await cancelJob(jobId) } catch { /* ignore */ } }
    setJobId(null)
    setSummary(null)
    setErrors([])
    setProgress(0)
    setProgressMessage('')
    setStep('config')
  }, [jobId])

  const handleDownload = useCallback(async () => {
    if (!jobId) return
    await downloadZip(jobId, 'role_testing_screenshots.zip')
  }, [jobId])

  return (
    <div>
      <PageHeader
        icon={<Camera size={22} />}
        title="Role Testing Bot"
        subtitle="Drive Oracle Fusion Cloud and capture a screenshot of every Navigator work area."
      />

      <HelpAccordion title="How to Use This Tool" icon={<Info size={14} className="text-blue-600" />}>
        <HelpStep num={1} text="Type in the Oracle Cloud web address, your username, and your password." />
        <HelpStep num={2} text="Click Start. The tool opens a browser in the background, signs in for you, and visits every work area in the Navigator menu one by one." />
        <HelpStep num={3} text="For each work area, it takes a screenshot and opens the Tasks panel if there is one, so you can see what actions are available." />
        <HelpStep num={4} text="When it's done, review the screenshots on the results page and download them all as one ZIP file." />
        <div className="flex items-start gap-2 mt-2 px-3 py-[9px] rounded-[7px] bg-blue-50 border border-blue-200">
          <Lock size={13} className="text-blue-700 mt-0.5 shrink-0" />
          <span className="text-[12.5px] text-blue-700 leading-[1.5]">
            Your username and password are used only for this one run. They are never stored, logged, or saved anywhere.
          </span>
        </div>
      </HelpAccordion>

      <div className="h-2" />
      <StepIndicator steps={STEPS} currentStep={STEP_INDEX[step]} />

      {step === 'config' && (
        <ConfigCard
          url={url} setUrl={setUrl}
          username={username} setUsername={setUsername}
          password={password} setPassword={setPassword}
          maxElements={maxElements} setMaxElements={setMaxElements}
          timeoutMin={timeoutMin} setTimeoutMin={setTimeoutMin}
          headless={headless} setHeadless={setHeadless}
          captureTasks={captureTasks} setCaptureTasks={setCaptureTasks}
          showAdvanced={showAdvanced} setShowAdvanced={setShowAdvanced}
          canStart={canStart}
          onStart={handleStart}
        />
      )}

      {step === 'running' && (
        <RunningCard progress={progress} message={progressMessage} onCancel={() => setConfirmCancel(true)} />
      )}

      {step === 'results' && summary && (
        <Gallery
          summary={summary}
          jobId={jobId!}
          onDownload={handleDownload}
          onReset={handleReset}
        />
      )}

      {step === 'error' && (
        <ErrorCard errors={errors} onRetry={handleReset} />
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel Run?"
        message="This will stop the running bot and permanently delete the screenshots captured so far. This cannot be undone."
        confirmLabel="Yes, Cancel"
        cancelLabel="Keep Running"
        destructive
        onConfirm={() => { setConfirmCancel(false); handleReset() }}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  )
}

// ── Configure ──────────────────────────────────────────────────────────────

interface ConfigProps {
  url: string; setUrl: (v: string) => void
  username: string; setUsername: (v: string) => void
  password: string; setPassword: (v: string) => void
  maxElements: string; setMaxElements: (v: string) => void
  timeoutMin: string; setTimeoutMin: (v: string) => void
  headless: boolean; setHeadless: (v: boolean) => void
  captureTasks: boolean; setCaptureTasks: (v: boolean) => void
  showAdvanced: boolean; setShowAdvanced: (v: boolean) => void
  canStart: boolean
  onStart: () => void
}

function ConfigCard(p: ConfigProps) {
  const field = 'w-full px-3 py-[9px] rounded-md border border-slate-200 text-[13px] text-navy bg-white outline-none'
  const labelClass = 'block text-[12px] font-semibold text-slate-700 mb-[5px]'

  return (
    <div className="flex justify-center">
    <div className="bg-white border border-slate-200 rounded-lg p-6 w-full max-w-[560px] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="flex flex-col gap-4">
        <div>
          <label className={labelClass}>Oracle Cloud URL</label>
          <input className={field} placeholder="https://your-instance.oraclecloud.com" value={p.url}
            onChange={e => p.setUrl(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Username</label>
          <input className={field} autoComplete="off" value={p.username}
            onChange={e => p.setUsername(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Password</label>
          <input className={field} type="password" autoComplete="new-password" value={p.password}
            onChange={e => p.setPassword(e.target.value)} />
        </div>

        <button
          onClick={() => p.setShowAdvanced(!p.showAdvanced)}
          className="self-start bg-transparent border-none p-0 cursor-pointer text-[12px] font-semibold text-blue-500"
        >
          {p.showAdvanced ? '− Hide' : '+ Show'} advanced options
        </button>

        {p.showAdvanced && (
          <div className="flex flex-col gap-3.5">
            <div className="flex gap-3.5">
              <div className="flex-1">
                <label className={labelClass}>Max work areas</label>
                <input className={field} type="number" min={1} placeholder="all" value={p.maxElements}
                  onChange={e => p.setMaxElements(e.target.value)} />
              </div>
              <div className="flex-1">
                <label className={labelClass}>Timeout (minutes)</label>
                <input className={field} type="number" min={1} placeholder="none" value={p.timeoutMin}
                  onChange={e => p.setTimeoutMin(e.target.value)} />
              </div>
            </div>
            <label className="flex items-start gap-[9px] cursor-pointer">
              <input type="checkbox" checked={!p.headless}
                onChange={e => p.setHeadless(!e.target.checked)} className="mt-0.5" />
              <span className="text-[12.5px] text-slate-700 leading-[1.45]">
                Show the browser window (run non-headless)
                <span className="block text-[11px] text-slate-400">
                  For local review only. Leave off for normal/deployed runs.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-[9px] cursor-pointer">
              <input type="checkbox" checked={p.captureTasks}
                onChange={e => p.setCaptureTasks(e.target.checked)} className="mt-0.5" />
              <span className="text-[12.5px] text-slate-700 leading-[1.45]">
                Capture inside each task
                <span className="block text-[11px] text-slate-400">
                  Drills into every task of every work area. Much slower.
                </span>
              </span>
            </label>
          </div>
        )}

        <button
          onClick={p.onStart}
          disabled={!p.canStart}
          className={
            'mt-1 self-start px-[22px] py-2.5 rounded-md border-none text-[13px] font-semibold ' +
            (p.canStart
              ? 'cursor-pointer bg-navy text-ey-yellow'
              : 'cursor-not-allowed bg-slate-200 text-slate-400')
          }
        >
          Start Bot →
        </button>
      </div>
    </div>
    </div>
  )
}

// ── Running ────────────────────────────────────────────────────────────────

function RunningCard({ progress, message, onCancel }: {
  progress: number
  message: string
  onCancel: () => void
}) {
  const pct = Math.min(100, Math.round(progress))
  return (
    <div className="flex flex-col items-center py-6">
      <div className="w-full max-w-[520px] bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="h-1 bg-blue-500" />
        <div className="p-6 flex flex-col gap-4">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-serif text-[15px] font-semibold text-navy">
                {message || 'Working…'}
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                The bot is driving Oracle Cloud. A full run can take several minutes.
              </p>
            </div>
            <span className="font-serif text-[28px] font-semibold text-navy leading-none">
              {pct}<span className="text-[18px]">%</span>
            </span>
          </div>
          <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full w-[var(--w)] bg-blue-500 rounded-full transition-[width] duration-300"
              style={{ '--w': `${pct}%` } as React.CSSProperties}
            />
          </div>
        </div>
      </div>
      <div className="flex justify-center mt-2">
        <button
          className="inline-flex items-center gap-1.5 font-medium text-sm px-4 py-2 rounded border border-error/40 text-error bg-transparent transition-all duration-150 hover:bg-error-bg"
          onClick={onCancel}
        >
          <X size={14} /> Cancel Run
        </button>
      </div>
    </div>
  )
}

// ── Results gallery ──────────────────────────────────────────────────────────

function Gallery({ summary, jobId, onDownload, onReset }: {
  summary: RoleTestingSummary
  jobId: string
  onDownload: () => Promise<void>
  onReset: () => void
}) {
  const stats = useMemo(() => ([
    { label: 'Captured', value: summary.captured, colorCls: 'text-green-600' },
    { label: 'Failed', value: summary.failed, colorCls: 'text-red-600' },
    { label: 'Skipped', value: summary.skipped, colorCls: 'text-slate-600' },
  ]), [summary])

  // Gallery shows only real screenshots — skipped/errored items have no image.
  const shots = useMemo(
    () => summary.screenshots.filter(
      s => s.filename && (s.status === 'captured' || s.status === 'captured_no_task'),
    ),
    [summary],
  )

  const [lightbox, setLightbox] = useState<CapturedScreenshot | null>(null)
  const warnings = summary.warnings ?? []

  return (
    <div>
      {warnings.length > 0 && (
        <div className="flex items-start gap-2.5 mb-[14px] px-4 py-3 rounded-lg bg-amber-50 border border-amber-300">
          <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
          <div>
            <span className="block text-[13px] font-semibold text-amber-800">
              Run incomplete — not every work area was tested
            </span>
            {warnings.map((w, i) => (
              <span key={i} className="block text-[12.5px] text-amber-700 leading-[1.5] mt-0.5">{w}</span>
            ))}
          </div>
        </div>
      )}

      {/* Stat strip + actions */}
      <div className="flex items-center gap-3 mb-[18px] flex-wrap">
        {stats.map(s => (
          <div key={s.label} className="flex items-baseline gap-[7px] px-[14px] py-2 bg-white border border-slate-200 rounded-[9px]">
            <span className={`font-serif text-[20px] font-semibold ${s.colorCls}`}>{s.value}</span>
            <span className="text-[12px] text-slate-500">{s.label}</span>
          </div>
        ))}
        <div className="ml-auto flex gap-2.5">
          <DownloadButton onClick={onDownload} label="Download All (.zip)" />
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1.5 px-4 py-[9px] rounded border border-slate-200 bg-white text-slate-700 text-[13px] font-semibold cursor-pointer"
          >
            <RotateCcw size={14} /> New Run
          </button>
        </div>
      </div>

      {shots.length === 0 ? (
        <EmptyGallery onReset={onReset} />
      ) : (
        <div className="grid [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {shots.map(shot => (
            <ShotCard key={shot.index} shot={shot} jobId={jobId} onOpen={() => setLightbox(shot)} />
          ))}
        </div>
      )}

      {lightbox && (
        <Lightbox shot={lightbox} jobId={jobId} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}

function ShotCard({ shot, jobId, onOpen }: { shot: CapturedScreenshot; jobId: string; onOpen: () => void }) {
  const st = STATUS_STYLE[shot.status]
  return (
    <div
      onClick={onOpen}
      className="bg-white border border-slate-200 rounded-[10px] overflow-hidden flex flex-col cursor-zoom-in"
    >
      <div className="aspect-[16/10] bg-slate-100 flex items-center justify-center overflow-hidden">
        <img
          src={imageUrl(jobId, shot.filename!)}
          alt={shot.title}
          loading="lazy"
          className="w-full h-full object-cover object-top"
        />
      </div>
      <div className="px-3 py-2.5 flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-navy leading-[1.35] truncate" title={shot.title}>
          {shot.index}. {shot.title}
        </span>
        <span className={`self-start text-[10.5px] font-semibold px-2 py-0.5 rounded-[5px] ${st.cls}`}>
          {st.label}
        </span>
      </div>
    </div>
  )
}

function Lightbox({ shot, jobId, onClose }: { shot: CapturedScreenshot; jobId: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] bg-navy/[0.82] flex flex-col items-center justify-center p-8"
    >
      <button
        onClick={onClose}
        className="absolute top-[18px] right-[22px] w-9 h-9 rounded border-none bg-[rgba(255,255,255,0.14)] text-white text-[20px] leading-none cursor-pointer"
        aria-label="Close"
      >
        ×
      </button>
      <img
        src={imageUrl(jobId, shot.filename!)}
        alt={shot.title}
        onClick={e => e.stopPropagation()}
        className="max-w-full max-h-[calc(100%-48px)] object-contain rounded shadow-[0_8px_40px_rgba(0,0,0,0.45)]"
      />
      <span className="mt-[14px] text-[13px] font-semibold text-white">
        {shot.index}. {shot.title}
      </span>
    </div>
  )
}

function EmptyGallery({ onReset }: { onReset: () => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-6 py-12 text-center">
      <ImageOff size={36} className="text-slate-400 mx-auto mb-3" />
      <h3 className="font-serif text-[16px] font-semibold text-navy mb-1.5">No screenshots captured</h3>
      <p className="text-[13px] text-slate-500 mb-4">The run finished without capturing any work areas.</p>
      <button onClick={onReset} className="px-[18px] py-[9px] rounded border-none bg-navy text-ey-yellow text-[13px] font-semibold cursor-pointer">
        Start a new run
      </button>
    </div>
  )
}

// ── Error ────────────────────────────────────────────────────────────────────

function ErrorCard({ errors, onRetry }: { errors: string[]; onRetry: () => void }) {
  return (
    <div className="bg-white border border-red-300 rounded-lg p-6 max-w-[560px]">
      <div className="flex items-center gap-2.5 mb-3">
        <AlertTriangle size={20} className="text-red-600" />
        <h3 className="font-serif text-[16px] font-semibold text-navy">The run failed</h3>
      </div>
      <ul className="m-0 mb-4 pl-[18px]">
        {errors.map((e, i) => (
          <li key={i} className="text-[13px] text-red-700 leading-[1.6]">{e}</li>
        ))}
      </ul>
      {/* Credentials (incl. the password) are dropped from memory on submit, so
          the run cannot be re-fired in place — this returns to the form. The
          label says so honestly rather than over-promising a retry. */}
      <button onClick={onRetry} className="px-[18px] py-[9px] rounded border-none bg-navy text-ey-yellow text-[13px] font-semibold cursor-pointer">
        ← Start Over
      </button>
    </div>
  )
}
