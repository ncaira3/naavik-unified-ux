/**
 * Bootstrap script - Fetch initial site data from remote database and populate local site_table
 * This is needed before running replicate-remote-to-local.ts
 *
 * Usage:
 *   cd backend
 *   npx tsx src/scripts/bootstrap-sites.ts
 */
import dotenv from 'dotenv';
import axios from 'axios';
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

dotenv.config();

const REMOTE_DB_URL = 'http://3.20.40.252:9876/api/query';
const BATCH_SIZE = 100;

async function bootstrapSites() {
  const client = await pool.connect();

  try {
    logger.info('🚀 BOOTSTRAP: Fetching initial site data from remote database...');

    // Create axios instance for remote DB
    const remoteClient = axios.create({
      baseURL: REMOTE_DB_URL,
      timeout: 10000,
    });

    // Fetch sites from remote database
    logger.info('Querying remote database for sites...');
    const response = await remoteClient.post('', {
      query: `
        SELECT TOP 1000
          site_id,
          site_name,
          LATITUDE,
          LONGITUDE,
          cell_num as CellCount,
          CAST(anomaly_flag AS BIT) as anomaly_flag,
          CAST(anomaly_score AS FLOAT) as anomaly_score,
          CLUSTERID,
          DATE_ID
        FROM site_table
        WHERE LATITUDE IS NOT NULL
          AND LONGITUDE IS NOT NULL
        ORDER BY site_id
      `,
      params: {},
    });

    const remoteSites = response.data?.result || [];
    logger.info(`📍 Found ${remoteSites.length} sites from remote database`);

    if (remoteSites.length === 0) {
      logger.warn('⚠️ No sites found in remote database');
      return;
    }

    // Clear existing data first
    await client.query('DELETE FROM site_table');
    logger.info('🧹 Cleared existing site data');

    // Insert sites into local database in batches, normalizing column names
    // Deduplicate by site_id to avoid unique constraint violations
    const deduped: Map<string, any> = new Map();
    for (const site of remoteSites) {
      const siteId = site.site_id || site.SiteID;
      if (siteId && !deduped.has(siteId)) {
        deduped.set(siteId, site);
      }
    }
    logger.info(`📦 Deduplicated to ${deduped.size} unique sites`);

    const uniqueSites = Array.from(deduped.values());

    for (let i = 0; i < uniqueSites.length; i += BATCH_SIZE) {
      const batch = uniqueSites.slice(i, i + BATCH_SIZE);
      const values = batch
        .map((site: any, idx: number) => {
          const baseIdx = i + idx;
          return `(
            $${baseIdx * 9 + 1}, $${baseIdx * 9 + 2}, $${baseIdx * 9 + 3},
            $${baseIdx * 9 + 4}, $${baseIdx * 9 + 5}, $${baseIdx * 9 + 6},
            $${baseIdx * 9 + 7}, $${baseIdx * 9 + 8}, $${baseIdx * 9 + 9}
          )`;
        })
        .join(',');

      const params = batch.flatMap((site: any) => [
        site.site_id || site.SiteID,
        site.site_name || site.SiteName,
        site.LATITUDE || site.Latitude,
        site.LONGITUDE || site.Longitude,
        site.CellCount || site.cell_num || 0,
        site.anomaly_flag ? true : false,
        parseFloat(site.anomaly_score || site.AnomalyScore) || 0,
        site.CLUSTERID || site.ClusterID || null,
        site.DATE_ID || site.DateID,
      ]);

      const insertQuery = `
        INSERT INTO site_table
          (site_id, site_name, latitude, longitude, cell_num,
           anomaly_flag, anomaly_score, clusterid, date_id)
        VALUES ${values}
      `;

      try {
        await client.query(insertQuery, params);
        logger.info(`✓ Inserted batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} sites)`);
      } catch (err: any) {
        logger.warn(`⚠️ Batch ${Math.floor(i / BATCH_SIZE) + 1} had errors, continuing:`, err.message.slice(0, 100));
      }
    }

    logger.info(`✅ Bootstrap complete: ${remoteSites.length} sites populated in local database`);
    logger.info('📌 Next step: run replicate-remote-to-local.ts to sync full dataset');
  } catch (error: any) {
    console.error('❌ Bootstrap failed:', error);
    logger.error('❌ Bootstrap failed:', error.message || String(error));
    if (error.response) {
      logger.error('Remote API response:', error.response.status, error.response.data);
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

bootstrapSites();
