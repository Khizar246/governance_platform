import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Filter, X } from 'lucide-react'
import { clsx } from 'clsx'

const DROPDOWN_WIDTH = 224
const DROPDOWN_MAX_HEIGHT = 290

interface ColumnFilterProps {
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  /** Active selection for this column; null = no filter set (all rows pass). */
  selectedValues: string[] | null
  fetchOptions: () => Promise<string[]>
  /** Apply a selection. An empty array means "exclude every value" (show no rows). */
  onApply: (values: string[]) => void
  /** Remove the filter entirely — the column goes back to unfiltered. */
  onClear: () => void
}

export function ColumnFilter({
  isOpen,
  onOpen,
  onClose,
  selectedValues,
  fetchOptions,
  onApply,
  onClear,
}: ColumnFilterProps) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const [options, setOptions] = useState<string[]>([])
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<string[]>([])
  const [anchor, setAnchor] = useState<DOMRect | null>(null)

  // On open: capture position, initialise pending, fetch options
  useEffect(() => {
    if (!isOpen) {
      setSearch('')
      setOptions([])
      return
    }
    if (btnRef.current) setAnchor(btnRef.current.getBoundingClientRect())
    setPending(selectedValues ?? [])
    setOptionsLoading(true)
    fetchOptions()
      .then((opts) => {
        setOptions(opts)
        // No active filter → Excel convention: every value starts checked, so
        // unchecking is an explicit act and OK-without-changes stays a no-op.
        if (selectedValues === null) setPending(opts)
      })
      .catch(() => setOptions([]))
      .finally(() => setOptionsLoading(false))
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Outside-click closes without applying
  useEffect(() => {
    if (!isOpen) return
    let handler: ((e: MouseEvent) => void) | null = null
    const t = setTimeout(() => {
      handler = (e: MouseEvent) => {
        const inDrop = dropRef.current?.contains(e.target as Node)
        const inBtn = btnRef.current?.contains(e.target as Node)
        if (!inDrop && !inBtn) onClose()
      }
      document.addEventListener('mousedown', handler)
    }, 0)
    return () => {
      clearTimeout(t)
      if (handler) document.removeEventListener('mousedown', handler)
    }
  }, [isOpen, onClose])

  // ESC closes without applying
  useEffect(() => {
    if (!isOpen) return
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [isOpen, onClose])

  const isActive = selectedValues !== null

  // Applying with every fetched value checked means "no restriction" — store no
  // filter at all instead of a full-list snapshot that would go stale.
  const applyPending = () => {
    const allChecked = options.length > 0 && options.every(o => pending.includes(o))
    if (allChecked) onClear()
    else onApply(pending)
    onClose()
  }

  const visibleOptions = search
    ? options.filter(o => (o === '' ? '[Empty]' : o).toLowerCase().includes(search.toLowerCase()))
    : options

  const allVisibleChecked =
    visibleOptions.length > 0 && visibleOptions.every(o => pending.includes(o))

  const toggleSelectAll = () => {
    if (allVisibleChecked) {
      setPending(prev => prev.filter(p => !visibleOptions.includes(p)))
    } else {
      setPending(prev => {
        const next = new Set(prev)
        visibleOptions.forEach(o => next.add(o))
        return Array.from(next)
      })
    }
  }

  const toggleItem = (val: string) =>
    setPending(prev =>
      prev.includes(val) ? prev.filter(p => p !== val) : [...prev, val],
    )

  // Portal position
  let dropTop = 0
  let dropLeft = 0
  if (anchor) {
    dropLeft = Math.min(anchor.left, window.innerWidth - DROPDOWN_WIDTH - 8)
    const spaceBelow = window.innerHeight - anchor.bottom
    dropTop =
      spaceBelow >= DROPDOWN_MAX_HEIGHT + 4
        ? anchor.bottom + 4
        : Math.max(8, anchor.top - DROPDOWN_MAX_HEIGHT - 4)
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (isOpen ? onClose() : onOpen())}
        className={clsx(
          'flex items-center justify-between gap-1 w-full h-6 px-1.5 rounded border text-[11px] transition-colors',
          isActive
            ? 'border-ey-yellow bg-yellow-50 text-slate-700'
            : 'border-slate-200 bg-white text-slate-400 hover:text-slate-600 hover:border-slate-300',
        )}
      >
        <span className="truncate flex-1 text-left">
          {selectedValues === null ? 'Filter…' : `${selectedValues.length} selected`}
        </span>
        <Filter size={10} className="shrink-0" />
      </button>

      {isOpen && anchor && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropRef}
            style={{ '--dd-top': `${dropTop}px`, '--dd-left': `${dropLeft}px` } as CSSProperties}
            className="fixed top-[var(--dd-top)] left-[var(--dd-left)] w-56 z-[9999] bg-white rounded-lg border border-slate-200 shadow-xl overflow-hidden"
          >
            {/* Search */}
            <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-slate-100">
              <Filter size={11} className="text-slate-400 shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search values…"
                className="flex-1 text-[12px] outline-none placeholder-slate-400 bg-transparent"
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Options */}
            <div className="max-h-52 overflow-y-auto">
              {optionsLoading ? (
                <p className="py-6 text-center text-[12px] text-slate-400">Loading…</p>
              ) : visibleOptions.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-slate-400">No matching values</p>
              ) : (
                <>
                  {!search && (
                    <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-50 border-b border-slate-100">
                      <input
                        type="checkbox"
                        checked={allVisibleChecked}
                        onChange={toggleSelectAll}
                        className="h-3.5 w-3.5 rounded accent-ey-yellow"
                      />
                      <span className="text-[12px] text-slate-500 italic">(Select All)</span>
                    </label>
                  )}
                  {visibleOptions.map(val => (
                    <label
                      key={val === '' ? '__empty__' : val}
                      className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={pending.includes(val)}
                        onChange={() => toggleItem(val)}
                        className="h-3.5 w-3.5 rounded accent-ey-yellow"
                      />
                      <span
                        className="text-[12px] text-slate-700 truncate"
                        title={val || '[Empty]'}
                      >
                        {val === '' ? <em className="text-slate-400">[Empty]</em> : val}
                      </span>
                    </label>
                  ))}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 bg-slate-50">
              <button
                onClick={() => { onClear(); onClose() }}
                className="text-[11px] text-slate-500 hover:text-slate-700 transition-colors"
              >
                Clear Filter
              </button>
              <button
                onClick={applyPending}
                disabled={optionsLoading || options.length === 0}
                className="text-[11px] font-semibold text-navy hover:text-navy-mid transition-colors disabled:opacity-40 disabled:hover:text-navy"
              >
                OK
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
