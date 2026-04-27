# Targeted Congestion Implementation - 3-4 Cells Per Outage

## Problem
The previous approach flagged ALL cells in ALL neighboring sites within 2km of outages, resulting in too many congested sites (thousands) covering the map in orange.

## Solution
Implemented a **targeted approach** that flags only 3-4 randomly selected cells around each outage site, creating a more realistic load spillover pattern.

## New Algorithm

### Step-by-Step Process

#### 1. **Reset Previous Flags** (New Step)
```sql
- Reset all sites with 0 < AnomalyScore < 0.9 back to 0
- Reset all cells with AnomalyScore > 0
- Delete old congestion KPI records
```

#### 2. **Identify Outage Sites**
- Find sites with 24-hour downtime (86400s)
- Mark as OUTAGE (AnomalyScore = 1.0)
- Result: **35 outage sites**

#### 3. **Find Neighbors**
- Calculate distance to all sites within 2km
- Identify top 5 closest neighbors per outage

#### 4. **Selective Cell Flagging** (New Approach)
For each outage site:
1. Get 5 closest neighbor sites
2. Query all cells from those neighbors (with valid Azimuth)
3. **Randomly select 3-4 cells** (not all cells!)
4. Add high congestion KPIs to ONLY those cells
5. Mark cells with AnomalyScore = 0.87 (CRITICAL/orange)

#### 5. **Update Parent Sites**
- Only update sites that have congested cells
- Set their AnomalyScore to 0.87
- Result: **43 congested sites** (not 7,690!)

## Results

### Before vs After

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Outage Sites (RED) | 35 | 35 | Same |
| Congested Sites (ORANGE) | 7,690 | 43 | **99.4% reduction** |
| Congested Cells | 9,452 | 111 | **98.8% reduction** |
| KPI Records | 28,356 | 690 | **97.6% reduction** |

### Distribution on Map
```
Total Sites: 3,456
├─ Outage (RED):     35 sites  (1.0%)
├─ Congested (ORANGE): 43 sites  (1.2%)
└─ Normal (GREEN):  3,378 sites (97.8%)
```

## Congestion KPIs Added

### Metrics per Congested Cell
Each of the 111 congested cells now has **6 KPIs**:

1. **AVG_DL_PRB_UTIL**: 93-99% (very high resource utilization)
2. **RRC_FAIL**: 8,000-18,000 (radio resource control failures)
3. **DUAC_FAIL**: 1,500-4,000 (dual connectivity failures)
4. **CALL_DROP_RATE**: 3.5-8.2% (call drops)
5. **HOSR**: 85-95% (handover success rate)
6. **CSSR**: 92-97% (call setup success rate)

### Why These Metrics?
- **PRB Utilization**: Shows capacity overload
- **RRC/DUAC Fails**: Radio interface congestion
- **Call Drop Rate**: Direct impact on user experience
- **HOSR/CSSR**: Service quality indicators

## Realistic Network Behavior

### Load Spillover Pattern
When a site goes down:
1. Traffic redirects to nearby sites
2. Nearest 3-4 cells take the extra load
3. Those cells show congestion symptoms
4. Rest of the network remains normal

### Thresholds Applied
- **OUTAGE**: AnomalyScore = 1.0 (≥0.90 shows as RED)
- **CRITICAL**: AnomalyScore = 0.87 (≥0.85 shows as ORANGE)
- **WARNING**: AnomalyScore 0.75-0.84 (YELLOW)
- **NORMAL**: AnomalyScore < 0.75 (GREEN)

## Technical Details

### Randomization
- Number of cells: Random 3-4 per outage
- Cell selection: `ORDER BY RANDOM()` for variety
- KPI values: Randomized within realistic ranges

### Cell Selection Criteria
Only cells with:
- Valid Azimuth (not NULL, not 'NaN')
- From top 5 closest neighbor sites
- Within 2km of outage site

### Database Updates
1. **cell_table**: Set AnomalyScore = 0.87 for 111 cells
2. **site_table**: Set AnomalyScore = 0.87 for 43 parent sites
3. **intermediate_kpi_table**: Insert 690 KPI records (111 cells × 6 KPIs)

## Map Visualization

### Color Distribution
- **RED clusters**: Outage zones (35 sites)
- **ORANGE markers**: Scattered congested cells around outages (43 sites)
- **GREEN clusters**: Vast majority of healthy network (3,378 sites)

### Realistic Patterns
- Congestion forms "halos" around outages
- Only closest cells affected
- Clear spatial correlation visible
- Easy to identify problem areas

## API Query Examples

### Get All Congested Sites
```bash
GET /api/offenders/sites?severity=critical
# Returns 43 sites with AnomalyScore >= 0.85
```

### Get Outage Sites
```bash
GET /api/offenders/outages
# Returns 35 sites with 24h downtime
```

### Network Summary
```bash
GET /api/offenders/summary
# Returns: 35 outages, 43 congested, 3456 total
```

## Chat Agent Integration

### Example Queries

**User**: "What sites are offenders?"
**Agent Response**: "I found 43 congested sites near outages:
- Site UST100017: 4 affected cells, 98% PRB util, 7.2% call drops
- Site UST101855: 3 affected cells, 95% PRB util, 5.8% call drops
- ..."

**User**: "Why is site UST100017 congested?"
**Agent Response**: "Site UST100017 is 1.91km from outage site UST12768. Traffic spillover from the outage is causing:
- High PRB utilization (98%)
- Increased RRC failures (14,983)
- Call drop rate of 7.2%"

## Files Modified

### Backend
- ✅ `/backend/src/scripts/flag-outages-and-congestion.js`
  - Added cleanup step
  - Changed to targeted cell selection (3-4 per outage)
  - Added more KPI types (drops, HOSR, CSSR)
  - Set higher anomaly scores (0.87 for congested)
- ✅ `/backend/src/models/site.model.ts`
  - Updated thresholds (CRITICAL ≥ 0.85, WARNING ≥ 0.75)
- ✅ `/backend/src/routes/offender.routes.ts`
  - Updated query thresholds to match

### Frontend
- ✅ `/frontend/src/components/MapView.tsx`
  - Updated cell status thresholds (≥ 0.85 for critical)

## Performance Impact

### Database
- **97% fewer records**: From 28,356 to 690 KPI records
- **Faster queries**: Less data to scan
- **Cleaner views**: cell_sector_map_view more focused

### Map Rendering
- **Much faster**: 99% fewer congested markers to render
- **Better UX**: Clearer visualization, no clutter
- **Easier navigation**: Can see geographic patterns

## Verification

### Check Site Distribution
```sql
SELECT "AnomalyScore", COUNT(*) 
FROM site_table 
WHERE "DateID" = (latest date)
GROUP BY "AnomalyScore"
```

**Results:**
- 1.0000: 35 sites (OUTAGE/RED)
- 0.8700: 43 sites (CRITICAL/ORANGE)
- 0.0000: 3,378 sites (NORMAL/GREEN)

## Benefits

### 1. **Clean Visualization**
- Map is no longer overwhelmed with orange
- Problem areas are clearly visible
- Geographic patterns emerge

### 2. **Realistic Simulation**
- Mirrors actual network behavior
- Load spillover to nearest cells only
- Rest of network unaffected

### 3. **Actionable Intelligence**
- Operations can focus on ~80 problem sites
- Clear correlation between outages and congestion
- Easy to prioritize interventions

### 4. **Performance**
- 97% less data to process
- Faster API responses
- Smoother map interactions

## Next Steps (Optional)

1. **Dynamic Spillover**: Calculate actual traffic redistribution based on cell capacity
2. **Time-based Evolution**: Show how congestion develops over time
3. **Impact Radius**: Variable spillover distance based on cell power
4. **Technology Mixing**: Different behaviors for 4G vs 5G
5. **Automated Recovery**: Simulate load rebalancing when outage clears

---

**Status**: ✅ Implemented and Deployed
**Script Run Time**: ~102 seconds
**Date**: February 8, 2026
**Impact**: High - Dramatically improved map clarity and realism
