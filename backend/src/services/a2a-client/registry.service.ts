/**
 * A2A agent registry — Postgres-backed CRUD over `a2a_agents`.
 *
 * Holds the persisted config plus a 10-min cached Agent Card discovered via
 * the agent-fetcher. Skill discovery lives here too because every skill
 * surface in the V3 orchestrator is "(card.skills[]) filtered to enabled".
 */
import { randomUUID } from 'node:crypto';
import { pool } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { getSecretProvider } from '../secrets/index.js';
import { discoverAgentCard } from './agent-fetcher.js';
import type { A2AAgentConfig, A2AHealth, AgentCard } from './types.js';

const COLUMNS = `
  id, name, description, url, auth_method, secret_ref,
  expose_to_streams, enabled, created_at, updated_at
`;
const CARD_TTL_MS = 10 * 60 * 1000;

function rowToConfig(r: any): A2AAgentConfig {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    url: r.url,
    authMethod: r.auth_method as A2AAgentConfig['authMethod'],
    secretRef: r.secret_ref ?? null,
    exposeToStreams: r.expose_to_streams ?? undefined,
    enabled: !!r.enabled,
    createdAt: r.created_at?.toISOString?.() ?? String(r.created_at),
    updatedAt: r.updated_at?.toISOString?.() ?? String(r.updated_at),
  };
}

interface CachedCard { card: AgentCard; fetchedAt: number; }

class A2ARegistryService {
  private initialized = false;
  private cards = new Map<string, CachedCard>();
  private health = new Map<string, A2AHealth>();

  async init(): Promise<void> {
    if (this.initialized) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS a2a_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        url TEXT NOT NULL,
        auth_method TEXT NOT NULL CHECK (auth_method IN ('none','bearer','oauth2_client_credentials')),
        secret_ref TEXT,
        expose_to_streams JSONB,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    this.initialized = true;
    logger.info('[a2a-registry] table ready');
  }

  async list(): Promise<A2AAgentConfig[]> {
    await this.init();
    const r = await pool.query(`SELECT ${COLUMNS} FROM a2a_agents ORDER BY name`);
    return r.rows.map(rowToConfig);
  }

  async get(id: string): Promise<A2AAgentConfig | null> {
    await this.init();
    const r = await pool.query(`SELECT ${COLUMNS} FROM a2a_agents WHERE id = $1`, [id]);
    if (!r.rowCount) return null;
    return rowToConfig(r.rows[0]);
  }

  async create(payload: Partial<A2AAgentConfig> & {
    name: string; url: string; authMethod: A2AAgentConfig['authMethod']; secretValue?: string;
  }): Promise<A2AAgentConfig> {
    await this.init();
    const id = randomUUID();
    let secretRef = payload.secretRef ?? null;
    if (payload.secretValue) {
      secretRef = `a2a:${id}`;
      const provider = await getSecretProvider();
      await provider.put(secretRef, payload.secretValue);
    }
    const r = await pool.query(
      `INSERT INTO a2a_agents (
        id, name, description, url, auth_method, secret_ref, expose_to_streams, enabled
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
      RETURNING ${COLUMNS}`,
      [
        id, payload.name, payload.description ?? null, payload.url,
        payload.authMethod, secretRef,
        JSON.stringify(payload.exposeToStreams ?? null),
        payload.enabled ?? true,
      ],
    );
    return rowToConfig(r.rows[0]);
  }

  async update(id: string, patch: Partial<A2AAgentConfig> & { secretValue?: string }): Promise<A2AAgentConfig | null> {
    await this.init();
    const existing = await this.get(id);
    if (!existing) return null;

    let secretRef = patch.secretRef === undefined ? existing.secretRef : patch.secretRef;
    if (patch.secretValue) {
      secretRef = secretRef ?? `a2a:${id}`;
      const provider = await getSecretProvider();
      await provider.put(secretRef, patch.secretValue);
    }
    const next = { ...existing, ...patch, secretRef };
    const r = await pool.query(
      `UPDATE a2a_agents SET
         name=$2, description=$3, url=$4, auth_method=$5,
         secret_ref=$6, expose_to_streams=$7::jsonb, enabled=$8, updated_at=NOW()
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [
        id, next.name, next.description ?? null, next.url, next.authMethod,
        secretRef, JSON.stringify(next.exposeToStreams ?? null), next.enabled,
      ],
    );
    if (!r.rowCount) return null;
    this.cards.delete(id);    // force re-discovery on next access
    return rowToConfig(r.rows[0]);
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
        logger.warn(`[a2a-registry] secret cleanup failed for ${existing.secretRef}: ${(err as Error).message}`);
      }
    }
    this.cards.delete(id);
    this.health.delete(id);
    const r = await pool.query('DELETE FROM a2a_agents WHERE id = $1', [id]);
    return (r.rowCount ?? 0) > 0;
  }

  async getCard(cfg: A2AAgentConfig, force = false): Promise<AgentCard | null> {
    const cached = this.cards.get(cfg.id);
    if (cached && !force && Date.now() - cached.fetchedAt < CARD_TTL_MS) return cached.card;
    try {
      this.health.set(cfg.id, { agentId: cfg.id, status: 'connecting' });
      const card = await discoverAgentCard(cfg);
      this.cards.set(cfg.id, { card, fetchedAt: Date.now() });
      this.health.set(cfg.id, {
        agentId: cfg.id,
        status: 'connected',
        lastDiscoveredAt: new Date().toISOString(),
        card,
      });
      return card;
    } catch (err) {
      this.health.set(cfg.id, {
        agentId: cfg.id,
        status: 'error',
        lastError: (err as Error).message,
      });
      logger.warn(`[a2a:${cfg.name}] discovery failed: ${(err as Error).message}`);
      return null;
    }
  }

  listHealth(): A2AHealth[] {
    return Array.from(this.health.values()).map((h) => ({ ...h }));
  }

  healthOf(id: string): A2AHealth | null {
    const h = this.health.get(id);
    return h ? { ...h } : null;
  }
}

export const a2aRegistry = new A2ARegistryService();
