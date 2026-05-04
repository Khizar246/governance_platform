import { useState, useEffect } from 'react'
import { Download, Check, Loader2 } from 'lucide-react'

interface DownloadButtonProps {
  onClick: () => Promise<void>
  disabled?: boolean
  label?: string
}

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

  const isSuccess = state === 'success'
  const isLoading = state === 'loading'

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isLoading}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '9px 18px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s ease',
        border: 'none',
        background: isSuccess ? '#16A34A' : disabled ? '#E5E7EB' : '#0F1E3D',
        color: isSuccess ? '#FFFFFF' : disabled ? '#9CA3AF' : '#FFD100',
        opacity: disabled && !isLoading ? 0.6 : 1,
      }}
    >
      {isLoading ? (
        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
      ) : isSuccess ? (
        <Check size={16} />
      ) : (
        <Download size={16} />
      )}
      {isSuccess ? 'Downloaded!' : label}
    </button>
  )
}
