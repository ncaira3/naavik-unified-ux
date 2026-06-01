/**
 * MCP client manager — owns one connection per configured server.
 *
 * Responsibilities:
 *   - Connect on first use (lazy), keep alive
 *   - Reconnect on disconnect with exponential backoff
 *   - Discover capabilities (tools / resources / prompts) and cache them
 *   - Provide the runtime `callTool` entrypoint used by the orchestrator
 *
 * Anything that's not "manage a connection" lives elsewhere:
 *   - persistence  → registry.service
 *   - tool-shape conversion → tool-bridge
 *   - MCP-content → Naavik UI block conversion → content-renderer
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { logger } from '../../utils/logger.js';
import { getSecretProvider } from '../secrets/index.js';
import type { McpHealth, McpServerCapabilities, McpServerConfig } from './types.js';

const CAPABILITY_TTL_MS = 10 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 30_000;

interface Connection {
  config: McpServerConfig;
  client: Client | null;
  capabilities: McpServerCapabilities | null;
  capabilitiesFetchedAt: number;
  health: McpHealth;
  /** Promise of the in-flight connect, so concurrent callers wait on one attempt. */
  connectingPromise: Promise<void> | null;
}

const NAAVIK_CLIENT_INFO = {
  name: 'naavik-unified-ux',
  version: '1.0.0',
};

export class McpClientManager {
  private connections = new Map<string, Connection>();

  /** Register a server config. Connection is deferred until first use. */
  register(config: McpServerConfig): void {
    const existing = this.connections.get(config.id);
    if (existing) {
      // If important params changed, tear down so we reconnect on next use.
      const changed =
        existing.config.transport !== config.transport ||
        existing.config.command !== config.command ||
        existing.config.url !== config.url ||
        JSON.stringify(existing.config.args ?? []) !== JSON.stringify(config.args ?? []) ||
        JSON.stringify(existing.config.envOverrides ?? {}) !== JSON.stringify(config.envOverrides ?? {});
      existing.config = config;
      if (changed) this.disconnect(config.id).catch(() => undefined);
      return;
    }
    this.connections.set(config.id, {
      config,
      client: null,
      capabilities: null,
      capabilitiesFetchedAt: 0,
      health: { serverId: config.id, status: 'disconnected' },
      connectingPromise: null,
    });
  }

  /** Forget the server entirely. Disconnects if connected. */
  async unregister(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    await this.disconnect(serverId);
    this.connections.delete(serverId);
  }

  /** Force a tear-down — used on config change or shutdown. */
  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn?.client) return;
    try {
      await conn.client.close();
    } catch {
      /* ignore — best-effort */
    }
    conn.client = null;
    conn.capabilities = null;
    conn.capabilitiesFetchedAt = 0;
    conn.health = { serverId, status: 'disconnected' };
  }

  /** Snapshot of every server's current health. */
  listHealth(): McpHealth[] {
    return Array.from(this.connections.values()).map((c) => ({ ...c.health }));
  }

  health(serverId: string): McpHealth | null {
    const c = this.connections.get(serverId);
    return c ? { ...c.health } : null;
  }

  /** Best-effort: return cached capabilities. Refreshes when stale. */
  async getCapabilities(serverId: string): Promise<McpServerCapabilities | null> {
    const conn = this.connections.get(serverId);
    if (!conn || !conn.config.enabled) return null;
    if (
      conn.capabilities &&
      Date.now() - conn.capabilitiesFetchedAt < CAPABILITY_TTL_MS
    ) {
      return conn.capabilities;
    }
    try {
      await this.ensureConnected(conn);
      const caps = await this.discoverCapabilities(conn);
      conn.capabilities = caps;
      conn.capabilitiesFetchedAt = Date.now();
      return caps;
    } catch (err) {
      logger.warn(`[mcp:${conn.config.name}] capability discovery failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Iterates all enabled servers and returns the union of their tools. */
  async getAllCapabilities(): Promise<McpServerCapabilities[]> {
    const out: McpServerCapabilities[] = [];
    const settled = await Promise.allSettled(
      Array.from(this.connections.values())
        .filter((c) => c.config.enabled)
        .map((c) => this.getCapabilities(c.config.id)),
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) out.push(r.value);
    }
    return out;
  }

  /**
   * Call a tool. Names are unqualified ("github_create_issue"), the manager
   * looks up the owning server. Errors are returned as a structured result
   * so a misbehaving external server can't kill the orchestrator loop.
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, any>,
  ): Promise<{ ok: true; content: any[] } | { ok: false; error: string }> {
    const conn = this.connections.get(serverId);
    if (!conn) return { ok: false, error: `MCP server "${serverId}" is not registered` };
    if (!conn.config.enabled) return { ok: false, error: `MCP server "${conn.config.name}" is disabled` };
    try {
      await this.ensureConnected(conn);
      const client = conn.client!;
      const result = await Promise.race([
        client.callTool({ name: toolName, arguments: args }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`MCP call timed out after ${CALL_TIMEOUT_MS}ms`)),
            CALL_TIMEOUT_MS,
          ),
        ),
      ]);
      // MCP's tool result has `content: Array<{type, text|image|...}>`
      const content = Array.isArray((result as any)?.content) ? (result as any).content : [];
      return { ok: true, content };
    } catch (err) {
      const message = (err as Error).message || 'unknown error';
      logger.warn(`[mcp:${conn.config.name}] callTool(${toolName}) failed: ${message}`);
      conn.health = {
        serverId: conn.config.id,
        status: 'error',
        lastError: message,
        lastConnectedAt: conn.health.lastConnectedAt,
      };
      // Drop the connection so the next call reconnects cleanly.
      void this.disconnect(conn.config.id).catch(() => undefined);
      return { ok: false, error: message };
    }
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async ensureConnected(conn: Connection): Promise<void> {
    if (conn.client) return;
    if (conn.connectingPromise) return conn.connectingPromise;
    conn.connectingPromise = (async () => {
      conn.health = { ...conn.health, status: 'connecting' };
      try {
        const client = new Client(NAAVIK_CLIENT_INFO, { capabilities: {} });
        const transport = await this.buildTransport(conn.config);
        await Promise.race([
          client.connect(transport),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`connect timeout after ${CONNECT_TIMEOUT_MS}ms`)),
              CONNECT_TIMEOUT_MS,
            ),
          ),
        ]);
        conn.client = client;
        conn.health = {
          serverId: conn.config.id,
          status: 'connected',
          lastConnectedAt: new Date().toISOString(),
        };
        logger.info(`[mcp:${conn.config.name}] connected (${conn.config.transport})`);
      } catch (err) {
        const message = (err as Error).message || 'connect failed';
        conn.health = {
          serverId: conn.config.id,
          status: 'error',
          lastError: message,
          lastConnectedAt: conn.health.lastConnectedAt,
        };
        throw err;
      } finally {
        conn.connectingPromise = null;
      }
    })();
    return conn.connectingPromise;
  }

  private async buildTransport(cfg: McpServerConfig): Promise<any> {
    if (cfg.transport === 'stdio') {
      if (!cfg.command) throw new Error('stdio MCP server is missing `command`');
      const env: Record<string, string> = { ...(cfg.envOverrides ?? {}) };
      if (cfg.secretRef) {
        const provider = await getSecretProvider();
        const token = await provider.get(cfg.secretRef);
        if (token) env.MCP_TOKEN = token;
      }
      return new StdioClientTransport({
        command: cfg.command,
        args: cfg.args ?? [],
        env: { ...process.env, ...env } as Record<string, string>,
      });
    }
    if (cfg.transport === 'streamable_http' || cfg.transport === 'sse') {
      if (!cfg.url) throw new Error('HTTP MCP server is missing `url`');
      const headers: Record<string, string> = { ...(cfg.headers ?? {}) };
      if (cfg.secretRef) {
        const provider = await getSecretProvider();
        const token = await provider.get(cfg.secretRef);
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      const opts = { requestInit: { headers } };
      const TransportCtor: any =
        cfg.transport === 'streamable_http'
          ? StreamableHTTPClientTransport
          : SSEClientTransport;
      return new TransportCtor(new URL(cfg.url), opts);
    }
    throw new Error(`Unknown transport "${cfg.transport}"`);
  }

  private async discoverCapabilities(conn: Connection): Promise<McpServerCapabilities> {
    const client = conn.client!;
    const [tools, resources, prompts] = await Promise.all([
      client.listTools().catch(() => ({ tools: [] })),
      client.listResources().catch(() => ({ resources: [] })),
      client.listPrompts().catch(() => ({ prompts: [] })),
    ]);
    return {
      serverId: conn.config.id,
      serverName: conn.config.name,
      tools: (tools.tools ?? []).map((t: any) => ({
        name: t.name,
        qualifiedName: qualifiedToolName(conn.config.name, t.name),
        description: t.description,
        inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      })),
      resources: (resources.resources ?? []).map((r: any) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
      prompts: (prompts.prompts ?? []).map((p: any) => ({
        name: p.name,
        description: p.description,
      })),
      fetchedAt: new Date().toISOString(),
    };
  }
}

// Naming convention shared with Claude Code / Cursor / Continue: namespaces
// don't collide and tool provenance is obvious in logs and the trace ribbon.
export function qualifiedToolName(serverName: string, toolName: string): string {
  const safe = serverName.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return `mcp__${safe}__${toolName}`;
}

export function parseQualifiedToolName(qualified: string): { serverName: string; toolName: string } | null {
  const m = qualified.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (!m) return null;
  return { serverName: m[1], toolName: m[2] };
}

export const mcpClientManager = new McpClientManager();
