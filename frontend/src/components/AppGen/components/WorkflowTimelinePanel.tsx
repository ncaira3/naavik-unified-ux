import type { WorkflowRunStatusResponse, WorkflowTimelineEvent } from '../lib/api'

interface WorkflowTimelinePanelProps {
  status: WorkflowRunStatusResponse | null
  timeline: WorkflowTimelineEvent[]
  loading?: boolean
  mutating?: boolean
  error?: string | null
  onAdvanceStage?: (stageName: string) => void | Promise<void>
}

function formatStage(stage: string | null | undefined) {
  if (!stage) return 'run'
  return stage.replace(/_/g, ' ')
}

function relativeTime(iso: string): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return iso
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

export function WorkflowTimelinePanel({
  status,
  timeline,
  loading = false,
  mutating = false,
  error = null,
  onAdvanceStage,
}: WorkflowTimelinePanelProps) {
  const stageOrder = ['planning', 'code_generation', 'code_audit', 'testing', 'app_assembly']
  const latestEvents = timeline.slice(0, 5)
  const staleStages = (status?.stages || []).filter((stage) => stage.status === 'stale')
  const currentStage = status?.current_stage || null
  const currentIdx = currentStage ? stageOrder.indexOf(currentStage) : -1
  const nextStage = currentIdx >= 0 && currentIdx < stageOrder.length - 1 ? stageOrder[currentIdx + 1] : null
  const showAdvanceButton = !!currentStage && currentStage !== 'planning' && !!nextStage

  return (
    <div className="border-b border-border bg-cream-bg px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-text-muted">Workflow</p>
          <p className="text-sm font-semibold text-text-primary truncate">
            {status ? `Stage: ${formatStage(status.current_stage)} · v${status.version}` : 'Run not initialized'}
          </p>
        </div>
        <div className="text-xs text-text-muted">{mutating ? 'Applying stage jump...' : loading ? 'Refreshing...' : null}</div>
      </div>
      {error && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
          {error}
        </div>
      )}
      {latestEvents.length > 0 && (
        <ul className="mt-2 space-y-1">
          {latestEvents.map((event) => (
            <li key={event.event_id} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-text-secondary truncate">
                {event.event_type.replace(/_/g, ' ')} · {formatStage(event.stage_name)}
              </span>
              <span className="shrink-0 text-text-muted">{relativeTime(event.timestamp)}</span>
            </li>
          ))}
        </ul>
      )}
      {showAdvanceButton && (
        <div className="mt-2">
          <button
            type="button"
            disabled={loading || mutating}
            onClick={() => currentStage && onAdvanceStage?.(currentStage)}
            className="rounded-full border border-sky-300 bg-cream-surface px-3 py-1 text-xs font-medium text-sky-800 hover:bg-sky-50 disabled:opacity-50"
          >
            Move to {formatStage(nextStage)}
          </button>
        </div>
      )}
      {staleStages.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
          <p className="text-xs font-semibold text-amber-800">Rerun required</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {staleStages.map((stage) => (
              <span
                key={stage.stage_name}
                className="rounded-full border border-amber-300 bg-cream-surface px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              >
                Rerun {formatStage(stage.stage_name)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
