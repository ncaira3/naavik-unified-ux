/**
 * Settings → Integrations tab.
 *
 * Lets admins wire Naavik into:
 *   - external MCP servers (filesystem, github, slack, etc.) — Naavik picks up
 *     their tools and surfaces them in the chat alongside native tools.
 *   - external A2A agents — Naavik can delegate work to them via skills.
 *
 * Secrets are write-only on the wire (we never read them back). The active
 * secret provider (Postgres / GCP / Azure) is shown for ops visibility.
 */
import { useEffect, useState } from 'react';
import {
  Plus,
  RefreshCw,
  Trash2,
  Plug,
  ShieldCheck,
  CircleDot,
  AlertTriangle,
  Loader2,
  X,
  Sparkles,
  Database,
  Cloud,
} from 'lucide-react';
import api from '../../services/api';

// ─── Types ────────────────────────────────────────────────────────────────

type McpTransport = 'stdio' | 'streamable_http' | 'sse';

interface McpServerConfig {
  id: string;
  name: string;
  description?: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  envOverrides?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  secretRef?: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface McpHealth {
  serverId: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastConnectedAt?: string;
  lastError?: string;
}

interface McpCapabilities {
  serverId: string;
  serverName: string;
  tools: Array<{ name: string; qualifiedName: string; description?: string }>;
  resources: Array<{ uri: string; name: string }>;
  prompts: Array<{ name: string }>;
}

interface A2AAgentConfig {
  id: string;
  name: string;
  description?: string;
  url: string;
  authMethod: 'none' | 'bearer' | 'oauth2_client_credentials';
  secretRef?: string | null;
  enabled: boolean;
}

interface A2AHealth {
  agentId: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastDiscoveredAt?: string;
  lastError?: string;
  card?: { name: string; skills: Array<{ id: string; name: string; description?: string }> };
}

// ─── Section: MCP servers ─────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string; Icon: any }> = {
    connected:    { color: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/30',  label: 'Connected',     Icon: CircleDot },
    connecting:   { color: 'text-indigo-700 bg-indigo-500/10 border-indigo-500/30',     label: 'Connecting…',   Icon: Loader2 },
    disconnected: { color: 'text-slate-700 bg-slate-500/10 border-slate-500/30',        label: 'Disconnected',  Icon: CircleDot },
    error:        { color: 'text-rose-700 bg-rose-500/10 border-rose-500/30',           label: 'Error',         Icon: AlertTriangle },
  };
  const m = map[status] ?? map.disconnected;
  const Icon = m.Icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${m.color}`}>
      <Icon className={`h-3 w-3 ${status === 'connecting' ? 'animate-spin' : ''}`} strokeWidth={2} />
      {m.label}
    </span>
  );
}

function McpSection() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [health, setHealth] = useState<Record<string, McpHealth>>({});
  const [capabilities, setCapabilities] = useState<Record<string, McpCapabilities | null>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const [list, h] = await Promise.all([
        api.get<{ success: boolean; data: McpServerConfig[] }>('/integrations/mcp'),
        api.get<{ success: boolean; data: McpHealth[] }>('/integrations/mcp/health'),
      ]);
      setServers(list?.data ?? []);
      const healthMap: Record<string, McpHealth> = {};
      for (const item of h?.data ?? []) healthMap[item.serverId] = item;
      setHealth(healthMap);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, []);

  const loadCapabilities = async (id: string) => {
    setCapabilities((p) => ({ ...p, [id]: null }));
    try {
      const r = await api.get<{ success: boolean; data: McpCapabilities }>(`/integrations/mcp/${id}/capabilities`);
      setCapabilities((p) => ({ ...p, [id]: r?.data }));
      void reload();
    } catch (err) {
      console.error('[mcp] capability fetch failed', err);
      setCapabilities((p) => ({ ...p, [id]: null }));
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      if (prev === id) return null;
      if (!capabilities[id]) void loadCapabilities(id);
      return id;
    });
  };

  const deleteServer = async (id: string) => {
    if (!confirm('Remove this MCP server?')) return;
    await api.delete(`/integrations/mcp/${id}`);
    void reload();
  };

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-text-primary">MCP servers</h3>
          <p className="text-[12px] text-text-muted">
            External tool surfaces Naavik can pull from — they appear inline in the chat alongside native tools.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-md border border-border bg-cream-surface p-2 text-text-secondary hover:border-indigo-500 hover:text-text-primary dark:border-pulse-border dark:bg-pulse-surface"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-500 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-600"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
            Add MCP server
          </button>
        </div>
      </header>

      <div className="space-y-2">
        {loading && servers.length === 0 ? (
          <p className="rounded-md border border-border bg-cream-bg px-3 py-2 text-[12px] text-text-muted dark:border-pulse-border dark:bg-pulse-surface">
            Loading…
          </p>
        ) : servers.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] text-text-muted dark:border-pulse-border">
            No MCP servers configured yet. Add one to expose external tools to the chat.
          </p>
        ) : (
          servers.map((s) => {
            const h = health[s.id];
            const caps = capabilities[s.id];
            const isExpanded = expanded === s.id;
            return (
              <div
                key={s.id}
                className="rounded-lg border border-border bg-cream-bg dark:border-pulse-border dark:bg-pulse-surface"
              >
                <button
                  type="button"
                  onClick={() => toggleExpand(s.id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Plug className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-300" strokeWidth={2} />
                      <span className="text-[13px] font-semibold text-text-primary">{s.name}</span>
                      <span className="rounded bg-cream-surface px-1.5 py-0.5 font-mono text-[10px] text-text-muted dark:bg-pulse-bg">
                        {s.transport}
                      </span>
                      {!s.enabled && (
                        <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold text-text-muted">
                          DISABLED
                        </span>
                      )}
                      <StatusBadge status={h?.status ?? 'disconnected'} />
                    </div>
                    {s.description ? (
                      <p className="mt-0.5 text-[11.5px] text-text-secondary">{s.description}</p>
                    ) : null}
                    {h?.status === 'error' && h.lastError ? (
                      <p className="mt-0.5 text-[11px] text-rose-600 dark:text-rose-300">{h.lastError}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void deleteServer(s.id); }}
                    className="rounded p-1 text-text-muted hover:bg-rose-500/10 hover:text-rose-600"
                    title="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </button>
                {isExpanded ? (
                  <div className="border-t border-border bg-cream-surface px-3 py-3 dark:border-pulse-border dark:bg-pulse-bg">
                    {caps === undefined || caps === null ? (
                      <p className="text-[11.5px] text-text-muted">
                        <Loader2 className="mr-1 inline h-3 w-3 animate-spin" strokeWidth={2} />
                        Discovering tools…
                      </p>
                    ) : (
                      <>
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                          Tools advertised ({caps.tools.length})
                        </p>
                        <ul className="mt-1.5 space-y-1">
                          {caps.tools.slice(0, 30).map((t) => (
                            <li key={t.qualifiedName} className="text-[11.5px]">
                              <code className="font-mono text-text-primary">{t.qualifiedName}</code>
                              {t.description ? <span className="text-text-secondary"> — {t.description}</span> : null}
                            </li>
                          ))}
                          {caps.tools.length > 30 ? (
                            <li className="text-[11px] text-text-muted">… and {caps.tools.length - 30} more</li>
                          ) : null}
                        </ul>
                        {caps.resources.length > 0 ? (
                          <p className="mt-2 text-[11px] text-text-muted">
                            Resources: {caps.resources.length} · Prompts: {caps.prompts.length}
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {showAdd ? (
        <AddMcpDialog onCancel={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); void reload(); }} />
      ) : null}
    </section>
  );
}

function AddMcpDialog({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [transport, setTransport] = useState<McpTransport>('stdio');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [envText, setEnvText] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const args = argsText.trim() ? argsText.split(/\s+/) : undefined;
      const envOverrides = envText.trim()
        ? Object.fromEntries(
            envText.split(/\n/).map((line) => line.trim()).filter(Boolean)
              .map((line) => {
                const eq = line.indexOf('=');
                return eq < 0 ? [line, ''] : [line.slice(0, eq), line.slice(eq + 1)];
              }),
          )
        : undefined;
      await api.post('/integrations/mcp', {
        name: name.trim(),
        description: description.trim() || undefined,
        transport,
        ...(transport === 'stdio'
          ? { command: command.trim(), args, envOverrides }
          : { url: url.trim() }),
        secretValue: secret.trim() || undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-border bg-cream-bg p-4 shadow-2xl dark:border-pulse-border dark:bg-pulse-surface">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-[14px] font-semibold text-text-primary">Add MCP server</h4>
          <button type="button" onClick={onCancel} className="text-text-muted hover:text-text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2.5">
          <Field label="Name" hint="Short alias used for namespacing (`mcp__name__tool`)">
            <input value={name} onChange={(e) => setName(e.target.value)} className="naavik-input" placeholder="filesystem" />
          </Field>
          <Field label="Description (optional)">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="naavik-input" placeholder="Engineer-facing blurb" />
          </Field>
          <Field label="Transport">
            <div className="flex gap-2">
              {(['stdio', 'streamable_http', 'sse'] as McpTransport[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTransport(t)}
                  className={`rounded border px-2 py-1 text-[11px] ${
                    transport === t
                      ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:border-indigo-400 dark:text-indigo-200'
                      : 'border-border text-text-secondary'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </Field>
          {transport === 'stdio' ? (
            <>
              <Field label="Command" hint='e.g. "npx"'>
                <input value={command} onChange={(e) => setCommand(e.target.value)} className="naavik-input" placeholder="npx" />
              </Field>
              <Field label="Args (space-separated)" hint='e.g. "-y @modelcontextprotocol/server-filesystem /Users/me"'>
                <input value={argsText} onChange={(e) => setArgsText(e.target.value)} className="naavik-input" />
              </Field>
              <Field label="Env overrides (KEY=VALUE per line)">
                <textarea value={envText} onChange={(e) => setEnvText(e.target.value)} className="naavik-input" rows={2} />
              </Field>
            </>
          ) : (
            <Field label="URL">
              <input value={url} onChange={(e) => setUrl(e.target.value)} className="naavik-input" placeholder="https://example.com/mcp" />
            </Field>
          )}
          <Field label="Auth secret (token, write-only)">
            <input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              type="password"
              className="naavik-input"
              placeholder="Leave blank if no auth needed"
            />
          </Field>
        </div>
        {error ? <p className="mt-2 text-[11.5px] text-rose-600">{error}</p> : null}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded px-2.5 py-1 text-[12px] text-text-muted">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-1 rounded bg-indigo-500 px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Section: A2A agents ──────────────────────────────────────────────────

function A2ASection() {
  const [agents, setAgents] = useState<A2AAgentConfig[]>([]);
  const [health, setHealth] = useState<Record<string, A2AHealth>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const [list, h] = await Promise.all([
        api.get<{ success: boolean; data: A2AAgentConfig[] }>('/integrations/a2a'),
        api.get<{ success: boolean; data: A2AHealth[] }>('/integrations/a2a/health'),
      ]);
      setAgents(list?.data ?? []);
      const healthMap: Record<string, A2AHealth> = {};
      for (const item of h?.data ?? []) healthMap[item.agentId] = item;
      setHealth(healthMap);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, []);

  const refreshCard = async (id: string) => {
    try {
      const r = await api.get<{ success: boolean; data: { card: any; health: A2AHealth } }>(`/integrations/a2a/${id}/card`);
      setHealth((prev) => ({ ...prev, [id]: r?.data?.health ?? prev[id] }));
    } catch (err) {
      console.error('[a2a] card refresh failed', err);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => (prev === id ? null : id));
    void refreshCard(id);
  };

  const deleteAgent = async (id: string) => {
    if (!confirm('Remove this A2A agent?')) return;
    await api.delete(`/integrations/a2a/${id}`);
    void reload();
  };

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-text-primary">A2A agents</h3>
          <p className="text-[12px] text-text-muted">
            External agents Naavik can delegate tasks to. Discovered via Agent Card at <code className="font-mono">/.well-known/agent.json</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-md border border-border bg-cream-surface p-2 text-text-secondary hover:border-indigo-500 hover:text-text-primary dark:border-pulse-border dark:bg-pulse-surface"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-500 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-600"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
            Add A2A agent
          </button>
        </div>
      </header>

      <div className="space-y-2">
        {loading && agents.length === 0 ? (
          <p className="rounded-md border border-border bg-cream-bg px-3 py-2 text-[12px] text-text-muted dark:border-pulse-border dark:bg-pulse-surface">
            Loading…
          </p>
        ) : agents.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] text-text-muted dark:border-pulse-border">
            No A2A agents configured. Add one to let Naavik delegate workflows to peer agents.
          </p>
        ) : (
          agents.map((a) => {
            const h = health[a.id];
            const isExpanded = expanded === a.id;
            return (
              <div key={a.id} className="rounded-lg border border-border bg-cream-bg dark:border-pulse-border dark:bg-pulse-surface">
                <button
                  type="button"
                  onClick={() => toggleExpand(a.id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-300" strokeWidth={2} />
                      <span className="text-[13px] font-semibold text-text-primary">{a.name}</span>
                      <span className="font-mono text-[10.5px] text-text-muted truncate max-w-[28ch]">{a.url}</span>
                      <StatusBadge status={h?.status ?? 'disconnected'} />
                    </div>
                    {a.description ? (
                      <p className="mt-0.5 text-[11.5px] text-text-secondary">{a.description}</p>
                    ) : null}
                    {h?.status === 'error' && h.lastError ? (
                      <p className="mt-0.5 text-[11px] text-rose-600 dark:text-rose-300">{h.lastError}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void deleteAgent(a.id); }}
                    className="rounded p-1 text-text-muted hover:bg-rose-500/10 hover:text-rose-600"
                    title="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </button>
                {isExpanded && h?.card ? (
                  <div className="border-t border-border bg-cream-surface px-3 py-3 dark:border-pulse-border dark:bg-pulse-bg">
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                      Skills ({h.card.skills.length})
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {h.card.skills.map((s) => (
                        <li key={s.id} className="text-[11.5px]">
                          <code className="font-mono text-text-primary">a2a__{a.name}__{s.id}</code>
                          {s.description ? <span className="text-text-secondary"> — {s.description}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {showAdd ? (
        <AddA2ADialog onCancel={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); void reload(); }} />
      ) : null}
    </section>
  );
}

function AddA2ADialog({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [authMethod, setAuthMethod] = useState<A2AAgentConfig['authMethod']>('none');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.post('/integrations/a2a', {
        name: name.trim(),
        description: description.trim() || undefined,
        url: url.trim(),
        authMethod,
        secretValue: authMethod !== 'none' ? secret.trim() : undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-border bg-cream-bg p-4 shadow-2xl dark:border-pulse-border dark:bg-pulse-surface">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-[14px] font-semibold text-text-primary">Add A2A agent</h4>
          <button type="button" onClick={onCancel} className="text-text-muted hover:text-text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2.5">
          <Field label="Name" hint="Short alias used for namespacing (`a2a__name__skill`)">
            <input value={name} onChange={(e) => setName(e.target.value)} className="naavik-input" placeholder="appgen" />
          </Field>
          <Field label="Base URL" hint="Naavik will fetch /.well-known/agent.json from here">
            <input value={url} onChange={(e) => setUrl(e.target.value)} className="naavik-input" placeholder="https://agent.example.com" />
          </Field>
          <Field label="Description (optional)">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="naavik-input" />
          </Field>
          <Field label="Auth method">
            <div className="flex gap-2">
              {(['none', 'bearer', 'oauth2_client_credentials'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setAuthMethod(m)}
                  className={`rounded border px-2 py-1 text-[11px] ${
                    authMethod === m
                      ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:border-indigo-400 dark:text-indigo-200'
                      : 'border-border text-text-secondary'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </Field>
          {authMethod !== 'none' ? (
            <Field label="Auth token (write-only)">
              <input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" className="naavik-input" />
            </Field>
          ) : null}
        </div>
        {error ? <p className="mt-2 text-[11.5px] text-rose-600">{error}</p> : null}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded px-2.5 py-1 text-[12px] text-text-muted">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !name.trim() || !url.trim()}
            className="inline-flex items-center gap-1 rounded bg-indigo-500 px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Provider info strip ──────────────────────────────────────────────────

function ProviderStrip() {
  const [kind, setKind] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ success: boolean; data: { kind: string } }>('/integrations/secrets/provider')
      .then((r) => setKind(r?.data?.kind ?? null))
      .catch(() => setKind(null));
  }, []);
  const meta: Record<string, { label: string; Icon: any; tint: string }> = {
    postgres: { label: 'Postgres (encrypted)', Icon: Database, tint: 'text-emerald-700 dark:text-emerald-300' },
    gcp:      { label: 'Google Secret Manager', Icon: Cloud,    tint: 'text-sky-700 dark:text-sky-300' },
    azure:    { label: 'Azure Key Vault',       Icon: Cloud,    tint: 'text-blue-700 dark:text-blue-300' },
  };
  const m = meta[kind ?? ''] ?? { label: 'Unknown', Icon: ShieldCheck, tint: 'text-text-muted' };
  const Icon = m.Icon;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-cream-surface px-3 py-2 dark:border-pulse-border dark:bg-pulse-bg">
      <Icon className={`h-4 w-4 ${m.tint}`} strokeWidth={1.8} />
      <span className="text-[12px] text-text-secondary">
        Secrets stored in <span className="font-semibold text-text-primary">{m.label}</span> · selected via <code className="font-mono">SECRET_PROVIDER</code> env var
      </span>
    </div>
  );
}

// ─── Field helper + global styles ─────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">{label}</div>
      {children}
      {hint ? <p className="mt-0.5 text-[10.5px] text-text-muted">{hint}</p> : null}
    </label>
  );
}

// ─── Default export ───────────────────────────────────────────────────────

export default function IntegrationsTab() {
  return (
    <div className="space-y-6">
      <style>{`.naavik-input {
        width: 100%; border-radius: 6px; border: 1px solid var(--border);
        background: transparent; padding: 0.4rem 0.6rem; font-size: 12px;
        color: var(--text-primary); outline: none;
      } .naavik-input:focus { border-color: rgba(99,102,241,0.6); }`}</style>
      <ProviderStrip />
      <McpSection />
      <A2ASection />
    </div>
  );
}
