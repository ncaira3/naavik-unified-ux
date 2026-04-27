/**
 * Conversation Context Service
 * Manages multi-turn conversation context for intent system
 */
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { ParsedIntent } from '../types/index.js';

export interface ConversationContext {
  conversationId: string;
  userId?: string;
  lastQuery?: string;
  lastIntent?: ParsedIntent;
  lastResults?: any;
  contextData?: Record<string, any>;
  followUpQuestions?: string[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export class ConversationContextService {
  private static tableEnsured = false;

  private static async ensureTable(): Promise<void> {
    if (this.tableEnsured) return;
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS conversation_context (
          conversation_id VARCHAR(128) PRIMARY KEY,
          user_id VARCHAR(128),
          last_query TEXT,
          last_intent JSONB,
          last_results JSONB,
          context_data JSONB,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMPTZ DEFAULT (CURRENT_TIMESTAMP + INTERVAL '8 hours')
        )
      `);
      this.tableEnsured = true;
    } catch (error) {
      logger.warn('Could not ensure conversation_context table; using stateless mode');
    }
  }

  /**
   * Get or create conversation context
   */
  static async getContext(conversationId: string, userId?: string): Promise<ConversationContext | null> {
    try {
      await this.ensureTable();
      const result = await pool.query(
        `SELECT * FROM conversation_context 
         WHERE conversation_id = $1 
         AND expires_at > CURRENT_TIMESTAMP 
         ORDER BY updated_at DESC 
         LIMIT 1`,
        [conversationId]
      );

      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          conversationId: row.conversation_id,
          userId: row.user_id,
          lastQuery: row.last_query,
          lastIntent: row.last_intent,
          lastResults: row.last_results,
          contextData: row.context_data || {},
          followUpQuestions: row.context_data?.followUpQuestions || [],
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          expiresAt: row.expires_at
        };
      }

      return null;
    } catch (error) {
      logger.warn('Failed to get conversation context', error);
      return null;
    }
  }

  /**
   * Update conversation context
   */
  static async updateContext(
    conversationId: string,
    updates: Partial<ConversationContext>
  ): Promise<void> {
    try {
      await this.ensureTable();
      await pool.query(
        `INSERT INTO conversation_context (
          conversation_id, 
          user_id, 
          last_query, 
          last_intent, 
          last_results,
          context_data,
          updated_at,
          expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '8 hours')
        ON CONFLICT (conversation_id) DO UPDATE SET
          user_id = COALESCE($2, conversation_context.user_id),
          last_query = COALESCE($3, conversation_context.last_query),
          last_intent = COALESCE($4::jsonb, conversation_context.last_intent),
          last_results = COALESCE($5::jsonb, conversation_context.last_results),
          context_data = COALESCE($6::jsonb, conversation_context.context_data),
          updated_at = CURRENT_TIMESTAMP,
          expires_at = CURRENT_TIMESTAMP + INTERVAL '8 hours'`,
        [
          conversationId,
          updates.userId,
          updates.lastQuery,
          updates.lastIntent ? JSON.stringify(updates.lastIntent) : null,
          updates.lastResults ? JSON.stringify(updates.lastResults) : null,
          updates.contextData ? JSON.stringify(updates.contextData) : null
        ]
      );

      logger.info(`Updated conversation context: ${conversationId}`);
    } catch (error) {
      logger.warn('Failed to update conversation context', error);
    }
  }

  /**
   * Generate follow-up questions based on last intent
   */
  static generateFollowUpQuestions(intent: ParsedIntent, results?: any): string[] {
    const followUps: string[] = [];

    switch (intent.intent) {
      case 'QUERY_DB':
        followUps.push('Show me more details');
        followUps.push('Export this as CSV');
        followUps.push('Visualize this data');
        followUps.push('Filter by region');
        break;

      case 'ANALYZE_DATA':
        followUps.push('Show me the trend over time');
        followUps.push('Compare with last week');
        followUps.push('Which sites have the highest values?');
        break;

      case 'SHOW_MAP':
        followUps.push('Show only critical sites');
        followUps.push('Zoom to a specific region');
        followUps.push('Show site details');
        break;

      case 'OBSERVE':
        followUps.push('What caused this issue?');
        followUps.push('Show me the affected sites');
        followUps.push('Create an alert for this');
        break;

      default:
        followUps.push('Tell me more');
        followUps.push('Show related data');
    }

    return followUps;
  }

  /**
   * Check if query is a follow-up
   */
  static isFollowUpQuery(query: string, context: ConversationContext | null): boolean {
    if (!context || !context.lastQuery) {
      return false;
    }

    const followUpKeywords = [
      'more', 'details', 'explain', 'why', 'how', 
      'that', 'this', 'those', 'these', 'it',
      'also', 'additionally', 'furthermore'
    ];

    const lowerQuery = query.toLowerCase();
    return followUpKeywords.some(keyword => lowerQuery.includes(keyword));
  }

  /**
   * Enhance query with context
   */
  static enhanceQueryWithContext(query: string, context: ConversationContext | null): string {
    if (!context || !this.isFollowUpQuery(query, context)) {
      return query;
    }

    // Add context from previous query
    let enhancedQuery = query;

    if (context.lastIntent) {
      const intent = context.lastIntent;
      
      // Add filters from last query
      if (intent.filters && Object.keys(intent.filters).length > 0) {
        const filters = Object.entries(intent.filters)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
        enhancedQuery += ` (applying previous filters: ${filters})`;
      }
    }

    return enhancedQuery;
  }

  /**
   * Clean up expired contexts
   */
  static async cleanupExpired(): Promise<number> {
    try {
      const result = await pool.query(
        `DELETE FROM conversation_context WHERE expires_at < CURRENT_TIMESTAMP`
      );

      const deleted = result.rowCount || 0;
      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} expired conversation contexts`);
      }

      return deleted;
    } catch (error) {
      logger.error('Failed to cleanup expired contexts', error);
      return 0;
    }
  }
}
