/**
 * Automation Pipeline Service
 * Implements the intent → report → action flow
 */
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database.js';
import { openai } from '../config/openai.js';
import { logger } from '../utils/logger.js';
import { getENMConnector } from './enm-connector.service.js';
import { GeneratedAppModel } from '../models/generated-app.model.js';

export interface IntentAnalysis {
  intent: string;
  category: 'network_health' | 'performance' | 'capacity' | 'quality' | 'app_execution' | 'custom';
  entities: string[];
  scope: 'all' | 'specific' | 'region';
  focus: 'problems' | 'optimization' | 'reporting';
  dataNeeded: string[];
}

export interface ReportData {
  type: string;
  summary: {
    [key: string]: any;
  };
  details: {
    [key: string]: any[];
  };
  visualizations?: {
    [key: string]: any;
  };
}

export interface ActionButton {
  actionId: string;
  actionName: string;
  label: string;
  style: 'primary' | 'secondary' | 'warning' | 'danger';
  icon?: string;
  appId?: string;
  context: any;
  estimatedDuration?: number;
  riskLevel?: 'low' | 'medium' | 'high';
}

export interface PipelineResult {
  analysisId: string;
  intent: IntentAnalysis;
  report: ReportData;
  actions: ActionButton[];
  timestamp: Date;
}

export interface ExecutionResult {
  executionId: string;
  success: boolean;
  message: string;
  affectedSites: number;
  affectedCells: number;
  results: any[];
  duration: number;
}

export class AutomationPipelineService {
  private static parseJsonObjectFromText(content: string): Record<string, any> | null {
    const text = String(content || '').trim();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      // Continue with extraction fallback
    }

    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      try {
        return JSON.parse(fencedMatch[1]);
      } catch {
        // Continue with object extraction fallback
      }
    }

    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }

    return null;
  }

  private static normalizeIntent(intent: IntentAnalysis, query: string): IntentAnalysis {
    const safeIntent: IntentAnalysis = {
      ...intent,
      entities: Array.isArray(intent.entities) ? intent.entities : ['Site', 'Cell'],
      dataNeeded: Array.isArray(intent.dataNeeded) ? [...intent.dataNeeded] : [],
    };

    const lower = query.toLowerCase();
    const ensureData = (items: string[]) => {
      items.forEach((item) => {
        if (!safeIntent.dataNeeded.includes(item)) safeIntent.dataNeeded.push(item);
      });
    };

    if (safeIntent.category === 'network_health' || safeIntent.focus === 'problems') {
      ensureData(['outages', 'congestion', 'anomalies']);
    }
    if (safeIntent.category === 'capacity') {
      ensureData(['congestion', 'anomalies']);
    }
    if (
      lower.includes('degraded') ||
      lower.includes('offender') ||
      lower.includes('outage') ||
      lower.includes('congest') ||
      lower.includes('network health')
    ) {
      ensureData(['outages', 'congestion', 'anomalies']);
      if (!safeIntent.category || safeIntent.category === 'custom') {
        safeIntent.category = 'network_health';
      }
      if (!safeIntent.focus || safeIntent.focus === 'reporting') {
        safeIntent.focus = 'problems';
      }
    }

    return safeIntent;
  }

  /**
   * Main pipeline: Natural Language → Analysis → Report → Actions
   */
  static async processIntent(nlQuery: string, userId?: string, reportDate?: string): Promise<PipelineResult> {
    logger.info(`Processing intent: "${nlQuery}"`);
    
    try {
      // Step 1: Analyze intent
      const intent = await this.analyzeIntent(nlQuery);
      logger.info(`Intent analyzed: ${intent.intent} (${intent.category})`);
      
      // Step 2: Generate report based on intent
      const report = await this.generateReport(intent, reportDate, nlQuery);
      logger.info(`Report generated with ${Object.keys(report.details).length} detail sections`);
      
      // Step 3: Identify actionable solutions
      const actions = await this.identifyActions(report, intent);
      logger.info(`Identified ${actions.length} possible actions`);

      const resolvedDate = String(report.summary?.resolvedDate || report.summary?.reportDate || '');
      const totalSites = Number(report.summary?.totalSites || 0);
      const outageSites = Number(report.summary?.outageSites || 0);
      const congestedSites = Number(report.summary?.congestedSites || 0);
      const mapSitesCount = Array.isArray(report.details?.mapSites) ? report.details.mapSites.length : 0;
      const fallbackUsed = Boolean(report.summary?.fallbackMapBackfillUsed || false);
      logger.info(
        `[ObserveTelemetry] input_intent="${intent.intent}" resolved_date="${resolvedDate}" total_sites=${totalSites} outage_sites=${outageSites} congested_sites=${congestedSites} map_sites_count=${mapSitesCount} fallback_used=${fallbackUsed}`
      );
      if (totalSites > 0 && mapSitesCount === 0) {
        logger.warn(
          `[ObserveTelemetry] Inconsistent report: total_sites=${totalSites} but map_sites_count=0 (intent="${intent.intent}", date="${resolvedDate}")`
        );
      }
      
      const result: PipelineResult = {
        analysisId: uuidv4(),
        intent,
        report,
        actions,
        timestamp: new Date()
      };
      
      return result;
      
    } catch (error) {
      logger.error('Pipeline processing failed', error);
      throw error;
    }
  }
  
  /**
   * Step 1: Analyze user intent
   */
  private static async analyzeIntent(query: string): Promise<IntentAnalysis> {
    // Try OpenAI first
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy-key') {
      try {
        const completion = await openai.chat.completions.create({
          model: process.env.OPENAI_AGENT_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
          messages: [{
            role: 'system',
            content: `Analyze network management intent. Identify: problem type, entities affected, data needed, potential solutions.
            
            Respond with JSON only:
            {
              "intent": "brief intent description",
              "category": "network_health | performance | capacity | quality | app_execution | custom",
              "entities": ["EUtranCell", "Site"],
              "scope": "all | specific | region",
              "focus": "problems | optimization | reporting",
              "dataNeeded": ["outages", "congestion", "kpis"]
            }`
          }, {
            role: 'user',
            content: query
          }],
          temperature: 0.3
        });
        
        const content = completion.choices[0].message.content;
        if (content) {
          const parsed = this.parseJsonObjectFromText(content);
          if (parsed) {
            return this.normalizeIntent(parsed as IntentAnalysis, query);
          }
        }
      } catch (error) {
        logger.warn('OpenAI intent analysis failed, using fallback', error);
      }
    }
    
    // Fallback: Rule-based intent parsing
    return this.normalizeIntent(this.analyzeIntentFallback(query), query);
  }
  
  /**
   * Fallback intent analysis using pattern matching
   */
  private static analyzeIntentFallback(query: string): IntentAnalysis {
    const lower = query.toLowerCase();
    
    // Determine category
    let category: IntentAnalysis['category'] = 'custom';
    let focus: IntentAnalysis['focus'] = 'reporting';
    let dataNeeded: string[] = [];
    
    if (lower.includes('wrong') || lower.includes('problem') || lower.includes('issue') || lower.includes('outage')) {
      category = 'network_health';
      focus = 'problems';
      dataNeeded = ['outages', 'anomalies', 'congestion'];
    } else if (lower.includes('optimize') || lower.includes('improve') || lower.includes('better')) {
      category = 'performance';
      focus = 'optimization';
      dataNeeded = ['kpis', 'congestion', 'parameters'];
    } else if (lower.includes('capacity') || lower.includes('congestion') || lower.includes('overload')) {
      category = 'capacity';
      focus = 'problems';
      dataNeeded = ['congestion', 'utilization'];
    } else if (lower.includes('run') || lower.includes('execute') || lower.includes('app')) {
      category = 'app_execution';
      focus = 'optimization';
      dataNeeded = ['apps'];
    }
    
    return {
      intent: query,
      category,
      entities: ['Site', 'Cell'],
      scope: 'all',
      focus,
      dataNeeded
    };
  }
  
  /**
   * Step 2: Generate report based on intent
   */
  private static async resolveLatestDate(client: any): Promise<string | null> {
    const latestDateResult = await client.query(`
      SELECT CAST(MAX(CAST("DateID" AS DATE)) AS TEXT) AS latest_date
      FROM filtered_sites
    `);
    const latestDate = String(latestDateResult.rows?.[0]?.latest_date || '').slice(0, 10);
    return latestDate || null;
  }

  private static async generateReport(intent: IntentAnalysis, reportDate?: string, nlQuery?: string): Promise<ReportData> {
    const client = await pool.connect();
    
    try {
      let report: ReportData = {
        type: intent.category,
        summary: {},
        details: {}
      };
      const requestedDate = reportDate && String(reportDate).trim() ? String(reportDate).trim() : null;
      const resolvedDate = requestedDate || (await this.resolveLatestDate(client));
      const dateFilter = resolvedDate ? `AND CAST("DateID" AS DATE) = CAST($1 AS DATE)` : '';
      const params = resolvedDate ? [resolvedDate] : [];
      
      // Query data based on intent
      if (intent.dataNeeded.includes('outages')) {
        // Get outage sites
        const outagesResult = await client.query(`
          SELECT
            "SiteID" as site_id,
            "SiteName" as site_name,
            "AnomalyScore" as anomaly_score,
            "AnomalyFlag" as anomaly_flag,
            "Latitude" as latitude,
            "Longitude" as longitude,
            "DateID" as date_id
          FROM filtered_sites
          WHERE COALESCE("AnomalyScore", 0) >= 0.95
          ${dateFilter}
          ORDER BY COALESCE("AnomalyScore", 0) DESC
          LIMIT 50
        `, params);
        
        report.details.outages = outagesResult.rows.map(row => ({
          siteId: row.site_id,
          siteName: row.site_name,
          anomalyScore: row.anomaly_score,
          status: 'OUTAGE',
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          dateId: row.date_id,
        }));
        report.summary.outageSites = outagesResult.rowCount || 0;
      }
      
      if (intent.dataNeeded.includes('congestion') || intent.dataNeeded.includes('anomalies')) {
        // Get congested/anomalous sites
        const congestedResult = await client.query(`
          SELECT
            "SiteID" as site_id,
            "SiteName" as site_name,
            "AnomalyScore" as anomaly_score,
            "AnomalyFlag" as anomaly_flag,
            "Latitude" as latitude,
            "Longitude" as longitude,
            "DateID" as date_id
          FROM filtered_sites
          WHERE COALESCE("AnomalyScore", 0) >= 0.75 AND COALESCE("AnomalyScore", 0) < 0.95
          ${dateFilter}
          ORDER BY COALESCE("AnomalyScore", 0) DESC
          LIMIT 100
        `, params);
        
        report.details.congested = congestedResult.rows.map(row => ({
          siteId: row.site_id,
          siteName: row.site_name,
          anomalyScore: row.anomaly_score,
            status: Number(row.anomaly_score) >= 0.85 ? 'CRITICAL' : 'WARNING',
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            dateId: row.date_id,
          }));
        report.summary.congestedSites = congestedResult.rowCount || 0;
      }

      // Baseline healthy sites for inset map context
      const healthyResult = await client.query(`
        SELECT
          "SiteID" as site_id,
          "SiteName" as site_name,
          "AnomalyScore" as anomaly_score,
          "Latitude" as latitude,
          "Longitude" as longitude,
          "DateID" as date_id
        FROM filtered_sites
        WHERE COALESCE("AnomalyScore", 0) < 0.75
        ${dateFilter}
        ORDER BY COALESCE("AnomalyScore", 0) DESC
        LIMIT 220
      `, params);
      report.details.healthy = healthyResult.rows.map(row => ({
        siteId: row.site_id,
        siteName: row.site_name,
        anomalyScore: row.anomaly_score,
        status: 'NORMAL',
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        dateId: row.date_id,
      }));
      
      // Get total sites count (from filtered data)
      const totalSitesResult = await client.query(
        `SELECT COUNT(DISTINCT "SiteID") as count
         FROM filtered_sites
         WHERE 1=1
         ${resolvedDate ? 'AND CAST("DateID" AS DATE) = CAST($1 AS DATE)' : ''}`,
        params
      );
      report.summary.totalSites = parseInt(totalSitesResult.rows[0].count);
      if (resolvedDate) {
        report.summary.reportDate = resolvedDate;
        report.summary.resolvedDate = resolvedDate;
      }
      
      // Get affected cells count
      if (report.details.congested || report.details.outages) {
        const affectedSites = [
          ...(report.details.congested || []).map((s: any) => s.siteId),
          ...(report.details.outages || []).map((s: any) => s.siteId)
        ];
        
        if (affectedSites.length > 0) {
          const cellsResult = await client.query(
            `SELECT COUNT(*) as count
             FROM cell_table
             WHERE "SiteID" = ANY($1::text[])`,
            [affectedSites]
          );
          report.summary.affectedCells = parseInt(cellsResult.rows[0].count);
        }
      }

      const outages = (report.details.outages || []) as any[];
      const congested = (report.details.congested || []) as any[];
      const healthy = (report.details.healthy || []) as any[];
      const candidateSites = [...outages, ...congested, ...healthy];
      const dedup = new Set<string>();
      report.details.mapSites = candidateSites
        .filter((s) => {
          if (!s?.siteId || dedup.has(s.siteId)) return false;
          dedup.add(s.siteId);
          return Number.isFinite(s.latitude) && Number.isFinite(s.longitude);
        })
        .slice(0, 260)
        .map((s) => ({
          siteId: s.siteId,
          siteName: s.siteName,
          latitude: s.latitude,
          longitude: s.longitude,
          status: s.status,
          anomalyCount: s.status === 'NORMAL' ? 0 : 1,
          hasActiveTickets: s.status !== 'NORMAL',
          cellCount: 0,
        }));

      if (!Array.isArray(report.details.mapSites) || report.details.mapSites.length === 0) {
        const baselineResult = await client.query(
          `
          SELECT DISTINCT ON ("SiteID")
            "SiteID" as site_id,
            "SiteName" as site_name,
            "Latitude" as latitude,
            "Longitude" as longitude,
            "DateID" as date_id
          FROM filtered_sites
          WHERE "Latitude" IS NOT NULL
            AND "Longitude" IS NOT NULL
            ${resolvedDate ? 'AND CAST("DateID" AS DATE) = CAST($1 AS DATE)' : ''}
          ORDER BY "SiteID", "DateID" DESC
          LIMIT 260
          `,
          params
        );
        report.details.mapSites = (baselineResult.rows || [])
          .map((row: any) => ({
            siteId: row.site_id,
            siteName: row.site_name,
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            status: 'NORMAL',
            anomalyCount: 0,
            hasActiveTickets: false,
            cellCount: 0,
            dateId: row.date_id,
          }))
          .filter((s: any) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
        report.summary.fallbackMapBackfillUsed = true;
      } else {
        report.summary.fallbackMapBackfillUsed = false;
      }

      const tableRows = [...outages, ...congested]
        .sort((a, b) => Number(b.anomalyScore || 0) - Number(a.anomalyScore || 0))
        .slice(0, 50)
        .map((s) => {
        const possibleRca = s.status === 'OUTAGE'
          ? 'Outage/Transport'
          : s.status === 'CRITICAL'
            ? 'Congestion'
            : 'Mobility/Interference';
        const action = s.status === 'OUTAGE' ? 'Outage Resolution' : 'Change Parameter';
        return {
          siteId: s.siteId,
          date: s.dateId || '-',
          estSuperKpiImpactDelta: Number(s.anomalyScore || 0).toFixed(4),
          possibleRca,
          action,
        };
      });
      report.details.tableRows = tableRows;
      const lowerIntentText = String(nlQuery || intent.intent || '').toLowerCase();
      const isDegradedIntent =
        lowerIntentText.includes('degraded') ||
        lowerIntentText.includes('offender') ||
        lowerIntentText.includes('outage') ||
        lowerIntentText.includes('congest');
      if (isDegradedIntent && outages.length + congested.length === 0 && resolvedDate) {
        report.summary.noDegradedForDate = true;
      }
      report.summary.topIssue = outages.length > 0
        ? 'Outage risk dominates current anomaly set.'
        : congested.length > 0
          ? 'Congestion is the primary observed issue.'
          : 'No major outage or congestion spikes detected.';
      
      return report;
      
    } finally {
      client.release();
    }
  }
  
  /**
   * Step 3: Identify actionable solutions
   */
  private static async identifyActions(report: ReportData, intent: IntentAnalysis): Promise<ActionButton[]> {
    const actions: ActionButton[] = [];
    
    // If outages exist, offer uptilt action
    if (report.details.outages && report.details.outages.length > 0) {
      actions.push({
        actionId: uuidv4(),
        actionName: 'uptilt_around_outages',
        label: `Uptilt sectors around ${report.details.outages.length} outages`,
        style: 'primary',
        icon: 'ArrowUp',
        context: {
          outageSiteIds: report.details.outages.map((s: any) => s.siteId),
          action: 'uptilt'
        },
        estimatedDuration: 5,
        riskLevel: 'medium'
      });
    }
    
    // If congestion exists, offer optimization action
    if (report.details.congested && report.details.congested.length > 0) {
      actions.push({
        actionId: uuidv4(),
        actionName: 'optimize_congested_cells',
        label: `Optimize ${report.details.congested.length} congested sites`,
        style: 'warning',
        icon: 'Zap',
        context: {
          siteIds: report.details.congested.map((s: any) => s.siteId),
          kpi: 'dl_prb_utilization'
        },
        estimatedDuration: 10,
        riskLevel: 'medium'
      });
    }
    
    return actions;
  }
  
  /**
   * Step 4: Execute action
   */
  static async executeAction(
    actionId: string,
    actionName: string,
    context: any,
    userId?: string
  ): Promise<ExecutionResult> {
    logger.info(`Executing action: ${actionName}`);
    
    const startTime = Date.now();
    const executionId = uuidv4();
    
    try {
      let result: ExecutionResult;
      
      switch (actionName) {
        case 'uptilt_around_outages':
          result = await this.executeUptiltAction(executionId, context, userId);
          break;
          
        case 'optimize_congested_cells':
          result = await this.executeOptimizationAction(executionId, context, userId);
          break;
          
        case 'generate_rca_report':
          result = await this.executeRCAReportAction(executionId, context, userId);
          break;
          
        default:
          throw new Error(`Unknown action: ${actionName}`);
      }
      
      const duration = Date.now() - startTime;
      result.duration = duration;
      
      // Log execution
      await this.logExecution(executionId, {
        actionName,
        context,
        result,
        userId
      });
      
      return result;
      
    } catch (error: any) {
      logger.error(`Action execution failed: ${actionName}`, error);
      
      const duration = Date.now() - startTime;
      const errorResult: ExecutionResult = {
        executionId,
        success: false,
        message: `Failed to execute ${actionName}: ${error.message}`,
        affectedSites: 0,
        affectedCells: 0,
        results: [],
        duration
      };
      
      await this.logExecution(executionId, {
        actionName,
        context,
        result: errorResult,
        userId,
        error: error.message
      });
      
      return errorResult;
    }
  }
  
  /**
   * Execute uptilt action around outages
   */
  private static async executeUptiltAction(
    executionId: string,
    context: any,
    userId?: string
  ): Promise<ExecutionResult> {
    const enm = getENMConnector();
    await enm.connect();
    
    // Get cells around outage sites
    const client = await pool.connect();
    try {
      const sitesResult = await client.query(
        `SELECT DISTINCT "SiteID"
         FROM cell_table
         WHERE "SiteID" = ANY($1::text[])
         LIMIT 50`,
        [context.outageSiteIds]
      );

      const siteIds = sitesResult.rows.map(r => r.SiteID);
      
      // Simulate uptilt by adjusting antenna tilt parameter per site
      const results = [];
      for (const siteId of siteIds) {
        try {
          await enm.setParameter(siteId, 'EUtranCellFDD', 'antennaDowntilt', 5, executionId);
          results.push({ siteId, success: true });
        } catch (error: any) {
          results.push({ siteId, success: false, error: error.message });
        }
      }

      const successCount = results.filter(r => r.success).length;

      return {
        executionId,
        success: successCount > 0,
        message: `Uptilt applied to ${successCount} of ${siteIds.length} sites`,
        affectedSites: context.outageSiteIds.length,
        affectedCells: successCount,
        results,
        duration: 0 // Will be set by caller
      };
      
    } finally {
      client.release();
    }
  }
  
  /**
   * Execute optimization action for congested cells
   */
  private static async executeOptimizationAction(
    executionId: string,
    context: any,
    userId?: string
  ): Promise<ExecutionResult> {
    const enm = getENMConnector();
    await enm.connect();
    
    const client = await pool.connect();
    try {
      // Get congested sites (distinct SiteIDs with high anomaly score)
      const sitesResult = await client.query(
        `SELECT DISTINCT "SiteID"
         FROM cell_table
         WHERE "SiteID" = ANY($1::text[])
         AND "AnomalyScore" >= 0.75
         LIMIT 100`,
        [context.siteIds]
      );

      const siteIds = sitesResult.rows.map(r => r.SiteID);

      // Optimize by adjusting qRxLevMin parameter per site
      const results = [];
      for (const siteId of siteIds) {
        try {
          await enm.setParameter(siteId, 'EUtranCellFDD', 'qRxLevMin', -115, executionId);
          results.push({ siteId, success: true });
        } catch (error: any) {
          results.push({ siteId, success: false, error: error.message });
        }
      }

      const successCount = results.filter(r => r.success).length;

      return {
        executionId,
        success: successCount > 0,
        message: `Optimization applied to ${successCount} of ${siteIds.length} sites`,
        affectedSites: context.siteIds.length,
        affectedCells: successCount,
        results,
        duration: 0
      };
      
    } finally {
      client.release();
    }
  }
  
  /**
   * Execute RCA report generation
   */
  private static async executeRCAReportAction(
    executionId: string,
    context: any,
    userId?: string
  ): Promise<ExecutionResult> {
    // For now, just return success with summary data
    return {
      executionId,
      success: true,
      message: `RCA report generated for ${context.includeSites?.length || 0} sites`,
      affectedSites: context.includeSites?.length || 0,
      affectedCells: 0,
      results: [{
        reportType: 'RCA',
        sites: context.includeSites,
        generated: true
      }],
      duration: 0
    };
  }
  
  /**
   * Log execution to database
   */
  private static async logExecution(executionId: string, data: any): Promise<void> {
    const client = await pool.connect();
    
    try {
      await client.query(
        `INSERT INTO automation_execution_log (
          execution_id, execution_type, triggered_by, trigger_source,
          execution_status, report_data, duration_ms,
          success_count, failure_count, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          executionId,
          'manual',
          data.userId || 'system',
          'chat',
          data.result?.success ? 'completed' : 'failed',
          JSON.stringify({
            action: data.actionName,
            context: data.context,
            result: data.result
          }),
          data.result?.duration || 0,
          data.result?.affectedCells || 0,
          data.error ? 1 : 0
        ]
      );
      
      logger.info(`Execution logged: ${executionId}`);
      
    } catch (error) {
      logger.error('Failed to log execution', error);
    } finally {
      client.release();
    }
  }
}
