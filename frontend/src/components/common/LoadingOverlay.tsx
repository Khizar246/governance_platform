import { Check } from 'lucide-react'
import { clsx } from 'clsx'

export interface ProgressStep {
  step: number
  label: string
  phase: 1 | 2 | 3 | 4
}

interface LoadingOverlayProps {
  message: string
  progress: number
  currentStep: number
  steps: ProgressStep[]
  withFp: boolean
}

const PHASE_LABELS: Record<number, string> = {
  1: 'Import & Validate',
  2: 'Core Analysis',
  3: 'FP Analysis',
  4: 'Export',
}

export default function LoadingOverlay({ message, progress, currentStep, steps, withFp }: LoadingOverlayProps) {
  const pct = Math.min(100, Math.round(progress))

  // Step ids are backend milestone ids and may have gaps when the run's options
  // exclude some steps (e.g. 16 of 22 for a run without FP/observation). Number
  // the display by position in the visible list, not by raw id.
  const stepOrdinals = new Map(steps.map((s, i) => [s.step, i + 1]))
  const currentOrdinal = steps.filter(s => s.step <= currentStep).length

  // Derive phase state
  const stepsByPhase: Record<number, ProgressStep[]> = { 1: [], 2: [], 3: [], 4: [] }
  for (const s of steps) stepsByPhase[s.phase].push(s)

  const activePhase = (() => {
    const active = steps.find(s => s.step === currentStep)
    return active?.phase ?? (currentStep === 0 ? 1 : 4)
  })()

  function phaseStatus(phase: number): 'done' | 'active' | 'pending' | 'disabled' {
    if (phase === 3 && !withFp) return 'disabled'
    const phaseSteps = stepsByPhase[phase]
    if (!phaseSteps.length) return 'disabled'
    const maxStep = Math.max(...phaseSteps.map(s => s.step))
    const minStep = Math.min(...phaseSteps.map(s => s.step))
    if (currentStep > maxStep) return 'done'
    if (currentStep >= minStep) return 'active'
    return 'pending'
  }

  function stepStatus(step: number): 'done' | 'active' | 'pending' {
    if (currentStep > step) return 'done'
    if (currentStep === step) return 'active'
    return 'pending'
  }

  // Show active phase steps + a peek at the next phase header
  const activeSteps = stepsByPhase[activePhase] ?? []

  return (
    <div className="flex items-center justify-center min-h-[320px] p-6">
      <div className="w-full max-w-xl bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {/* EY gold accent rail */}
        <div className="h-1 bg-gold-bright" />

        <div className="p-6 flex flex-col gap-5">

          {/* Header */}
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <h3 className="font-serif text-[15px] font-semibold leading-tight text-navy truncate">{message}</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {currentStep > 0 ? `Step ${currentOrdinal} of ${steps.length}` : 'Starting…'}
              </p>
            </div>
            <span className="font-serif text-3xl font-semibold text-navy tabular-nums leading-none shrink-0">
              {pct}<span className="text-xl">%</span>
            </span>
          </div>

          {/* Progress bar */}
          <div className="relative w-full h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gold-bright transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full animate-pulse pointer-events-none"
              style={{
                width: `${pct}%`,
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)',
              }}
            />
          </div>

          {/* Phase strip */}
          <div className="flex rounded-lg overflow-hidden border border-gray-200">
            {([1, 2, 3, 4] as const).map((phase) => {
              const status = phaseStatus(phase)
              return (
                <div
                  key={phase}
                  className={clsx(
                    'flex-1 flex flex-col items-center justify-center py-2 px-1 text-center border-r border-gray-200 last:border-r-0 transition-colors',
                    status === 'done'     && 'bg-green-50',
                    status === 'active'   && 'bg-navy',
                    status === 'pending'  && 'bg-gray-50',
                    status === 'disabled' && 'bg-gray-50 opacity-45',
                  )}
                >
                  <span className={clsx(
                    'text-[10px] font-semibold mb-0.5',
                    status === 'done'    && 'text-green-600',
                    status === 'active'  && 'text-gold-bright',
                    status === 'pending' || status === 'disabled' ? 'text-gray-400' : '',
                  )}>
                    {status === 'done' ? '✓' : `Phase ${phase}`}
                  </span>
                  <span className={clsx(
                    'text-[11px] font-medium leading-tight',
                    status === 'done'    && 'text-green-700',
                    status === 'active'  && 'text-white',
                    status === 'pending' || status === 'disabled' ? 'text-gray-400' : '',
                  )}>
                    {phase === 3 && !withFp ? 'FP disabled' : PHASE_LABELS[phase]}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Step list for active phase */}
          {activeSteps.length > 0 && (
            <div className="flex flex-col">
              {/* Phase header */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[.07em]">
                  Phase {activePhase} — {PHASE_LABELS[activePhase]}
                </span>
                <span className="flex-1 h-px bg-gray-100" />
              </div>

              {/* Steps */}
              <div className="flex flex-col gap-0">
                {activeSteps.map(s => {
                  const status = stepStatus(s.step)
                  return (
                    <div key={s.step} className={clsx(
                      'flex items-start gap-3 py-2 border-b border-gray-50 last:border-b-0',
                    )}>
                      {/* Number badge */}
                      <div className={clsx(
                        'w-[22px] h-[22px] rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold mt-px',
                        status === 'done'    && 'bg-green-500 text-white',
                        status === 'active'  && 'bg-gold-bright text-navy',
                        status === 'pending' && 'bg-gray-100 text-gray-400',
                      )}>
                        {status === 'done'
                          ? <Check size={11} strokeWidth={3} />
                          : stepOrdinals.get(s.step)
                        }
                      </div>

                      {/* Label */}
                      <span className={clsx(
                        'text-[13px] leading-snug pt-px',
                        status === 'done'    && 'text-gray-400 line-through decoration-gray-300',
                        status === 'active'  && 'text-navy font-semibold',
                        status === 'pending' && 'text-gray-300',
                      )}>
                        {s.label}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Next phase hint */}
              {activePhase < 4 && (() => {
                const nextPhase = activePhase === 2 && !withFp ? 4 : activePhase + 1
                if (nextPhase > 4) return null
                const nextStatus = phaseStatus(nextPhase)
                if (nextStatus === 'disabled') {
                  const afterPhase = nextPhase + 1
                  if (afterPhase > 4) return null
                  return (
                    <div className="flex items-center gap-2 mt-3">
                      <span className="text-[10px] text-gray-300 uppercase tracking-[.07em]">
                        Next: Phase {afterPhase} — {PHASE_LABELS[afterPhase]}
                      </span>
                      <span className="flex-1 h-px bg-gray-100" />
                    </div>
                  )
                }
                return (
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-[10px] text-gray-300 uppercase tracking-[.07em]">
                      Next: Phase {nextPhase} — {PHASE_LABELS[nextPhase]}
                    </span>
                    <span className="flex-1 h-px bg-gray-100" />
                  </div>
                )
              })()}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
