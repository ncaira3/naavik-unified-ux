import type { TestScenario } from '../testValidation/types'


function asObject(value: unknown): Record<string, any> {
  return typeof value === 'object' && value !== null ? (value as Record<string, any>) : {}
}

function normalizeMap(value: unknown): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {}
  for (const [key, raw] of Object.entries(asObject(value))) {
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      out[key] = raw
    }
  }
  return out
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

export function getUnitArtifact(testingArtifact: Record<string, any> | null): Record<string, any> {
  const artifact = asObject(testingArtifact)
  const report = asObject(artifact.report)
  const unit = asObject(report.unit)
  const summary = asObject(unit.summary)
  const latestRun = asObject(artifact.latest_run)
  const latestFullRun = asObject(artifact.latest_full_run)
  const unitResults = asArray(latestRun.unit_results).length > 0
    ? asArray(latestRun.unit_results)
    : asArray(latestFullRun.unit_results)

  const passed = Number(summary.passed || 0) || unitResults.filter((row) => String(asObject(row).status || '').toLowerCase() === 'passed').length
  const failed = Number(summary.failed || 0) || unitResults.filter((row) => {
    const status = String(asObject(row).status || '').toLowerCase()
    return status !== 'passed' && status !== 'skipped'
  }).length
  const skipped = Number(summary.skipped || 0) || unitResults.filter((row) => String(asObject(row).status || '').toLowerCase() === 'skipped').length

  return {
    passed,
    failed,
    skipped,
    coverage: Number(summary.coverage || 0),
    details: asArray(unit.details).length > 0 ? asArray(unit.details) : unitResults,
    file_coverage: asArray(unit.file_coverage),
    test_files: asArray(unit.test_files),
  }
}

export function getFunctionalScenarios(testingArtifact: Record<string, any> | null): TestScenario[] {
  const artifact = asObject(testingArtifact)
  const manifestScenarios = asArray(asObject(asObject(artifact.manifest).functional).scenarios)
  const reportScenarios = asArray(asObject(asObject(asObject(artifact.report).functional)).scenarios)
  const reportById = new Map<string, Record<string, any>>()
  for (const row of reportScenarios) {
    if (row && typeof row === 'object') {
      const obj = row as Record<string, any>
      reportById.set(String(obj.id || obj.name || ''), obj)
    }
  }
  if (manifestScenarios.length === 0) {
    return reportScenarios.map((row: any, index: number) => {
      const scenario = asObject(row)
      const id = String(scenario.id || scenario.name || `TC${String(index + 1).padStart(3, '0')}`)
      const rawStatus = String(scenario.status || '').toLowerCase()
      const status: TestScenario['status'] = rawStatus === 'passed' ? 'passed' : rawStatus === 'failed' ? 'failed' : 'not_run'
      return {
        id,
        name: String(scenario.name || id),
        description: String(scenario.description || scenario.name || id),
        status,
        execPath: Array.isArray(scenario.execPath) ? scenario.execPath.map((step: unknown) => String(step)) : ['Run functional scenario'],
        inputParams: normalizeMap(scenario.defaultInputParams),
        outputParams: {
          ...(Object.keys(normalizeMap(scenario.observedOutputs)).length > 0
            ? normalizeMap(scenario.observedOutputs)
            : normalizeMap(scenario.expectedOutputs)),
        },
        defaultInputParams: normalizeMap(scenario.defaultInputParams),
        expectedOutputs: normalizeMap(scenario.expectedOutputs),
        observedOutputs: normalizeMap(scenario.observedOutputs),
        latestRunScope: 'full',
        latestRunId: id,
        failureExcerpt: typeof scenario.failure_excerpt === 'string' ? scenario.failure_excerpt : undefined,
      }
    })
  }
  return manifestScenarios.map((row: any, index: number) => {
    const scenario = asObject(row)
    const id = String(scenario.id || scenario.name || `TC${String(index + 1).padStart(3, '0')}`)
    const reported = reportById.get(id) || {}
    // No entry in the run report means the scenario has never been executed.
    const hasRunResult = Object.keys(reported).length > 0
    const rawStatus = String(reported.status || '').toLowerCase()
    const status: TestScenario['status'] = !hasRunResult
      ? 'not_run'
      : rawStatus === 'passed'
        ? 'passed'
        : 'failed'
    return {
      id,
      name: String(scenario.name || id),
      description: String(scenario.description || scenario.name || id),
      status,
      execPath: Array.isArray(scenario.execPath) ? scenario.execPath.map((step: unknown) => String(step)) : ['Run functional scenario'],
      inputParams: normalizeMap(scenario.defaultInputParams),
      outputParams: {
        ...(Object.keys(normalizeMap(reported.observedOutputs)).length > 0
          ? normalizeMap(reported.observedOutputs)
          : normalizeMap(scenario.expectedOutputs)),
      },
      defaultInputParams: normalizeMap(scenario.defaultInputParams),
      expectedOutputs: normalizeMap(scenario.expectedOutputs),
      observedOutputs: normalizeMap(reported.observedOutputs),
      latestRunScope: 'full',
      latestRunId: id,
      failureExcerpt: typeof reported.failure_excerpt === 'string' ? reported.failure_excerpt : undefined,
    }
  })
}

export function getCriteriaRows(testingArtifact: Record<string, any> | null): Array<Record<string, any>> {
  const functional = asObject(asObject(asObject(testingArtifact).report).functional)
  return Array.isArray(functional.criteria) ? functional.criteria : []
}

export function getFunctionalSummary(testingArtifact: Record<string, any> | null) {
  const artifact = asObject(testingArtifact)
  const summary = asObject(asObject(asObject(artifact.report).functional).summary)
  const scenarios = getFunctionalScenarios(testingArtifact)
  return {
    passed: Number(summary.passed || 0) || scenarios.filter((row) => row.status === 'passed').length,
    failed: Number(summary.failed || 0) || scenarios.filter((row) => row.status === 'failed').length,
    skipped: Number(summary.skipped || 0),
    error: Number(summary.error || 0),
  }
}
