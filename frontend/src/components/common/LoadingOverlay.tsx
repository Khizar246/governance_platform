interface LoadingOverlayProps {
  message: string
  progress?: number
}

export default function LoadingOverlay({ message, progress }: LoadingOverlayProps) {
  const pct = progress !== undefined ? Math.min(100, Math.round(progress)) : undefined

  return (
    <div className="absolute inset-0 bg-white/80 z-20 flex flex-col items-center justify-center gap-5">
      <div className="w-10 h-10 border-4 border-gray-200 border-t-[#0F1E3D] rounded-full animate-spin" />

      <p className="text-body font-medium text-gray-700 max-w-sm text-center">{message}</p>

      {pct !== undefined && (
        <div className="w-72 flex flex-col gap-1.5">
          <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%`, background: '#FFD100' }}
            />
          </div>
          <span className="label-uppercase text-gray-400 text-right">{pct}%</span>
        </div>
      )}
    </div>
  )
}
