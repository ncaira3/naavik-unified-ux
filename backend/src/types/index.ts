/**
 * Type definitions for Naavik Demo Backend
 */

// =====================================================
// Database Models
// =====================================================

export interface Site {
  id?: number;
  SiteID: string;
  SiteName: string;
  Latitude: number;
  Longitude: number;
  CellCount?: number;
  DateID: string;
  AnomalyFlag: boolean;
  AnomalyScore: number;
  ClusterID?: string | null;
}

export interface Cell {
  id?: number;
  CellID: string;
  CellName: string;
  SiteID: string;
  Technology: string;
  Carrier?: string;
  NumKPIs?: number;
  Latitude?: number;
  Longitude?: number;
  Azimuth?: number;
  DateID: string;
  AnomalyFlag: boolean;
  AnomalyScore: number;
}

export interface KPIData {
  id?: number;
  KPIID: string;
  CellID: string;
  SiteID: string;
  CellName: string;
  KPIName: string;
  KPIValue: number;
  Technology: string;
  DateID: string;
  AnomalyFlag: boolean;
  AnomalyScore: number;
}

export interface SuperKPIImpact {
  id?: number;
  SiteID: string;
  DateID: string;
  TOTAL_IMPACT_LATEST: number;
  DATA_DROP_IMP: number;
  DATA_ACC_IMP: number;
  NS_ESO_IMP: number;
  DL_TPUT_IMP: number;
  UL_TPUT_IMP: number;
}

export interface Ticket {
  id?: number;
  SiteID: string;
  TicketNumber: string;
  TICKET_STATUS: string;
  PROBLEM_CATEGORY: string;
  CREATE_TIME: Date;
  DateID: string;
}

// =====================================================
// Workflow Types
// =====================================================

export type IntentType = 
  | 'OBSERVE'           // Network monitoring and observation
  | 'ANALYZE_RCA'       // Root cause analysis
  | 'BUILD_APP'         // App generation (legacy)
  | 'PROVISION'         // Site provisioning
  | 'QUERY_DB'          // Direct database queries
  | 'ANALYZE_DATA'      // Statistical analysis and insights
  | 'SHOW_MAP'          // Display map with filters
  | 'CREATE_DASHBOARD'  // Build custom dashboard
  | 'CREATE_WORKFLOW'   // Build automation workflow
  | 'GENERATE_CODE'     // Generate monitoring code
  | 'UNKNOWN';          // Unrecognized intent

export interface ParsedIntent {
  intent: IntentType;
  confidence: number;
  chainOfThought: string[];
  filters: {
    siteId?: string;
    dateRange?: { start: string; end: string };
    kpiType?: string;
    severity?: 'critical' | 'warning' | 'info';
    region?: string;
  };
  actionParams?: Record<string, any>;
  executionTime: number;
}

export interface IntentRequest {
  query: string;
  userId?: string;
}

// =====================================================
// Agent Types
// =====================================================

export type AgentName = 'OBSERVATION' | 'REASONING' | 'PERCEPTION' | 'SENSING';
export type AgentStatus = 'IDLE' | 'WORKING' | 'COMPLETE' | 'ERROR';

export interface AgentActivity {
  workflowId: string;
  agentName: AgentName;
  status: AgentStatus;
  progress: number; // 0-100
  findings: string[];
  startedAt: Date;
  completedAt?: Date;
  data?: any;
}

export interface AgentWorkflowResult {
  workflowId: string;
  workflowType: 'OBSERVE' | 'BUILD_APP' | 'PROVISION' | 'QUERY' | 'ANALYSIS';
  agents: AgentActivity[];
  finalResult: any;
  totalDuration: number;
}

// =====================================================
// Query & Analysis Types
// =====================================================

export interface DatabaseSchema {
  tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
    }>;
  }>;
}

export interface GeneratedSQL {
  sql: string;
  params: any[];
  estimatedRows: number;
  safe: boolean;
  warnings: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Cost estimate from the query-cost-estimator. Populated by validateSQL. */
  cost?: {
    estimatedRows: number;
    estimatedMs: number;
    warningLevel: 'green' | 'yellow' | 'red';
    reasons: string[];
    suggestions: string[];
    missingRequiredFilters: string[];
    tables: string[];
  };
}

export interface QueryResult {
  rows: any[];
  rowCount: number;
  executionTime: number;
  sql?: string;
}

export interface AnalysisResult {
  summary: string;
  statistics: Record<string, number>;
  chartData?: ChartData;
  insights: string[];
}

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

// =====================================================
// Code Generation Types
// =====================================================

export interface AppRequirements {
  description: string;
  kpis: string[];
  alertThresholds?: Record<string, number>;
  features: string[];
}

export interface GeneratedCode {
  code: string;
  language: 'python' | 'javascript' | 'typescript';
  filename: string;
  description: string;
  dependencies: string[];
}

export interface DashboardConfig {
  id: string;
  name: string;
  widgets: Array<{
    type: 'chart' | 'metric' | 'table' | 'map';
    title: string;
    kpi?: string;
    config: any;
  }>;
  layout: {
    cols: number;
    rows: number;
  };
}

// =====================================================
// Workflow Types
// =====================================================

export interface TriggerCondition {
  type: 'kpi_threshold' | 'time_based' | 'event_based';
  config: any;
}

export interface WorkflowAction {
  type: 'alert' | 'provision' | 'analyze' | 'execute_script';
  config: any;
}

export interface WorkflowConfig {
  id: string;
  name: string;
  trigger: TriggerCondition;
  actions: WorkflowAction[];
  active: boolean;
}

// =====================================================
// Provisioning Extended Types
// =====================================================

export interface SiteConfig {
  siteName: string;
  location: { latitude: number; longitude: number };
  technology: '4G' | '5G';
  cellCount: number;
  sectorCount: number;
  ranParams?: {
    pci?: number;
    tac?: number;
    earfcn?: number;
  };
}

export interface ProvisioningResult {
  provisioningId: string;
  siteId: string;
  status: ProvisioningStatus;
  config: SiteConfig;
  progress: number;
  steps: ProvisioningStepStatus[];
  startedAt: Date;
  completedAt?: Date;
}

export interface ConfigFile {
  filename: string;
  content: string;
  format: 'json' | 'xml' | 'yaml';
}

export interface ProvisionParams {
  location: { latitude: number; longitude: number };
  technology: '4G' | '5G';
  siteName?: string;
}

// =====================================================
// App Generation Types (from appspace)
// =====================================================

export enum ResourceType {
  APP = 'APP',
  FUNCTION = 'FUNCTION'
}

export enum DeploymentTarget {
  AIRA_NATIVE = 'AIRA_NATIVE',
  NAAVIK_STORE = 'NAAVIK_STORE',
  ERICSSON_EIAP = 'ERICSSON_EIAP',
  NOKIA_EDEN = 'NOKIA_EDEN',
  FUTURE_USE = 'FUTURE_USE'
}

export enum AppStatus {
  VOID = 'VOID',
  SYNTHESIZING = 'SYNTHESIZING',
  SYNCHRONIZING = 'SYNCHRONIZING',
  ACTIVE = 'ACTIVE',
  STABLE = 'STABLE',
  ORBITING = 'ORBITING',
  DORMANT = 'DORMANT',
  ERROR = 'ERROR'
}

export interface AppSpec {
  id: string;
  name: string;
  type: ResourceType;
  description: string;
  version: string;
  dataModel: { name: string; type: string }[];
  pages?: { title: string; route: string }[];
  pythonCode: string;
  generatedAt: string;
  target?: DeploymentTarget;
}

export interface AppPackage {
  spec: AppSpec;
  status: AppStatus;
  metrics?: {
    latency: number;
    spectralEfficiency: number;
    activeUes: number;
  };
  createdBy?: string;
  deployedAt?: Date;
}

export interface AppGenerationRequest {
  userIntent: string;
  conversationId?: string;
  refinements?: Record<string, any>;
}

export interface AppGenerationResponse {
  conversationId: string;
  stage: 'CLARIFYING' | 'GENERATING' | 'COMPLETE';
  clarifications?: Array<{
    question: string;
    options?: string[];
    type: 'single' | 'multiple' | 'text';
  }>;
  appSpec?: AppSpec;
  progress?: number;
}

// =====================================================
// Provisioning Types
// =====================================================

export type ProvisioningStatus = 'INITIATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
export type ProvisioningStep = 
  | 'SCRIPT_PREPARATION' 
  | 'ADRCA_TRIGGER' 
  | 'IMPLEMENTATION' 
  | 'VALIDATION' 
  | 'HEALTH_CHECK';

export interface ProvisioningRequest {
  siteId: string;
  location: { latitude: number; longitude: number };
  configuration: {
    technology: '4G' | '5G';
    sectors: number;
    carriers: string[];
  };
  triggeredBy: 'INTENT' | 'MAP_CLICK';
}

export interface ProvisioningStepStatus {
  step: ProvisioningStep;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED';
  progress: number;
  duration?: number;
  message?: string;
}

export interface ProvisioningResponse {
  provisioningId: string;
  status: ProvisioningStatus;
  steps: ProvisioningStepStatus[];
  currentStep?: ProvisioningStep;
  startedAt: Date;
  completedAt?: Date;
}

// =====================================================
// Anomaly & RCA Types
// =====================================================

export interface Anomaly {
  anomalyId: string;
  siteId: string;
  siteName: string;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  kpiName?: string;
  value: number;
  threshold: number;
  detectedAt: Date;
  location: { latitude: number; longitude: number };
  rca?: RootCauseAnalysis;
}

export interface RootCauseAnalysis {
  rootCause: string;
  rootCauseSiteId?: string;
  impactedSites: string[];
  confidence: number;
  recommendation: string;
  chainOfReasoning: string[];
}

export interface OutageEvent {
  outageId: string;
  siteId: string;
  siteName: string;
  location: { latitude: number; longitude: number };
  startedAt: Date;
  resolvedAt?: Date;
  neighborImpact: Array<{
    siteId: string;
    siteName: string;
    congestionIncrease: number; // %
    affectedKPIs: string[];
  }>;
}

// =====================================================
// API Response Types
// =====================================================

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

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

// =====================================================
// Authentication Types
// =====================================================

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
}

export interface AuthRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: User;
  expiresIn: string;
}

// =====================================================
// Map & Visualization Types
// =====================================================

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

export interface MapOutage {
  siteId: string;
  location: { latitude: number; longitude: number };
  startTime: Date;
  severity: number;
  neighborCount: number;
}

// =====================================================
// Workflow JSON Types
// =====================================================

export interface WorkflowNode {
  id: string;
  type: string;
  data?: {
    label?: string;
    config?: Record<string, any>;
    [key: string]: any;
  };
  position?: { x: number; y: number };
  [key: string]: any;
}

export interface WorkflowEdge {
  source: string;
  target: string;
  id?: string;
  [key: string]: any;
}

export interface WorkflowJSON {
  nodes: WorkflowNode[];
  edges?: WorkflowEdge[];
  [key: string]: any;
}

// =====================================================
// Observe Site Analysis Types
// =====================================================

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
