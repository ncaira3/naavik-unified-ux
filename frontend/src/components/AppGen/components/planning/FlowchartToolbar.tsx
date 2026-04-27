import { Trash2 } from 'lucide-react'
import type { PlacementMode } from './useFlowchartEditor'
import { SHADOWS } from './flowchartTokens'

interface FlowchartToolbarProps {
  placementMode: PlacementMode
  deleteMode: boolean
  onSetPlacement: (mode: PlacementMode) => void
  onSetDeleteMode: (on: boolean) => void
  onResetLayout?: () => void
}

const NODE_BUTTONS: { type: string; label: string; icon: string }[] = [
  { type: 'process', label: 'Process', icon: '▭' },
  { type: 'decision', label: 'Decision', icon: '◇' },
  { type: 'io', label: 'I/O', icon: '▱' },
]

export function FlowchartToolbar({ placementMode, deleteMode, onSetPlacement, onSetDeleteMode, onResetLayout }: FlowchartToolbarProps) {
  return (
    <div
      className="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-xl border border-slate-200/80 px-2 py-1.5"
      style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', boxShadow: SHADOWS.toolbar }}
    >
      {NODE_BUTTONS.map(({ type, label, icon }) => {
        const isActive = placementMode?.nodeType === type
        return (
          <button
            key={type}
            onClick={() => onSetPlacement(isActive ? null : { nodeType: type })}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/flowchart-node-type', type)
              e.dataTransfer.effectAllowed = 'copy'
              onSetPlacement({ nodeType: type })
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
              isActive
                ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-300'
                : 'text-text-secondary hover:bg-slate-100 hover:text-slate-900'
            }`}
            title={`Add ${label} node (click then click canvas, or drag)`}
          >
            <span className="text-sm">{icon}</span>
            {label}
          </button>
        )
      })}

      <span className="mx-1 h-5 w-px bg-cream-surface-light" />

      <button
        onClick={() => { onSetDeleteMode(!deleteMode); onSetPlacement(null) }}
        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all ${
          deleteMode
            ? 'bg-red-100 text-red-700 ring-2 ring-red-300'
            : 'text-text-muted hover:bg-slate-100 hover:text-slate-700'
        }`}
        title="Delete mode — click nodes/edges to remove"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>

      {onResetLayout && (
        <>
          <span className="mx-1 h-5 w-px bg-cream-surface-light" />
          <button
            onClick={onResetLayout}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-text-muted hover:bg-slate-100 hover:text-slate-700 transition-colors"
            title="Reset auto-layout"
          >
            ↻ Layout
          </button>
        </>
      )}

      {(placementMode || deleteMode) && (
        <span className="ml-1 text-[10px] text-text-muted">
          {placementMode ? `Click canvas to place ${placementMode.nodeType}` : 'Click to delete'}
          {' · ESC to cancel'}
        </span>
      )}
    </div>
  )
}
