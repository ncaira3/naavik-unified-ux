/**
 * MCP server registry — Postgres-backed CRUD for `mcp_servers` rows.
 *
 * Bootstrap behaviour:
 *   - Table is created if it doesn't exist on first call to init().
 *   - If `NAAVIK_MCP_BOOTSTRAP_PATH` env is set, the JSON file at that path is
 *     loaded and any servers not already in the table are inserted. This
 *     lets ops teams ship a default set of servers (filesystem + memory etc.)
 *     for first-boot demos without touching the UI.
 */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pool } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { getSecretProvider } from '../secrets/index.js';
import { mcpClientManager } from './client-manager.js';
import type { McpServerConfig, McpTransport } from './types.js';

const COLUMNS = `
  id, name, description, transport, command, args, env_overrides, url, headers,
  secret_ref, expose_to_streams, enabled, created_at, updated_at
`;

function rowToConfig(r: any): McpServerConfig {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    transport: r.transport as McpTransport,
    command: r.command ?? undefined,
    args: r.args ?? undefined,
    envOverrides: r.env_overrides ?? undefined,
    url: r.url ?? undefined,
    headers: r.headers ?? undefined,
    secretRef: r.secret_ref ?? null,
    exposeToStreams: r.expose_to_streams ?? undefined,
    enabled: !!r.enabled,
    createdAt: r.created_at?.toISOString?.() ?? String(r.created_at),
    updatedAt: r.updated_at?.toISOString?.() ?? String(r.updated_at),
  };
}

class McpRegistryService {
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        transport TEXT NOT NULL CHECK (transport IN ('stdio', 'streamable_http', 'sse')),
        command TEXT,
        args JSONB,
        env_overrides JSONB,
        url TEXT,
        headers JSONB,
        secret_ref TEXT,
        expose_to_streams JSONB,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    this.initialized = true;
    logger.info('[mcp-registry] table ready');

    // Hydrate the runtime manager with the persisted set.
    const all = await this.list();
    for (const cfg of all) mcpClientManager.register(cfg);

    // Optional bootstrap from JSON file (for first-boot demos).
    const bootstrapPath = (process.env.NAAVIK_MCP_BOOTSTRAP_PATH || '').trim();
    if (bootstrapPath) await this.bootstrapFromFile(bootstrapPath);
  }

  async list(): Promise<McpServerConfig[]> {
    await this.init();
    const r = await pool.query(`SELECT ${COLUMNS} FROM mcp_servers ORDER BY name`);
    return r.rows.map(rowToConfig);
  }

  async get(id: string): Promise<McpServerConfig | null> {
    await this.init();
    const r = await pool.query(`SELECT ${COLUMNS} FROM mcp_servers WHERE id = $1`, [id]);
    if (!r.rowCount) return null;
    return rowToConfig(r.rows[0]);
  }

  /** Add a new server. Optionally accepts an inline secret to store at `secretRef`. */
  async create(payload: Partial<McpServerConfig> & { name: string; transport: McpTransport; secretValue?: string }): Promise<McpServerConfig> {
    await this.init();
    const id = randomUUID();
    let secretRef = payload.secretRef ?? null;
    if (payload.secretValue) {
      secretRef = `mcp:${id}`;
      const provider = await getSecretProvider();
      await provider.put(secretRef, payload.secretValue);
    }
    const r = await pool.query(
      `INSERT INTO mcp_servers (
        id, name, description, transport, command, args, env_overrides, url, headers,
        secret_ref, expose_to_streams, enabled
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb,$10,$11::jsonb,$12)
      RETURNING ${COLUMNS}`,
      [
        id,
        payload.name,
        payload.description ?? null,
        payload.transport,
        payload.command ?? null,
        JSON.stringify(payload.args ?? null),
        JSON.stringify(payload.envOverrides ?? null),
        payload.url ?? null,
        JSON.stringify(payload.headers ?? null),
        secretRef,
        JSON.stringify(payload.exposeToStreams ?? null),
        payload.enabled ?? true,
      ],
    );
    const config = rowToConfig(r.rows[0]);
    mcpClientManager.register(config);
    return config;
  }

  /** Update an existing server. Pass only the fields you want to change. */
  async update(id: string, patch: Partial<McpServerConfig> & { secretValue?: string }): Promise<McpServerConfig | null> {
    await this.init();
    const existing = await this.get(id);
    if (!existing) return null;

    let secretRef = patch.secretRef === undefined ? existing.secretRef : patch.secretRef;
    if (patch.secretValue) {
      secretRef = secretRef ?? `mcp:${id}`;
      const provider = await getSecretProvider();
      await provider.put(secretRef, patch.secretValue);
    }

    const next = { ...existing, ...patch, secretRef, id };
    const r = await pool.query(
      `UPDATE mcp_servers SET
         name = $2, description = $3, transport = $4, command = $5,
         args = $6::jsonb, env_overrides = $7::jsonb, url = $8,
         headers = $9::jsonb, secret_ref = $10, expose_to_streams = $11::jsonb,
         enabled = $12, updated_at = NOW()
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [
        id,
        next.name,
        next.description ?? null,
        next.transport,
        next.command ?? null,
        JSON.stringify(next.args ?? null),
        JSON.stringify(next.envOverrides ?? null),
        next.url ?? null,
        JSON.stringify(next.headers ?? null),
        secretRef,
        JSON.stringify(next.exposeToStreams ?? null),
        next.enabled,
      ],
    );
    if (!r.rowCount) return null;
    const config = rowToConfig(r.rows[0]);
    mcpClientManager.register(config);   // re-register (manager handles diffs / reconnect)
    return config;
  }

  async delete(id: string): Promise<boolean> {
    await this.init();
    const existing = await this.get(id);
    if (!existing) return false;
    if (existing.secretRef) {
      try {
        const provider = await getSecretProvider();
        await provider.delete(existing.secretRef);
      } catch (err) {
        logger.warn(`[mcp-registry] secret cleanup failed for ${existing.secretRef}: ${(err as Error).message}`);
      }
    }
    await mcpClientManager.unregister(id);
    const r = await pool.query('DELETE FROM mcp_servers WHERE id = $1', [id]);
    return (r.rowCount ?? 0) > 0;
  }

  private async bootstrapFromFile(path: string): Promise<void> {
    try {
      const raw = await readFile(path, 'utf-8');
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (!item?.name || !item?.transport) continue;
        const existing = await pool.query('SELECT id FROM mcp_servers WHERE name = $1', [item.name]);
        if (existing.rowCount) continue;
        await this.create({
          name: item.name,
          transport: item.transport,
          command: item.command,
          args: item.args,
          envOverrides: item.envOverrides,
          url: item.url,
          headers: item.headers,
          description: item.description,
          enabled: item.enabled !== false,
        });
        logger.info(`[mcp-registry] bootstrapped "${item.name}" from ${path}`);
      }
    } catch (err) {
      logger.warn(`[mcp-registry] bootstrap from ${path} failed: ${(err as Error).message}`);
    }
  }
}

export const mcpRegistry = new McpRegistryService();
