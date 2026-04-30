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
