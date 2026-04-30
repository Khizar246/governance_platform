import { clsx } from 'clsx'

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral'

interface BadgeProps {
  text: string
  variant?: BadgeVariant
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: 'bg-success-light text-success',
  warning: 'bg-warning-light text-warning',
  error:   'bg-error-light text-error',
  info:    'bg-info-light text-info',
  neutral: 'bg-gray-100 text-gray-500',
}

/** Small semantic pill badge. */
export default function Badge({ text, variant = 'neutral' }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-sm text-badge font-medium',
        VARIANT_CLASSES[variant],
      )}
    >
      {text}
    </span>
  )
}
