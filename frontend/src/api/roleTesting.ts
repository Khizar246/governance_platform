import api, { downloadFile } from './client'
import type { AnalysisResponse, JobResponse, RoleTestingSummary } from '../types'

export interface RoleTestingRunConfig {
  url: string
  username: string
  password: string
  max_elements?: number | null
  overall_timeout_seconds?: number | null
}

/** Start the bot. Credentials are sent once and never stored by the platform. */
export async function runBot(config: RoleTestingRunConfig): Promise<AnalysisResponse> {
  const response = await api.post('/api/role-testing/run', config, { timeout: 60_000 })
  return response.data
}

export async function getStatus(jobId: string): Promise<JobResponse> {
  const response = await api.get(`/api/role-testing/status/${jobId}`)
  return response.data
}

export async function getResults(jobId: string): Promise<RoleTestingSummary> {
  const response = await api.get(`/api/role-testing/results/${jobId}`)
  return response.data
}

/** URL for an individual screenshot, used directly as an <img src>. */
export function imageUrl(jobId: string, filename: string): string {
  const base = import.meta.env.VITE_API_URL || ''
  return `${base}/api/role-testing/image/${jobId}/${encodeURIComponent(filename)}`
}

export async function downloadZip(jobId: string, filename: string): Promise<void> {
  return downloadFile(`/api/role-testing/download/${jobId}`, filename)
}

export async function cancelJob(jobId: string): Promise<void> {
  await api.delete(`/api/role-testing/job/${jobId}`)
}
