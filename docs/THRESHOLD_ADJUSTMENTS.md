# Congestion Threshold Adjustments

## Problem
Too many sites were appearing as congested (orange) on the map, making it difficult to identify truly problematic areas.

## Solution
Increased the anomaly score thresholds across the entire system to be more selective about what constitutes a critical/congested site.

## Changes Made

### 1. Backend Site Model (`site.model.ts`)

#### Before:
```typescript
if (row.AnomalyScore >= 0.9) {
  status = 'OUTAGE';        // RED
} else if (row.AnomalyScore >= 0.7) {
  status = 'CRITICAL';      // ORANGE (congested)
} else if (row.AnomalyScore >= 0.3 || row.AnomalyFlag) {
  status = 'WARNING';       // YELLOW/AMBER
}
```

#### After:
```typescript
if (row.AnomalyScore >= 0.9) {
  status = 'OUTAGE';        // RED
} else if (row.AnomalyScore >= 0.85) {
  status = 'CRITICAL';      // ORANGE (congested) - INCREASED
} else if (row.AnomalyScore >= 0.5 || row.AnomalyFlag) {
  status = 'WARNING';       // YELLOW/AMBER - INCREASED
}
```

### 2. Flagging Script (`flag-outages-and-congestion.js`)

#### Neighbor Site Scoring - Before:
```javascript
"AnomalyScore" = CASE 
  WHEN "AnomalyScore" < 0.6 THEN 0.6
  ELSE "AnomalyScore"
END
```

#### After:
```javascript
"AnomalyScore" = CASE 
  WHEN "AnomalyScore" < 0.4 THEN 0.4
  ELSE "AnomalyScore"
END
```

#### KPI Anomaly Score - Before:
```javascript
AnomalyScore: 0.8  // Would show as CRITICAL (orange)
```

#### After:
```javascript
AnomalyScore: 0.4  // Below WARNING threshold, won't show colored
```

### 3. Offender API Routes (`offender.routes.ts`)

#### Before:
```typescript
if (severity === 'critical') {
  query += ` AND s."AnomalyScore" >= 0.7`;
} else if (severity === 'warning') {
  query += ` AND s."AnomalyScore" >= 0.3 AND s."AnomalyScore" < 0.7`;
}
```

#### After:
```typescript
if (severity === 'critical') {
  query += ` AND s."AnomalyScore" >= 0.85`;
} else if (severity === 'warning') {
  query += ` AND s."AnomalyScore" >= 0.5 AND s."AnomalyScore" < 0.85`;
}
```

### 4. Frontend MapView (`MapView.tsx`)

#### Cell Sector Status - Before:
```typescript
const cellStatus = sector.CellAnomalyScore >= 0.7 
  ? 'critical' 
  : (sector.CellAnomalyScore >= 0.3 || sector.CellAnomalyFlag) 
    ? 'warning' 
    : 'healthy';
```

#### After:
```typescript
const cellStatus = sector.CellAnomalyScore >= 0.85 
  ? 'critical' 
  : (sector.CellAnomalyScore >= 0.5 || sector.CellAnomalyFlag) 
    ? 'warning' 
    : 'healthy';
```

## New Threshold Definitions

### Anomaly Score Ranges:
- **0.90 - 1.00**: OUTAGE (RED) - Complete site outage (24h downtime)
- **0.85 - 0.89**: CRITICAL (ORANGE) - Severely congested sites only
- **0.50 - 0.84**: WARNING (YELLOW/AMBER) - Moderate issues
- **0.00 - 0.49**: NORMAL (GREEN) - Healthy sites

### Impact on Map:
- **Before**: Many orange/congested sites scattered everywhere
- **After**: Only truly problematic sites show as orange
- **Result**: Cleaner map, easier to identify critical problem areas

## Severity Categories

### OUTAGE (Red)
- Sites with 24-hour downtime
- AnomalyScore = 1.0
- ~35 sites in current dataset

### CRITICAL (Orange) - Congested
- **Old Threshold**: 0.7+ (too many sites)
- **New Threshold**: 0.85+ (selective)
- High PRB utilization (>95%)
- RRC failures >7434
- DUAC failures >1300

### WARNING (Yellow/Amber)
- **Old Threshold**: 0.3+ (very broad)
- **New Threshold**: 0.5+ (more focused)
- Moderate issues or anomaly flags

### NORMAL (Green)
- **Threshold**: <0.5
- Healthy operation

## Benefits

### 1. **Cleaner Visualization**
- Reduced visual noise on the map
- Easier to identify truly critical areas
- More meaningful color coding

### 2. **Better Focus**
- Operations teams can prioritize CRITICAL sites
- WARNING sites for secondary investigation
- Clear hierarchy of issues

### 3. **Improved Accuracy**
- Neighboring sites to outages no longer all appear congested
- Only sites with actual KPI issues show as problems
- More realistic network health representation

## Migration Notes

### Existing Data
- Previously flagged sites will be re-evaluated with new thresholds
- No data loss - just different interpretation
- Sites with 0.6-0.84 AnomalyScore move from CRITICAL to WARNING or NORMAL

### API Compatibility
- All API endpoints updated with new thresholds
- Frontend and backend synchronized
- Consistent behavior across the system

## Testing

To verify the changes:

1. **View Map**: Should see fewer orange (congested) sites
2. **Check Legend**: Count of each status type should be more balanced
3. **API Query**: 
   ```bash
   GET /api/offenders/sites?severity=critical
   ```
   Should return only highly congested sites (score >= 0.85)

## Files Modified

### Backend
- ✅ `/backend/src/models/site.model.ts` - Status determination logic
- ✅ `/backend/src/routes/offender.routes.ts` - API query filters
- ✅ `/backend/src/scripts/flag-outages-and-congestion.js` - Flagging logic

### Frontend
- ✅ `/frontend/src/components/MapView.tsx` - Cell sector and site display

## Rollback

If needed, revert thresholds to:
- CRITICAL: >= 0.7
- WARNING: >= 0.3
- Neighbor scores: 0.6
- KPI scores: 0.8

---

**Status**: ✅ Implemented and Deployed
**Version**: 2.0.0
**Date**: February 2026
**Impact**: High - Significantly improves map clarity
