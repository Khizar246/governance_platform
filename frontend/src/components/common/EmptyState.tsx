import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: { label: string; onClick: () => void }
}

export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="fade-in flex flex-col items-center justify-center py-16 text-center px-8">
      <Icon size={48} className="text-gray-300 mb-4" strokeWidth={1.5} />
      <h3 className="text-card-title text-gray-700 mb-1">{title}</h3>
      <p className="text-body-sm text-gray-400 max-w-xs">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 btn-primary"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
