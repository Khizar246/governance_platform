interface LoadingOverlayProps {
  message: string
  progress?: number
}

/** Semi-transparent overlay that blocks interaction while an async operation runs. */
export default function LoadingOverlay({ message, progress }: LoadingOverlayProps) {
  return (
    <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center gap-4">
      {/* Spinner */}
      <div className="w-10 h-10 border-4 border-gray-200 border-t-ey-yellow rounded-full animate-spin" />

      {/* Message */}
      <p className="text-sm font-medium text-gray-700 max-w-sm text-center">{message}</p>

      {/* Optional progress bar */}
      {progress !== undefined && (
        <div className="w-64 bg-gray-200 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full bg-ey-yellow transition-all duration-300"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      )}
    </div>
  )
}
