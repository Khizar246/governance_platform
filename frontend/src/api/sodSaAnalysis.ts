import api, { uploadWithProgress, downloadFile } from './client'
import type { UploadResponse, AnalysisResponse, JobResponse } from '../types'

export interface SODSARunConfig {
  analysis_type: 'role' | 'user' | 'both'
}

export async function uploadFiles(
  roleHierarchy: File,
  ruleset: File,
  userRole: File | null,
  onProgress: (p: number) => void,
): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append('role_hierarchy', roleHierarchy)
  formData.append('ruleset', ruleset)
  if (userRole) formData.append('user_role', userRole)
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

export async function downloadResults(jobId: string, filename: string): Promise<void> {
  return downloadFile(`/api/sod-sa/download/${jobId}`, filename)
}

export async function cancelJob(jobId: string): Promise<void> {
  await api.delete(`/api/sod-sa/job/${jobId}`)
}
