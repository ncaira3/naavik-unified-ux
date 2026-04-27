import { useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Pencil,
  RotateCw,
  XCircle,
} from 'lucide-react'
import { EditParametersModal } from './EditParametersModal'
import type { TestScenario } from './types'

function formatParamValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return '[object]'
    }
  }
  return String(value)
}

function ParameterList({
  title,
  params,
}: {
  title: string
  params: Record<string, unknown>
}) {
  if (Object.keys(params).length === 0) return null

  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
      <div className="grid gap-2 sm:grid-cols-2">
        {Object.entries(params).map(([key, value]) => (
          <div key={key} className="rounded-xl border border-border bg-cream-bg px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{key}</p>
            <p className="mt-1 text-sm text-text-primary">{formatParamValue(value)}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

export function ScenarioCard({
  scenario,
  onReRun,
  onRunWithDraft,
  onSaveDefaults,
  isRunning,
}: {
  scenario: TestScenario
  onReRun: () => void
  onRunWithDraft: (inputParams: Record<string, number | string | boolean>) => void
  onSaveDefaults: (inputParams: Record<string, number | string | boolean>) => void | Promise<void>
  isRunning?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const hasParams = scenario.inputParams && Object.keys(scenario.inputParams).length > 0
  const isPassed = scenario.status === 'passed'
  const isNotRun = scenario.status === 'not_run'

  const borderClass = isPassed ? 'border-emerald-200' : isNotRun ? 'border-border' : 'border-red-200'
  const iconBgClass = isPassed ? 'bg-emerald-50' : isNotRun ? 'bg-cream-surface-light' : 'bg-red-50'
  const badgeClass = isPassed
    ? 'bg-emerald-50 text-emerald-700'
    : isNotRun
      ? 'bg-cream-surface-light text-text-muted'
      : 'bg-red-50 text-red-700'

  return (
    <>
      <div className={`w-full rounded-2xl border bg-cream-surface p-5 shadow-aira-sm ${borderClass}`}>
        <header className="flex items-start justify-between gap-4">
          <section className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${iconBgClass}`}>
                {isPassed ? (
                  <CheckCircle className="h-5 w-5 text-emerald-600" />
                ) : isNotRun ? (
                  <Clock className="h-5 w-5 text-text-muted" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600" />
                )}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-base font-semibold text-text-primary">{scenario.name}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${badgeClass}`}>
                    {isNotRun ? 'not run' : scenario.status}
                  </span>
                  {scenario.latestRunScope && (
                    <span className="rounded-full bg-cream-surface-light px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                      {scenario.latestRunScope === 'scenario' ? 'Focused run' : scenario.latestRunScope}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-text-muted">{scenario.description}</p>
              </div>
            </div>
          </section>
          <section className="flex flex-shrink-0 items-center gap-2">
            <button
              onClick={onReRun}
              disabled={isRunning}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              Run
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              className="rounded-xl p-2 text-text-muted transition-colors hover:bg-slate-100"
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </section>
        </header>

        <div className="mt-4">
          <h4 className="text-sm font-semibold text-text-primary">Execution Path</h4>
          <ul className="mt-2 flex flex-wrap items-center gap-2">
            {scenario.execPath.map((step, index) => (
              <li key={index} className="flex items-center gap-2">
                <span className="rounded-xl border border-border bg-cream-bg px-2.5 py-1 text-xs font-medium text-text-secondary">
                  {step}
                </span>
                {index < scenario.execPath.length - 1 && <ArrowRight className="h-4 w-4 text-text-muted" />}
              </li>
            ))}
          </ul>
        </div>

        {scenario.failureExcerpt && !isPassed && !isNotRun && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <p className="font-medium">Last failure</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-amber-900/90">{scenario.failureExcerpt}</p>
              </div>
            </div>
          </div>
        )}

        {expanded && (
          <div className="mt-4 space-y-4 border-t border-border pt-4">
            {hasParams ? (
              <>
                <ParameterList title="Saved Default Parameters" params={scenario.inputParams || {}} />
                <ParameterList title="Expected / Observed Outputs" params={scenario.outputParams || {}} />
                <div>
                  <button
                    onClick={() => setEditOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-cream-surface px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-slate-100"
                  >
                    <Pencil className="h-4 w-4" />
                    Edit Parameters
                  </button>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-cream-bg px-4 py-4 text-sm text-text-muted">
                No input or output parameters were recorded for this scenario.
              </div>
            )}
          </div>
        )}
      </div>

      {editOpen && (
        <EditParametersModal
          scenario={scenario}
          onClose={() => setEditOpen(false)}
          onRunWithDraft={async inputParams => {
            onRunWithDraft(inputParams)
            setEditOpen(false)
          }}
          onSaveDefaults={async inputParams => {
            await onSaveDefaults(inputParams)
            setEditOpen(false)
          }}
        />
      )}
    </>
  )
}
