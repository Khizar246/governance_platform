import { useState } from 'react'
import { ChevronDown, Download } from 'lucide-react'

// ── Sub-components ────────────────────────────────────────────────────────

export function HelpStep({ num, text }: { num: number; text: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
      <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#F0EFE9', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#334155' }}>{num}</span>
      </div>
      <p style={{ fontSize: 13, color: '#334155', lineHeight: 1.6, paddingTop: 2 }}>{text}</p>
    </div>
  )
}

export function HelpPill({ label, note }: { label: string; note: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, padding: '8px 12px', borderRadius: 7, background: '#F7F6F3', border: '1px solid #F1F0EA', marginBottom: 7 }}>
      <code style={{ fontSize: 11, background: '#F0EFE9', padding: '2px 7px', borderRadius: 4, fontFamily: 'monospace', color: '#0F1E3D', flexShrink: 0 }}>{label}</code>
      <span style={{ fontSize: 12.5, color: '#64748B', lineHeight: 1.5 }}>{note}</span>
    </div>
  )
}

export function TemplateDownloads({ templates }: { templates: [string, string, string?][] }) {
  return (
    <HelpAccordion title="Template Files" icon={<Download size={14} color="#D97706" />} accentColor="#D97706">
      <p style={{ fontSize: 12.5, color: '#64748B', marginBottom: 12, lineHeight: 1.55 }}>
        Blank templates with the correct column headers and a "How to Fill Data" guide sheet pre-filled.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {templates.map(([name, fmt, url]) => {
          const inner = (
            <>
              <Download size={13} color={url ? '#D97706' : '#64748B'} />
              <span style={{ fontSize: 13, color: '#334155', flex: 1 }}>{name}</span>
              <code style={{ fontSize: 10, background: '#F0EFE9', padding: '2px 7px', borderRadius: 3, color: '#64748B', fontFamily: 'monospace' }}>{fmt}</code>
            </>
          )
          const sharedStyle: React.CSSProperties = {
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '8px 11px', borderRadius: 7,
            border: `1px solid ${url ? '#FFD100' : '#E2E8F0'}`,
            transition: 'background 0.12s',
            textDecoration: 'none',
          }
          return url ? (
            <a
              key={name}
              href={url}
              download
              style={{ ...sharedStyle, cursor: 'pointer' }}
              onMouseOver={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#FFFBEB' }}
              onMouseOut={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent' }}
            >
              {inner}
            </a>
          ) : (
            <div
              key={name}
              style={{ ...sharedStyle, cursor: 'default' }}
            >
              {inner}
            </div>
          )
        })}
      </div>
    </HelpAccordion>
  )
}

// ── Main component ────────────────────────────────────────────────────────

interface HelpAccordionProps {
  title: string
  icon: React.ReactNode
  accentColor: string
  children: React.ReactNode
}

export default function HelpAccordion({ title, icon, accentColor, children }: HelpAccordionProps) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', marginBottom: 10, background: '#FFFFFF' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '11px 16px',
          background: open ? '#F7F6F3' : 'transparent',
          border: 'none', cursor: 'pointer',
          fontFamily: "'DM Sans', sans-serif",
          transition: 'background 0.15s',
        }}
      >
        <div style={{ width: 28, height: 28, borderRadius: 7, background: accentColor + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {icon}
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#0F1E3D', flex: 1, textAlign: 'left' as const }}>{title}</span>
        <ChevronDown
          size={16}
          color="#64748B"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.22s', flexShrink: 0 }}
        />
      </button>
      {open && (
        <div style={{ padding: '4px 16px 16px', borderTop: '1px solid #F1F0EA' }}>
          <div style={{ paddingTop: 14 }}>{children}</div>
        </div>
      )}
    </div>
  )
}
