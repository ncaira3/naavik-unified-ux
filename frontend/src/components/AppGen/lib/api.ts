/**
 * API client for communicating with the backend.
 */

// Route AppGen API calls through the Naavik backend (port 3000) where the proxy lives
const API_BASE = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:3000/appgen-api'
  : '/appgen-api'

// ---------------------------------------------------------------------------
// Auth token management
// ---------------------------------------------------------------------------

let _authToken: string | null = null

export function setAuthToken(token: string | null) {
  _authToken = token
  if (token) {
    localStorage.setItem('appgen_token', token)
  } else {
    localStorage.removeItem('appgen_token')
  }
}

export function getAuthToken(): string | null {
  if (_authToken) return _authToken
  _authToken = localStorage.getItem('appgen_token')
  return _authToken
}

/** Listeners that get called on 401 responses (token expired / invalid). */
const _onUnauthorizedCallbacks: Array<() => void> = []

export function onUnauthorized(cb: () => void) {
  _onUnauthorizedCallbacks.push(cb)
  return () => {
    const idx = _onUnauthorizedCallbacks.indexOf(cb)
    if (idx >= 0) _onUnauthorizedCallbacks.splice(idx, 1)
  }
}

function _fireUnauthorized() {
  _onUnauthorizedCallbacks.forEach((cb) => cb())
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

export async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  })

  if (response.status === 401) {
    _fireUnauthorized()
    throw new Error('Unauthorized')
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
    throw new Error(error.detail || `HTTP ${response.status}`)
  }

  return response.json()
}

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------

export const authApi = {
  login: (username: string, password: string) =>
    fetchApi<{ token: string; username: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  me: () => fetchApi<{ username: string }>('/auth/me'),
}

// ---------------------------------------------------------------------------
// File API
// ---------------------------------------------------------------------------

export const filesApi = {
  getTree: (sessionId: string = 'default', path: string = '') =>
    fetchApi<FileTree>(`/files/tree?session_id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`),

  readFile: (sessionId: string, path: string) =>
    fetchApi<{ path: string; content: string }>(
      `/files/read?session_id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`
    ),

  writeFile: (sessionId: string, path: string, content: string) =>
    fetchApi<{ path: string; size: number }>(
      `/files/write?session_id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`,
      {
      method: 'POST',
      body: JSON.stringify({ content }),
      }
    ),

  createFile: (sessionId: string, path: string, content: string = '') =>
    fetchApi<{ path: string }>(
      `/files/create?session_id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`,
      {
      method: 'POST',
      body: JSON.stringify({ content }),
      }
    ),

  deleteFile: (sessionId: string, path: string) =>
    fetchApi<{ path: string; deleted: boolean }>(
      `/files/delete?session_id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`,
      {
      method: 'DELETE',
      }
    ),

  createDirectory: (sessionId: string, path: string) =>
    fetchApi<{ path: string }>(
      `/files/directory?session_id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`,
      {
      method: 'POST',
      }
    ),

  resetWorkspace: (sessionId: string) =>
    fetchApi<{ reset: boolean }>(`/files/reset?session_id=${encodeURIComponent(sessionId)}`, {
      method: 'POST',
    }),

  getSummary: (sessionId: string) =>
    fetchApi<WorkspaceSummary>(`/files/summary?session_id=${encodeURIComponent(sessionId)}`),
}

// ---------------------------------------------------------------------------
// Preview API
// ---------------------------------------------------------------------------

export interface PreviewStatus {
  status: 'not_started' | 'building' | 'starting' | 'running' | 'stopped' | 'error'
  container_name?: string | null
  error?: string | null
}

export interface TerminalStatus {
  session_id: string
  workspace?: string | null
  connected: boolean
  available: boolean
  mode: 'sandbox' | 'local' | 'unavailable'
  reason?: string | null
}

export const previewApi = {
  start: (sessionId: string) =>
    fetchApi<PreviewStatus>(
      `/preview/start?session_id=${encodeURIComponent(sessionId)}`,
      { method: 'POST' }
    ),

  getStatus: (sessionId: string) =>
    fetchApi<PreviewStatus>(
      `/preview/${encodeURIComponent(sessionId)}/status`
    ),

  stop: (sessionId: string) =>
    fetchApi<{ stopped: boolean }>(
      `/preview/${encodeURIComponent(sessionId)}/stop`,
      { method: 'DELETE' }
    ),

  /** Return a proxy URL for the iframe / direct link.
   *  Fetches a short-lived opaque token so the JWT never appears in the URL. */
  getAppUrl: async (sessionId: string): Promise<string> => {
    const base = `${API_BASE}/preview/${encodeURIComponent(sessionId)}/app/docs`
    try {
      const data = await fetchApi<{ token: string }>(
        `/preview/${encodeURIComponent(sessionId)}/proxy-token`,
        { method: 'POST' }
      )
      return `${base}?ptoken=${encodeURIComponent(data.token)}`
    } catch {
      // Fallback: use JWT (old behaviour) if token endpoint fails
      const jwt = getAuthToken()
      return jwt ? `${base}?token=${encodeURIComponent(jwt)}` : base
    }
  },
}

export const terminalApi = {
  getStatus: (sessionId: string) =>
    fetchApi<TerminalStatus>(
      `/terminal/status/${encodeURIComponent(sessionId)}`
    ),
}

// Chat API
export const chatApi = {
  getHistory: (sessionId: string = 'default', limit?: number) => {
    const params = new URLSearchParams({ session_id: sessionId })
    if (limit) params.append('limit', limit.toString())
    return fetchApi<{ messages: ChatMessage[] }>(`/chat/history?${params}`, {
      cache: 'no-store',
    })
  },

  clearHistory: (sessionId: string = 'default') =>
    fetchApi<{ cleared: boolean }>(`/chat/history?session_id=${sessionId}`, {
      method: 'DELETE',
    }),
}

// Projects API
export const projectsApi = {
  list: () =>
    fetchApi<ProjectInfo[]>('/projects/list'),

  create: (name: string, description?: string) =>
    fetchApi<ProjectInfo>('/projects/create', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  get: (name: string) =>
    fetchApi<ProjectInfo>(`/projects/${encodeURIComponent(name)}`),

  delete: (name: string) =>
    fetchApi<{ deleted: boolean; name: string }>(`/projects/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),

  select: (name: string) =>
    fetchApi<{ selected: boolean; name: string; path: string }>(
      `/projects/${encodeURIComponent(name)}/select`,
      { method: 'POST' }
    ),
}

export const agentsApi = {
  list: () => fetchApi<{ agents: Array<{ id: string; name: string }> }>('/agents'),
}

export const sessionsApi = {
  getState: (sessionId: string) =>
    fetchApi<SessionAgentState>(`/sessions/${encodeURIComponent(sessionId)}/state`),
  runTests: (
    sessionId: string,
    options?: {
      scope?: 'unit' | 'functional' | 'all'
      scenario_ids?: string[]
      nodeids?: string[]
      input_overrides?: Record<string, unknown>
      use_saved_manifest?: boolean
    }
  ) =>
    fetchApi<{ status: string }>(`/sessions/${encodeURIComponent(sessionId)}/run-tests`, {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    }),
  /** Run integration tests headlessly (no chat). Returns when tests complete. */
  runIntegrationTests: (
    sessionId: string,
    options?: {
      scenario_id?: string
      input_overrides?: Record<string, unknown>
      use_saved_scenarios?: boolean
    }
  ) =>
    fetchApi<{ status: string }>(`/sessions/${encodeURIComponent(sessionId)}/run-integration-tests`, {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    }),
  saveTestingScenarioDefaults: (
    sessionId: string,
    scenarioId: string,
    defaultInputParams: Record<string, unknown>
  ) =>
    fetchApi<{ saved: boolean; scenario_id: string; default_input_params: Record<string, unknown> }>(
      `/sessions/${encodeURIComponent(sessionId)}/testing/scenarios/${encodeURIComponent(scenarioId)}/defaults`,
      {
        method: 'PATCH',
        body: JSON.stringify({ default_input_params: defaultInputParams }),
      }
    ),
  saveIntegrationScenarioDefaults: (
    sessionId: string,
    scenarioId: string,
    defaultInputParams: Record<string, unknown>
  ) =>
    fetchApi<{ saved: boolean; scenario_id: string; default_input_params: Record<string, unknown> }>(
      `/sessions/${encodeURIComponent(sessionId)}/integration-validation/scenarios/${encodeURIComponent(scenarioId)}/defaults`,
      {
        method: 'PATCH',
        body: JSON.stringify({ default_input_params: defaultInputParams }),
      }
    ),
  patchState: (sessionId: string, patch: Record<string, unknown>) =>
    fetchApi<SessionAgentState>(`/sessions/${encodeURIComponent(sessionId)}/state`, {
      method: 'PATCH',
      body: JSON.stringify({ patch }),
    }),
}

export const stagesApi = {
  getArtifact: (sessionId: string, stageName: string) =>
    fetchApi<Record<string, any>>(`/stages/${encodeURIComponent(sessionId)}/${encodeURIComponent(stageName)}/artifact`),
  listArtifacts: (sessionId: string) =>
    fetchApi<{ stages: string[]; session_id: string }>(`/stages/${encodeURIComponent(sessionId)}/artifacts`),
  saveArtifact: (sessionId: string, stageName: string, data: Record<string, any>) =>
    fetchApi<{ saved: boolean }>(`/stages/${encodeURIComponent(sessionId)}/${encodeURIComponent(stageName)}/artifact`, {
      method: 'POST',
      body: JSON.stringify({ data }),
    }),
}

function createIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const workflowApi = {
  getContext: (sessionId: string, timelineLimit: number = 40) =>
    fetchApi<WorkflowContextResponse>(
      `/workflow/context?session_id=${encodeURIComponent(sessionId)}&timeline_limit=${encodeURIComponent(String(timelineLimit))}`
    ),

  createRun: (body: {
    project_id: string
    session_id: string
    name?: string
    description?: string
  }) =>
    fetchApi<WorkflowRunCreateResponse>('/workflow/runs', {
      method: 'POST',
      headers: { 'Idempotency-Key': createIdempotencyKey('run') },
      body: JSON.stringify(body),
    }),

  getRunStatus: (runId: string) =>
    fetchApi<WorkflowRunStatusResponse>(`/workflow/runs/${encodeURIComponent(runId)}/status`),

  getRunTimeline: (runId: string, limit: number = 100) =>
    fetchApi<WorkflowRunTimelineResponse>(
      `/workflow/runs/${encodeURIComponent(runId)}/timeline?limit=${encodeURIComponent(String(limit))}`
    ),

  jumpPreview: (
    runId: string,
    stageName: string,
    body: { from_version: number; reason?: string }
  ) =>
    fetchApi<WorkflowJumpPreviewResponse>(
      `/workflow/runs/${encodeURIComponent(runId)}/stages/${encodeURIComponent(stageName)}/jump-preview`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    ),

  jumpStage: (
    runId: string,
    stageName: string,
    body: { from_version: number; reason?: string }
  ) =>
    fetchApi<WorkflowJumpStageResponse>(
      `/workflow/runs/${encodeURIComponent(runId)}/stages/${encodeURIComponent(stageName)}/jump`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': createIdempotencyKey('jump') },
        body: JSON.stringify(body),
      }
    ),

  commitChange: (
    runId: string,
    body: {
      source_stage: string
      change_type: 'plan_edit' | 'flowchart_edit' | 'code_edit' | 'artifact_edit'
      from_version: number
      reason?: string
    }
  ) =>
    fetchApi<WorkflowCommitChangeResponse>(
      `/workflow/runs/${encodeURIComponent(runId)}/changes/commit`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': createIdempotencyKey('commit') },
        body: JSON.stringify(body),
      }
    ),

  startStage: (
    runId: string,
    stageName: string,
    body: { from_version: number; trigger?: 'user' | 'auto' }
  ) =>
    fetchApi<WorkflowStageStartResponse>(
      `/workflow/runs/${encodeURIComponent(runId)}/stages/${encodeURIComponent(stageName)}/start`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': createIdempotencyKey('start') },
        body: JSON.stringify(body),
      }
    ),

  completeStage: (
    runId: string,
    stageName: string,
    body: {
      from_version: number
      status?: 'succeeded' | 'failed' | 'cancelled'
      stage_run_id: string
      error_code?: string
      error_message?: string
    }
  ) =>
    fetchApi<WorkflowStageCompleteResponse>(
      `/workflow/runs/${encodeURIComponent(runId)}/stages/${encodeURIComponent(stageName)}/complete`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': createIdempotencyKey('complete') },
        body: JSON.stringify(body),
      }
    ),

  advanceStage: (
    runId: string,
    stageName: string,
    body: { from_version: number; note?: string }
  ) =>
    fetchApi<WorkflowStageAdvanceResponse>(
      `/workflow/runs/${encodeURIComponent(runId)}/stages/${encodeURIComponent(stageName)}/advance`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': createIdempotencyKey('advance') },
        body: JSON.stringify(body),
      }
    ),

  retryStage: (
    runId: string,
    stageName: string,
    body: { from_version: number; reason?: string }
  ) =>
    fetchApi<WorkflowStageRetryResponse>(
      `/workflow/runs/${encodeURIComponent(runId)}/stages/${encodeURIComponent(stageName)}/retry`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': createIdempotencyKey('retry') },
        body: JSON.stringify(body),
      }
    ),
}

export const policiesApi = {
  get: (stageName: string, sessionId: string) =>
    fetchApi<{ content: string; source: string; stage: string }>(
      `/policies/${encodeURIComponent(stageName)}?session_id=${encodeURIComponent(sessionId)}`
    ),
}

export const specApi = {
  get: (sessionId: string) =>
    fetchApi<SpecApiResponse>(`/spec/${encodeURIComponent(sessionId)}`),
  patch: (sessionId: string, operations: SpecPatchOperation[]) =>
    fetchApi<any>(`/spec/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ operations }),
    }),
  approve: (sessionId: string, version?: number) =>
    fetchApi<any>(`/spec/${encodeURIComponent(sessionId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ version }),
    }),
  reject: (sessionId: string, note: string = '') =>
    fetchApi<any>(`/spec/${encodeURIComponent(sessionId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  saveFlowchart: (sessionId: string, flowchart: FlowchartGraphV1) =>
    fetchApi<any>(`/spec/${encodeURIComponent(sessionId)}/flowchart`, {
      method: 'PUT',
      body: JSON.stringify({ flowchart }),
    }),
}

// Types
export interface FileTree {
  name: string
  type: 'file' | 'directory'
  path: string
  extension?: string | null
  children?: FileTree[]
}

export interface WorkspaceSummary {
  total_files: number
  total_size: number
  files: Array<{
    path: string
    size: number
    extension?: string | null
  }>
}

export interface ChatMessage {
  id: number
  session_id: string
  role: 'user' | 'assistant'
  content: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface AgentEvent {
  event_type:
    | 'planning'
    | 'executing'
    | 'tool_start'
    | 'tool_result'
    | 'file_change'
    | 'summary'
    | 'text'
    | 'error'
    | 'clarification_needed'
    | 'waiting_for_user'
    | 'plan_update'
    | 'spec_status'
    | 'approval_required'
    | 'stage_transition'
  content: string
  metadata?: Record<string, any>
  timestamp?: string
}

export interface ProjectInfo {
  name: string
  path: string
  created_at?: string
  modified_at?: string
  file_count: number
  size: number
}

export interface SpecSection {
  id: string
  title: string
  content: string
}

export interface PlanDocumentV1 {
  version: number
  updated_at?: string
  sections: SpecSection[]
  metadata?: Record<string, unknown>
}

export interface FlowchartGraphV1 {
  nodes: Array<Record<string, unknown>>
  edges: Array<Record<string, unknown>>
  viewport?: Record<string, unknown>
}

export interface SessionAgentState {
  current_phase: 'planning' | 'coding' | string
  last_viewed_stage?: string
  plan_state:
    | 'draft'
    | 'needs_requirements_confirmation'
    | 'needs_arch_review'
    | 'ready_for_approval'
    | 'approved'
    | 'rejected'
    | string
  schema_strategy: 'yang_tree' | 'schema_runtime' | 'schema_rag' | string
  schema_strategy_source?: string
  latest_spec_version: number
  conversation_summary?: string
  workflow_run_id?: string
  workflow_version?: number
  workflow_bootstrap_nonce?: string
  /** UTC ISO-8601 timestamp of last successful Workflow→DAL projection sync. */
  workflow_last_synced_at?: string
  /** When true, mirrored phase/version may lag Workflow (e.g. status fetch failed). */
  workflow_projection_stale?: boolean
  updated_at?: string
}

export interface WorkflowRunCreateResponse {
  run_id: string
  project_id: string
  session_id: string
  status: string
  current_stage: string
  version: number
  created_at: string
}

export interface WorkflowStageSnapshot {
  stage_name: string
  latest_stage_run_id?: string | null
  latest_success_stage_run_id?: string | null
  status: string
  is_stale: boolean
  attempt: number
  updated_at: string
}

export interface WorkflowRunStatusResponse {
  run_id: string
  project_id: string
  session_id: string
  status: string
  current_stage: string
  version: number
  stages: WorkflowStageSnapshot[]
  updated_at: string
}

export interface WorkflowTimelineEvent {
  event_id: string
  event_type: string
  run_id: string
  stage_name?: string | null
  stage_run_id?: string | null
  metadata?: Record<string, unknown>
  timestamp: string
}

export interface WorkflowRunTimelineResponse {
  run_id: string
  timeline: WorkflowTimelineEvent[]
}

export interface WorkflowContextResponse {
  run_id: string
  status: WorkflowRunStatusResponse
  timeline: WorkflowTimelineEvent[]
  timeline_error?: string | null
}

export interface WorkflowJumpPreviewResponse {
  run_id: string
  target_stage: string
  from_stage: string
  will_invalidate: string[]
  blocked_stages_after_jump: string[]
  requires_confirmation: boolean
}

export interface WorkflowCommitChangeResponse {
  committed: boolean
  run_id: string
  new_version: number
  invalidated_stages: string[]
  invalidation_event_id: string
}

export interface WorkflowJumpStageResponse {
  jumped: boolean
  run_id: string
  from_stage: string
  to_stage: string
  invalidated_stages: string[]
  invalidation_event_id: string
  new_version: number
}

export interface WorkflowStageStartResponse {
  accepted: boolean
  run_id: string
  stage_name: string
  stage_run_id: string
  status: 'queued' | 'running'
}

export interface WorkflowStageRetryResponse {
  accepted: boolean
  run_id: string
  stage_name: string
  stage_run_id: string
  attempt: number
  status: 'queued' | 'running'
}

export interface WorkflowStageCompleteResponse {
  completed: boolean
  run_id: string
  stage_name: string
  stage_run_id: string
  status: 'succeeded' | 'failed' | 'cancelled'
  new_version: number
}

export interface WorkflowStageAdvanceResponse {
  advanced: boolean
  run_id: string
  from_stage: string
  to_stage: string
  approval_id: string
  new_version: number
}

export interface SpecApiResponse {
  session_id: string
  document: {
    state: PlanDocumentV1
    markdown: string
    flowchart: FlowchartGraphV1
  }
  session_state: SessionAgentState
}

export interface SpecPatchOperation {
  op: 'add' | 'update' | 'append' | 'delete' | 'move'
  section_id?: string
  section?: Partial<SpecSection>
  before_id?: string
  after_id?: string
  content?: string
  title?: string
}

function getWebSocketUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = getAuthToken()
  const separator = path.includes('?') ? '&' : '?'
  const tokenParam = token ? `${separator}token=${encodeURIComponent(token)}` : ''
  return `${protocol}//${window.location.host}${path}${tokenParam}`
}

// WebSocket helpers
export function createChatWebSocket(
  sessionId: string = 'default',
  agentId: string = 'planning',
  onMessage: (data: ChatWebSocketMessage) => void,
  onError?: (error: Event) => void,
  onClose?: () => void
): WebSocket {
  const ws = new WebSocket(
    getWebSocketUrl(
      `/appgen-api/agents/${encodeURIComponent(agentId)}/ws/${encodeURIComponent(sessionId)}`
    )
  )

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      onMessage(data)
    } catch {
      // non-JSON message — ignore
    }
  }

  ws.onerror = (error) => {
    onError?.(error)
  }

  ws.onclose = () => {
    onClose?.()
  }

  return ws
}

export function createTerminalWebSocketUrl(sessionId: string): string {
  return getWebSocketUrl(`/appgen-api/terminal/ws/${encodeURIComponent(sessionId)}`)
}

export interface ClarificationOption {
  key: string
  value: string
  description?: string
}

export interface ClarificationQuestion {
  id: string
  text: string
  selection_mode: 'single_choice' | 'multi_choice'
  options: ClarificationOption[]
  allow_free_text?: boolean
  allow_skip?: boolean
  min_select?: number
  max_select?: number | null
  placeholder?: string
}

export interface ClarificationAnswerV2 {
  question_id: string
  selected_option_keys: string[]
  free_text?: string
  skipped?: boolean
}

export interface ClarificationResponseV2 {
  clarification_id: string
  answers: ClarificationAnswerV2[]
}

export interface ChatWebSocketMessage {
  type:
    | 'chunk'
    | 'event'
    | 'complete'
    | 'error'
    | 'pong'
    | 'clarification'
    | 'clarification_response'
  content?: string
  event?: AgentEvent
  questions?: ClarificationQuestion[]
  clarification_id?: string
  response?: ClarificationResponseV2
  metadata?: Record<string, unknown>
}

export function sendChatMessage(ws: WebSocket, content: string, agentId?: string, csvMetadata?: Record<string, any>) {
  if (ws.readyState === WebSocket.OPEN) {
    const payload: Record<string, any> = { type: 'message', content }
    if (agentId) payload.agent_id = agentId
    if (csvMetadata) payload.csv_metadata = csvMetadata
    ws.send(JSON.stringify(payload))
  }
}

export function sendClarificationResponse(
  ws: WebSocket,
  response: ClarificationResponseV2,
  displayContent?: string,
  agentId?: string
) {
  if (ws.readyState === WebSocket.OPEN) {
    const payload: {
      type: string
      response: ClarificationResponseV2
      display_content?: string
      agent_id?: string
    } = {
      type: 'clarification_response',
      response,
    }
    if (agentId) {
      payload.agent_id = agentId
    }
    if (displayContent != null && displayContent !== '') {
      payload.display_content = displayContent
    }
    ws.send(JSON.stringify(payload))
  }
}
