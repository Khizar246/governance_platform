/** Route path constants used in App.tsx and Sidebar nav items. */
export const ROUTES = {
  HOME: '/',
  ENTITLEMENT_MAPPING: '/entitlement-mapping',
  FP_ANALYSIS: '/fp-analysis',
  ORACLE_COMPARATOR: '/oracle-comparator',
  SOD_SA: '/sod-sa',
} as const

/** Tool metadata for home page cards and sidebar nav. */
export const TOOL_META = [
  {
    id: 'entitlement-mapping',
    title: 'Entitlement Mapping',
    description:
      'Map client entitlements to EY rulesets using privilege overlap, Jaccard similarity, and name matching.',
    route: ROUTES.ENTITLEMENT_MAPPING,
    icon: 'Link',
    accentClass: 'border-ey-yellow',
    iconColorClass: 'text-ey-yellow',
  },
  {
    id: 'fp-analysis',
    title: 'False Positive Analysis',
    description:
      '3-level FP classification (FP / Single Leg / True Conflict) at privilege or entitlement level.',
    route: ROUTES.FP_ANALYSIS,
    icon: 'Target',
    accentClass: 'border-info',
    iconColorClass: 'text-info',
  },
  {
    id: 'oracle-comparator',
    title: 'Oracle Comparator',
    description:
      'Compare duty roles, privileges, and data security policies across Oracle environments.',
    route: ROUTES.ORACLE_COMPARATOR,
    icon: 'Search',
    accentClass: 'border-success',
    iconColorClass: 'text-success',
  },
  {
    id: 'sod-sa',
    title: 'SOD & SA Analysis',
    description:
      'Segregation of Duties and Sensitive Access violation detection at role and user level.',
    route: ROUTES.SOD_SA,
    icon: 'Shield',
    accentClass: 'border-warning',
    iconColorClass: 'text-warning',
  },
] as const

export const MAX_UPLOAD_SIZE_MB = 200
export const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'] as const
export const POLL_INTERVAL_MS = 1500
