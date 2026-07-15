import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

// ── Sub-components ────────────────────────────────────────────────────────

export function HelpStep({ num, text }: { num: number; text: string }) {
  return (
    <div className="flex gap-2.5 mb-2.5">
      <div className="w-[22px] h-[22px] rounded-full bg-surface-panel border border-slate-200 flex items-center justify-center shrink-0 mt-px">
        <span className="text-[11px] font-semibold text-slate-700">{num}</span>
      </div>
      <p className="text-[13px] text-slate-700 leading-[1.6] pt-0.5">{text}</p>
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
    <div className="mb-3.5">
      <p className="text-[12.5px] font-semibold text-navy mb-1.5">{fileLabel}</p>
      <div className="border border-slate-200 rounded-[8px] overflow-hidden">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-surface-page">
              {rows.some(r => r.sheet) && (
                <th className="text-left px-2.5 py-[7px] font-semibold text-slate-500 text-[10.5px] uppercase tracking-[0.04em]">Sheet</th>
              )}
              <th className="text-left px-2.5 py-[7px] font-semibold text-slate-500 text-[10.5px] uppercase tracking-[0.04em]">Column</th>
              <th className="text-left px-2.5 py-[7px] font-semibold text-slate-500 text-[10.5px] uppercase tracking-[0.04em]">Status</th>
              <th className="text-left px-2.5 py-[7px] font-semibold text-slate-500 text-[10.5px] uppercase tracking-[0.04em]">What it means</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`border-t border-t-slate-200 ${i % 2 === 1 ? 'bg-surface-page' : 'bg-white'}`}>
                {rows.some(row => row.sheet) && (
                  <td className="px-2.5 py-[7px] text-slate-500">{r.sheet ?? ''}</td>
                )}
                <td className="px-2.5 py-[7px] text-slate-700 font-medium">{r.column}</td>
                <td className="px-2.5 py-[7px]">
                  {(r.status === 'Required' || r.status === 'Optional') ? (
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${
                        r.status === 'Required' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-800'
                      }`}
                    >
                      {r.status}
                    </span>
                  ) : (
                    <span className="text-[11.5px] text-amber-700 font-medium">{r.status}</span>
                  )}
                </td>
                <td className="px-2.5 py-[7px] text-slate-500">{r.note ?? ''}</td>
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
  children: React.ReactNode
}

export default function HelpAccordion({ title, icon, children }: HelpAccordionProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-slate-200 rounded-[10px] overflow-hidden mb-2.5 bg-white">
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2.5 px-4 py-[11px] border-none cursor-pointer font-['DM_Sans',sans-serif] transition-[background] duration-150 ${open ? 'bg-surface-page' : 'bg-transparent'}`}
      >
        <div className="w-7 h-7 rounded-[7px] flex items-center justify-center shrink-0 bg-blue-600/10">
          {icon}
        </div>
        <span className="text-[13px] font-semibold text-navy flex-1 text-left">{title}</span>
        <ChevronDown
          size={16}
          className={`text-slate-500 shrink-0 transition-transform duration-[220ms] ${open ? 'rotate-180' : 'rotate-0'}`}
        />
      </button>
      {open && (
        <div className="px-4 pt-1 pb-4 border-t border-t-slate-200">
          <div className="pt-3.5">{children}</div>
        </div>
      )}
    </div>
  )
}
