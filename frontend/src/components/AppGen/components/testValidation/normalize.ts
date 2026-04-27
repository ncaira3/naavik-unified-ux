import type {
  IntegrationArtifactEnvelope,
  IntegrationRunReport,
  ScenarioDefinition,
  ScenarioRunResult,
  TestScenario,
} from './types'

function asObject(value: unknown): Record<string, any> {
  return typeof value === 'object' && value !== null ? value as Record<string, any> : {}
}

function normalizeMap(value: unknown): Record<string, number | string | boolean> {
  const src = asObject(value)
  const out: Record<string, number | string | boolean> = {}
  for (const [key, raw] of Object.entries(src)) {
    if (['string', 'number', 'boolean'].includes(typeof raw)) {
      out[key] = raw as number | string | boolean
    }
  }
  return out
}

function normalizeExecPath(value: unknown, description: string): string[] {
  if (!Array.isArray(value)) return description ? ['Run integration scenario', description] : ['Run integration scenario']
  const steps = value.map(step => String(step ?? '').trim()).filter(Boolean)
  return steps.length > 0 ? steps : (description ? ['Run integration scenario', description] : ['Run integration scenario'])
}

function normalizeManifestScenario(row: unknown, index: number): ScenarioDefinition {
  const src = asObject(row)
  const id = String(src.id || src.name || `TC${String(index + 1).padStart(3, '0')}`)
  const name = String(src.name || id)
  const description = String(src.description || name)
  const testRefSrc = asObject(src.testRef)
  return {
    id,
    name,
    description,
    execPath: normalizeExecPath(src.execPath ?? src.ExecPath, description),
    defaultInputParams: normalizeMap(src.defaultInputParams ?? src.inputParams),
    expectedOutputs: normalizeMap(src.expectedOutputs ?? src.outputParams),
    testRef: {
      runner: String(testRefSrc.runner || src.runner || 'pytest'),
      pytest_nodeid: String(testRefSrc.pytest_nodeid || src.pytest_nodeid || ''),
      test_file: String(testRefSrc.test_file || src.test_file || ''),
    },
  }
}

function normalizeRunResult(row: unknown, index: number): ScenarioRunResult {
  const src = asObject(row)
  const id = String(src.id || src.name || `TC${String(index + 1).padStart(3, '0')}`)
  const name = String(src.name || id)
  const description = String(src.description || name)
  const rawStatus = String(src.status || src.result || '').toLowerCase()
  const status =
    rawStatus === 'passed'
      ? 'passed'
      : rawStatus === 'skipped'
      ? 'skipped'
      : rawStatus === 'error'
      ? 'error'
      : rawStatus === 'not_run'
      ? 'not_run'
      : rawStatus === 'mapping_missing'
      ? 'mapping_missing'
      : rawStatus === 'unmapped'
      ? 'unmapped'
      : 'failed'

  return {
    id,
    name,
    description,
    status,
    execPath: normalizeExecPath(src.execPath ?? src.ExecPath, description),
    effectiveInputParams: normalizeMap(src.effectiveInputParams ?? src.inputParams),
    expectedOutputs: normalizeMap(src.expectedOutputs),
    observedOutputs: normalizeMap(src.observedOutputs ?? src.outputParams),
    duration_ms: typeof src.duration_ms === 'number' ? src.duration_ms : undefined,
    failure_excerpt: typeof src.failure_excerpt === 'string' ? src.failure_excerpt : typeof src.message === 'string' ? src.message : undefined,
  }
}

function normalizeRunReport(value: unknown): IntegrationRunReport | null {
  const src = asObject(value)
  if (Object.keys(src).length === 0) return null
  const summarySrc = asObject(src.summary)
  const scenarioResults = Array.isArray(src.scenario_results)
    ? src.scenario_results.map((row, index) => normalizeRunResult(row, index))
    : Array.isArray(src.scenarios)
    ? src.scenarios.map((row, index) => normalizeRunResult(row, index))
    : []
  return {
    test_run_id: typeof src.test_run_id === 'string' ? src.test_run_id : undefined,
    run_status: typeof src.run_status === 'string' ? src.run_status as IntegrationRunReport['run_status'] : undefined,
    scope: typeof src.scope === 'string' ? src.scope : undefined,
    scenario_id: typeof src.scenario_id === 'string' ? src.scenario_id : undefined,
    manifest_version: typeof src.manifest_version === 'number' ? src.manifest_version : undefined,
    started_at: typeof src.started_at === 'string' ? src.started_at : undefined,
    completed_at: typeof src.completed_at === 'string' ? src.completed_at : undefined,
    summary: {
      passed: Number(summarySrc.passed || 0),
      failed: Number(summarySrc.failed || 0),
      skipped: Number(summarySrc.skipped || 0),
      error: Number(summarySrc.error || 0),
    },
    scenario_results: scenarioResults,
  }
}

export function normalizeIntegrationArtifactEnvelope(artifact: Record<string, any>): IntegrationArtifactEnvelope {
  const src = asObject(artifact)
  if ('manifest' in src || 'validation_assessment' in src || 'latest_full_run' in src || 'latest_focused_run' in src || 'latest_run' in src) {
    const manifestSrc = asObject(src.manifest)
    return {
      schema_version: typeof src.schema_version === 'number' ? src.schema_version : 1,
      manifest: {
        version: typeof manifestSrc.version === 'number' ? manifestSrc.version : 1,
        updated_at: typeof manifestSrc.updated_at === 'string' ? manifestSrc.updated_at : undefined,
        scenarios: Array.isArray(manifestSrc.scenarios)
          ? manifestSrc.scenarios.map((row, index) => normalizeManifestScenario(row, index))
          : [],
      },
      validation_assessment: {
        score: Number(asObject(src.validation_assessment).score || 0),
        criteria: Array.isArray(asObject(src.validation_assessment).criteria) ? asObject(src.validation_assessment).criteria : [],
        gaps: Array.isArray(asObject(src.validation_assessment).gaps) ? asObject(src.validation_assessment).gaps : [],
      },
      latest_full_run: normalizeRunReport(src.latest_full_run),
      latest_focused_run: normalizeRunReport(src.latest_focused_run),
      latest_run: normalizeRunReport(src.latest_run),
      test_report: asObject(src.test_report),
    }
  }

  const scenarios = Array.isArray(src.scenarios)
    ? src.scenarios.map((row, index) => normalizeManifestScenario(row, index))
    : []
  const legacyRunResults = Array.isArray(src.scenarios)
    ? src.scenarios.map((row, index) => normalizeRunResult(row, index))
    : []
  return {
    schema_version: 1,
    manifest: { version: 1, scenarios },
    validation_assessment: {
      score: Number(src.score || 0),
      criteria: Array.isArray(src.criteria) ? src.criteria : [],
      gaps: Array.isArray(src.gaps) ? src.gaps : [],
    },
    latest_full_run: legacyRunResults.length > 0 || src.passed || src.failed
      ? {
          scope: 'full',
          run_status: 'completed',
          summary: {
            passed: Number(src.passed || legacyRunResults.filter(row => row.status === 'passed').length),
            failed: Number(src.failed || legacyRunResults.filter(row => row.status !== 'passed').length),
            skipped: Number(src.skipped || 0),
            error: 0,
          },
          scenario_results: legacyRunResults,
        }
      : null,
    latest_focused_run: null,
    latest_run: null,
    test_report: asObject(src),
  }
}

function toPassedFailedStatus(status: ScenarioRunResult['status']): 'passed' | 'failed' {
  return status === 'passed' ? 'passed' : 'failed'
}

export function buildScenarioViewModels(artifact: Record<string, any>): TestScenario[] {
  const envelope = normalizeIntegrationArtifactEnvelope(artifact)
  const manifestScenarios = Array.isArray(envelope.manifest?.scenarios) ? envelope.manifest!.scenarios! : []
  const fullRun = envelope.latest_full_run
  const focusedRun = envelope.latest_focused_run

  const fullById = new Map<string, ScenarioRunResult>()
  const focusedById = new Map<string, ScenarioRunResult>()

  for (const row of fullRun?.scenario_results || []) {
    fullById.set(row.id, row)
    fullById.set(row.name, row)
  }
  for (const row of focusedRun?.scenario_results || []) {
    focusedById.set(row.id, row)
    focusedById.set(row.name, row)
  }

  if (manifestScenarios.length > 0) {
    return manifestScenarios.map((scenario, index) => {
      const focused = focusedById.get(scenario.id) || focusedById.get(scenario.name)
      const full = fullById.get(scenario.id) || fullById.get(scenario.name)
      const active = focused || full
      return {
        id: scenario.id,
        name: scenario.name || `TC${String(index + 1).padStart(3, '0')}`,
        description: scenario.description || scenario.name,
        status: toPassedFailedStatus(active?.status || 'failed'),
        execPath: scenario.execPath || active?.execPath || ['Run integration scenario'],
        inputParams: { ...(scenario.defaultInputParams || {}) },
        outputParams: {
          ...((active?.observedOutputs && Object.keys(active.observedOutputs).length > 0)
            ? active.observedOutputs
            : (scenario.expectedOutputs || {})),
        },
        defaultInputParams: { ...(scenario.defaultInputParams || {}) },
        expectedOutputs: { ...(scenario.expectedOutputs || {}) },
        observedOutputs: { ...(active?.observedOutputs || {}) },
        latestRunScope: focused ? 'scenario' : full ? 'full' : 'assessment',
        latestRunId: focused?.id || full?.id,
        failureExcerpt: active?.failure_excerpt,
      }
    })
  }

  const fallbackResults = focusedRun?.scenario_results || fullRun?.scenario_results || []
  return fallbackResults.map((row, index) => ({
    id: row.id,
    name: row.name || `TC${String(index + 1).padStart(3, '0')}`,
    description: row.description || row.name,
    status: toPassedFailedStatus(row.status),
    execPath: row.execPath || ['Run integration scenario'],
    inputParams: { ...(row.effectiveInputParams || {}) },
    outputParams: {
      ...((row.observedOutputs && Object.keys(row.observedOutputs).length > 0)
        ? row.observedOutputs
        : (row.expectedOutputs || {})),
    },
    defaultInputParams: { ...(row.effectiveInputParams || {}) },
    expectedOutputs: { ...(row.expectedOutputs || {}) },
    observedOutputs: { ...(row.observedOutputs || {}) },
    latestRunScope: focusedRun ? 'scenario' : 'legacy',
    latestRunId: row.id,
    failureExcerpt: row.failure_excerpt,
  }))
}

export function summarizeIntegrationArtifact(artifact: Record<string, any>) {
  const envelope = normalizeIntegrationArtifactEnvelope(artifact)
  const scenarios = buildScenarioViewModels(artifact)
  const fullSummary = envelope.latest_full_run?.summary
  const focusedSummary = envelope.latest_focused_run?.summary
  const artifactObj = asObject(artifact)
  const hasExplicitScore =
    ('score' in artifactObj) ||
    ('validation_assessment' in artifactObj && 'score' in asObject(artifactObj.validation_assessment))
  return {
    scenarios,
    score: hasExplicitScore ? Number(envelope.validation_assessment?.score || 0) : 0,
    validationScoreDefined: hasExplicitScore,
    scenarioCount: scenarios.length,
    fullRunSummary: {
      passed: Number(fullSummary?.passed || 0),
      failed: Number(fullSummary?.failed || 0),
      skipped: Number(fullSummary?.skipped || 0),
      error: Number(fullSummary?.error || 0),
    },
    focusedRunSummary: focusedSummary
      ? {
          passed: Number(focusedSummary.passed || 0),
          failed: Number(focusedSummary.failed || 0),
          skipped: Number(focusedSummary.skipped || 0),
          error: Number(focusedSummary.error || 0),
          scenarioId: envelope.latest_focused_run?.scenario_id,
        }
      : null,
  }
}
