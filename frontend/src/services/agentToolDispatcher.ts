/**
 * Agent Tool Dispatcher
 *
 * Intercepts known intents and dispatches them to specialized tool handlers
 * before falling back to agentV2Chat. Preserves all demo flows.
 */

import api from './api';
import { MapSite, ChatMessage } from '../types';
import { classifyIntent } from '../utils/intentClassifier';

export interface AgentToolResult {
  handled: boolean;
  message?: Partial<ChatMessage>;
  uiCommands?: Array<{ type: string; payload: any }>;
}

/**
 * Dispatch agent tool based on intent classification
 * Returns { handled: false } if no tool matched, allowing fallthrough to agentV2Chat
 */
export async function dispatchAgentTool(
  query: string,
  context: {
    mapSites?: MapSite[];
    messageHistory?: Array<{ role: string; content: string }>;
    currentView?: string;
  }
): Promise<AgentToolResult> {
  try {
    const intent = classifyIntent(query);

    // KPI Request Tool
    if (intent.intent === 'kpi_request' && intent.metadata?.siteId) {
      const siteId = intent.metadata.siteId;
      return {
        handled: true,
        message: {
          content: `Here's the KPI dashboard for site ${siteId}:`,
          visualization: {
            type: 'kpi_dashboard',
            data: { siteId },
          },
        },
      };
    }

    // Map View Tool
    if (intent.intent === 'map_view') {
      return await handleMapView(query, context);
    }

    // Site Health Tool
    if (intent.intent === 'site_health' && intent.metadata?.siteId) {
      return await handleSiteHealth(query, intent.metadata.siteId);
    }

    // Network Health Tool
    if (intent.intent === 'network_health') {
      return await handleNetworkHealth(query);
    }

    // Knowledge QA Tool
    if (intent.intent === 'knowledge_qa') {
      return await handleKnowledgeQA(query, context.messageHistory);
    }

    // No tool matched
    return { handled: false };
  } catch (error) {
    console.error('[agentToolDispatcher] Error:', error);
    return { handled: false };
  }
}

/**
 * Map View Tool Handler
 * Renders network map with optional layer filtering
 */
async function handleMapView(
  query: string,
  context: { mapSites?: MapSite[] }
): Promise<AgentToolResult> {
  try {
    // Use cached map sites or fetch fresh
    let sites = context.mapSites;
    if (!sites?.length) {
      const response = await api.getMapSites();
      sites = response?.data || [];
    }

    if (!sites?.length) {
      return { handled: false };
    }

    // Extract layer type if mentioned
    const layer = extractLayerKeyword(query);
    const siteToken = extractSiteTokenFromQuery(query);

    return {
      handled: true,
      message: {
        content: `Here's the network map${layer ? ` — ${layer} sites highlighted` : ':'}`,
        visualization: {
          type: 'map_inset',
          data: sites,
        },
      },
      uiCommands: [
        ...(layer ? [{ type: 'set_layer', payload: { layer } }] : []),
        ...(siteToken ? [{ type: 'open_view', payload: { view: 'observe' } }, { type: 'map_focus_site', payload: { siteToken } }] : []),
      ],
    };
  } catch (error) {
    console.error('[handleMapView] Error:', error);
    return { handled: false };
  }
}

/**
 * Site Health Tool Handler
 * Fetches KPI + RCA data for a specific site
 */
async function handleSiteHealth(_query: string, siteId: string): Promise<AgentToolResult> {
  try {
    const [_kpiResp, rcaResp] = await Promise.all([
      api.getSiteLatestKPIs(siteId),
      api.getSiteRCA(siteId).catch(() => null),
    ]);

    const rcaSummary = rcaResp?.data?.shortSummary || null;

    return {
      handled: true,
      message: {
        content: rcaSummary ? `**${siteId} Health Summary**\n\n${rcaSummary}` : `KPI status for site ${siteId}:`,
        visualization: {
          type: 'kpi_dashboard',
          data: { siteId },
        },
      },
    };
  } catch (error) {
    console.error('[handleSiteHealth] Error:', error);
    return { handled: false };
  }
}

/**
 * Network Health Tool Handler
 * Calls backend analysis and renders report
 */
async function handleNetworkHealth(query: string): Promise<AgentToolResult> {
  try {
    const result = await api.analyzeIntent(query);

    if (!result) {
      return { handled: false };
    }

    return {
      handled: true,
      message: {
        content: result.assistantMessage || 'Network health analysis complete.',
        reportData: result.reportData,
        visualization: result.visualization,
        choiceButtons: result.choiceButtons,
      },
      uiCommands: result.uiCommands,
    };
  } catch (error) {
    console.error('[handleNetworkHealth] Error:', error);
    return { handled: false };
  }
}

/**
 * Knowledge QA Tool Handler
 * Answers telecom knowledge questions with formatted report
 */
async function handleKnowledgeQA(
  query: string,
  messageHistory?: Array<{ role: string; content: string }>
): Promise<AgentToolResult> {
  try {
    const result = await api.askTelecomQuestion(query, 'knowledge', messageHistory);

    if (!result?.answer) {
      return { handled: false };
    }

    const topic = extractTopicFromQuestion(query);

    return {
      handled: true,
      message: {
        content: '', // KnowledgeReportCard will render the content
        visualization: {
          type: 'knowledge_report',
          data: {
            question: query,
            answer: result.answer,
            topic,
          },
        },
      },
    };
  } catch (error) {
    console.error('[handleKnowledgeQA] Error:', error);
    return { handled: false };
  }
}

/**
 * Extract layer type from query (outage, congestion, degraded, overutilized)
 */
function extractLayerKeyword(query: string): string | null {
  const lower = query.toLowerCase();
  if (lower.includes('outage')) return 'outage';
  if (lower.includes('congestion') || lower.includes('congested')) return 'overutilized';
  if (lower.includes('degraded')) return 'degraded';
  if (lower.includes('overutilized') || lower.includes('over-utiliz')) return 'overutilized';
  return null;
}

function extractSiteTokenFromQuery(query: string): string | null {
  const q = String(query || '');
  const ust = q.match(/\bUST0*(\d{4,8})\b/i);
  if (ust?.[1]) return ust[1];
  const usid = q.match(/\bUSID\s*[:#-]?\s*(\d{4,8})\b/i);
  if (usid?.[1]) return usid[1];
  const site = q.match(/\bsite\s+(\d{4,8})\b/i);
  if (site?.[1]) return site[1];
  const plain = q.trim().match(/^(\d{4,8})$/);
  if (plain?.[1]) return plain[1];
  return null;
}

/**
 * Extract topic from knowledge question
 * Matches "what is X", "explain X", "tell me about X", etc.
 */
function extractTopicFromQuestion(query: string): string | null {
  // Match patterns like "what is QRXLEVMIN", "explain PRB", "tell me about X"
  const patterns = [
    /what\s+(?:is|are)\s+(?:the\s+)?([a-zA-Z\s]+?)(?:\?|$)/i,
    /explain\s+(?:the\s+)?([a-zA-Z\s]+?)(?:\?|$)/i,
    /tell\s+me\s+about\s+([a-zA-Z\s]+?)(?:\?|$)/i,
    /define\s+([a-zA-Z\s]+?)(?:\?|$)/i,
    /describe\s+([a-zA-Z\s]+?)(?:\?|$)/i,
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match && match[1]) {
      return match[1].trim().toUpperCase();
    }
  }

  return null;
}
