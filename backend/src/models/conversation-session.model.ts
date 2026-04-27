import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database.js';
import type { BuilderArtifact, BuilderChannel, BuilderScenarioType, SlotStatus } from '../types/conversational-builder.js';

export interface ConversationSessionRecord {
  threadId: string;
  scenarioType: BuilderScenarioType;
  channel: BuilderChannel;
  status: 'active' | 'completed' | 'reset' | 'archived';
  canGenerate: boolean;
  userId?: string | null;
  conversationPhase?: string;
  conversationSummary?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSlotRecord {
  slotKey: string;
  slotStatus: SlotStatus;
  valueText: string | null;
  valueJson: any | null;
  updatedAt: string;
}

export class ConversationSessionModel {
  private static isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  static async getOrCreateSession(threadId: string | undefined, channel: BuilderChannel, userId?: string): Promise<ConversationSessionRecord> {
    if (threadId && this.isUuid(threadId)) {
      const existing = await this.getSession(threadId);
      if (existing) return existing;
    }

    const id = threadId && this.isUuid(threadId) ? threadId : uuidv4();
    const result = await pool.query(
      `INSERT INTO conversation_sessions (thread_id, scenario_type, channel, status, can_generate, user_id, conversation_phase)
       VALUES ($1, 'prb_qrxlevmin_v1', $2, 'active', false, $3, 'intake')
       RETURNING thread_id, scenario_type, channel, status, can_generate, user_id, conversation_phase, conversation_summary, created_at, updated_at`,
      [id, channel, userId || null]
    );

    return this.mapSession(result.rows[0]);
  }

  static async getSession(threadId: string): Promise<ConversationSessionRecord | null> {
    const result = await pool.query(
      `SELECT thread_id, scenario_type, channel, status, can_generate, user_id, conversation_phase, conversation_summary, created_at, updated_at
       FROM conversation_sessions
       WHERE thread_id = $1`,
      [threadId]
    );
    if (result.rows.length === 0) return null;
    return this.mapSession(result.rows[0]);
  }

  static async listByUser(userId: string, limit: number = 20): Promise<ConversationSessionRecord[]> {
    const result = await pool.query(
      `SELECT thread_id, scenario_type, channel, status, can_generate, user_id, conversation_phase, conversation_summary, created_at, updated_at
       FROM conversation_sessions
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map((row) => this.mapSession(row));
  }

  static async setCanGenerate(threadId: string, canGenerate: boolean): Promise<void> {
    await pool.query(
      `UPDATE conversation_sessions
       SET can_generate = $2
       WHERE thread_id = $1`,
      [threadId, canGenerate]
    );
  }

  static async setStatus(threadId: string, status: 'active' | 'completed' | 'reset' | 'archived'): Promise<void> {
    await pool.query(
      `UPDATE conversation_sessions
       SET status = $2
       WHERE thread_id = $1`,
      [threadId, status]
    );
  }

  static async appendMessage(threadId: string, role: 'user' | 'assistant' | 'system', content: string): Promise<void> {
    await pool.query(
      `INSERT INTO conversation_messages (thread_id, role, content)
       VALUES ($1, $2, $3)`,
      [threadId, role, content]
    );
  }

  static async getMessages(threadId: string, includeArchived: boolean = false): Promise<Array<{ role: 'user' | 'assistant' | 'system'; content: string; createdAt: string; isArchived?: boolean }>> {
    const archivedClause = includeArchived ? '' : 'AND is_archived = false';
    const result = await pool.query(
      `SELECT role, content, created_at, is_archived
       FROM conversation_messages
       WHERE thread_id = $1 ${archivedClause}
       ORDER BY created_at ASC`,
      [threadId]
    );

    return result.rows.map((row) => ({
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      isArchived: row.is_archived,
    }));
  }

  static async archiveMessagesUpTo(threadId: string, createdAtThreshold: string): Promise<void> {
    await pool.query(
      `UPDATE conversation_messages
       SET is_archived = true
       WHERE thread_id = $1 AND created_at <= $2 AND is_archived = false`,
      [threadId, createdAtThreshold]
    );
  }

  static async upsertSlot(
    threadId: string,
    slotKey: string,
    slotStatus: SlotStatus,
    valueText?: string | null,
    valueJson?: Record<string, unknown> | null
  ): Promise<void> {
    await pool.query(
      `INSERT INTO conversation_slots (thread_id, slot_key, slot_status, value_text, value_json)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (thread_id, slot_key)
       DO UPDATE SET slot_status = EXCLUDED.slot_status,
                     value_text = EXCLUDED.value_text,
                     value_json = EXCLUDED.value_json,
                     updated_at = NOW()`,
      [threadId, slotKey, slotStatus, valueText ?? null, valueJson ? JSON.stringify(valueJson) : null]
    );
  }

  static async getSlots(threadId: string): Promise<ConversationSlotRecord[]> {
    const result = await pool.query(
      `SELECT slot_key, slot_status, value_text, value_json, updated_at
       FROM conversation_slots
       WHERE thread_id = $1`,
      [threadId]
    );
    return result.rows.map((row) => ({
      slotKey: row.slot_key,
      slotStatus: row.slot_status,
      valueText: row.value_text,
      valueJson: row.value_json,
      updatedAt: row.updated_at,
    }));
  }

  static async addDecision(
    threadId: string,
    decisionType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await pool.query(
      `INSERT INTO conversation_decisions (thread_id, decision_type, decision_payload)
       VALUES ($1, $2, $3::jsonb)`,
      [threadId, decisionType, JSON.stringify(payload || {})]
    );
  }

  static async upsertArtifact(
    threadId: string,
    artifact: BuilderArtifact
  ): Promise<void> {
    await pool.query(
      `INSERT INTO generated_artifacts (thread_id, artifact_type, artifact_status, file_path, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [threadId, artifact.type, artifact.status, artifact.filePath || null, JSON.stringify(artifact.metadata || {})]
    );
  }

  static async getArtifacts(threadId: string): Promise<BuilderArtifact[]> {
    const result = await pool.query(
      `SELECT artifact_type, artifact_status, file_path, metadata
       FROM generated_artifacts
       WHERE thread_id = $1
       ORDER BY created_at DESC`,
      [threadId]
    );
    return result.rows.map((row) => ({
      type: row.artifact_type,
      status: row.artifact_status,
      filePath: row.file_path || undefined,
      metadata: row.metadata || {},
    }));
  }

  static async setConversationSummary(threadId: string, summary: string): Promise<void> {
    await pool.query(
      `UPDATE conversation_sessions
       SET conversation_summary = $2
       WHERE thread_id = $1`,
      [threadId, summary]
    );
  }

  static async setConversationPhase(threadId: string, phase: string): Promise<void> {
    await pool.query(
      `UPDATE conversation_sessions
       SET conversation_phase = $2
       WHERE thread_id = $1`,
      [threadId, phase]
    );
  }

  static async resetThread(threadId: string): Promise<void> {
    await pool.query(`DELETE FROM conversation_messages WHERE thread_id = $1`, [threadId]);
    await pool.query(`DELETE FROM conversation_slots WHERE thread_id = $1`, [threadId]);
    await pool.query(`DELETE FROM conversation_decisions WHERE thread_id = $1`, [threadId]);
    await pool.query(`DELETE FROM generated_artifacts WHERE thread_id = $1`, [threadId]);
    await this.setStatus(threadId, 'reset');
    await this.setCanGenerate(threadId, false);
  }

  private static mapSession(row: any): ConversationSessionRecord {
    return {
      threadId: row.thread_id,
      scenarioType: row.scenario_type,
      channel: row.channel,
      status: row.status,
      canGenerate: row.can_generate,
      userId: row.user_id,
      conversationPhase: row.conversation_phase,
      conversationSummary: row.conversation_summary,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
