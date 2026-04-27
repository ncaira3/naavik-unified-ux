/**
 * Test & Validation view (runner-backed).
 * Renders saved scenario definitions together with latest run results.
 */

import { useState, useMemo, useCallback } from 'react'
import { Search } from 'lucide-react'
import { sessionsApi } from '../lib/api'
import { ScenarioCard } from './testValidation/ScenarioCard'
import { TestHeader } from './testValidation/TestHeader'
import { TestParametersSection } from './testValidation/TestParametersSection'
import { buildScenarioViewModels, summarizeIntegrationArtifact } from './testValidation/normalize'
import type { TestScenario } from './testValidation/types'
import { StageBody, StageCard, StageSurface } from './workspace/StagePrimitives'

export interface TestValidationViewProps {
  artifact: Record<string, any>
  title?: string
  sessionId?: string
  onArtifactUpdated?: () => void
  onReRunAll?: () => void
  onReRunScenario?: (scenario: TestScenario) => void
  onReGenerateTests?: () => void
  isRunning?: boolean
}

export function TestValidationView({
  artifact,
  title,
  sessionId,
  onArtifactUpdated,
  onReRunAll,
  onReRunScenario,
  onReGenerateTests,
  isRunning = false,
}: TestValidationViewProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [paramsVizOpen, setParamsVizOpen] = useState(true)
  const [paramsVizModalOpen, setParamsVizModalOpen] = useState(false)
  const [selectedParamsScenarioId, setSelectedParamsScenarioId] = useState<string | null>(null)
  const [showParamsSavedMessage, setShowParamsSavedMessage] = useState(false)

  const summary = useMemo(() => summarizeIntegrationArtifact(artifact), [artifact])
  const scenarios = useMemo(() => buildScenarioViewModels(artifact), [artifact])

  const handleParamsSaved = useCallback(() => {
    setShowParamsSavedMessage(true)
    setTimeout(() => setShowParamsSavedMessage(false), 5000)
  }, [])

  const handleSaveDefaults = useCallback(
    async (scenarioId: string, inputParams: Record<string, number | string | boolean>) => {
      if (!sessionId) {
        handleParamsSaved()
        return
      }
      await sessionsApi.saveIntegrationScenarioDefaults(sessionId, scenarioId, inputParams)
      onArtifactUpdated?.()
      handleParamsSaved()
    },
    [sessionId, onArtifactUpdated, handleParamsSaved]
  )

  const handleRunScenario = useCallback(
    (scenario: TestScenario, inputParams?: Record<string, number | string | boolean>) => {
      if (!onReRunScenario) return
      if (!inputParams) {
        onReRunScenario(scenario)
        return
      }
      onReRunScenario({
        ...scenario,
        inputParams,
      })
    },
    [onReRunScenario]
  )

  const filteredScenarios = useMemo(
    () =>
      scenarios.filter(
        scenario =>
          scenario.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          scenario.description.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    [scenarios, searchTerm]
  )

  const displayTitle = title || 'Validation Report'
  const total = scenarios.length
  const passed = summary.fullRunSummary.passed > 0 || summary.fullRunSummary.failed > 0
    ? summary.fullRunSummary.passed
    : scenarios.filter(scenario => scenario.status === 'passed').length
  const failed = summary.fullRunSummary.passed > 0 || summary.fullRunSummary.failed > 0
    ? summary.fullRunSummary.failed + summary.fullRunSummary.error
    : scenarios.filter(scenario => scenario.status === 'failed').length

  return (
    <StageSurface>
      <StageBody>
        <TestHeader
          total={total}
          passed={passed}
          failed={failed}
          score={summary.validationScoreDefined ? summary.score : undefined}
          displayTitle={displayTitle}
          isRunning={isRunning}
          showParamsSavedMessage={showParamsSavedMessage}
          focusedRunSummary={summary.focusedRunSummary}
          onReRunAll={onReRunAll}
          onReGenerateTests={onReGenerateTests}
        />

        <StageCard
          eyebrow="Parameters"
          title="Scenario parameter map"
          actions={
            <span className="rounded-full bg-cream-surface-light px-3 py-1 text-xs font-medium text-text-secondary">
              {scenarios.length} scenario{scenarios.length === 1 ? '' : 's'}
            </span>
          }
        >
          <TestParametersSection
            scenarios={scenarios}
            isOpen={paramsVizOpen}
            onToggleOpen={() => setParamsVizOpen(!paramsVizOpen)}
            selectedScenarioId={selectedParamsScenarioId}
            onSelectScenario={setSelectedParamsScenarioId}
            isModalOpen={paramsVizModalOpen}
            onOpenModal={() => setParamsVizModalOpen(true)}
            onCloseModal={() => setParamsVizModalOpen(false)}
          />
        </StageCard>

        <StageCard
          eyebrow="Explorer"
          title="Validation scenarios"
          actions={
            <span className="rounded-full bg-cream-surface-light px-2.5 py-1 text-xs font-medium text-text-secondary">
              {filteredScenarios.length} shown
            </span>
          }
        >
          <div className="mb-4">
            <p className="mb-3 text-sm text-text-muted">
              Search validation scenarios, edit saved defaults, or rerun a specific execution path with draft parameters.
            </p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Search test scenarios..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full rounded-xl border border-border bg-cream-bg py-2 pl-10 pr-3 text-sm text-text-primary placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
          </div>

          {filteredScenarios.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-white/80 px-6 py-12 text-center">
              <p className="text-sm text-text-muted">
                {scenarios.length === 0
                  ? 'No validation scenarios yet. Generate tests or run Integration Validation to populate this view.'
                  : 'No scenarios match your search.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredScenarios.map(scenario => (
                <ScenarioCard
                  key={scenario.id}
                  scenario={scenario}
                  onReRun={() => handleRunScenario(scenario)}
                  onRunWithDraft={draft => handleRunScenario(scenario, draft)}
                  isRunning={isRunning}
                  onSaveDefaults={draft => handleSaveDefaults(scenario.id, draft)}
                />
              ))}
            </div>
          )}
        </StageCard>
      </StageBody>
    </StageSurface>
  )
}
