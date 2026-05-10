/**
 * Shared TypeScript types mirroring the backend Pydantic models.
 */

export type JobStatus = 'pending' | 'uploading' | 'validating' | 'running' | 'complete' | 'failed'

export interface JobResponse {
  job_id: string
  tool: string
  status: JobStatus
  progress: number
  progress_message: string
  created_at: string
  errors: string[]
  warnings: string[]
  results: Record<string, unknown>
}

export interface FilePreview {
  filename: string
  rows: number
  columns: string[]
  preview: Record<string, unknown>[]
  duplicates: number
  warnings: string[]
}

export interface UploadResponse {
  job_id: string
  files: Record<string, FilePreview>
  status: JobStatus
  errors: string[]
  warnings: string[]
}

export interface AnalysisResponse {
  job_id: string
  status: JobStatus
  summary: Record<string, unknown>
  errors: string[]
  warnings: string[]
}

export interface ErrorResponse {
  error: boolean
  message: string
  code: string
  details: string[]
}

// ── Tool-specific summary types ───────────────────────────────────────────────

export interface EntitlementMappingSummary {
  total_mappings: number
  exact_matches: number
  supersets: number
  partial_matches: number
  no_matches: number
}

export interface FPSheetSummary {
  sheet: string
  total: number
  fp_count: number
  sl_count: number
  tc_count: number
  reduction_pct: number
}

export interface FPAnalysisSummary {
  mode: string
  sheets_analyzed: string[]
  sheet_summaries: FPSheetSummary[]
}

export interface ComparisonTypeSummary {
  comp_type: string
  direction: string
  total: number
  matches: number
  missing: number
  match_rate: number
}

export interface OracleComparatorSummary {
  analysis_type: string
  env1_name: string
  env2_name: string
  comparisons: ComparisonTypeSummary[]
}

export interface ViolationCounts {
  role_sod: number
  role_sa: number
  user_sod: number
  user_sa: number
}

export interface SODSASummary {
  analysis_type: string
  violations: ViolationCounts
  total_roles_analyzed: number
  total_users_analyzed: number
}

export interface RulesetMappingSummary {
  sod_total: number
  sod_direct: number
  sod_derived: number
  sod_unmatched: number
  sa_total: number
  sa_direct: number
  sa_derived: number
  sa_unmatched: number
  ent_total: number
}
