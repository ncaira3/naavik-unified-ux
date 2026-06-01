import axios, { AxiosInstance } from 'axios';
import { localCache } from './localCache';
import {
  ApiResponse,
  AppGenSettings,
  CellKpiResponse,
  CellKpiViewType,
  CqxResponse,
  LoginRequest,
  MobilityTrendResponse,
  OperationalInfoPayload,
  OutageResponse,
  AuthResponse,
  ParsedIntent,
  UiCommandResult,
  AgentWorkflow,
  ExecutionStatus,
  BuilderChatResponse,
  BuilderState,
  AppGenAgentChatResponse,
  ProvisioningCandidateSite,
  SiteAnalysisPayload,
  SiteTopologyPayload,
  TrafficProfileResponse,
} from '../types';

class ApiService {
  private client: AxiosInstance;
  private token: string | null = null;
  private appgenFallbackEnabled: boolean;

  constructor() {
    this.client = axios.create({
      baseURL: '/api',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    this.appgenFallbackEnabled = String((import.meta as any)?.env?.VITE_APPGEN_AGENT_V1_FALLBACK || 'false').toLowerCase() === 'true';

    // Load token from localStorage
    this.token = localStorage.getItem('naavik_token');
    if (this.token) {
      this.setAuthToken(this.token);
    }

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const status = error.response?.status;
        const code = error.response?.data?.error?.code;
        // 401 = no token; 403 with INVALID_TOKEN = stale/corrupt JWT — clear and re-login
        if (status === 401 || (status === 403 && code === 'INVALID_TOKEN')) {
          this.clearAuth();
          window.location.href = '/';
        }
        return Promise.reject(error);
      }
    );
  }

  setAuthToken(token: string) {
    this.token = token;
    this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    localStorage.setItem('naavik_token', token);
  }

  clearAuth() {
    this.token = null;
    delete this.client.defaults.headers.common['Authorization'];
    localStorage.removeItem('naavik_token');
  }

  private unwrapPayload<T>(payload: any, fallback: T): T {
    if (payload == null) return fallback;
    if (typeof payload === 'object' && 'success' in payload) {
      return payload.data ?? fallback;
    }
    return payload as T;
  }

  // Auth endpoints
  async login(credentials: LoginRequest): Promise<AuthResponse> {
    const response = await this.client.post<ApiResponse<AuthResponse>>('/auth/login', credentials);
    if (response.data.success && response.data.data) {
      this.setAuthToken(response.data.data.token);
      return response.data.data;
    }
    throw new Error('Login failed');
  }

  async logout(): Promise<void> {
    try {
      await this.client.post('/auth/logout');
    } finally {
      this.clearAuth();
    }
  }

  async verifyAuth() {
    const response = await this.client.get<ApiResponse<{ valid: boolean; user: any }>>('/auth/verify');
    return response.data;
  }

  // Intent endpoints
  async parseIntent(query: string): Promise<ParsedIntent> {
    const response = await this.client.post<ApiResponse<ParsedIntent>>('/intent/parse', { query });
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error('Failed to parse intent');
  }

  async executeIntent(query: string, context?: string): Promise<{
    query: string;
    parsedIntent: ParsedIntent;
    response: string;
    workflow?: AgentWorkflow;
    additionalData?: any;
  }> {
    const response = await this.client.post<ApiResponse>('/intent/execute', { query, context: context || 'general' });
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error('Failed to execute intent');
  }

  async interpretUiCommand(payload: {
    query: string;
    currentView?: string;
    selectedSiteToken?: string | null;
    selectedDateId?: string | null;
  }): Promise<UiCommandResult> {
    const response = await this.client.post<ApiResponse<UiCommandResult>>('/intent/ui-command', payload);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error((response.data as any)?.error?.message || 'Failed to interpret UI command');
  }

  async startOssParameterChange(payload: {
    siteId?: string;
    parameter?: string;
    value?: string | number;
    unit?: string;
    moClass?: string;
    intentText?: string;
  }): Promise<ExecutionStatus> {
    const response = await this.client.post<ApiResponse<any>>('/oss-adapter/parameter-change', payload);
    if (response.data.success && response.data.data) {
      const data = response.data.data;
      return {
        executionId: data.requestId,
        requestId: data.requestId,
        status: data.status,
        message: data.message,
        siteId: data.siteId,
        parameter: data.parameter,
        value: data.value,
        unit: data.unit,
        handshakeRequired: data.handshakeRequired,
        steps: data.steps,
      };
    }
    throw new Error('Failed to start OSS parameter change');
  }

  async getOssParameterChangeStatus(requestId: string): Promise<ExecutionStatus> {
    const response = await this.client.get<ApiResponse<any>>(`/oss-adapter/parameter-change/${requestId}`);
    if (response.data.success && response.data.data) {
      const data = response.data.data;
      return {
        executionId: data.requestId,
        requestId: data.requestId,
        status: data.status,
        message: data.message,
        siteId: data.siteId,
        parameter: data.parameter,
        value: data.value,
        unit: data.unit,
        handshakeRequired: data.handshakeRequired,
        steps: data.steps,
      };
    }
    throw new Error('Failed to get OSS parameter change status');
  }

  async retryOssParameterChange(requestId: string): Promise<ExecutionStatus> {
    const response = await this.client.post<ApiResponse<any>>(`/oss-adapter/parameter-change/${requestId}/retry`);
    if (response.data.success && response.data.data) {
      const data = response.data.data;
      return {
        executionId: data.requestId,
        requestId: data.requestId,
        status: data.status,
        message: data.message,
        siteId: data.siteId,
        parameter: data.parameter,
        value: data.value,
        unit: data.unit,
        handshakeRequired: data.handshakeRequired,
        steps: data.steps,
      };
    }
    throw new Error('Failed to retry OSS parameter change');
  }

  // Query endpoints (new)
  async executeNaturalQuery(query: string): Promise<{
    query: string;
    generatedSQL: string;
    result: any;
    warnings?: string[];
  }> {
    const response = await this.client.post<ApiResponse>('/query/natural', { query });
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error('Failed to execute natural query');
  }

  async executeAnalysis(analysisQuery: any): Promise<any> {
    const response = await this.client.post<ApiResponse>('/query/analyze', analysisQuery);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error('Failed to execute analysis');
  }

  async getDatabaseSchema(): Promise<any> {
    const response = await this.client.get<ApiResponse>('/query/schema');
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error('Failed to get database schema');
  }

  async exportQueryResults(sql: string, params: any[] = []): Promise<string> {
    const response = await this.client.post('/query/export', { sql, params }, {
      responseType: 'text'
    });
    return response.data;
  }

  // Sites endpoints
  async getSites() {
    const response = await this.client.get<ApiResponse>('/sites');
    return response.data;
  }

  async getMapSites() {
    const cacheKey = 'map-sites:latest';
    const cached = await localCache.get<ApiResponse>(cacheKey);
    if (cached) return cached;
    const response = await this.client.get<ApiResponse>('/sites/map');
    if (response.data?.data) {
      await localCache.set(cacheKey, response.data, { ttlMs: 24 * 60 * 60 * 1000, skipMemory: true });
    }
    return response.data;
  }

  /** Returns the latest available offender date from the network summary */
  async getLatestOffenderDate(): Promise<string> {
    try {
      const response = await this.client.get<ApiResponse<{ dateId: string }>>('/offenders/summary');
      const date = String((response.data as any)?.data?.dateId || '').slice(0, 10);
      if (date) return date;
    } catch {
      // fall through
    }
    // Fall back to yesterday so we never return a stale hardcoded date
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  /** Super KPI offender site IDs for date (default 2025-01-10) - for map red/green coloring */
  async getOffenderSiteIds(dateId?: string) {
    const response = await this.client.get<ApiResponse>('/offenders/super-kpi', {
      params: dateId ? { dateId } : { dateId: '2025-01-10' },
    });
    return response.data;
  }

  async getMapLayerSiteStatus(dateId?: string) {
    type LayerStatus = { dateId: string; outageSiteIds: string[]; overutilizedSiteIds: string[]; outageRealUsids: string[]; overutilizedRealUsids: string[] };
    const cacheKey = `layer-status:${dateId ?? 'latest'}`;
    const cached = await localCache.get<ApiResponse<LayerStatus>>(cacheKey);
    if (cached) return cached;
    const response = await this.client.get<ApiResponse<LayerStatus>>('/sites/layers/status', {
      params: dateId ? { dateId } : undefined,
    });
    if (response.data.success && response.data.data) {
      localCache.set(cacheKey, response.data, { ttlMs: 24 * 60 * 60 * 1000 });
    }
    return response.data;
  }

  async getSiteCells(siteId: string) {
    const response = await this.client.get<ApiResponse>(`/sites/${siteId}/cells`);
    return response.data;
  }

  async getAllSectors(limit?: number) {
    const cacheKey = `all-sectors:${limit ?? 'all'}`;
    const cached = await localCache.get<ApiResponse>(cacheKey);
    if (cached) return cached;
    const response = await this.client.get<ApiResponse>('/sites/sectors/all', {
      params: limit ? { limit } : undefined
    });
    if (response.data?.data) {
      await localCache.set(cacheKey, response.data, { ttlMs: 24 * 60 * 60 * 1000, skipMemory: true });
    }
    return response.data;
  }

  async getSiteSectors(siteId: string) {
    const response = await this.client.get<ApiResponse>(`/sites/${siteId}/sectors`);
    return response.data;
  }

  async getSiteOperationalInfo(siteId: string, dateId?: string, limit: number = 50) {
    const response = await this.client.get<ApiResponse>(`/sites/${siteId}/info`, {
      params: { dateId, limit },
    });
    return response.data;
  }

  async getSiteComprehensiveAnalysis(siteId: string, dateId?: string) {
    const cacheKey = `site-analysis:${siteId}:${dateId || 'latest'}`;
    const group = `${siteId}:${dateId || 'latest'}`;
    const cached = await localCache.get<ApiResponse<SiteAnalysisPayload>>(cacheKey);
    if (cached) {
      await localCache.touchGroupKey(cacheKey, { groupNamespace: 'site-date-kpi', group, maxGroups: 10 });
      return cached;
    }
    const response = await this.client.get<ApiResponse<SiteAnalysisPayload>>(`/sites/${siteId}/analysis/comprehensive`, {
      params: { dateId },
    });
    if (response.data?.data) {
      await localCache.set(cacheKey, response.data, { ttlMs: 60 * 60 * 1000, groupNamespace: 'site-date-kpi', group, maxGroups: 10 });
    }
    return response.data;
  }

  async getSiteCellTopology(siteId: string, dateId?: string) {
    const cacheKey = `site-topology:${siteId}:${dateId || 'latest'}`;
    const cached = await localCache.get<ApiResponse<SiteTopologyPayload>>(cacheKey);
    if (cached) return cached;
    const response = await this.client.get<ApiResponse<SiteTopologyPayload>>(`/sites/${siteId}/cell-topology`, {
      params: { dateId },
    });
    if (response.data?.data) localCache.set(cacheKey, response.data, { ttlMs: 24 * 60 * 60 * 1000 });
    return response.data;
  }

  async getSiteCellKpis(
    siteId: string,
    params: {
      kpiNames: string[];
      viewType: CellKpiViewType;
      startDate?: string;
      endDate?: string;
      dateId?: string;
    }
  ) {
    const dateKey = params.dateId || params.endDate || params.startDate || 'latest';
    const cacheKey = `site-kpis:${siteId}:${params.viewType}:${dateKey}:${params.startDate || ''}:${params.endDate || ''}:${params.kpiNames.join('|')}`;
    const group = `${siteId}:${dateKey}`;
    const cached = await localCache.get<ApiResponse<CellKpiResponse>>(cacheKey);
    if (cached) {
      await localCache.touchGroupKey(cacheKey, { groupNamespace: 'site-date-kpi', group, maxGroups: 10 });
      return cached;
    }
    const response = await this.client.get<ApiResponse<CellKpiResponse>>(`/sites/${siteId}/cell-kpis`, {
      params: {
        kpiNames: params.kpiNames.join(','),
        viewType: params.viewType,
        startDate: params.startDate,
        endDate: params.endDate,
        dateId: params.dateId,
      },
    });
    if (response.data?.data) {
      await localCache.set(cacheKey, response.data, { ttlMs: 4 * 60 * 60 * 1000, groupNamespace: 'site-date-kpi', group, maxGroups: 10 });
    }
    return response.data;
  }

  async getSiteAvailableKpis(siteId: string, viewType: CellKpiViewType = 'daily') {
    const cacheKey = `available-kpis:${siteId}:${viewType}`;
    const cached = await localCache.get<ApiResponse<string[]>>(cacheKey);
    if (cached) return cached;
    const response = await this.client.get<ApiResponse<string[]>>(`/sites/${siteId}/available-kpis`, {
      params: { viewType },
    });
    if (response.data?.data?.length) {
      await localCache.set(cacheKey, response.data, { ttlMs: 24 * 60 * 60 * 1000 });
    }
    return response.data;
  }

  async getSiteMobilityTrends(siteId: string, dateId?: string, days = 30) {
    const dateKey = dateId || 'latest';
    const cacheKey = `site-mobility:${siteId}:${dateKey}:${days}`;
    const group = `${siteId}:${dateKey}`;
    const cached = await localCache.get<ApiResponse<MobilityTrendResponse>>(cacheKey);
    if (cached) {
      await localCache.touchGroupKey(cacheKey, { groupNamespace: 'site-date-kpi', group, maxGroups: 10 });
      return cached;
    }
    const response = await this.client.get<ApiResponse<MobilityTrendResponse>>(`/sites/${siteId}/mobility-trends`, {
      params: { dateId, days },
    });
    if (response.data?.data) {
      await localCache.set(cacheKey, response.data, { ttlMs: 60 * 60 * 1000, groupNamespace: 'site-date-kpi', group, maxGroups: 10 });
    }
    return response.data;
  }

  async getSiteTrafficProfile(siteId: string, dateId?: string) {
    const cacheKey = `site-traffic:${siteId}:${dateId || 'latest'}`;
    const group = `${siteId}:${dateId || 'latest'}`;
    const cached = await localCache.get<ApiResponse<TrafficProfileResponse>>(cacheKey);
    if (cached) {
      await localCache.touchGroupKey(cacheKey, { groupNamespace: 'site-date-kpi', group, maxGroups: 10 });
      return cached;
    }
    const response = await this.client.get<ApiResponse<TrafficProfileResponse>>(`/sites/${siteId}/traffic-profile`, {
      params: { dateId },
    });
    if (response.data?.data) {
      await localCache.set(cacheKey, response.data, { ttlMs: 4 * 60 * 60 * 1000, groupNamespace: 'site-date-kpi', group, maxGroups: 10 });
    }
    return response.data;
  }

  async getSiteOutages(siteId: string, dateId?: string, days = 7) {
    const dateKey = dateId || 'latest';
    const cacheKey = `site-outages:${siteId}:${dateKey}:${days}`;
    const group = `${siteId}:${dateKey}`;
    const cached = await localCache.get<ApiResponse<OutageResponse>>(cacheKey);
    if (cached) {
      await localCache.touchGroupKey(cacheKey, { groupNamespace: 'site-date-kpi', group, maxGroups: 10 });
      return cached;
    }
    const response = await this.client.get<ApiResponse<OutageResponse>>(`/sites/${siteId}/outages`, {
      params: { dateId, days },
    });
    if (response.data?.data) {
      await localCache.set(cacheKey, response.data, { ttlMs: 60 * 60 * 1000, groupNamespace: 'site-date-kpi', group, maxGroups: 10 });
    }
    return response.data;
  }

  async getSiteCqx(siteId: string, dateId?: string, days = 30, dataType: 'impact' | 'value' = 'impact') {
    const dateKey = dateId || 'latest';
    const cacheKey = `site-cqx:${siteId}:${dateKey}:${days}:${dataType}`;
    const group = `${siteId}:${dateKey}`;
    const cached = await localCache.get<ApiResponse<CqxResponse>>(cacheKey);
    if (cached) {
      await localCache.touchGroupKey(cacheKey, { groupNamespace: 'site-date-kpi', group, maxGroups: 10 });
      return cached;
    }
    const response = await this.client.get<ApiResponse<CqxResponse>>(`/sites/${siteId}/cqx`, {
      params: { dateId, days, dataType },
    });
    if (response.data?.data) {
      await localCache.set(cacheKey, response.data, { ttlMs: 60 * 60 * 1000, groupNamespace: 'site-date-kpi', group, maxGroups: 10 });
    }
    return response.data;
  }

  async getSiteOperationalWorkbench(siteId: string, dateId?: string, limit = 50) {
    const cacheKey = `site-operational:${siteId}:${dateId || 'latest'}`;
    const cached = await localCache.get<ApiResponse<OperationalInfoPayload>>(cacheKey);
    if (cached) return cached;
    const response = await this.client.get<ApiResponse<OperationalInfoPayload>>(`/sites/${siteId}/operational-info`, {
      params: { dateId, limit },
    });
    if (response.data?.data) localCache.set(cacheKey, response.data, { ttlMs: 60 * 60 * 1000 });
    return response.data;
  }

  async getSiteRCA(siteId: string, dateId?: string) {
    const response = await this.client.get<ApiResponse>(`/sites/${siteId}/rca`, {
      params: { dateId },
    });
    return response.data;
  }

  async getSiteKPITimeSeries(
    siteId: string,
    kpiName: string,
    days: number = 14,
    granularity: 'daily' | 'hourly' = 'daily',
    endDate?: string
  ) {
    const dateKey = endDate || 'latest';
    const cacheKey = `site-kpi-series:${siteId}:${dateKey}:${granularity}:${days}:${kpiName}`;
    const group = `${siteId}:${dateKey}`;
    const cached = await localCache.get<ApiResponse>(cacheKey);
    if (cached) {
      await localCache.touchGroupKey(cacheKey, { groupNamespace: 'site-date-kpi', group, maxGroups: 10 });
      return cached;
    }
    const response = await this.client.get<ApiResponse>(`/sites/${siteId}/kpis/${encodeURIComponent(kpiName)}`, {
      params: { days, granularity, endDate },
    });
    if (response.data?.data) {
      await localCache.set(cacheKey, response.data, { ttlMs: 60 * 60 * 1000, groupNamespace: 'site-date-kpi', group, maxGroups: 10 });
    }
    return response.data;
  }

  /**
   * Fetch a batch of KPIs for a site in one round-trip.
   * Checks the browser localCache first (1-hour TTL).
   */
  async getSiteKPIBatch(
    siteId: string,
    kpiNames: string[],
    endDate?: string,
    granularity: 'daily' | 'hourly' = 'daily'
  ): Promise<Record<string, any> | null> {
    const dateKey = endDate || 'latest';
    const browserKey = `kpi-batch:${siteId}:${dateKey}`;
    const cached = await localCache.get<Record<string, any>>(browserKey);
    if (cached) return cached;

    const response = await this.client.get<ApiResponse>(`/sites/${siteId}/kpis/batch`, {
      params: {
        endDate,
        granularity,
        kpis: kpiNames.join(','),
      },
    });
    const bundle = response.data?.data ?? null;
    if (bundle) {
      await localCache.set(browserKey, bundle, { ttlMs: 60 * 60 * 1000 });
    }
    return bundle;
  }

  /** Latest KPI values for a site (keys are KPI names that have data for this site) */
  async getSiteLatestKPIs(siteId: string) {
    const cacheKey = `site-latest-kpis:${siteId}`;
    const cached = await localCache.get<ApiResponse>(cacheKey);
    if (cached) return cached;
    const response = await this.client.get<ApiResponse>(`/sites/${siteId}/kpis`);
    if (response.data?.data) {
      await localCache.set(cacheKey, response.data, { ttlMs: 10 * 60 * 1000 });
    }
    return response.data;
  }

  async getAvailableKPIs() {
    const response = await this.client.get<ApiResponse>('/kpis');
    return response.data;
  }

  /** KPI table date range: minDate, maxDate, distinctDays */
  async getKPIDateRange(): Promise<ApiResponse<{ minDate: string; maxDate: string; distinctDays: number }>> {
    const response = await this.client.get<ApiResponse<{ minDate: string; maxDate: string; distinctDays: number }>>('/kpis/date-range');
    return response.data;
  }

  // Anomalies endpoints
  async getAnomalies() {
    const response = await this.client.get<ApiResponse>('/anomalies');
    return response.data;
  }

  async getAnomalyStats() {
    const response = await this.client.get<ApiResponse>('/anomalies/stats');
    return response.data;
  }

  // RCA endpoints
  async getOutages() {
    const response = await this.client.get<ApiResponse>('/rca/outages');
    return response.data;
  }

  // Apps endpoints
  async generateApp(userIntent: string, conversationId?: string) {
    const response = await this.client.post<ApiResponse>('/apps/generate', {
      userIntent,
      conversationId,
    });
    return response.data;
  }

  async getApps() {
    const response = await this.client.get<ApiResponse>('/apps');
    return response.data;
  }

  // Provisioning endpoints
  async startProvisioning(request: any) {
    const response = await this.client.post<ApiResponse>('/provisioning/start', request);
    return response.data;
  }

  async getProvisioningStatus(provisioningId: string) {
    const response = await this.client.get<ApiResponse>(`/provisioning/${provisioningId}`);
    return response.data;
  }

  async getProvisioningCandidates(
    quarter: 'ALL' | 'Q1' | 'Q2' | 'Q3' | 'Q4' = 'ALL',
    limit?: number,
    percentPerQuarter: number = 3
  ) {
    const response = await this.client.get<ApiResponse<{ quarter: string; count: number; candidates: ProvisioningCandidateSite[] }>>(
      '/provisioning/site-candidates',
      { params: { quarter, limit, percentPerQuarter } }
    );
    return response.data;
  }

  // Automation / App Generator endpoints
  async analyzeIntent(query: string, userId?: string, reportDate?: string) {
    const response = await this.client.post<ApiResponse>('/automation/analyze-intent', {
      query,
      userId: userId || 'user',
      reportDate,
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error((response.data as any)?.error?.message || 'Failed to analyze intent');
  }

  async executeAction(actionId: string, actionName: string, context: any, userId?: string) {
    const response = await this.client.post<ApiResponse>('/automation/execute-action', {
      actionId,
      actionName,
      context: context || {},
      userId: userId || 'user',
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error((response.data as any)?.error?.message || 'Failed to execute action');
  }

  async generateEIAP(naturalLanguageInput: string, userId?: string) {
    const response = await this.client.post<ApiResponse>('/automation/generate-eiap', {
      naturalLanguageInput,
      userId: userId || 'user',
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error((response.data as any)?.error?.message || 'Failed to generate EIAP code');
  }

  async appChat(messages: Array<{ role: 'user' | 'assistant'; content: string }>) {
    const response = await this.client.post<ApiResponse>('/automation/app-chat', { messages });
    if (response.data.success && response.data.data) return response.data.data as { response: string };
    throw new Error((response.data as any)?.error?.message || 'App chat failed');
  }

  async resolveTelecomTerm(type: 'parameter' | 'kpi', nlInput: string) {
    const response = await this.client.post<ApiResponse>('/telecom-knowledge/resolve', { type, nlInput });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error((response.data as any)?.error?.message || 'Failed to resolve telecom term');
  }

  async generateWorkflowFromIntent(naturalLanguageInput: string, userId?: string) {
    const response = await this.client.post<ApiResponse>('/automation/workflow-from-intent', {
      naturalLanguageInput,
      userId: userId || 'user',
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error((response.data as any)?.error?.message || 'Failed to create workflow from intent');
  }

  async generateWorkflowFromCode(code: string) {
    const response = await this.client.post<ApiResponse>('/automation/generate-workflow', {
      code,
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error((response.data as any)?.error?.message || 'Failed to generate workflow');
  }

  async generateCodeFromWorkflow(workflow: any) {
    const response = await this.client.post<ApiResponse>('/automation/generate-code', {
      workflow,
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error((response.data as any)?.error?.message || 'Failed to generate code');
  }

  async getAutomationApps(params?: { status?: string; search?: string; limit?: number; offset?: number }) {
    const response = await this.client.get<ApiResponse>('/automation/apps', { params });
    if (response.data.success) return response.data.data as any[];
    throw new Error('Failed to get apps');
  }

  async createAutomationApp(data: {
    appName: string;
    description?: string;
    naturalLanguageInput?: string;
    generatedCode?: string;
    workflowJson?: any;
    deploymentTarget?: string;
    moClasses?: string[];
    parametersUsed?: string[];
    kpisUsed?: string[];
    status?: 'draft' | 'validated' | 'deployed' | 'running' | 'failed' | 'archived';
  }) {
    const response = await this.client.post<ApiResponse>('/automation/apps', data);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error((response.data as any)?.error?.message || 'Failed to save applet');
  }

  async getAutomationApp(appId: string) {
    const response = await this.client.get<ApiResponse>(`/automation/apps/${appId}`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error('App not found');
  }

  async updateAutomationApp(appId: string, data: any) {
    const response = await this.client.patch<ApiResponse>(`/automation/apps/${appId}`, data);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error((response.data as any)?.error?.message || 'Failed to update app');
  }

  async deleteAutomationApp(appId: string) {
    const response = await this.client.delete<ApiResponse>(`/automation/apps/${appId}`);
    if (response.data.success) return;
    throw new Error((response.data as any)?.error?.message || 'Failed to delete app');
  }

  async getParameters(params?: { moClass?: string; search?: string; limit?: number; offset?: number }) {
    const response = await this.client.get<ApiResponse>('/parameters', { params });
    if (response.data.success) return response.data;
    throw new Error('Failed to get parameters');
  }

  async getMOClasses() {
    const response = await this.client.get<ApiResponse>('/parameters/mo-classes/list');
    if (response.data.success) return response.data.data as string[];
    throw new Error('Failed to get MO classes');
  }

  // =====================================================
  // Telecom Knowledge APIs
  // =====================================================

  async searchTelecomKnowledge(query: string, limit?: number) {
    const response = await this.client.post<ApiResponse>('/telecom-knowledge/search', {
      query,
      limit: limit || 10,
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error((response.data as any)?.error?.message || 'Search failed');
  }

  async askTelecomQuestion(question: string, context?: string, conversationHistory?: { role: string; content: string }[]) {
    const response = await this.client.post<ApiResponse>('/telecom-knowledge/ask', {
      question,
      context: context || 'knowledge',
      ...(conversationHistory && conversationHistory.length > 0 ? { conversationHistory } : {}),
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error((response.data as any)?.error?.message || 'Failed to answer question');
  }

  async resolveParameterOrKPI(type: 'parameter' | 'kpi', nlInput: string) {
    const response = await this.client.post<ApiResponse>('/telecom-knowledge/resolve', {
      type,
      nlInput,
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error((response.data as any)?.error?.message || 'Resolution failed');
  }

  async listEricssonParameters(limit?: number, offset?: number, category?: string) {
    const response = await this.client.get<ApiResponse>('/telecom-knowledge/parameters', {
      params: { limit, offset, category },
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error('Failed to list parameters');
  }

  async getEricssonParameter(id: number) {
    const response = await this.client.get<ApiResponse>(`/telecom-knowledge/parameters/${id}`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error('Failed to get parameter');
  }

  async listEricssonKPIs(limit?: number, offset?: number, category?: string) {
    const response = await this.client.get<ApiResponse>('/telecom-knowledge/kpis', {
      params: { limit, offset, category },
    });
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error('Failed to list KPIs');
  }

  async getEricssonKPI(id: number) {
    const response = await this.client.get<ApiResponse>(`/telecom-knowledge/kpis/${id}`);
    if (response.data.success && response.data.data) return response.data.data;
    throw new Error('Failed to get KPI');
  }

  // Agent-based app generation
  async agentChat(message: string, threadId?: string) {
    const response = await this.client.post<ApiResponse>('/apps/agent/chat', {
      message,
      threadId,
    });
    return response.data;
  }

  async getAgentState(threadId: string) {
    const response = await this.client.get<ApiResponse>(`/apps/agent/state/${threadId}`);
    return response.data;
  }

  async searchFunctions(query: string, limit = 5) {
    const response = await this.client.post<ApiResponse>('/apps/agent/search', {
      query,
      limit,
    });
    return response.data;
  }

  // Demo scenarios
  async getDemoScenarios() {
    const response = await this.client.get<ApiResponse>('/apps/demo/scenarios');
    return response.data;
  }

  async getDemoScenario(scenarioId: string) {
    const response = await this.client.get<ApiResponse>(`/apps/demo/${scenarioId}`);
    return response.data;
  }

  // Conversational Builder V1
  async builderV1Chat(message: string, threadId?: string, channel: 'appstore' | 'main_chat' = 'appstore') {
    const response = await this.client.post<ApiResponse<BuilderChatResponse>>('/conversational-builder/v1/chat', {
      message,
      threadId,
      channel,
    });
    return response.data;
  }

  async builderV1GetState(threadId: string) {
    const response = await this.client.get<ApiResponse<BuilderState>>(`/conversational-builder/v1/state/${threadId}`);
    return response.data;
  }

  async builderV1Generate(threadId: string) {
    const response = await this.client.post<ApiResponse>('/conversational-builder/v1/generate', { threadId });
    return response.data;
  }

  async builderV1PackageRapp(threadId: string) {
    const response = await this.client.post<ApiResponse>('/conversational-builder/v1/package-rapp', { threadId });
    return response.data;
  }

  async builderV1Reset(threadId: string) {
    const response = await this.client.post<ApiResponse>('/conversational-builder/v1/reset', { threadId });
    return response.data;
  }

  // Unified AppGen Agent V1
  async appgenAgentV1Chat(message: string, threadId?: string, channel: 'home_build' | 'appgen_chat' = 'appgen_chat') {
    try {
      const response = await this.client.post<ApiResponse<AppGenAgentChatResponse>>('/appgen/agent/v1/chat', {
        message,
        threadId,
        channel,
      });
      return response.data;
    } catch {
      if (!this.appgenFallbackEnabled) throw new Error('Unified AppGen agent endpoint unavailable. Restart backend and retry.');
      const fallback = await this.builderV1Chat(
        message,
        threadId,
        channel === 'home_build' ? 'main_chat' : 'appstore'
      );
      return {
        ...fallback,
        data: fallback.data
          ? {
              ...fallback.data,
              channel,
              choices: [],
            }
          : fallback.data,
      } as ApiResponse<AppGenAgentChatResponse>;
    }
  }

  async appgenAgentV1GetState(threadId: string, channel: 'home_build' | 'appgen_chat' = 'appgen_chat') {
    try {
      const response = await this.client.get<ApiResponse<BuilderState>>(`/appgen/agent/v1/state/${threadId}`, {
        params: { channel },
      });
      return response.data;
    } catch {
      if (!this.appgenFallbackEnabled) throw new Error('Unified AppGen agent endpoint unavailable. Restart backend and retry.');
      return this.builderV1GetState(threadId);
    }
  }

  async appgenAgentV1Generate(threadId: string, authorizationToken: string) {
    try {
      const response = await this.client.post<ApiResponse>('/appgen/agent/v1/generate', { threadId, authorizationToken });
      return response.data;
    } catch {
      if (!this.appgenFallbackEnabled) throw new Error('Unified AppGen generate endpoint unavailable. Restart backend and retry.');
      return this.builderV1Generate(threadId);
    }
  }

  async appgenAgentV1PackageRapp(threadId: string) {
    try {
      const response = await this.client.post<ApiResponse>('/appgen/agent/v1/package-rapp', { threadId });
      return response.data;
    } catch {
      if (!this.appgenFallbackEnabled) throw new Error('Unified AppGen package endpoint unavailable. Restart backend and retry.');
      return this.builderV1PackageRapp(threadId);
    }
  }

  async appgenAgentV1Reset(threadId: string) {
    try {
      const response = await this.client.post<ApiResponse>('/appgen/agent/v1/reset', { threadId });
      return response.data;
    } catch {
      if (!this.appgenFallbackEnabled) throw new Error('Unified AppGen reset endpoint unavailable. Restart backend and retry.');
      return this.builderV1Reset(threadId);
    }
  }

  async getAppGenSettings() {
    const response = await this.client.get<ApiResponse<AppGenSettings>>('/settings/appgen');
    return response.data;
  }

  async updateAppGenOems(enabledOems: string[]) {
    const response = await this.client.put<ApiResponse<AppGenSettings>>('/settings/appgen/oems', {
      enabledOems,
    });
    return response.data;
  }

  async agentV2Chat(payload: {
    threadId?: string;
    message: string;
    stream?: string;
    currentView?: string;
    action?: { type: 'confirm' | 'cancel'; actionId: string };
    attachments?: Array<{
      kind: 'csv' | 'image';
      name: string;
      mimeType?: string;
      sizeBytes?: number;
      text?: string;
      dataUrl?: string;
    }>;
  }) {
    const response = await this.client.post<ApiResponse>('/agent/v2/chat', payload);
    if (response.data.success && response.data.data) return response.data.data as any;
    throw new Error((response.data as any)?.error?.message || 'Agent v2 chat failed');
  }

  /**
   * V3 agentic chat — true LLM tool-use loop. LLM picks tools from the
   * registry, may call multiple in sequence, and returns {assistantMessage,
   * uiBlocks?, uiCommands?, trace[]}. Opt in via
   *   localStorage.setItem('naavik:use-agent-v3', '1')
   * or the UI toggle in Settings.
   */
  async agentV3Chat(
    payload: {
      threadId?: string;
      message: string;
      currentView?: string;
      stream?: string;
    },
    options: { signal?: AbortSignal } = {},
  ) {
    const response = await this.client.post<ApiResponse>('/agent/v3/chat', payload, {
      signal: options.signal,
    });
    if (response.data.success && response.data.data) return response.data.data as any;
    throw new Error((response.data as any)?.error?.message || 'Agent v3 chat failed');
  }

  async submitFeedback(formData: FormData) {
    const response = await this.client.post<ApiResponse>('/feedback', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  // Compass endpoints
  async getCompassDates(): Promise<string[]> {
    const response = await this.client.get<ApiResponse<string[]>>('/compass/dates');
    return this.unwrapPayload<string[]>(response.data, []);
  }

  async getCompassDatesWithRca(): Promise<string[]> {
    const response = await this.client.get<ApiResponse<string[]>>('/compass/dates-with-rca');
    return this.unwrapPayload<string[]>(response.data, []);
  }

  async getCompassOffenders(date: string): Promise<Array<{ USID: string; Total_Impact_to_CQX_Delta: number }>> {
    const response = await this.client.get<ApiResponse>('/compass/offenders', { params: { date } });
    return this.unwrapPayload<Array<{ USID: string; Total_Impact_to_CQX_Delta: number }>>(response.data, []);
  }

  async getCompassSiteTable(params: {
    date: string;
    page?: number;
    page_size?: number;
  }): Promise<{
    data: Array<Record<string, any>>;
    total_count: number;
    page: number;
    page_size: number;
    total_pages: number;
  }> {
    const response = await this.client.get<ApiResponse>('/compass/site-table', {
      params: {
        date: params.date,
        page: params.page || 1,
        page_size: params.page_size || 50,
      },
    });
    return this.unwrapPayload(response.data, { data: [], total_count: 0, page: 1, page_size: 50, total_pages: 0 });
  }

  async getCompassSiteOperational(usid: string, date: string): Promise<{
    usid: string;
    date: string;
    alarms: Array<Record<string, any>>;
    tickets: Array<Record<string, any>>;
    config_changes: Array<Record<string, any>>;
    outages: Array<Record<string, any>>;
    eim: Array<Record<string, any>>;
  }> {
    const response = await this.client.get<ApiResponse>(`/compass/site/${usid}/operational`, { params: { date } });
    return this.unwrapPayload(response.data, { usid, date, alarms: [], tickets: [], config_changes: [], outages: [], eim: [] });
  }

  async getCompassCellSectors(date: string): Promise<Array<Record<string, any>>> {
    const cacheKey = `sectors:${date}`;
    const cached = await localCache.get<Array<Record<string, any>>>(cacheKey);
    if (cached) return cached;
    const response = await this.client.get<ApiResponse>('/compass/cell-sectors', { params: { date } });
    const data = this.unwrapPayload<Array<Record<string, any>>>(response.data, []);
    if (data.length > 0) {
      // Topology is static per day — cache for 24 hours
      localCache.set(cacheKey, data, { ttlMs: 24 * 60 * 60 * 1000 });
    }
    return data;
  }

  async getCompassNeighbors(usid: string, date: string): Promise<Array<Record<string, any>>> {
    const response = await this.client.get<ApiResponse>(`/compass/site/${usid}/neighbors`, { params: { date } });
    return this.unwrapPayload<Array<Record<string, any>>>(response.data, []);
  }

  async getCompassNeighborTrends(usid: string, days?: number): Promise<Array<Record<string, any>>> {
    const d = days || 30;
    const cacheKey = `compass-neighbor-trends:${usid}:${d}`;
    const cached = await localCache.get<Array<Record<string, any>>>(cacheKey);
    if (cached) return cached;
    const response = await this.client.get<ApiResponse>(`/compass/site/${usid}/neighbor-trends`, {
      params: { days: d },
    });
    const data = this.unwrapPayload<Array<Record<string, any>>>(response.data, []);
    if (data.length > 0) localCache.set(cacheKey, data, { ttlMs: 4 * 60 * 60 * 1000 });
    return data;
  }

  async getCompassHourlyInsights(usid: string, date: string, daysBack?: number): Promise<{
    usid: string;
    date: string;
    daysBack: number;
    data: Array<Record<string, any>>;
  }> {
    const db = daysBack || 2;
    const cacheKey = `compass-hourly-insights:${usid}:${date}:${db}`;
    const cached = await localCache.get<{ usid: string; date: string; daysBack: number; data: Array<Record<string, any>> }>(cacheKey);
    if (cached) return cached;
    const response = await this.client.get<ApiResponse>(`/compass/site/${usid}/hourly-insights`, {
      params: { date, days_back: db },
    });
    const result = this.unwrapPayload(response.data, { usid, date, daysBack: db, data: [] });
    if (result.data?.length > 0) localCache.set(cacheKey, result, { ttlMs: 4 * 60 * 60 * 1000 });
    return result;
  }

  async getCompassMarketDashboard(): Promise<{
    total_sites: number;
    total_cells: number;
    total_offenders: number;
    latest_date: string;
  }> {
    const response = await this.client.get<ApiResponse>('/compass/market/dashboard');
    return this.unwrapPayload(response.data, {
      total_sites: 0,
      total_cells: 0,
      total_offenders: 0,
      latest_date: new Date().toISOString().slice(0, 10),
    });
  }

  async getCompassMarketOffenderInsights(date: string): Promise<{
    summary: { critical_count: number; high_count: number; total_offenders: number; total_sites: number; cqx_tracked: number; avg_impact: number };
    impact_breakdown: { dl_tput: number; ul_tput: number; data_drop: number; data_acc: number; vran_acc: number; vcdr_acc: number; voice_drop: number; ns_eso: number; quality: number };
    top_offenders: Array<{ usid: string; total_impact: number; wow_impact: number; impact_delta: number; dl_tput_imp: number; data_drop_imp: number; data_acc_imp: number; quality_imp: number }>;
    trend: Array<{ date_id: string; total_offenders: number; critical: number; high_plus: number; avg_impact: number }>;
  }> {
    const response = await this.client.get<ApiResponse>('/compass/market/offender-insights', { params: { date } });
    return this.unwrapPayload(response.data, {
      summary: { critical_count: 0, high_count: 0, total_offenders: 0, total_sites: 0, cqx_tracked: 0, avg_impact: 0 },
      impact_breakdown: { dl_tput: 0, ul_tput: 0, data_drop: 0, data_acc: 0, vran_acc: 0, vcdr_acc: 0, voice_drop: 0, ns_eso: 0, quality: 0 },
      top_offenders: [],
      trend: [],
    });
  }

  async getCompassMarketCellHealth(date: string): Promise<{
    prb_hot_cells: number;
    pdcch_hot_cells: number;
    high_drop_cells: number;
    low_acc_cells: number;
    low_tput_cells: number;
    avg_prb_util: number;
    cell_health_summary: Array<{ kpi_name: string; cell_count: number; avg_value: number; max_value: number; breaching_count: number }>;
    top_congested_cells: Array<{ cell_name: string; usid: string; kpi_name: string; avg_kpi_value: number }>;
  }> {
    const response = await this.client.get<ApiResponse>('/compass/market/cell-health', { params: { date } });
    return this.unwrapPayload(response.data, {
      prb_hot_cells: 0, pdcch_hot_cells: 0, high_drop_cells: 0, low_acc_cells: 0, low_tput_cells: 0, avg_prb_util: 0,
      cell_health_summary: [], top_congested_cells: [],
    });
  }

  async getCompassDataAvailability(): Promise<Array<Record<string, any>>> {
    const response = await this.client.get<ApiResponse>('/compass/data-availability');
    return this.unwrapPayload<Array<Record<string, any>>>(response.data, []);
  }

  async postCompassUserFeedback(usid: string, date: string, feedback: string): Promise<{ success: boolean }> {
    const response = await this.client.post<ApiResponse>('/compass/user-feedback', { usid, date, feedback });
    return { success: response.data.success };
  }

  /**
   * Get all sites with coordinates from the remote DB (all 6600+ sites)
   * This is the primary map load endpoint — replaces /api/sites/map
   */
  async getCompassSiteTopology(date?: string): Promise<Array<{
    USID: string;
    site_name: string;
    latitude: number;
    longitude: number;
    is_offender: boolean;
    cluster_id: string | null;
  }>> {
    type TopoRow = { USID: string; site_name: string; latitude: number; longitude: number; is_offender: boolean; cluster_id: string | null };
    const dateKey = date ?? 'latest';
    const cacheKey = `topology:${dateKey}`;
    const cached = await localCache.get<TopoRow[]>(cacheKey);
    if (cached) {
      await localCache.touchGroupKey(cacheKey, { groupNamespace: 'map-topology', group: dateKey, maxGroups: 5 });
      return cached;
    }
    const response = await this.client.get<ApiResponse>('/compass/site-topology', {
      params: date ? { date } : undefined,
    });
    const data = this.unwrapPayload<TopoRow[]>(response.data, []);
    if (data.length > 0) {
      // Topology is static per day — cache for 24 hours
      await localCache.set(cacheKey, data, { ttlMs: 24 * 60 * 60 * 1000, groupNamespace: 'map-topology', group: dateKey, maxGroups: 5, skipMemory: true });
    }
    return data;
  }

  async getCompassSiteCalendar(usid: string, year: number, month: number): Promise<Array<{
    date: string;
    anomalyFlag: boolean;
    anomalyScore: number | null;
    hasOutage: boolean;
    hasCot: boolean;
  }>> {
    const response = await this.client.get<ApiResponse>(`/compass/site/${usid}/calendar`, {
      params: { year, month },
    });
    return this.unwrapPayload<
      Array<{
        date: string;
        anomalyFlag: boolean;
        anomalyScore: number | null;
        hasOutage: boolean;
        hasCot: boolean;
      }>
    >(response.data, []);
  }

  async getCompassSiteComprehensive(usid: string, date: string): Promise<Record<string, any>> {
    const response = await this.client.get<ApiResponse>(`/compass/site/${usid}/comprehensive`, {
      params: { date },
    });
    return this.unwrapPayload<Record<string, any>>(response.data, {});
  }

  // ── Migrated from naavik_compass/backend/database/ ──────────────────────

  /** All anomalous sectors for a date — map sector anomaly overlay */
  async getCompassAnomalousSectors(date: string): Promise<Array<Record<string, any>>> {
    const response = await this.client.get<ApiResponse>('/compass/anomalous-sectors', { params: { date } });
    return this.unwrapPayload<Array<Record<string, any>>>(response.data, []);
  }

  /** Neighbor relations with coordinates — map neighbor-connection arrows */
  async getCompassNeighborRelationsWithCoords(
    usid: string,
    date: string,
    face?: string
  ): Promise<Array<Record<string, any>>> {
    const response = await this.client.get<ApiResponse>(`/compass/site/${usid}/neighbor-relations`, {
      params: { date, ...(face ? { face } : {}) },
    });
    return this.unwrapPayload<Array<Record<string, any>>>(response.data, []);
  }

  /** Site-level aggregated hourly KPIs for 4 reference days (day-over-day comparison) */
  async getCompassTimelineSiteKpis(
    usid: string,
    date: string,
    kpiNames: string[]
  ): Promise<Array<Record<string, any>>> {
    const cacheKey = `compass-timeline-kpis:${usid}:${date}:${kpiNames.join('|')}`;
    const cached = await localCache.get<Array<Record<string, any>>>(cacheKey);
    if (cached) return cached;
    const response = await this.client.get<ApiResponse>(`/compass/site/${usid}/timeline-kpis`, {
      params: { date, kpiNames: kpiNames.join(',') },
    });
    const data = response.data.data || [];
    if (data.length > 0) localCache.set(cacheKey, data, { ttlMs: 4 * 60 * 60 * 1000 });
    return data;
  }

  /** CQX subcomponent breakdown from subcomponent_table.
   *  Backend returns tall format (one row per metric per date).
   *  We pivot to wide format (one row per date with metric columns) so chart memos work.
   */
  async getCompassSubcomponentData(
    usid: string,
    date: string,
    days = 30
  ): Promise<Array<Record<string, any>>> {
    const cacheKey = `cqx-sub:${usid}:${date}:${days}`;
    const cached = await localCache.get<Array<Record<string, any>>>(cacheKey);
    if (cached) return cached;

    const response = await this.client.get<ApiResponse>(`/compass/site/${usid}/subcomponent`, {
      params: { date, days },
    });
    const tallRows: Array<Record<string, any>> = response.data.data || [];

    // Pivot tall → wide: group by DATE_ID so each date becomes one row with metric columns
    const byDate = new Map<string, Record<string, any>>();
    for (const row of tallRows) {
      const dateKey = String(row.DATE_ID || row.date_id || '').slice(0, 10);
      if (!dateKey) continue;
      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, { DATE_ID: dateKey, USID: String(row.USID || row.usid || usid) });
      }
      const metricName = String(row.subcomponent_name || '');
      const metricValue = Number(row.subcomponent_value ?? 0);
      if (metricName) byDate.get(dateKey)![metricName] = metricValue;
    }
    // Sort ascending by date so charts display chronologically
    const pivoted = Array.from(byDate.values()).sort((a, b) =>
      String(a.DATE_ID).localeCompare(String(b.DATE_ID))
    );

    if (pivoted.length > 0) {
      localCache.set(cacheKey, pivoted, { ttlMs: 24 * 60 * 60 * 1000 });
    }
    return pivoted;
  }

  /** Per-subcomponent CQX impact breakdown from cqx_offenders_truth_table (wide format). */
  async getCompassSubcomponentImpact(
    usid: string,
    date: string,
    days = 30
  ): Promise<Array<Record<string, any>>> {
    const cacheKey = `cqx-imp:${usid}:${date}:${days}`;
    const cached = await localCache.get<Array<Record<string, any>>>(cacheKey);
    if (cached) return cached;

    const response = await this.client.get<ApiResponse>(`/compass/site/${usid}/subcomponent-impact`, {
      params: { date, days },
    });
    const data: Array<Record<string, any>> = response.data.data || [];
    // Sort ascending so charts display chronologically
    const sorted = [...data].sort((a, b) =>
      String(a.DATE_ID || a.date_id || '').localeCompare(String(b.DATE_ID || b.date_id || ''))
    );
    if (sorted.length > 0) {
      localCache.set(cacheKey, sorted, { ttlMs: 24 * 60 * 60 * 1000 });
    }
    return sorted;
  }

  /** Hourly downtime & failure KPIs for site + neighbors (outage deep-dive) */
  async getCompassSiteNeighborOutages(
    usid: string,
    date: string,
    days = 7
  ): Promise<Array<Record<string, any>>> {
    const response = await this.client.get<ApiResponse>(`/compass/site/${usid}/site-neighbor-outages`, {
      params: { date, days },
    });
    return response.data.data || [];
  }

  /** Distinct neighbor USID list for a site */
  async getCompassNeighborUsids(usid: string, date: string): Promise<string[]> {
    const response = await this.client.get<ApiResponse>(`/compass/site/${usid}/neighbor-usids`, {
      params: { date },
    });
    return response.data.data || [];
  }

  /** Unique radio node names for a site on a date */
  async getCompassNodesForUsid(usid: string, date: string): Promise<string[]> {
    const response = await this.client.get<ApiResponse>(`/compass/site/${usid}/nodes`, {
      params: { date },
    });
    return response.data.data || [];
  }

  /** Coordinates for a list of USIDs — for neighbor map overlays */
  async getCompassSiteCoordinates(
    usids: string[],
    date?: string
  ): Promise<Array<{ usid: string; latitude: number; longitude: number }>> {
    const response = await this.client.post<ApiResponse>('/compass/site-coordinates', { usids, date });
    return response.data.data || [];
  }

  // Generic HTTP methods for external use
  async get<T = any>(url: string, config?: any) {
    const response = await this.client.get<T>(url, config);
    return response.data;
  }

  async post<T = any>(url: string, data?: any, config?: any) {
    const response = await this.client.post<T>(url, data, config);
    return response.data;
  }

  async put<T = any>(url: string, data?: any, config?: any) {
    const response = await this.client.put<T>(url, data, config);
    return response.data;
  }

  async delete<T = any>(url: string, config?: any) {
    const response = await this.client.delete<T>(url, config);
    return response.data;
  }
}

export const api = new ApiService();
export default api;
