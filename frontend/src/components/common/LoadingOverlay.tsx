import { Check } from 'lucide-react'

interface Stage {
  label: string
  minPercent: number
}

interface LoadingOverlayProps {
  message: string
  progress?: number
  stages?: Stage[]
  progressMessage?: string
}

export default function LoadingOverlay({ message, progress, stages, progressMessage }: LoadingOverlayProps) {
  const pct = progress !== undefined ? Math.min(100, Math.round(progress)) : undefined

  // Determine active stage index
  let activeIdx = -1
  if (stages && pct !== undefined) {
    for (let i = 0; i < stages.length; i++) {
      if (pct >= stages[i].minPercent) {
        activeIdx = i
      } else {
        break
      }
    }
  }

  return (
    <div className="absolute inset-0 bg-white/80 z-20 flex flex-col items-center justify-center gap-5">
      <div className="w-10 h-10 border-4 border-gray-200 border-t-[#0F1E3D] rounded-full animate-spin" />

      <p className="text-body font-medium text-gray-700 max-w-sm text-center">{message}</p>

      {pct !== undefined && (
        <div className="w-72 flex flex-col gap-1.5">
          <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%`, background: '#FFD100' }}
            />
          </div>
          <span className="label-uppercase text-gray-400 text-right">{pct}%</span>

          {stages && stages.length > 0 && (
            <div className="w-72 flex flex-col gap-0.5 mt-3">
              {stages.map((stage, idx) => {
                const isComplete = idx < activeIdx
                const isActive = idx === activeIdx
                const isPending = idx > activeIdx

                return (
                  <div key={idx} className="flex items-start gap-2 py-0.5">
                    <div className="w-4 shrink-0 flex items-center justify-center mt-0.5">
                      {isComplete && <Check size={12} className="text-green-600" strokeWidth={3} />}
                      {isActive && <div className="w-2 h-2 rounded-full bg-[#FFD100] animate-pulse" />}
                      {isPending && <div className="w-2 h-2 rounded-full bg-gray-300" />}
                    </div>
                    <div className="flex flex-col">
                      <span
                        className={`text-[12px] leading-snug ${
                          isComplete ? 'text-gray-500' : isActive ? 'font-medium text-gray-800' : 'text-gray-400'
                        }`}
                      >
                        {stage.label}
                      </span>
                      {isActive && progressMessage && (
                        <span className="text-[11px] text-gray-400 leading-snug mt-0.5 max-w-[240px] truncate">
                          {progressMessage}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
