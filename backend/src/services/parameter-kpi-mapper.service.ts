/**
 * Parameter and KPI Mapper Service
 * Maps natural language inputs to canonical parameter/KPI names
 * Handles disambiguation when multiple matches are found
 */
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import type { Parameter, KPI } from './telecom-knowledge.service.js';
import { CsvRagResolverService } from './csv-rag-resolver.service.js';

export interface ParameterMatch {
  parameter: Parameter;
  alias: string;
  confidence: number;
}

export interface KPIMatch {
  kpi: KPI;
  alias: string;
  confidence: number;
}

export interface ResolveResult<T> {
  matches: T[];
  ambiguous: boolean;
  resolved?: T;
}

export class ParameterKPIMapperService {
  
  /**
   * Resolve a natural language input to parameter(s)
   */
  static async resolveParameter(nlInput: string): Promise<ResolveResult<ParameterMatch>> {
    try {
      logger.info(`Resolving parameter: "${nlInput}"`);
      
      const cleanInput = nlInput.toLowerCase().trim();
      const normalizedInput = this.normalizeIdentifier(nlInput);

      // Strong canonical match first (case/underscore/space-insensitive).
      const canonicalResult = await pool.query(`
        SELECT
          p.*,
          p.parameter_name AS alias,
          1.0::float AS confidence
        FROM ericsson_parameters p
        WHERE regexp_replace(LOWER(p.parameter_name), '[^a-z0-9]', '', 'g') = $1
        ORDER BY p.parameter_name
        LIMIT 20
      `, [normalizedInput]);
      if (canonicalResult.rows.length > 0) {
        const canonicalMatches: ParameterMatch[] = canonicalResult.rows.map(row => ({
          parameter: {
            id: row.id,
            model: row.model,
            mo_class: row.mo_class,
            parameter_name: row.parameter_name,
            parameter_description: row.parameter_description,
            data_type: row.data_type,
            range_and_values: row.range_and_values,
            default_value: row.default_value,
            unit: row.unit,
            read_only: row.read_only,
            mandatory: row.mandatory
          },
          alias: row.alias,
          confidence: Number(row.confidence)
        }));
        const uniqueMatches = this.deduplicateMatches(canonicalMatches);
        return {
          matches: uniqueMatches,
          ambiguous: uniqueMatches.length > 1,
          resolved: uniqueMatches.length === 1 ? uniqueMatches[0] : undefined
        };
      }
      
      // Try exact match first
      const exactResult = await pool.query(`
        SELECT 
          p.*,
          a.alias,
          a.confidence
        FROM parameter_nl_aliases a
        JOIN ericsson_parameters p ON a.parameter_id = p.id
        WHERE LOWER(a.alias) = $1
        ORDER BY a.confidence DESC, p.parameter_name
        LIMIT 10
      `, [cleanInput]);
      
      // If no exact match, try fuzzy match with full-text search
      if (exactResult.rows.length === 0) {
        const fuzzyResult = await pool.query(`
          SELECT 
            p.*,
            a.alias,
            a.confidence,
            ts_rank(a.tsv_alias, websearch_to_tsquery('english', $1)) as rank
          FROM parameter_nl_aliases a
          JOIN ericsson_parameters p ON a.parameter_id = p.id
          WHERE a.tsv_alias @@ websearch_to_tsquery('english', $1)
          ORDER BY rank DESC, a.confidence DESC, p.parameter_name
          LIMIT 10
        `, [cleanInput]);
        
        let matches: ParameterMatch[] = fuzzyResult.rows.map(row => ({
          parameter: {
            id: row.id,
            model: row.model,
            mo_class: row.mo_class,
            parameter_name: row.parameter_name,
            parameter_description: row.parameter_description,
            data_type: row.data_type,
            range_and_values: row.range_and_values,
            default_value: row.default_value,
            unit: row.unit,
            read_only: row.read_only,
            mandatory: row.mandatory
          },
          alias: row.alias,
          confidence: parseFloat(row.confidence) * parseFloat(row.rank)
        }));

        // CSV RAG fallback for typos/name mismatches.
        if (matches.length === 0) {
          const csvMatches = await CsvRagResolverService.resolveParameter(cleanInput, 20);
          matches = await this.inflateParameterMatchesFromCanonical(csvMatches);
        }
        
        // Deduplicate by parameter ID
        const uniqueMatches = this.deduplicateMatches(matches);
        
        return {
          matches: uniqueMatches,
          ambiguous: uniqueMatches.length > 1,
          resolved: uniqueMatches.length === 1 ? uniqueMatches[0] : undefined
        };
      }
      
      const matches: ParameterMatch[] = exactResult.rows.map(row => ({
        parameter: {
          id: row.id,
          model: row.model,
          mo_class: row.mo_class,
          parameter_name: row.parameter_name,
          parameter_description: row.parameter_description,
          data_type: row.data_type,
          range_and_values: row.range_and_values,
          default_value: row.default_value,
          unit: row.unit,
          read_only: row.read_only,
          mandatory: row.mandatory
        },
        alias: row.alias,
        confidence: parseFloat(row.confidence)
      }));
      
      // Deduplicate by parameter ID
      const uniqueMatches = this.deduplicateMatches(matches);
      
      return {
        matches: uniqueMatches,
        ambiguous: uniqueMatches.length > 1,
        resolved: uniqueMatches.length === 1 ? uniqueMatches[0] : undefined
      };
      
    } catch (error) {
      logger.error('Error resolving parameter, trying CSV fallback:', error);
      const csvMatches = await CsvRagResolverService.resolveParameter(nlInput, 20);
      const matches = await this.inflateParameterMatchesFromCanonical(csvMatches);
      const uniqueMatches = this.deduplicateMatches(matches);
      return {
        matches: uniqueMatches,
        ambiguous: uniqueMatches.length > 1,
        resolved: uniqueMatches.length === 1 ? uniqueMatches[0] : undefined
      };
    }
  }
  
  /**
   * Resolve a natural language input to KPI(s)
   */
  static async resolveKPI(nlInput: string): Promise<ResolveResult<KPIMatch>> {
    try {
      logger.info(`Resolving KPI: "${nlInput}"`);
      
      const cleanInput = nlInput.toLowerCase().trim();
      
      // Try exact match first
      const exactResult = await pool.query(`
        SELECT 
          k.*,
          a.alias,
          a.confidence
        FROM kpi_nl_aliases a
        JOIN ericsson_kpi_descriptions k ON a.kpi_id = k.id
        WHERE LOWER(a.alias) = $1
        ORDER BY a.confidence DESC, k.metric
        LIMIT 10
      `, [cleanInput]);
      
      // If no exact match, try fuzzy match with full-text search
      if (exactResult.rows.length === 0) {
        const fuzzyResult = await pool.query(`
          SELECT 
            k.*,
            a.alias,
            a.confidence,
            ts_rank(a.tsv_alias, websearch_to_tsquery('english', $1)) as rank
          FROM kpi_nl_aliases a
          JOIN ericsson_kpi_descriptions k ON a.kpi_id = k.id
          WHERE a.tsv_alias @@ websearch_to_tsquery('english', $1)
          ORDER BY rank DESC, a.confidence DESC, k.metric
          LIMIT 10
        `, [cleanInput]);
        
        let matches: KPIMatch[] = fuzzyResult.rows.map(row => ({
          kpi: {
            id: row.id,
            metric: row.metric,
            vendor: row.vendor,
            db_counter_name: row.db_counter_name,
            description: row.description,
            category: row.category
          },
          alias: row.alias,
          confidence: parseFloat(row.confidence) * parseFloat(row.rank)
        }));

        if (matches.length === 0) {
          const csvMatches = await CsvRagResolverService.resolveKPI(cleanInput, 5);
          matches = await this.inflateKpiMatchesFromCanonical(csvMatches);
        }
        
        // Deduplicate by KPI ID
        const uniqueMatches = this.deduplicateKPIMatches(matches);
        
        return {
          matches: uniqueMatches,
          ambiguous: uniqueMatches.length > 1,
          resolved: uniqueMatches.length === 1 ? uniqueMatches[0] : undefined
        };
      }
      
      const matches: KPIMatch[] = exactResult.rows.map(row => ({
        kpi: {
          id: row.id,
          metric: row.metric,
          vendor: row.vendor,
          db_counter_name: row.db_counter_name,
          description: row.description,
          category: row.category
        },
        alias: row.alias,
        confidence: parseFloat(row.confidence)
      }));
      
      // Deduplicate by KPI ID
      const uniqueMatches = this.deduplicateKPIMatches(matches);
      
      return {
        matches: uniqueMatches,
        ambiguous: uniqueMatches.length > 1,
        resolved: uniqueMatches.length === 1 ? uniqueMatches[0] : undefined
      };
      
    } catch (error) {
      logger.error('Error resolving KPI, trying CSV fallback:', error);
      const csvMatches = await CsvRagResolverService.resolveKPI(nlInput, 5);
      const matches = await this.inflateKpiMatchesFromCanonical(csvMatches);
      const uniqueMatches = this.deduplicateKPIMatches(matches);
      return {
        matches: uniqueMatches,
        ambiguous: uniqueMatches.length > 1,
        resolved: uniqueMatches.length === 1 ? uniqueMatches[0] : undefined
      };
    }
  }
  
  /**
   * Resolve multiple inputs (for workflow generation)
   */
  static async resolveMultiple(inputs: { type: 'parameter' | 'kpi', text: string }[]): Promise<{
    parameters: Map<string, ResolveResult<ParameterMatch>>,
    kpis: Map<string, ResolveResult<KPIMatch>>
  }> {
    try {
      const parameters = new Map<string, ResolveResult<ParameterMatch>>();
      const kpis = new Map<string, ResolveResult<KPIMatch>>();
      
      for (const input of inputs) {
        if (input.type === 'parameter') {
          const result = await this.resolveParameter(input.text);
          parameters.set(input.text, result);
        } else {
          const result = await this.resolveKPI(input.text);
          kpis.set(input.text, result);
        }
      }
      
      return { parameters, kpis };
      
    } catch (error) {
      logger.error('Error resolving multiple inputs:', error);
      throw error;
    }
  }
  
  /**
   * Deduplicate parameter matches by ID, keeping highest confidence
   */
  private static deduplicateMatches(matches: ParameterMatch[]): ParameterMatch[] {
    const seen = new Map<number, ParameterMatch>();
    
    for (const match of matches) {
      const existing = seen.get(match.parameter.id);
      if (!existing || match.confidence > existing.confidence) {
        seen.set(match.parameter.id, match);
      }
    }
    
    return Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);
  }
  
  /**
   * Deduplicate KPI matches by ID, keeping highest confidence
   */
  private static deduplicateKPIMatches(matches: KPIMatch[]): KPIMatch[] {
    const seen = new Map<number, KPIMatch>();
    
    for (const match of matches) {
      const existing = seen.get(match.kpi.id);
      if (!existing || match.confidence > existing.confidence) {
        seen.set(match.kpi.id, match);
      }
    }
    
    return Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);
  }

  private static async inflateParameterMatchesFromCanonical(
    csvMatches: Array<{ canonical: string; alias: string; confidence: number }>
  ): Promise<ParameterMatch[]> {
    const out: ParameterMatch[] = [];
    for (const match of csvMatches) {
      try {
        const db = await pool.query(
          `SELECT id, model, mo_class, parameter_name, parameter_description, data_type, range_and_values, default_value, unit, read_only, mandatory
           FROM ericsson_parameters
           WHERE LOWER(parameter_name) = LOWER($1)
           LIMIT 1`,
          [match.canonical]
        );
        if (db.rows.length > 0) {
          const row = db.rows[0];
          out.push({
            parameter: {
              id: row.id,
              model: row.model,
              mo_class: row.mo_class,
              parameter_name: row.parameter_name,
              parameter_description: row.parameter_description,
              data_type: row.data_type,
              range_and_values: row.range_and_values,
              default_value: row.default_value,
              unit: row.unit,
              read_only: row.read_only,
              mandatory: row.mandatory,
            },
            alias: match.alias,
            confidence: match.confidence,
          });
          continue;
        }
      } catch {
        // DB unavailable; use CSV-only canonical result.
      }
      out.push({
        parameter: {
          id: -1,
          model: undefined,
          mo_class: undefined,
          parameter_name: match.canonical,
          parameter_description: undefined,
          data_type: undefined,
          range_and_values: undefined,
          default_value: undefined,
          unit: undefined,
          read_only: undefined,
          mandatory: undefined,
        },
        alias: match.alias,
        confidence: match.confidence,
      });
    }
    return out;
  }

  private static async inflateKpiMatchesFromCanonical(
    csvMatches: Array<{ canonical: string; alias: string; confidence: number }>
  ): Promise<KPIMatch[]> {
    const out: KPIMatch[] = [];
    for (const match of csvMatches) {
      try {
        const db = await pool.query(
          `SELECT id, metric, vendor, db_counter_name, description, category
           FROM ericsson_kpi_descriptions
           WHERE LOWER(metric) = LOWER($1) OR LOWER(db_counter_name) = LOWER($1)
           LIMIT 1`,
          [match.canonical]
        );
        if (db.rows.length > 0) {
          const row = db.rows[0];
          out.push({
            kpi: {
              id: row.id,
              metric: row.metric,
              vendor: row.vendor,
              db_counter_name: row.db_counter_name,
              description: row.description,
              category: row.category,
            },
            alias: match.alias,
            confidence: match.confidence,
          });
          continue;
        }
      } catch {
        // DB unavailable; use CSV-only canonical result.
      }
      out.push({
        kpi: {
          id: -1,
          metric: match.canonical,
          vendor: undefined,
          db_counter_name: match.canonical,
          description: undefined,
          category: undefined,
        },
        alias: match.alias,
        confidence: match.confidence,
      });
    }
    return out;
  }

  private static normalizeIdentifier(value: string): string {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }
}
