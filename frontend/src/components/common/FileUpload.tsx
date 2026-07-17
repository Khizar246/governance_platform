import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { Upload, CheckCircle2, XCircle, X, FileText, AlertCircle, AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'
import { formatFileSize } from '../../utils/formatters'
import { ALLOWED_EXTENSIONS, LARGE_FILE_WARN_MB, MAX_UPLOAD_SIZE_MB } from '../../utils/constants'

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

// MIME type for each supported extension, used to build react-dropzone's
// `accept` map from the (per-slot) `accept` prop so the dropzone actually
// enforces it — e.g. an xlsx-only slot rejects a .csv client-side instead of
// letting it through to fail at the server.
const EXT_MIME: Record<string, string> = {
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
}

/** Build react-dropzone's { mime: [ext] } accept map from an "ext,ext" string. */
function buildDropzoneAccept(acceptStr: string): Record<string, string[]> {
  const exts = acceptStr
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e in EXT_MIME)
  const map: Record<string, string[]> = {}
  for (const ext of exts) {
    const mime = EXT_MIME[ext]
    ;(map[mime] ??= []).push(ext)
  }
  return map
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
  // Why a file was rejected by the dropzone (wrong type / too big) — without
  // this, rejected drops give zero feedback and the box just does nothing.
  const [rejectMsg, setRejectMsg] = useState<string | null>(null)

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted[0]) {
        setRejectMsg(null)
        onUpload(accepted[0])
      }
    },
    [onUpload],
  )

  const acceptMap = useMemo(() => buildDropzoneAccept(accept), [accept])
  const allowedExtsText = useMemo(
    () => Object.values(acceptMap).flat().join(', '),
    [acceptMap],
  )

  const onDropRejected = useCallback(
    (rejections: FileRejection[]) => {
      const r = rejections[0]
      if (!r) return
      const code = r.errors[0]?.code
      if (code === 'file-too-large') {
        setRejectMsg(`"${r.file.name}" is too large — the limit is ${maxSizeMB} MB.`)
      } else if (code === 'file-invalid-type') {
        setRejectMsg(`"${r.file.name}" is not a supported file type — upload a ${allowedExtsText} file.`)
      } else if (code === 'too-many-files') {
        setRejectMsg('Only one file can be uploaded here — drop a single file.')
      } else {
        setRejectMsg(`"${r.file.name}" was rejected: ${r.errors[0]?.message ?? 'unknown error'}.`)
      }
    },
    [maxSizeMB, allowedExtsText],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: acceptMap,
    maxSize: maxSizeMB * 1024 * 1024,
    multiple: false,
  })

  // The Retry <input type="file"> bypasses the dropzone, so enforce the same
  // size + type rules here (the browser's `accept` hint is not a guarantee).
  const handleManualPick = useCallback(
    (file: File) => {
      const ext = ('.' + (file.name.split('.').pop() ?? '')).toLowerCase()
      const allowed = Object.values(acceptMap).flat()
      if (allowed.length > 0 && !allowed.includes(ext)) {
        setRejectMsg(`"${file.name}" is not a supported file type — upload a ${allowedExtsText} file.`)
        return
      }
      if (file.size > maxSizeMB * 1024 * 1024) {
        setRejectMsg(`"${file.name}" is too large — the limit is ${maxSizeMB} MB.`)
        return
      }
      setRejectMsg(null)
      onUpload(file)
    },
    [acceptMap, allowedExtsText, maxSizeMB, onUpload],
  )

  /* ── SUCCESS ─────────────────────────────────────── */
  if (status === 'success' && fileInfo) {
    const isLarge = fileInfo.size > LARGE_FILE_WARN_MB * 1024 * 1024
    return (
      <div className="fade-in border border-green-200 bg-green-50 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={18} className="text-green-600 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{fileInfo.name}</p>
            <p className="text-[13px] text-slate-500 mt-0.5">
              {fileInfo.rows != null && `${fileInfo.rows.toLocaleString()} rows · `}
              {fileInfo.columns != null && `${fileInfo.columns} cols · `}
              {formatFileSize(fileInfo.size)}
            </p>
            {isLarge && (
              <p className="flex items-start gap-1.5 text-[12px] text-amber-700 mt-1.5">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span>
                  This file is unusually large ({formatFileSize(fileInfo.size)}) — uploads are
                  typically under {LARGE_FILE_WARN_MB} MB, so processing may be slow. Consider
                  reducing it if possible.
                </span>
              </p>
            )}
          </div>
          <button
            onClick={onRemove}
            className="text-slate-400 hover:text-red-500 transition-colors duration-150 p-0.5 rounded shrink-0"
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
            className="text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-300 hover:border-slate-400 bg-white px-2.5 py-1 rounded transition-colors duration-150 shrink-0"
          >
            Retry
          </button>
          <input
            ref={retryRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) handleManualPick(e.target.files[0]) }}
          />
        </div>
        {rejectMsg && (
          <p className="fade-in flex items-start gap-1.5 text-[12px] text-red-600 mt-2">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span className="break-words min-w-0">{rejectMsg}</span>
          </p>
        )}
      </div>
    )
  }

  /* ── UPLOADING ───────────────────────────────────── */
  if (status === 'uploading') {
    return (
      <div className="fade-in border border-slate-200 bg-white rounded-lg p-4">
        <div className="flex items-center gap-2.5 mb-2.5">
          <FileText size={15} className="text-slate-400 shrink-0" />
          <span className="text-sm text-slate-700 truncate flex-1">
            {fileInfo?.name ?? `Uploading ${label}…`}
          </span>
          <span className="text-[12px] text-slate-400 tabular-nums shrink-0">{progress}%</span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-300 ease-out bg-ey-yellow w-[var(--w)]"
            style={{ '--w': `${progress}%` } as CSSProperties}
          />
        </div>
        {fileInfo && (
          <p className="text-[12px] text-slate-400 mt-1.5">{formatFileSize(fileInfo.size)}</p>
        )}
      </div>
    )
  }

  /* ── IDLE / DRAGGING ─────────────────────────────── */
  return (
    <div>
    <div
      {...getRootProps()}
      className={clsx(
        'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors duration-150 outline-none',
        'focus-visible:ring-2 focus-visible:ring-ey-yellow focus-visible:ring-offset-2',
        isDragActive
          ? 'border-ey-yellow-hover bg-gold-light'
          : rejectMsg
            ? 'border-red-300 hover:border-red-400 bg-white hover:bg-slate-50'
            : 'border-slate-300 hover:border-slate-400 bg-white hover:bg-slate-50',
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
            isDragActive ? 'text-ey-yellow-hover' : 'text-slate-400',
          )}
        />
      </div>

      <p className={clsx(
        'text-sm font-medium transition-colors duration-150',
        isDragActive ? 'text-slate-800' : 'text-slate-600',
      )}>
        {isDragActive ? 'Drop to upload' : `Upload ${label}`}
      </p>

      {!isDragActive && (
        <>
          <p className="text-[13px] text-slate-400 mt-0.5">Drag &amp; drop or click to browse</p>
          {hint && <p className="text-[12px] text-slate-400 mt-1">{hint}</p>}
        </>
      )}
    </div>

    {rejectMsg && (
      <p className="fade-in flex items-start gap-1.5 text-[12px] text-red-600 mt-1.5">
        <AlertCircle size={13} className="shrink-0 mt-0.5" />
        <span className="break-words min-w-0">{rejectMsg}</span>
      </p>
    )}
    </div>
  )
}
