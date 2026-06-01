/**
 * MCP client types — shared between the registry, the runtime client
 * manager, and the orchestrator bridge.
 *
 * An MCP server entry is everything we need to (re-)spawn a connection:
 *   - transport choice (stdio or HTTP+SSE)
 *   - per-transport parameters
 *   - a reference to the secret store for tokens / API keys
 *   - feature flags (enabled, expose to which streams, etc.)
 *
 * Discovered capabilities (tools / resources / prompts) live in a separate
 * struct populated AFTER the connection has been established. They are
 * cached for ~10 min and refreshed lazily.
 */

export type McpTransport = 'stdio' | 'streamable_http' | 'sse';

/**
 * Stable record persisted in `mcp_servers`. Secrets are never stored here —
 * the `secretRef` points at the SecretProvider entry.
 */
export interface McpServerConfig {
  id: string;                 // uuid
  name: string;               // user-friendly short alias, e.g. "github", "filesystem"
  description?: string;       // optional engineer-facing blurb
  transport: McpTransport;

  /** Stdio params — only meaningful when transport === 'stdio'. */
  command?: string;            // e.g. "npx"
  args?: string[];             // e.g. ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me"]
  /** Extra env vars to inject into the child process. */
  envOverrides?: Record<string, string>;

  /** HTTP/SSE params — only meaningful when transport !== 'stdio'. */
  url?: string;                // e.g. "https://example.com/mcp"
  headers?: Record<string, string>;

  /** Reference into SecretProvider for an auth token. The token is injected
   * into env (`MCP_TOKEN`) for stdio or into the `Authorization` header for
   * HTTP. Set null when no auth is needed. */
  secretRef?: string | null;

  /** Streams the tools from this server should be advertised to. Empty list
   * means "all streams". Used for per-stream curation to avoid 100+ tool
   * advertisement bloat. */
  exposeToStreams?: string[];

  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Capability snapshot — populated after `listTools` / `listResources` / `listPrompts`.
 */
export interface McpServerCapabilities {
  serverId: string;
  serverName: string;
  tools: Array<{
    name: string;             // original MCP name
    qualifiedName: string;    // `mcp__<serverName>__<name>` — what the orchestrator sees
    description?: string;
    inputSchema: Record<string, any>;
  }>;
  resources: Array<{
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
  }>;
  prompts: Array<{
    name: string;
    description?: string;
  }>;
  fetchedAt: string;
}

export interface McpHealth {
  serverId: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastConnectedAt?: string;
  lastError?: string;
}
