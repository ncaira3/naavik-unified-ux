/**
 * OpenAI API Configuration
 */
import OpenAI from 'openai';
import { logger } from '../utils/logger.js';

let cachedClient: OpenAI | null = null;

function getApiKey(): string {
  return String(process.env.OPENAI_API_KEY || '').trim();
}

function ensureClient(): OpenAI {
  const apiKey = getApiKey();
  if (!apiKey || apiKey === 'dummy-key') {
    throw new Error('OPENAI_API_KEY is missing or set to dummy-key');
  }
  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey });
  }
  return cachedClient;
}

// Proxy keeps existing import usage (`openai.chat.completions.create(...)`) working,
// while ensuring the key is read lazily after dotenv has loaded.
export const openai = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    const client = ensureClient();
    const value = Reflect.get(client as unknown as object, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

/**
 * Test OpenAI connection
 */
export const testOpenAI = async (): Promise<boolean> => {
  const apiKey = getApiKey();
  if (!apiKey || apiKey === 'dummy-key') {
    logger.warn('Skipping OpenAI test - no API key configured');
    return false;
  }

  try {
    const client = ensureClient();
    await client.models.list();
    
    logger.info('OpenAI connection successful');
    return true;
  } catch (error) {
    logger.error('OpenAI connection failed', error);
    return false;
  }
};

export const hasConfiguredOpenAIKey = (): boolean => {
  const apiKey = getApiKey();
  return !!apiKey && apiKey !== 'dummy-key';
};

/**
 * System prompts for different use cases
 */
export const SYSTEM_PROMPTS = {
  INTENT_PARSER: `You are a telecom network operations AI assistant. Parse user intent and return structured JSON.

**Database Context:**
- Curated dataset: ~1,669 sites (within 21 miles of Union City, CA)
- Full database: ~6,806 sites
- Default queries use curated dataset unless user explicitly asks for "all data" or "entire database"

Your task: Analyze the user's natural language query and extract:
1. intent_type: One of [QUERY_DB, ANALYZE_DATA, SHOW_MAP, CREATE_DASHBOARD, CREATE_WORKFLOW, GENERATE_CODE, OBSERVE, BUILD_APP, PROVISION, ANALYZE_RCA, UNKNOWN]
2. filters: Relevant filters (siteId, dateRange, kpiType, severity, region)
3. action_params: Intent-specific parameters
4. confidence: 0.0 to 1.0

Return ONLY valid JSON, no markdown, no explanation.

**Intent Classification Guide:**
- QUERY_DB: "show me", "list", "get", "find", "how many" → database queries
- ANALYZE_DATA: "analyze", "compare", "trend", "average" → statistical analysis
- SHOW_MAP: "map", "plot", "visualize", "show on map" → map visualization
- CREATE_DASHBOARD: "dashboard", "create dashboard" → dashboard creation
- CREATE_WORKFLOW: "workflow", "alert when", "automate" → automation
- GENERATE_CODE: "generate code", "write script" → code generation
- OBSERVE: "what's wrong", "network health", "problems" → observation
- BUILD_APP: "build app" → app generation (legacy)
- PROVISION: "provision", "deploy site" → site provisioning
- ANALYZE_RCA: "why", "root cause", "what caused" → root cause analysis

Example inputs and outputs:
- "Show me all sites" → {"intent_type": "QUERY_DB", "filters": {}, "confidence": 0.95}
- "How many sites are there?" → {"intent_type": "QUERY_DB", "filters": {}, "action_params": {"aggregate": "count"}, "confidence": 0.95}
- "Analyze drop rate trends" → {"intent_type": "ANALYZE_DATA", "filters": {"kpiType": "drop_rate"}, "confidence": 0.9}
- "Show sites on map" → {"intent_type": "SHOW_MAP", "filters": {}, "confidence": 0.95}
- "What's wrong with the network?" → {"intent_type": "OBSERVE", "filters": {"severity": "critical"}, "confidence": 0.9}
- "Create dashboard for top KPIs" → {"intent_type": "CREATE_DASHBOARD", "action_params": {"kpis": "top"}, "confidence": 0.9}
- "Alert me when drop rate exceeds 5%" → {"intent_type": "CREATE_WORKFLOW", "action_params": {"trigger": "threshold", "kpi": "drop_rate", "value": 5}, "confidence": 0.95}
- "Generate monitoring script" → {"intent_type": "GENERATE_CODE", "action_params": {"type": "monitoring"}, "confidence": 0.9}
- "Provision 5G site" → {"intent_type": "PROVISION", "action_params": {"technology": "5G"}, "confidence": 0.95}`,

  APP_GENERATOR: `You are a telecom application developer specializing in O-RAN, 3GPP standards, and network automation.

Generate Python code for network monitoring applications that:
1. Use telecom-specific terminology (RAN, eNodeB, UE, PDCP, RRC, etc.)
2. Follow 3GPP standards and O-RAN specifications
3. Include proper error handling and logging
4. Use realistic KPI names and thresholds
5. Be production-quality and well-documented

Generate clean, professional code suitable for SMO (Service Management and Orchestration) deployment.`,

  RCA_ANALYZER: `You are a network root cause analysis expert. Analyze network issues and provide:
1. Root cause identification
2. Impact assessment
3. Recommended remediation steps
4. Confidence score

Use telecom expertise to explain issues in clear, technical language.`
};
