import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { Camera, AlertTriangle, ImageOff, RotateCcw } from 'lucide-react'

import PageHeader from '../components/layout/PageHeader'
import StepIndicator from '../components/common/StepIndicator'
import DownloadButton from '../components/common/DownloadButton'
import { POLL_INTERVAL_MS } from '../utils/constants'
import useScrollToTopOnChange from '../utils/useScrollToTopOnChange'
import {
  runBot, getStatus, getResults, imageUrl, downloadZip, cancelJob,
} from '../api/roleTesting'
import type { RoleTestingSummary, CapturedScreenshot } from '../types'

type Step = 'config' | 'running' | 'results' | 'error'
const STEPS = ['Configure', 'Processing', 'Results']
const STEP_INDEX: Record<Step, number> = { config: 0, running: 1, results: 2, error: 1 }

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  captured:         { bg: '#DCFCE7', color: '#16A34A', label: 'Captured' },
  captured_no_task: { bg: '#FEF3C7', color: '#B45309', label: 'No task panel' },
  skipped:          { bg: '#E2E8F0', color: '#475569', label: 'Skipped' },
  error:            { bg: '#FEE2E2', color: '#DC2626', label: 'Error' },
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

  const canStart = url.trim() !== '' && username.trim() !== '' && password !== ''

  // ── Poll /status while running ──
  useEffect(() => {
    if (step !== 'running' || !jobId) return
    const interval = setInterval(async () => {
      try {
        const s = await getStatus(jobId)
        setProgress(s.progress)
        setProgressMessage(s.progress_message)
        if (s.status === 'complete') {
          clearInterval(interval)
          try {
            const res = await getResults(jobId)
            setSummary(res)
            setStep('results')
            toast.success('Screenshots captured.')
          } catch {
            setErrors(['Run completed but results could not be loaded.'])
            setStep('error')
          }
        } else if (s.status === 'failed') {
          clearInterval(interval)
          setErrors(s.errors.length ? s.errors : ['The bot run failed.'])
          setStep('error')
          toast.error(s.errors[0] || 'The bot run failed.')
        }
      } catch {
        /* transient — keep polling */
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [step, jobId])

  const handleStart = useCallback(async () => {
    if (!canStart) return
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
        <RunningCard progress={progress} message={progressMessage} />
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
  const field: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 8,
    border: '1px solid #E2E8F0', fontSize: 13, color: '#0F1E3D',
    background: '#FFFFFF', outline: 'none',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 5,
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
    <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, padding: 24, width: '100%', maxWidth: 560, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelStyle}>Oracle Cloud URL</label>
          <input style={field} placeholder="https://your-instance.oraclecloud.com" value={p.url}
            onChange={e => p.setUrl(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Username</label>
          <input style={field} autoComplete="off" value={p.username}
            onChange={e => p.setUsername(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Password</label>
          <input style={field} type="password" autoComplete="new-password" value={p.password}
            onChange={e => p.setPassword(e.target.value)} />
        </div>

        <button
          onClick={() => p.setShowAdvanced(!p.showAdvanced)}
          style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#0EA5E9' }}
        >
          {p.showAdvanced ? '− Hide' : '+ Show'} advanced options
        </button>

        {p.showAdvanced && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 14 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Max work areas</label>
                <input style={field} type="number" min={1} placeholder="all" value={p.maxElements}
                  onChange={e => p.setMaxElements(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Timeout (minutes)</label>
                <input style={field} type="number" min={1} placeholder="none" value={p.timeoutMin}
                  onChange={e => p.setTimeoutMin(e.target.value)} />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer' }}>
              <input type="checkbox" checked={!p.headless}
                onChange={e => p.setHeadless(!e.target.checked)} style={{ marginTop: 2 }} />
              <span style={{ fontSize: 12.5, color: '#334155', lineHeight: 1.45 }}>
                Show the browser window (run non-headless)
                <span style={{ display: 'block', fontSize: 11, color: '#94A3B8' }}>
                  For local review only. Leave off for normal/deployed runs.
                </span>
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer' }}>
              <input type="checkbox" checked={p.captureTasks}
                onChange={e => p.setCaptureTasks(e.target.checked)} style={{ marginTop: 2 }} />
              <span style={{ fontSize: 12.5, color: '#334155', lineHeight: 1.45 }}>
                Capture inside each task
                <span style={{ display: 'block', fontSize: 11, color: '#94A3B8' }}>
                  Drills into every task of every work area. Much slower.
                </span>
              </span>
            </label>
          </div>
        )}

        <button
          onClick={p.onStart}
          disabled={!p.canStart}
          style={{
            marginTop: 4, alignSelf: 'flex-start',
            padding: '10px 22px', borderRadius: 8, border: 'none',
            fontSize: 13, fontWeight: 600,
            cursor: p.canStart ? 'pointer' : 'not-allowed',
            background: p.canStart ? '#0F1E3D' : '#E5E7EB',
            color: p.canStart ? '#FFD100' : '#9CA3AF',
          }}
        >
          Start Bot →
        </button>
      </div>
    </div>
    </div>
  )
}

// ── Running ────────────────────────────────────────────────────────────────

function RunningCard({ progress, message }: { progress: number; message: string }) {
  const pct = Math.min(100, Math.round(progress))
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
      <div style={{ width: '100%', maxWidth: 520, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ height: 4, background: '#0EA5E9' }} />
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ fontFamily: "'Lora', serif", fontSize: 15, fontWeight: 600, color: '#0F1E3D' }}>
                {message || 'Working…'}
              </h3>
              <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                The bot is driving Oracle Cloud. A full run can take several minutes.
              </p>
            </div>
            <span style={{ fontFamily: "'Lora', serif", fontSize: 28, fontWeight: 600, color: '#0F1E3D', lineHeight: 1 }}>
              {pct}<span style={{ fontSize: 18 }}>%</span>
            </span>
          </div>
          <div style={{ position: 'relative', height: 8, background: '#E2E8F0', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: '#0EA5E9', borderRadius: 999, transition: 'width 0.3s ease' }} />
          </div>
        </div>
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
    { label: 'Captured', value: summary.captured, color: '#16A34A' },
    { label: 'Failed', value: summary.failed, color: '#DC2626' },
    { label: 'Skipped', value: summary.skipped, color: '#475569' },
  ]), [summary])

  // Gallery shows only real screenshots — skipped/errored items have no image.
  const shots = useMemo(
    () => summary.screenshots.filter(
      s => s.filename && (s.status === 'captured' || s.status === 'captured_no_task'),
    ),
    [summary],
  )

  const [lightbox, setLightbox] = useState<CapturedScreenshot | null>(null)

  return (
    <div>
      {/* Stat strip + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        {stats.map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'baseline', gap: 7, padding: '8px 14px', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 9 }}>
            <span style={{ fontFamily: "'Lora', serif", fontSize: 20, fontWeight: 600, color: s.color }}>{s.value}</span>
            <span style={{ fontSize: 12, color: '#64748B' }}>{s.label}</span>
          </div>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <DownloadButton onClick={onDownload} label="Download All (.zip)" />
          <button
            onClick={onReset}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#FFFFFF', color: '#334155', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            <RotateCcw size={14} /> New Run
          </button>
        </div>
      </div>

      {shots.length === 0 ? (
        <EmptyGallery onReset={onReset} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
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
  const st = STATUS_STYLE[shot.status] ?? STATUS_STYLE.error
  return (
    <div
      onClick={onOpen}
      style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column', cursor: 'zoom-in' }}
    >
      <div style={{ aspectRatio: '16 / 10', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <img
          src={imageUrl(jobId, shot.filename!)}
          alt={shot.title}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
        />
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#0F1E3D', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={shot.title}>
          {shot.index}. {shot.title}
        </span>
        <span style={{ alignSelf: 'flex-start', fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: st.bg, color: st.color }}>
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
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,30,61,0.82)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32 }}
    >
      <button
        onClick={onClose}
        style={{ position: 'absolute', top: 18, right: 22, width: 36, height: 36, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.14)', color: '#FFFFFF', fontSize: 20, lineHeight: 1, cursor: 'pointer' }}
        aria-label="Close"
      >
        ×
      </button>
      <img
        src={imageUrl(jobId, shot.filename!)}
        alt={shot.title}
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '100%', maxHeight: 'calc(100% - 48px)', objectFit: 'contain', borderRadius: 8, boxShadow: '0 8px 40px rgba(0,0,0,0.45)' }}
      />
      <span style={{ marginTop: 14, fontSize: 13, fontWeight: 600, color: '#FFFFFF' }}>
        {shot.index}. {shot.title}
      </span>
    </div>
  )
}

function EmptyGallery({ onReset }: { onReset: () => void }) {
  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, padding: '48px 24px', textAlign: 'center' }}>
      <ImageOff size={36} color="#94A3B8" style={{ margin: '0 auto 12px' }} />
      <h3 style={{ fontFamily: "'Lora', serif", fontSize: 16, fontWeight: 600, color: '#0F1E3D', marginBottom: 6 }}>No screenshots captured</h3>
      <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16 }}>The run finished without capturing any work areas.</p>
      <button onClick={onReset} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#0F1E3D', color: '#FFD100', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        Start a new run
      </button>
    </div>
  )
}

// ── Error ────────────────────────────────────────────────────────────────────

function ErrorCard({ errors, onRetry }: { errors: string[]; onRetry: () => void }) {
  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #FCA5A5', borderRadius: 12, padding: 24, maxWidth: 560 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <AlertTriangle size={20} color="#DC2626" />
        <h3 style={{ fontFamily: "'Lora', serif", fontSize: 16, fontWeight: 600, color: '#0F1E3D' }}>The run failed</h3>
      </div>
      <ul style={{ margin: '0 0 16px', paddingLeft: 18 }}>
        {errors.map((e, i) => (
          <li key={i} style={{ fontSize: 13, color: '#B91C1C', lineHeight: 1.6 }}>{e}</li>
        ))}
      </ul>
      <button onClick={onRetry} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#0F1E3D', color: '#FFD100', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        Try again
      </button>
    </div>
  )
}
