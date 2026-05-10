import api, { uploadWithProgress, downloadFile } from './client'
import type { UploadResponse, AnalysisResponse, JobResponse } from '../types'

export interface OracleUploadConfig {
  rbacFile1?: File
  rbacFile2?: File
  dspFile1?: File
  dspFile2?: File
  env1Name: string
  env2Name: string
  analysisType: 'rbac' | 'dsp' | 'both'
}

export interface OracleRunConfig {
  analysis_type: 'rbac' | 'dsp' | 'both'
  env1_name: string
  env2_name: string
}

export async function uploadFiles(
  config: OracleUploadConfig,
  onProgress: (p: number) => void,
): Promise<UploadResponse> {
  const formData = new FormData()
  if (config.rbacFile1) formData.append('rbac_file1', config.rbacFile1)
  if (config.rbacFile2) formData.append('rbac_file2', config.rbacFile2)
  if (config.dspFile1) formData.append('dsp_file1', config.dspFile1)
  if (config.dspFile2) formData.append('dsp_file2', config.dspFile2)
  formData.append('env1_name', config.env1Name)
  formData.append('env2_name', config.env2Name)
  formData.append('analysis_type', config.analysisType)
  const response = await uploadWithProgress('/api/oracle-comparator/upload', formData, onProgress)
  return response.data
}

export async function runAnalysis(jobId: string, config: OracleRunConfig): Promise<AnalysisResponse> {
  const response = await api.post(`/api/oracle-comparator/run/${jobId}`, config, { timeout: 300_000 })
  return response.data
}

export async function getStatus(jobId: string): Promise<JobResponse> {
  const response = await api.get(`/api/oracle-comparator/status/${jobId}`)
  return response.data
}

export async function downloadResults(jobId: string, filename: string): Promise<void> {
  return downloadFile(`/api/oracle-comparator/download/${jobId}`, filename)
}

export async function cancelJob(jobId: string): Promise<void> {
  await api.delete(`/api/oracle-comparator/job/${jobId}`)
}

export interface OracleResultsResponse {
  rows: Record<string, unknown>[]
  total: number
  page: number
  page_size: number
}

export async function getResults(
  jobId: string,
  direction: '1to2' | '2to1',
  compType: string,
  page: number,
  pageSize: number,
  statusFilter?: string,
  search?: string,
  filters: Record<string, string[]> = {},
): Promise<OracleResultsResponse> {
  const params: Record<string, string | number> = {
    direction,
    comparison_type: compType,
    page,
    page_size: pageSize,
  }
  if (statusFilter) params.status_filter = statusFilter
  if (search) params.search = search
  for (const [col, vals] of Object.entries(filters)) {
    if (vals.length > 0) params[col] = vals.join(',')
  }
  const response = await api.get(`/api/oracle-comparator/results/${jobId}`, { params })
  return response.data
}

export async function getFilterOptions(
  jobId: string,
  direction: '1to2' | '2to1',
  compType: string,
  column: string,
  otherFilters: Record<string, string[]>,
): Promise<string[]> {
  const params: Record<string, string> = { column, direction, comparison_type: compType }
  for (const [col, vals] of Object.entries(otherFilters)) {
    if (vals.length > 0) params[col] = vals.join(',')
  }
  const response = await api.get(`/api/oracle-comparator/filter-options/${jobId}`, { params })
  return response.data.values
}
