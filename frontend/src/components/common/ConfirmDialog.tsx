import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
  destructive?: boolean
  confirmLabel?: string
  cancelLabel?: string
}

/** Modal confirmation dialog — destructive variant shows a red confirm button. */
export default function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  destructive = false,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
}: ConfirmDialogProps) {
  if (!open) return null

  // Portaled to document.body: an ancestor page wraps its content in a
  // `.fade-in`/`.slide-in` animation using `animation: ... both`, whose fill-mode
  // leaves `transform` applied on the element permanently. A `transform` on any
  // ancestor creates a new containing block for `position: fixed` descendants,
  // so without the portal this dialog would be positioned relative to that
  // scrolled ancestor instead of the viewport — appearing to render "above the
  // page" whenever the user had scrolled down.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />

      {/* Dialog */}
      <div className="relative bg-white rounded-lg shadow-dropdown w-[400px] max-w-[90vw] p-6">
        <div className="flex items-start gap-3 mb-4">
          {destructive && (
            <AlertTriangle size={20} className="text-error mt-0.5 shrink-0" />
          )}
          <div>
            <h3 className="text-base font-semibold text-slate-800">{title}</h3>
            <p className="text-sm text-slate-500 mt-1">{message}</p>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={clsx(
              'px-4 py-2 rounded font-semibold text-sm transition-colors duration-150',
              destructive
                ? 'bg-error text-white hover:bg-red-700'
                : 'btn-primary',
            )}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
