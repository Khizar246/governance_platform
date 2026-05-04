import { clsx } from 'clsx'

const shimmer =
  'bg-[linear-gradient(90deg,#F3F4F6_25%,#E5E7EB_50%,#F3F4F6_75%)] bg-[length:800px_100%] animate-shimmer rounded'

function Block({ className }: { className?: string }) {
  return <div className={clsx(shimmer, className)} />
}

export type SkeletonVariant = 'card' | 'table-row' | 'stat'

interface LoadingSkeletonProps {
  variant: SkeletonVariant
  rows?: number
}

export default function LoadingSkeleton({ variant, rows = 1 }: LoadingSkeletonProps) {
  if (variant === 'card') {
    return (
      <>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
            <div className="flex items-center gap-3">
              <Block className="w-8 h-8 rounded-md flex-shrink-0" />
              <Block className="h-4 w-40" />
            </div>
            <Block className="h-3 w-full" />
            <Block className="h-3 w-5/6" />
            <Block className="h-3 w-3/4" />
          </div>
        ))}
      </>
    )
  }

  if (variant === 'table-row') {
    return (
      <>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-gray-100">
            <Block className="h-3.5 flex-1" />
            <Block className="h-3.5 w-24 flex-shrink-0" />
            <Block className="h-3.5 w-32 flex-shrink-0" />
            <Block className="h-3.5 w-20 flex-shrink-0" />
            <Block className="h-3.5 w-16 flex-shrink-0" />
          </div>
        ))}
      </>
    )
  }

  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="bg-white border border-gray-200 rounded-lg p-5 space-y-2">
          <Block className="h-3 w-24" />
          <Block className="h-8 w-20 mt-1" />
          <Block className="h-3 w-16" />
        </div>
      ))}
    </>
  )
}
