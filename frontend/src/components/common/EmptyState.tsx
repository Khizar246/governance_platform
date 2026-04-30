import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: { label: string; onClick: () => void }
}

/** Centered empty-state placeholder used when there is no data to display. */
export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-8">
      <Icon size={64} className="text-gray-300 mb-4" strokeWidth={1.5} />
      <h3 className="text-base font-semibold text-gray-600 mb-1">{title}</h3>
      <p className="text-sm text-gray-400 max-w-xs">{description}</p>
      {action && (
        <button
          className="btn-primary mt-5"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
