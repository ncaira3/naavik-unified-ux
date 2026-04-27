/**
 * Root Cause Analysis Service
 * Identifies root causes of network issues, especially outages and their impact on neighbors
 */
import { pool } from '../config/database.js';
import { RootCauseAnalysis, OutageEvent, Anomaly } from '../types/index.js';
import { RCA_CONFIG } from '../config/constants.js';
import { logger } from '../utils/logger.js';

interface SiteLocation {
  siteId: string;
  siteName: string;
  latitude: number;
  longitude: number;
}

export class RCAService {
  /**
   * Perform RCA for a specific anomaly
   */
  static async analyzeAnomaly(anomaly: Anomaly): Promise<RootCauseAnalysis> {
    // Check if this site is experiencing an outage
    const isOutage = await this.isSiteOutage(anomaly.siteId);
    
    if (isOutage) {
      return {
        rootCause: 'Site outage detected',
        rootCauseSiteId: anomaly.siteId,
        impactedSites: [],
        confidence: 0.95,
        recommendation: 'Immediate investigation required. Site appears to be completely offline.',
        chainOfReasoning: [
          'Multiple critical KPI failures detected',
          'Site shows characteristics of complete outage',
          'High confidence in outage diagnosis',
        ],
      };
    }
    
    // Check if a nearby site has an outage that could be causing congestion
    const nearbyOutage = await this.findNearbyOutages(anomaly.siteId, anomaly.location);
    
    if (nearbyOutage) {
      return {
        rootCause: `Traffic overflow from nearby outage at ${nearbyOutage.siteName}`,
        rootCauseSiteId: nearbyOutage.siteId,
        impactedSites: [anomaly.siteId],
        confidence: 0.85,
        recommendation: `Monitor site ${anomaly.siteId} for congestion. Consider load balancing or capacity adjustments until ${nearbyOutage.siteId} is restored.`,
        chainOfReasoning: [
          `Nearby site ${nearbyOutage.siteName} has active outage`,
          `Distance: ${this.calculateDistance(anomaly.location, nearbyOutage.location).toFixed(2)} km`,
          'Traffic likely redirected to this site causing congestion',
          'KPI degradation pattern consistent with increased load',
        ],
      };
    }
    
    // Generic RCA based on KPI type
    return this.performGenericRCA(anomaly);
  }

  /**
   * Check if a site is experiencing a complete outage
   */
  private static async isSiteOutage(siteId: string): Promise<boolean> {
    const client = await pool.connect();
    
    try {
      // Check if site has multiple critical KPI failures
      const query = `
        SELECT COUNT(DISTINCT "KPIName") as failed_kpis
        FROM intermediate_kpi_table
        WHERE "SiteID" = $1
        AND "AnomalyFlag" = true
        AND "AnomalyScore" >= 0.9
        AND "DateID" = (SELECT MAX("DateID") FROM intermediate_kpi_table WHERE "SiteID" = $1)
      `;
      
      const result = await client.query(query, [siteId]);
      const failedKpis = parseInt(result.rows[0]?.failed_kpis || '0');
      
      // If 3+ critical KPIs are failing, likely an outage
      return failedKpis >= 3;
      
    } finally {
      client.release();
    }
  }

  /**
   * Find nearby sites with outages
   */
  private static async findNearbyOutages(
    siteId: string,
    location: { latitude: number; longitude: number }
  ): Promise<(SiteLocation & { location: { latitude: number; longitude: number } }) | null> {
    const client = await pool.connect();
    
    try {
      // Get sites with high anomaly scores near this location
      const query = `
        SELECT 
          s."SiteID",
          s."SiteName",
          s."Latitude",
          s."Longitude",
          s."AnomalyScore"
        FROM site_table s
        WHERE s."SiteID" != $1
        AND s."AnomalyScore" >= 0.9
        AND s."DateID" = (SELECT MAX("DateID") FROM site_table)
        ORDER BY s."AnomalyScore" DESC
        LIMIT 10
      `;
      
      const result = await client.query(query, [siteId]);
      
      // Find closest outage within impact radius
      for (const row of result.rows) {
        const outageLocation = {
          latitude: parseFloat(row.Latitude),
          longitude: parseFloat(row.Longitude),
        };
        
        const distance = this.calculateDistance(location, outageLocation);
        
        if (distance <= RCA_CONFIG.OUTAGE_IMPACT_RADIUS_KM) {
          return {
            siteId: row.SiteID,
            siteName: row.SiteName,
            latitude: outageLocation.latitude,
            longitude: outageLocation.longitude,
            location: outageLocation,
          };
        }
      }
      
      return null;
      
    } finally {
      client.release();
    }
  }

  /**
   * Get all active outage events with their neighbor impact
   */
  static async getActiveOutages(): Promise<OutageEvent[]> {
    const client = await pool.connect();
    
    try {
      // Find sites with outage characteristics
      const query = `
        SELECT 
          s."SiteID",
          s."SiteName",
          s."Latitude",
          s."Longitude",
          s."DateID",
          s."AnomalyScore"
        FROM site_table s
        WHERE s."AnomalyScore" >= 0.9
        AND s."DateID" = (SELECT MAX("DateID") FROM site_table)
        ORDER BY s."AnomalyScore" DESC
        LIMIT 20
      `;
      
      const result = await client.query(query);
      
      const outages: OutageEvent[] = [];
      
      for (const row of result.rows) {
        const outageSite = {
          siteId: row.SiteID,
          siteName: row.SiteName,
          latitude: parseFloat(row.Latitude),
          longitude: parseFloat(row.Longitude),
        };
        
        // Find impacted neighbors
        const neighbors = await this.findImpactedNeighbors(outageSite);
        
        outages.push({
          outageId: `outage-${row.SiteID}-${row.DateID}`,
          siteId: row.SiteID,
          siteName: row.SiteName,
          location: {
            latitude: outageSite.latitude,
            longitude: outageSite.longitude,
          },
          startedAt: new Date(row.DateID),
          neighborImpact: neighbors,
        });
      }
      
      logger.info(`Found ${outages.length} active outages`);
      return outages;
      
    } finally {
      client.release();
    }
  }

  /**
   * Find sites impacted by an outage (neighbors with increased congestion)
   */
  private static async findImpactedNeighbors(
    outageSite: SiteLocation
  ): Promise<Array<{
    siteId: string;
    siteName: string;
    congestionIncrease: number;
    affectedKPIs: string[];
  }>> {
    const client = await pool.connect();
    
    try {
      // Get all sites within impact radius
      const query = `
        SELECT 
          s."SiteID",
          s."SiteName",
          s."Latitude",
          s."Longitude",
          s."AnomalyScore",
          COUNT(CASE WHEN k."AnomalyFlag" = true THEN 1 END) as anomaly_count
        FROM site_table s
        LEFT JOIN intermediate_kpi_table k ON s."SiteID" = k."SiteID" AND s."DateID" = k."DateID"
        WHERE s."SiteID" != $1
        AND s."DateID" = (SELECT MAX("DateID") FROM site_table)
        AND k."KPIName" IN ('DATA_DROP_RATE', 'DATA_ACC_RATE', 'DL_DRB_TPUT', 'ERAB_DROP', 'RRC_SETUP_SR')
        GROUP BY s."SiteID", s."SiteName", s."Latitude", s."Longitude", s."AnomalyScore"
        HAVING COUNT(CASE WHEN k."AnomalyFlag" = true THEN 1 END) > 0
      `;
      
      const result = await client.query(query, [outageSite.siteId]);
      
      const impacted = [];
      
      for (const row of result.rows) {
        const neighborLocation = {
          latitude: parseFloat(row.Latitude),
          longitude: parseFloat(row.Longitude),
        };
        
        const distance = this.calculateDistance(
          { latitude: outageSite.latitude, longitude: outageSite.longitude },
          neighborLocation
        );
        
        if (distance <= RCA_CONFIG.OUTAGE_IMPACT_RADIUS_KM) {
          // Simulate congestion increase based on distance (closer = more impact)
          const proximityFactor = 1 - (distance / RCA_CONFIG.OUTAGE_IMPACT_RADIUS_KM);
          const congestionIncrease = 
            RCA_CONFIG.NEIGHBOR_CONGESTION_INCREASE.min + 
            (RCA_CONFIG.NEIGHBOR_CONGESTION_INCREASE.max - RCA_CONFIG.NEIGHBOR_CONGESTION_INCREASE.min) * proximityFactor;
          
          impacted.push({
            siteId: row.SiteID,
            siteName: row.SiteName,
            congestionIncrease: Math.round(congestionIncrease),
            affectedKPIs: RCA_CONFIG.CONGESTION_AFFECTED_KPIS,
          });
        }
      }
      
      return impacted;
      
    } finally {
      client.release();
    }
  }

  /**
   * Generic RCA based on KPI patterns
   */
  private static performGenericRCA(anomaly: Anomaly): RootCauseAnalysis {
    const kpiType = anomaly.kpiName || 'DEFAULT';
    
    const rcaMap: Record<string, { cause: string; recommendation: string; reasoning: string[] }> = {
      DATA_DROP_RATE: {
        cause: 'High data session drop rate detected',
        recommendation: 'Check for interference, capacity issues, or hardware problems. Review handover parameters.',
        reasoning: [
          'Data drop rate exceeds threshold',
          'Possible causes: RF interference, overloaded cells, faulty equipment',
          'Recommend immediate investigation of cell parameters',
        ],
      },
      DATA_ACC_RATE: {
        cause: 'Low data session accessibility',
        recommendation: 'Investigate RACH configuration, cell capacity, or core network issues.',
        reasoning: [
          'Data accessibility below acceptable threshold',
          'Users unable to establish data sessions',
          'Check PRACH resources and admission control',
        ],
      },
      NS_ESO_AVAIL: {
        cause: 'Network slice availability degraded',
        recommendation: 'Check slice orchestration, resource allocation, and slice-specific parameters.',
        reasoning: [
          'Network slice ESO availability below target',
          'Potential slice resource contention',
          'Review slice SLA parameters',
        ],
      },
      DEFAULT: {
        cause: `${kpiType} anomaly detected`,
        recommendation: 'Further investigation required. Review historical trends and correlate with other KPIs.',
        reasoning: [
          `${kpiType} shows abnormal behavior`,
          'Analyze time-series data for patterns',
          'Check for correlated anomalies',
        ],
      },
    };
    
    const rca = rcaMap[kpiType] || rcaMap.DEFAULT;
    
    return {
      rootCause: rca.cause,
      impactedSites: [anomaly.siteId],
      confidence: 0.65,
      recommendation: rca.recommendation,
      chainOfReasoning: rca.reasoning,
    };
  }

  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  private static calculateDistance(
    loc1: { latitude: number; longitude: number },
    loc2: { latitude: number; longitude: number }
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(loc2.latitude - loc1.latitude);
    const dLon = this.toRad(loc2.longitude - loc1.longitude);
    
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(loc1.latitude)) *
      Math.cos(this.toRad(loc2.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private static toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}
