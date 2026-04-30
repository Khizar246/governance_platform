import { useState, useCallback } from 'react'
import { formatFileSize } from '../utils/formatters'
import { MAX_UPLOAD_SIZE_MB, ALLOWED_EXTENSIONS } from '../utils/constants'

export type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

export interface UploadState {
  status: UploadStatus
  progress: number
  error: string
  file: File | null
}

const INITIAL_STATE: UploadState = {
  status: 'idle',
  progress: 0,
  error: '',
  file: null,
}

/** Client-side file upload state and validation helper. */
export function useFileUpload() {
  const [state, setState] = useState<UploadState>(INITIAL_STATE)

  /** Validate a File before sending to server. Returns an error string or null. */
  const validate = useCallback((file: File): string | null => {
    const ext = ('.' + file.name.split('.').pop()?.toLowerCase()) as typeof ALLOWED_EXTENSIONS[number]
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `Invalid file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
    }
    if (file.size > MAX_UPLOAD_SIZE_MB * 1024 * 1024) {
      return `File too large (${formatFileSize(file.size)}). Maximum allowed: ${MAX_UPLOAD_SIZE_MB} MB`
    }
    return null
  }, [])

  const reset = useCallback(() => setState(INITIAL_STATE), [])

  const setProgress = useCallback((progress: number) =>
    setState((prev) => ({ ...prev, progress, status: 'uploading' })), [])

  const setSuccess = useCallback((file: File) =>
    setState({ status: 'success', progress: 100, error: '', file }), [])

  const setError = useCallback((error: string) =>
    setState((prev) => ({ ...prev, status: 'error', error, progress: 0 })), [])

  return { state, setState, validate, reset, setProgress, setSuccess, setError }
}
