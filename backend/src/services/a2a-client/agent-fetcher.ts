/**
 * Agent Card fetcher + JSON-RPC client for A2A.
 *
 * Discovery:
 *   GET {agent.url}/.well-known/agent.json  → AgentCard
 *
 * Task submission (synchronous path for now):
 *   POST {card.url ?? agent.url}/a2a/v1
 *   body: { jsonrpc: '2.0', id, method: 'tasks/send', params: { ... } }
 *   response: { jsonrpc: '2.0', id, result: A2ATask }
 *
 * We hold connections lightly — A2A is HTTP, no long-lived sockets unless we
 * subscribe to streams. Each call is independent. Auth headers are computed
 * per call from the configured `secretRef`.
 */
import { randomUUID } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { getSecretProvider } from '../secrets/index.js';
import type { A2AAgentConfig, A2ATask, AgentCard } from './types.js';

const DISCOVERY_TIMEOUT_MS = 10_000;
const TASK_TIMEOUT_MS = 120_000;     // long workflows (RCA-equivalent) live here

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function buildAuthHeaders(cfg: A2AAgentConfig): Promise<Record<string, string>> {
  if (cfg.authMethod === 'none' || !cfg.secretRef) return {};
  const provider = await getSecretProvider();
  const token = await provider.get(cfg.secretRef);
  if (!token) return {};
  if (cfg.authMethod === 'bearer') return { Authorization: `Bearer ${token}` };
  if (cfg.authMethod === 'oauth2_client_credentials') {
    // For oauth2_client_credentials we'd normally do a token exchange here
    // and cache the access_token. v1: the stored secret is treated as a
    // pre-fetched bearer access_token. Upgrade later when needed.
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

export async function discoverAgentCard(cfg: A2AAgentConfig): Promise<AgentCard> {
  const base = cfg.url.replace(/\/+$/, '');
  const url = `${base}/.well-known/agent.json`;
  const headers = await buildAuthHeaders(cfg);
  const res = await fetchWithTimeout(
    url,
    { method: 'GET', headers: { Accept: 'application/json', ...headers } },
    DISCOVERY_TIMEOUT_MS,
  );
  if (!res.ok) {
    throw new Error(`Agent Card discovery failed: ${res.status} ${res.statusText} at ${url}`);
  }
  const card: any = await res.json();
  if (!card || typeof card !== 'object') {
    throw new Error('Agent Card response is not a JSON object');
  }
  if (!Array.isArray(card.skills)) {
    throw new Error('Agent Card is missing required `skills` array');
  }
  logger.info(`[a2a:${cfg.name}] discovered ${card.skills.length} skill(s) at ${url}`);
  return card as AgentCard;
}

/**
 * Send a task and wait for completion. The A2A spec calls this `tasks/send`.
 * For long-running tasks the spec recommends `tasks/sendSubscribe` + SSE,
 * but v1 ships synchronous-only — the orchestrator handles tool latency just
 * fine for tasks up to a couple of minutes.
 */
export async function sendTask(
  cfg: A2AAgentConfig,
  card: AgentCard,
  skill: { id: string; name: string },
  input: { text?: string; data?: any },
): Promise<A2ATask> {
  const baseUrl = (card.url || cfg.url).replace(/\/+$/, '');
  const url = `${baseUrl}`;
  const headers = await buildAuthHeaders(cfg);
  const taskId = randomUUID();
  const parts: any[] = [];
  if (input.text) parts.push({ type: 'text', text: input.text });
  if (input.data !== undefined) parts.push({ type: 'data', data: input.data });

  const body = {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'tasks/send',
    params: {
      id: taskId,
      message: { role: 'user', parts },
      metadata: { skillId: skill.id, skillName: skill.name },
    },
  };

  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
    },
    TASK_TIMEOUT_MS,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`A2A tasks/send failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
  }
  const payload: any = await res.json();
  if (payload?.error) {
    throw new Error(`A2A error ${payload.error.code}: ${payload.error.message}`);
  }
  const task = payload?.result;
  if (!task || typeof task !== 'object') {
    throw new Error('A2A response is missing a result task');
  }
  return task as A2ATask;
}
