import api, { uploadWithProgress, downloadFile } from './client'
import type { UploadResponse, AnalysisResponse, JobResponse } from '../types'

export async function uploadFiles(
  clientFile: File,
  eyFile: File,
  onProgress: (p: number) => void,
): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append('client_file', clientFile)
  formData.append('ey_file', eyFile)
  const response = await uploadWithProgress('/api/ruleset-mapping/upload', formData, onProgress)
  return response.data
}

export async function runAnalysis(jobId: string): Promise<AnalysisResponse> {
  const response = await api.post(`/api/ruleset-mapping/run/${jobId}`, {}, { timeout: 300_000 })
  return response.data
}

export async function getStatus(jobId: string): Promise<JobResponse> {
  const response = await api.get(`/api/ruleset-mapping/status/${jobId}`)
  return response.data
}

export async function downloadResults(jobId: string, filename: string): Promise<void> {
  return downloadFile(`/api/ruleset-mapping/download/${jobId}`, filename)
}

export async function cancelJob(jobId: string): Promise<void> {
  await api.delete(`/api/ruleset-mapping/job/${jobId}`)
}

export interface ResultsPage {
  data: Record<string, unknown>[]
  total: number
  page: number
  page_size: number
}

export type ResultTab = 'sod' | 'sa' | 'ent'

export async function getResults(
  jobId: string,
  params: {
    page: number
    pageSize: number
    tab: ResultTab
    filters?: Record<string, string[]>
  },
): Promise<ResultsPage> {
  const queryParams: Record<string, string | number> = {
    page: params.page,
    page_size: params.pageSize,
    tab: params.tab,
  }
  for (const [col, vals] of Object.entries(params.filters ?? {})) {
    if (vals.length > 0) queryParams[col] = vals.join(',')
  }
  const response = await api.get(`/api/ruleset-mapping/results/${jobId}`, { params: queryParams })
  return response.data
}

export async function getFilterOptions(
  jobId: string,
  tab: ResultTab,
  column: string,
  otherFilters: Record<string, string[]>,
): Promise<string[]> {
  const params: Record<string, string> = { column, tab }
  for (const [col, vals] of Object.entries(otherFilters)) {
    if (vals.length > 0) params[col] = vals.join(',')
  }
  const response = await api.get(`/api/ruleset-mapping/filter-options/${jobId}`, { params })
  return response.data.values
}
