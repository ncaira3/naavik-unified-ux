import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

export type AppContainerType = 'internal' | 'federated' | 'iframe';
export type ChatStream = 'universal' | 'knowledge' | 'appgen' | 'observability' | 'provision';

export interface AppRegistryEntry {
  id: string;
  displayName: string;
  iconName: string;
  order: number;
  containerType: AppContainerType;
  internalKey?: string;
  remoteUrl?: string;
  remoteName?: string;
  exposedModule?: string;
  iframeUrl?: string;
  iframeSandbox?: string;
  chatStream?: ChatStream;
  navAliases?: string[];
  navSemanticPatterns?: string[];
  requiresRole?: 'admin' | 'user';
  isActive: boolean;
}

const DEFAULT_REGISTRY: AppRegistryEntry[] = [
  {
    id: 'home',
    displayName: 'Home',
    iconName: 'Home',
    order: 0,
    containerType: 'internal',
    internalKey: 'home',
    chatStream: 'universal',
    navAliases: ['home', 'dashboard', 'main'],
    navSemanticPatterns: ['go home', 'home view', 'main dashboard'],
    requiresRole: 'user',
    isActive: true,
  },
  {
    id: 'observe',
    displayName: 'Observe',
    iconName: 'Eye',
    order: 1,
    containerType: 'internal',
    internalKey: 'observe',
    chatStream: 'observability',
    navAliases: ['observe', 'network', 'map', 'sites'],
    navSemanticPatterns: ['show network', 'view sites', 'observe network', 'network map'],
    requiresRole: 'user',
    isActive: true,
  },
  {
    id: 'appgen',
    displayName: 'AppGen',
    iconName: 'Sparkles',
    order: 2,
    containerType: 'internal',
    internalKey: 'appgen',
    chatStream: 'appgen',
    navAliases: ['appgen', 'codegen', 'code generator', 'ai builder'],
    navSemanticPatterns: ['generate app', 'ai code', 'go to appgen'],
    requiresRole: 'user',
    isActive: true,
  },
  {
    id: 'provision',
    displayName: 'Provision',
    iconName: 'Radio',
    order: 4,
    containerType: 'internal',
    internalKey: 'provision',
    chatStream: 'provision',
    navAliases: ['provision', 'provisioning', 'deployment'],
    navSemanticPatterns: ['provision sites', 'deploy', 'provisioning', 'provision services'],
    requiresRole: 'user',
    isActive: true,
  },
  {
    id: 'docs',
    displayName: 'Docs',
    iconName: 'BookOpen',
    order: 5,
    containerType: 'internal',
    internalKey: 'docs',
    chatStream: 'universal',
    navAliases: ['docs', 'documentation', 'help', 'reference', 'guide'],
    navSemanticPatterns: ['open documentation', 'show docs', 'help me', 'where is the manual'],
    requiresRole: 'user',
    isActive: true,
  },
  {
    id: 'settings',
    displayName: 'Settings',
    iconName: 'Settings',
    order: 6,
    containerType: 'internal',
    internalKey: 'settings',
    requiresRole: 'user',
    isActive: true,
  },
];

let memoryRegistry: AppRegistryEntry[] | null = null;

function ensureMemoryRegistry(): AppRegistryEntry[] {
  if (!memoryRegistry) {
    memoryRegistry = DEFAULT_REGISTRY.map((app) => ({ ...app }));
  }
  return memoryRegistry;
}

export class PlatformRegistryService {
  static async initialize(): Promise<void> {
    const MAX_ATTEMPTS = 10;
    const BASE_DELAY_MS = 1000;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await PlatformRegistryService._doInitialize();
        return;
      } catch (error: any) {
        const isLastAttempt = attempt === MAX_ATTEMPTS;
        const delayMs = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), 30_000);
        logger.error(`[Registry] Init failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${error?.message}`);
        if (isLastAttempt) {
          ensureMemoryRegistry();
          logger.warn('[Registry] Falling back to in-memory registry (Postgres unavailable).');
          return;
        }
        logger.warn(`[Registry] Retrying in ${delayMs}ms…`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  private static async _doInitialize(): Promise<void> {
    logger.info('[Registry] Initializing platform registry…');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_registry (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        icon_name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        container_type TEXT NOT NULL CHECK (container_type IN ('internal', 'federated', 'iframe')),
        config_json JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_app_permissions (
        user_id TEXT NOT NULL,
        app_id TEXT NOT NULL REFERENCES app_registry(id) ON DELETE CASCADE,
        is_enabled BOOLEAN DEFAULT true,
        granted_by TEXT,
        granted_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, app_id)
      );
    `);

    // Migration: remove stale appgen entry
    await pool.query(
      `DELETE FROM app_registry WHERE id = $1 AND config_json->>'internalKey' = $2`,
      ['appgen', 'appgen']
    );
    // Migration: remove appbuilder (removed from product)
    await pool.query(`DELETE FROM app_registry WHERE id = 'appbuilder'`);

    for (const app of DEFAULT_REGISTRY) {
      await pool.query(
        `
        INSERT INTO app_registry (id, display_name, icon_name, sort_order, container_type, config_json, is_active)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
        ON CONFLICT (id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          icon_name = EXCLUDED.icon_name,
          sort_order = EXCLUDED.sort_order,
          config_json = EXCLUDED.config_json,
          updated_at = NOW()
        `,
        [
          app.id,
          app.displayName,
          app.iconName,
          app.order,
          app.containerType,
          JSON.stringify({
            internalKey: app.internalKey,
            remoteUrl: app.remoteUrl,
            remoteName: app.remoteName,
            exposedModule: app.exposedModule,
            iframeUrl: app.iframeUrl,
            iframeSandbox: app.iframeSandbox,
            chatStream: app.chatStream,
            navAliases: app.navAliases || [],
            navSemanticPatterns: app.navSemanticPatterns || [],
            requiresRole: app.requiresRole,
          }),
          app.isActive,
        ]
      );
    }
    logger.info(`[Registry] Ready — ${DEFAULT_REGISTRY.length} apps seeded`);
  }

  static async getRegistry(): Promise<AppRegistryEntry[]> {
    try {
      const result = await pool.query(
        `SELECT id, display_name, icon_name, sort_order, container_type, config_json, is_active
         FROM app_registry
         ORDER BY sort_order ASC, id ASC`
      );

      return result.rows.map((row: any) => ({
        id: row.id,
        displayName: row.display_name,
        iconName: row.icon_name,
        order: row.sort_order,
        containerType: row.container_type,
        isActive: row.is_active,
        ...row.config_json,
      }));
    } catch (err: any) {
      logger.warn(`[Registry] Using in-memory registry (DB error): ${err?.message || err}`);
      return ensureMemoryRegistry().slice().sort((a, b) => a.order - b.order);
    }
  }

  static async getVisibleRegistry(userId: string, userRole: string): Promise<AppRegistryEntry[]> {
    const allApps = await this.getRegistry();

    try {
      const result = await pool.query(
        `SELECT app_id, is_enabled FROM user_app_permissions WHERE user_id = $1`,
        [userId]
      );
      const disabledApps = new Set(
        result.rows.filter((row: any) => !row.is_enabled).map((row: any) => row.app_id)
      );

      return allApps.filter(
        (app) =>
          app.isActive &&
          (!app.requiresRole || app.requiresRole === 'user' || (app.requiresRole === 'admin' && userRole === 'admin')) &&
          !disabledApps.has(app.id)
      );
    } catch (err: any) {
      logger.warn(`[Registry] Permissions unavailable (DB error): ${err?.message || err}`);
      return allApps.filter(
        (app) =>
          app.isActive &&
          (!app.requiresRole || app.requiresRole === 'user' || (app.requiresRole === 'admin' && userRole === 'admin'))
      );
    }
  }

  static async addApp(
    entry: Omit<AppRegistryEntry, 'isActive'>,
    adminId: string
  ): Promise<AppRegistryEntry> {
    const { id, displayName, iconName, order, containerType, ...config } = entry;

    if (!id || !displayName || !iconName) {
      throw new Error('id, displayName, and iconName are required');
    }

    try {
      await pool.query(
        `
        INSERT INTO app_registry (id, display_name, icon_name, sort_order, container_type, config_json, is_active, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, true, NOW())
        `,
        [id, displayName, iconName, order, containerType, JSON.stringify(config)]
      );

      return { ...entry, isActive: true };
    } catch (err: any) {
      logger.warn(`[Registry] addApp using in-memory registry (DB error): ${err?.message || err}`);
      const reg = ensureMemoryRegistry();
      const next: AppRegistryEntry = { ...entry, isActive: true } as AppRegistryEntry;
      const idx = reg.findIndex((x) => x.id === next.id);
      if (idx >= 0) reg[idx] = next;
      else reg.push(next);
      return next;
    }
  }

  static async toggleApp(id: string, isActive: boolean): Promise<void> {
    try {
      const result = await pool.query(
        `UPDATE app_registry SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
        [isActive, id]
      );

      if (result.rows.length === 0) {
        throw new Error(`App ${id} not found`);
      }
    } catch (err: any) {
      logger.warn(`[Registry] toggleApp using in-memory registry (DB error): ${err?.message || err}`);
      const reg = ensureMemoryRegistry();
      const idx = reg.findIndex((x) => x.id === id);
      if (idx >= 0) reg[idx] = { ...reg[idx], isActive };
    }
  }

  static async deleteApp(id: string): Promise<void> {
    const result = await pool.query(`DELETE FROM app_registry WHERE id = $1 RETURNING id`, [id]);

    if (result.rows.length === 0) {
      throw new Error(`App ${id} not found`);
    }
  }

  static async getUserPermissions(userId: string): Promise<Record<string, boolean>> {
    try {
      const result = await pool.query(
        `SELECT app_id, is_enabled FROM user_app_permissions WHERE user_id = $1`,
        [userId]
      );

      const permissions: Record<string, boolean> = {};
      result.rows.forEach((row: any) => {
        permissions[row.app_id] = row.is_enabled;
      });

      return permissions;
    } catch (err: any) {
      logger.warn(`[Registry] getUserPermissions returning defaults (DB error): ${err?.message || err}`);
      return {};
    }
  }

  static async setUserPermission(
    userId: string,
    appId: string,
    isEnabled: boolean,
    grantedBy: string
  ): Promise<void> {
    try {
      // First verify app exists
      const appExists = await pool.query(`SELECT id FROM app_registry WHERE id = $1`, [appId]);
      if (appExists.rows.length === 0) {
        throw new Error(`App ${appId} not found`);
      }

      await pool.query(
        `
        INSERT INTO user_app_permissions (user_id, app_id, is_enabled, granted_by, granted_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (user_id, app_id)
        DO UPDATE SET is_enabled = EXCLUDED.is_enabled, granted_by = EXCLUDED.granted_by, granted_at = NOW()
        `,
        [userId, appId, isEnabled, grantedBy]
      );
    } catch (err: any) {
      logger.warn(`[Registry] setUserPermission skipped (DB error): ${err?.message || err}`);
    }
  }

  static async resetUserPermissions(userId: string): Promise<void> {
    try {
      await pool.query(`DELETE FROM user_app_permissions WHERE user_id = $1`, [userId]);
    } catch (err: any) {
      logger.warn(`[Registry] resetUserPermissions skipped (DB error): ${err?.message || err}`);
    }
  }
}
