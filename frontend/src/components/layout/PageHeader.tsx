import type { ReactNode } from 'react'

interface PageHeaderProps {
  icon: ReactNode
  title: string
  subtitle: string
}

export default function PageHeader({ icon, title, subtitle }: PageHeaderProps) {
  return (
    <div className="flex items-center gap-3 mb-7">
      <div className="w-10 h-10 rounded-[10px] bg-navy flex items-center justify-center shrink-0 text-ey-yellow">
        {icon}
      </div>
      <div>
        <h2 className="font-serif text-[22px] font-semibold text-navy leading-[1.2]">
          {title}
        </h2>
        <p className="text-[12.5px] text-slate-500 mt-0.5">{subtitle}</p>
      </div>
    </div>
  )
}
