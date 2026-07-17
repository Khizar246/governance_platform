import { useState, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
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
import { ChevronUp, ChevronDown, ChevronsUpDown, Database } from 'lucide-react'
import { clsx } from 'clsx'
import { TableHead, TableRow, TableCell } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { ColumnFilter } from '@/components/common/ColumnFilter'

const SKELETON_ROWS = 8

// ── Cell that reveals its full value in a tooltip only when actually clipped ──
// Truncation is width-driven (max-w-[240px] + truncate), so a short value can be
// cut off just as a long one is. Measure real overflow instead of guessing from
// string length, so every clipped cell — long or "wide but short" — gets a tooltip.
function TruncatedCell({ fullText, children }: { fullText: string; children: ReactNode }) {
  const spanRef = useRef<HTMLSpanElement>(null)
  const [isTruncated, setIsTruncated] = useState(false)

  const measure = () => {
    const el = spanRef.current
    if (el) setIsTruncated(el.scrollWidth > el.clientWidth)
  }

  const content = (
    <span ref={spanRef} onPointerEnter={measure} className="block truncate">
      {children}
    </span>
  )

  if (!isTruncated) return content

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent className="max-w-xs break-words text-xs">{fullText}</TooltipContent>
    </Tooltip>
  )
}

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
  /** Active filters only — a key exists iff that column is filtered ([] = exclude all). */
  values: Record<string, string[]>
  /** values = [] means "exclude every value"; null means "remove this column's filter". */
  onChange: (columnId: string, values: string[] | null) => void
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

  // Excel filter state — which column's ColumnFilter dropdown is open
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null)

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

  // ── Clear all filters when reset key increments ───────────────────────────
  useEffect(() => {
    if (!filterResetKey) return
    setColumnFilters([])
    setOpenFilterCol(null)
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

  // ── Pagination helpers ────────────────────────────────────────────────────
  const clientPageIndex = table.getState().pagination.pageIndex
  const clientPageSize = table.getState().pagination.pageSize
  const clientTotal = table.getFilteredRowModel().rows.length

  const effectivePageSize = serverSide ? serverSide.pageSize : clientPageSize
  const effectiveTotal = serverSide ? serverSide.total : clientTotal
  const effectivePageCount = serverSide ? Math.ceil(serverSide.total / serverSide.pageSize) : table.getPageCount()
  // Clamp the displayed page to the valid range. When a filter shrinks `total`
  // before the parent resets `page`, an un-clamped stale page produces a blank
  // grid and nonsense counts ("Showing 201–10 of 10 rows").
  const lastPageIndex = Math.max(0, effectivePageCount - 1)
  const effectivePageIndex = serverSide
    ? Math.min(serverSide.page - 1, lastPageIndex)
    : clientPageIndex
  const canPrev = serverSide ? effectivePageIndex > 0 : table.getCanPreviousPage()
  const canNext = serverSide ? effectivePageIndex < lastPageIndex : table.getCanNextPage()

  const start = effectiveTotal === 0 ? 0 : effectivePageIndex * effectivePageSize + 1
  const end = Math.min(start + effectivePageSize - 1, effectiveTotal)

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col gap-3">

        {/* ── Scrollable table ── */}
        <div
          className="overflow-auto rounded-lg border border-slate-200 max-h-[var(--max-h)]"
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
                        className="sticky top-0 z-10 h-auto min-w-[120px] bg-slate-50 border-b border-slate-200 px-3 pt-2.5 pb-1.5 align-top"
                      >
                        {/* Column label + sort */}
                        <div
                          className={clsx(
                            'flex items-center gap-1 select-none whitespace-nowrap',
                            'text-[11px] font-semibold text-slate-500 uppercase tracking-[0.05em]',
                            header.column.getCanSort() && 'cursor-pointer hover:text-slate-700',
                            (isClientFilterCol || !!serverSideFilters) ? 'mb-1.5' : '',
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanSort() && (
                            <span className="text-slate-400 shrink-0">
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

                        {/* ── Excel filter (client-side columns; shared ColumnFilter) ── */}
                        {isClientFilterCol && !isLoading && (
                          <ColumnFilter
                            isOpen={openFilterCol === colId}
                            onOpen={() => setOpenFilterCol(colId)}
                            onClose={() => setOpenFilterCol(null)}
                            selectedValues={clientActive ? getClientFilterValues(colId) : null}
                            fetchOptions={() => Promise.resolve(uniqueValues[colId] ?? [])}
                            onApply={(vals) => table.getColumn(colId)?.setFilterValue(vals)}
                            onClear={() => table.getColumn(colId)?.setFilterValue(undefined)}
                          />
                        )}

                        {/* ── Server-side Excel filter (ColumnFilter component) ── */}
                        {serverSideFilters && header.column.getCanFilter() && !isLoading && (
                          <ColumnFilter
                            isOpen={openFilterCol === colId}
                            onOpen={() => setOpenFilterCol(colId)}
                            onClose={() => setOpenFilterCol(null)}
                            selectedValues={serverSideFilters.values[colId] ?? null}
                            fetchOptions={() => serverSideFilters.onFetchOptions(colId)}
                            onApply={(vals) => serverSideFilters.onChange(colId, vals)}
                            onClear={() => serverSideFilters.onChange(colId, null)}
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
                      'border-b border-slate-100 hover:bg-transparent',
                      ri % 2 === 0 ? 'bg-white' : 'bg-slate-50',
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
              {!isLoading && table.getRowModel().rows.length === 0 && (() => {
                const hasActiveFilters = serverSideFilters
                  ? Object.keys(serverSideFilters.values).length > 0
                  : columnFilters.length > 0
                return (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={columns.length} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <Database size={36} strokeWidth={1.5} className="text-slate-300" />
                        <div className="space-y-1">
                          <p className="text-[13px] font-medium text-slate-500">{emptyMessage}</p>
                          <p className="text-xs text-slate-400">
                            {hasActiveFilters
                              ? 'The active column filters exclude every row'
                              : 'There are no rows in this dataset'}
                          </p>
                        </div>
                        {hasActiveFilters && (
                          <button
                            onClick={() => {
                              if (serverSideFilters) {
                                for (const colId of Object.keys(serverSideFilters.values)) {
                                  serverSideFilters.onChange(colId, null)
                                }
                              } else {
                                table.resetColumnFilters()
                              }
                            }}
                            className="text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-300 hover:border-slate-400 bg-white px-3 py-1.5 rounded transition-colors duration-150"
                          >
                            Clear all filters
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })()}

              {/* Data rows — zebra + hover */}
              {!isLoading &&
                table.getRowModel().rows.map((row, i) => (
                  <TableRow
                    key={row.id}
                    className={clsx(
                      'border-b border-slate-100 transition-colors duration-75',
                      i % 2 === 0 ? 'bg-white hover:bg-slate-100' : 'bg-slate-50 hover:bg-slate-100',
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className="px-3 py-2 text-[13px] text-slate-700 max-w-[240px]"
                      >
                        <TruncatedCell fullText={String(cell.getValue() ?? '')}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TruncatedCell>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

            </tbody>
          </table>
        </div>

        {/* ── Pagination bar ── */}
        <div className="flex items-center justify-between text-[13px] text-slate-500">
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
              className="border border-slate-200 rounded px-2 py-1 text-[13px] text-slate-600 bg-white focus:outline-none focus:border-ey-yellow disabled:opacity-50"
            >
              {[50, 100, 200].map((sz) => (
                <option key={sz} value={sz}>{sz} / page</option>
              ))}
            </select>
            <button
              onClick={() => serverSide ? serverSide.onPageChange(serverSide.page - 1) : table.previousPage()}
              disabled={!canPrev || isLoading}
              className="px-2.5 py-1 border border-slate-200 rounded text-slate-600 disabled:opacity-40 hover:bg-slate-100 transition-colors"
            >
              ←
            </button>
            <span className="tabular-nums min-w-[3rem] text-center">
              {isLoading ? '–' : `${effectivePageIndex + 1} / ${effectivePageCount || 1}`}
            </span>
            <button
              onClick={() => serverSide ? serverSide.onPageChange(serverSide.page + 1) : table.nextPage()}
              disabled={!canNext || isLoading}
              className="px-2.5 py-1 border border-slate-200 rounded text-slate-600 disabled:opacity-40 hover:bg-slate-100 transition-colors"
            >
              →
            </button>
          </div>
        </div>

      </div>

    </TooltipProvider>
  )
}
