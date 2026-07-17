import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Download, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

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
      toast.error('Download failed — the results are no longer available. Please re-run the analysis.')
      setState('idle')
    }
  }

  const isSuccess = state === 'success'
  const isLoading = state === 'loading'

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isLoading}
      className={cn(
        'inline-flex items-center gap-1.5 px-[18px] py-[9px] rounded text-[13px] font-semibold border-none transition-all duration-150',
        disabled || isLoading ? 'cursor-not-allowed' : 'cursor-pointer',
        isSuccess ? 'bg-green-600 text-white' : disabled ? 'bg-slate-200 text-slate-400' : 'bg-navy text-ey-yellow',
        disabled && !isLoading ? 'opacity-60' : 'opacity-100',
      )}
    >
      {isLoading ? (
        <Loader2 size={16} className="animate-spin" />
      ) : isSuccess ? (
        <Check size={16} />
      ) : (
        <Download size={16} />
      )}
      {isSuccess ? 'Downloaded!' : label}
    </button>
  )
}
