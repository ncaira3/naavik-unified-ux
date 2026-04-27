import { CheckCircle, Cpu, Info, Loader2, RotateCw, XCircle } from 'lucide-react'

function SummaryChip({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string | number
  tone?: 'default' | 'success' | 'danger' | 'warning'
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50'
      : tone === 'danger'
      ? 'border-red-200 bg-red-50'
      : tone === 'warning'
      ? 'border-amber-200 bg-amber-50'
      : 'border-border bg-cream-surface'

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted">{label}</p>
      <p className="mt-2 text-xl font-semibold text-text-primary">{value}</p>
    </div>
  )
}

export function TestHeader({
  total,
  passed,
  failed,
  score,
  displayTitle,
  isRunning,
  showParamsSavedMessage,
  focusedRunSummary,
  onReRunAll,
  onReGenerateTests,
}: {
  total: number
  passed: number
  failed: number
  score: number | undefined
  displayTitle: string
  isRunning: boolean
  showParamsSavedMessage: boolean
  focusedRunSummary?: {
    passed: number
    failed: number
    skipped: number
    error: number
    scenarioId?: string
  } | null
  onReRunAll?: () => void
  onReGenerateTests?: () => void
}) {
  const hasFailures = total > 0 && failed > 0

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-cream-surface p-5 shadow-aira-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-cream-bg">
            <Cpu className="h-5 w-5 text-text-secondary" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-text-primary">{displayTitle}</h2>
            <p className="mt-1 text-sm text-text-muted">
              Review saved scenario defaults, run deterministic reruns, and compare focused results against the latest suite run.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onReGenerateTests && (
            <button
              onClick={onReGenerateTests}
              disabled={isRunning}
              className="rounded-xl border border-border bg-cream-surface px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-slate-100 disabled:opacity-60"
            >
              Re-generate tests
            </button>
          )}
          {total > 0 && onReRunAll && (
            <button
              onClick={onReRunAll}
              disabled={isRunning}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              Re-Run All
            </button>
          )}
        </div>
      </div>

      {focusedRunSummary && (
        <div className="flex items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          <Info className="h-4 w-4 flex-shrink-0" />
          <span>
            Last focused run{focusedRunSummary.scenarioId ? ` (${focusedRunSummary.scenarioId})` : ''}: {focusedRunSummary.passed} passed, {focusedRunSummary.failed + focusedRunSummary.error} failed.
          </span>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryChip label="Scenarios" value={total} />
        <SummaryChip label="Passed" value={passed} tone={passed > 0 ? 'success' : 'default'} />
        <SummaryChip label="Failed" value={failed} tone={failed > 0 ? 'danger' : 'default'} />
        <SummaryChip
          label="Validation score"
          value={score !== undefined ? `${score}/100` : 'N/A'}
          tone={score === undefined ? 'default' : score >= 80 ? 'success' : score >= 60 ? 'warning' : 'danger'}
        />
      </div>

      {total > 0 && failed === total && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          <XCircle className="h-5 w-5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">All validation scenarios failed</p>
            <p className="mt-0.5 text-xs opacity-90">Review the parameters and execution path, then rerun the scenarios.</p>
          </div>
          {onReRunAll && (
            <button
              onClick={onReRunAll}
              disabled={isRunning}
              className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              <RotateCw className="h-4 w-4" />
              Re-Run
            </button>
          )}
        </div>
      )}

      {showParamsSavedMessage && (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          <span>Scenario defaults were saved. Run the scenario again to validate the updated values.</span>
        </div>
      )}

      <div
        className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${
          hasFailures ? 'border-red-200 bg-red-50 text-red-700' : 'border-border bg-cream-bg text-text-secondary'
        }`}
      >
        <Info className="h-4 w-4 flex-shrink-0" />
        <span>
          {hasFailures
            ? 'Some validations failed. Inspect the scenario cards below, edit draft parameters if needed, and rerun deterministically.'
            : 'Scenario definitions and latest run results are tracked separately so you can save defaults without corrupting execution reports.'}
        </span>
      </div>
    </div>
  )
}
