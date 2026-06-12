/** Route path constants used in App.tsx and Sidebar nav items. */
export const ROUTES = {
  HOME: '/',
  ORACLE_COMPARATOR: '/oracle-comparator',
  SOD_SA: '/sod-sa',
  RULESET_MAPPING: '/ruleset-mapping',
} as const

export const MAX_UPLOAD_SIZE_MB = 200
export const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'] as const
export const POLL_INTERVAL_MS = 1500
