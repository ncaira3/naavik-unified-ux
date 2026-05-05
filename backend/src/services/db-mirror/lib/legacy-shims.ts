/**
 * Legacy schema shims.
 *
 * Older code (server.ts startup probes, cellSector.model, offender.routes,
 * provisioning.routes, V2 orchestrator, site.model, agent-orchestrator) was
 * written against a now-defunct local replication that exposed these tables in
 * the `public` schema with PascalCase columns:
 *
 *   public.filtered_sites              ("SiteID", "Latitude", …)
 *   public.cqx_offenders_truth_table   ("DateID", "SiteID", …)
 *
 * That replication script (replicate-remote-to-local.ts) was never run for
 * this environment, which is why those queries log
 *   relation "filtered_sites" does not exist
 *   column "DateID" does not exist
 * over and over.
 *
 * We now have the same data in the new `mirror.*` schema (lowercase columns).
 * These shims expose VIEWs in `public` with the legacy PascalCase aliases so
 * every old caller starts working without touching call sites.
 */
import { pool } from '../../../config/database.js';
import { logger } from '../../../utils/logger.js';

const UNION_CITY_LAT = 37.5897;
const UNION_CITY_LON = -122.0628;

/**
 * filtered_sites — one row per offender USID at its most recent mirrored date,
 * with a computed DistanceFromUnionCity (haversine, km).
 */
const FILTERED_SITES_VIEW = `
CREATE OR REPLACE VIEW public.filtered_sites AS
SELECT DISTINCT ON (s.usid)
  s.usid::text                                                       AS "SiteID",
  s.site_name                                                        AS "SiteName",
  CAST(s.latitude AS DOUBLE PRECISION)                               AS "Latitude",
  CAST(s.longitude AS DOUBLE PRECISION)                              AS "Longitude",
  s.cell_num                                                         AS "CellCount",
  s.date_id::text                                                    AS "DateID",
  s.anomaly_flag                                                     AS "AnomalyFlag",
  COALESCE(s.anomaly_score, 0)                                       AS "AnomalyScore",
  s.clusterid                                                        AS "ClusterID",
  CASE
    WHEN s.latitude IS NULL OR s.longitude IS NULL THEN NULL
    ELSE 6371 * acos(
      LEAST(1.0, GREATEST(-1.0,
        cos(radians(${UNION_CITY_LAT})) * cos(radians(s.latitude)) *
        cos(radians(s.longitude) - radians(${UNION_CITY_LON})) +
        sin(radians(${UNION_CITY_LAT})) * sin(radians(s.latitude))
      ))
    )
  END                                                                AS "DistanceFromUnionCity"
FROM mirror.site_table s
WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL
ORDER BY s.usid, s.date_id DESC
`;

/**
 * cqx_offenders_truth_table — one row per (USID, DATE_ID) with PascalCase
 * column aliases the legacy queries expect.
 */
const CQX_OFFENDERS_VIEW = `
CREATE OR REPLACE VIEW public.cqx_offenders_truth_table AS
SELECT
  c.date_id::text                AS "DateID",
  c.usid::text                   AS "SiteID",
  c.total_impact_latest          AS "TotalImpactLatest",
  c.dl_tput_imp                  AS "DLTputImp",
  c.ul_tput_imp                  AS "ULTputImp",
  c.data_drop_imp                AS "DataDropImp",
  c.data_acc_imp                 AS "DataAccImp",
  c.voice_drop_imp               AS "VoiceDropImp",
  c.ns_eso_imp                   AS "NsEsoImp",
  c.quality_imp                  AS "QualityImp",
  c.total_impact_wow             AS "TotalImpactWow",
  c.impact_delta                 AS "ImpactDelta"
FROM mirror.cqx_offenders_truth_table c
`;

/**
 * filtered_cell_table — one row per cell at its most recent mirrored date.
 * The legacy SQL generator + telemetry views read these PascalCase column names.
 */
const FILTERED_CELL_TABLE_VIEW = `
CREATE OR REPLACE VIEW public.filtered_cell_table AS
SELECT DISTINCT ON (c.useid)
  COALESCE(c.useid, c.cell_id)::text  AS "CellID",
  c.cell_name                         AS "CellName",
  c.usid::text                        AS "SiteID",
  c.tech                              AS "Technology",
  c.carrier                           AS "Carrier",
  CAST(c.latitude AS DOUBLE PRECISION)  AS "Latitude",
  CAST(c.longitude AS DOUBLE PRECISION) AS "Longitude",
  CAST(c.azimuth AS DOUBLE PRECISION)   AS "Azimuth",
  c.date_id::text                     AS "DateID",
  c.anomaly_flag                      AS "AnomalyFlag",
  COALESCE(c.anomaly_score, 0)        AS "AnomalyScore"
FROM mirror.cell_table c
ORDER BY c.useid, c.date_id DESC
`;

/**
 * filtered_sector_table — one row per (USID, azimuth) at the most recent date.
 * mirror.sector_table is sparse (no useid/CellID/BeamWidth/Technology), so those
 * alias to NULL. SectorID is synthesized as "<usid>_<azimuth>" for stable joins.
 */
const FILTERED_SECTOR_TABLE_VIEW = `
CREATE OR REPLACE VIEW public.filtered_sector_table AS
SELECT DISTINCT ON (s.usid, s.azimuth)
  (s.usid::text || '_' || COALESCE(CAST(s.azimuth AS TEXT), 'na')) AS "SectorID",
  NULL::TEXT                          AS "CellID",
  s.usid::text                        AS "SiteID",
  CAST(s.azimuth AS DOUBLE PRECISION) AS "Azimuth",
  NULL::DOUBLE PRECISION              AS "BeamWidth",
  NULL::TEXT                          AS "Technology",
  s.date_id::text                     AS "DateID"
FROM mirror.sector_table s
ORDER BY s.usid, s.azimuth, s.date_id DESC
`;

/**
 * filtered_cell_sector_map_view — combined cell + sector view.
 * Joins on USID since mirror.sector_table doesn't carry cell-level IDs.
 */
const FILTERED_CELL_SECTOR_MAP_VIEW = `
CREATE OR REPLACE VIEW public.filtered_cell_sector_map_view AS
SELECT
  c."CellID",
  c."CellName",
  c."SiteID",
  c."Technology",
  c."Carrier",
  c."Latitude",
  c."Longitude",
  c."Azimuth",
  c."DateID",
  c."AnomalyFlag",
  c."AnomalyScore",
  s."SectorID"
FROM public.filtered_cell_table c
LEFT JOIN public.filtered_sector_table s ON s."SiteID" = c."SiteID"
`;

/**
 * If `public.<name>` exists as a base table from the old replicate script,
 * we want to replace it with our VIEW — but only if it's empty (no chance
 * of clobbering real data). Returns true when the slot is now safe for
 * `CREATE OR REPLACE VIEW`.
 */
async function clearShimSlot(name: string): Promise<boolean> {
  const existing = await pool.query(
    `SELECT table_type FROM information_schema.tables
     WHERE table_schema='public' AND table_name=$1`,
    [name],
  );
  if (existing.rowCount === 0) return true;
  const kind = existing.rows[0].table_type;
  if (kind === 'VIEW') return true; // CREATE OR REPLACE handles it

  // It's a BASE TABLE — drop only if empty
  const count = await pool.query(`SELECT COUNT(*)::int AS n FROM public.${name}`);
  const rowCount = count.rows[0]?.n ?? 0;
  if (rowCount > 0) {
    logger.warn(`[mirror] legacy shim: public.${name} is a non-empty BASE TABLE (${rowCount} rows) — skipping VIEW shim to preserve data`);
    return false;
  }
  await pool.query(`DROP TABLE IF EXISTS public.${name}`);
  logger.info(`[mirror] legacy shim: dropped empty stub table public.${name}`);
  return true;
}

export async function ensureLegacyShims(): Promise<void> {
  // Only build shims if the underlying mirror tables exist. Skipping
  // gracefully avoids "relation mirror.X does not exist" errors during the
  // first startup before mirror tables are created.
  const required = ['site_table', 'cqx_offenders_truth_table', 'cell_table', 'sector_table'];
  const present = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='mirror' AND table_name = ANY($1::text[])`,
    [required],
  );
  const have = new Set(present.rows.map((r) => r.table_name));

  // Order matters: filtered_cell_sector_map_view depends on filtered_cell_table and filtered_sector_table.
  const shims: Array<{ name: string; sql: string; needs: string[] }> = [
    { name: 'filtered_sites',                sql: FILTERED_SITES_VIEW,            needs: ['site_table'] },
    { name: 'cqx_offenders_truth_table',     sql: CQX_OFFENDERS_VIEW,             needs: ['cqx_offenders_truth_table'] },
    { name: 'filtered_cell_table',           sql: FILTERED_CELL_TABLE_VIEW,       needs: ['cell_table'] },
    { name: 'filtered_sector_table',         sql: FILTERED_SECTOR_TABLE_VIEW,     needs: ['sector_table'] },
    { name: 'filtered_cell_sector_map_view', sql: FILTERED_CELL_SECTOR_MAP_VIEW,  needs: ['cell_table', 'sector_table'] },
  ];

  for (const shim of shims) {
    if (!shim.needs.every((n) => have.has(n))) {
      logger.warn(`[mirror] legacy shim: skipping public.${shim.name} (missing mirror table(s): ${shim.needs.filter((n) => !have.has(n)).join(', ')})`);
      continue;
    }
    try {
      if (await clearShimSlot(shim.name)) {
        await pool.query(shim.sql);
        logger.info(`[mirror] legacy shim: public.${shim.name} view ready`);
      }
    } catch (err) {
      logger.warn(`[mirror] failed to create public.${shim.name} shim: ${(err as Error).message}`);
    }
  }
}
