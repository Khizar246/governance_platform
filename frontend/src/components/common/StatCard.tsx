import Badge, { type BadgeVariant } from './Badge'
import { clsx } from 'clsx'

interface StatCardProps {
  value: string | number
  label: string
  badge?: { text: string; variant: BadgeVariant }
  className?: string
}

/** Numeric stat card — JetBrains Mono value, uppercase label, optional semantic badge. */
export default function StatCard({ value, label, badge, className }: StatCardProps) {
  return (
    <div className={clsx('card flex flex-col gap-1', className)}>
      <div className="font-mono text-stat-lg font-bold text-gray-800 leading-none">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="label-uppercase mt-0.5">{label}</div>
      {badge && (
        <div className="mt-1">
          <Badge text={badge.text} variant={badge.variant} />
        </div>
      )}
    </div>
  )
}
