import { useMemo } from 'react'
import {
  ArrowUpRight,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  XCircle,
} from 'lucide-react'
import type { TestScenario } from './types'

function isNumeric(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value)
}

function collectNumericParamKeys(scenarios: TestScenario[]): { param: string; type: 'input' | 'output' }[] {
  const seen = new Set<string>()
  const result: { param: string; type: 'input' | 'output' }[] = []
  for (const s of scenarios) {
    for (const [key, val] of Object.entries(s.inputParams || {})) {
      if (isNumeric(val) && !seen.has(`input:${key}`)) {
        seen.add(`input:${key}`)
        result.push({ param: key, type: 'input' })
      }
    }
    for (const [key, val] of Object.entries(s.outputParams || {})) {
      if (isNumeric(val) && !seen.has(`output:${key}`)) {
        seen.add(`output:${key}`)
        result.push({ param: key, type: 'output' })
      }
    }
  }
  return result
}

function ParamsChartTable({ scenarios }: { scenarios: TestScenario[] }) {
  const numericParamKeys = useMemo(() => collectNumericParamKeys(scenarios), [scenarios])
  if (numericParamKeys.length === 0 || scenarios.length === 0) return null

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-bg-primary">
      <table className="w-full min-w-[200px] text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-bg-secondary">
            <th className="px-3 py-2 font-semibold text-text-primary">Parameter</th>
            {scenarios.map(s => (
              <th key={s.id} className="px-3 py-2 font-medium text-text-secondary truncate max-w-[100px]" title={s.name}>
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {numericParamKeys.map(({ param, type }) => (
            <tr key={`${type}:${param}`} className="border-b border-border/50 last:border-b-0">
              <td className="px-3 py-1.5 font-medium text-text-secondary">
                {type === 'input' ? 'In' : 'Out'}.{param}
              </td>
              {scenarios.map(s => {
                const src = type === 'input' ? s.inputParams : s.outputParams
                const val = src && src[param]
                const num = isNumeric(val) ? val : null
                return (
                  <td key={s.id} className="px-3 py-1.5 text-text-primary tabular-nums">
                    {num !== null ? num : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-1.5 text-[10px] text-text-muted border-t border-border">Parameter values across test scenarios</p>
    </div>
  )
}

function TestParameterChartModal({
  open,
  scenarios,
  onClose,
}: {
  open: boolean
  scenarios: TestScenario[]
  onClose: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-bg-primary rounded-lg shadow-aira-md max-w-6xl w-full max-h-[90vh] overflow-y-auto border border-border p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Test Parameters Visualization</h2>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-border bg-bg-primary text-text-secondary text-sm font-medium hover:bg-bg-tertiary"
          >
            Close
          </button>
        </div>

        <div className="space-y-4">
          <ParamsChartTable scenarios={scenarios} />
          <div className="space-y-3">
            {scenarios.map(s => (
              <div key={s.id} className="rounded-lg border border-border bg-bg-secondary p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {s.status === 'passed' ? (
                      <CheckCircle className="h-4 w-4 text-success" />
                    ) : (
                      <XCircle className="h-4 w-4 text-error" />
                    )}
                    <span className="font-medium text-text-primary">{s.name}</span>
                  </div>
                  <span className="text-sm text-text-muted">{s.description}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.execPath.map((step, i) => (
                    <span key={i} className="rounded border border-border bg-bg-primary px-2 py-0.5 text-xs text-text-secondary">
                      {step}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function TestParametersSection({
  scenarios,
  isOpen,
  onToggleOpen,
  selectedScenarioId,
  onSelectScenario,
  isModalOpen,
  onOpenModal,
  onCloseModal,
}: {
  scenarios: TestScenario[]
  isOpen: boolean
  onToggleOpen: () => void
  selectedScenarioId: string | null
  onSelectScenario: (id: string | null) => void
  isModalOpen: boolean
  onOpenModal: () => void
  onCloseModal: () => void
}) {
  const numericParamKeys = useMemo(() => collectNumericParamKeys(scenarios), [scenarios])
  const hasNumericParams = numericParamKeys.length > 0 && scenarios.length > 0

  return (
    <div className="w-full rounded-2xl border border-border bg-cream-surface p-5 shadow-aira-sm">
      <header className="flex items-center justify-between">
        <section className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-text-primary">Test Parameters Visualization</h3>
          <button
            onClick={onOpenModal}
            className="rounded-lg p-1.5 transition-colors hover:bg-slate-100 text-text-muted"
            title="Extended view"
          >
            <ArrowUpRight className="h-4 w-4" />
          </button>
        </section>
        <button
          onClick={onToggleOpen}
          className="rounded-lg p-1.5 transition-colors hover:bg-slate-100 text-text-muted"
          aria-label={isOpen ? 'Collapse' : 'Expand'}
        >
          {isOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
      </header>
      <p className="mt-1 text-xs text-text-muted">
        Compare saved numeric parameters across scenarios and inspect the recorded execution path.
      </p>
      {isOpen && hasNumericParams && (
        <div className="mt-3">
          <ParamsChartTable scenarios={scenarios} />
        </div>
      )}
      {isOpen && scenarios.length > 0 && (
        <div className="mt-3 space-y-2">
          {scenarios.slice(0, 3).map(s => (
            <button
              key={s.id}
              onClick={() => onSelectScenario(selectedScenarioId === s.id ? null : s.id)}
              className={`w-full text-left rounded-2xl border p-4 transition-colors ${
                selectedScenarioId === s.id
                  ? 'border-emerald-200 bg-emerald-50/50'
                  : 'border-border bg-cream-surface hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {s.status === 'passed' ? (
                    <CheckCircle className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-error" />
                  )}
                  <span className="font-medium text-text-primary">{s.name}</span>
                </div>
                <span className="text-sm text-text-muted">{s.description}</span>
              </div>
              {selectedScenarioId === s.id && (
                <div className="mt-3 pt-3 border-t border-border space-y-2">
                  <div>
                    <p className="text-xs font-semibold text-text-secondary mb-1">Code Execution Path</p>
                    <div className="flex flex-wrap gap-1.5">
                      {s.execPath.map((step, i) => (
                        <span
                          key={i}
                          className="rounded border border-border bg-cream-surface-light px-2 py-0.5 text-xs text-text-secondary"
                        >
                          {step}
                        </span>
                      ))}
                    </div>
                  </div>
                  {(s.inputParams && Object.keys(s.inputParams).length > 0) && (
                    <div>
                      <p className="text-xs font-semibold text-text-secondary mb-1">Input Parameters</p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(s.inputParams ?? {}).map(([k, v]) => (
                          <span key={k} className="text-xs text-text-primary">
                            {k}: <strong>{String(v)}</strong>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {(s.outputParams && Object.keys(s.outputParams).length > 0) && (
                    <div>
                      <p className="text-xs font-semibold text-text-secondary mb-1">Output Parameters</p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(s.outputParams ?? {}).map(([k, v]) => (
                          <span key={k} className="text-xs text-text-primary">
                            {k}: <strong>{String(v)}</strong>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </button>
          ))}
          {scenarios.length > 3 && (
            <p className="text-xs text-text-muted">+ {scenarios.length - 3} more scenarios appear in the explorer below.</p>
          )}
        </div>
      )}

      <TestParameterChartModal open={isModalOpen} scenarios={scenarios} onClose={onCloseModal} />
    </div>
  )
}
