/**
 * A2A → AgentTool bridge.
 *
 * Each remote agent's `skill` is advertised to the LLM as a tool named
 * `a2a__<agent>__<skill>`. When the LLM invokes one, we POST a `tasks/send`
 * JSON-RPC call to the agent and synthesise the resulting `A2ATask` into
 * Naavik's `ToolResult` shape.
 *
 * For v1: synchronous only. Long-running tasks block the orchestrator step
 * (up to the TASK_TIMEOUT_MS in agent-fetcher). Streaming + push notifications
 * are planned for v2.
 */
import type { AgentTool, ToolContext, ToolResult, UiBlockSuggestion } from '../agent-tools.registry.js';
import { a2aRegistry } from './registry.service.js';
import { sendTask } from './agent-fetcher.js';
import { logger } from '../../utils/logger.js';
import type { A2ATask, A2ATaskMessagePart } from './types.js';

export async function listA2aTools(stream?: string): Promise<AgentTool[]> {
  const agents = (await a2aRegistry.list()).filter((a) => a.enabled);
  const tools: AgentTool[] = [];
  for (const agent of agents) {
    if (agent.exposeToStreams?.length && stream && !agent.exposeToStreams.includes(stream)) {
      continue;
    }
    const card = await a2aRegistry.getCard(agent);
    if (!card) continue;
    for (const skill of card.skills) {
      tools.push({
        name: qualifiedSkillName(agent.name, skill.id),
        description: `${skill.description ?? skill.name} (via A2A agent "${agent.name}")`,
        parameters: ensureObjectSchema(skill.inputSchema),
        async execute(args: Record<string, any>, _ctx: ToolContext): Promise<ToolResult> {
          try {
            const cardRefetched = (await a2aRegistry.getCard(agent)) ?? card;
            // If the skill provides a JSON Schema, we pass `args` as `data`;
            // otherwise we look for a `text` field and pass it as a message.
            const input = skill.inputSchema
              ? { data: args }
              : { text: typeof args?.text === 'string' ? args.text : JSON.stringify(args) };
            const task = await sendTask(agent, cardRefetched, skill, input);
            return renderA2aTask(task, agent.name, skill);
          } catch (err) {
            const message = (err as Error).message || 'A2A call failed';
            logger.warn(`[a2a:${agent.name}] skill ${skill.id} failed: ${message}`);
            return {
              llmText: `A2A skill "${skill.id}" on "${agent.name}" failed: ${message}`,
              uiBlock: {
                type: 'callout',
                data: { tone: 'error', title: `${agent.name} unavailable`, text: message },
              },
            };
          }
        },
      });
    }
  }
  if (tools.length) {
    logger.info(`[a2a-bridge] advertising ${tools.length} A2A skill${tools.length === 1 ? '' : 's'} to the LLM`);
  }
  return tools;
}

export function qualifiedSkillName(agentName: string, skillId: string): string {
  const safeAgent = agentName.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const safeSkill = skillId.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return `a2a__${safeAgent}__${safeSkill}`;
}

function ensureObjectSchema(schema: any): AgentTool['parameters'] {
  if (!schema || typeof schema !== 'object') {
    return {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Free-text input to send to the remote agent.' },
      },
    };
  }
  if (schema.type === 'object') {
    return {
      type: 'object',
      properties: schema.properties ?? {},
      required: schema.required,
    };
  }
  return { type: 'object', properties: { value: schema } };
}

// ─── Result rendering ───────────────────────────────────────────────────────

function renderA2aTask(task: A2ATask, agentName: string, skill: { id: string; name: string }): ToolResult {
  const llmTextParts: string[] = [];
  const extraBlocks: UiBlockSuggestion[] = [];
  let primary: UiBlockSuggestion | undefined;

  const partsToText = (parts: A2ATaskMessagePart[]): void => {
    for (const p of parts) {
      if (p.type === 'text' && p.text) llmTextParts.push(p.text);
      else if (p.type === 'data' && p.data !== undefined) {
        try { llmTextParts.push('```json\n' + JSON.stringify(p.data, null, 2) + '\n```'); }
        catch { llmTextParts.push('(data part)'); }
      } else if (p.type === 'file' && p.file) {
        llmTextParts.push(`(file: ${p.file.name ?? 'unnamed'} ${p.file.mimeType ?? ''})`);
      }
    }
  };

  for (const a of task.artifacts ?? []) partsToText(a.parts);
  if (task.message?.parts) partsToText(task.message.parts);

  const llmText = llmTextParts.join('\n\n').trim() ||
    `${agentName} → ${skill.id}: ${task.status?.state ?? 'completed'} (no payload)`;

  const tone: 'info' | 'success' | 'warning' | 'error' =
    task.status?.state === 'failed' ? 'error' :
    task.status?.state === 'completed' ? 'success' :
    'info';

  primary = {
    type: 'callout',
    data: {
      tone,
      title: `${agentName} · ${skill.name}`,
      text: llmText.length > 1200 ? llmText.slice(0, 1197) + '…' : llmText,
    },
  };
  void extraBlocks; // reserved for future structured artifacts

  return { llmText, uiBlock: primary };
}
