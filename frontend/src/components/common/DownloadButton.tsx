import { useState, useEffect } from 'react'
import { Download, Check, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'

interface DownloadButtonProps {
  onClick: () => Promise<void>
  disabled?: boolean
  filename?: string
  label?: string
}

/** EY Yellow download button — shows spinner while loading, green check on success. */
export default function DownloadButton({
  onClick,
  disabled = false,
  label = 'Download Results (.xlsx)',
}: DownloadButtonProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'success'>('idle')

  useEffect(() => {
    if (state === 'success') {
      const t = setTimeout(() => setState('idle'), 2000)
      return () => clearTimeout(t)
    }
  }, [state])

  const handleClick = async () => {
    if (state !== 'idle' || disabled) return
    setState('loading')
    try {
      await onClick()
      setState('success')
    } catch {
      setState('idle')
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled || state === 'loading'}
      className={clsx(
        'flex items-center gap-2 px-5 py-2.5 rounded font-semibold text-sm transition-colors duration-150',
        state === 'success'
          ? 'bg-success text-white cursor-default'
          : disabled
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
            : 'bg-ey-yellow text-gray-900 hover:bg-yellow-hover active:bg-yellow-active',
      )}
    >
      {state === 'loading' ? (
        <Loader2 size={16} className="animate-spin" />
      ) : state === 'success' ? (
        <Check size={16} />
      ) : (
        <Download size={16} />
      )}
      {state === 'success' ? 'Downloaded!' : label}
    </button>
  )
}
