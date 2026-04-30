import { Check } from 'lucide-react'
import { clsx } from 'clsx'

interface StepIndicatorProps {
  steps: string[]
  currentStep: number  // 0-indexed
}

/** Horizontal connected step indicator — completed/active/upcoming states. */
export default function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center mb-6">
      {steps.map((label, index) => {
        const isComplete = index < currentStep
        const isActive = index === currentStep
        const isLast = index === steps.length - 1

        return (
          <div key={index} className="flex items-center flex-1 min-w-0">
            {/* Circle + label */}
            <div className="flex flex-col items-center shrink-0">
              <div
                className={clsx(
                  'w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-semibold transition-colors duration-150',
                  isComplete
                    ? 'bg-success border-success text-white'
                    : isActive
                      ? 'border-ey-yellow bg-white'
                      : 'border-gray-300 bg-white text-gray-400',
                )}
              >
                {isComplete ? (
                  <Check size={14} strokeWidth={2.5} />
                ) : (
                  <span
                    className={clsx(
                      'w-2.5 h-2.5 rounded-full',
                      isActive ? 'bg-ey-yellow' : 'bg-gray-300',
                    )}
                  />
                )}
              </div>
              <span
                className={clsx(
                  'text-[11px] mt-1 font-medium whitespace-nowrap',
                  isComplete ? 'text-gray-600' : isActive ? 'text-gray-800 font-semibold' : 'text-gray-400',
                )}
              >
                {label}
              </span>
            </div>

            {/* Connecting line */}
            {!isLast && (
              <div
                className={clsx(
                  'flex-1 h-0.5 mx-2 mb-4',
                  isComplete ? 'bg-success' : 'bg-gray-200',
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
