// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}

// Auth types
export interface LoginRequest {
  username: string;
  password: string;
}

export interface User {
  id: string;
  username: string;
  role: string;
}

export interface AuthResponse {
  token: string;
  user: User;
  expiresIn: string;
}

// Intent types
export type IntentType = 
  | 'OBSERVE'
  | 'ANALYZE_RCA'
  | 'BUILD_APP'
  | 'PROVISION'
  | 'QUERY_DB'
  | 'ANALYZE_DATA'
  | 'SHOW_MAP'
  | 'CREATE_DASHBOARD'
  | 'CREATE_WORKFLOW'
  | 'GENERATE_CODE'
  | 'UNKNOWN';

export interface ParsedIntent {
  intent: IntentType;
  confidence: number;
  chainOfThought: string[];
  filters: Record<string, any>;
  actionParams?: Record<string, any>;
  executionTime: number;
}

// UI command (LLM → actions) types
export type UiCommandAction =
  // ── Existing ──────────────────────────────────────────────────────────────
  | { type: 'MAP_FOCUS_SITE'; siteToken: string; openAnalysis?: boolean }
  | { type: 'SHOW_SITE_STATS'; siteToken?: string }
  | { type: 'EXPLAIN_RCA'; siteToken?: string }
  | { type: 'SHOW_CAPABILITIES' }
  // ── Generative UI: tab + view navigation ──────────────────────────────────
  /** Open a specific top-level tab in ObserveSiteAnalysisTile */
  | { type: 'OPEN_SITE_TAB'; tab: 'site-kpi' | 'rca' | 'operational' | 'topology'; siteToken?: string }
  /** Open a specific KPI sub-tab inside Site KPI */
  | { type: 'OPEN_KPI_TAB'; kpiTab: 'cqx' | 'daily' | 'hourly' | 'overlay' | 'traffic-profile' | 'mobility' | 'outages'; siteToken?: string }
  /** Open a specific sub-tab inside the RCA panel */
  | { type: 'OPEN_RCA_TAB'; rcaTab: 'evidences' | 'summary' | 'raw-data'; siteToken?: string }
  /** Switch the analysis panel to diagnostic (full KPI) mode */
  | { type: 'OPEN_DIAGNOSTIC'; siteToken?: string }
  // ── Generative UI: map state ───────────────────────────────────────────────
  /** Change the map's selected date */
  | { type: 'SET_DATE_FILTER'; dateId: string }
  /** Switch the active site layer (degraded / outage / overutilized) */
  | { type: 'SET_MAP_LAYER'; layer: 'degraded' | 'outage' | 'overutilized' }
  // ── Generative UI: app navigation ─────────────────────────────────────────
  /** Navigate to a top-level app view */
  | { type: 'NAVIGATE_VIEW'; view: 'observe' | 'appgen' | 'provision' | 'settings' | 'home' };

export interface UiCommandResult {
  assistantText: string;
  actions: UiCommandAction[];
  followUpQuestions?: string[];
  capabilities?: Array<{ id: string; label: string; examples: string[] }>;
}

// Agent types
export type AgentName = 'OBSERVATION' | 'REASONING' | 'PERCEPTION' | 'SENSING';
export type AgentStatus = 'IDLE' | 'WORKING' | 'COMPLETE' | 'ERROR';

export interface AgentActivity {
  workflowId: string;
  agentName: AgentName;
  status: AgentStatus;
  progress: number;
  findings: string[];
  startedAt: string;
  completedAt?: string;
}

export interface AgentWorkflow {
  workflowId: string;
  workflowType: string;
  agents: AgentActivity[];
  finalResult: any;
  totalDuration: number;
}

// Visualization types
export interface ChartData {
  type: 'line' | 'bar' | 'pie' | 'scatter';
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string;
  }>;
}

export interface MapSite {
  siteId: string;
  siteName: string;
  latitude: number;
  longitude: number;
  cellCount: number;
  status: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'OUTAGE';
  anomalyCount: number;
  hasActiveTickets: boolean;
}

export interface ProvisioningCandidateSite {
  siteId: string;
  siteName: string;
  latitude: number;
  longitude: number;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  status: 'READY';
  anchorSiteA: string;
  anchorSiteB: string;
  technology: string;
  bandPlan: string;
  oem: string;
  softwareVersion: string;
}

export interface QueryResult {
  sql?: string;
  rows: any[];
  rowCount: number;
  executionTime: number;
}

export interface Visualization {
  type: 'chart' | 'map' | 'map_inset' | 'table' | 'code' | 'code_view' | 'grid' | 'rca_story' | 'ticket_escalation' | 'kpi_dashboard' | 'chat_kpi_dashboard' | 'saved_dashboards' | 'knowledge_report' | 'insight_chart' | 'open_query_dashboard';
  data: any;
  config?: any;
}

// =====================================================
// Generative UI blocks (LLM → UI)
// =====================================================
export type UiSurface = 'chat' | 'page';

export type UiBlockType =
  | 'section'
  | 'grid_layout'
  | 'tabs'
  | 'split_pane'
  | 'modal_drawer'
  | 'callout'
  | 'text'
  | 'chips'
  | 'badge'
  | 'stat_row'
  | 'copyable_text'
  | 'progress'
  | 'data_table'
  | 'ranked_list'
  | 'pivot_table'
  | 'compare_table'
  | 'data_export'
  | 'line_chart'
  | 'area_chart'
  | 'bar_chart'
  | 'combo_chart'
  | 'histogram'
  | 'boxplot'
  | 'scatter_plot'
  | 'correlation_matrix'
  | 'calendar_heatmap'
  | 'kpi_card'
  | 'kpi_dashboard'
  | 'map_inset'
  | 'map_full'
  | 'legend'
  | 'layer_toggle'
  | 'map_focus'
  | 'map_highlight'
  | 'map_filter'
  | 'rca_story'
  | 'evidence_stack'
  | 'rca_link_lines'
  | 'neighbor_context'
  | 'outage_timeline'
  | 'traffic_profile'
  | 'site_summary_header'
  | 'execution_status'
  | 'ticket_escalation'
  | 'parameter_change_review'
  | 'app_launcher'
  | 'app_embed'
  | 'audit_log'
  | 'attachment_preview'
  | 'attachment_question'
  | 'code_view'
  | 'insight_chart'
  | 'rca_summary'
  | 'rca_report';

export interface UiBlockBase {
  type: UiBlockType;
  id?: string;
  title?: string;
}

export type UiBlock =
  | (UiBlockBase & { type: 'text'; data: { text: string } })
  | (UiBlockBase & { type: 'callout'; data: { tone: 'info' | 'success' | 'warning' | 'error'; title?: string; text: string } })
  | (UiBlockBase & { type: 'chips'; data: { prompt?: string; chips: Array<{ label: string; value: string; description?: string }> } })
  | (UiBlockBase & { type: 'stat_row'; data: { items: Array<{ label: string; value: string; hint?: string }> } })
  | (UiBlockBase & { type: 'data_table'; data: { title?: string; rows: Array<Record<string, any>>; rowTooltipField?: string } })
  | (UiBlockBase & { type: 'ranked_list'; data: { title?: string; items: Array<{ title: string; subtitle?: string; value?: string; severity?: 'low' | 'med' | 'high'; trend?: number[] }> } })
  | (UiBlockBase & { type: 'section'; data: { description?: string; blocks: UiBlock[] } })
  | (UiBlockBase & { type: 'grid_layout'; data: { columns?: number; blocks: Array<{ span?: number; block: UiBlock }> } })
  | (UiBlockBase & { type: 'tabs'; data: { tabs: Array<{ id: string; label: string; blocks: UiBlock[] }> } })
  // Bridged blocks that reuse existing visualization rendering
  | (UiBlockBase & { type: 'map_inset'; data: Visualization['data'] })
  | (UiBlockBase & { type: 'kpi_dashboard'; data: { siteId: string } })
  | (UiBlockBase & { type: 'rca_story'; data: any })
  | (UiBlockBase & { type: 'ticket_escalation'; data: any })
  | (UiBlockBase & { type: 'execution_status'; data: any })
  | (UiBlockBase & { type: 'code_view'; data: { code: string; language?: string } })
  | (UiBlockBase & { type: 'insight_chart'; data: { title?: string; subtitle?: string; source?: string; height?: number; echartsOption: Record<string, any> } })
  | (UiBlockBase & { type: 'rca_summary'; data: any })
  | (UiBlockBase & { type: 'rca_report'; data: any });

// Chat message types
export interface ChoiceButton {
  label: string;
  choiceId: string;
}

export type ChatAttachmentKind = 'csv' | 'image';

export interface ChatAttachment {
  kind: ChatAttachmentKind;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  /**
   * For CSV/text attachments, the (possibly truncated) text content.
   * Keep small; backend will further truncate.
   */
  text?: string;
  /**
   * For images, a data URL (data:<mime>;base64,...) for vision-capable models.
   * Keep small (<= ~1MB).
   */
  dataUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  attachments?: ChatAttachment[];
  uiSurface?: UiSurface;
  uiBlocks?: UiBlock[];
  intent?: ParsedIntent;
  workflow?: AgentWorkflow;
  isLoading?: boolean;
  reportData?: ReportData;
  actionButtons?: ActionButton[];
  choiceButtons?: ChoiceButton[];
  executionStatus?: ExecutionStatus;
  visualization?: Visualization;
  queryResult?: QueryResult;
}

// Automation types
export interface ReportData {
  type: string;
  summary: Record<string, any>;
  details: Record<string, any[]>;
  visualizations?: Record<string, any>;
}

export interface ActionButton {
  actionId: string;
  actionName: string;
  label: string;
  style: 'primary' | 'secondary' | 'warning' | 'danger';
  icon?: string;
  appId?: string;
  context: any;
  estimatedDuration?: number;
  riskLevel?: 'low' | 'medium' | 'high';
}

export interface ExecutionStatus {
  executionId: string;
  status: 'running' | 'completed' | 'failed' | 'queued';
  message?: string;
  progress?: number;
  requestId?: string;
  siteId?: string;
  parameter?: string;
  value?: string;
  unit?: string;
  handshakeRequired?: boolean;
  steps?: Array<{
    key: string;
    label: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'queued';
    detail?: string;
  }>;
  affectedSites?: number;
  affectedCells?: number;
  results?: any[];
  duration?: number;
}

// Canvas App types
export interface CanvasPanel {
  id: string;
  type: 'chart' | 'map' | 'table';
  title: string;
  size: 'small' | 'medium' | 'large' | 'full';
  dataSource: string;
  config: Record<string, any>;
}

export interface CanvasAppConfig {
  appType: 'canvas';
  title: string;
  description?: string;
  panels: CanvasPanel[];
}

// App Generation types
export interface GeneratedApp {
  appId: string;
  appName: string;
  description: string | null;
  naturalLanguageInput: string | null;
  generatedCode: string | null;
  workflowJson: any | null;
  moClasses: string[] | null;
  parametersUsed: string[] | null;
  kpisUsed: string[] | null;
  status: 'draft' | 'validated' | 'deployed' | 'running' | 'failed' | 'archived';
  deploymentTarget: string;
  createdBy: string | null;
  isPredefined: boolean;
  executionCount: number;
  lastExecutedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Workflow types (React Flow compatible)
export interface WorkflowNode {
  id: string;
  type: 'start' | 'loop' | 'condition' | 'action' | 'end';
  position: { x: number; y: number };
  data: {
    label: string;
    [key: string]: any;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: string;
}

export interface WorkflowJSON {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// Parameter types
export interface Parameter {
  parameterId: number;
  model: string | null;
  moClass: string | null;
  parameterName: string;
  parameterDescription: string | null;
  dataType: string | null;
  rangeValues: string | null;
  defaultValue: string | null;
  unit: string | null;
  readOnly: boolean;
  mandatory: boolean;
  deprecated: boolean;
}

// Conversational Builder V1 types
export interface DisambiguationOption {
  id: string;
  type: 'parameter' | 'kpi' | 'mo_parameter';
  displayLabel: string;
  canonicalName: string;
  moClass?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface DisambiguationPayload {
  type: 'parameter' | 'kpi' | 'mo_parameter';
  slotKey: string;
  prompt: string;
  options: DisambiguationOption[];
}

export interface ClarificationQuestion {
  id: string;
  text: string;
  selectionMode: 'single_choice' | 'multi_choice' | 'free_text';
  options?: { key: string; value: string }[];
  allowFreeText?: boolean;
  allowSkip?: boolean;
  placeholder?: string;
}

export interface ClarificationPayload {
  questions: ClarificationQuestion[];
}

export interface BuilderSlot {
  key: string;
  label: string;
  status: 'missing' | 'resolved' | 'ambiguous' | 'confirmed';
  value?: string | number | boolean | null;
  canonicalValue?: string;
  unit?: string;
  required: boolean;
}

export interface BuilderArtifact {
  type: 'workflow_json' | 'eiap_code' | 'rapp_package';
  status: 'created' | 'validated' | 'failed';
  filePath?: string;
  metadata?: Record<string, unknown>;
}

export interface BuilderState {
  threadId: string;
  scenarioType: 'prb_qrxlevmin_v1';
  channel: 'appstore' | 'main_chat';
  status: 'active' | 'completed' | 'reset' | 'archived';
  canGenerate: boolean;
  slots: BuilderSlot[];
  pendingSlots: string[];
  disambiguation?: DisambiguationPayload | null;
  artifacts?: BuilderArtifact[];
  workflowJson?: Record<string, unknown>;
  eiapCode?: string;
}

export interface BuilderChatResponse {
  threadId: string;
  assistantMessage: string;
  state: BuilderState;
  pendingSlots: string[];
  canGenerate: boolean;
  disambiguation?: DisambiguationPayload | null;
  artifacts?: BuilderArtifact[];
  clarification?: ClarificationPayload | null;
}

export interface AppGenChoice {
  id: string;
  label: string;
  value: string;
  confidence?: number;
  action?: 'chat' | 'authorize_generate' | 'refine';
}

export interface AppGenAgentChatResponse extends BuilderChatResponse {
  channel: 'home_build' | 'appgen_chat';
  choices?: AppGenChoice[];
  authorizationToken?: string;
  clarification?: ClarificationPayload | null;
}

export interface AppGenSettings {
  enabledOems: string[];
}

// Observe site analysis tile
export type CellKpiViewType = 'daily' | 'hourly' | 'timeline' | 'overlay';

export interface SiteAnalysisPayload {
  usid: string;
  dateId: string;
  topology: {
    siteName: string;
    latitude: number | null;
    longitude: number | null;
    district: string;
    zoneId: string;
    zoneEngineer: string;
    engineerUid: string;
    managerUid: string;
    market: string;
    siteType: string;
    structureType: string;
    cellCount: number | null;
    county: string;
    city: string;
    state: string;
    streetAddress: string;
    zip: string;
    clusterId: string;
    clusterName: string;
  };
  strongestFactors: unknown[];
  rca: {
    bucket: string;
    shortSummary: Record<string, unknown>;
    longSummary: string;
    rcaSummary: string;
    chainOfThought: unknown[];
    confidenceScore: number | null;
    confidenceScoreInt: number | null;
    solutionRecommendation: string;
    solutionSummary: string;
    degradedCategory: string;
    rcaTraversal: unknown;
  };
  intuitions: Record<string, unknown>;
  summaries: {
    kpi: string;
    ticket: string;
    alarm: string;
    neighbor: string;
    parameter: string;
    outage: string;
  };
  outage: {
    flag: boolean;
    timestamp: string;
  };
  metadata: {
    runTimeSeconds: number | null;
    tokenAndCostUsage: unknown;
    updateTime: string;
    anomalyFlag: boolean;
    anomalyScore: number | null;
  };
}

export interface CellTopologyRow {
  cellName: string;
  azimuth: number | null;
  height: number | null;
  latitude: number | null;
  longitude: number | null;
  technology: string;
  useId: string;
  usid: string;
  carrier: string;
  dateId: string;
}

export interface SiteTopologyPayload {
  usid: string;
  dateId: string;
  cellTopology: CellTopologyRow[];
}

export interface CellKpiSeriesRow {
  usid: string;
  dateId: string;
  hourId: number | null;
  cellName: string;
  kpiName: string;
  kpiValue: number | null;
  isNeighbor: boolean;
}

export interface CellKpiResponse {
  usid: string;
  startDate: string;
  endDate: string;
  dateId: string;
  viewType: CellKpiViewType;
  kpiNames: string[];
  data: CellKpiSeriesRow[];
}

export interface MobilityTrendResponse {
  usid: string;
  dateId: string;
  days: number;
  data: Array<{
    sourceUsid: string;
    sourceFace: string;
    neighborUsid: string;
    neighborFace: string;
    handoverCount: number;
    rank: number | null;
    totalHandover: number | null;
    cumulativeSum: number | null;
    handoverPercent: number | null;
    distanceMeters: number | null;
    dateId: string;
  }>;
}

export interface TrafficProfileResponse {
  usid: string;
  dateId: string;
  bandTraffic: Array<{ usid: string; dateId: string; dimension: string; totalTrafficGb: number; cellCount: number }>;
  sectorTraffic: Array<{ usid: string; dateId: string; dimension: string; totalTrafficGb: number; cellCount: number }>;
  neighborTraffic: Array<{ usid: string; dateId: string; dimension: string; totalTrafficGb: number; cellCount: number }>;
  handoverImpact: Array<{
    sourceUsid: string;
    sourceFace: string;
    neighborUsid: string;
    neighborFace: string;
    handoverCount: number;
    handoverPercent: number | null;
    rank: number | null;
    totalHandover: number | null;
    distanceMeters: number | null;
  }>;
}

export interface OutageResponse {
  usid: string;
  dateId: string;
  days: number;
  siteOutages: Record<string, CellKpiSeriesRow[]>;
  neighborOutages: Record<string, {
    totalDowntimeAuto: number;
    totalDowntimeManual: number;
    totalDowntimeSleep: number;
    totalRrcFail: number;
    totalDuacFail: number;
    cellsAffected: number;
    data: CellKpiSeriesRow[];
  }>;
  allNeighborUsids: string[];
  totalRecords: number;
}

export interface OperationalInfoPayload {
  usid: string;
  dateId: string;
  siteRows: CellTopologyRow[];
  neighborRows: Array<Record<string, unknown>>;
}

export interface CqxResponse {
  usid: string;
  dateId: string;
  dataType: 'impact' | 'value';
  subcomponentData: Array<Record<string, unknown>>;
}

export interface KpiWorkbenchState {
  topTab: 'site-kpi' | 'rca' | 'operational' | 'topology';
  kpiTab: 'cqx' | 'daily' | 'hourly' | 'overlay' | 'timeline' | 'mobility' | 'outages' | 'traffic-profile';
  granularity: 'daily' | 'hourly';
  selectedKpis: string[];
  cqxMetric: string;
}
