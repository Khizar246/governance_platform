import { useEffect } from 'react'

/** AppLayout's <main> is the scrolling element, not window — see AppLayout.tsx. */
function getScrollContainer(): Element | null {
  return document.querySelector('main')
}

/** Scrolls the page's scroll container to top whenever `dep` changes (e.g. a
 *  wizard step). Without this, resetting to an earlier step (like "Start New
 *  Analysis" from a long Results page) leaves the scroll position wherever it
 *  was, so the new step renders off-screen until the user manually scrolls up. */
export default function useScrollToTopOnChange(dep: unknown): void {
  useEffect(() => {
    getScrollContainer()?.scrollTo({ top: 0 })
  }, [dep])
}
