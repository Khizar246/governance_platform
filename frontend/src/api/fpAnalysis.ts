import api, { uploadWithProgress, downloadFile } from './client'
import type { UploadResponse, AnalysisResponse, JobResponse } from '../types'

export interface FPRunConfig {
  mode: 'privilege' | 'entitlement'
  sheets: string[]
}

export async function uploadFiles(
  sodFile: File,
  fpDbFile: File,
  onProgress: (p: number) => void,
): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append('sod_file', sodFile)
  formData.append('fp_db_file', fpDbFile)
  const response = await uploadWithProgress('/api/fp-analysis/upload', formData, onProgress)
  return response.data
}

export async function runAnalysis(jobId: string, config: FPRunConfig): Promise<AnalysisResponse> {
  const response = await api.post(`/api/fp-analysis/run/${jobId}`, config, { timeout: 300_000 })
  return response.data
}

export async function getStatus(jobId: string): Promise<JobResponse> {
  const response = await api.get(`/api/fp-analysis/status/${jobId}`)
  return response.data
}

export async function downloadResults(jobId: string, filename: string): Promise<void> {
  return downloadFile(`/api/fp-analysis/download/${jobId}`, filename)
}

export async function cancelJob(jobId: string): Promise<void> {
  await api.delete(`/api/fp-analysis/job/${jobId}`)
}

export interface SheetResultsResponse {
  data: Record<string, unknown>[]
  total: number
  page: number
  page_size: number
  sheet: string
}

export async function getSheetResults(
  jobId: string,
  sheet: string,
  page: number,
  pageSize: number,
  search: string,
  fpFilter: string,
  filters: Record<string, string[]> = {},
): Promise<SheetResultsResponse> {
  const params: Record<string, string | number> = { sheet, page, page_size: pageSize }
  if (search) params.search = search
  if (fpFilter) params.fp_filter = fpFilter
  for (const [col, vals] of Object.entries(filters)) {
    if (vals.length > 0) params[col] = vals.join(',')
  }
  const response = await api.get(`/api/fp-analysis/results/${jobId}`, { params })
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
  const response = await api.get(`/api/fp-analysis/filter-options/${jobId}`, { params })
  return response.data.values
}
