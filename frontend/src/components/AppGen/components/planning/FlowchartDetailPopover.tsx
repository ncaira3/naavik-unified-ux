import { X } from 'lucide-react'
import { FLOWCHART_COLORS, DEFAULT_COLOR, SHADOWS } from './flowchartTokens'

interface FlowchartDetailPopoverProps {
  nodeType: string
  label: string
  content: string
  onClose: () => void
}

export function FlowchartDetailPopover({ nodeType, label, content, onClose }: FlowchartDetailPopoverProps) {
  const colors = FLOWCHART_COLORS[nodeType as keyof typeof FLOWCHART_COLORS] ?? DEFAULT_COLOR
  const strippedContent = content.replace(/<[^>]+>/g, '').trim()

  return (
    <div
      className="absolute z-30 w-72 rounded-lg border border-border bg-cream-surface nopan nowheel nodrag"
      style={{ boxShadow: SHADOWS.nodeHover, right: 16, top: 16 }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: colors.border }} />
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">{nodeType}</span>
        </div>
        <button onClick={onClose} className="rounded p-0.5 text-text-muted hover:text-slate-600 hover:bg-slate-100">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="px-4 py-3">
        <div className="text-sm font-semibold text-text-primary mb-1">{label}</div>
        {strippedContent ? (
          <div className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
            {strippedContent}
          </div>
        ) : (
          <div className="text-xs text-text-muted italic">No additional details</div>
        )}
      </div>
    </div>
  )
}
