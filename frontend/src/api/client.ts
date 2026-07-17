import axios, { type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { toast } from 'sonner'

// Extend Axios config to carry per-request retry state
interface RetryConfig extends InternalAxiosRequestConfig {
  _retryCount?: number
}

const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 30_000,
})

// ── Request interceptor: attach tracing ID ───────────────────────────────────
// crypto.randomUUID only exists in secure contexts (https / localhost); over
// plain http on a LAN IP it is undefined and would throw on EVERY request.
const newRequestId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

api.interceptors.request.use((config) => {
  // Retries reuse the same config object — keep the original ID so all
  // attempts of one request correlate in the backend logs.
  if (!config.headers['X-Request-ID']) {
    config.headers['X-Request-ID'] = newRequestId()
  }
  return config
})

// ── Response interceptor: retry on 5xx / network + surface errors ────────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config as RetryConfig | undefined

    // Determine whether this failure is retryable:
    //   - Network error (no response object)
    //   - 5xx server error
    // 4xx errors are NOT retried (client error, retrying won't help).
    // Only GETs are retried: a POST (upload, /run) may have reached the server
    // even though the response was lost — retrying it would start a duplicate
    // analysis thread on the same job.
    const isNetworkError = !error.response
    const is5xx = error.response?.status >= 500
    const isIdempotent = (config?.method ?? 'get').toLowerCase() === 'get'

    if ((isNetworkError || is5xx) && config && isIdempotent) {
      config._retryCount = config._retryCount ?? 0

      if (config._retryCount < 2) {
        config._retryCount += 1
        // Exponential backoff: 1 s on first retry, 3 s on second
        const backoffMs = config._retryCount === 1 ? 1_000 : 3_000
        await new Promise((resolve) => setTimeout(resolve, backoffMs))
        return api(config)
      }
    }

    // Retries exhausted (or non-retryable) — surface the error as a toast
    if (isNetworkError) {
      toast.error('Unable to connect to the server. Check that the backend is running.')
    } else if (is5xx) {
      toast.error(error.response.data?.message || 'A server error occurred. Please try again.')
    }

    return Promise.reject(error)
  },
)

// ── Column-filter query encoding ──────────────────────────────────────────────

/** Append active column filters to a request's query params.
 *  Each filter is JSON-encoded (`col=["A","B, C",""]`) so empty strings (the
 *  [Empty] option), commas inside values, and the empty exclude-all selection
 *  (`[]`) all survive the round-trip. A column with no filter has no param —
 *  that absence (not an empty array) is what means "don't filter this column".
 *  Must stay in sync with backend/shared/query_filters.py. */
export function appendFilterParams(
  params: Record<string, string | number>,
  filters: Record<string, string[]>,
): void {
  for (const [col, vals] of Object.entries(filters)) {
    if (Array.isArray(vals)) params[col] = JSON.stringify(vals)
  }
}

// ── Upload helper ─────────────────────────────────────────────────────────────

/** POST FormData with real-time upload progress reporting. Default timeout 5 min
 *  (uploads up to 200 MB on slow office networks easily exceed 60 s). */
export async function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress: (percent: number) => void,
  timeout = 300_000,
): Promise<AxiosResponse> {
  return api.post(url, formData, {
    timeout,
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (event) => {
      if (event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    },
  })
}

// ── Download helper ───────────────────────────────────────────────────────────

/** Trigger a native browser download by anchoring directly at the file URL.
 *  We deliberately do NOT fetch the file into a JS blob first: result workbooks
 *  can be hundreds of MB, and buffering the whole response in memory (plus the
 *  extra Blob copy) stalls/OOMs the tab so nothing ever saves. The backend sends
 *  `Content-Disposition: attachment`, so the browser streams straight to disk
 *  with its own progress UI.
 *
 *  The anchor click itself yields no success/failure signal, so the job's
 *  lightweight /status sibling is probed first (every tool's download URL is
 *  `/api/{tool}/download/{job_id}`) — an expired/purged job rejects here
 *  instead of flashing "Downloaded!" on a dead link. A failure between the
 *  probe and the click is still invisible; that window is milliseconds. */
export async function downloadFile(url: string, filename: string): Promise<void> {
  const { data } = await api.get(url.replace('/download/', '/status/'))
  if (data?.status !== 'complete') {
    throw new Error('Results are no longer available for this run.')
  }
  const base = import.meta.env.VITE_API_URL || ''
  const link = document.createElement('a')
  link.href = `${base}${url}`
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export default api
