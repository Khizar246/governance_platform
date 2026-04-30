import { useRef, useState } from 'react'
import { Upload, CheckCircle, XCircle, X, Loader2, File } from 'lucide-react'
import { clsx } from 'clsx'
import { formatFileSize } from '../../utils/formatters'
import { ALLOWED_EXTENSIONS, MAX_UPLOAD_SIZE_MB } from '../../utils/constants'

export type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

interface FileInfo {
  name: string
  size: number
  rows?: number
  columns?: number
}

interface FileUploadProps {
  label: string
  accept?: string
  hint?: string
  maxSizeMB?: number
  status: UploadStatus
  progress?: number
  error?: string
  fileInfo?: FileInfo | null
  onUpload: (file: File) => void
  onRemove: () => void
}

/** Drag-and-drop file upload zone with 5 visual states. */
export default function FileUpload({
  label,
  accept = ALLOWED_EXTENSIONS.join(','),
  hint,
  maxSizeMB = MAX_UPLOAD_SIZE_MB,
  status,
  progress = 0,
  error,
  fileInfo,
  onUpload,
  onRemove,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFile = (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext as typeof ALLOWED_EXTENSIONS[number])) {
      return
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      return
    }
    onUpload(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  if (status === 'success' && fileInfo) {
    return (
      <div className="border border-success/40 bg-success-light/30 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <CheckCircle size={18} className="text-success mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">{fileInfo.name}</p>
            <p className="text-[13px] text-gray-500 mt-0.5">
              {fileInfo.rows != null && `${fileInfo.rows.toLocaleString()} rows · `}
              {fileInfo.columns != null && `${fileInfo.columns} columns · `}
              {formatFileSize(fileInfo.size)}
            </p>
          </div>
          <button
            onClick={onRemove}
            className="text-gray-400 hover:text-error transition-colors duration-150 p-0.5 rounded"
            title="Remove file"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="border border-error/40 bg-error-light/30 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <XCircle size={18} className="text-error mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-error">Upload failed</p>
            {error && <p className="text-[13px] text-error/80 mt-0.5">{error}</p>}
          </div>
          <button className="btn-secondary text-xs py-1 px-2" onClick={() => inputRef.current?.click()}>
            Retry
          </button>
        </div>
        <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }} />
      </div>
    )
  }

  if (status === 'uploading') {
    return (
      <div className="border border-gray-300 rounded-lg p-4">
        <div className="flex items-center gap-3 mb-2">
          <Loader2 size={16} className="text-ey-yellow animate-spin shrink-0" />
          <span className="text-sm text-gray-600">Uploading… {progress}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-1 overflow-hidden">
          <div
            className="h-full bg-ey-yellow transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        {fileInfo && (
          <p className="text-[13px] text-gray-400 mt-1.5 truncate">{fileInfo.name} · {formatFileSize(fileInfo.size)}</p>
        )}
      </div>
    )
  }

  // Idle state
  return (
    <div
      className={clsx(
        'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors duration-150',
        dragging
          ? 'border-ey-yellow bg-[rgba(255,230,0,0.04)]'
          : 'border-gray-300 hover:border-gray-400 bg-gray-50',
      )}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <Upload size={24} className="text-gray-400 mx-auto mb-2" />
      <p className="text-sm font-medium text-gray-600">Upload {label}</p>
      <p className="text-[13px] text-gray-400 mt-0.5">Drag &amp; drop or click to browse</p>
      {hint && <p className="text-[12px] text-gray-400 mt-1">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
      />
    </div>
  )
}
