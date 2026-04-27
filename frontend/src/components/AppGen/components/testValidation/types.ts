export interface ScenarioDefinition {
  id: string
  name: string
  description: string
  execPath: string[]
  defaultInputParams?: Record<string, number | string | boolean>
  expectedOutputs?: Record<string, number | string | boolean>
  testRef?: {
    runner?: string
    pytest_nodeid?: string
    test_file?: string
  }
}

export interface ScenarioRunResult {
  id: string
  name: string
  description: string
  status: 'passed' | 'failed' | 'skipped' | 'error' | 'not_run' | 'mapping_missing' | 'unmapped'
  execPath: string[]
  effectiveInputParams?: Record<string, number | string | boolean>
  expectedOutputs?: Record<string, number | string | boolean>
  observedOutputs?: Record<string, number | string | boolean>
  duration_ms?: number
  failure_excerpt?: string
}

export interface IntegrationRunReport {
  test_run_id?: string
  run_status?: 'running' | 'completed' | 'failed' | 'error'
  scope?: 'full' | 'scenario' | string
  scenario_id?: string
  manifest_version?: number
  started_at?: string
  completed_at?: string
  summary?: {
    passed?: number
    failed?: number
    skipped?: number
    error?: number
  }
  scenario_results?: ScenarioRunResult[]
}

export interface ValidationAssessment {
  score?: number
  criteria?: Array<Record<string, any>>
  gaps?: string[]
}

export interface IntegrationArtifactEnvelope {
  schema_version?: number
  manifest?: {
    version?: number
    updated_at?: string
    scenarios?: ScenarioDefinition[]
  }
  validation_assessment?: ValidationAssessment
  latest_full_run?: IntegrationRunReport | null
  latest_focused_run?: IntegrationRunReport | null
  latest_run?: IntegrationRunReport | null
  test_report?: Record<string, any>
}

export interface TestScenario {
  id: string
  name: string
  description: string
  status: 'passed' | 'failed' | 'not_run'
  execPath: string[]
  inputParams?: Record<string, number | string | boolean>
  outputParams?: Record<string, number | string | boolean>
  defaultInputParams?: Record<string, number | string | boolean>
  expectedOutputs?: Record<string, number | string | boolean>
  observedOutputs?: Record<string, number | string | boolean>
  latestRunScope?: 'full' | 'scenario' | 'legacy' | 'assessment'
  latestRunId?: string
  failureExcerpt?: string
}
