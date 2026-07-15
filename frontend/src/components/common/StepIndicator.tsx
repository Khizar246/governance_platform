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
                className={clsx(
                  'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ease-[ease]',
                  isComplete
                    ? 'bg-[#16A34A] border-none'
                    : isActive
                      ? 'bg-[#0F1E3D] border-2 border-solid border-[#0F1E3D]'
                      : 'bg-[#F0EFE9] border-[1.5px] border-solid border-[#E2E8F0]',
                )}
              >
                {isComplete ? (
                  <Check size={14} strokeWidth={2.5} className="text-white" />
                ) : (
                  <span className={clsx(
                    'text-[12px] font-semibold',
                    isActive ? 'text-white' : 'text-[#94A3B8]',
                  )}>
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
                className={clsx(
                  'flex-1 mb-5 mx-2.5 transition-colors duration-200 h-[1.5px]',
                  isComplete ? 'bg-[#16A34A]' : 'bg-[#E2E8F0]',
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
