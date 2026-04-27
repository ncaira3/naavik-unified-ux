/**
 * Query Executor Service
 * Safely executes database queries with timeouts and limits
 */
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { QueryResult, AnalysisResult, ChartData } from '../types/index.js';

const MAX_QUERY_TIME_MS = parseInt(process.env.MAX_QUERY_TIME_MS || '30000');
const MAX_QUERY_ROWS = parseInt(process.env.MAX_QUERY_ROWS || '1000');

export interface AnalysisQuery {
  type: 'aggregate' | 'trend' | 'compare' | 'distribution';
  table: string;
  columns: string[];
  groupBy?: string;
  orderBy?: string;
  limit?: number;
  filters?: Record<string, any>;
}

export class QueryExecutorService {
  /**
   * Execute a SQL query with safety constraints
   */
  static async executeQuery(sql: string, params: any[] = []): Promise<QueryResult> {
    const startTime = Date.now();
    
    try {
      // Set statement timeout
      await pool.query(`SET statement_timeout = ${MAX_QUERY_TIME_MS}`);
      
      // Execute query
      const result = await pool.query(sql, params);
      
      const executionTime = Date.now() - startTime;
      const rowCount = result.rowCount || 0;
      
      // Enforce row limit
      const rows = result.rows.slice(0, MAX_QUERY_ROWS);
      
      if (rowCount > MAX_QUERY_ROWS) {
        logger.warn(`Query returned ${rowCount} rows, truncated to ${MAX_QUERY_ROWS}`);
      }
      
      logger.info(`Query executed in ${executionTime}ms, returned ${rowCount} rows`);
      
      return {
        rows,
        rowCount: Math.min(rowCount, MAX_QUERY_ROWS),
        executionTime,
        sql
      };
      
    } catch (error: any) {
      logger.error('Query execution failed', error);
      
      if (error.message?.includes('timeout')) {
        throw new Error(`Query exceeded timeout of ${MAX_QUERY_TIME_MS}ms`);
      }
      
      throw new Error(`Query execution failed: ${error.message}`);
    }
  }

  /**
   * Execute analysis query and return structured results with chart data
   */
  static async executeAnalysis(query: AnalysisQuery): Promise<AnalysisResult> {
    try {
      let sql = '';
      let chartData: ChartData | undefined;
      
      switch (query.type) {
        case 'aggregate':
          return await this.executeAggregate(query);
        case 'trend':
          return await this.executeTrend(query);
        case 'compare':
          return await this.executeCompare(query);
        case 'distribution':
          return await this.executeDistribution(query);
        default:
          throw new Error(`Unknown analysis type: ${query.type}`);
      }
    } catch (error: any) {
      logger.error('Analysis execution failed', error);
      throw new Error(`Analysis failed: ${error.message}`);
    }
  }

  /**
   * Execute aggregate analysis (COUNT, AVG, SUM, etc.)
   */
  private static async executeAggregate(query: AnalysisQuery): Promise<AnalysisResult> {
    const column = query.columns[0];
    
    const sql = `
      SELECT 
        COUNT(*) as count,
        AVG("${column}") as average,
        MIN("${column}") as minimum,
        MAX("${column}") as maximum,
        STDDEV("${column}") as std_deviation
      FROM ${query.table}
      ${this.buildWhereClause(query.filters)}
      LIMIT 1
    `;
    
    const result = await pool.query(sql);
    const stats = result.rows[0];
    
    return {
      summary: `Analysis of ${column}: Average ${parseFloat(stats.average).toFixed(2)}, Range ${parseFloat(stats.minimum).toFixed(2)}-${parseFloat(stats.maximum).toFixed(2)}`,
      statistics: {
        count: parseInt(stats.count),
        average: parseFloat(stats.average),
        minimum: parseFloat(stats.minimum),
        maximum: parseFloat(stats.maximum),
        stdDeviation: parseFloat(stats.std_deviation)
      },
      insights: [
        `Total records: ${stats.count}`,
        `Average value: ${parseFloat(stats.average).toFixed(2)}`,
        `Range: ${parseFloat(stats.minimum).toFixed(2)} to ${parseFloat(stats.maximum).toFixed(2)}`
      ]
    };
  }

  /**
   * Execute trend analysis (time series)
   */
  private static async executeTrend(query: AnalysisQuery): Promise<AnalysisResult> {
    const column = query.columns[0];
    const groupCol = query.groupBy || '"DateID"';
    
    const sql = `
      SELECT 
        ${groupCol} as label,
        AVG("${column}") as value,
        COUNT(*) as count
      FROM ${query.table}
      ${this.buildWhereClause(query.filters)}
      GROUP BY ${groupCol}
      ORDER BY ${groupCol}
      LIMIT ${query.limit || 100}
    `;
    
    const result = await pool.query(sql);
    
    const labels = result.rows.map(r => r.label);
    const values = result.rows.map(r => parseFloat(r.value));
    
    const chartData: ChartData = {
      type: 'line',
      labels,
      datasets: [{
        label: column,
        data: values,
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)'
      }]
    };
    
    return {
      summary: `Trend analysis of ${column} over time`,
      statistics: {
        dataPoints: result.rows.length,
        average: values.reduce((a, b) => a + b, 0) / values.length,
        min: Math.min(...values),
        max: Math.max(...values)
      },
      chartData,
      insights: [
        `Analyzed ${result.rows.length} time periods`,
        `Average: ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)}`,
        `Peak: ${Math.max(...values).toFixed(2)}`,
        `Lowest: ${Math.min(...values).toFixed(2)}`
      ]
    };
  }

  /**
   * Execute comparison analysis (top N, rankings)
   */
  private static async executeCompare(query: AnalysisQuery): Promise<AnalysisResult> {
    const column = query.columns[0];
    const orderCol = query.orderBy || column;
    
    const sql = `
      SELECT 
        "SiteName",
        "${column}" as value
      FROM ${query.table}
      ${this.buildWhereClause(query.filters)}
      ORDER BY "${orderCol}" DESC
      LIMIT ${query.limit || 10}
    `;
    
    const result = await pool.query(sql);
    
    const labels = result.rows.map(r => r.SiteName || r.sitename);
    const values = result.rows.map(r => parseFloat(r.value));
    
    const chartData: ChartData = {
      type: 'bar',
      labels,
      datasets: [{
        label: column,
        data: values,
        backgroundColor: '#3B82F6'
      }]
    };
    
    return {
      summary: `Top ${result.rows.length} sites by ${column}`,
      statistics: {
        total: result.rows.length,
        highest: values[0],
        lowest: values[values.length - 1]
      },
      chartData,
      insights: result.rows.map((r, i) => 
        `${i + 1}. ${r.SiteName || r.sitename}: ${parseFloat(r.value).toFixed(2)}`
      ).slice(0, 5)
    };
  }

  /**
   * Execute distribution analysis
   */
  private static async executeDistribution(query: AnalysisQuery): Promise<AnalysisResult> {
    const column = query.columns[0];
    
    const sql = `
      SELECT 
        "${column}" as value,
        COUNT(*) as count
      FROM ${query.table}
      ${this.buildWhereClause(query.filters)}
      GROUP BY "${column}"
      ORDER BY count DESC
      LIMIT ${query.limit || 10}
    `;
    
    const result = await pool.query(sql);
    
    const labels = result.rows.map(r => String(r.value));
    const values = result.rows.map(r => parseInt(r.count));
    
    const chartData: ChartData = {
      type: 'pie',
      labels,
      datasets: [{
        label: 'Distribution',
        data: values,
        backgroundColor: [
          '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
          '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16'
        ]
      }]
    };
    
    const total = values.reduce((a, b) => a + b, 0);
    
    return {
      summary: `Distribution of ${column}`,
      statistics: {
        total,
        categories: result.rows.length
      },
      chartData,
      insights: result.rows.map(r => 
        `${r.value}: ${r.count} (${((r.count / total) * 100).toFixed(1)}%)`
      )
    };
  }

  /**
   * Build WHERE clause from filters
   */
  private static buildWhereClause(filters?: Record<string, any>): string {
    if (!filters || Object.keys(filters).length === 0) {
      return '';
    }
    
    const conditions = Object.entries(filters)
      .map(([key, value]) => {
        if (typeof value === 'string') {
          return `"${key}" = '${value}'`;
        } else if (typeof value === 'number') {
          return `"${key}" = ${value}`;
        } else if (typeof value === 'boolean') {
          return `"${key}" = ${value}`;
        }
        return null;
      })
      .filter(c => c !== null);
    
    return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  }

  /**
   * Export query results to CSV format
   */
  static exportToCSV(queryResult: QueryResult): string {
    if (queryResult.rows.length === 0) {
      return '';
    }
    
    // Get column names
    const columns = Object.keys(queryResult.rows[0]);
    
    // Create CSV header
    const header = columns.join(',');
    
    // Create CSV rows
    const rows = queryResult.rows.map(row => 
      columns.map(col => {
        const value = row[col];
        // Escape quotes and wrap in quotes if contains comma
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',')
    );
    
    return [header, ...rows].join('\n');
  }
}
