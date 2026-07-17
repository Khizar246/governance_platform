import { AlertTriangle, RotateCcw } from 'lucide-react'

/** Rendered in place of a results DataTable when the rows failed to load.
 *  A fetch error must never fall through to the table's "no results" empty
 *  state — in an audit tool a false "all clear" is worse than an error. */
export default function ResultsErrorPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bg-white border border-red-200 rounded-lg px-6 py-10 text-center">
      <AlertTriangle size={32} className="text-red-500 mx-auto mb-3" />
      <h3 className="font-serif text-[15px] font-semibold text-navy mb-1.5">
        Results could not be loaded
      </h3>
      <p className="text-[13px] text-slate-500 mb-4">
        This is a loading problem, not an empty result — the rows are hidden so
        they can&apos;t be mistaken for &ldquo;no findings&rdquo;.
      </p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-[18px] py-[9px] rounded border-none bg-navy text-ey-yellow text-[13px] font-semibold cursor-pointer"
      >
        <RotateCcw size={14} /> Retry
      </button>
    </div>
  )
}
