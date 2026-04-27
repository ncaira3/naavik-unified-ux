/**
 * KPI Model - Database queries for KPI metrics
 * Now uses remote database connector for real-time data
 */
import { pool } from '../config/database.js';
import { KPIData } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { NaavikDBConnector } from '../services/naavik-db-connector.service.js';
import { siteIdMapper } from '../services/site-id-mapper.service.js';
import { dataAnonymizer } from '../services/data-anonymizer.service.js';
import { cacheOrFetch } from '../utils/cache.js';
import { kpiDataAdapter, COMMON_KPI_NAMES, type KpiBundle } from '../services/kpi-data-adapter.service.js';

export interface KPITimeSeriesPoint {
  dateId: string;
  hourId?: number;
  value: number;
  anomalyFlag: boolean;
  anomalyScore: number;
}

export interface KPIAggregate {
  avg: number;
  min: number;
  max: number;
  count: number;
}

export interface KPIQueryResult {
  siteId: string;
  cellName?: string;
  kpiName: string;
  timeSeries: KPITimeSeriesPoint[];
  aggregate: KPIAggregate;
}

export class KPIModel {
  private static dbConnector: NaavikDBConnector;
  private static initialized: boolean = false;

  /**
   * Initialize the KPI model with remote data services
   */
  static async initialize(): Promise<void> {
    if (this.initialized) {
      logger.info('⚠️ KPIModel already initialized');
      return;
    }

    try {
      logger.info('🔄 Initializing KPIModel with remote data services...');
      
      // Initialize site mapper
      await siteIdMapper.initialize();
      
      // Initialize DB connector
      this.dbConnector = new NaavikDBConnector();
      
      // Test connection
      await this.dbConnector.testConnection();
      
      this.initialized = true;
      logger.info('✅ KPIModel initialized successfully');
    } catch (error: any) {
      logger.error('❌ Failed to initialize KPIModel:', error.message);
      throw error;
    }
  }

  /**
   * Get KPI time series for a site with hourly granularity.
   * Fetches from remote database using real USID, returns anonymized data
   * @param days - Number of days from latest date. If <= 0, defaults to 7.
   *               When endDateInput is provided, this is ignored and a strict
   *               48-hour window is used (endDate + previous day).
   */
  static async getKPITimeSeriesHourly(
    siteId: string,
    kpiName: string,
    days: number = 7,
    endDateInput?: string
  ): Promise<KPIQueryResult | null> {
    // Map dummy site ID to real USID
    const realUSID = siteIdMapper.getRealUSID(siteId);
    if (!realUSID) {
      logger.error(`❌ No real USID found for dummy site ID: ${siteId}`);
      return null;
    }

    // Calculate date range
    const parsedEndDate = endDateInput ? new Date(endDateInput) : new Date();
    const endDate = Number.isNaN(parsedEndDate.getTime()) ? new Date() : parsedEndDate;
    const startDate = new Date(endDate);
    const effectiveDays = endDateInput ? 1 : (days > 0 ? Math.min(days, 7) : 7);
    startDate.setDate(endDate.getDate() - effectiveDays);

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Cache key
    const cacheKey = `realdata:${siteId}:${kpiName}:hourly:${effectiveDays}:${endDateStr}`;
    const cacheTTL = parseInt(process.env.KPI_CACHE_TTL || '300'); // 5 minutes

    return cacheOrFetch(
      cacheKey,
      async () => {
        logger.info(`🔍 Fetching hourly KPI data from remote DB: ${siteId} (${realUSID.substring(0, 20)}...) → ${kpiName}`);
        
        // Fetch from remote DB
        const rawData = await this.dbConnector.fetchHourlyKPIs(
          realUSID,
          startDateStr,
          endDateStr,
          [kpiName]
        );

        if (!rawData || rawData.length === 0) {
          logger.warn(`⚠️ No hourly data found for ${siteId} / ${kpiName}`);
          return null;
        }

        // Anonymize cell names
        const anonymizedData = dataAnonymizer.anonymizeKPIData(rawData);

        // Group by date and hour, calculate averages
        const grouped = new Map<string, KPITimeSeriesPoint>();
        
        anonymizedData.forEach(row => {
          const key = `${row.DATE_ID}_${row.HOUR_ID}`;
          
          if (!grouped.has(key)) {
            grouped.set(key, {
              dateId: row.DATE_ID,
              hourId: row.HOUR_ID,
              value: row.kpi_value || 0,
              anomalyFlag: false,
              anomalyScore: 0,
            });
          }
        });

        const timeSeries = Array.from(grouped.values()).sort((a, b) => {
          if (a.dateId !== b.dateId) {
            return a.dateId.localeCompare(b.dateId);
          }
          return (a.hourId || 0) - (b.hourId || 0);
        });

        // Calculate aggregates
        const values = timeSeries.map(t => t.value).filter(v => !isNaN(v) && v !== null);
        
        if (values.length === 0) {
          return null;
        }

        const aggregate: KPIAggregate = {
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          count: values.length,
        };

        logger.info(`✅ Processed ${timeSeries.length} hourly data points for ${siteId}`);

        return {
          siteId,
          kpiName,
          timeSeries,
          aggregate,
        };
      },
      cacheTTL
    );
  }

  /**
   * Get KPI time series for a site (daily granularity).
   * Fetches from remote database using real USID, returns anonymized data
   * @param days - Number of days from latest date. If <= 0, defaults to 14.
   */
  static async getKPITimeSeries(
    siteId: string,
    kpiName: string,
    days: number = 7,
    granularity: 'daily' | 'hourly' = 'daily',
    endDateInput?: string
  ): Promise<KPIQueryResult | null> {
    // Route to hourly method if requested
    if (granularity === 'hourly') {
      return this.getKPITimeSeriesHourly(siteId, kpiName, days, endDateInput);
    }

    // Map dummy site ID to real USID (needed for fallback path)
    const realUSID = siteIdMapper.getRealUSID(siteId);
    if (!realUSID) {
      logger.error(`❌ No real USID found for dummy site ID: ${siteId}`);
      return null;
    }

    // ── Fast path: serve from adapter bundle cache ──────────────────────────
    // The adapter fetches ALL KPIs for the site in one DB call and caches them.
    // Subsequent requests for the same site+date hit memory instantly.
    const parsedEndDate = endDateInput ? new Date(endDateInput) : new Date();
    const endDate = Number.isNaN(parsedEndDate.getTime()) ? new Date() : parsedEndDate;
    const endDateStr = endDate.toISOString().slice(0, 10);

    // Only use adapter for KPIs it covers; unknown KPIs fall through to direct fetch
    if (COMMON_KPI_NAMES.includes(kpiName)) {
      try {
        const result = await kpiDataAdapter.getKpi(siteId, kpiName, endDateStr, 'daily');
        if (result) {
          return { ...result, siteId };
        }
      } catch (adapterErr: any) {
        logger.warn(`KpiAdapter miss for ${siteId}/${kpiName}, falling back: ${adapterErr.message}`);
      }
    }

    // ── Fallback: direct per-KPI DB call (for non-common KPIs or adapter failure) ─
    const startDate = new Date(endDate);
    const effectiveDays = endDateInput ? 30 : (days > 0 ? Math.min(days, 90) : 14);
    startDate.setDate(endDate.getDate() - effectiveDays);

    const startDateStr = startDate.toISOString().split('T')[0];
    const cacheKey = `realdata:${siteId}:${kpiName}:daily:${effectiveDays}:${endDateStr}`;
    const cacheTTL = parseInt(process.env.KPI_CACHE_TTL || '300');

    return cacheOrFetch(
      cacheKey,
      async () => {
        logger.info(`🔍 Fetching daily KPI data (direct) for ${siteId} → ${kpiName}`);
        const rawData = await this.dbConnector.fetchDailyKPIs(realUSID, startDateStr, endDateStr, [kpiName]);

        if (!rawData || rawData.length === 0) {
          logger.warn(`⚠️ No daily data found for ${siteId} / ${kpiName}`);
          return null;
        }

        const anonymizedData = dataAnonymizer.anonymizeKPIData(rawData);
        const grouped = new Map<string, KPITimeSeriesPoint>();

        anonymizedData.forEach(row => {
          const dateKey = row.DATE_ID;
          if (!grouped.has(dateKey)) {
            grouped.set(dateKey, { dateId: dateKey, value: row.kpi_value || 0, anomalyFlag: false, anomalyScore: 0 });
          } else {
            const existing = grouped.get(dateKey)!;
            existing.value = (existing.value + (row.kpi_value || 0)) / 2;
          }
        });

        const timeSeries = Array.from(grouped.values()).sort((a, b) => a.dateId.localeCompare(b.dateId));
        const values = timeSeries.map(t => t.value).filter(v => !isNaN(v));
        if (values.length === 0) return null;

        return {
          siteId,
          kpiName,
          timeSeries,
          aggregate: {
            avg: values.reduce((a, b) => a + b, 0) / values.length,
            min: Math.min(...values),
            max: Math.max(...values),
            count: values.length,
          },
        };
      },
      cacheTTL
    );
  }

  /**
   * Fetch all common KPIs for a site in one shot (used by batch endpoint).
   */
  static async getKPIBatch(
    siteId: string,
    endDateInput?: string,
    granularity: 'daily' | 'hourly' = 'daily'
  ): Promise<KpiBundle> {
    const end = endDateInput ? new Date(endDateInput) : new Date();
    const endDateStr = (isNaN(end.getTime()) ? new Date() : end).toISOString().slice(0, 10);
    const bundle = await kpiDataAdapter.getBundle(siteId, endDateStr, granularity);
    // Stamp siteId into each result
    return Object.fromEntries(
      Object.entries(bundle).map(([k, v]) => [k, { ...v, siteId }])
    );
  }

  /**
   * Get the date range of KPI data in the database (all sites).
   * Returns min date, max date, and count of distinct days.
   */
  static async getKPIDateRange(): Promise<{
    minDate: string;
    maxDate: string;
    distinctDays: number;
  } | null> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT 
          MIN("DateID")::text as min_date,
          MAX("DateID")::text as max_date,
          COUNT(DISTINCT "DateID") as distinct_days
        FROM intermediate_kpi_table
        WHERE "DateID" IS NOT NULL
      `;
      const result = await client.query(query);
      if (result.rows.length === 0 || result.rows[0].distinct_days === '0') {
        return null;
      }
      const row = result.rows[0];
      return {
        minDate: row.min_date,
        maxDate: row.max_date,
        distinctDays: parseInt(row.distinct_days, 10) || 0,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get all KPI names available in database
   */
  static async getAvailableKPIs(): Promise<string[]> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT DISTINCT "KPIName"
        FROM intermediate_kpi_table
        WHERE "KPIName" IS NOT NULL
        ORDER BY "KPIName"
      `;
      
      const result = await client.query(query);
      return result.rows.map(row => row.KPIName);
    } finally {
      client.release();
    }
  }

  /**
   * Get latest KPI values for a site (all KPIs)
   * Fetches from remote database using real USID
   */
  static async getLatestKPIs(siteId: string): Promise<Record<string, number>> {
    // Map dummy site ID to real USID
    const realUSID = siteIdMapper.getRealUSID(siteId);
    if (!realUSID) {
      logger.error(`❌ No real USID found for dummy site ID: ${siteId}`);
      return {};
    }

    // Cache key
    const cacheKey = `realdata:latest:${siteId}`;
    const cacheTTL = parseInt(process.env.KPI_CACHE_TTL || '300'); // 5 minutes

    return cacheOrFetch(
      cacheKey,
      async () => {
        logger.info(`🔍 Fetching latest KPIs from remote DB: ${siteId} (${realUSID.substring(0, 20)}...)`);
        
        // Get data for last 2 days to ensure we have recent data
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 2);

        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];

        // Fetch all common KPIs (using names that exist in remote DB)
        const commonKPIs = [
          'DL_DRB_TPUT',
          'AVG_DL_PRB_UTIL',
          'DATA_RAN_ACC',
          'D_ERB_ATTEMPTS',
          'D_ERB_DROP',
          'D_ERB_FAIL',
          'DATA_ERB_RET',
          'DL_VOL_GB',
          'DL_PKTLOSS_RT',
          'ERAB_DROP_CDT'
        ];

        const rawData = await this.dbConnector.fetchDailyKPIs(
          realUSID,
          startDateStr,
          endDateStr,
          commonKPIs
        );

        if (!rawData || rawData.length === 0) {
          logger.warn(`⚠️ No latest KPI data found for ${siteId}`);
          return {};
        }

        // Group by KPI name and get latest value
        const kpiMap: Record<string, number[]> = {};
        
        rawData.forEach(row => {
          if (!kpiMap[row.kpi_name]) {
            kpiMap[row.kpi_name] = [];
          }
          if (row.kpi_value !== null) {
            kpiMap[row.kpi_name].push(row.kpi_value);
          }
        });

        // Calculate average for each KPI
        const result: Record<string, number> = {};
        Object.entries(kpiMap).forEach(([kpiName, values]) => {
          if (values.length > 0) {
            result[kpiName] = values.reduce((a, b) => a + b, 0) / values.length;
          }
        });

        logger.info(`✅ Found ${Object.keys(result).length} KPIs for ${siteId}`);
        
        return result;
      },
      cacheTTL
    );
  }

  /**
   * Get KPIs for multiple sites (for comparison)
   */
  static async getKPIsBySites(
    siteIds: string[],
    kpiName: string,
    dateId?: string
  ): Promise<Array<{ siteId: string; value: number; anomalyFlag: boolean }>> {
    const client = await pool.connect();
    
    try {
      let query = `
        SELECT 
          "SiteID",
          AVG("KPIValue") as value,
          BOOL_OR("AnomalyFlag") as anomaly_flag
        FROM intermediate_kpi_table
        WHERE "SiteID" = ANY($1)
        AND "KPIName" = $2
      `;
      
      const params: any[] = [siteIds, kpiName];
      
      if (dateId) {
        query += ` AND "DateID" = $3`;
        params.push(dateId);
      } else {
        query += ` AND "DateID" = (SELECT MAX("DateID") FROM intermediate_kpi_table)`;
      }
      
      query += ` GROUP BY "SiteID" ORDER BY "SiteID"`;
      
      const result = await client.query(query, params);
      
      return result.rows.map(row => ({
        siteId: row.SiteID,
        value: parseFloat(row.value),
        anomalyFlag: row.anomaly_flag || false,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get KPI statistics across all sites
   */
  static async getKPIStats(kpiName: string): Promise<{
    kpiName: string;
    avg: number;
    min: number;
    max: number;
    stdDev: number;
    sitesCount: number;
  } | null> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT 
          "KPIName",
          AVG("KPIValue") as avg_value,
          MIN("KPIValue") as min_value,
          MAX("KPIValue") as max_value,
          STDDEV("KPIValue") as std_dev,
          COUNT(DISTINCT "SiteID") as sites_count
        FROM intermediate_kpi_table
        WHERE "KPIName" = $1
        AND "DateID" = (SELECT MAX("DateID") FROM intermediate_kpi_table)
        AND "KPIValue" IS NOT NULL
        GROUP BY "KPIName"
      `;
      
      const result = await client.query(query, [kpiName]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return {
        kpiName: row.KPIName,
        avg: parseFloat(row.avg_value),
        min: parseFloat(row.min_value),
        max: parseFloat(row.max_value),
        stdDev: parseFloat(row.std_dev) || 0,
        sitesCount: parseInt(row.sites_count),
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get top N sites by KPI value (for finding worst performers)
   */
  static async getTopSitesByKPI(
    kpiName: string,
    limit: number = 10,
    order: 'ASC' | 'DESC' = 'DESC'
  ): Promise<Array<{ siteId: string; siteName: string; value: number; anomalyFlag: boolean }>> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT 
          k."SiteID",
          s."SiteName",
          AVG(k."KPIValue") as value,
          BOOL_OR(k."AnomalyFlag") as anomaly_flag
        FROM intermediate_kpi_table k
        JOIN site_table s ON k."SiteID" = s."SiteID" AND k."DateID" = s."DateID"
        WHERE k."KPIName" = $1
        AND k."DateID" = (SELECT MAX("DateID") FROM intermediate_kpi_table)
        AND k."KPIValue" IS NOT NULL
        GROUP BY k."SiteID", s."SiteName"
        ORDER BY value ${order}
        LIMIT $2
      `;
      
      const result = await client.query(query, [kpiName, limit]);
      
      return result.rows.map(row => ({
        siteId: row.SiteID,
        siteName: row.SiteName,
        value: parseFloat(row.value),
        anomalyFlag: row.anomaly_flag || false,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Search KPIs by name pattern
   */
  static async searchKPIs(searchTerm: string, limit: number = 20): Promise<string[]> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT DISTINCT "KPIName"
        FROM intermediate_kpi_table
        WHERE "KPIName" ILIKE $1
        ORDER BY "KPIName"
        LIMIT $2
      `;
      
      const result = await client.query(query, [`%${searchTerm}%`, limit]);
      return result.rows.map(row => row.KPIName);
    } finally {
      client.release();
    }
  }
}
