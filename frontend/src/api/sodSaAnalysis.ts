import api, { uploadWithProgress, downloadFile } from './client'
import type { UploadResponse, AnalysisResponse, JobResponse } from '../types'

export interface SODSARunConfig {
  analysis_type: 'role' | 'user' | 'both'
  with_fp?: boolean
  selected_analyses?: string[]
}

export interface SODSASheetCount {
  total_violations: number
  unique_roles?: number
  unique_users?: number
}

export interface SODSATopItem {
  name: string
  count: number
}

export interface SODSASummaryData {
  sheet_counts: Record<string, SODSASheetCount>
  top_roles_sod?: SODSATopItem[]
  top_users_sod?: SODSATopItem[]
  top_sod_controls?: SODSATopItem[]
  top_sa_controls?: SODSATopItem[]
}

export interface SODSASheetPage {
  data: Record<string, unknown>[]
  total: number
  page: number
  page_size: number
  sheet: string
}

export async function uploadFiles(
  roleHierarchy: File,
  ruleset: File,
  userRole: File | null,
  fpDb: File | null,
  onProgress: (p: number) => void,
): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append('role_hierarchy', roleHierarchy)
  formData.append('ruleset', ruleset)
  if (userRole) formData.append('user_role', userRole)
  if (fpDb) formData.append('fp_db', fpDb)
  const response = await uploadWithProgress('/api/sod-sa/upload', formData, onProgress)
  return response.data
}

export async function runAnalysis(jobId: string, config: SODSARunConfig): Promise<AnalysisResponse> {
  const response = await api.post(`/api/sod-sa/run/${jobId}`, config, { timeout: 300_000 })
  return response.data
}

export async function getStatus(jobId: string): Promise<JobResponse> {
  const response = await api.get(`/api/sod-sa/status/${jobId}`)
  return response.data
}

export async function getSummary(jobId: string): Promise<SODSASummaryData> {
  const response = await api.get(`/api/sod-sa/summary/${jobId}`)
  return response.data
}

export async function getSheetResults(
  jobId: string,
  sheet: string,
  page: number,
  pageSize: number,
  search: string,
  filters: Record<string, string[]> = {},
): Promise<SODSASheetPage> {
  const params: Record<string, string | number> = { sheet, page, page_size: pageSize }
  if (search) params.search = search
  for (const [col, vals] of Object.entries(filters)) {
    if (vals.length > 0) params[col] = vals.join(',')
  }
  const response = await api.get(`/api/sod-sa/results/${jobId}`, { params })
  return response.data
}

export async function getFilterOptions(
  jobId: string,
  sheet: string,
  column: string,
  otherFilters: Record<string, string[]>,
): Promise<string[]> {
  const params: Record<string, string> = { column, sheet }
  for (const [col, vals] of Object.entries(otherFilters)) {
    if (vals.length > 0) params[col] = vals.join(',')
  }
  const response = await api.get(`/api/sod-sa/filter-options/${jobId}`, { params })
  return response.data.values
}

export async function downloadResults(jobId: string, filename: string): Promise<void> {
  return downloadFile(`/api/sod-sa/download/${jobId}`, filename)
}

export async function cancelJob(jobId: string): Promise<void> {
  await api.delete(`/api/sod-sa/job/${jobId}`)
}
