# Outage and Congestion Flagging - Implementation Summary

## Overview
Successfully implemented a system to flag sites with complete outages and identify congested neighboring sites. The data is now available for visualization on the map and can be queried through the API.

## What Was Done

### 1. Database Flagging Script
Created `/backend/src/scripts/flag-outages-and-congestion.js` which:
- ✅ Identifies sites with 24-hour downtime (86400 seconds)
- ✅ Marks them as OUTAGE sites (AnomalyScore = 1.0)
- ✅ Finds neighboring sites within 2km of outages
- ✅ Adds synthetic congestion KPIs to neighboring sites:
  - `AVG_DL_PRB_UTIL`: 90-98%
  - `RRC_FAIL`: > 7434
  - `DUAC_FAIL`: > 1300

### 2. Results from Script Execution
```
Outage Sites (AnomalyScore = 1.0): 35 sites
Congested Neighbor Sites (AnomalyScore >= 0.6): 7,690 sites
Congestion KPI Records Added: 28,356 records
```

### 3. New API Endpoints
Created `/backend/src/routes/offender.routes.ts` with three endpoints:

#### GET /api/offenders/summary
Returns network health summary:
```json
{
  "success": true,
  "data": {
    "outageSites": 35,
    "congestedSites": 925,
    "totalSites": 3456,
    "healthySites": 2496,
    "dateId": "2026-02-03T08:00:00.000Z"
  }
}
```

#### GET /api/offenders/sites?limit=50&severity=critical&includeOutages=false
Returns congested sites with details:
- Site ID, name, coordinates
- Anomaly score and flag
- Affected cells count
- Max PRB utilization, RRC failures, DUAC failures

#### GET /api/offenders/outages?limit=50
Returns complete outage sites:
- Site ID, name, coordinates
- Anomaly score
- Cells with downtime
- Max downtime in seconds

### 4. Map Visualization Updates
Updated `/frontend/src/components/MapView.tsx`:
- ✅ Changed CRITICAL status color from red (#ef4444) to orange (#f97316) for congested sites
- ✅ OUTAGE status displays in red (#dc2626)
- ✅ Updated legend to show "Congested" instead of "Critical"
- ✅ Cluster colors now scale: green → amber → orange → red

### 5. Status Mapping (Backend Logic)
Sites are automatically categorized based on AnomalyScore:
- **OUTAGE**: AnomalyScore >= 0.9 (RED on map)
- **CRITICAL**: AnomalyScore >= 0.7 (ORANGE - congested on map)
- **WARNING**: AnomalyScore >= 0.3 or AnomalyFlag (AMBER on map)
- **NORMAL**: All others (GREEN on map)

## How to Use

### For Chat Agent Queries
When users ask "What sites are offenders?" the agent can now query:
```bash
GET /api/offenders/sites?limit=50
```

To get outage sites specifically:
```bash
GET /api/offenders/outages?limit=50
```

To get a quick summary:
```bash
GET /api/offenders/summary
```

### For Thematic Maps
The map will automatically display:
- **RED markers**: Complete outage sites (24h downtime)
- **ORANGE markers**: Congested sites (high PRB util, RRC failures, DUAC failures)
- **AMBER markers**: Warning-level anomalies
- **GREEN markers**: Normal sites

### Filtering
Cluster colors scale based on density:
- < 10 sites: Green
- 10-49 sites: Amber
- 50-99 sites: Orange
- 100+ sites: Red

## Example Queries for Agent

**User**: "What sites are offenders?"
**Agent can respond with**:
- "I found 925 congested sites in the network. Here are the top offenders:
  - Site UST159019: 801 affected cells, 98% PRB utilization, 14,983 RRC failures
  - Site UST81964: 363 affected cells, 98% PRB utilization, 14,988 RRC failures
  - ..."

**User**: "Show me sites that are completely down"
**Agent can respond with**:
- "There are 35 sites experiencing complete outages (24-hour downtime):
  - [List of sites from /api/offenders/outages]"

## Files Modified

### Backend
- ✅ `/backend/src/routes/offender.routes.ts` (NEW)
- ✅ `/backend/src/scripts/flag-outages-and-congestion.js` (NEW)
- ✅ `/backend/src/server.ts` (Added offender routes)

### Frontend
- ✅ `/frontend/src/components/MapView.tsx` (Updated colors and legend)

## Next Steps (Optional)
1. Add thematic map layer toggle to show/hide congestion overlay
2. Create a dedicated "Offenders" panel in the UI
3. Add filtering by KPI type (PRB util vs RRC failures vs DUAC failures)
4. Implement automated alerting for new outages
5. Add historical trending for congestion patterns

## Technical Notes
- All congestion KPIs are synthetic (randomized within specified ranges)
- Neighbor calculation uses Haversine formula (2km radius)
- Data is on DateID: 2026-02-03 (most recent date with >100 sites)
- Map cache may need to be cleared (sessionStorage) to see updated colors
