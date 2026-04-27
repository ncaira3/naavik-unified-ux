import type { StageTabId } from '../lib/stages'
import { STAGE_TAB_CONFIG } from '../lib/stages'
import { CheckCircle2 } from 'lucide-react'

interface StageTabBarProps {
  reachedTabs: StageTabId[]
  activeTab: StageTabId
  onTabSelect: (tabId: StageTabId) => void
  tabState?: Partial<Record<StageTabId, 'pending' | 'running' | 'failed' | 'stale' | 'succeeded'>>
}

/**
 * Top-level stage tabs: Plan | Code | Audit | Test.
 * Only reached stages are shown. Active tab reflects current agent.
 */
export function StageTabBar({ reachedTabs, activeTab, onTabSelect, tabState = {} }: StageTabBarProps) {
  if (reachedTabs.length === 0) return null

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-slate-50 to-white px-3 py-2.5 flex-shrink-0">
      <div className="flex items-center gap-2 overflow-x-auto">
        {reachedTabs.map((tabId) => {
          const { icon: Icon, label, description } = STAGE_TAB_CONFIG[tabId]
          const isActive = activeTab === tabId
          const state = tabState[tabId]
          const stateBadge =
            state === 'stale' ? 'Stale'
            : state === 'failed' ? 'Failed'
            : state === 'running' ? 'Running'
            : undefined
          return (
            <button
              key={tabId}
              type="button"
              onClick={() => onTabSelect(tabId)}
              title={description}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors border ${
                isActive
                  ? 'text-text-primary border-border bg-cream-surface shadow-aira-sm'
                  : 'text-text-secondary border-transparent hover:text-slate-800 hover:bg-slate-100'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-text-primary' : 'text-text-muted'}`} />
              {label}
              {isActive && <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />}
              {stateBadge && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    state === 'stale'
                      ? 'bg-amber-100 text-amber-700'
                      : state === 'failed'
                        ? 'bg-rose-100 text-rose-700'
                        : 'bg-sky-100 text-sky-700'
                  }`}
                >
                  {stateBadge}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="hidden lg:flex items-center gap-1.5 text-xs text-text-secondary shrink-0">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        {reachedTabs.length}/{Object.keys(STAGE_TAB_CONFIG).length} stages reached
      </div>
    </div>
  )
}
