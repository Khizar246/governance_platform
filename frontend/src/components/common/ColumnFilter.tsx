import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Filter, X } from 'lucide-react'
import { clsx } from 'clsx'

const DROPDOWN_WIDTH = 224
const DROPDOWN_MAX_HEIGHT = 290

interface ColumnFilterProps {
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  selectedValues: string[]
  fetchOptions: () => Promise<string[]>
  onApply: (values: string[]) => void
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
    setPending(selectedValues)
    setOptionsLoading(true)
    fetchOptions()
      .then(setOptions)
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

  const isActive = selectedValues.length > 0

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
            ? 'border-[#FFD100] bg-yellow-50 text-gray-700'
            : 'border-gray-200 bg-white text-gray-400 hover:text-gray-600 hover:border-gray-300',
        )}
      >
        <span className="truncate flex-1 text-left">
          {isActive ? `${selectedValues.length} selected` : 'Filter…'}
        </span>
        <Filter size={10} className="shrink-0" />
      </button>

      {isOpen && anchor && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropRef}
            style={{
              position: 'fixed',
              top: dropTop,
              left: dropLeft,
              width: DROPDOWN_WIDTH,
              zIndex: 9999,
            }}
            className="bg-white rounded-lg border border-gray-200 shadow-xl overflow-hidden"
          >
            {/* Search */}
            <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-gray-100">
              <Filter size={11} className="text-gray-400 shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search values…"
                className="flex-1 text-[12px] outline-none placeholder-gray-400 bg-transparent"
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600">
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Options */}
            <div className="max-h-52 overflow-y-auto">
              {optionsLoading ? (
                <p className="py-6 text-center text-[12px] text-gray-400">Loading…</p>
              ) : visibleOptions.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-gray-400">No matching values</p>
              ) : (
                <>
                  {!search && (
                    <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50 border-b border-gray-100">
                      <input
                        type="checkbox"
                        checked={allVisibleChecked}
                        onChange={toggleSelectAll}
                        className="h-3.5 w-3.5 rounded accent-[#FFD100]"
                      />
                      <span className="text-[12px] text-gray-500 italic">(Select All)</span>
                    </label>
                  )}
                  {visibleOptions.map(val => (
                    <label
                      key={val === '' ? '__empty__' : val}
                      className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={pending.includes(val)}
                        onChange={() => toggleItem(val)}
                        className="h-3.5 w-3.5 rounded accent-[#FFD100]"
                      />
                      <span
                        className="text-[12px] text-gray-700 truncate"
                        title={val || '[Empty]'}
                      >
                        {val === '' ? <em className="text-gray-400">[Empty]</em> : val}
                      </span>
                    </label>
                  ))}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => { onClear(); onClose() }}
                className="text-[11px] text-gray-500 hover:text-gray-700 transition-colors"
              >
                Clear Filter
              </button>
              <button
                onClick={() => { onApply(pending); onClose() }}
                className="text-[11px] font-semibold text-[#0F1E3D] hover:text-[#1a2f5f] transition-colors"
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
