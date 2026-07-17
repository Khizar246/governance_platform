import api, { appendFilterParams, uploadWithProgress, downloadFile } from './client'
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

export type ResultTab = 'sod' | 'sa' | 'ent' | 'missing_ctrl' | 'missing_priv'
export type Direction = 'c2e' | 'e2c'

export async function getResults(
  jobId: string,
  params: {
    page: number
    pageSize: number
    tab: ResultTab
    direction: Direction
    filters?: Record<string, string[]>
  },
): Promise<ResultsPage> {
  const queryParams: Record<string, string | number> = {
    page: params.page,
    page_size: params.pageSize,
    tab: params.tab,
    direction: params.direction,
  }
  appendFilterParams(queryParams, params.filters ?? {})
  const response = await api.get(`/api/ruleset-mapping/results/${jobId}`, { params: queryParams })
  return response.data
}

export async function getFilterOptions(
  jobId: string,
  tab: ResultTab,
  direction: Direction,
  column: string,
  otherFilters: Record<string, string[]>,
): Promise<string[]> {
  const params: Record<string, string> = { column, tab, direction }
  appendFilterParams(params, otherFilters)
  const response = await api.get(`/api/ruleset-mapping/filter-options/${jobId}`, { params })
  return response.data.values
}
