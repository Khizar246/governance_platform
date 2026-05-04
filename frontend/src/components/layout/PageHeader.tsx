import type { ReactNode } from 'react'

interface PageHeaderProps {
  icon: ReactNode
  title: string
  subtitle: string
}

export default function PageHeader({ icon, title, subtitle }: PageHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 28,
      }}
    >
      <div
        style={{
          width: 40, height: 40,
          borderRadius: 10,
          background: '#0F1E3D',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: '#FFD100',
        }}
      >
        {icon}
      </div>
      <div>
        <h2
          style={{
            fontFamily: "'Lora', serif",
            fontSize: 22,
            fontWeight: 600,
            color: '#0F1E3D',
            lineHeight: 1.2,
          }}
        >
          {title}
        </h2>
        <p style={{ fontSize: 12.5, color: '#64748B', marginTop: 2 }}>{subtitle}</p>
      </div>
    </div>
  )
}
