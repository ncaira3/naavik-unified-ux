# LTE Time Series Data Update - Summary

## Overview
Successfully fetched LTE Hourly and Daily KPI data from the remote Naavik database, anonymized it, and loaded it into the local Postgres database. Added hourly/daily toggle functionality to the frontend charts.

## Data Fetched
- **10 USIDs** from the remote database
- **Date Range**: February 2-9, 2026 (7 days)
- **Hourly Records**: 19,008 records
- **Daily Records**: 700 records

## KPIs Included
- DATA_ACC_RATE
- DATA_DROP_RATE
- NS_ESO_AVAIL
- PDCP_MB
- DL_DRB_TPUT
- AVG_DL_PRB_UTIL
- UL_DRB_TPUT
- AVG_UL_PRB_UTIL
- VOICE_ACC_RATE
- VOICE_DROP_RATE

## Anonymization
- Real USIDs were mapped to dummy Site IDs in UST format (e.g., UST608436)
- Cell names were anonymized using hash-based NODE identifiers
- No real network data is exposed in the dummy database

## Database Changes

### New Table: `hourly_kpi_table`
```sql
CREATE TABLE hourly_kpi_table (
    id SERIAL PRIMARY KEY,
    site_id VARCHAR(255),
    cell_name VARCHAR(255),
    kpi_name VARCHAR(255),
    kpi_value DECIMAL(20,6),
    date_id DATE,
    hour_id INTEGER,
    anomaly_flag BOOLEAN DEFAULT FALSE,
    anomaly_score DECIMAL(10,4) DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Updated Table: `intermediate_kpi_table`
- Added 700 new records for the 10 sites with 7 days of data
- Replaced existing single-day data for these sites

## Backend Changes

### 1. KPI Model (`backend/src/models/kpi.model.ts`)
- Added `hourId` field to `KPITimeSeriesPoint` interface
- Added new method `getKPITimeSeriesHourly()` for hourly data
- Updated `getKPITimeSeries()` to accept `granularity` parameter ('daily' | 'hourly')

### 2. Site Routes (`backend/src/routes/site.routes.ts`)
- Updated `/api/sites/:siteId/kpis/:kpiName` endpoint
- Added `granularity` query parameter support
- Updated cache keys to include granularity

### 3. API Service (`frontend/src/services/api.ts`)
- Updated `getSiteKPITimeSeries()` method to accept granularity parameter

## Frontend Changes

### 1. SiteKpiTrends Component (`frontend/src/components/SiteKpiTrends.tsx`)
- Added `granularity` state ('daily' | 'hourly')
- Added toggle buttons for switching between Daily and Hourly views
- Added `formatTimeLabel()` function to format hourly timestamps (MM/DD HH:00)
- Updated chart configuration to handle hourly labels with rotation
- Limited hourly data fetching to max 7 days (to prevent excessive data)

## Scripts Created

### 1. `scripts/fetch_lte_timeseries_data.py`
- Fetches LTE Hourly and Daily data from remote Naavik database
- Anonymizes USIDs and cell names
- Saves to CSV files (`data/lte_hourly_timeseries.csv`, `data/lte_daily_timeseries.csv`)
- Loads data into Postgres database

### 2. `scripts/load_timeseries_to_postgres.py`
- Loads pre-fetched CSV data into Postgres
- Creates hourly_kpi_table if needed
- Updates intermediate_kpi_table with new daily data
- Provides database statistics after loading

## Database Statistics After Loading
- **Hourly KPI Table**: 19,008 records across 2 dates
- **Daily KPI Table**: ~174,240 total records, 2 distinct dates

## How to Use

### Frontend - Toggle Between Views
1. Navigate to Observe view and select a site
2. In the KPI Trends section, use the "Granularity" toggle
3. Click "Daily" for day-by-day trends
4. Click "Hourly" for hour-by-hour trends (last 7 days)

### API Usage
```bash
# Daily data
GET /api/sites/{siteId}/kpis/{kpiName}?days=7&granularity=daily

# Hourly data
GET /api/sites/{siteId}/kpis/{kpiName}?days=7&granularity=hourly
```

### Re-fetch Data
```bash
cd /Users/admin/nirmalc/Code/Naavik/naavik_unified_ux

# Fetch new data from remote database and load to Postgres
python3 scripts/fetch_lte_timeseries_data.py

# Or just load existing CSV files
python3 scripts/load_timeseries_to_postgres.py
```

## Files Modified
- `backend/src/models/kpi.model.ts`
- `backend/src/routes/site.routes.ts`
- `frontend/src/services/api.ts`
- `frontend/src/components/SiteKpiTrends.tsx`

## Files Created
- `scripts/fetch_lte_timeseries_data.py`
- `scripts/load_timeseries_to_postgres.py`
- `data/lte_hourly_timeseries.csv`
- `data/lte_daily_timeseries.csv`
- `DATA_UPDATE_SUMMARY.md` (this file)

## Next Steps (Optional)
1. Expand to more USIDs (currently only 10 for testing)
2. Add more date ranges (currently 7 days)
3. Add data refresh scheduling (cron job)
4. Add data quality checks and validation
5. Add export functionality for time series data

## Testing
1. Start the backend: `cd backend && npm run dev`
2. Start the frontend: `cd frontend && npm run dev`
3. Navigate to Observe view
4. Select a site (e.g., UST608436, UST213781, etc.)
5. Toggle between Daily and Hourly views in the KPI Trends section
6. Verify charts display proper data with correct time labels

## Notes
- Hourly data is limited to 7 days max to prevent excessive data loading
- All Site IDs are anonymized/dummified - no real network data is exposed
- Data is cached in the backend for 180 seconds
- Charts automatically adjust labels based on granularity (rotate for hourly)
