/**
 * Script to:
 * 1. Flag sites with 24h downtime as OUTAGE
 * 2. Find neighboring sites to outages
 * 3. Add congestion KPIs to neighboring sites
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5435,
  database: process.env.DB_NAME || 'naavik_demo',
  user: process.env.DB_USER || 'naavik_user',
  password: process.env.DB_PASSWORD || 'naavik_pass_2026'
});

const NEIGHBOR_DISTANCE_KM = 2; // Sites within 2km are considered neighbors
const CONGESTION_KPIS = {
  AVG_DL_PRB_UTIL: { min: 93, max: 99 },      // Very high utilization
  RRC_FAIL: { min: 8000, max: 18000 },        // High RRC failures
  DUAC_FAIL: { min: 1500, max: 4000 },        // High DUAC failures
  CALL_DROP_RATE: { min: 3.5, max: 8.2 },     // Call drops (%)
  HOSR: { min: 85, max: 95 },                 // Handover success rate (lower is worse)
  CSSR: { min: 92, max: 97 },                 // Call setup success rate
};

function getRandomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  try {
    console.log('\n=== STEP 0: Reset Previous Congestion Flags ===\n');
    
    // Reset sites that were marked as congested (but not outages)
    await pool.query(`
      UPDATE site_table
      SET "AnomalyScore" = 0,
          "AnomalyFlag" = false
      WHERE "AnomalyScore" > 0 AND "AnomalyScore" < 0.9
    `);
    
    // Reset cells that were marked as congested
    await pool.query(`
      UPDATE cell_table
      SET "AnomalyScore" = 0,
          "AnomalyFlag" = false
      WHERE "AnomalyScore" > 0
    `);
    
    // Delete old congestion KPIs
    const deleteResult = await pool.query(`
      DELETE FROM intermediate_kpi_table
      WHERE "KPIName" IN ('AVG_DL_PRB_UTIL', 'RRC_FAIL', 'DUAC_FAIL', 'CALL_DROP_RATE', 'HOSR', 'CSSR')
        AND "AnomalyFlag" = true
    `);
    
    console.log(`✅ Reset complete. Deleted ${deleteResult.rowCount} old congestion KPI records\n`);
    
    console.log('\n=== STEP 1: Identify Sites with Full Downtime (24h = 86400s) ===\n');
    
    // Find sites with 86400 second downtime
    const outageSites = await pool.query(`
      SELECT DISTINCT
        k."SiteID",
        s."SiteName",
        s."Latitude",
        s."Longitude",
        s."DateID",
        COUNT(DISTINCT k."CellID") as affected_cells,
        k."KPIName" as downtime_type,
        MAX(k."KPIValue") as max_downtime
      FROM intermediate_kpi_table k
      INNER JOIN site_table s ON k."SiteID" = s."SiteID" AND k."DateID" = s."DateID"
      WHERE k."KPIName" IN ('EUCELL_DOWNTIME_AUTO', 'EUCELL_DOWNTIME_MANUAL', 'EUCELL_DOWNTIME_SLEEP')
        AND k."KPIValue"::text != 'NaN'
        AND k."KPIValue" >= 86400
      GROUP BY k."SiteID", s."SiteName", s."Latitude", s."Longitude", s."DateID", k."KPIName"
      ORDER BY k."SiteID"
    `);
    
    console.log(`Found ${outageSites.rows.length} site-downtime records with full 24h downtime`);
    
    // Get unique sites
    const uniqueOutageSites = [...new Set(outageSites.rows.map(r => r.SiteID))];
    console.log(`Unique outage sites: ${uniqueOutageSites.length}\n`);
    
    if (uniqueOutageSites.length === 0) {
      console.log('No sites with full downtime found. Exiting.');
      pool.end();
      return;
    }
    
    // Update site_table to mark these as OUTAGE
    console.log('=== STEP 2: Update site_table - Mark sites as OUTAGE ===\n');
    
    const updateResult = await pool.query(`
      UPDATE site_table
      SET "AnomalyFlag" = true,
          "AnomalyScore" = 1.0
      WHERE "SiteID" = ANY($1::text[])
      RETURNING "SiteID", "SiteName", "AnomalyScore"
    `, [uniqueOutageSites]);
    
    console.log(`✅ Updated ${updateResult.rows.length} sites to OUTAGE status (AnomalyScore = 1.0)\n`);
    updateResult.rows.slice(0, 10).forEach(row => {
      console.log(`  ${row.SiteID}: ${row.SiteName} - Score: ${row.AnomalyScore}`);
    });
    
    console.log('\n=== STEP 3: Find Neighboring Sites (within 2km of outages) ===\n');
    
    // Find neighboring sites using distance calculation
    const neighbors = await pool.query(`
      WITH outage_sites AS (
        SELECT DISTINCT "SiteID", "Latitude", "Longitude", "DateID"
        FROM site_table
        WHERE "AnomalyScore" >= 0.9
          AND "Latitude" IS NOT NULL 
          AND "Longitude" IS NOT NULL
      ),
      all_sites AS (
        SELECT "SiteID", "SiteName", "Latitude", "Longitude", "DateID"
        FROM site_table
        WHERE "Latitude" IS NOT NULL 
          AND "Longitude" IS NOT NULL
          AND "AnomalyScore" < 0.9
      ),
      distances AS (
        SELECT DISTINCT
          a."SiteID",
          a."SiteName",
          a."Latitude",
          a."Longitude",
          a."DateID",
          o."SiteID" as nearby_outage_site,
          -- Calculate distance in km using Haversine approximation
          (
            6371 * acos(
              cos(radians(CAST(o."Latitude" AS NUMERIC))) * 
              cos(radians(CAST(a."Latitude" AS NUMERIC))) * 
              cos(radians(CAST(a."Longitude" AS NUMERIC)) - radians(CAST(o."Longitude" AS NUMERIC))) + 
              sin(radians(CAST(o."Latitude" AS NUMERIC))) * 
              sin(radians(CAST(a."Latitude" AS NUMERIC)))
            )
          ) as distance_km
        FROM all_sites a
        CROSS JOIN outage_sites o
        WHERE a."DateID" = o."DateID"
      )
      SELECT * FROM distances
      WHERE distance_km <= ${NEIGHBOR_DISTANCE_KM}
      ORDER BY "SiteID", distance_km
    `);
    
    console.log(`Found ${neighbors.rows.length} neighboring sites within ${NEIGHBOR_DISTANCE_KM}km of outages\n`);
    
    if (neighbors.rows.length === 0) {
      console.log('No neighboring sites found. This might mean outage sites are isolated.');
    } else {
      console.log('Sample neighbors:');
      neighbors.rows.slice(0, 10).forEach(row => {
        console.log(`  ${row.SiteID} (${row.SiteName}) - ${row.distance_km.toFixed(2)}km from ${row.nearby_outage_site}`);
      });
    }
    
    console.log('\n=== STEP 4: Add Congestion KPIs to 3-4 Cells Per Outage ===\n');
    
    // For each outage site, select 3-4 cells from nearby sites to mark as congested
    const uniqueOutageSiteIds = [...new Set(outageSites.rows.map(r => r.SiteID))];
    const kpiInserts = [];
    const cellsToFlag = new Map(); // Track which cells we're flagging
    
    for (const outageSiteId of uniqueOutageSiteIds) {
      // Get neighbors for this specific outage
      const nearbyNeighbors = neighbors.rows
        .filter(n => n.nearby_outage_site === outageSiteId)
        .slice(0, 5); // Top 5 closest neighbors
      
      if (nearbyNeighbors.length === 0) continue;
      
      // Get cells from these neighbors
      const neighborSiteIds = [...new Set(nearbyNeighbors.map(n => n.SiteID))];
      const cellsQuery = await pool.query(`
        SELECT c."CellID", c."SiteID", c."CellName", c."Technology", c."DateID", c."Azimuth"
        FROM cell_table c
        WHERE c."SiteID" = ANY($1::text[])
          AND c."DateID" = (SELECT MAX("DateID") FROM cell_table WHERE "DateID" = c."DateID")
          AND c."Azimuth" IS NOT NULL 
          AND c."Azimuth"::text != 'NaN'
        ORDER BY RANDOM()
      `, [neighborSiteIds]);
      
      // Select 3-4 random cells
      const numCellsToFlag = Math.min(getRandomInRange(3, 4), cellsQuery.rows.length);
      const selectedCells = cellsQuery.rows.slice(0, numCellsToFlag);
      
      console.log(`Outage ${outageSiteId}: Flagging ${selectedCells.length} cells from ${nearbyNeighbors.length} neighbors`);
      
      // Add high congestion KPIs to selected cells
      for (const cell of selectedCells) {
        cellsToFlag.set(cell.CellID, { ...cell, anomalyScore: 0.87 }); // High congestion score
        
        for (const [kpiName, range] of Object.entries(CONGESTION_KPIS)) {
          const value = getRandomInRange(range.min, range.max);
          kpiInserts.push({
            CellID: cell.CellID,
            SiteID: cell.SiteID,
            CellName: cell.CellName,
            KPIName: kpiName,
            KPIValue: value,
            Technology: cell.Technology,
            DateID: cell.DateID,
            AnomalyFlag: true,
            AnomalyScore: 0.87,  // High enough to show as CRITICAL (orange)
          });
        }
      }
    }
    
    console.log(`\nTotal cells to flag: ${cellsToFlag.size}`);
    console.log(`Total KPI records to insert: ${kpiInserts.length}\n`);
    
    console.log(`Prepared ${kpiInserts.length} congestion KPI records to insert`);
    
    // Batch insert in chunks
    let insertedKPIs = 0;
    const BATCH_SIZE = 500;
    for (let i = 0; i < kpiInserts.length; i += BATCH_SIZE) {
      const batch = kpiInserts.slice(i, i + BATCH_SIZE);
      const values = batch.map((kpi, idx) => {
        const baseIdx = i + idx;
        // Format date as YYYY-MM-DD
        const dateStr = kpi.DateID instanceof Date 
          ? kpi.DateID.toISOString().split('T')[0]
          : String(kpi.DateID).split('T')[0];
        
        return `(
          gen_random_uuid(),
          '${kpi.CellID}',
          (SELECT "SiteIDRef" FROM cell_table WHERE "CellID" = '${kpi.CellID}' LIMIT 1),
          '${kpi.SiteID}',
          '${kpi.CellName.replace(/'/g, "''")}',
          '${kpi.KPIName}',
          ${kpi.KPIValue},
          '${kpi.Technology}',
          ${kpi.AnomalyFlag},
          ${kpi.AnomalyScore},
          '${dateStr}'
        )`;
      }).join(',\n        ');
      
      const insertSQL = `
        INSERT INTO intermediate_kpi_table (
          "KPIID", "CellID", "SiteIDRef", "SiteID", "CellName", 
          "KPIName", "KPIValue", "Technology", "AnomalyFlag", "AnomalyScore", "DateID"
        ) VALUES ${values}
        ON CONFLICT DO NOTHING
      `;
      
      await pool.query(insertSQL);
      insertedKPIs += batch.length;
      console.log(`  Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(kpiInserts.length / BATCH_SIZE)} (${insertedKPIs} total)`);
    }
    
    console.log(`\n✅ Inserted ${insertedKPIs} congestion KPI records\n`);
    
    // Update cell_table to mark flagged cells with high anomaly scores
    const cellIds = [...cellsToFlag.keys()];
    if (cellIds.length > 0) {
      const cellUpdate = await pool.query(`
        UPDATE cell_table
        SET "AnomalyFlag" = true,
            "AnomalyScore" = 0.87
        WHERE "CellID" = ANY($1::text[])
        RETURNING "CellID", "SiteID", "AnomalyScore"
      `, [cellIds]);
      
      console.log(`✅ Updated ${cellUpdate.rows.length} cells with high congestion scores\n`);
    }
    
    // Mark parent sites of congested cells with elevated anomaly scores
    const sitesWithCongestedCells = [...new Set([...cellsToFlag.values()].map(c => c.SiteID))];
    if (sitesWithCongestedCells.length > 0) {
      const siteUpdate = await pool.query(`
        UPDATE site_table
        SET "AnomalyFlag" = true,
            "AnomalyScore" = CASE 
              WHEN "AnomalyScore" < 0.87 THEN 0.87
              ELSE "AnomalyScore"
            END
        WHERE "SiteID" = ANY($1::text[])
        RETURNING "SiteID", "AnomalyScore"
      `, [sitesWithCongestedCells]);
      
      console.log(`✅ Updated ${siteUpdate.rows.length} sites with congested cells\n`);
    }
    
    console.log('=== STEP 5: Summary ===\n');
    console.log(`Outage Sites (AnomalyScore = 1.0): ${uniqueOutageSites.length}`);
    console.log(`Congested Cells Near Outages: ${cellsToFlag.size}`);
    console.log(`Sites with Congested Cells (AnomalyScore = 0.87): ${sitesWithCongestedCells.length}`);
    console.log(`Congestion KPI Records Added: ${insertedKPIs}`);
    console.log(`\nVisualization:`);
    console.log(`  - Outage sites: RED (AnomalyScore = 1.0)`);
    console.log(`  - Congested cells/sites: ORANGE (AnomalyScore = 0.87)`);
    console.log(`  - Pattern: 3-4 congested cells per outage (realistic load spillover)`);
    
    console.log('\n✅ Done! Sites are now flagged and ready for visualization.\n');
    
    pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
    pool.end();
    process.exit(1);
  }
}

main();
