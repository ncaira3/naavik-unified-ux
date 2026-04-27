import { pool } from '../config/database.js';

export interface AppGenSettings {
  enabledOems: string[];
}

const SETTINGS_KEY = 'appgen_settings';
const DEFAULT_OEMS = ['Ericsson', 'Nokia', 'Samsung', 'Multi-OEM'];

export class AppSettingsService {
  static async initialize(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        setting_key TEXT PRIMARY KEY,
        value_json JSONB NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(
      `
      INSERT INTO app_settings (setting_key, value_json)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (setting_key) DO NOTHING
      `,
      [SETTINGS_KEY, JSON.stringify({ enabledOems: DEFAULT_OEMS })]
    );
  }

  static async getAppGenSettings(): Promise<AppGenSettings> {
    const result = await pool.query(
      `SELECT value_json FROM app_settings WHERE setting_key = $1 LIMIT 1`,
      [SETTINGS_KEY]
    );
    const value = result.rows[0]?.value_json || {};
    const enabled = Array.isArray(value.enabledOems) ? value.enabledOems : DEFAULT_OEMS;
    return {
      enabledOems: enabled.filter((o: string) => typeof o === 'string' && o.trim().length > 0),
    };
  }

  static async updateAppGenSettings(input: Partial<AppGenSettings>): Promise<AppGenSettings> {
    const current = await this.getAppGenSettings();
    const next: AppGenSettings = {
      enabledOems:
        Array.isArray(input.enabledOems) && input.enabledOems.length > 0
          ? input.enabledOems
          : current.enabledOems,
    };

    await pool.query(
      `
      INSERT INTO app_settings (setting_key, value_json, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (setting_key)
      DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()
      `,
      [SETTINGS_KEY, JSON.stringify(next)]
    );

    return next;
  }

  static async getAppGenPolicy(): Promise<{
    enabledOems: string[];
    ericssonOnly: boolean;
  }> {
    const settings = await this.getAppGenSettings();
    const normalized = settings.enabledOems.map((o) => o.toLowerCase());
    const ericssonOnly = normalized.length === 1 && normalized[0] === 'ericsson';
    return { enabledOems: settings.enabledOems, ericssonOnly };
  }
}

