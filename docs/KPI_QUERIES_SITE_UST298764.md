# KPI Queries for Selected Site (e.g. Site_UST298764)

When you select **Site_UST298764** on the map, the UI uses **siteId = `UST298764`** for all API calls. Below are the HTTP calls, the SQL queries they run, and example responses.

---

## 1. Get KPI names that have data for this site (for Trends tab)

**HTTP**
```http
GET /api/sites/UST298764/kpis
```

**SQL** (from `KPIModel.getLatestKPIs(siteId)`)

```sql
SELECT "KPIName", AVG("KPIValue") as value
FROM intermediate_kpi_table
WHERE "SiteID" = 'UST298764'
  AND "DateID" = (
    SELECT MAX("DateID")
    FROM intermediate_kpi_table
    WHERE "SiteID" = 'UST298764'
  )
  AND "KPIValue" IS NOT NULL
GROUP BY "KPIName"
ORDER BY "KPIName";
```

**Sample response**
```json
{
  "success": true,
  "data": {
    "AVG_DL_PRB_UTIL": 94.2,
    "CALL_DROP_RATE": 6.1,
    "DATA_ACC_RATE": 98.5,
    "DATA_DROP_RATE": 0.2,
    "NS_ESO_AVAIL": 99.8,
    "PDCP_MB": 1250.3
  },
  "timestamp": "2026-02-05T12:00:00.000Z"
}
```

The frontend uses the **keys** of `data` as the list of KPI names to draw charts (up to 6).

---

## 2. Get KPI time series for each KPI (for charts)

For each KPI name from step 1, the frontend calls:

**HTTP**
```http
GET /api/sites/UST298764/kpis/{KPIName}?days=365
```

Example for one KPI:
```http
GET /api/sites/UST298764/kpis/AVG_DL_PRB_UTIL?days=365
GET /api/sites/UST298764/kpis/CALL_DROP_RATE?days=365
GET /api/sites/UST298764/kpis/DATA_ACC_RATE?days=365
... (one per KPI that had data in step 1)
```

**SQL** (from `KPIModel.getKPITimeSeries(siteId, kpiName, days)`)

With `days = 365` the query is:

```sql
SELECT
  "SiteID",
  "KPIName",
  "DateID",
  AVG("KPIValue")    AS value,
  BOOL_OR("AnomalyFlag") AS anomaly_flag,
  MAX("AnomalyScore")    AS anomaly_score
FROM intermediate_kpi_table
WHERE "SiteID" = 'UST298764'
  AND "KPIName" = 'AVG_DL_PRB_UTIL'
  AND "DateID" >= (
    SELECT MAX("DateID") FROM intermediate_kpi_table
  ) - INTERVAL '365 days'
GROUP BY "SiteID", "KPIName", "DateID"
ORDER BY "DateID" ASC;
```

Replace `'AVG_DL_PRB_UTIL'` with the KPI name for each request (e.g. `CALL_DROP_RATE`, `DATA_ACC_RATE`, etc.).

**Sample response** (one KPI time series)

```json
{
  "success": true,
  "data": {
    "siteId": "UST298764",
    "kpiName": "AVG_DL_PRB_UTIL",
    "timeSeries": [
      {
        "dateId": "2026-02-03",
        "value": 94.2,
        "anomalyFlag": false,
        "anomalyScore": 0
      }
    ],
    "aggregate": {
      "avg": 94.2,
      "min": 94.2,
      "max": 94.2,
      "count": 1
    }
  },
  "timestamp": "2026-02-05T12:00:00.000Z"
}
```

If the DB has multiple dates for this site+KPI, `timeSeries` will have one point per date.

---

## 3. Optional: global KPI date range (shown as “X days of data”)

**HTTP**
```http
GET /api/kpis/date-range
```

**SQL** (from `KPIModel.getKPIDateRange()`)

```sql
SELECT
  MIN("DateID")::text             AS min_date,
  MAX("DateID")::text             AS max_date,
  COUNT(DISTINCT "DateID")::text  AS distinct_days
FROM intermediate_kpi_table
WHERE "DateID" IS NOT NULL;
```

**Sample response**
```json
{
  "success": true,
  "data": {
    "minDate": "2026-02-03",
    "maxDate": "2026-02-03",
    "distinctDays": 1
  },
  "timestamp": "2026-02-05T12:00:00.000Z"
}
```

---

## Summary: flow when you select Site_UST298764

| Step | API | Purpose |
|------|-----|--------|
| 1 | `GET /api/sites/UST298764/kpis` | Which KPIs have data for this site (latest date) |
| 2 | `GET /api/kpis/date-range` | Label: “X days of data (min – max)” |
| 3 | `GET /api/sites/UST298764/kpis/{KPIName}?days=365` × N | Time series for each KPI for the charts |

All queries read from **`intermediate_kpi_table`**; the site is identified by **`"SiteID" = 'UST298764'`** (no “Site_” prefix in the DB).
