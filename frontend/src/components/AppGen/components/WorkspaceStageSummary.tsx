import { Loader2 } from 'lucide-react'
import { AGENT_STAGE_DESCRIPTIONS, STAGE_NEXT_ACTIONS, STAGE_TAB_CONFIG } from '../lib/stages'
import type { StageTabId } from '../lib/stages'

interface WorkspaceStageSummaryProps {
  activeTab: StageTabId
  activeAgent: string
  reachedTabs: StageTabId[]
  isBusy?: boolean
}

export function WorkspaceStageSummary({
  activeTab,
  activeAgent,
  reachedTabs,
  isBusy = false,
}: WorkspaceStageSummaryProps) {
  const config = STAGE_TAB_CONFIG[activeTab]
  const Icon = config.icon
  const agentDescription =
    AGENT_STAGE_DESCRIPTIONS[activeAgent] ?? config.description
  const nextAction = STAGE_NEXT_ACTIONS[activeTab]

  return (
    <div className="border-b border-border bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.08),_transparent_28%),linear-gradient(to_right,_#f8fafc,_#ffffff)] px-4 py-3">
      <div className="mx-auto flex w-full max-w-6xl items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-cream-surface shadow-aira-sm">
              <Icon className="h-4 w-4 text-text-secondary" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                Current Stage
              </p>
              <h2 className="truncate text-lg font-semibold text-text-primary">
                {config.label}
              </h2>
            </div>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-text-secondary">
            {agentDescription}
          </p>
          <div className="mt-3 inline-flex max-w-3xl items-start gap-2 rounded-2xl border border-border bg-white/80 px-3 py-2 text-xs text-text-secondary">
            <span className="font-semibold uppercase tracking-[0.12em] text-text-muted">Next</span>
            <span>{nextAction}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="rounded-full border border-border bg-cream-surface px-3 py-1 text-xs font-medium text-text-secondary">
            {reachedTabs.length}/{Object.keys(STAGE_TAB_CONFIG).length} stages
          </div>
          <div
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              isBusy
                ? 'bg-amber-100 text-amber-800'
                : 'bg-emerald-100 text-emerald-800'
            }`}
          >
            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-2 w-2 rounded-full bg-emerald-600" />}
            {isBusy ? 'Agent running' : 'Ready'}
          </div>
        </div>
      </div>
    </div>
  )
}
