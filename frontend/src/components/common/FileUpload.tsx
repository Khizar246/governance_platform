import { useCallback, useRef, type CSSProperties } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, CheckCircle2, XCircle, X, FileText } from 'lucide-react'
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

const DROPZONE_ACCEPT = {
  'text/csv': ['.csv'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
}

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
  const retryRef = useRef<HTMLInputElement>(null)

  const onDrop = useCallback(
    (accepted: File[]) => { if (accepted[0]) onUpload(accepted[0]) },
    [onUpload],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: DROPZONE_ACCEPT,
    maxSize: maxSizeMB * 1024 * 1024,
    multiple: false,
  })

  /* ── SUCCESS ─────────────────────────────────────── */
  if (status === 'success' && fileInfo) {
    return (
      <div className="fade-in border border-green-200 bg-green-50 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={18} className="text-green-600 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{fileInfo.name}</p>
            <p className="text-[13px] text-gray-500 mt-0.5">
              {fileInfo.rows != null && `${fileInfo.rows.toLocaleString()} rows · `}
              {fileInfo.columns != null && `${fileInfo.columns} cols · `}
              {formatFileSize(fileInfo.size)}
            </p>
          </div>
          <button
            onClick={onRemove}
            className="text-gray-400 hover:text-red-500 transition-colors duration-150 p-0.5 rounded shrink-0"
            title="Remove"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    )
  }

  /* ── ERROR ───────────────────────────────────────── */
  if (status === 'error') {
    return (
      <div className="fade-in border border-red-200 bg-red-50 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <XCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-600">Upload failed</p>
            {error && <p className="text-[13px] text-red-500 mt-0.5 break-words">{error}</p>}
          </div>
          <button
            onClick={() => retryRef.current?.click()}
            className="text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-300 hover:border-gray-400 bg-white px-2.5 py-1 rounded transition-colors duration-150 shrink-0"
          >
            Retry
          </button>
          <input
            ref={retryRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) onUpload(e.target.files[0]) }}
          />
        </div>
      </div>
    )
  }

  /* ── UPLOADING ───────────────────────────────────── */
  if (status === 'uploading') {
    return (
      <div className="fade-in border border-gray-200 bg-white rounded-lg p-4">
        <div className="flex items-center gap-2.5 mb-2.5">
          <FileText size={15} className="text-gray-400 shrink-0" />
          <span className="text-sm text-gray-700 truncate flex-1">
            {fileInfo?.name ?? `Uploading ${label}…`}
          </span>
          <span className="text-[12px] text-gray-400 tabular-nums shrink-0">{progress}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-300 ease-out bg-ey-yellow w-[var(--w)]"
            style={{ '--w': `${progress}%` } as CSSProperties}
          />
        </div>
        {fileInfo && (
          <p className="text-[12px] text-gray-400 mt-1.5">{formatFileSize(fileInfo.size)}</p>
        )}
      </div>
    )
  }

  /* ── IDLE / DRAGGING ─────────────────────────────── */
  return (
    <div
      {...getRootProps()}
      className={clsx(
        'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors duration-150 outline-none',
        isDragActive
          ? 'border-ey-yellow-hover bg-gold-light'
          : 'border-gray-300 hover:border-gray-400 bg-white hover:bg-gray-50',
      )}
    >
      <input {...getInputProps()} />

      <div
        className="w-9 h-9 bg-surface-panel rounded flex items-center justify-center mt-0 mx-auto mb-[10px]"
      >
        <Upload
          size={18}
          className={clsx(
            'transition-colors duration-150',
            isDragActive ? 'text-ey-yellow-hover' : 'text-gray-400',
          )}
        />
      </div>

      <p className={clsx(
        'text-sm font-medium transition-colors duration-150',
        isDragActive ? 'text-gray-800' : 'text-gray-600',
      )}>
        {isDragActive ? 'Drop to upload' : `Upload ${label}`}
      </p>

      {!isDragActive && (
        <>
          <p className="text-[13px] text-gray-400 mt-0.5">Drag &amp; drop or click to browse</p>
          {hint && <p className="text-[12px] text-gray-400 mt-1">{hint}</p>}
        </>
      )}
    </div>
  )
}
