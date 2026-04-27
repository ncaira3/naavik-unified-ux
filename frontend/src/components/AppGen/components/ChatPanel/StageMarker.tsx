import { AGENT_MODES } from './constants'

interface StageMarkerProps {
  stage: string
}

/** Horizontal divider marking a stage transition in the chat thread. */
export function StageMarker({ stage }: StageMarkerProps) {
  const label = AGENT_MODES.find((m) => m.id === stage)?.label ?? stage
  return (
    <div className="flex items-center gap-2 py-3 px-4">
      <div className="flex-1 h-px bg-border" />
      <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
        {label}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}
