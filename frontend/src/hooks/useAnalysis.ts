import { useState, useCallback } from 'react'

export type AnalysisStep = 'upload' | 'preview' | 'running' | 'results' | 'error'

export interface AnalysisState {
  step: AnalysisStep
  jobId: string | null
  progress: number
  progressMessage: string
  errors: string[]
  warnings: string[]
}

const INITIAL_STATE: AnalysisState = {
  step: 'upload',
  jobId: null,
  progress: 0,
  progressMessage: '',
  errors: [],
  warnings: [],
}

/** Generic analysis workflow state for any of the four tools. */
export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE)

  const reset = useCallback(() => setState(INITIAL_STATE), [])

  const setStep = useCallback((step: AnalysisStep) =>
    setState((prev) => ({ ...prev, step })), [])

  const setJob = useCallback((jobId: string) =>
    setState((prev) => ({ ...prev, jobId })), [])

  const setProgress = useCallback((progress: number, progressMessage: string) =>
    setState((prev) => ({ ...prev, progress, progressMessage, step: 'running' })), [])

  const setResults = useCallback((warnings: string[] = []) =>
    setState((prev) => ({ ...prev, step: 'results', progress: 100, warnings })), [])

  const setError = useCallback((errors: string[]) =>
    setState((prev) => ({ ...prev, step: 'error', errors })), [])

  return { state, setState, reset, setStep, setJob, setProgress, setResults, setError }
}
