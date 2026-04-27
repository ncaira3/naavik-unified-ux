/**
 * DB Schema Reference Service
 *
 * Provides a complete, LLM-ready schema document for the Naavik network DB.
 * On startup (and via manual refresh) it queries the live DB for:
 *   - distinct kpi_name values from intermediate_kpi_table, hourly_intermediate_kpis_table, kpi_table
 *   - distinct subcomponent_name values from subcomponent_table
 * Results are cached to disk so the server can start without a live DB connection.
 * The formatted schema string is injected into the LLM system prompt (schema-grounded RAG).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { NaavikDBConnector } from './naavik-db-connector.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, '../../data/schema-reference.json');

// ─── Static full schema (all tables + columns from the DB) ───────────────────

export const FULL_SCHEMA = `
TABLE: alarm_table
  site_id, USID, IDENTIFIER, AGENT, SUMMARY, LASTOCCURRENCE, site_name, LOCATION,
  EQUIPMENTTYPE, ADDITIONALINFO, DELETEDAT, CLASS_NAME, NETWORK_NAME,
  INITIALSEVERITY_NAME, MSGSEVERITY_NAME, ALARM_DURATION (int), EQUIPMENTPRIORITY,
  CLEAREDBY, LOCMARKET, RAWDETAIL, DATE_ID, version (int)

TABLE: cell_table
  cell_id, site_id, cell_name, num_kpis (int), AZIMUTH, HEIGHT,
  LATITUDE (float), LONGITUDE (float), TECH, USID, USEID, CARRIER,
  neighbor_relations, update_time, version (int), DATE_ID,
  strongest_factors, kpi_anomaly_flag_list, kpi_anomaly_score_list,
  anomaly_flag (bool), anomaly_score (float)

TABLE: configuration_parameters_table
  site_id, DATE_ID, NODE, USID, SUBELMT, Parameter,
  Old_Value (int), New_Value (int), version (int)

TABLE: correlation_table
  correlation_cluster, mind_map, DATE_ID, version (int)

TABLE: cqx_offenders_truth_table
  DATE_ID, USID,
  TOTAL_IMPACT_LATEST (float), DL_TPUT_IMP (float), UL_TPUT_IMP (float),
  DATA_DROP_IMP (float), DATA_ACC_IMP (float), VRAN_ACC_IMP (float),
  VCDR_ACC_IMP (float), VOICE_DROP_IMP (float), NS_ESO_IMP (float),
  QUALITY_IMP (float), TOTAL_IMPACT_WOW (float), IMPACT_DELTA (float), version (int)

TABLE: eim_table
  site_id, USID, ADVISORY_ID, DESCRIPTION_OF_WORK, COMMON_ID, LOCATION_ID,
  EQUIPMENT_ID, EQUIPMENT_NAME, LOCATION_NAME, ACTUAL_START_DTS, DATE_ID, version (int)

TABLE: hourly_intermediate_kpis_table
  kpi_id, cell_id, site_id, USID, cell_name, kpi_name, kpi_value, TECH,
  anomaly_flag, anomaly_score, DATE_ID, HOUR_ID (int 0-23), version (int)
  → Join key: USID + DATE_ID + HOUR_ID + cell_name + kpi_name

TABLE: intermediate_kpi_table
  kpi_id, cell_id, site_id, USID, cell_name, kpi_name, kpi_value (float),
  TECH, anomaly_flag, anomaly_score, DATE_ID, version (int)
  → Join key: USID + DATE_ID + cell_name + kpi_name

TABLE: kpi_table
  kpi_id, cell_id, site_id, USID, cell_name, kpi_name, kpi_value (float),
  anomaly_flag (bool), numerator (float), denominator (float),
  anomaly_score_numerator, anomaly_score_denominator, anomaly_score_ratio,
  alarms, DATE_ID, version (int)

TABLE: lte_parameters_table
  site_id, cell_id, DATE_ID, NODE, cell_name, ADMINISTRATIVESTATE (int),
  PRIMARYPLMNRESERVED (bool), CELLBARRED (int), EARFCNDL (int),
  PHYSICALLAYERCELLID (int), PHYSICALLAYERSUBCELLID (int),
  PHYSICALLAYERCELLIDGROUP (int), CCEDYNUEADMCTRLRETDIFFTHR (int),
  ULDYNUEADMCTRLRETDIFFTHR (int), USID, version (int)

TABLE: lte_sector_carrier_table
  site_id, DATE_ID, NODE, SECTORCARRIER_ID_, OPERATIONALSTATE (int),
  AVAILABILITYSTATUS, MAXIMUMTRANSMISSIONPOWER (int), CONFIGUREDMAXTXPOWER (int),
  NOOFRXANTENNAS (int), NOOFTXANTENNAS (int), USID, version (int)

TABLE: neighbors_table
  site_id, neighbor_site_id, SOURCE_USID, SOURCE_USID_FACE, NEIGH_USID, NEIGH_USID_FACE,
  HANDOVER_COUNT (int), HO_RANK (int), TOTAL_HANDOVER (float), CUMMULATIVE_SUM (float),
  PERC_HANDOVER (float), SOURCE_NEIGH_DISTANCE_METERS (float), update_time, version (int)

TABLE: neighbors_table_date_id
  (same columns as neighbors_table plus DATE_ID)

TABLE: nr_parameters_table
  site_id, cell_id, DATE_ID, NODE, cell_name, CELLSTATE (int), CELLBARRED (int),
  ADMINISTRATIVESTATE (int), AVAILABILITYSTATUS, NRPCI (int),
  POINTAARFCNTDD, USID, version (int)

TABLE: nr_sector_carrier_table
  site_id, DATE_ID, NODE, NRSECTORCARRIERID, ARFCNDL (int), ARFCNUL (int),
  BSCHANNELBWDL (int), OPERATIONALSTATE (int), CONFIGUREDMAXTXPOWER (int),
  MAXTRANSMISSIONPOWER (int), NOOFTXANTENNAS (int), NOOFUSEDTXANTENNAS (int),
  NOOFUSEDRXANTENNAS (int), NOOFRXANTENNAS (int), DLCALIBRATIONENABLED (bool),
  USID, version (int)

TABLE: outage_table
  site_id, USID, site_name, cell_name, METRIC, SNAPSHOT_HOUR (int), DATE_ID, version (int)

TABLE: ret_table
  site_id, DATE_ID, NODE, ANTENNAUNITGROUP_ID_ (int), ANTENNANEARUNIT_ID_ (int),
  ELECTRICALANTENNATILT (int), MINTILT (int), MAXTILT (int), USERLABEL,
  IUANTANTENNAMODELNUMBER, RETSUBUNIT_ID_ (int), IUANTANTENNASERIALNUMBER,
  IUANTBASESTATIONID, IUANTSECTORID, CALIBRATIONSTATUS (int), USID, version (int)

TABLE: sector_table
  USID, AZIMUTH (int), site_id, strongest_factors, anomaly_flag (bool),
  anomaly_score (float), DATE_ID, version (int)

TABLE: site_table  ← PRIMARY RCA + TOPOLOGY TABLE
  site_id, site_name, cell_num (int), USID, LATITUDE (float), LONGITUDE (float),
  DISTRICT (int), ZONE_ID, ZONE_ENGINEER, ENGINEER_UID, MANAGER_UID,
  COUNTY, CITY, STATE, STREET_ADDRESS, ZIP (int), FA_LOCATION, SITE_TYPE,
  STRUCTURE_TOWER_TYPE, ATT_SITE_ID, CLUSTERID, CLUSTERNAME, MARKET,
  DISTRICT_MANAGER, strongest_factors, rca_fingerprint_reference_id,
  solution_recommendation, outage, outage_timestamp, degraded_category,
  rca_traversal, rca_bucket, kpi_summary, ticket_summary, alarm_summary,
  rca_summary, short_summary, long_summary, solution_summary, parameter_summary,
  user_feedback, neighbor_summary, confidence_score_int, DATE_ID, update_time,
  version (int), outage_summary, intuitions, chain_of_thought, confidence_score,
  token_and_cost_usage, details, run_time_seconds, anomaly_flag (bool),
  anomaly_score (float)

TABLE: subcomponent_table
  subcomponent_id, site_id, kpi_id, USID, subcomponent_name, subcomponent_value (float),
  operator_numerator (float), operator_denominator (float), operator_ratio (float),
  anomaly_score_ratio, anomaly_flag, estimated_subcomponent_num,
  estimated_subcomponent_den, normalized_subcomponent,
  normalized_estimated_subcomponent, DATE_ID, version (int)

TABLE: ticket_table
  site_id, USID, TICKET_NUMBER, CREATE_TIME, TICKET_STATUS, ASSIGNED_DEPARTMENT,
  SHORT_DESCRIPTION, MODIFIED_TIME, ASSIGNED_TO, WF_ASSIGNED_TO_CUID, CLOSED_TIME,
  COMMON_ID, PROBLEM_DETAIL, PROBLEM_CATEGORY, PROBLEM_SUBCATEGORY, EQUIPMENT_ID,
  SUBMITTED_BY, SUBMITTER_DEPARTMENT, SUBMITTER_FULL_NAME, LOCATION_ID,
  RANKING (int), DATE_ID, version (int)
`.trim();

// ─── Cached reference shape ───────────────────────────────────────────────────

interface SchemaCache {
  refreshedAt: string;
  kpiNames: {
    intermediate_kpi_table: string[];
    hourly_intermediate_kpis_table: string[];
    kpi_table: string[];
    combined: string[];       // union of all three, deduplicated
  };
  subcomponentNames: string[];
}

// ─── Service ──────────────────────────────────────────────────────────────────

class DbSchemaReferenceService {
  private cache: SchemaCache | null = null;
  private db = new NaavikDBConnector();

  /** Load cached reference from disk (called at module load). */
  loadFromDisk(): void {
    try {
      if (fs.existsSync(CACHE_PATH)) {
        const raw = fs.readFileSync(CACHE_PATH, 'utf-8');
        this.cache = JSON.parse(raw) as SchemaCache;
        logger.info(`[SchemaRef] Loaded from disk (refreshed ${this.cache.refreshedAt})`);
      }
    } catch (err) {
      logger.warn('[SchemaRef] Could not load cache from disk:', err);
    }
  }

  /** Query live DB for distinct KPI and subcomponent names. Saves to disk. */
  async refresh(): Promise<SchemaCache> {
    logger.info('[SchemaRef] Refreshing schema reference from live DB…');

    const query = async (sql: string): Promise<string[]> => {
      try {
        const rows = await this.db.query(sql) as Record<string, any>[];
        return rows
          .map((r) => String(Object.values(r)[0] || '').trim())
          .filter(Boolean)
          .sort();
      } catch (err) {
        logger.warn(`[SchemaRef] Query failed: ${sql.slice(0, 80)}`, err);
        return [];
      }
    };

    const [interKpis, hourlyKpis, kpiTableKpis, subcomponents] = await Promise.all([
      query(`SELECT DISTINCT kpi_name FROM intermediate_kpi_table WITH (NOLOCK) WHERE kpi_name IS NOT NULL ORDER BY kpi_name`),
      query(`SELECT DISTINCT kpi_name FROM hourly_intermediate_kpis_table WITH (NOLOCK) WHERE kpi_name IS NOT NULL ORDER BY kpi_name`),
      query(`SELECT DISTINCT kpi_name FROM kpi_table WITH (NOLOCK) WHERE kpi_name IS NOT NULL ORDER BY kpi_name`),
      query(`SELECT DISTINCT subcomponent_name FROM subcomponent_table WITH (NOLOCK) WHERE subcomponent_name IS NOT NULL ORDER BY subcomponent_name`),
    ]);

    const combined = [...new Set([...interKpis, ...hourlyKpis, ...kpiTableKpis])].sort();

    const newCache: SchemaCache = {
      refreshedAt: new Date().toISOString(),
      kpiNames: {
        intermediate_kpi_table: interKpis,
        hourly_intermediate_kpis_table: hourlyKpis,
        kpi_table: kpiTableKpis,
        combined,
      },
      subcomponentNames: subcomponents,
    };

    // Persist to disk
    try {
      fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
      fs.writeFileSync(CACHE_PATH, JSON.stringify(newCache, null, 2), 'utf-8');
      logger.info(`[SchemaRef] Saved to disk: ${combined.length} KPIs, ${subcomponents.length} subcomponents`);
    } catch (err) {
      logger.warn('[SchemaRef] Could not save cache to disk:', err);
    }

    this.cache = newCache;
    return newCache;
  }

  /** Return the cached reference (null if never loaded). */
  getCache(): SchemaCache | null {
    return this.cache;
  }

  /**
   * Build the LLM-ready schema prompt string.
   * Includes the full static schema + live KPI/subcomponent names.
   */
  buildSchemaPrompt(): string {
    const c = this.cache;

    const kpiSection = c && c.kpiNames.combined.length > 0
      ? `KNOWN KPI NAMES (kpi_name column in intermediate_kpi_table, hourly_intermediate_kpis_table, kpi_table):
${c.kpiNames.combined.join(', ')}

Additional KPIs only in hourly_intermediate_kpis_table: ${
        c.kpiNames.hourly_intermediate_kpis_table
          .filter((k) => !c.kpiNames.intermediate_kpi_table.includes(k))
          .join(', ') || '(none beyond daily set)'
      }`
      : `KNOWN KPI NAMES (kpi_name column): Use the exact name the user provides — any ALL_CAPS_WITH_UNDERSCORES token is a valid kpi_name.`;

    const subSection = c && c.subcomponentNames.length > 0
      ? `KNOWN SUBCOMPONENT NAMES (subcomponent_name in subcomponent_table):
${c.subcomponentNames.join(', ')}`
      : `SUBCOMPONENT NAMES: Use the exact name the user provides.`;

    return `${FULL_SCHEMA}

─────────────────────────────────────────
${kpiSection}

${subSection}
─────────────────────────────────────────

KEY JOIN RULES:
- All tables share USID (VARCHAR) and DATE_ID as primary join keys.
- USID is the site identifier — always filter by USID when the user specifies a site number.
- site_table is the main RCA table; intermediate_kpi_table for KPI trends.
- Use intermediate_kpi_table for daily KPI data; hourly_intermediate_kpis_table for hourly (add HOUR_ID 0-23).
- subcomponent_table joins to site_table on USID + DATE_ID for impact scores.
- neighbors_table / neighbors_table_date_id for handover and neighbor analysis.
- ticket_table, alarm_table, eim_table for operational events.

DATE RULES:
- Trend / range: DATE_ID >= DATEADD(day, -N, GETDATE())
- Point-in-time: CAST(DATE_ID AS DATE) = CAST('<YYYY-MM-DD>' AS DATE)
- Always include WITH (NOLOCK) on every table reference.
- Use T-SQL: SELECT TOP N (not LIMIT).`;
  }

  /** Return combined KPI name list from DB schema cache. */
  getKpiNames(): string[] {
    return this.cache?.kpiNames.combined ?? [];
  }

  /** Summarise cache status for logging / health checks. */
  status() {
    if (!this.cache) return { loaded: false };
    return {
      loaded: true,
      refreshedAt: this.cache.refreshedAt,
      kpiCount: this.cache.kpiNames.combined.length,
      subcomponentCount: this.cache.subcomponentNames.length,
    };
  }
}

export const dbSchemaRef = new DbSchemaReferenceService();

// Auto-load from disk when module is imported
dbSchemaRef.loadFromDisk();
