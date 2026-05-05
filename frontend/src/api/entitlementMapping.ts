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
  const response = await uploadWithProgress('/api/entitlement-mapping/upload', formData, onProgress)
  return response.data
}

export async function runAnalysis(jobId: string): Promise<AnalysisResponse> {
  const response = await api.post(`/api/entitlement-mapping/run/${jobId}`, {}, { timeout: 300_000 })
  return response.data
}

export async function getStatus(jobId: string): Promise<JobResponse> {
  const response = await api.get(`/api/entitlement-mapping/status/${jobId}`)
  return response.data
}

export async function downloadResults(jobId: string, filename: string): Promise<void> {
  return downloadFile(`/api/entitlement-mapping/download/${jobId}`, filename)
}

export async function cancelJob(jobId: string): Promise<void> {
  await api.delete(`/api/entitlement-mapping/job/${jobId}`)
}

export interface ResultsPage {
  data: Record<string, unknown>[]
  total: number
  page: number
  page_size: number
}

export async function getResults(
  jobId: string,
  params: {
    page: number
    pageSize: number
    tab: string
    clientFilter?: string
    eyFilter?: string
    confidence?: string
    pmcFilter?: string
    jaccardFilter?: string
    runnerUpFilter?: string
  },
): Promise<ResultsPage> {
  const response = await api.get(`/api/entitlement-mapping/results/${jobId}`, {
    params: {
      page: params.page,
      page_size: params.pageSize,
      tab: params.tab,
      client_filter: params.clientFilter ?? '',
      ey_filter: params.eyFilter ?? '',
      confidence: params.confidence ?? '',
      pmc_filter: params.pmcFilter ?? '',
      jaccard_filter: params.jaccardFilter ?? '',
      runner_up_filter: params.runnerUpFilter ?? '',
    },
  })
  return response.data
}
