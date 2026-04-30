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
api.interceptors.request.use((config) => {
  config.headers['X-Request-ID'] = crypto.randomUUID()
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
    const isNetworkError = !error.response
    const is5xx = error.response?.status >= 500

    if ((isNetworkError || is5xx) && config) {
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

// ── Upload helper ─────────────────────────────────────────────────────────────

/** POST FormData with real-time upload progress reporting. Default timeout 60 s. */
export async function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress: (percent: number) => void,
  timeout = 60_000,
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

/** GET a blob and trigger a browser file-download via a temporary <a> element. */
export async function downloadFile(url: string, filename: string): Promise<void> {
  try {
    const response = await api.get(url, { responseType: 'blob', timeout: 300_000 })
    const blobUrl = URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(blobUrl)
  } catch {
    toast.error('Download failed. Please try again.')
    throw new Error('Download failed')
  }
}

export default api
