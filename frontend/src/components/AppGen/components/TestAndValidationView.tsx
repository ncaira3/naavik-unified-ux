import { useMemo, useState } from 'react'
import { CheckCircle, ClipboardCheck, FileCode, Loader2 } from 'lucide-react'
import { UnitTestResultsView } from './UnitTestResultsView'
import { TestValidationView } from './TestValidationView'
import type { TestScenario } from './testValidation/types'
import { summarizeIntegrationArtifact } from './testValidation/normalize'

export type TestAndValidationTab = 'unit' | 'validation'

export interface TestAndValidationViewProps {
  unitArtifact: Record<string, any> | null
  integrationArtifact: Record<string, any> | null
  sessionId?: string
  onFileSelect?: (filePath: string) => void
  onRefresh?: () => void
  onRunIntegrationTests?: (scenario?: TestScenario) => void
  isAgentBusy?: boolean
  isRunningIntegrationTests?: boolean
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="h-full bg-[linear-gradient(180deg,_rgba(248,250,252,0.9)_0%,_rgba(255,255,255,0.96)_100%)] p-4">
      <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-white/80 px-6 text-center">
        <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-cream-surface-light">
          <FileCode className="h-8 w-8 text-text-muted" />
        </span>
        <p className="text-base font-semibold text-text-primary">{title}</p>
        <p className="mt-2 max-w-md text-sm text-text-muted">{detail}</p>
      </div>
    </div>
  )
}

function RunningIntegrationTestsOverlay({ open }: { open: boolean }) {
  if (!open) return null

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl bg-slate-950/25 backdrop-blur-[1px]">
      <div className="flex min-w-[280px] flex-col items-center gap-3 rounded-2xl border border-border bg-cream-surface px-6 py-5 shadow-aira">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
        <p className="text-sm font-medium text-text-primary">Running integration validation</p>
        <p className="text-xs text-text-muted">Validation results will refresh when the scenario run completes.</p>
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string | number
  tone?: 'default' | 'success' | 'warning'
}) {
  const toneClass =
    tone === 'success' ? 'border-emerald-200 bg-emerald-50' : tone === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-border bg-cream-surface'

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted">{label}</p>
      <p className="mt-2 text-xl font-semibold text-text-primary">{value}</p>
    </div>
  )
}

export function TestAndValidationView({
  unitArtifact,
  integrationArtifact,
  sessionId,
  onFileSelect,
  onRefresh,
  onRunIntegrationTests,
  isAgentBusy,
  isRunningIntegrationTests = false,
}: TestAndValidationViewProps) {
  const [activeTab, setActiveTab] = useState<TestAndValidationTab>('unit')
  const hasUnit = unitArtifact != null
  const hasValidation = integrationArtifact != null

  const summary = useMemo(() => {
    const unitPassed = unitArtifact?.passed ?? 0
    const unitFailed = unitArtifact?.failed ?? 0
    const integrationSummary = integrationArtifact ? summarizeIntegrationArtifact(integrationArtifact) : null

    return {
      totalTests: unitPassed + unitFailed,
      validationScore: integrationSummary?.validationScoreDefined ? integrationSummary.score : undefined,
      validationScenarios: integrationSummary?.scenarioCount ?? 0,
    }
  }, [integrationArtifact, unitArtifact])

  return (
    <div className="relative flex h-full flex-col bg-[linear-gradient(180deg,_rgba(248,250,252,0.92)_0%,_rgba(255,255,255,0.98)_100%)]">
      <RunningIntegrationTestsOverlay open={isRunningIntegrationTests} />

      <div className="border-b border-border bg-white/90 px-5 py-4 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Testing and Validation</h2>
            <p className="mt-1 text-sm text-text-muted">Inspect unit results and intent-aligned validation from one stage workspace.</p>
          </div>
          <div className="grid min-w-[320px] gap-3 sm:grid-cols-3">
            <SummaryCard label="Unit tests" value={summary.totalTests || 'N/A'} tone={summary.totalTests > 0 ? 'success' : 'default'} />
            <SummaryCard
              label="Validation score"
              value={summary.validationScore !== undefined ? `${summary.validationScore}/100` : 'N/A'}
              tone={summary.validationScore !== undefined && summary.validationScore < 80 ? 'warning' : 'default'}
            />
            <SummaryCard label="Scenarios" value={summary.validationScenarios || 'N/A'} />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setActiveTab('unit')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'unit'
                ? 'bg-slate-900 text-white shadow-aira-sm'
                : 'text-text-secondary hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <CheckCircle className="h-4 w-4" />
            Unit Tests
          </button>
          <button
            onClick={() => setActiveTab('validation')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'validation'
                ? 'bg-slate-900 text-white shadow-aira-sm'
                : 'text-text-secondary hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <ClipboardCheck className="h-4 w-4" />
            Validation
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'unit' &&
          (hasUnit ? (
            <UnitTestResultsView artifact={unitArtifact} onFileSelect={onFileSelect} />
          ) : (
            <EmptyState
              title="No unit test results yet"
              detail="Run the testing stage to generate and execute unit and functional checks."
            />
          ))}

        {activeTab === 'validation' &&
          (hasValidation ? (
            <TestValidationView
              artifact={integrationArtifact}
              title="Validation Report"
              sessionId={sessionId}
              onArtifactUpdated={onRefresh}
              onReRunAll={onRunIntegrationTests}
              onReRunScenario={scenario => onRunIntegrationTests?.(scenario)}
              onReGenerateTests={onRunIntegrationTests}
              isRunning={isAgentBusy}
            />
          ) : (
            <EmptyState
              title="No validation report yet"
              detail="Run the Integration Validation stage to validate the app against the approved plan and telecom scenarios."
            />
          ))}
      </div>
    </div>
  )
}
