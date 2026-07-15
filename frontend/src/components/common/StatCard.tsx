import type { ReactNode } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { clsx } from 'clsx'
import Badge, { type BadgeVariant } from './Badge'

type TrendDirection = 'up' | 'down' | 'neutral'

const TREND_COLOR: Record<TrendDirection, string> = {
  up:      'text-success',
  down:    'text-error',
  neutral: 'text-slate-400',
}

const TREND_ICON = {
  up:      TrendingUp,
  down:    TrendingDown,
  neutral: Minus,
} as const

interface StatCardProps {
  value: string | number
  label: string
  icon?: ReactNode
  trend?: { value: string; direction: TrendDirection }
  badge?: { text: string; variant: BadgeVariant }
  className?: string
}

export default function StatCard({ value, label, icon, trend, badge, className }: StatCardProps) {
  const TIcon = trend ? TREND_ICON[trend.direction] : null

  return (
    <div className={clsx('card flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between">
        <span className="label-caps">{label}</span>
        {icon && (
          <div className="w-8 h-8 rounded bg-surface-panel flex items-center justify-center">
            <span className="text-slate-400 [&>svg]:w-4 [&>svg]:h-4">{icon}</span>
          </div>
        )}
      </div>

      <div>
        <span className="stat-value">{typeof value === 'number' ? value.toLocaleString() : value}</span>
      </div>

      {(trend || badge) && (
        <div className="flex items-center gap-2 flex-wrap">
          {trend && TIcon && (
            <span className={clsx('flex items-center gap-1 text-body-sm font-medium', TREND_COLOR[trend.direction])}>
              <TIcon size={13} />
              {trend.value}
            </span>
          )}
          {badge && <Badge text={badge.text} variant={badge.variant} />}
        </div>
      )}
    </div>
  )
}
