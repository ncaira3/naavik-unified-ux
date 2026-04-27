import { useMemo, useState, useCallback } from 'react'
import { ChevronDown, ChevronRight, FlaskConical } from 'lucide-react'
import { sessionsApi } from '../lib/api'
import { ScenarioCard } from './testValidation/ScenarioCard'
import type { TestScenario } from './testValidation/types'
import { getCriteriaRows, getFunctionalScenarios, getFunctionalSummary, getUnitArtifact } from './testing/normalize'
import { UnitTestResultsView } from './UnitTestResultsView'
import { StageBody, StageCard, StageHeader, StageSurface } from './workspace/StagePrimitives'

export interface TestingViewProps {
  artifact: Record<string, any> | null
  sessionId?: string
  onArtifactUpdated?: () => void
  onRunTests?: (scenario?: TestScenario) => void
  isRunning?: boolean
  onFileSelect?: (filePath: string) => void
}

export function TestingView({
  artifact,
  sessionId,
  onArtifactUpdated,
  onRunTests,
  isRunning = false,
  onFileSelect,
}: TestingViewProps) {
  const [criteriaOpen, setCriteriaOpen] = useState(false)
  const unitArtifact = useMemo(() => getUnitArtifact(artifact), [artifact])
  const scenarios = useMemo(() => getFunctionalScenarios(artifact), [artifact])
  const functionalSummary = useMemo(() => getFunctionalSummary(artifact), [artifact])
  const criteria = useMemo(() => getCriteriaRows(artifact), [artifact])

  const handleSaveDefaults = useCallback(
    async (scenarioId: string, inputParams: Record<string, number | string | boolean>) => {
      if (!sessionId) return
      await sessionsApi.saveTestingScenarioDefaults(sessionId, scenarioId, inputParams)
      onArtifactUpdated?.()
    },
    [sessionId, onArtifactUpdated]
  )

  return (
    <StageSurface>
      <StageHeader
        icon={FlaskConical}
        title="Unit checks and plan scenarios"
        description="Scenario-driven functional checks first, with compact unit-test evidence underneath."
      />
      <StageBody>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-cream-surface px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted">Scenario checks</p>
            <p className="mt-2 text-xl font-semibold text-text-primary">
              {functionalSummary.passed} passed, {functionalSummary.failed + functionalSummary.error} failed
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-cream-surface px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted">Unit checks</p>
            <p className="mt-2 text-xl font-semibold text-text-primary">
              {unitArtifact.passed} passed, {unitArtifact.failed} failed, {unitArtifact.skipped} skipped
            </p>
          </div>
        </div>

        <StageCard
          eyebrow="Scenario Checks"
          title="Flowchart and plan scenarios"
          actions={
            <button
              onClick={() => onRunTests?.()}
              disabled={isRunning}
              className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
            >
              Run all scenarios
            </button>
          }
        >
          {scenarios.length === 0 ? (
            <p className="text-sm text-text-muted">No functional scenarios have been saved yet.</p>
          ) : (
            <div className="space-y-4">
              {scenarios.map((scenario) => (
                <ScenarioCard
                  key={scenario.id}
                  scenario={scenario}
                  onReRun={() => onRunTests?.(scenario)}
                  onRunWithDraft={(draft) => onRunTests?.({ ...scenario, inputParams: draft })}
                  onSaveDefaults={(draft) => handleSaveDefaults(scenario.id, draft)}
                  isRunning={isRunning}
                />
              ))}
            </div>
          )}
        </StageCard>

        <StageCard
          eyebrow="Criteria Status"
          title="Plan and flow criteria"
          actions={
            <button
              onClick={() => setCriteriaOpen((open) => !open)}
              className="inline-flex items-center gap-1 rounded-xl border border-border bg-cream-surface px-3 py-2 text-sm font-medium text-text-secondary hover:bg-slate-50"
            >
              {criteriaOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {criteriaOpen ? 'Hide criteria' : 'Show criteria'}
            </button>
          }
        >
          {!criteriaOpen ? (
            <p className="text-sm text-text-muted">Expand to inspect `met`, `partially_met`, and `not_met` criteria.</p>
          ) : criteria.length === 0 ? (
            <p className="text-sm text-text-muted">No criteria status has been saved yet.</p>
          ) : (
            <div className="space-y-3">
              {criteria.map((row, index) => {
                const criterion = String(row.criterion || row.name || row.description || `Criterion ${index + 1}`)
                const status = String(row.status || 'not_met')
                return (
                  <div key={`${criterion}-${index}`} className="rounded-2xl border border-border bg-cream-surface px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-text-primary">{criterion}</p>
                      <span className="rounded-full bg-cream-surface-light px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                        {status}
                      </span>
                    </div>
                    {row.evidence ? <p className="mt-2 text-xs text-text-secondary">Evidence: {String(row.evidence)}</p> : null}
                    {row.gap ? <p className="mt-2 text-xs text-red-600">Gap: {String(row.gap)}</p> : null}
                  </div>
                )
              })}
            </div>
          )}
        </StageCard>

        <StageCard eyebrow="Unit Checks" title="Code-structure checks">
          <div className="overflow-hidden rounded-2xl border border-border">
            <UnitTestResultsView artifact={unitArtifact} onFileSelect={onFileSelect} />
          </div>
        </StageCard>
      </StageBody>
    </StageSurface>
  )
}
