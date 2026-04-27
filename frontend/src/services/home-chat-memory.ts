/**
 * Home Chat Memory Service
 * Maintains conversation context and history for the universal/home chat stream
 */

import { ChatMessage } from '../types';

export interface HomeChatMemory {
  conversationId: string;
  totalMessages: number;
  lastActivity: Date;
  topics: string[];
  recentQueries: string[];
  contextSummary: string;
  userIntent: string | null;
  relatedSites: string[];
  relatedKpis: string[];
}

const STORAGE_KEY = 'naavik-home-chat-memory';
const MAX_RECENT_QUERIES = 5;
const MAX_TOPICS = 10;

/**
 * Extract topics from conversation messages
 */
function extractTopics(messages: ChatMessage[]): string[] {
  const topics = new Set<string>();

  const userMessages = messages.filter(m => m.role === 'user').map(m => m.content.toLowerCase());
  const fullText = userMessages.join(' ');

  // KPI topics
  if (/prb|packet request|buffer/.test(fullText)) topics.add('PRB');
  if (/drop rate|data drop|ddr/.test(fullText)) topics.add('Drop Rate');
  if (/throughput|thpt|bandwidth/.test(fullText)) topics.add('Throughput');
  if (/coverage|rxlevmin|signal/.test(fullText)) topics.add('Coverage');
  if (/latency|delay|response time/.test(fullText)) topics.add('Latency');
  if (/availability|avail|availability/.test(fullText)) topics.add('Availability');
  if (/congestion|congested/.test(fullText)) topics.add('Congestion');
  if (/alarm|alert|critical/.test(fullText)) topics.add('Alarms');

  // Intent topics
  if (/diagnose|troubleshoot|problem|issue|wrong/.test(fullText)) topics.add('Diagnosis');
  if (/optimize|improve|performance|tune/.test(fullText)) topics.add('Optimization');
  if (/show|display|map|visual/.test(fullText)) topics.add('Visualization');
  if (/parameter|kpi|metric|counter/.test(fullText)) topics.add('Learning');
  if (/automate|app|build|create|workflow/.test(fullText)) topics.add('Automation');

  return Array.from(topics).slice(0, MAX_TOPICS);
}

/**
 * Extract recent user queries
 */
function extractRecentQueries(messages: ChatMessage[]): string[] {
  return messages
    .filter(m => m.role === 'user')
    .map(m => m.content.trim())
    .slice(-MAX_RECENT_QUERIES)
    .reverse();
}

/**
 * Infer primary user intent from conversation
 */
function inferIntent(messages: ChatMessage[]): string | null {
  const userMessages = messages.filter(m => m.role === 'user').map(m => m.content.toLowerCase());
  const fullText = userMessages.join(' ');

  if (/what.*wrong|problem|issue|diagnose|troubleshoot|why/.test(fullText)) return 'Diagnosis';
  if (/show.*map|visualiz|display|trend|chart|plot/.test(fullText)) return 'Visualization';
  if (/improve|optimize|increase|decrease|tune|adjust/.test(fullText)) return 'Optimization';
  if (/what.*is|explain|tell.*about|parameter|kpi|metric/.test(fullText)) return 'Learning';
  if (/build|create|automate|app|workflow|logic/.test(fullText)) return 'Automation';
  if (/change|update|set|provision|configure/.test(fullText)) return 'Configuration';

  return null;
}

/**
 * Extract mentioned site IDs
 */
function extractSites(messages: ChatMessage[]): string[] {
  const sites = new Set<string>();
  const userMessages = messages.filter(m => m.role === 'user').map(m => m.content);

  for (const msg of userMessages) {
    // Look for site patterns like "CCMN006608F" or "Site X"
    const siteMatches = msg.match(/[A-Z]{2}[A-Z0-9]{7,}|site\s+[A-Za-z0-9]+/gi);
    if (siteMatches) {
      siteMatches.forEach(s => sites.add(s.toUpperCase()));
    }
  }

  return Array.from(sites).slice(0, 5);
}

/**
 * Extract mentioned KPIs
 */
function extractKpis(messages: ChatMessage[]): string[] {
  const kpis = new Set<string>();
  const userMessages = messages.filter(m => m.role === 'user').map(m => m.content.toUpperCase());
  const fullText = userMessages.join(' ');

  const kpiPatterns = [
    { name: 'PRB', pattern: /\bPRB\b|PACKET REQUEST/ },
    { name: 'DATA_DROP_RATE', pattern: /DROP\s+RATE|DDR/ },
    { name: 'THPT', pattern: /THROUGHPUT|THPT/ },
    { name: 'Accessibility', pattern: /ACCESSIB|ACC RATE/ },
    { name: 'Availability', pattern: /AVAILAB/ },
    { name: 'Call Drop', pattern: /CALL\s+DROP|VCDR/ },
    { name: 'Poor Quality', pattern: /QUALITY|PQR/ },
  ];

  for (const { name, pattern } of kpiPatterns) {
    if (pattern.test(fullText)) {
      kpis.add(name);
    }
  }

  return Array.from(kpis);
}

/**
 * Build conversation memory from messages
 */
export function buildHomeChatMemory(
  conversationId: string,
  messages: ChatMessage[]
): HomeChatMemory {
  return {
    conversationId,
    totalMessages: messages.length,
    lastActivity: new Date(),
    topics: extractTopics(messages),
    recentQueries: extractRecentQueries(messages),
    contextSummary: generateContextSummary(messages),
    userIntent: inferIntent(messages),
    relatedSites: extractSites(messages),
    relatedKpis: extractKpis(messages),
  };
}

/**
 * Generate a brief context summary
 */
function generateContextSummary(messages: ChatMessage[]): string {
  if (messages.length === 0) {
    return 'No conversation yet';
  }

  const parts: string[] = [];

  const topics = extractTopics(messages);
  if (topics.length > 0) {
    parts.push(`Topics: ${topics.slice(0, 3).join(', ')}`);
  }

  const intent = inferIntent(messages);
  if (intent) {
    parts.push(`Focus: ${intent}`);
  }

  const messageCount = messages.filter(m => m.role === 'user').length;
  parts.push(`${messageCount} user queries`);

  return parts.join(' • ');
}

/**
 * Save memory to localStorage
 */
export function saveHomeChatMemory(memory: HomeChatMemory): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch (error) {
    console.warn('Failed to save home chat memory:', error);
  }
}

/**
 * Load memory from localStorage
 */
export function loadHomeChatMemory(): HomeChatMemory | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to load home chat memory:', error);
  }
  return null;
}

/**
 * Clear memory
 */
export function clearHomeChatMemory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear home chat memory:', error);
  }
}

/**
 * Get context awareness summary for display
 */
export function getContextSummary(memory: HomeChatMemory | null): string {
  if (!memory || memory.totalMessages === 0) {
    return 'Ready to help. What would you like to know about your network?';
  }

  const parts: string[] = [];

  if (memory.relatedKpis.length > 0) {
    parts.push(`Tracking: ${memory.relatedKpis.join(', ')}`);
  }

  if (memory.relatedSites.length > 0) {
    parts.push(`Sites: ${memory.relatedSites.slice(0, 2).join(', ')}${memory.relatedSites.length > 2 ? ', ...' : ''}`);
  }

  if (memory.userIntent) {
    parts.push(`Goal: ${memory.userIntent}`);
  }

  return parts.length > 0 ? parts.join(' • ') : memory.contextSummary;
}
