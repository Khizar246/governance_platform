import { useState } from 'react'
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
} from '@tanstack/react-table'
import { ChevronUp, ChevronDown, ChevronsUpDown, Database } from 'lucide-react'
import { clsx } from 'clsx'
import { TableHead, TableRow, TableCell } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'

const SKELETON_ROWS = 8

interface DataTableProps<T> {
  data: T[]
  columns: ColumnDef<T>[]
  defaultPageSize?: number
  emptyMessage?: string
  /** Max height for the scrollable body (enables sticky header). Default 520px. */
  maxHeight?: string
  isLoading?: boolean
}

export default function DataTable<T>({
  data,
  columns,
  defaultPageSize = 50,
  emptyMessage = 'No data to display',
  maxHeight = '520px',
  isLoading = false,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: defaultPageSize } },
  })

  const { pageIndex, pageSize } = table.getState().pagination
  const total = table.getFilteredRowModel().rows.length
  const start = total === 0 ? 0 : pageIndex * pageSize + 1
  const end = Math.min(start + pageSize - 1, total)

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col gap-3">

        {/* ── Scrollable table ── */}
        <div
          className="overflow-auto rounded-lg border border-gray-200"
          style={{ maxHeight }}
        >
          <table className="w-full text-sm">

            {/* ── Sticky header ── */}
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="hover:bg-transparent">
                  {hg.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      style={{ minWidth: 120 }}
                      className="sticky top-0 z-10 h-auto bg-gray-50 border-b border-gray-200 px-3 pt-2.5 pb-1.5 align-top"
                    >
                      {/* Column label + sort arrow */}
                      <div
                        className={clsx(
                          'flex items-center gap-1 select-none whitespace-nowrap',
                          'text-[11px] font-semibold text-gray-500 uppercase tracking-[0.05em]',
                          header.column.getCanSort() && 'cursor-pointer hover:text-gray-700',
                          header.column.getCanFilter() ? 'mb-1.5' : '',
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

                      {/* Per-column filter input */}
                      {header.column.getCanFilter() && !isLoading && (
                        <input
                          value={(header.column.getFilterValue() as string) ?? ''}
                          onChange={(e) => header.column.setFilterValue(e.target.value)}
                          placeholder="Filter…"
                          onClick={(e) => e.stopPropagation()}
                          className={clsx(
                            'w-full h-6 rounded border border-gray-200 bg-white',
                            'px-2 text-[11px] text-gray-700 placeholder-gray-400',
                            'focus:outline-none focus:border-ey-yellow transition-colors',
                          )}
                        />
                      )}
                    </TableHead>
                  ))}
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
                          className="h-3.5 rounded"
                          style={{ width: `${45 + ((ri * 7 + ci * 13) % 45)}%` }}
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
              : total === 0
              ? 'No results'
              : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()} rows`}
          </span>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
              disabled={isLoading}
              className="border border-gray-200 rounded px-2 py-1 text-[13px] text-gray-600 bg-white focus:outline-none focus:border-ey-yellow disabled:opacity-50"
            >
              {[25, 50, 100].map((sz) => (
                <option key={sz} value={sz}>{sz} / page</option>
              ))}
            </select>
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage() || isLoading}
              className="px-2.5 py-1 border border-gray-200 rounded text-gray-600 disabled:opacity-40 hover:bg-gray-100 transition-colors"
            >
              ←
            </button>
            <span className="tabular-nums min-w-[3rem] text-center">
              {isLoading ? '–' : `${pageIndex + 1} / ${table.getPageCount() || 1}`}
            </span>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage() || isLoading}
              className="px-2.5 py-1 border border-gray-200 rounded text-gray-600 disabled:opacity-40 hover:bg-gray-100 transition-colors"
            >
              →
            </button>
          </div>
        </div>

      </div>
    </TooltipProvider>
  )
}
