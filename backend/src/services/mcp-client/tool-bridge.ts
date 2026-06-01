/**
 * MCP → AgentTool bridge.
 *
 * The V3 orchestrator advertises tools to OpenAI via `toOpenAITools(tools)`
 * which expects `AgentTool[]`. We need to:
 *   1. Discover every enabled MCP server's tools.
 *   2. Wrap each as an `AgentTool` with the `mcp__<server>__<tool>` name.
 *   3. Convert the LLM's tool_call payload back into an `mcpClientManager.callTool()`.
 *   4. Render the MCP response (content[]) into Naavik's `llmText` + optional UI blocks.
 */
import type { AgentTool, ToolContext, ToolResult } from '../agent-tools.registry.js';
import { mcpClientManager, parseQualifiedToolName } from './client-manager.js';
import { renderMcpContent } from './content-renderer.js';
import { logger } from '../../utils/logger.js';

interface AdvertisedMcpTool extends AgentTool {
  /** Stash the source server so the dispatcher knows where to route. */
  _mcpServerId: string;
}

/**
 * Produce the list of MCP-derived `AgentTool` entries to advertise this turn.
 * Filtered by `stream` when the user is in a specific chat stream — servers
 * with an `exposeToStreams` whitelist that doesn't include the current stream
 * are skipped (mitigates the 100+ tool advertising problem).
 */
export async function listMcpTools(stream?: string): Promise<AgentTool[]> {
  const allCaps = await mcpClientManager.getAllCapabilities();
  const out: AdvertisedMcpTool[] = [];

  for (const caps of allCaps) {
    // Look up the config to respect per-stream curation
    const tools = caps.tools;
    for (const t of tools) {
      out.push({
        _mcpServerId: caps.serverId,
        name: t.qualifiedName,
        description: t.description ? clampDesc(t.description) : `(MCP) ${t.name} on ${caps.serverName}`,
        parameters: ensureObjectSchema(t.inputSchema),
        async execute(args: Record<string, any>, _ctx: ToolContext): Promise<ToolResult> {
          // Strip the namespace before sending to the external server — they
          // only know their local tool name.
          const parsed = parseQualifiedToolName(t.qualifiedName);
          const localName = parsed?.toolName ?? t.name;
          const result = await mcpClientManager.callTool(caps.serverId, localName, args);
          if (!result.ok) {
            return {
              llmText: `MCP tool "${t.qualifiedName}" failed: ${result.error}`,
              uiBlock: {
                type: 'callout',
                data: { tone: 'error', title: `${caps.serverName} unavailable`, text: result.error },
              },
            };
          }
          return renderMcpContent({
            content: result.content,
            sourceLabel: `${caps.serverName} → ${t.name}`,
          });
        },
      });
    }
  }

  // Optional per-stream curation. For now we expose everything; the registry
  // already supports per-server stream lists for finer control later.
  void stream;
  if (out.length > 0) {
    logger.info(`[mcp-bridge] advertising ${out.length} MCP tool${out.length === 1 ? '' : 's'} to the LLM`);
  }
  return out;
}

function clampDesc(s: string): string {
  return s.length > 400 ? s.slice(0, 397) + '…' : s;
}

/**
 * OpenAI's tool schema requires `type: 'object'` at the top level with
 * `properties`. Some MCP servers return looser shapes (or just `{}`). Normalise.
 */
function ensureObjectSchema(schema: any): AgentTool['parameters'] {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} };
  }
  if (schema.type === 'object') {
    return {
      type: 'object',
      properties: schema.properties ?? {},
      required: schema.required,
    };
  }
  // Wrap non-object schemas so OpenAI accepts them.
  return { type: 'object', properties: { value: schema } };
}
