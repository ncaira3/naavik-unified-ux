# Observe Backend — Query Catalog (Unified UX)

Last updated: 2026-04-06

This file catalogs the **current SQL queries** used to power the **Observe** experience.

Because the backend uses **two different DB stacks** (local Postgres + remote Compass/warehouse), each query entry notes its data source and implementation location.

> Note: Many Compass/warehouse queries are currently built via string interpolation. For production, these should be migrated to parameterized queries with strict input validation.

---

## A) Observe endpoints (frontend call surface)

### Map (market view)
- `GET /api/compass/site-topology?date=` → `CompassModel.getSiteTopology()`
- `GET /api/compass/cell-sectors?date=` → `CompassModel.getCellSectors()`
- `GET /api/compass/offenders?date=` → `CompassModel.getOffenders()`
- `GET /api/compass/market/dashboard` → `CompassModel.getMarketDashboard()`

### Site analysis tile (site view)
- `GET /api/sites/:siteId/analysis/comprehensive?dateId=` → `SiteAnalysisModel.getComprehensiveAnalysis()`
- `GET /api/sites/:siteId/cell-topology?dateId=` → `SiteAnalysisModel.getCellTopology()`
- `GET /api/compass/site/:usid/nodes?date=` → `CompassModel.getNodesForUsid()`
- `GET /api/sites/:siteId/operational-info?dateId=&limit=` → `SiteAnalysisModel.getOperationalInfo()`
- `GET /api/sites/:siteId/cell-kpis?...` → `SiteAnalysisModel.getCellKpis()`
- `GET /api/sites/:siteId/traffic-profile?...` → `SiteAnalysisModel.getTrafficProfile()` (inside `siteAnalysis.model.ts`)
- `GET /api/sites/:siteId/mobility-trends?...` → `SiteAnalysisModel.getMobilityTrends()`
- `GET /api/sites/:siteId/outages?...` → `SiteAnalysisModel.getOutages()`
- `GET /api/sites/:siteId/cqx?...` → `SiteAnalysisModel.getCqxData()`

### Map overlays
- `GET /api/sites/layers/status?dateId=` → query embedded in `backend/src/routes/site.routes.ts`

---

## B) Query entries (by implementation file)

### B.1 Remote Compass warehouse queries

**Data source:** `NaavikDBConnector` (remote SQL Server-ish dialect)

#### `backend/src/models/siteAnalysis.model.ts`

1) `SiteAnalysisModel.getComprehensiveAnalysis(siteId, dateId)`
```sql
SELECT TOP 1 *
FROM site_table WITH (NOLOCK)
WHERE CAST(USID AS VARCHAR(64)) = '<realUsid>'
  AND CAST(DATE_ID AS DATE) <= CAST('<effectiveDate>' AS DATE)
ORDER BY CAST(DATE_ID AS DATE) DESC
```

2) `SiteAnalysisModel.getCellTopology(siteId, dateId)`
```sql
SELECT cell_name, AZIMUTH, HEIGHT, LATITUDE, LONGITUDE, TECH, USEID, USID, CARRIER, DATE_ID
FROM cell_table WITH (NOLOCK)
WHERE CAST(USID AS VARCHAR(64)) = '<realUsid>'
  AND CAST(DATE_ID AS DATE) = CAST('<effectiveDate>' AS DATE)
ORDER BY cell_name
```

3) `SiteAnalysisModel.getAvailableKpis(siteId, viewType)`
```sql
SELECT DISTINCT TOP 200 kpi_name
FROM <intermediate_kpi_table | hourly_intermediate_kpis_table> WITH (NOLOCK)
WHERE USID = '<realUsid>'
ORDER BY kpi_name
```

4) `SiteAnalysisModel.getCellKpis(siteId, params)`

4a) Timeline (4 anchor dates) — hourly table aggregate
```sql
SELECT
  CONVERT(DATE, DATE_ID) as DATE_ID,
  HOUR_ID,
  kpi_name,
  AVG(TRY_CAST(kpi_value AS FLOAT)) as avg_value
FROM hourly_intermediate_kpis_table WITH (NOLOCK)
WHERE USID = '<realUsid>'
  AND DATE_ID >= DATEADD(day, -14, CAST('<effectiveDate>' AS DATE))
  AND DATE_ID <  DATEADD(day, 1, CAST('<effectiveDate>' AS DATE))
  AND CONVERT(DATE, DATE_ID) IN (
    '<effectiveDate>',
    DATEADD(day, -1, '<effectiveDate>'),
    DATEADD(day, -7, '<effectiveDate>'),
    DATEADD(day, -14, '<effectiveDate>')
  )
  AND kpi_name IN (<kpiList>)
GROUP BY CONVERT(DATE, DATE_ID), HOUR_ID, kpi_name
ORDER BY CONVERT(DATE, DATE_ID), HOUR_ID, kpi_name
```

4b) Hourly — optionally includes neighbors for downtime KPIs
```sql
SELECT TOP 20000 USID, DATE_ID, HOUR_ID, cell_name, kpi_name, kpi_value
FROM hourly_intermediate_kpis_table WITH (NOLOCK)
WHERE USID IN (<usidList>)
  AND DATE_ID >= CAST('<startDate>' AS DATETIME)
  AND DATE_ID <  DATEADD(day, 1, CAST('<endDate>' AS DATETIME))
  AND kpi_name IN (<kpiList>)
ORDER BY DATE_ID, HOUR_ID, cell_name, kpi_name
```

4c) Daily — intermediate table
```sql
SELECT TOP 10000 USID, DATE_ID, cell_name, kpi_name, kpi_value
FROM intermediate_kpi_table WITH (NOLOCK)
WHERE USID = '<realUsid>'
  AND DATE_ID >= CAST('<startDate>' AS DATETIME)
  AND DATE_ID <= CAST('<endDate>' AS DATETIME)
  AND kpi_name IN (<kpiList>)
ORDER BY DATE_ID, cell_name, kpi_name
```

5) `SiteAnalysisModel.getMobilityTrends(siteId, dateId, days)`
```sql
SELECT SOURCE_USID, SOURCE_USID_FACE, NEIGH_USID, NEIGH_USID_FACE, HANDOVER_COUNT, HO_RANK,
       TOTAL_HANDOVER, CUMMULATIVE_SUM, PERC_HANDOVER, SOURCE_NEIGH_DISTANCE_METERS, DATE_ID
FROM neighbors_table_date_id WITH (NOLOCK)
WHERE CAST(SOURCE_USID AS VARCHAR(64)) = '<realUsid>'
  AND DATE_ID >= DATEADD(day, -<days>, CAST('<effectiveDate>' AS DATETIME))
  AND DATE_ID <  DATEADD(day, 1, CAST('<effectiveDate>' AS DATETIME))
ORDER BY DATE_ID DESC, SOURCE_USID_FACE, HO_RANK
```

6) `SiteAnalysisModel.getOutages(siteId, dateId, days)` (neighbor list + hourly outage KPIs)
```sql
SELECT DISTINCT NEIGH_USID
FROM neighbors_table_date_id WITH (NOLOCK)
WHERE SOURCE_USID = '<realUsid>'
  AND CAST(DATE_ID AS DATE) = CAST('<effectiveDate>' AS DATE)
```
```sql
SELECT DATE_ID, HOUR_ID, USID, kpi_name, cell_name, kpi_value
FROM hourly_intermediate_kpis_table WITH (NOLOCK)
WHERE CAST(DATE_ID AS DATE) >= CAST('<startDate>' AS DATE)
  AND CAST(DATE_ID AS DATE) <= CAST('<effectiveDate>' AS DATE)
  AND kpi_name IN ('EUCELL_DOWNTIME_AUTO','EUCELL_DOWNTIME_MANUAL','EUCELL_DOWNTIME_SLEEP','RRC_FAIL','DUAC_FAIL')
  AND CAST(USID AS VARCHAR(64)) IN (<allUsids>)
```

7) `SiteAnalysisModel.getCqxData(siteId, dateId, days, dataType)`

7a) value series from `subcomponent_table`
```sql
SELECT DATE_ID, USID, subcomponent_name, subcomponent_value
FROM subcomponent_table WITH (NOLOCK)
WHERE CAST(USID AS VARCHAR(64)) = '<realUsid>'
  AND subcomponent_name IN ('Total_Impact_Mkt_CQX', 'Total_Impact_Mkt_CQX_Delta', ... )
  AND CAST(DATE_ID AS DATE) >= CAST(DATEADD(day, -<days>, CAST('<effectiveDate>' AS DATE)) AS DATE)
  AND CAST(DATE_ID AS DATE) <= CAST('<effectiveDate>' AS DATE)
ORDER BY DATE_ID
```

7b) impact series from `cqx_offenders_truth_table`
```sql
SELECT DATE_ID, USID, DL_TPUT_IMP, UL_TPUT_IMP, DATA_DROP_IMP, DATA_ACC_IMP, ...
FROM cqx_offenders_truth_table WITH (NOLOCK)
WHERE CAST(USID AS VARCHAR(64)) = '<realUsid>'
  AND CAST(DATE_ID AS DATE) >= CAST(DATEADD(day, -<days>, CAST('<effectiveDate>' AS DATE)) AS DATE)
  AND CAST(DATE_ID AS DATE) <= CAST('<effectiveDate>' AS DATE)
ORDER BY DATE_ID
```

8) `SiteAnalysisModel.getOperationalInfo(siteId, dateId, limit)` composes:
- `getCellTopology(...)`
- `getOutages(...)`

> Additional queries exist in `siteAnalysis.model.ts` (traffic profile, correlation). Search within that file for `WITH (` and `SELECT` blocks.

#### `backend/src/models/compass.model.ts`

These power the Observe map and several dashboards.

1) `CompassModel.getDates()`
```sql
SELECT DISTINCT CAST(DATE_ID AS DATE) as DATE_ID
FROM subcomponent_table
ORDER BY DATE_ID DESC
```

2) `CompassModel.getDatesWithRca()`
```sql
SELECT DISTINCT CAST(DATE_ID AS DATE) as DATE_ID
FROM site_table
WHERE chain_of_thought IS NOT NULL
ORDER BY DATE_ID DESC
```

3) `CompassModel.getOffenders(dateId)`
```sql
SELECT TOP 50 s.USID, sc.subcomponent_value as Total_Impact_to_CQX_Delta
FROM (
  SELECT USID
  FROM site_table
  WHERE CAST(DATE_ID AS DATE) = '<date>'
    AND chain_of_thought IS NOT NULL
) s
INNER JOIN subcomponent_table sc
  ON s.USID = sc.USID
  AND CAST(sc.DATE_ID AS DATE) = '<date>'
  AND sc.subcomponent_name = 'Total_Impact_Mkt_CQX_Delta'
ORDER BY sc.subcomponent_value DESC
```

4) `CompassModel.getSiteTopology(dateId?)`
```sql
SELECT
  CAST(USID AS VARCHAR(64)) AS USID,
  ISNULL(site_name, CAST(USID AS VARCHAR(64))) AS site_name,
  CAST(latitude AS FLOAT) AS latitude,
  CAST(longitude AS FLOAT) AS longitude,
  CASE WHEN chain_of_thought IS NOT NULL THEN 1 ELSE 0 END AS is_offender,
  <clusterSelect>
FROM site_table WITH (NOLOCK)
WHERE <datePredicate>
  AND latitude IS NOT NULL AND longitude IS NOT NULL
  AND TRY_CAST(latitude AS FLOAT) IS NOT NULL
  AND TRY_CAST(longitude AS FLOAT) IS NOT NULL
```

5) `CompassModel.getCellSectors(dateId)`
- Rich query joins `cell_table`, `site_table`, `sector_table` and derives anomaly flags.
- Fallback queries:
  - Basic query without sector anomaly joins
  - Synthetic sector generation if the schema/date is missing

6) `CompassModel.getMarketDashboard()`
```sql
SELECT
  (SELECT COUNT(DISTINCT USID) FROM site_table WHERE CAST(DATE_ID AS DATE) = (SELECT MAX(CAST(DATE_ID AS DATE)) FROM site_table)) as total_sites,
  (SELECT COUNT(DISTINCT USEID) FROM cell_table WHERE CAST(DATE_ID AS DATE) = (SELECT MAX(CAST(DATE_ID AS DATE)) FROM cell_table)) as total_cells,
  (SELECT COUNT(DISTINCT USID) FROM site_table WHERE CAST(DATE_ID AS DATE) = (SELECT MAX(CAST(DATE_ID AS DATE)) FROM site_table) AND chain_of_thought IS NOT NULL) as total_offenders,
  CAST((SELECT MAX(CAST(DATE_ID AS DATE)) FROM site_table) AS DATE) as latest_date
```

7) `CompassModel.getNodesForUsid(siteId, dateId)`
```sql
SELECT DISTINCT
  SUBSTRING(cell_name, 1, CHARINDEX('_', cell_name) - 1) AS node_name
FROM cell_table WITH (NOLOCK)
WHERE CAST(USID AS VARCHAR(64)) = '<realUsid>'
  AND CAST(DATE_ID AS DATE) = '<date>'
  AND CHARINDEX('_', cell_name) > 0
ORDER BY node_name
```

8) `CompassModel.getSiteOperational(siteId, dateId)` (neighbors + alarms/tickets/config/outages/eim)
```sql
SELECT DISTINCT NEIGH_USID
FROM neighbors_table_date_id
WHERE SOURCE_USID = '<realUsid>'
  AND CAST(DATE_ID AS DATE) = '<date>'
```
```sql
SELECT * FROM alarm_table
WHERE USID IN (<realUsid + neighborUsids>)
  AND CAST(LASTOCCURRENCE AS DATE) >= DATEADD(day, -7, CAST('<date>' AS DATE))
```
```sql
SELECT * FROM ticket_table
WHERE USID IN (<realUsid + neighborUsids>)
  AND CAST(CREATE_TIME AS DATE) >= DATEADD(day, -7, CAST('<date>' AS DATE))
```
```sql
SELECT * FROM configuration_parameters_table
WHERE USID IN (<realUsid + neighborUsids>)
  AND parameter_name NOT LIKE '%PHYSICALLAYERCELLID%'
  AND parameter_name NOT LIKE '%PCI%'
  AND CAST(DATE_ID AS DATE) >= DATEADD(day, -7, CAST('<date>' AS DATE))
```
```sql
SELECT * FROM outage_table
WHERE USID IN (<realUsid + neighborUsids>)
  AND CAST(DATE_ID AS DATE) >= DATEADD(day, -7, CAST('<date>' AS DATE))
```
```sql
SELECT * FROM eim_table
WHERE USID IN (<realUsid + neighborUsids>)
  AND CAST(DATE_ID AS DATE) >= DATEADD(day, -7, CAST('<date>' AS DATE))
```

9) `CompassModel.getNeighbors(siteId, dateId)` (uses last available neighbor date)
```sql
SELECT TOP 1 CAST(DATE_ID AS DATE) as DATE_ID
FROM neighbors_table_date_id
WHERE SOURCE_USID = '<realUsid>'
ORDER BY DATE_ID DESC
```
```sql
SELECT *
FROM neighbors_table_date_id
WHERE SOURCE_USID = '<realUsid>'
  AND CAST(DATE_ID AS DATE) = '<lastDate>'
ORDER BY PERC_HANDOVER DESC
```

10) `CompassModel.getNeighborTrends(siteId, days)`
```sql
SELECT SOURCE_USID, NEIGH_USID, CAST(DATE_ID AS DATE) as DATE_ID, HANDOVER_COUNT, PERC_HANDOVER
FROM neighbors_table_date_id
WHERE SOURCE_USID = '<realUsid>'
  AND CAST(DATE_ID AS DATE) >= DATEADD(day, -<days>, CAST(GETDATE() AS DATE))
ORDER BY DATE_ID DESC, HANDOVER_COUNT DESC
```

11) `CompassModel.getNeighborHandoverTrend(sourceUsid, neighUsid, days)`
```sql
SELECT CAST(SOURCE_USID AS VARCHAR(64)) AS SOURCE_USID,
       CAST(NEIGH_USID AS VARCHAR(64)) AS NEIGH_USID,
       CAST(DATE_ID AS DATE) AS DATE_ID,
       HANDOVER_COUNT,
       PERC_HANDOVER
FROM neighbors_table_date_id WITH (NOLOCK)
WHERE CAST(SOURCE_USID AS VARCHAR(64)) = '<source>'
  AND CAST(NEIGH_USID AS VARCHAR(64)) = '<neigh>'
  AND CAST(DATE_ID AS DATE) >= DATEADD(day, -<days>, CAST(GETDATE() AS DATE))
ORDER BY CAST(DATE_ID AS DATE) ASC
```

12) `CompassModel.getNeighborKpiData(sourceUsid, dateId, kpiNames, sourceFace?, daysBack)`
- Neighbor list:
```sql
SELECT DISTINCT CAST(NEIGH_USID AS VARCHAR(64)) AS NEIGH_USID
FROM neighbors_table_date_id WITH (NOLOCK)
WHERE CAST(SOURCE_USID AS VARCHAR(64)) = '<source>'
  <optional SOURCE_USID_FACE filter>
  AND CAST(DATE_ID AS DATE) = '<date>'
```
- Hourly KPI pull (source + neighbors):
```sql
SELECT CAST(DATE_ID AS DATE) AS DATE_ID,
       CAST(HOUR_ID AS INT) AS HOUR_ID,
       CAST(USID AS VARCHAR(64)) AS USID,
       kpi_name,
       cell_name,
       CAST(kpi_value AS FLOAT) AS kpi_value
FROM hourly_intermediate_kpis_table WITH (NOLOCK)
WHERE CAST(USID AS VARCHAR(64)) IN (<source + neighborUsids>)
  AND CAST(DATE_ID AS DATE) >= '<startDate>'
  AND CAST(DATE_ID AS DATE) <= '<date>'
  AND kpi_name IN (<kpiList>)
ORDER BY DATE_ID DESC, HOUR_ID DESC, USID, cell_name
```

13) `CompassModel.getHourlyInsights(siteId, dateId, daysBack)`
```sql
SELECT USID,
       CAST(DATE_ID AS DATE) as DATE_ID,
       CAST(HOUR_ID AS INT) as HOUR_ID,
       cell_name,
       kpi_name,
       kpi_value
FROM hourly_intermediate_kpis_table
WHERE USID = '<realUsid>'
  AND CAST(DATE_ID AS DATE) >= '<startDate>'
  AND CAST(DATE_ID AS DATE) <= '<date>'
ORDER BY DATE_ID DESC, HOUR_ID DESC, cell_name
```

14) `CompassModel.getSiteCalendar(siteId, year, month)` (3 parallel queries)
```sql
SELECT CAST(DATE_ID AS DATE) as day_date,
       MAX(CASE WHEN anomaly_flag = 1 THEN 1 ELSE 0 END) as anomaly_flag,
       MAX(CAST(anomaly_score AS FLOAT)) as anomaly_score
FROM sector_table
WHERE USID = '<realUsid>'
  AND CAST(DATE_ID AS DATE) BETWEEN '<startDate>' AND '<endDate>'
GROUP BY CAST(DATE_ID AS DATE)
ORDER BY day_date
```
```sql
SELECT DISTINCT CAST(DATE_ID AS DATE) as day_date
FROM outage_table
WHERE USID = '<realUsid>'
  AND CAST(DATE_ID AS DATE) BETWEEN '<startDate>' AND '<endDate>'
```
```sql
SELECT DISTINCT CAST(DATE_ID AS DATE) as day_date
FROM site_table
WHERE USID = '<realUsid>'
  AND chain_of_thought IS NOT NULL
  AND CAST(DATE_ID AS DATE) BETWEEN '<startDate>' AND '<endDate>'
```

15) `CompassModel.getCalendarDateDetails(siteId, dateId)`
```sql
SELECT subcomponent_name, SUM(CAST(subcomponent_value AS FLOAT)) AS total_traffic
FROM subcomponent_table WITH (NOLOCK)
WHERE CAST(USID AS VARCHAR(64)) = '<realUsid>'
  AND CAST(DATE_ID AS DATE) = '<date>'
  AND subcomponent_name IN ('LTE_PDCP_MB','NR_PDCP_MB','SA_PDCP_MB','SMALLCELL_PDCP_MB')
GROUP BY subcomponent_name
```
```sql
SELECT TOP 10 cell_name, AVG(CAST(kpi_value AS FLOAT)) AS avg_quality
FROM intermediate_kpi_table WITH (NOLOCK)
WHERE CAST(USID AS VARCHAR(64)) = '<realUsid>'
  AND CAST(DATE_ID AS DATE) = '<date>'
  AND kpi_name LIKE '%QUALITY%'
GROUP BY cell_name
ORDER BY avg_quality DESC
```

16) `CompassModel.getSiteComprehensive(siteId, dateId)` (2 queries)
```sql
SELECT TOP 1 *
FROM site_table
WHERE USID = '<realUsid>'
  AND CAST(DATE_ID AS DATE) = '<date>'
```
```sql
SELECT *
FROM cell_table
WHERE USID = '<realUsid>'
  AND CAST(DATE_ID AS DATE) = '<date>'
```

17) `CompassModel.getAnomalousSectors(dateId)`
- Full SQL is large (CTE + ROW_NUMBER + join between `sector_table`, `cell_table`, `site_table`).
- See `backend/src/models/compass.model.ts:getAnomalousSectors` for the complete query.

18) `CompassModel.getNeighborRelationsWithCoords(siteId, dateId, face?)`
- Full SQL joins neighbor relations with site coordinates for map arrows.
- See `backend/src/models/compass.model.ts:getNeighborRelationsWithCoords` for the complete query.

19) `CompassModel.getTimelineSiteAggregateKpis(siteId, dateId, kpiNames)`
- Full SQL pulls site-level hourly KPI aggregates for 4 reference days (today, -1, -7, -14).
- See `backend/src/models/compass.model.ts:getTimelineSiteAggregateKpis` for the complete query.

20) `CompassModel.getSubcomponentData(siteId, dateId, days)` (subcomponent_table)
```sql
SELECT DATE_ID, USID, subcomponent_name, subcomponent_value
FROM subcomponent_table WITH (NOLOCK)
WHERE CAST(USID AS VARCHAR(64)) = '<realUsid>'
  AND CAST(DATE_ID AS DATE) >= DATEADD(day, -<days>, '<date>')
  AND CAST(DATE_ID AS DATE) <= '<date>'
ORDER BY DATE_ID DESC
```

21) `CompassModel.getSubcomponentImpactData(siteId, dateId, days)` (cqx_offenders_truth_table)
```sql
SELECT DATE_ID, USID, DL_TPUT_IMP, UL_TPUT_IMP, DATA_DROP_IMP, DATA_ACC_IMP, VRAN_ACC_IMP, VCDR_ACC_IMP, VOICE_DROP_IMP, NS_ESO_IMP, QUALITY_IMP
FROM cqx_offenders_truth_table WITH (NOLOCK)
WHERE CAST(USID AS VARCHAR(64)) = '<realUsid>'
  AND CAST(DATE_ID AS DATE) >= DATEADD(day, -<days>, '<date>')
  AND CAST(DATE_ID AS DATE) <= '<date>'
ORDER BY DATE_ID DESC
```

22) `CompassModel.getSiteAndNeighborOutages(siteId, dateId, days)`
- Neighbor list:
```sql
SELECT DISTINCT CAST(NEIGH_USID AS VARCHAR(64)) AS NEIGH_USID
FROM neighbors_table_date_id WITH (NOLOCK)
WHERE CAST(SOURCE_USID AS VARCHAR(64)) = '<realUsid>'
  AND CAST(DATE_ID AS DATE) = '<date>'
```
- Hourly outage KPI pull:
```sql
SELECT DATE_ID, CAST(HOUR_ID AS INT) AS HOUR_ID, CAST(USID AS VARCHAR(64)) AS USID,
       kpi_name, cell_name, CAST(kpi_value AS FLOAT) AS kpi_value
FROM hourly_intermediate_kpis_table WITH (NOLOCK)
WHERE CAST(DATE_ID AS DATE) >= '<startDate>'
  AND CAST(DATE_ID AS DATE) <= '<date>'
  AND kpi_name IN ('EUCELL_DOWNTIME_AUTO','EUCELL_DOWNTIME_MANUAL','EUCELL_DOWNTIME_SLEEP','RRC_FAIL','DUAC_FAIL')
  AND CAST(USID AS VARCHAR(64)) IN (<realUsid + neighborUsids>)
ORDER BY DATE_ID DESC, HOUR_ID, USID, cell_name
```

23) `CompassModel.getNeighborUsids(siteId, dateId)` (same query as in #22 neighbor list)

24) `CompassModel.getCellTopologyByDate(siteId, dateId)` (same shape as SiteAnalysisModel.getCellTopology)
```sql
SELECT cell_name, AZIMUTH, HEIGHT, LATITUDE, LONGITUDE, TECH, USEID, USID, CARRIER, DATE_ID
FROM cell_table WITH (NOLOCK)
WHERE CAST(USID AS VARCHAR(64)) = '<realUsid>'
  AND CAST(DATE_ID AS DATE) = '<date>'
ORDER BY cell_name
```

25) `CompassModel.getSiteCoordinates(usids[], dateId?)`
```sql
SELECT DISTINCT CAST(USID AS VARCHAR(64)) AS USID,
       CAST(latitude AS FLOAT) AS latitude,
       CAST(longitude AS FLOAT) AS longitude
FROM site_table WITH (NOLOCK)
WHERE CAST(USID AS VARCHAR(64)) IN (<usids>)
  <optional date filter>
  AND latitude IS NOT NULL AND longitude IS NOT NULL
ORDER BY USID
```

26) `CompassModel.getDataAvailability()` (union of table freshness checks)
- Full SQL is a UNION ALL across `site_table`, `subcomponent_table`, `intermediate_kpi_table`, etc.
- See `backend/src/models/compass.model.ts:getDataAvailability` for the complete query.

27) `CompassModel.getDataAvailabilityTrend(tableName, days)`
```sql
SELECT TOP <days>
  CAST(DATE_ID AS DATE) AS date,
  COUNT(*) AS record_count
FROM <tableName>
GROUP BY CAST(DATE_ID AS DATE)
ORDER BY CAST(DATE_ID AS DATE) DESC
```

28) `CompassModel.getSchemaAnalysis()` (columns + row counts across allowlisted tables)
```sql
SELECT COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = '<tableName>'
```
```sql
SELECT COUNT(*) as cnt FROM <tableName>
```

29) Market insight queries (used by Observe market dashboards)
- `CompassModel.getMarketOffenderInsights(dateId)` (large; see source)
- `CompassModel.getMarketCellHealthInsights(dateId)` (large; see source)

---

### B.2 Observe overlay query embedded in route

#### `backend/src/routes/site.routes.ts`

`GET /api/sites/layers/status?dateId=YYYY-MM-DD` runs:

1) Resolve date to latest available in intermediate KPIs:
```sql
SELECT TOP 1 CAST(DATE_ID AS DATE) AS RESOLVED_DATE
FROM intermediate_kpi_table WITH (NOLOCK)
WHERE DATE_ID <= CAST('<requestedDate>' AS DATETIME)
ORDER BY DATE_ID DESC
```

2) Site rollup for outage/overutilization using a CTE:
```sql
WITH cell_metrics AS (
  SELECT
    CAST(USID AS VARCHAR(64)) AS USID,
    DATE_ID,
    cell_name,
    MAX(CASE WHEN kpi_name IN ('PMDOWNTIMEAUTO','EUCELL_DOWNTIME_AUTO') THEN TRY_CAST(kpi_value AS FLOAT) END) AS pmd_auto,
    MAX(CASE WHEN kpi_name IN ('PMDOWNTIMEMANUAL','EUCELL_DOWNTIME_MANUAL') THEN TRY_CAST(kpi_value AS FLOAT) END) AS pmd_manual,
    MAX(CASE WHEN kpi_name IN ('AVG_DL_PRB_UTIL','DL_PRB_UTIL','DL_PRB_UTILIZATION') THEN TRY_CAST(kpi_value AS FLOAT) END) AS prb_util,
    MAX(CASE WHEN kpi_name = 'DUAC_FAIL' THEN TRY_CAST(kpi_value AS FLOAT) END) AS duac_fail
  FROM intermediate_kpi_table WITH (NOLOCK)
  WHERE DATE_ID >= CAST('<resolvedDate>' AS DATETIME)
    AND DATE_ID < DATEADD(day, 1, CAST('<resolvedDate>' AS DATETIME))
    AND kpi_name IN (...)
  GROUP BY CAST(USID AS VARCHAR(64)), DATE_ID, cell_name
),
site_map AS (
  SELECT CAST(USID AS VARCHAR(64)) AS USID, CAST(SiteID AS VARCHAR(64)) AS SITE_ID
  FROM site_table WITH (NOLOCK)
  WHERE DATE_ID >= CAST('<resolvedDate>' AS DATETIME)
    AND DATE_ID < DATEADD(day, 1, CAST('<resolvedDate>' AS DATETIME))
  GROUP BY CAST(USID AS VARCHAR(64)), CAST(SiteID AS VARCHAR(64))
),
site_rollup AS (
  SELECT
    USID,
    COUNT(*) AS total_cells,
    SUM(CASE WHEN COALESCE(pmd_auto,0)+COALESCE(pmd_manual,0) > 3600 THEN 1 ELSE 0 END) AS outage_cells,
    SUM(CASE WHEN COALESCE(prb_util,0) > 70 OR COALESCE(duac_fail,0) > 5000 THEN 1 ELSE 0 END) AS overutil_cells
  FROM cell_metrics
  GROUP BY USID
)
SELECT ...
FROM site_rollup ...
WHERE outage_cells > 0 OR overutil_cells > 0
```

---

## C) Local Postgres queries (demo / platform)

These are not the primary Observe path when Compass is enabled, but they exist and may still be invoked depending on environment.

#### `backend/src/models/site.model.ts`

1) Map site load from curated `filtered_sites`
```sql
SELECT
  s."SiteID", s."SiteName", s."Latitude", s."Longitude",
  s."CellCount", s."AnomalyFlag", s."AnomalyScore", s."ClusterID",
  COUNT(DISTINCT t.id) as ticket_count
FROM filtered_sites s
LEFT JOIN ticket_table t ON s."SiteID" = t."SiteID"
  AND t."TICKET_STATUS" IN ('Work In Progress', 'Assigned')
WHERE s."Latitude" IS NOT NULL AND s."Longitude" IS NOT NULL
GROUP BY ...
ORDER BY s."DistanceFromUnionCity"
```

> For production Observe, prefer one data source strategy (Compass warehouse or ingested local tables) and retire the unused path.
