import type { ReactNode } from 'react'

interface PageHeaderProps {
  icon: ReactNode
  title: string
  subtitle: string
}

/** Compact page header — icon + title | subtitle. 48px tall with bottom border. */
export default function PageHeader({ icon, title, subtitle }: PageHeaderProps) {
  return (
    <div className="flex items-center gap-3 mb-6 pb-3 border-b border-gray-200 h-12 shrink-0">
      <span className="text-gray-600 shrink-0">{icon}</span>
      <span className="text-xl font-bold text-gray-800 leading-tight">{title}</span>
      <span className="text-gray-300 select-none">|</span>
      <span className="text-sm text-gray-500 truncate">{subtitle}</span>
    </div>
  )
}
