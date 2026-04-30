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
} from '@tanstack/react-table'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { clsx } from 'clsx'

interface DataTableProps<T> {
  data: T[]
  columns: ColumnDef<T>[]
  defaultPageSize?: number
  emptyMessage?: string
  /** Max height for the scrollable body (enables sticky header). Default 520px. */
  maxHeight?: string
}

/** Full-featured sortable/filterable/paginated data table using TanStack Table v8.
 *
 *  - Sticky header within the scrollable container
 *  - Zebra striping: white / gray-100 alternating rows
 *  - Global search filter
 *  - Pagination: 25 / 50 / 100 page sizes
 *  - Min column width 100 px; long text truncates with native title tooltip
 */
export default function DataTable<T>({
  data,
  columns,
  defaultPageSize = 50,
  emptyMessage = 'No data to display',
  maxHeight = '520px',
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
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
    <div className="flex flex-col gap-3">
      {/* ── Global filter ── */}
      <div className="flex justify-end">
        <input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search all columns…"
          className="text-sm border border-gray-300 rounded px-3 py-1.5 w-64 focus:outline-none focus:border-ey-yellow"
        />
      </div>

      {/* ── Table with scrollable body and sticky header ── */}
      <div
        className="overflow-auto border border-gray-200 rounded"
        style={{ maxHeight }}
      >
        <table className="w-full text-sm border-collapse">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{ minWidth: 100 }}
                    className={clsx(
                      // Sticky — sticks to top of THIS scrollable container
                      'sticky top-0 z-10',
                      'bg-gray-50 border-b border-gray-200',
                      'px-3 py-2.5 text-left text-[12px] font-medium text-gray-500',
                      'uppercase tracking-wide whitespace-nowrap select-none',
                      header.column.getCanSort() && 'cursor-pointer hover:text-gray-700',
                    )}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <span className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && (
                        <span className="text-gray-400 shrink-0">
                          {header.column.getIsSorted() === 'asc' ? (
                            <ChevronUp size={12} />
                          ) : header.column.getIsSorted() === 'desc' ? (
                            <ChevronDown size={12} />
                          ) : (
                            <ChevronsUpDown size={12} />
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="text-center text-sm text-gray-400 py-12"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, i) => (
                <tr
                  key={row.id}
                  className={clsx(
                    'border-b border-gray-100 hover:bg-gray-200 transition-colors duration-75',
                    i % 2 === 0 ? 'bg-white' : 'bg-gray-100',
                  )}
                >
                  {row.getVisibleCells().map((cell) => {
                    const raw = String(cell.getValue() ?? '')
                    return (
                      <td
                        key={cell.id}
                        className="px-3 py-2 text-[13px] text-gray-600 max-w-[300px] truncate"
                        title={raw}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination bar ── */}
      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            Showing {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-ey-yellow"
            >
              {[25, 50, 100].map((sz) => (
                <option key={sz} value={sz}>{sz} / page</option>
              ))}
            </select>
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="px-2 py-1 border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-100 transition-colors"
            >
              ←
            </button>
            <span className="px-1 tabular-nums">
              {pageIndex + 1} / {table.getPageCount() || 1}
            </span>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="px-2 py-1 border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-100 transition-colors"
            >
              →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
