import { Check } from 'lucide-react'
import { clsx } from 'clsx'

interface StepIndicatorProps {
  steps: string[]
  currentStep: number
}

export default function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center mb-8">
      {steps.map((label, index) => {
        const isComplete = index < currentStep
        const isActive = index === currentStep
        const isLast = index === steps.length - 1

        return (
          <div key={index} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center shrink-0">
              {/* Circle */}
              <div
                style={{
                  width: 32, height: 32,
                  borderRadius: '50%',
                  background: isComplete ? '#16A34A' : isActive ? '#0F1E3D' : '#F0EFE9',
                  border: isActive ? '2px solid #0F1E3D' : isComplete ? 'none' : '1.5px solid #E2E8F0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                }}
              >
                {isComplete ? (
                  <Check size={14} strokeWidth={2.5} style={{ color: '#FFFFFF' }} />
                ) : (
                  <span style={{
                    fontSize: 12, fontWeight: 600,
                    color: isActive ? '#FFFFFF' : '#94A3B8',
                  }}>
                    {index + 1}
                  </span>
                )}
              </div>

              {/* Label */}
              <span
                className={clsx(
                  'text-[10.5px] mt-1.5 whitespace-nowrap uppercase tracking-[0.04em]',
                  isComplete
                    ? 'text-gray-500 font-medium'
                    : isActive
                      ? 'text-gray-800 font-semibold'
                      : 'text-gray-400 font-medium',
                )}
              >
                {label}
              </span>
            </div>

            {/* Connector line */}
            {!isLast && (
              <div
                className="flex-1 mb-5 mx-2.5 transition-colors duration-200"
                style={{ height: 1.5, background: isComplete ? '#16A34A' : '#E2E8F0' }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
