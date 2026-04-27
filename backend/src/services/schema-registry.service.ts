import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import type { DatabaseSchema } from '../types/index.js';

export interface RegisteredSchema {
  schemaId: string;
  description?: string;
  schema: DatabaseSchema;
  updatedAt: string;
}

type RegistryStore = Record<string, RegisteredSchema>;

const REGISTRY_FILE = path.join(process.cwd(), 'data', 'schema-registry.json');

export class SchemaRegistryService {
  private static cache: RegistryStore | null = null;

  private static async ensureLoaded(): Promise<void> {
    if (this.cache) return;
    try {
      const raw = await readFile(REGISTRY_FILE, 'utf-8');
      this.cache = JSON.parse(raw) as RegistryStore;
    } catch {
      this.cache = {};
    }
  }

  private static async persist(): Promise<void> {
    await mkdir(path.dirname(REGISTRY_FILE), { recursive: true });
    await writeFile(REGISTRY_FILE, JSON.stringify(this.cache || {}, null, 2), 'utf-8');
  }

  static async listSchemas(): Promise<Array<RegisteredSchema>> {
    await this.ensureLoaded();
    return Object.values(this.cache || {}).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  static async getSchema(schemaId: string): Promise<RegisteredSchema | null> {
    await this.ensureLoaded();
    return (this.cache || {})[schemaId] || null;
  }

  static async upsertSchema(input: {
    schemaId: string;
    schema: DatabaseSchema;
    description?: string;
  }): Promise<RegisteredSchema> {
    await this.ensureLoaded();
    const { schemaId, schema, description } = input;
    const normalizedId = String(schemaId || '').trim();
    if (!normalizedId) {
      throw new Error('schemaId is required');
    }
    if (!schema || !Array.isArray(schema.tables) || schema.tables.length === 0) {
      throw new Error('schema.tables is required and must be non-empty');
    }

    const entry: RegisteredSchema = {
      schemaId: normalizedId,
      description: description?.trim() || undefined,
      schema,
      updatedAt: new Date().toISOString(),
    };
    (this.cache as RegistryStore)[normalizedId] = entry;
    await this.persist();
    logger.info(`[SchemaRegistry] Upserted schema "${normalizedId}" (${schema.tables.length} tables)`);
    return entry;
  }

  static async deleteSchema(schemaId: string): Promise<boolean> {
    await this.ensureLoaded();
    if (!(this.cache as RegistryStore)[schemaId]) return false;
    delete (this.cache as RegistryStore)[schemaId];
    await this.persist();
    logger.info(`[SchemaRegistry] Deleted schema "${schemaId}"`);
    return true;
  }

  static schemaToPromptContext(schema: DatabaseSchema): string {
    const lines: string[] = ['Schema Contract (Use ONLY these tables/columns):'];
    for (const table of schema.tables) {
      const cols = table.columns
        .map((c) => `${c.name}:${c.type}${c.nullable ? '?' : ''}`)
        .join(', ');
      lines.push(`- ${table.name}(${cols})`);
    }
    lines.push('Rules:');
    lines.push('- Use only SELECT statements');
    lines.push('- Never use SELECT *');
    lines.push('- Include LIMIT/TOP in every query');
    return lines.join('\n');
  }
}

