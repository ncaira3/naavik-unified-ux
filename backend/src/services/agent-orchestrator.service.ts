import { v4 as uuidv4 } from 'uuid';
import { openai } from '../config/openai.js';
import { logger } from '../utils/logger.js';
import { ConversationContextService } from './conversation-context.service.js';
import { TelecomKnowledgeService } from './telecom-knowledge.service.js';
import { AutomationPipelineService } from './automation-pipeline.service.js';
import { OSSAdapterSimulatorService } from './oss-adapter-simulator.service.js';
import { pool } from '../config/database.js';
import { NaavikDBConnector } from './naavik-db-connector.service.js';
import { siteIdMapper } from './site-id-mapper.service.js';
import { IntentDictionaryService } from './intent-dictionary.service.js';

type AgentIntent =
  | 'observe_report'
  | 'knowledge_qa'
  | 'parameter_change'
  | 'worst_offenders'
  | 'rca_explain'
  | 'navigate'
  | 'general';

type UiCommandType =
  | 'set_date'
  | 'set_layer'
  | 'open_view'
  | 'map_focus_site'
  | 'map_fit_bounds'
  | 'map_highlight_set'
  | 'map_add_layer'
  | 'map_remove_layer'
  | 'open_drawer'
  | 'set_filters'
  | 'set_time_range';
type AllowedUiComponent =
  | 'text'
  | 'chips'
  | 'grid'
  | 'map_inset'
  | 'rca_story'
  | 'execution_status'
  | 'ticket_escalation'
  | 'code_view';

type UiSurface = 'chat' | 'page';

type UiBlockType =
  | 'section'
  | 'grid_layout'
  | 'tabs'
  | 'callout'
  | 'text'
  | 'chips'
  | 'stat_row'
  | 'data_table'
  | 'ranked_list'
  | 'map_inset'
  | 'kpi_dashboard'
  | 'rca_story'
  | 'ticket_escalation'
  | 'execution_status'
  | 'code_view';

type UiBlock =
  | { type: 'text'; id?: string; title?: string; data: { text: string } }
  | { type: 'callout'; id?: string; title?: string; data: { tone: 'info' | 'success' | 'warning' | 'error'; title?: string; text: string } }
  | { type: 'chips'; id?: string; title?: string; data: { chips: Array<{ label: string; value: string }> } }
  | { type: 'stat_row'; id?: string; title?: string; data: { items: Array<{ label: string; value: string; hint?: string }> } }
  | { type: 'data_table'; id?: string; title?: string; data: { title?: string; rows: Array<Record<string, any>>; rowTooltipField?: string } }
  | { type: 'ranked_list'; id?: string; title?: string; data: { title?: string; items: Array<{ title: string; subtitle?: string; value?: string; severity?: 'low' | 'med' | 'high' }> } }
  | { type: 'section'; id?: string; title?: string; data: { description?: string; blocks: UiBlock[] } }
  | { type: 'grid_layout'; id?: string; title?: string; data: { columns?: number; blocks: Array<{ span?: number; block: UiBlock }> } }
  | { type: 'tabs'; id?: string; title?: string; data: { tabs: Array<{ id: string; label: string; blocks: UiBlock[] }> } }
  | { type: 'map_inset'; id?: string; title?: string; data: any }
  | { type: 'kpi_dashboard'; id?: string; title?: string; data: { siteId: string } }
  | { type: 'rca_story'; id?: string; title?: string; data: any }
  | { type: 'ticket_escalation'; id?: string; title?: string; data: any }
  | { type: 'execution_status'; id?: string; title?: string; data: any }
  | { type: 'code_view'; id?: string; title?: string; data: { code: string; language?: string } };

type CanonicalActionKey =
  | 'observe.worst_offenders'
  | 'observe.rca_explain'
  | 'observe.solution_recommendation'
  | 'change.escalate_ticket'
  | 'change.implement_parameter'
  | 'change.no_action'
  | 'navigate.observe'
  | 'navigate.appgen'
  | 'navigate.provision'
  | 'navigate.settings'
  | 'appgen.authorize_build'
  | 'appgen.edit_logic'
  | 'general.clarify';

interface AgentPlan {
  intent: AgentIntent;
  confidence: number;
  entities: {
    dateId?: string;
    siteId?: string;
    parameter?: string;
    value?: string;
    unit?: string;
    layer?: 'degraded' | 'outage' | 'overutilized';
    targetView?: 'observe' | 'appstore' | 'provision' | 'settings' | 'home';
    dictionaryIntent?: string;
  };
  requiresConfirmation?: boolean;
}

interface AgentUiCommand {
  type: UiCommandType;
  payload: any;
}

interface AgentChoiceButton {
  label: string;
  choiceId: string;
}

interface CanonicalIntentAction {
  actionKey: CanonicalActionKey;
  entities?: Record<string, any>;
  confidence: number;
  source: 'typed' | 'button';
  contextRef?: string;
}

interface RcaIntuition {
  name: string;
  applies: boolean;
  explanation?: string;
}

interface StorySitePoint {
  siteId: string;
  siteName: string;
  latitude: number;
  longitude: number;
  isOutage?: boolean;
}

interface SiteRcaStory {
  message: string;
  story?: {
    dateId: string;
    sourceSite: StorySitePoint;
    relatedSites: StorySitePoint[];
    topNeighbors?: StorySitePoint[];
    congestionHighlightSiteIds?: string[];
    allSites?: StorySitePoint[];
    rcaBucket: string;
    shortSummary: string;
    intuitions: RcaIntuition[];
    outageNeighborSiteId?: string;
    trafficCandidates?: StorySitePoint[];
    executeChoiceId?: string;
    escalateChoiceId?: string;
    noActionChoiceId?: string;
    showRecommendations?: boolean;
  };
}

interface AgentActionRequest {
  type: 'confirm' | 'cancel';
  actionId: string;
}

export interface AgentChatAttachment {
  kind: 'csv' | 'image';
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  text?: string;
  dataUrl?: string;
}

export interface AgentV2ChatRequest {
  threadId?: string;
  message: string;
  stream?: string;
  currentView?: string;
  attachments?: AgentChatAttachment[];
  action?: AgentActionRequest;
}

export interface AgentV2ChatResponse {
  threadId: string;
  assistantMessage: string;
  intent: AgentIntent;
  confidence: number;
  uiCommands?: AgentUiCommand[];
  uiSurface?: UiSurface;
  uiBlocks?: UiBlock[];
  reportData?: any;
  actionButtons?: any[];
  choiceButtons?: AgentChoiceButton[];
  visualization?: any;
  executionStatus?: any;
  canonicalAction?: CanonicalIntentAction;
  uiPolicy?: {
    allowed: AllowedUiComponent[];
    fallback: 'clarify_with_chips';
  };
  handled: boolean;
}

const DEFAULT_OFFENDER_DATE = '2026-02-01';

export class AgentOrchestratorService {
  private static readonly remoteDb = new NaavikDBConnector();
  private static readonly UI_ALLOWED: AllowedUiComponent[] = [
    'text',
    'chips',
    'grid',
    'map_inset',
    'rca_story',
    'execution_status',
    'ticket_escalation',
    'code_view',
  ];
  static async chat(input: AgentV2ChatRequest): Promise<AgentV2ChatResponse> {
    const threadId = input.threadId || uuidv4();
    const message = String(input.message || '').trim();
    const stream = String(input.stream || 'universal');
    const currentView = String(input.currentView || 'home');
    const attachments = Array.isArray(input.attachments) ? (input.attachments as AgentChatAttachment[]) : [];

    const context = await ConversationContextService.getContext(threadId);
    const contextData = (context?.contextData || {}) as Record<string, any>;

    if (input.action?.actionId) {
      const actionResponse = await this.handleAction(threadId, input.action, contextData);
      return this.normalizeResponseToAllowedUi(actionResponse, message, {
        source: 'button',
        contextData,
      });
    }

    const plan = await this.plan(message, stream, currentView, contextData, attachments);
    const response = await this.executePlan(plan, message, threadId, stream, currentView, contextData, attachments);
    const governedResponse = this.normalizeResponseToAllowedUi(response, message, {
      source: 'typed',
      contextData,
      plan,
    });
    const nextRecentQueries = Array.isArray(contextData.recentQueries)
      ? [...contextData.recentQueries.slice(-9), message]
      : [message];

    await ConversationContextService.updateContext(threadId, {
      lastQuery: message,
      lastResults: {
        intent: response.intent,
        confidence: governedResponse.confidence,
        handled: governedResponse.handled,
      },
      contextData: {
        ...contextData,
        recentQueries: nextRecentQueries,
        lastIntent: governedResponse.intent,
        lastCanonicalAction: governedResponse.canonicalAction?.actionKey,
        lastChoiceButtons: governedResponse.choiceButtons || [],
        lastRcaScope: this.extractRcaScope(governedResponse),
        lastUpdatedAt: new Date().toISOString(),
      },
    });

    return governedResponse;
  }

  private static extractRcaScope(response: AgentV2ChatResponse): Record<string, any> | undefined {
    if (response?.visualization?.type !== 'rca_story') return undefined;
    const data = response.visualization?.data || {};
    const sourceSiteId = String(data?.sourceSite?.siteId || '').trim();
    if (!sourceSiteId) return undefined;
    return {
      siteId: sourceSiteId,
      dateId: String(data?.dateId || ''),
      outageNeighborSiteId: String(data?.outageNeighborSiteId || ''),
    };
  }

  private static mapIntentToCanonicalAction(
    response: AgentV2ChatResponse,
    message: string,
    source: 'typed' | 'button',
    defaultConfidence = 0.8
  ): CanonicalIntentAction {
    const lower = String(message || '').toLowerCase();
    let actionKey: CanonicalActionKey = 'general.clarify';
    let entities: Record<string, any> = {};

    if (response.intent === 'worst_offenders') {
      actionKey = 'observe.worst_offenders';
      entities = { dateId: this.extractDate(message) || DEFAULT_OFFENDER_DATE };
    } else if (response.intent === 'rca_explain') {
      const sourceSite = String(response?.visualization?.data?.sourceSite?.siteId || this.extractSiteId(message) || '');
      const wantsRecommendation =
        lower.includes('recommend') ||
        lower.includes('recommendation') ||
        lower.includes('solution') ||
        lower.includes('action');
      actionKey = wantsRecommendation ? 'observe.solution_recommendation' : 'observe.rca_explain';
      entities = { siteId: sourceSite, dateId: this.extractDate(message) || DEFAULT_OFFENDER_DATE };
    } else if (response.intent === 'parameter_change') {
      actionKey = 'change.implement_parameter';
    } else if (response.intent === 'navigate') {
      const choiceIds = (response.choiceButtons || []).map((x) => x.choiceId);
      if (choiceIds.includes('nav_observe')) actionKey = 'navigate.observe';
      else if (choiceIds.includes('nav_appgen')) actionKey = 'navigate.appgen';
      else if (choiceIds.includes('nav_provision')) actionKey = 'navigate.provision';
      else if (choiceIds.includes('nav_settings')) actionKey = 'navigate.settings';
    }

    return {
      actionKey,
      entities,
      confidence: Number(response.confidence || defaultConfidence),
      source,
      contextRef: String(response.threadId || ''),
    };
  }

  private static normalizeVisualizationType(type: string): AllowedUiComponent | null {
    const normalized = String(type || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'map') return 'map_inset';
    if (normalized === 'code') return 'code_view';
    if (normalized === 'grid') return 'grid';
    if (normalized === 'rca_story') return 'rca_story';
    if (normalized === 'ticket_escalation') return 'ticket_escalation';
    if (normalized === 'execution_status') return 'execution_status';
    return null;
  }

  private static sanitizeUiBlocks(input: any): UiBlock[] {
    if (!Array.isArray(input)) return [];
    const allowed = new Set<UiBlockType>([
      'section',
      'grid_layout',
      'tabs',
      'callout',
      'text',
      'chips',
      'stat_row',
      'data_table',
      'ranked_list',
      'map_inset',
      'kpi_dashboard',
      'rca_story',
      'ticket_escalation',
      'execution_status',
      'code_view',
    ]);
    const MAX_DEPTH = 5;
    const MAX_BLOCKS = 30;
    const MAX_TEXT = 40_000;
    const MAX_ROWS = 200;

    const clampText = (v: any, max = MAX_TEXT) => {
      const s = String(v ?? '');
      return s.length > max ? `${s.slice(0, max)}…` : s;
    };
    const isObj = (v: any) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

    const sanitizeOne = (b: any, depth: number): UiBlock | null => {
      if (!isObj(b)) return null;
      const type = String((b as any).type || '').trim() as UiBlockType;
      if (!allowed.has(type)) return null;
      const id = (b as any).id ? String((b as any).id).slice(0, 80) : undefined;
      const title = (b as any).title ? clampText((b as any).title, 200) : undefined;
      const data = (b as any).data;

      if (type === 'text') {
        if (!isObj(data)) return null;
        return { type, id, title, data: { text: clampText((data as any).text) } };
      }
      if (type === 'callout') {
        if (!isObj(data)) return null;
        const toneRaw = String((data as any).tone || 'info');
        const tone = toneRaw === 'success' || toneRaw === 'warning' || toneRaw === 'error' ? toneRaw : 'info';
        return {
          type,
          id,
          title,
          data: { tone, title: (data as any).title ? clampText((data as any).title, 200) : undefined, text: clampText((data as any).text) },
        };
      }
      if (type === 'chips') {
        if (!isObj(data) || !Array.isArray((data as any).chips)) return null;
        const chips = (data as any).chips
          .slice(0, 12)
          .map((c: any) => ({ label: clampText(c?.label, 80), value: clampText(c?.value, 600) }))
          .filter((c: any) => c.label && c.value);
        if (!chips.length) return null;
        return { type, id, title, data: { chips } };
      }
      if (type === 'stat_row') {
        if (!isObj(data) || !Array.isArray((data as any).items)) return null;
        const items = (data as any).items
          .slice(0, 16)
          .map((it: any) => ({ label: clampText(it?.label, 80), value: clampText(it?.value, 240), hint: it?.hint ? clampText(it.hint, 200) : undefined }))
          .filter((x: any) => x.label && x.value);
        if (!items.length) return null;
        return { type, id, title, data: { items } };
      }
      if (type === 'data_table') {
        if (!isObj(data) || !Array.isArray((data as any).rows)) return null;
        const rows = (data as any).rows.slice(0, MAX_ROWS).map((r: any) => (isObj(r) ? r : {}));
        return { type, id, title, data: { title: (data as any).title ? clampText((data as any).title, 120) : undefined, rows, rowTooltipField: (data as any).rowTooltipField ? String((data as any).rowTooltipField).slice(0, 80) : undefined } };
      }
      if (type === 'ranked_list') {
        if (!isObj(data) || !Array.isArray((data as any).items)) return null;
        const items = (data as any).items
          .slice(0, 20)
          .map((it: any) => ({
            title: clampText(it?.title, 120),
            subtitle: it?.subtitle ? clampText(it.subtitle, 160) : undefined,
            value: it?.value ? clampText(it.value, 80) : undefined,
            severity: it?.severity === 'high' || it?.severity === 'med' || it?.severity === 'low' ? it.severity : undefined,
          }))
          .filter((x: any) => x.title);
        if (!items.length) return null;
        return { type, id, title, data: { title: (data as any).title ? clampText((data as any).title, 120) : undefined, items } };
      }
      if (type === 'section') {
        if (!isObj(data) || !Array.isArray((data as any).blocks)) return null;
        if (depth >= MAX_DEPTH) return null;
        const blocks = (data as any).blocks
          .slice(0, MAX_BLOCKS)
          .map((x: any) => sanitizeOne(x, depth + 1))
          .filter(Boolean) as UiBlock[];
        if (!blocks.length) return null;
        return { type, id, title, data: { description: (data as any).description ? clampText((data as any).description, 500) : undefined, blocks } };
      }
      if (type === 'grid_layout') {
        if (!isObj(data) || !Array.isArray((data as any).blocks)) return null;
        if (depth >= MAX_DEPTH) return null;
        const blocks = (data as any).blocks
          .slice(0, 12)
          .map((entry: any) => {
            const span = Number(entry?.span);
            const block = sanitizeOne(entry?.block, depth + 1);
            if (!block) return null;
            return { span: Number.isFinite(span) ? Math.max(1, Math.min(12, span)) : undefined, block };
          })
          .filter(Boolean) as Array<{ span?: number; block: UiBlock }>;
        if (!blocks.length) return null;
        return { type, id, title, data: { columns: Number.isFinite(Number((data as any).columns)) ? Number((data as any).columns) : undefined, blocks } };
      }
      if (type === 'tabs') {
        if (!isObj(data) || !Array.isArray((data as any).tabs)) return null;
        if (depth >= MAX_DEPTH) return null;
        const tabs = (data as any).tabs
          .slice(0, 8)
          .map((t: any) => {
            if (!isObj(t)) return null;
            const tid = String(t.id || '').slice(0, 60);
            const label = clampText(t.label, 60);
            const blocks = Array.isArray(t.blocks)
              ? (t.blocks.slice(0, MAX_BLOCKS).map((x: any) => sanitizeOne(x, depth + 1)).filter(Boolean) as UiBlock[])
              : [];
            if (!tid || !label || !blocks.length) return null;
            return { id: tid, label, blocks };
          })
          .filter(Boolean) as Array<{ id: string; label: string; blocks: UiBlock[] }>;
        if (!tabs.length) return null;
        return { type, id, title, data: { tabs } };
      }

      // Bridged types; pass through.
      if (
        type === 'map_inset' ||
        type === 'kpi_dashboard' ||
        type === 'rca_story' ||
        type === 'ticket_escalation' ||
        type === 'execution_status' ||
        type === 'code_view'
      ) {
        return { type, id, title, data } as any;
      }
      return null;
    };

    const out: UiBlock[] = [];
    for (const b of input.slice(0, MAX_BLOCKS)) {
      const block = sanitizeOne(b, 0);
      if (block) out.push(block);
    }
    return out;
  }

  private static normalizeResponseToAllowedUi(
    response: AgentV2ChatResponse,
    message: string,
    opts: { source: 'typed' | 'button'; contextData?: Record<string, any>; plan?: AgentPlan }
  ): AgentV2ChatResponse {
    const out: AgentV2ChatResponse = {
      ...response,
      uiPolicy: {
        allowed: this.UI_ALLOWED,
        fallback: 'clarify_with_chips',
      },
    };

    if (Array.isArray((out as any).uiBlocks)) {
      out.uiBlocks = this.sanitizeUiBlocks((out as any).uiBlocks);
      if (out.uiBlocks.length === 0) out.uiBlocks = undefined;
    }

    if (out.visualization?.type) {
      const mapped = this.normalizeVisualizationType(String(out.visualization.type));
      if (!mapped || !this.UI_ALLOWED.includes(mapped)) {
        out.visualization = undefined;
        out.choiceButtons = [
          { label: 'Open Naavik Observe', choiceId: 'nav_observe' },
          { label: 'Open Naavik AppGen', choiceId: 'nav_appgen' },
          { label: 'Open Naavik Provision', choiceId: 'nav_provision' },
        ];
        out.assistantMessage =
          'I need one clarification to continue. Choose an allowed workflow below, and I will proceed with the right UI component.';
        out.intent = 'general';
        out.confidence = 0.5;
      } else {
        out.visualization = {
          ...out.visualization,
          type: mapped,
        };
      }
    }

    if (Number(out.confidence || 0) < 0.5 && (!out.choiceButtons || out.choiceButtons.length === 0)) {
      out.choiceButtons = [
        { label: 'Open Naavik Observe', choiceId: 'nav_observe' },
        { label: 'Open Naavik AppGen', choiceId: 'nav_appgen' },
        { label: 'Open Naavik Provision', choiceId: 'nav_provision' },
      ];
      out.assistantMessage =
        'I want to make sure I understood correctly. Do you want to observe the network, build an app, or trigger a change?';
      out.intent = 'general';
    }

    out.canonicalAction = this.mapIntentToCanonicalAction(
      out,
      message,
      opts.source,
      opts.plan?.confidence || out.confidence || 0.8
    );

    return out;
  }

  private static async handleAction(
    threadId: string,
    action: AgentActionRequest,
    contextData: Record<string, any>
  ): Promise<AgentV2ChatResponse> {
    const pendingActions = (contextData.pendingActions || {}) as Record<string, any>;
    const pending = pendingActions[action.actionId];

    if (!pending) {
      return {
        threadId,
        intent: 'general',
        confidence: 1,
        assistantMessage: 'This action is no longer available. Please submit the request again.',
        handled: true,
      };
    }

    if (action.type === 'cancel') {
      delete pendingActions[action.actionId];
      await ConversationContextService.updateContext(threadId, {
        contextData: {
          ...contextData,
          pendingActions,
        },
      });
      return {
        threadId,
        intent: 'parameter_change',
        confidence: 1,
        assistantMessage: 'Change cancelled. No network action was triggered.',
        handled: true,
      };
    }

    const executionStatus = OSSAdapterSimulatorService.startParameterChange({
      siteId: pending.siteId,
      parameter: pending.parameter,
      value: pending.value,
      unit: pending.unit,
      moClass: pending.moClass,
      intentText: pending.intentText,
    });

    delete pendingActions[action.actionId];
    await ConversationContextService.updateContext(threadId, {
      contextData: {
        ...contextData,
        pendingActions,
      },
    });

    return {
      threadId,
      intent: 'parameter_change',
      confidence: 1,
      assistantMessage: `**Control Agent** » Executing OSS adapter handshake and parameter update workflow for ${pending.siteId}.`,
      executionStatus,
      choiceButtons: [{ label: 'Open Naavik Provision', choiceId: 'nav_provision' }],
      handled: true,
    };
  }

  private static async executePlan(
    plan: AgentPlan,
    message: string,
    threadId: string,
    _stream: string,
    _currentView: string,
    contextData: Record<string, any>,
    attachments: AgentChatAttachment[] = []
  ): Promise<AgentV2ChatResponse> {
    try {
      if (plan.intent === 'navigate' && plan.entities.targetView) {
        return {
          threadId,
          intent: 'navigate',
          confidence: plan.confidence,
          assistantMessage: `Opening ${plan.entities.targetView} view.`,
          uiCommands: [{ type: 'open_view', payload: { view: plan.entities.targetView } }],
          handled: true,
        };
      }

      if (plan.intent === 'parameter_change') {
        const parsed = this.parseParameterChangeIntent(message, plan.entities);
        if (!parsed) {
          return {
            threadId,
            intent: 'parameter_change',
            confidence: plan.confidence,
            assistantMessage:
              '**Control Agent** » I can execute parameter changes, but I need site, parameter, and value. Example: change qrxlevmin on site 47323 to -114 dBm.',
            handled: true,
          };
        }

        const actionId = uuidv4();
        const pendingActions = { ...(contextData.pendingActions || {}) };
        pendingActions[actionId] = parsed;

        await ConversationContextService.updateContext(threadId, {
          contextData: {
            ...contextData,
            pendingActions,
          },
        });

        const valueWithUnit = parsed.unit ? `${parsed.value} ${parsed.unit}` : parsed.value;
        return {
          threadId,
          intent: 'parameter_change',
          confidence: plan.confidence,
          assistantMessage:
            `**Control Agent** » Review network change request:\n` +
            `Site: ${parsed.siteId}\n` +
            `Parameter: ${parsed.parameter}\n` +
            `Target value: ${valueWithUnit}\n\n` +
            `Confirm to trigger OSS adapter workflow.`,
          choiceButtons: [
            { label: 'Confirm Change', choiceId: `agent_confirm_${actionId}` },
            { label: 'Cancel', choiceId: `agent_cancel_${actionId}` },
          ],
          handled: true,
        };
      }

      if (plan.intent === 'worst_offenders') {
        const dateId = this.extractDate(message) || await this.getLatestOffenderDate();
        const offenders = await this.getWorstOffenders(dateId);
        const gridRows = offenders.map((r) => ({
          Site: r.siteId,
          'Degraded KPI Category': r.degradedKpiCategory,
          'Super KPI Value': r.rankingKpi,
          'Root Cause Of Degradation': r.rca,
          __shortSummaryTooltip: r.shortExplanation,
        }));
        const rankedItems = offenders.slice(0, 8).map((r: any) => ({
          title: String(r.siteId || ''),
          subtitle: String(r.degradedKpiCategory || ''),
          value: Number.isFinite(Number(r.rankingKpi)) ? String(Number(r.rankingKpi).toFixed(2)) : undefined,
          severity: String(r.degradedKpiCategory || '').toLowerCase().includes('outage') ? 'high' : 'med',
        })) as Array<{ title: string; subtitle?: string; value?: string; severity?: 'low' | 'med' | 'high' }>;
        const chips = offenders.slice(0, 5).map((r: any) => ({
          label: `Explain RCA: ${String(r.siteId || '').trim()}`,
          value: `Explain the RCA for site ${String(r.siteId || '').trim()} on ${dateId}`,
        }));

        return {
          threadId,
          intent: 'worst_offenders',
          confidence: plan.confidence,
          assistantMessage:
            offenders.length > 0
              ? `**Observation Agent** » Worst offenders for ${dateId}.`
              : `**Observation Agent** » No offender rows were returned for ${dateId}. I applied the degraded-site map layer for the selected date.`,
          uiSurface: 'chat',
          visualization: offenders.length
            ? {
                type: 'grid',
                data: {
                  title: 'Worst Offenders',
                  showSelection: false,
                  rowTooltipField: '__shortSummaryTooltip',
                  rows: gridRows,
                },
              }
            : undefined,
          uiCommands: [{ type: 'set_date', payload: { dateId } }, { type: 'set_layer', payload: { layer: 'degraded' } }],
          choiceButtons: [{ label: 'Open Naavik Observe', choiceId: 'nav_observe' }],
          handled: true,
        };
      }

      if (plan.intent === 'observe_report') {
        const requestedDate = plan.entities.dateId || this.extractDate(message);
        const pipeline = await AutomationPipelineService.processIntent(message, 'user', requestedDate);
        let reportData = pipeline.report;
        let summary = reportData?.summary || {};
        let resolvedDate = String(summary?.resolvedDate || summary?.reportDate || requestedDate || '');
        let totalSites = Number(summary.totalSites || 0);
        let mapSites = Array.isArray(reportData?.details?.mapSites) ? reportData.details.mapSites : [];
        const isDegradedLikeQuery = /(degraded|offender|outage|congested|congestion)/i.test(String(message || ''));
        if (totalSites === 0 || mapSites.length === 0 || (isDegradedLikeQuery && mapSites.length === 0)) {
          const fallbackDate = resolvedDate || requestedDate || DEFAULT_OFFENDER_DATE;
          const fallbackReport = await this.buildObserveReportFallback(fallbackDate);
          if (fallbackReport) {
            reportData = fallbackReport;
            summary = reportData.summary || {};
            resolvedDate = String(summary?.resolvedDate || summary?.reportDate || fallbackDate || '');
            totalSites = Number(summary.totalSites || 0);
            mapSites = Array.isArray(reportData?.details?.mapSites) ? reportData.details.mapSites : [];
          }
        }
        const outageSites = Number(summary.outageSites || 0);
        const congestedSites = Number(summary.congestedSites || 0);
        const noDegradedForDate = Boolean(summary.noDegradedForDate);
        const text =
          noDegradedForDate
            ? `I analyzed the network for ${resolvedDate}. No degraded offenders were found for that date.`
            : outageSites + congestedSites > 0
              ? `I analyzed the network${resolvedDate ? ` for ${resolvedDate}` : ''}. I found ${outageSites + congestedSites} degraded sites across ${totalSites} total sites.`
              : `I analyzed the network${resolvedDate ? ` for ${resolvedDate}` : ''}. ${totalSites} sites are in scope with no major outage or congestion spikes.`;

        const commands: AgentUiCommand[] = [];
        if (resolvedDate) commands.push({ type: 'set_date', payload: { dateId: resolvedDate } });
        if (plan.entities.layer) commands.push({ type: 'set_layer', payload: { layer: plan.entities.layer } });

	        return {
	          threadId,
	          intent: 'observe_report',
	          confidence: plan.confidence,
	          assistantMessage: text,
	          uiSurface: 'chat',
	          uiBlocks: [
	            {
	              type: 'section',
	              title: 'Network Snapshot',
	              data: {
	                description: resolvedDate ? `Summary for ${resolvedDate}.` : 'Summary.',
	                blocks: [
	                  {
	                    type: 'stat_row',
	                    data: {
	                      items: [
	                        { label: 'Date', value: resolvedDate || requestedDate || DEFAULT_OFFENDER_DATE },
	                        { label: 'Total Sites', value: String(totalSites) },
	                        { label: 'Outage Sites', value: String(outageSites) },
	                        { label: 'Congested Sites', value: String(congestedSites) },
	                      ],
	                    },
	                  },
	                  ...(Array.isArray(mapSites) && mapSites.length
	                    ? [{ type: 'map_inset', data: { sites: mapSites.slice(0, 220) } } as any]
	                    : []),
	                  {
	                    type: 'chips',
	                    data: {
	                      chips: [
	                        { label: 'Open Observe', value: 'Open Naavik Observe' },
	                        { label: 'Worst offenders', value: `Show me the worst offenders for ${resolvedDate || requestedDate || DEFAULT_OFFENDER_DATE}` },
	                      ],
	                    },
	                  },
	                ],
	              },
	            },
	          ],
	          reportData,
	          actionButtons: pipeline.actions,
	          uiCommands: commands.length ? commands : undefined,
	          choiceButtons: [{ label: 'Open Naavik Observe', choiceId: 'nav_observe' }],
	          handled: true,
	        };
	      }

      if (plan.intent === 'rca_explain') {
        const siteId = plan.entities.siteId || this.extractSiteId(message);
        if (!siteId) {
          return {
            threadId,
            intent: 'rca_explain',
            confidence: plan.confidence,
            assistantMessage: 'Please provide a site id (for example: explain RCA for site 47323).',
            handled: true,
          };
        }
        const dateId = this.extractDate(message) || await this.getLatestOffenderDate();
        const rca = await this.getSiteRca(siteId, dateId);
        const sourceSiteId = rca.story?.sourceSite?.siteId;
        const hasOutageNeighbor = Boolean(rca.story?.outageNeighborSiteId);
        const lowerMessage = String(message || '').toLowerCase();
        const includeRecommendations =
          lowerMessage.includes('recommend') ||
          lowerMessage.includes('recommendation') ||
          lowerMessage.includes('solution') ||
          lowerMessage.includes('action') ||
          lowerMessage.includes('fix') ||
          lowerMessage.includes('what should') ||
          lowerMessage.includes('next step');

        const recommendationButtons: AgentChoiceButton[] = sourceSiteId
          ? includeRecommendations
            ? [
                ...(hasOutageNeighbor ? [{ label: 'Escalate Outage Ticket', choiceId: `rca_escalate_${sourceSiteId}` }] : []),
                { label: 'No further action', choiceId: `rca_no_action_${sourceSiteId}` },
              ]
            : [
                { label: 'Solution recommendation', choiceId: `rca_offer_${sourceSiteId}` },
                { label: 'No further action', choiceId: `rca_no_action_${sourceSiteId}` },
              ]
          : [{ label: 'Open Naavik Observe', choiceId: 'nav_observe' }];
        if (sourceSiteId && rca.story) {
          rca.story.showRecommendations = includeRecommendations;
          rca.story.executeChoiceId = includeRecommendations ? `rca_execute_${sourceSiteId}` : undefined;
          rca.story.escalateChoiceId = includeRecommendations && hasOutageNeighbor ? `rca_escalate_${sourceSiteId}` : undefined;
          rca.story.noActionChoiceId = `rca_no_action_${sourceSiteId}`;
        }
        const effectiveDateId = rca.story?.dateId || dateId;
        const relatedSiteIds = rca.story
          ? (rca.story.relatedSites as Array<{ siteId: string }> || [])
              .slice(0, 5)
              .map((s) => String(s.siteId || '').trim())
              .filter(Boolean)
          : [];
        const highlightSiteIds = [
          ...(sourceSiteId ? [sourceSiteId] : []),
          ...relatedSiteIds,
        ];
        const mapCommands: AgentUiCommand[] = [
          { type: 'set_date', payload: { dateId: effectiveDateId } },
          ...(sourceSiteId ? [{ type: 'map_focus_site' as const, payload: { siteToken: sourceSiteId } }] : []),
          ...(highlightSiteIds.length ? [{ type: 'map_highlight_set' as const, payload: { siteIds: highlightSiteIds } }] : []),
        ];
        return {
          threadId,
          intent: 'rca_explain',
          confidence: plan.confidence,
          assistantMessage: includeRecommendations
            ? `Recommended actions are ready for ${sourceSiteId || siteId}. Choose how you want to proceed.`
            : `${rca.message}\n\nWould you like solution recommendations for this issue?`,
          uiSurface: 'chat',
          uiBlocks: rca.story ? [{ type: 'rca_story', data: rca.story }] : undefined,
          visualization: rca.story ? { type: 'rca_story', data: rca.story } : undefined,
          uiCommands: mapCommands,
          handled: true,
          choiceButtons: recommendationButtons,
        };
      }

      if (plan.intent === 'knowledge_qa') {
        const answer = attachments.length
          ? { answer: await this.answerWithAttachments(message, attachments, contextData) }
          : await TelecomKnowledgeService.answerQuestion(message, 'universal_companion');
        return {
          threadId,
          intent: 'knowledge_qa',
          confidence: plan.confidence,
          assistantMessage: answer.answer,
          handled: true,
        };
      }

      const generic = attachments.length
        ? await this.answerWithAttachments(message, attachments, contextData)
        : await this.generateGeneralResponse(message, contextData);
      return {
        threadId,
        intent: 'general',
        confidence: plan.confidence,
        assistantMessage: generic,
        handled: true,
      };
    } catch (error: any) {
      logger.error('Agent v2 execution failed, using robust fallback', error);
      const fallback = await this.safeFallback(message);
      return {
        threadId,
        intent: 'general',
        confidence: 0.5,
        assistantMessage: fallback,
        handled: true,
      };
    }
  }

  private static async plan(
    message: string,
    stream: string,
    currentView: string,
    contextData: Record<string, any>,
    attachments: AgentChatAttachment[] = []
  ): Promise<AgentPlan> {
    const hardRouted = this.hardRouteIntent(message, contextData);
    if (hardRouted) return hardRouted;

    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'dummy-key') {
      return this.fallbackPlan(message);
    }

    const systemPrompt =
      'You are Naavik Agent Planner. Return JSON only with keys: intent, confidence, entities, requiresConfirmation. ' +
      'intent must be one of: observe_report, knowledge_qa, parameter_change, worst_offenders, rca_explain, navigate, general. ' +
      'entities may include dateId(YYYY-MM-DD), siteId, parameter, value, unit, layer(degraded|outage|overutilized), targetView(observe|appstore|provision|settings|home).';

    const recent = Array.isArray(contextData?.recentQueries) ? contextData.recentQueries.slice(-4) : [];
    const attachmentMeta = attachments.slice(0, 3).map((a) => ({
      kind: a.kind,
      name: a.name,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      textPreview: a.kind === 'csv' && a.text ? a.text.slice(0, 2000) : undefined,
      hasImage: a.kind === 'image',
    }));
    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_AGENT_MODEL || 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: JSON.stringify({
              message,
              stream,
              currentView,
              recentQueries: recent,
              attachments: attachmentMeta,
            }),
          },
        ],
        temperature: 0.1,
      });
      const content = completion.choices[0]?.message?.content || '{}';
      const parsed = this.parseJsonObjectFromText(content) || {};
      return {
        intent: this.coerceIntent(parsed.intent),
        confidence: Number(parsed.confidence || 0.8),
        entities: parsed.entities || {},
        requiresConfirmation: Boolean(parsed.requiresConfirmation),
      };
    } catch (error) {
      logger.warn('Agent v2 planner LLM failed; using fallback planner', error);
      return this.fallbackPlan(message, contextData);
    }
  }

  private static coerceIntent(intent: string): AgentIntent {
    const allowed: AgentIntent[] = [
      'observe_report',
      'knowledge_qa',
      'parameter_change',
      'worst_offenders',
      'rca_explain',
      'navigate',
      'general',
    ];
    return allowed.includes(intent as AgentIntent) ? (intent as AgentIntent) : 'general';
  }

  private static fallbackPlan(message: string, contextData: Record<string, any> = {}): AgentPlan {
    const hardRouted = this.hardRouteIntent(message, contextData);
    if (hardRouted) return hardRouted;

    const lower = message.toLowerCase();
    if (/(change|set|update).*(site|on)/i.test(lower) && /( to |= )/i.test(lower)) {
      return { intent: 'parameter_change', confidence: 0.9, entities: {}, requiresConfirmation: true };
    }
    if (lower.includes('worst offender')) {
      return { intent: 'worst_offenders', confidence: 0.9, entities: { dateId: this.extractDate(message) || DEFAULT_OFFENDER_DATE } };
    }
    if (lower.includes('explain') && lower.includes('rca')) {
      return { intent: 'rca_explain', confidence: 0.8, entities: { siteId: this.extractSiteId(message), dateId: this.extractDate(message) || DEFAULT_OFFENDER_DATE } };
    }
    if (/(outage|congest|degraded|offender|network health|map|observe|anomal)/i.test(lower)) {
      return {
        intent: 'observe_report',
        confidence: 0.75,
        entities: {
          dateId: this.extractDate(message),
          layer: lower.includes('outage')
            ? 'outage'
            : lower.includes('congest')
              ? 'overutilized'
              : lower.includes('degraded') || lower.includes('offender')
                ? 'degraded'
                : undefined,
        },
      };
    }
    if (/(open|go to).*(observe|map|appgen|app gen|provision|settings)/i.test(lower)) {
      return {
        intent: 'navigate',
        confidence: 0.85,
        entities: {
          targetView: lower.includes('observe') || lower.includes('map')
            ? 'observe'
            : lower.includes('appgen') || lower.includes('app gen')
              ? 'appstore'
              : lower.includes('provision')
                ? 'provision'
                : lower.includes('settings')
                  ? 'settings'
                  : 'home',
        },
      };
    }
    if (/(what is|explain|define|library|parameter|kpi)/i.test(lower)) {
      return { intent: 'knowledge_qa', confidence: 0.7, entities: {} };
    }
    return { intent: 'general', confidence: 0.4, entities: {} };
  }

  private static hardRouteIntent(message: string, contextData: Record<string, any> = {}): AgentPlan | null {
    const lower = message.toLowerCase();
    const dateId = this.extractDate(message);
    const lastRcaScope = (contextData?.lastRcaScope || {}) as Record<string, any>;
    const scopedSiteId = String(lastRcaScope.siteId || '').trim();
    const scopedDateId = String(lastRcaScope.dateId || '').trim();

    const asksRecommendationOnly =
      /(is there|any|show|give|need|provide|do you have|what are)\s+.*(solution|recommend)/i.test(lower) ||
      /(solution recommendation|recommendation for this|recommended action|what should we do|next best action)/i.test(lower);

    if (asksRecommendationOnly && scopedSiteId) {
      return {
        intent: 'rca_explain',
        confidence: 0.99,
        entities: {
          siteId: scopedSiteId,
          dateId: dateId || scopedDateId || DEFAULT_OFFENDER_DATE,
        },
      };
    }

    if (/(worst\s+offenders?|top\s+offenders?)/i.test(lower)) {
      return {
        intent: 'worst_offenders',
        confidence: 0.99,
        entities: {
          dateId: dateId || DEFAULT_OFFENDER_DATE,
          layer: 'degraded',
        },
      };
    }

    if (/(explain).*(rca).*(site|ust|site_)/i.test(lower)) {
      return {
        intent: 'rca_explain',
        confidence: 0.98,
        entities: {
          siteId: this.extractSiteId(message),
          dateId: dateId || DEFAULT_OFFENDER_DATE,
        },
      };
    }

    if (/(change|set|update).*(site|on).*( to |= )/i.test(lower)) {
      return {
        intent: 'parameter_change',
        confidence: 0.98,
        entities: {},
        requiresConfirmation: true,
      };
    }

    if (/(degraded|outage|congest|offender|network health|show map|observe)/i.test(lower)) {
      return {
        intent: 'observe_report',
        confidence: 0.9,
        entities: {
          dateId,
          layer: lower.includes('outage')
            ? 'outage'
            : lower.includes('congest')
              ? 'overutilized'
              : lower.includes('degraded') || lower.includes('offender')
                ? 'degraded'
                : undefined,
        },
      };
    }

    const dictMatch = IntentDictionaryService.classify(message);
    if (dictMatch.intent !== 'unmatched') {
      const intentMap: Record<string, AgentIntent> = {
        worst_offenders: 'worst_offenders',
        rca_explain: 'rca_explain',
        solution_recommendation: 'rca_explain',
        implement_change: 'parameter_change',
        escalate_ticket: 'general',
        appgen_create: 'general',
        knowledge_qa: 'knowledge_qa',
        provision: 'parameter_change',
      };
      const mappedIntent = intentMap[dictMatch.intent] ?? 'general';
      return {
        intent: mappedIntent,
        confidence: dictMatch.confidence,
        entities: {
          siteId: this.extractSiteId(message) || scopedSiteId || undefined,
          dateId: dateId || scopedDateId || DEFAULT_OFFENDER_DATE,
          dictionaryIntent: dictMatch.intent,
        },
        requiresConfirmation: dictMatch.intent === 'implement_change' || dictMatch.intent === 'provision',
      };
    }

    return null;
  }

  private static parseParameterChangeIntent(
    message: string,
    entities: AgentPlan['entities']
  ): { siteId: string; parameter: string; value: string; unit?: string; moClass?: string; intentText: string } | null {
    const regex =
      /(change|set|update)\s+([a-zA-Z_][a-zA-Z0-9_]*)[\s\S]*?(?:site|on)\s+([a-zA-Z0-9_-]+)[\s\S]*?(?:to|=)\s*(-?\d+(?:\.\d+)?)(?:\s*([a-zA-Z%]+))?/i;
    const match = message.match(regex);

    const parameter = entities.parameter || match?.[2];
    const siteId = entities.siteId || match?.[3];
    const value = entities.value || match?.[4];
    const unit = entities.unit || match?.[5];

    if (!parameter || !siteId || !value) return null;

    return {
      siteId: String(siteId).trim(),
      parameter: String(parameter).trim(),
      value: String(value).trim(),
      unit: unit ? String(unit).trim() : undefined,
      intentText: message,
    };
  }

  private static extractDate(text: string): string | undefined {
    const iso = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
    const us = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
    if (us) {
      const year = us[3].length === 2 ? `20${us[3]}` : us[3];
      return `${year}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
    }
    return undefined;
  }

  /** Return true if a 4-digit string is a calendar year (1900-2099). */
  private static isLikelyYear(n: string): boolean {
    if (n.length !== 4) return false;
    const v = parseInt(n, 10);
    return v >= 1900 && v <= 2099;
  }

  /**
   * Extract a USID from arbitrary text.
   * Any 4-6 digit standalone number is treated as a USID unless it looks like a year.
   */
  private static extractSiteId(text: string): string | undefined {
    // 1. UST-format or SITE-format IDs (highest confidence)
    const ust = text.match(/\b(?:UST\d{4,7}|SITE[_-]?[A-Z]\d{4,7})\b/i);
    if (ust) return ust[0].replace('-', '_').toUpperCase();
    // 2. Numeric after "site" keyword
    const afterSite = text.match(/\bsite\s+(\d{4,7})\b/i);
    if (afterSite) return afterSite[1];
    // 3. Numeric after common action keywords
    const afterKeyword = text.match(/\b(?:for|analyze|check|show|rca|lookup|explain)\s+(\d{4,6})\b/i);
    if (afterKeyword) return afterKeyword[1];
    // 4. Any standalone 4-6 digit number that is not a calendar year
    const allNums = [...text.matchAll(/\b(\d{4,6})\b/g)].map((m) => m[1]);
    return allNums.find((n) => !AgentOrchestratorService.isLikelyYear(n));
  }

  private static async getWorstOffenders(dateId: string, limit: number = 5): Promise<Array<Record<string, any>>> {
    try {
      if (!siteIdMapper.getStats().initialized) {
        await siteIdMapper.initialize();
      }

      const pickField = (row: any, keys: string[]): any => {
        if (!row || typeof row !== 'object') return undefined;
        for (const key of keys) {
          if (row[key] !== undefined) return row[key];
          const found = Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase());
          if (found) return row[found];
        }
        return undefined;
      };

      const parseJson = (value: any): any => {
        if (value == null) return null;
        const raw = String(value).trim();
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      };

      const parseTextField = (value: any): string => {
        const raw = String(value ?? '').trim();
        if (!raw) return '';
        const parsed = parseJson(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          if (typeof parsed.text === 'string') return parsed.text.trim();
          if (parsed.details && typeof parsed.details.summary === 'string') return String(parsed.details.summary).trim();
        }
        return raw;
      };

      const highestDegradedCategory = (degradedKpiPayload: any): string => {
        const parsed = parseJson(degradedKpiPayload);
        if (!parsed || typeof parsed !== 'object') return 'degradation';
        const details = (parsed as any).details || {};
        const categoryRanking = details.category_ranking || (parsed as any).category_ranking || {};
        if (!categoryRanking || typeof categoryRanking !== 'object') return 'degradation';
        const entries = Object.entries(categoryRanking)
          .map(([name, score]) => ({ name, score: Number(score) }))
          .filter((x) => Number.isFinite(x.score))
          .sort((a, b) => b.score - a.score);
        if (!entries.length) return 'degradation';
        return String(entries[0].name || 'degradation').replace(/_/g, ' ').trim();
      };

      const assignAscendingRandomScores = (count: number): number[] => {
        if (count <= 0) return [];
        const out: number[] = [];
        let current = Math.random() * 8;
        for (let i = 0; i < count; i += 1) {
          out.push(Number(Math.max(0, Math.min(100, current)).toFixed(2)));
          const remaining = count - i - 1;
          if (remaining <= 0) break;
          const maxStep = Math.max(2, (100 - current) / remaining);
          const step = 2 + Math.random() * Math.min(24, maxStep);
          current = Math.min(100, current + step);
        }
        return out.sort((a, b) => a - b);
      };

      const toIso = (v: any) => String(v || '').slice(0, 10);
      let remoteDate = dateId;
      let remoteRows: Array<{ USID: string; Total_Impact_to_SuperKPI_Delta: number }> = [];

      try {
        remoteRows = await this.remoteDb.getOffenderUSIDs(remoteDate);
      } catch (error) {
        logger.warn('Remote offender query failed for requested date', error);
      }

      if (!remoteRows.length) {
        try {
          const allDates = (await this.remoteDb.getAllDates()).map((d) => toIso(d)).filter(Boolean).sort();
          if (allDates.length) {
            const candidate = [...allDates].filter((d) => d <= dateId).pop() || allDates[allDates.length - 1];
            remoteDate = candidate;
            remoteRows = await this.remoteDb.getOffenderUSIDs(remoteDate);
          }
        } catch (error) {
          logger.warn('Failed to resolve fallback remote date for offenders', error);
        }
      }

      if (remoteRows.length) {
        const rankedUsids = remoteRows
          .slice(0, limit)
          .map((r) => {
            const usid = String(r.USID || '').trim();
            return {
              usid,
              impact: Number(r.Total_Impact_to_SuperKPI_Delta || 0),
            };
          })
          .filter((x) => !!x.usid);

        const usids = rankedUsids.map((x) => x.usid).filter(Boolean);
        let detailByUsid = new Map<string, any>();
        if (usids.length > 0) {
          try {
            const usidListSql = usids.map((u) => `'${String(u).replace(/'/g, "''")}'`).join(', ');
            const detailRows = await this.remoteDb.query(`
WITH ranked AS (
  SELECT
    CAST(USID AS VARCHAR(64)) AS USID,
    DATE_ID,
    degraded_category,
    rca_bucket,
    short_summary,
    chain_of_thought,
    ROW_NUMBER() OVER (
      PARTITION BY CAST(USID AS VARCHAR(64))
      ORDER BY DATE_ID DESC
    ) AS rn
  FROM site_table WITH (NOLOCK)
  WHERE CAST(USID AS VARCHAR(64)) IN (${usidListSql})
    AND CAST(DATE_ID AS DATE) <= CAST('${remoteDate}' AS DATE)
)
SELECT USID, DATE_ID, degraded_category, rca_bucket, short_summary, chain_of_thought
FROM ranked
WHERE rn = 1
`);
            detailByUsid = new Map(
              (detailRows || []).map((row: any) => [String(pickField(row, ['USID', 'usid']) || '').trim(), row])
            );
          } catch (error) {
            logger.warn('Failed to enrich offenders from remote site_table', error);
          }
        }

        const randomScores = assignAscendingRandomScores(rankedUsids.length);
        return rankedUsids.map((row, idx) => {
          const detail = detailByUsid.get(row.usid) || {};
          const siteId = String(row.usid || '').trim();
          const degradedCategory = highestDegradedCategory(
            pickField(detail, ['degraded_category', 'DEGRADED_CATEGORY'])
          );
          const rcaText = this.sanitizeRcaTextForUi(
            parseTextField(pickField(detail, ['rca_bucket', 'RCA_BUCKET'])) ||
            parseTextField(pickField(detail, ['chain_of_thought', 'CHAIN_OF_THOUGHT'])) ||
            'RCA unavailable'
          );
          const shortSummary = this.sanitizeRcaTextForUi(
            parseTextField(pickField(detail, ['short_summary', 'SHORT_SUMMARY'])) ||
            parseTextField(pickField(detail, ['chain_of_thought', 'CHAIN_OF_THOUGHT'])) ||
            'No summary available'
          );
          return {
            siteId,
            degradedKpiCategory: degradedCategory || 'degradation',
            rankingKpi: randomScores[idx] ?? 0,
            rca: rcaText,
            shortExplanation: shortSummary,
          };
        });
      }

      // Final local fallback if remote returns nothing
      const localResult = await pool.query(
        `
        SELECT
          c."SiteID" AS site_id,
          COALESCE(c."TOTAL_IMPACT_LATEST", 0) AS total_impact_latest,
          COALESCE(s."AnomalyScore", 0) AS anomaly_score
        FROM cqx_offenders_truth_table c
        LEFT JOIN site_table s
          ON s."SiteID" = c."SiteID"
          AND s."DateID" = c."DateID"
        WHERE c."DateID" = $1
        ORDER BY COALESCE(c."TOTAL_IMPACT_LATEST", 0) DESC
        LIMIT $2
        `,
        [dateId, limit]
      );

      const randomScores = assignAscendingRandomScores(localResult.rows.length);
      return localResult.rows.map((row: any, idx: number) => ({
        siteId: row.site_id,
        degradedKpiCategory:
          Number(row.anomaly_score || 0) >= 0.9
            ? 'outage'
            : Number(row.anomaly_score || 0) >= 0.75
              ? 'congestion'
              : 'degradation',
        rankingKpi: randomScores[idx] ?? 0,
        rca: 'RCA unavailable',
        shortExplanation: 'No summary available',
      }));
    } catch (error) {
      logger.warn('Worst offender query failed; returning empty set', error);
      return [];
    }
  }

  /** Returns the latest available date from the offender data (remote first, local fallback). */
  private static async getLatestOffenderDate(): Promise<string> {
    try {
      const allDates = await this.remoteDb.getAllDates();
      if (allDates.length) {
        const latest = allDates
          .map((d: any) => String(d).slice(0, 10))
          .filter(Boolean)
          .sort()
          .pop();
        if (latest) return latest;
      }
    } catch {
      // fall through to local DB
    }
    try {
      const result = await pool.query(
        `SELECT "DateID" FROM cqx_offenders_truth_table ORDER BY "DateID" DESC LIMIT 1`
      );
      const date = String(result.rows[0]?.DateID || '').slice(0, 10);
      if (date) return date;
    } catch {
      // fall through
    }
    return DEFAULT_OFFENDER_DATE;
  }

  private static async buildObserveReportFallback(dateId: string): Promise<any | null> {
    try {
      const offenders = await this.getWorstOffenders(dateId, 50);
      const offenderSiteIds = offenders.map((row) => String(row.siteId || '').trim()).filter(Boolean);

      const [totalSitesResult, offenderCoordsResult, healthyResult] = await Promise.all([
        pool.query(`SELECT COUNT(DISTINCT "SiteID")::int AS count FROM filtered_sites`),
        offenderSiteIds.length
          ? pool.query(
              `
              SELECT DISTINCT ON ("SiteID")
                "SiteID" AS site_id,
                "SiteName" AS site_name,
                "Latitude" AS latitude,
                "Longitude" AS longitude,
                "DateID" AS date_id
              FROM filtered_sites
              WHERE "SiteID" = ANY($1::text[])
              ORDER BY "SiteID", "DateID" DESC
              `,
              [offenderSiteIds]
            )
          : Promise.resolve({ rows: [] as any[] }),
        pool.query(
          `
          SELECT DISTINCT ON ("SiteID")
            "SiteID" AS site_id,
            "SiteName" AS site_name,
            "Latitude" AS latitude,
            "Longitude" AS longitude,
            "DateID" AS date_id
          FROM filtered_sites
          ORDER BY "SiteID", "DateID" DESC
          LIMIT 220
          `
        ),
      ]);

      const coordsBySite = new Map<string, any>();
      (offenderCoordsResult.rows || []).forEach((row: any) => {
        coordsBySite.set(String(row.site_id || '').trim(), row);
      });

      const outageRows: any[] = [];
      const congestedRows: any[] = [];
      const mapSites: any[] = [];
      const tableRows: any[] = [];

      offenders.forEach((row) => {
        const siteId = String(row.siteId || '').trim();
        if (!siteId) return;
        const coords = coordsBySite.get(siteId);
        const degradedCategory = String(row.degradedKpiCategory || '').toLowerCase();
        const status = degradedCategory.includes('outage') ? 'OUTAGE' : 'CRITICAL';
        const node = {
          siteId,
          siteName: String(coords?.site_name || siteId),
          latitude: Number(coords?.latitude),
          longitude: Number(coords?.longitude),
          status,
          anomalyCount: 1,
          hasActiveTickets: true,
          cellCount: 0,
          dateId: String(coords?.date_id || dateId || ''),
          anomalyScore: status === 'OUTAGE' ? 0.95 : 0.85,
        };
        if (Number.isFinite(node.latitude) && Number.isFinite(node.longitude)) {
          mapSites.push(node);
        }
        if (status === 'OUTAGE') outageRows.push(node);
        else congestedRows.push(node);
        tableRows.push({
          siteId,
          date: dateId,
          estSuperKpiImpactDelta: '-',
          possibleRca: status === 'OUTAGE' ? 'Outage/Transport' : 'Congestion',
          action: status === 'OUTAGE' ? 'Outage Resolution' : 'Change Parameter',
        });
      });

      const seen = new Set(mapSites.map((s) => s.siteId));
      (healthyResult.rows || []).forEach((row: any) => {
        const siteId = String(row.site_id || '').trim();
        if (!siteId || seen.has(siteId)) return;
        const latitude = Number(row.latitude);
        const longitude = Number(row.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        seen.add(siteId);
        mapSites.push({
          siteId,
          siteName: String(row.site_name || siteId),
          latitude,
          longitude,
          status: 'NORMAL',
          anomalyCount: 0,
          hasActiveTickets: false,
          cellCount: 0,
          dateId: String(row.date_id || ''),
        });
      });

      const totalSites = Number(totalSitesResult.rows?.[0]?.count || 0);
      return {
        type: 'network_health',
        summary: {
          totalSites,
          outageSites: outageRows.length,
          congestedSites: congestedRows.length,
          affectedCells: Math.max(0, outageRows.length + congestedRows.length),
          reportDate: dateId,
          resolvedDate: dateId,
          topIssue:
            outageRows.length > 0
              ? 'Outage risk dominates current anomaly set.'
              : congestedRows.length > 0
                ? 'Congestion is the primary observed issue.'
                : 'No major outage or congestion spikes detected.',
        },
        details: {
          outages: outageRows,
          congested: congestedRows,
          healthy: [],
          mapSites: mapSites.slice(0, 260),
          tableRows: tableRows.slice(0, 50),
        },
      };
    } catch (error) {
      logger.warn('Observe report fallback failed', error);
      return null;
    }
  }

  private static parseJsonText(value: any): any {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private static parseJsonObjectFromText(value: any): Record<string, any> | null {
    const direct = this.parseJsonText(value);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, any>;
    }

    const text = String(value || '').trim();
    if (!text) return null;

    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      const parsed = this.parseJsonText(fencedMatch[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }
    }

    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
      const parsed = this.parseJsonText(objectMatch[0]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }
    }

    return null;
  }

  private static parseIntuitions(
    intuitionsPayload: string | null | undefined,
    chainOfThought: string | null | undefined
  ): RcaIntuition[] {
    const fromIntuitions: RcaIntuition[] = [];
    const rawIntuitions = String(intuitionsPayload || '').trim();
    if (rawIntuitions) {
      try {
        const parsed = JSON.parse(rawIntuitions);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed)) {
            const payload: any = value || {};
            const status = String(payload.status || payload.applies || '').toUpperCase();
            const applies = status.includes('APPLIES') && !status.includes('DOES NOT APPLY');
            const name = String(payload.rca_category || key || '').replace(/_/g, ' ').trim();
            if (!name) continue;
            fromIntuitions.push({
              name,
              applies,
              explanation: String(payload.justification || payload.explanation || payload.reason || '').trim(),
            });
          }
        }
      } catch {
        // ignore
      }
    }
    if (fromIntuitions.length > 0) return fromIntuitions;

    const chain = String(chainOfThought || '').trim();
    if (!chain) return [];
    return chain
      .split(/\r?\n|;/g)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((line) => ({
        name: line.replace(/^\d+[\).\-\s]*/, ''),
        applies: /applies|applied|yes|true|✓/i.test(line) && !/doesn'?t apply|not apply|false|✕|x/i.test(line),
        explanation: '',
      }));
  }

  private static mapUsidToDummySite(usid: string): string {
    // Dummification disabled — return the raw USID as-is.
    return String(usid || '').trim();
  }

  private static normalizeDummySiteId(siteId: string | null | undefined): string {
    // With dummification off, just return the token normalised to uppercase without adding artificial prefixes.
    return String(siteId || '').trim().toUpperCase();
  }

  private static toNormalizedDummySiteFromToken(token: string): string {
    const raw = String(token || '').trim();
    if (!raw) return '';
    const ustMatch = raw.match(/\bUST0*(\d{4,8})\b/i);
    if (ustMatch?.[1]) {
      return this.normalizeDummySiteId(this.mapUsidToDummySite(ustMatch[1]));
    }
    const usidMatch = raw.match(/\b(\d{4,8})\b/);
    if (usidMatch?.[1]) {
      return this.normalizeDummySiteId(this.mapUsidToDummySite(usidMatch[1]));
    }
    return this.normalizeDummySiteId(raw);
  }

  private static resolveSiteIdByNormalized(
    normalizedSiteId: string | null | undefined,
    sites: Array<{ siteId: string }>
  ): string | undefined {
    const wanted = this.normalizeDummySiteId(normalizedSiteId);
    if (!wanted || !Array.isArray(sites) || sites.length === 0) return undefined;
    const found = sites.find((s) => this.normalizeDummySiteId(String((s as any)?.siteId || '')) === wanted);
    return found?.siteId;
  }

  private static extractOutageNeighborFromText(
    textBlob: string,
    sourceDummySiteId: string
  ): string | undefined {
    const sourceNorm = this.normalizeDummySiteId(sourceDummySiteId);
    const candidateTokens: string[] = [];

    const addMatch = (regex: RegExp): void => {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(textBlob)) !== null) {
        if (match[1]) candidateTokens.push(String(match[1]));
      }
    };

    // Prefer explicit neighbor-site mentions first.
    addMatch(/neighbor\s+site(?:\s+site)?[^\n.]{0,80}?(UST\d{4,8})/gi);
    addMatch(/neighbor\s+site(?:\s+site)?[^\n.]{0,80}?(?:USID\s*[:#-]?\s*)?(\d{4,8})/gi);
    // Broader fallback for outage-at-site wording.
    addMatch(/outage[^\n.]{0,120}?site\s+(UST\d{4,8})/gi);
    addMatch(/outage[^\n.]{0,120}?site\s+(?:USID\s*[:#-]?\s*)?(\d{4,8})/gi);

    for (const token of candidateTokens) {
      const normalized = this.toNormalizedDummySiteFromToken(token);
      if (normalized && normalized !== sourceNorm) return normalized;
    }

    return undefined;
  }

  private static sanitizeRcaTextForUi(input: string): string {
    // Dummification disabled — return text as-is with real site identifiers.
    return String(input || '');
  }

  private static async getSitePointByDummySiteId(siteId: string): Promise<StorySitePoint | null> {
    try {
      const realUsid = await siteIdMapper.resolveRealUSIDFromAnyToken(siteId);

      // Try filtered_sites first, requiring valid non-null coordinates
      const res = await pool.query(
        `
        SELECT "SiteID" AS site_id, "SiteName" AS site_name, "Latitude" AS latitude, "Longitude" AS longitude
        FROM filtered_sites
        WHERE ("SiteID" = $1 OR "SiteID" = $2)
          AND "Latitude" IS NOT NULL AND "Longitude" IS NOT NULL
          AND "Latitude" <> 0 AND "Longitude" <> 0
        LIMIT 1
        `,
        [siteId, realUsid]
      );

      if (res.rows.length > 0) {
        const row: any = res.rows[0];
        const lat = Number(row.latitude);
        const lon = Number(row.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
          return { siteId: String(row.site_id), siteName: String(row.site_name || row.site_id), latitude: lat, longitude: lon };
        }
      }

      // Fallback: try site_table (may have different column casing)
      try {
        const fallback = await pool.query(
          `
          SELECT site_id, site_name, latitude, longitude
          FROM site_table
          WHERE (site_id = $1 OR site_id = $2)
            AND latitude IS NOT NULL AND longitude IS NOT NULL
            AND latitude <> 0 AND longitude <> 0
          LIMIT 1
          `,
          [siteId, realUsid]
        );
        if (fallback.rows.length > 0) {
          const row: any = fallback.rows[0];
          const lat = Number(row.latitude);
          const lon = Number(row.longitude);
          if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
            return { siteId: String(row.site_id), siteName: String(row.site_name || row.site_id), latitude: lat, longitude: lon };
          }
        }
      } catch {
        // site_table may not exist or have different schema — ignore
      }

      return null;
    } catch {
      return null;
    }
  }

  private static async getAllSitesLite(limit: number = 5000): Promise<StorySitePoint[]> {
    try {
      const res = await pool.query(
        `
        SELECT "SiteID" AS site_id, "SiteName" AS site_name, "Latitude" AS latitude, "Longitude" AS longitude
        FROM filtered_sites
        WHERE "Latitude" IS NOT NULL AND "Longitude" IS NOT NULL
          AND "Latitude" <> 0 AND "Longitude" <> 0
        LIMIT $1
        `,
        [limit]
      );
      return res.rows
        .map((row: any) => ({
          siteId: String(row.site_id),
          siteName: String(row.site_name || row.site_id),
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
        }))
        .filter((x: StorySitePoint) => Number.isFinite(x.latitude) && Number.isFinite(x.longitude));
    } catch {
      return [];
    }
  }

  private static async getSiteRca(siteId: string, dateId: string): Promise<SiteRcaStory> {
    try {
      if (!siteIdMapper.getStats().initialized) {
        await siteIdMapper.initialize();
      }

      const resolvedUsid = String(
        siteIdMapper.resolveRealUSIDFromAnyToken(siteId) || siteId.replace(/^UST/i, '')
      ).trim();

      const queryForDate = async (effectiveDate: string) =>
        this.remoteDb.query(`
SELECT TOP 1 USID, DATE_ID, chain_of_thought, intuitions, rca_bucket, short_summary
FROM site_table WITH (NOLOCK)
WHERE CAST(DATE_ID AS DATETIME) = CAST('${effectiveDate}' AS DATETIME)
  AND chain_of_thought IS NOT NULL
  AND CAST(USID AS VARCHAR(64)) = '${resolvedUsid.replace(/'/g, "''")}'
ORDER BY DATE_ID DESC
`);

      let rows = await queryForDate(dateId);
      let effectiveDate = dateId;
      if (!rows.length) {
        const fallbackDateRows = await this.remoteDb.query(`
SELECT TOP 1 CAST(DATE_ID AS DATE) AS resolved_date
FROM site_table WITH (NOLOCK)
WHERE CAST(DATE_ID AS DATE) <= CAST('${dateId}' AS DATE)
  AND CAST(USID AS VARCHAR(64)) = '${resolvedUsid.replace(/'/g, "''")}'
ORDER BY DATE_ID DESC
`);
        const fallbackDate = String((fallbackDateRows?.[0] as any)?.resolved_date || '').slice(0, 10);
        if (fallbackDate) {
          effectiveDate = fallbackDate;
          rows = await queryForDate(fallbackDate);
        }
      }

      if (!rows.length) {
        return { message: `No RCA found for ${siteId} on ${dateId}.` };
      }

      const row: any = rows[0];
      const parseText = (value: any): string => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed?.text === 'string') return parsed.text;
          return raw;
        } catch {
          return raw;
        }
      };

      const rcaBucketRaw = parseText((row as any).rca_bucket) || 'RCA unavailable';
      const shortSummaryRaw = parseText((row as any).short_summary) || 'No short summary available.';
      const rcaBucket = this.sanitizeRcaTextForUi(rcaBucketRaw);
      const shortSummary = this.sanitizeRcaTextForUi(shortSummaryRaw);
      const usid = String((row as any).USID || resolvedUsid).trim();
      const sourceDummy = this.mapUsidToDummySite(usid);
      logger.info(`RCA lookup: USID=${usid}, dummy=${sourceDummy}`);
      const sourceSite =
        (await this.getSitePointByDummySiteId(sourceDummy)) || {
          siteId: sourceDummy,
          siteName: sourceDummy,
          latitude: 37.6,
          longitude: -122.1,
        };
      logger.info(`RCA source site: ${sourceSite.siteId} at (${sourceSite.latitude}, ${sourceSite.longitude})`);

      const intuitionItems = this.parseIntuitions(
        String((row as any).intuitions || ''),
        String((row as any).chain_of_thought || '')
      ).map((item) => ({
        ...item,
        name: this.sanitizeRcaTextForUi(item.name),
        explanation: this.sanitizeRcaTextForUi(item.explanation || ''),
      }));

      const textBlob = `${rcaBucket}\n${shortSummary}\n${intuitionItems.map((i) => i.explanation || '').join('\n')}`;
      const mentionedUsids = Array.from(new Set((textBlob.match(/\bUSID\s*[:#-]?\s*(\d{4,8})\b/gi) || [])
        .map((m) => String(m.match(/(\d{4,8})/)?.[1] || ''))
        .filter(Boolean)));
      const sourceNorm = this.normalizeDummySiteId(sourceDummy);
      const mentionedSites = Array.from(new Set((textBlob.match(/\bUST\d{4,8}\b/gi) || [])))
        .map((token) => this.normalizeDummySiteId(this.mapUsidToDummySite(String(token).replace(/^UST/i, ''))))
        .filter((id) => id && id !== sourceNorm);
      mentionedUsids.forEach((u) => {
        const mapped = this.normalizeDummySiteId(this.mapUsidToDummySite(u));
        if (mapped && mapped !== sourceNorm && !mentionedSites.includes(mapped)) mentionedSites.push(mapped);
      });

      const relatedSites: StorySitePoint[] = [];
      for (const sid of mentionedSites.slice(0, 8)) {
        const pt = await this.getSitePointByDummySiteId(sid);
        if (pt) relatedSites.push(pt);
      }

      const lowerSummary = `${rcaBucket} ${shortSummary}`.toLowerCase();
      const outageHint = /outage|downtime|down/.test(lowerSummary);
      const allSites = await this.getAllSitesLite();
      const isOutageNeighborRca = /outage\s*-\s*neighbor|neighbor.*outage/i.test(lowerSummary);

      let outageNeighborSiteId =
        this.resolveSiteIdByNormalized(
          this.extractOutageNeighborFromText(textBlob, sourceDummy),
          [...relatedSites, ...allSites]
        ) ||
        this.resolveSiteIdByNormalized(
          this.normalizeDummySiteId(relatedSites.find((s) => /neighbor/i.test(String(s.siteName || '')))?.siteId || ''),
          [...relatedSites, ...allSites]
        );

      const distanceSq = (a: StorySitePoint, b: StorySitePoint): number => {
        const dx = a.latitude - b.latitude;
        const dy = a.longitude - b.longitude;
        return dx * dx + dy * dy;
      };

      let topNeighbors = allSites
        .filter((s) => s.siteId !== sourceSite.siteId)
        .map((s) => ({ site: s, d: distanceSq(s, sourceSite) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 50)
        .map((x) => x.site);

      if (outageHint && !outageNeighborSiteId && topNeighbors.length > 0) {
        outageNeighborSiteId = topNeighbors[0].siteId;
      }
      if (outageNeighborSiteId && !topNeighbors.some((s) => this.normalizeDummySiteId(s.siteId) === this.normalizeDummySiteId(outageNeighborSiteId))) {
        const outagePoint = relatedSites.find((s) => this.normalizeDummySiteId(s.siteId) === this.normalizeDummySiteId(outageNeighborSiteId));
        if (outagePoint) {
          topNeighbors = [outagePoint, ...topNeighbors].slice(0, 15);
        }
      }

      // For "Outage - Neighbor", enforce that the outage marker is a true neighbor, never the offender.
      if (
        isOutageNeighborRca &&
        (!outageNeighborSiteId || this.normalizeDummySiteId(outageNeighborSiteId) === this.normalizeDummySiteId(sourceSite.siteId))
      ) {
        const firstNeighbor = topNeighbors.find(
          (s) => this.normalizeDummySiteId(s.siteId) !== this.normalizeDummySiteId(sourceSite.siteId)
        );
        if (firstNeighbor) {
          outageNeighborSiteId = firstNeighbor.siteId;
        }
      }

      const relatedWithFlags = relatedSites.map((s) => ({
        ...s,
        isOutage:
          Boolean(outageHint) &&
          this.normalizeDummySiteId(s.siteId) === this.normalizeDummySiteId(outageNeighborSiteId || ''),
      }));

      const topNeighborsWithFlags = topNeighbors.map((s) => ({
        ...s,
        isOutage: this.normalizeDummySiteId(outageNeighborSiteId || '') === this.normalizeDummySiteId(s.siteId),
      }));

      const trafficCandidates = topNeighborsWithFlags.filter((s) => !s.isOutage).slice(0, 2);

      let congestionHighlightSiteIds: string[] = [];
      if (/congestion/i.test(lowerSummary)) {
        try {
          const congestionRows = await this.remoteDb.query(`
SELECT TOP 50 USID
FROM site_table WITH (NOLOCK)
WHERE CAST(DATE_ID AS DATETIME) = CAST('${effectiveDate}' AS DATETIME)
  AND chain_of_thought IS NULL
  AND rca_bucket LIKE '%Congestion%'
`);
          congestionHighlightSiteIds = Array.from(
            new Set(
              (congestionRows || [])
                .map((r: any) => this.mapUsidToDummySite(String(r.USID || '').trim()))
                .filter(Boolean)
            )
          );
        } catch (error) {
          logger.warn('Failed to load congestion highlight sites for RCA story', error);
        }
      }
      return {
        message: `RCA for ${sourceSite.siteId} on ${effectiveDate}: ${rcaBucket}\n\n${shortSummary}`,
        story: {
          dateId: effectiveDate,
          sourceSite,
          relatedSites: topNeighborsWithFlags,
          topNeighbors: topNeighborsWithFlags,
          congestionHighlightSiteIds,
          allSites,
          rcaBucket,
          shortSummary,
          intuitions: intuitionItems,
          outageNeighborSiteId,
          trafficCandidates,
        },
      };
    } catch (error) {
      logger.warn('Site RCA lookup failed', error);
      return { message: `RCA lookup failed for ${siteId}. Please open Naavik Observe for full RCA workflow.` };
    }
  }

  private static async generateGeneralResponse(
    message: string,
    contextData: Record<string, any>
  ): Promise<string> {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'dummy-key') {
      return 'I can help with observe/analyze, app building, telco knowledge, and controlled parameter changes. Tell me what outcome you want.';
    }

    const prompt =
      'You are Naavik Telecom Copilot. Respond in 2-4 concise lines. ' +
      'If the user asks for actions, mention the exact next action and ask one clarifying question only when required.';

    const recent = Array.isArray(contextData.recentQueries) ? contextData.recentQueries.slice(-4) : [];
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_AGENT_MODEL || 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: JSON.stringify({
            userMessage: message,
            recentQueries: recent,
          }),
        },
      ],
      temperature: 0.2,
      max_tokens: 220,
    });

    return completion.choices[0]?.message?.content?.trim() || 'How should I help next?';
  }

  private static async answerWithAttachments(
    message: string,
    attachments: AgentChatAttachment[],
    _contextData: Record<string, any>
  ): Promise<string> {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'dummy-key') {
      return 'I can see you attached a file, but attachment Q&A requires an OpenAI API key to be configured on the backend.';
    }

    const csvBlocks = attachments
      .filter((a) => a.kind === 'csv' && typeof a.text === 'string' && a.text.trim().length > 0)
      .map((a) => {
        const text = String(a.text || '').slice(0, 80_000);
        const truncated = String(a.text || '').length > text.length ? '\n\n[Truncated]\n' : '';
        return `--- CSV: ${a.name} ---\n${text}${truncated}`;
      })
      .join('\n\n');

    const systemPrompt =
      'You are Aira, a telecom/network analytics copilot inside Naavik. ' +
      'The user attached one or more files (CSV or images). Use the attachment content to answer the user question. ' +
      'If you need a specific column/row that is not present due to truncation, ask one targeted follow-up question. ' +
      'Be precise and practical; avoid generic filler.';

    const textIntro =
      `User question:\n${message}\n\n` +
      (csvBlocks ? `Attachment text:\n${csvBlocks}\n\n` : 'Attachment text: (none)\n\n') +
      `Instructions:\n- If the user asks to compute something, show the exact formula and assumptions.\n- If you reference columns, quote the column names.\n`;

    const imageAttachments = attachments.filter((a) => a.kind === 'image' && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:'));
    const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_AGENT_MODEL || 'gpt-4.1-mini';

    const userContent: any = imageAttachments.length
      ? [
          { type: 'text', text: textIntro },
          ...imageAttachments.map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl } })),
        ]
      : textIntro;

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent as any },
      ],
      temperature: 0.2,
      max_tokens: 700,
    });

    return completion.choices[0]?.message?.content?.trim() || 'I could not analyze the attachment. Please try again.';
  }

  private static async safeFallback(message: string): Promise<string> {
    try {
      const qa = await TelecomKnowledgeService.answerQuestion(message, 'universal_companion');
      return qa.answer || 'I hit a transient issue, but I can continue. Please retry your request.';
    } catch {
      return 'I hit a transient issue while processing that request. Please retry, or rephrase with site/date/action.';
    }
  }
}
