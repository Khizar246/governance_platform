import { format } from 'date-fns'

/** Format a number with thousands separators: 1247 → "1,247" */
export function formatNumber(n: number): string {
  return n.toLocaleString()
}

/** Format bytes as a human-readable size string. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Format an ISO date string for display. */
export function formatTimestamp(isoString: string): string {
  try {
    return format(new Date(isoString), 'MMM d, yyyy HH:mm')
  } catch {
    return isoString
  }
}

/** Format a decimal (0–1) as a percentage string with given decimal places. */
export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

/** Truncate a string to maxLen characters with an ellipsis. */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + '…'
}
