import { useState, useEffect, useRef, useMemo, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type FilterFn,
} from '@tanstack/react-table'
import { ChevronUp, ChevronDown, ChevronsUpDown, Database, Filter, X } from 'lucide-react'
import { clsx } from 'clsx'
import { TableHead, TableRow, TableCell } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { ColumnFilter } from '@/components/common/ColumnFilter'

const SKELETON_ROWS = 8
const DROPDOWN_WIDTH = 224
// Search box ~40px + max options list 208px + footer ~36px
const DROPDOWN_MAX_HEIGHT = 290

// ── Multi-select filter fn (registered in useReactTable filterFns) ─────────────
const multiSelectFilter: FilterFn<unknown> = (row, columnId, filterValue: string[] | undefined) => {
  if (filterValue == null) return true
  if (filterValue.length === 0) return false  // all deselected → show nothing
  return filterValue.includes(String(row.getValue(columnId) ?? ''))
}
multiSelectFilter.autoRemove = (val: string[]) => val == null

// ── Interfaces ─────────────────────────────────────────────────────────────────

interface ServerSideProps {
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

interface ServerSideFilters {
  values: Record<string, string[]>
  onChange: (columnId: string, values: string[]) => void
  onFetchOptions: (columnId: string) => Promise<string[]>
}

interface DataTableProps<T> {
  data: T[]
  columns: ColumnDef<T>[]
  defaultPageSize?: number
  defaultSorting?: SortingState
  emptyMessage?: string
  /** Max height for the scrollable body (enables sticky header). Default 520px. */
  maxHeight?: string
  isLoading?: boolean
  /** When provided, disables client-side pagination and uses these values instead. */
  serverSide?: ServerSideProps
  /** Per-column filter state for server-side mode. */
  serverSideFilters?: ServerSideFilters
  /** Increment to programmatically clear all active client-side filters. */
  filterResetKey?: number
  /** Called whenever the active-filter state changes. */
  onFiltersChange?: (hasActive: boolean) => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function DataTable<T>({
  data,
  columns,
  defaultPageSize = 50,
  defaultSorting,
  emptyMessage = 'No data to display',
  maxHeight = '520px',
  isLoading = false,
  serverSide,
  serverSideFilters,
  filterResetKey,
  onFiltersChange,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(defaultSorting ?? [])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  // Excel filter state
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null)
  const [filterSearch, setFilterSearch] = useState('')
  const [dropdownAnchor, setDropdownAnchor] = useState<DOMRect | null>(null)
  const [dropOpenUp, setDropOpenUp] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      ...(serverSide && { pagination: { pageIndex: serverSide.page - 1, pageSize: serverSide.pageSize } }),
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    filterFns: { multiSelect: multiSelectFilter },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaultColumn: { filterFn: 'multiSelect' as any },
    initialState: { pagination: { pageSize: defaultPageSize } },
    ...(serverSide && {
      manualPagination: true,
      pageCount: Math.ceil(serverSide.total / serverSide.pageSize),
    }),
  })

  // ── Compute unique values for client-side columns ──────────────────────────
  const uniqueValues = useMemo<Record<string, string[]>>(() => {
    if (serverSideFilters) return {}
    const map: Record<string, string[]> = {}
    for (const col of columns) {
      const def = col as unknown as Record<string, unknown>
      const colId = String(def.id ?? def.accessorKey ?? '')
      const key = String(def.accessorKey ?? colId)
      if (!colId) continue
      const vals = new Set<string>()
      let hasEmpty = false
      for (const row of data) {
        const raw = (row as Record<string, unknown>)[key]
        const v = raw == null ? '' : String(raw)
        if (v === '' || v === 'undefined' || v === 'null') {
          hasEmpty = true
        } else {
          vals.add(v)
        }
      }
      const sorted = Array.from(vals).sort((a, b) => a.localeCompare(b))
      map[colId] = hasEmpty ? [...sorted, ''] : sorted
    }
    return map
  }, [data, columns, serverSideFilters])

  // ── Close dropdown on outside click (deferred so opener click doesn't close) ─
  useEffect(() => {
    if (!openFilterCol) return
    let handler: ((e: MouseEvent) => void) | null = null
    const t = setTimeout(() => {
      if (!dropdownRef.current) return
      handler = (e: MouseEvent) => {
        if (!dropdownRef.current?.contains(e.target as Node)) {
          setOpenFilterCol(null)
          setFilterSearch('')
        }
      }
      document.addEventListener('mousedown', handler)
    }, 0)
    return () => {
      clearTimeout(t)
      if (handler) document.removeEventListener('mousedown', handler)
    }
  }, [openFilterCol])

  // ── Close on ESC ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openFilterCol) {
        setOpenFilterCol(null)
        setFilterSearch('')
      }
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [openFilterCol])

  // ── Clear all filters when reset key increments ───────────────────────────
  useEffect(() => {
    if (!filterResetKey) return
    setColumnFilters([])
    setOpenFilterCol(null)
    setFilterSearch('')
  }, [filterResetKey])

  // ── Notify parent when filter activity changes ───────────────────────────
  useEffect(() => {
    onFiltersChange?.(columnFilters.length > 0)
  }, [columnFilters, onFiltersChange])

  // ── Check if a column has an active filter entry (even if value is []) ───
  const isColumnFilterActive = (colId: string): boolean =>
    columnFilters.some(cf => cf.id === colId)

  // ── Client-side multi-select helpers ─────────────────────────────────────
  const getClientFilterValues = (colId: string): string[] => {
    const f = columnFilters.find(cf => cf.id === colId)
    return Array.isArray(f?.value) ? (f.value as string[]) : []
  }

  const toggleClientValue = (colId: string, value: string) => {
    const all = uniqueValues[colId] ?? []
    const active = isColumnFilterActive(colId)
    const current = getClientFilterValues(colId)
    let updated: string[]
    if (!active) {
      // No active filter — all values implicitly shown. Unchecking excludes this value.
      updated = all.filter(v => v !== value)
    } else {
      updated = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value]
    }
    // Clear filter (show all) when all values re-included; [] means show nothing
    table.getColumn(colId)?.setFilterValue(
      updated.length >= all.length ? undefined : updated,
    )
  }

  // ── Open filter dropdown ──────────────────────────────────────────────────
  const openFilter = (colId: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (openFilterCol === colId) {
      setOpenFilterCol(null)
      setFilterSearch('')
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    setDropOpenUp(spaceBelow < DROPDOWN_MAX_HEIGHT + 4)
    setDropdownAnchor(rect)
    setOpenFilterCol(colId)
    setFilterSearch('')
  }

  // ── Pagination helpers ────────────────────────────────────────────────────
  const clientPageIndex = table.getState().pagination.pageIndex
  const clientPageSize = table.getState().pagination.pageSize
  const clientTotal = table.getFilteredRowModel().rows.length

  const effectivePageIndex = serverSide ? serverSide.page - 1 : clientPageIndex
  const effectivePageSize = serverSide ? serverSide.pageSize : clientPageSize
  const effectiveTotal = serverSide ? serverSide.total : clientTotal
  const effectivePageCount = serverSide ? Math.ceil(serverSide.total / serverSide.pageSize) : table.getPageCount()
  const canPrev = serverSide ? serverSide.page > 1 : table.getCanPreviousPage()
  const canNext = serverSide ? serverSide.page < effectivePageCount : table.getCanNextPage()

  const start = effectiveTotal === 0 ? 0 : effectivePageIndex * effectivePageSize + 1
  const end = Math.min(start + effectivePageSize - 1, effectiveTotal)

  // ── Dropdown position ─────────────────────────────────────────────────────
  const dropLeft = dropdownAnchor
    ? Math.min(dropdownAnchor.left, window.innerWidth - DROPDOWN_WIDTH - 8)
    : 0
  const dropTop = dropdownAnchor
    ? dropOpenUp
      ? Math.max(8, dropdownAnchor.top - DROPDOWN_MAX_HEIGHT - 4)
      : dropdownAnchor.bottom + 4
    : 0

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col gap-3">

        {/* ── Scrollable table ── */}
        <div
          className="overflow-auto rounded-lg border border-gray-200 max-h-[var(--max-h)]"
          style={{ '--max-h': maxHeight } as CSSProperties}
        >
          <table className="w-full text-sm">

            {/* ── Sticky header ── */}
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="hover:bg-transparent">
                  {hg.headers.map((header) => {
                    const colId = header.column.id
                    const isClientFilterCol = !!(header.column.getCanFilter() && !serverSideFilters)

                    // Active state indicators
                    const clientActive = isClientFilterCol && isColumnFilterActive(colId)

                    return (
                      <TableHead
                        key={header.id}
                        className="sticky top-0 z-10 h-auto min-w-[120px] bg-gray-50 border-b border-gray-200 px-3 pt-2.5 pb-1.5 align-top"
                      >
                        {/* Column label + sort */}
                        <div
                          className={clsx(
                            'flex items-center gap-1 select-none whitespace-nowrap',
                            'text-[11px] font-semibold text-gray-500 uppercase tracking-[0.05em]',
                            header.column.getCanSort() && 'cursor-pointer hover:text-gray-700',
                            (isClientFilterCol || !!serverSideFilters) ? 'mb-1.5' : '',
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanSort() && (
                            <span className="text-gray-400 shrink-0">
                              {header.column.getIsSorted() === 'asc' ? (
                                <ChevronUp size={11} />
                              ) : header.column.getIsSorted() === 'desc' ? (
                                <ChevronDown size={11} />
                              ) : (
                                <ChevronsUpDown size={11} />
                              )}
                            </span>
                          )}
                        </div>

                        {/* ── Excel filter button (client-side columns) ── */}
                        {isClientFilterCol && !isLoading && (
                          <button
                            onClick={(e) => openFilter(colId, e)}
                            className={clsx(
                              'flex items-center justify-between gap-1 w-full h-6 px-1.5 rounded border text-[11px] transition-colors',
                              clientActive
                                ? 'border-[#FFD100] bg-yellow-50 text-gray-700'
                                : 'border-gray-200 bg-white text-gray-400 hover:text-gray-600 hover:border-gray-300',
                            )}
                          >
                            <span className="truncate flex-1 text-left">
                              {clientActive
                                ? `${getClientFilterValues(colId).length} selected`
                                : 'Filter…'}
                            </span>
                            <Filter size={10} className="shrink-0" />
                          </button>
                        )}

                        {/* ── Server-side Excel filter (ColumnFilter component) ── */}
                        {serverSideFilters && !isLoading && (
                          <ColumnFilter
                            isOpen={openFilterCol === colId}
                            onOpen={() => setOpenFilterCol(colId)}
                            onClose={() => setOpenFilterCol(null)}
                            selectedValues={serverSideFilters.values[colId] ?? []}
                            fetchOptions={() => serverSideFilters.onFetchOptions(colId)}
                            onApply={(vals) => serverSideFilters.onChange(colId, vals)}
                            onClear={() => serverSideFilters.onChange(colId, [])}
                          />
                        )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </thead>

            {/* ── Body ── */}
            <tbody>

              {/* Skeleton rows while loading */}
              {isLoading &&
                Array.from({ length: SKELETON_ROWS }).map((_, ri) => (
                  <TableRow
                    key={`sk-${ri}`}
                    className={clsx(
                      'border-b border-gray-100 hover:bg-transparent',
                      ri % 2 === 0 ? 'bg-white' : 'bg-gray-50',
                    )}
                  >
                    {columns.map((_, ci) => (
                      <TableCell key={ci} className="px-3 py-2.5">
                        <Skeleton
                          className="h-3.5 rounded w-[var(--w)]"
                          style={{ '--w': `${45 + ((ri * 7 + ci * 13) % 45)}%` } as CSSProperties}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

              {/* Empty state */}
              {!isLoading && table.getRowModel().rows.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns.length} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Database size={36} strokeWidth={1.5} className="text-gray-300" />
                      <div className="space-y-1">
                        <p className="text-[13px] font-medium text-gray-500">{emptyMessage}</p>
                        <p className="text-xs text-gray-400">Try adjusting the column filters above</p>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {/* Data rows — zebra + hover */}
              {!isLoading &&
                table.getRowModel().rows.map((row, i) => (
                  <TableRow
                    key={row.id}
                    className={clsx(
                      'border-b border-gray-100 transition-colors duration-75',
                      i % 2 === 0 ? 'bg-white hover:bg-gray-100' : 'bg-gray-50 hover:bg-gray-100',
                    )}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const raw = String(cell.getValue() ?? '')
                      return (
                        <TableCell
                          key={cell.id}
                          className="px-3 py-2 text-[13px] text-gray-700 max-w-[240px]"
                        >
                          {raw.length > 30 ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="block truncate cursor-default">
                                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs break-words text-xs">
                                {raw}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="block truncate">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </span>
                          )}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}

            </tbody>
          </table>
        </div>

        {/* ── Pagination bar ── */}
        <div className="flex items-center justify-between text-[13px] text-gray-500">
          <span>
            {isLoading
              ? 'Loading…'
              : effectiveTotal === 0
              ? 'No results'
              : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${effectiveTotal.toLocaleString()} rows`}
          </span>
          <div className="flex items-center gap-2">
            <select
              value={effectivePageSize}
              onChange={(e) => {
                const sz = Number(e.target.value)
                serverSide ? serverSide.onPageSizeChange(sz) : table.setPageSize(sz)
              }}
              disabled={isLoading}
              className="border border-gray-200 rounded px-2 py-1 text-[13px] text-gray-600 bg-white focus:outline-none focus:border-ey-yellow disabled:opacity-50"
            >
              {[50, 100, 200].map((sz) => (
                <option key={sz} value={sz}>{sz} / page</option>
              ))}
            </select>
            <button
              onClick={() => serverSide ? serverSide.onPageChange(serverSide.page - 1) : table.previousPage()}
              disabled={!canPrev || isLoading}
              className="px-2.5 py-1 border border-gray-200 rounded text-gray-600 disabled:opacity-40 hover:bg-gray-100 transition-colors"
            >
              ←
            </button>
            <span className="tabular-nums min-w-[3rem] text-center">
              {isLoading ? '–' : `${effectivePageIndex + 1} / ${effectivePageCount || 1}`}
            </span>
            <button
              onClick={() => serverSide ? serverSide.onPageChange(serverSide.page + 1) : table.nextPage()}
              disabled={!canNext || isLoading}
              className="px-2.5 py-1 border border-gray-200 rounded text-gray-600 disabled:opacity-40 hover:bg-gray-100 transition-colors"
            >
              →
            </button>
          </div>
        </div>

      </div>

      {/* ── Excel filter dropdown (portaled to body, client-side mode only) ── */}
      {!serverSideFilters && openFilterCol && dropdownAnchor && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{ '--dd-top': `${dropTop}px`, '--dd-left': `${dropLeft}px` } as CSSProperties}
            className="fixed top-[var(--dd-top)] left-[var(--dd-left)] w-56 z-[9999] bg-white rounded-lg border border-gray-200 shadow-xl overflow-hidden"
          >
            {/* Search box */}
            <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-gray-100">
              <Filter size={11} className="text-gray-400 shrink-0" />
              <input
                autoFocus
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder="Search values…"
                className="flex-1 text-[12px] outline-none placeholder-gray-400 bg-transparent"
              />
              {filterSearch && (
                <button onClick={() => setFilterSearch('')} className="text-gray-400 hover:text-gray-600">
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Options list */}
            <div className="max-h-52 overflow-y-auto">

              {/* ── Client-side: multi-select from computed unique values ── */}
              {!serverSide && (() => {
                const allVals = uniqueValues[openFilterCol] ?? []
                const visible = filterSearch
                  ? allVals.filter(v =>
                      (v === '' ? '[Empty]' : v).toLowerCase().includes(filterSearch.toLowerCase()),
                    )
                  : allVals
                const activeVals = getClientFilterValues(openFilterCol)
                const isFilterActive = isColumnFilterActive(openFilterCol)
                // Exclusion model: no filter = all implicitly selected; [] = none selected
                const effectiveSelected = isFilterActive ? activeVals : allVals
                const allChecked = !isFilterActive || (visible.length > 0 && visible.every(v => effectiveSelected.includes(v)))

                if (visible.length === 0) {
                  return (
                    <p className="py-6 text-center text-[12px] text-gray-400">No matching values</p>
                  )
                }

                return (
                  <>
                    {/* (Select All) — only when not searching */}
                    {!filterSearch && (
                      <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50 border-b border-gray-100">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          onChange={() => table.getColumn(openFilterCol)?.setFilterValue(allChecked ? [] : undefined)}
                          className="h-3.5 w-3.5 rounded accent-[#FFD100]"
                        />
                        <span className="text-[12px] text-gray-500 italic">(Select All)</span>
                      </label>
                    )}
                    {visible.map((val) => (
                      <label
                        key={val === '' ? '__empty__' : val}
                        className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          checked={effectiveSelected.includes(val)}
                          onChange={() => toggleClientValue(openFilterCol, val)}
                          className="h-3.5 w-3.5 rounded accent-[#FFD100]"
                        />
                        <span className="text-[12px] text-gray-700 truncate" title={val || '[Empty]'}>
                          {val === '' ? <em className="text-gray-400">[Empty]</em> : val}
                        </span>
                      </label>
                    ))}
                  </>
                )
              })()}


            </div>

            {/* Footer (client-side only — clear + done) */}
            {!serverSide && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 bg-gray-50">
                <button
                  onClick={() => {
                    table.getColumn(openFilterCol)?.setFilterValue(undefined)
                  }}
                  className="text-[11px] text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Clear
                </button>
                <button
                  onClick={() => { setOpenFilterCol(null); setFilterSearch('') }}
                  className="text-[11px] font-semibold text-[#0F1E3D] hover:text-[#1a2f5f] transition-colors"
                >
                  Done
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}

    </TooltipProvider>
  )
}
