/** Route path constants used in App.tsx and Sidebar nav items. */
export const ROUTES = {
  HOME: '/',
  FP_ANALYSIS: '/fp-analysis',
  ORACLE_COMPARATOR: '/oracle-comparator',
  SOD_SA: '/sod-sa',
  RULESET_MAPPING: '/ruleset-mapping',
} as const

/** Tool metadata for home page cards and sidebar nav. */
export const TOOL_META = [
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
  {
    id: 'ruleset-mapping',
    title: 'Ruleset Mapping',
    description:
      'Map client SoD and SA ruleset controls to EY controls using privilege-set Jaccard similarity.',
    route: ROUTES.RULESET_MAPPING,
    icon: 'GitMerge',
    accentClass: 'border-purple-400',
    iconColorClass: 'text-purple-400',
  },
] as const

export const MAX_UPLOAD_SIZE_MB = 200
export const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'] as const
export const POLL_INTERVAL_MS = 1500
