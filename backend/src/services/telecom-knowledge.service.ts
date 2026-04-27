/**
 * Telecom Knowledge Service
 * Provides search and Q&A capabilities for Ericsson Parameters and KPI Descriptions
 * Uses PostgreSQL full-text search and OpenAI for intelligent responses
 */
import { pool } from '../config/database.js';
import { openai } from '../config/openai.js';
import { logger } from '../utils/logger.js';
import { dataDictResolver } from './datadict-resolver.service.js';

export interface Parameter {
  id: number;
  model?: string;
  mo_class?: string;
  parameter_name: string;
  parameter_description?: string;
  data_type?: string;
  range_and_values?: string;
  default_value?: string;
  unit?: string;
  read_only?: boolean;
  mandatory?: boolean;
}

export interface KPI {
  id: number;
  metric: string;
  vendor?: string;
  db_counter_name?: string;
  description?: string;
  category?: string;
}

export interface SearchResult {
  type: 'parameter' | 'kpi';
  id: number;
  name: string;
  description?: string;
  metadata: any;
  relevance: number;
}

export interface QAResponse {
  answer: string;
  sources: SearchResult[];
  confidence: number;
}

export class TelecomKnowledgeService {
  
  /**
   * Search parameters using full-text search, with ILIKE fallback
   */
  static async searchParameters(query: string, limit: number = 10): Promise<SearchResult[]> {
    try {
      logger.info(`Searching parameters: "${query}"`);
      const safeQuery = query.replace(/'/g, "''").substring(0, 200);
      
      // Try FTS first
      let result = await pool.query(`
        SELECT 
          p.id,
          p.parameter_name,
          p.mo_class,
          p.parameter_description,
          p.data_type,
          p.range_and_values,
          p.default_value,
          p.unit,
          ts_rank(p.tsv_param, websearch_to_tsquery('english', $1)) as rank
        FROM ericsson_parameters p
        WHERE p.tsv_param @@ websearch_to_tsquery('english', $1)
        ORDER BY rank DESC, p.parameter_name
        LIMIT $2
      `, [safeQuery, limit]);
      
      // Fallback: ILIKE if FTS returns nothing
      if (result.rows.length === 0 && safeQuery.length >= 2) {
        const likePattern = `%${safeQuery.replace(/%/g, '\\%')}%`;
        result = await pool.query(`
          SELECT id, parameter_name, mo_class, parameter_description,
                 data_type, range_and_values, default_value, unit,
                 0.5::float as rank
          FROM ericsson_parameters
          WHERE parameter_name ILIKE $1 OR parameter_description ILIKE $1
          ORDER BY parameter_name
          LIMIT $2
        `, [likePattern, limit]);
      }
      
      return result.rows.map(row => ({
        type: 'parameter' as const,
        id: row.id,
        name: row.parameter_name,
        description: row.parameter_description,
        metadata: {
          mo_class: row.mo_class,
          data_type: row.data_type,
          range_and_values: row.range_and_values,
          default_value: row.default_value,
          unit: row.unit
        },
        relevance: parseFloat(row.rank) || 0.5
      }));
    } catch (error: any) {
      // Table may not exist in this environment — degrade gracefully
      if (error?.code === '42P01') return [];
      logger.error('Error searching parameters:', error);
      return [];
    }
  }

  /**
   * Search KPIs using full-text search, with ILIKE fallback
   */
  static async searchKPIs(query: string, limit: number = 10): Promise<SearchResult[]> {
    try {
      logger.info(`Searching KPIs: "${query}"`);
      const safeQuery = query.replace(/'/g, "''").substring(0, 200);
      
      // Try FTS first
      let result = await pool.query(`
        SELECT 
          k.id,
          k.metric,
          k.db_counter_name,
          k.description,
          k.category,
          k.vendor,
          ts_rank(k.tsv_kpi, websearch_to_tsquery('english', $1)) as rank
        FROM ericsson_kpi_descriptions k
        WHERE k.tsv_kpi @@ websearch_to_tsquery('english', $1)
        ORDER BY rank DESC, k.metric
        LIMIT $2
      `, [safeQuery, limit]);
      
      // Fallback: ILIKE if FTS returns nothing
      if (result.rows.length === 0 && safeQuery.length >= 2) {
        const likePattern = `%${safeQuery.replace(/%/g, '\\%')}%`;
        result = await pool.query(`
          SELECT id, metric, db_counter_name, description, category, vendor,
                 0.5::float as rank
          FROM ericsson_kpi_descriptions
          WHERE metric ILIKE $1 OR db_counter_name ILIKE $1 OR description ILIKE $1
          ORDER BY metric
          LIMIT $2
        `, [likePattern, limit]);
      }
      
      return result.rows.map(row => ({
        type: 'kpi' as const,
        id: row.id,
        name: row.metric,
        description: row.description,
        metadata: {
          db_counter_name: row.db_counter_name,
          category: row.category,
          vendor: row.vendor
        },
        relevance: parseFloat(row.rank) || 0.5
      }));
    } catch (error: any) {
      if (error?.code === '42P01') return [];
      logger.error('Error searching KPIs:', error);
      return [];
    }
  }
  
  /**
   * Combined search across parameters and KPIs
   */
  static async search(query: string, limit: number = 10): Promise<SearchResult[]> {
    try {
      const [params, kpis] = await Promise.all([
        this.searchParameters(query, Math.ceil(limit / 2)),
        this.searchKPIs(query, Math.ceil(limit / 2))
      ]);
      
      // Combine and sort by relevance
      const combined = [...params, ...kpis];
      combined.sort((a, b) => b.relevance - a.relevance);
      
      return combined.slice(0, limit);
    } catch (error) {
      logger.error('Error in combined search:', error);
      throw error;
    }
  }
  
  /**
   * Get parameter by ID
   */
  static async getParameterById(id: number): Promise<Parameter | null> {
    try {
      const result = await pool.query(`
        SELECT * FROM ericsson_parameters WHERE id = $1
      `, [id]);
      
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting parameter:', error);
      throw error;
    }
  }
  
  /**
   * Get KPI by ID
   */
  static async getKPIById(id: number): Promise<KPI | null> {
    try {
      const result = await pool.query(`
        SELECT * FROM ericsson_kpi_descriptions WHERE id = $1
      `, [id]);
      
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting KPI:', error);
      throw error;
    }
  }
  
  /**
   * Format search results as a readable answer (fallback when OpenAI fails)
   */
  private static formatSearchResultsAsAnswer(searchResults: SearchResult[], question: string): string {
    const parts: string[] = [];
    for (const result of searchResults) {
      const type = result.type === 'parameter' ? 'Parameter' : 'KPI';
      parts.push(`**${type}: ${result.name}**`);
      if (result.description) {
        parts.push(result.description);
      }
      const meta = Object.entries(result.metadata)
        .filter(([_, v]) => v != null)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ');
      if (meta) {
        parts.push(meta);
      }
      parts.push('');
    }
    return parts.join('\n').trim() || "I couldn't find relevant information for your question.";
  }

  /**
   * Answer a question using RAG (Retrieval-Augmented Generation)
   * Falls back to plain search results when OpenAI is unavailable
   * @param streamContext - Optional stream context (e.g. knowledge, observability) for LLM system prompt
   */
  static async answerQuestion(question: string, streamContext?: string, conversationHistory?: { role: string; content: string }[]): Promise<QAResponse> {
    let searchResults: SearchResult[] = [];
    
    try {
      logger.info(`Answering question: "${question}"`);
      
      // Extract key terms for search (e.g. "what is qrxlevmin" -> "qrxlevmin")
      const searchTerms = question
        .replace(/\b(what|is|the|a|an|explain|describe|tell|me|about)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim() || question;
      
      // Retrieve relevant context - try both full question and extracted terms
      searchResults = await this.search(searchTerms, 5);
      if (searchResults.length === 0) {
        searchResults = await this.search(question, 5);
      }
      
      // Fallback: try DataDict (16,038 Ericsson EIAP params) when PostgreSQL KB is empty
      if (searchResults.length === 0 && dataDictResolver.isLoaded) {
        const exact = dataDictResolver.findExact(searchTerms);
        const ddMatches = exact
          ? [{ ...exact, score: 1.0 }]
          : dataDictResolver.fuzzyMatch(searchTerms, { limit: 5, minScore: 0.3 });

        if (ddMatches.length > 0) {
          logger.info(`[TelecomKnowledge] DataDict fallback found ${ddMatches.length} match(es) for "${searchTerms}"`);
          searchResults = ddMatches.map(m => ({
            type: 'parameter' as const,
            id: 0,
            name: m.paramName,
            description: m.description,
            metadata: {
              structure: m.structureName,
              category: m.category,
              data_type: m.dataType,
              source: 'Ericsson DataDict'
            },
            relevance: m.score
          }));
        }
      }

      if (searchResults.length === 0) {
        return {
          answer: "I couldn't find relevant information in the Ericsson knowledge base for your question. Could you try rephrasing or be more specific? (e.g. 'What is qRxLevMin?' or 'Explain drop rate')",
          sources: [],
          confidence: 0.0
        };
      }
      
      // Build context from search results
      const context = searchResults.map((result, idx) => {
        const type = result.type === 'parameter' ? 'Parameter' : 'KPI';
        const desc = result.description ? `\nDescription: ${result.description}` : '';
        const metadata = Object.entries(result.metadata)
          .filter(([_, v]) => v != null)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        
        return `[${idx + 1}] ${type}: ${result.name}${desc}\n${metadata}`;
      }).join('\n\n');
      
      // Use OpenAI to generate answer (if available)
      const hasOpenAI = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy-key';
      
      if (hasOpenAI) {
        try {
          const systemPrompt = `You are an expert telecom network engineer assistant embedded in Naavik, an AI-driven network operations platform. Answer questions about Ericsson parameters, KPIs, and network operations based on the provided context and conversation history.

Rules:
1. Only use information from the provided context and conversation history
2. Be precise and technical
3. If the context doesn't fully answer the question, say so
4. Reference specific parameters or KPIs by name
5. Keep answers concise but informative
6. If the user is asking a follow-up question about a previously discussed site or RCA, use that context to give a relevant answer`;

          const historyMessages: { role: 'user' | 'assistant'; content: string }[] = [];
          if (conversationHistory && conversationHistory.length > 0) {
            for (const msg of conversationHistory.slice(-6)) {
              if (msg.role === 'user' || msg.role === 'assistant') {
                historyMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
              }
            }
          }

          const userPrompt = `Context:
${context}

Question: ${question}

Provide a clear, technical answer based on the context above.`;

          const response = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
              { role: 'system', content: systemPrompt },
              ...historyMessages,
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.3,
            max_tokens: 500,
          });
          
          const answer = response.choices[0].message.content || "I couldn't generate an answer.";
          const avgRelevance = searchResults.reduce((sum, r) => sum + r.relevance, 0) / searchResults.length;
          const confidence = Math.min(0.95, avgRelevance * 0.8 + (searchResults.length / 10) * 0.2);
          
          return { answer, sources: searchResults, confidence };
        } catch (openaiError: any) {
          logger.warn('OpenAI failed, using search-result fallback:', openaiError.message);
        }
      }
      
      // Fallback: return formatted search results without LLM
      const answer = this.formatSearchResultsAsAnswer(searchResults, question);
      const avgRelevance = searchResults.reduce((sum, r) => sum + r.relevance, 0) / searchResults.length;
      const confidence = Math.min(0.85, avgRelevance * 0.6 + (searchResults.length / 10) * 0.2);
      
      return { answer, sources: searchResults, confidence };
      
    } catch (error) {
      logger.error('Error answering question:', error);
      
      // If we have search results but something else failed, still return them
      if (searchResults.length > 0) {
        return {
          answer: this.formatSearchResultsAsAnswer(searchResults, question),
          sources: searchResults,
          confidence: 0.5
        };
      }
      
      return {
        answer: "I encountered an error while processing your question. The knowledge base may not be loaded. Please ensure the Ericsson parameters and KPI tables are populated, or try again later.",
        sources: [],
        confidence: 0.0
      };
    }
  }
  
  /**
   * List parameters with pagination
   */
  static async listParameters(limit: number = 50, offset: number = 0, category?: string): Promise<{ parameters: Parameter[], total: number }> {
    try {
      const whereClause = category ? `WHERE mo_class = $3` : '';
      const params = category ? [limit, offset, category] : [limit, offset];
      
      const [dataResult, countResult] = await Promise.all([
        pool.query(`
          SELECT id, model, mo_class, parameter_name, parameter_description, 
                 data_type, range_and_values, default_value, unit, 
                 read_only, mandatory
          FROM ericsson_parameters
          ${whereClause}
          ORDER BY parameter_name
          LIMIT $1 OFFSET $2
        `, params),
        pool.query(`
          SELECT COUNT(*) as total
          FROM ericsson_parameters
          ${whereClause}
        `, category ? [category] : [])
      ]);
      
      return {
        parameters: dataResult.rows,
        total: parseInt(countResult.rows[0].total)
      };
    } catch (error) {
      logger.error('Error listing parameters:', error);
      throw error;
    }
  }
  
  /**
   * List KPIs with pagination
   */
  static async listKPIs(limit: number = 50, offset: number = 0, category?: string): Promise<{ kpis: KPI[], total: number }> {
    try {
      const whereClause = category ? `WHERE category = $3` : '';
      const params = category ? [limit, offset, category] : [limit, offset];
      
      const [dataResult, countResult] = await Promise.all([
        pool.query(`
          SELECT id, metric, vendor, db_counter_name, description, category
          FROM ericsson_kpi_descriptions
          ${whereClause}
          ORDER BY metric
          LIMIT $1 OFFSET $2
        `, params),
        pool.query(`
          SELECT COUNT(*) as total
          FROM ericsson_kpi_descriptions
          ${whereClause}
        `, category ? [category] : [])
      ]);
      
      return {
        kpis: dataResult.rows,
        total: parseInt(countResult.rows[0].total)
      };
    } catch (error) {
      logger.error('Error listing KPIs:', error);
      throw error;
    }
  }
}
