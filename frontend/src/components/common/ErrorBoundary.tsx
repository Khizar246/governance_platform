import React, { type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

/** Page-level error boundary — shows recovery UI instead of crashing the entire app. */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-64 text-center p-8">
          <AlertTriangle size={48} className="text-slate-300 mb-4" />
          <h2 className="text-base font-semibold text-slate-600 mb-1">Something went wrong</h2>
          <p className="text-sm text-slate-400 mb-5 max-w-sm">{this.state.error?.message}</p>
          <button
            className="btn-secondary"
            onClick={() => window.location.reload()}
          >
            Reload Page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
