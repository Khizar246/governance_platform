import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

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

export function SchemaTable({
  fileLabel,
  rows,
}: {
  fileLabel: string
  rows: { sheet?: string; column: string; status: string; note?: string }[]
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ fontSize: 12.5, fontWeight: 600, color: '#0F1E3D', marginBottom: 6 }}>{fileLabel}</p>
      <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#F7F6F3' }}>
              {rows.some(r => r.sheet) && (
                <th style={{ textAlign: 'left', padding: '7px 10px', fontWeight: 600, color: '#64748B', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Sheet</th>
              )}
              <th style={{ textAlign: 'left', padding: '7px 10px', fontWeight: 600, color: '#64748B', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Column</th>
              <th style={{ textAlign: 'left', padding: '7px 10px', fontWeight: 600, color: '#64748B', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Status</th>
              <th style={{ textAlign: 'left', padding: '7px 10px', fontWeight: 600, color: '#64748B', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>What it means</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: '1px solid #F1F0EA', background: i % 2 === 1 ? '#FAFAF8' : '#FFFFFF' }}>
                {rows.some(row => row.sheet) && (
                  <td style={{ padding: '7px 10px', color: '#64748B' }}>{r.sheet ?? ''}</td>
                )}
                <td style={{ padding: '7px 10px', color: '#334155', fontWeight: 500 }}>{r.column}</td>
                <td style={{ padding: '7px 10px' }}>
                  {(r.status === 'Required' || r.status === 'Optional') ? (
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: 10.5,
                        fontWeight: 600,
                        background: r.status === 'Required' ? '#FEE2E2' : '#DCFCE7',
                        color: r.status === 'Required' ? '#B91C1C' : '#166534',
                      }}
                    >
                      {r.status}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11.5, color: '#B45309', fontWeight: 500 }}>{r.status}</span>
                  )}
                </td>
                <td style={{ padding: '7px 10px', color: '#64748B' }}>{r.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
