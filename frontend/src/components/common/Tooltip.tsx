import { useState, type ReactNode } from 'react'

interface TooltipProps {
  content: string
  children: ReactNode
}

/** Simple hover tooltip — dark bg, white text, appears above the element. */
export default function Tooltip({ content, children }: TooltipProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 pointer-events-none">
          <div className="bg-gray-800 text-white text-[12px] px-2.5 py-1.5 rounded whitespace-nowrap max-w-xs break-words shadow-dropdown">
            {content}
          </div>
          {/* Arrow */}
          <div className="w-2 h-2 bg-gray-800 rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2" />
        </div>
      )}
    </div>
  )
}
