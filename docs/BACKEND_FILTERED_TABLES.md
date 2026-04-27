# Backend Updated to Use Filtered Tables (30 Miles)

## Summary

The backend has been updated to use **filtered tables** instead of the full database tables. All data now reflects only sites, cells, and sectors within **30 miles of Union City, California**.

---

## Changes Made

### 1. Site Model (`backend/src/models/site.model.ts`)
**Updated:** `getAllSites()` method

```typescript
// Before: FROM site_table
// After:  FROM filtered_sites
```

- Now queries `filtered_sites` table (3,288 sites)
- Sorts by `DistanceFromUnionCity` (closest first)
- Comment updated: "sites within 30 miles of Union City, CA"

---

### 2. Cell Model (`backend/src/models/cell.model.ts`)
**Updated:** `getCellsBySite()` and `getCellById()` methods

```typescript
// Before: FROM cell_table
// After:  FROM filtered_cell_table
```

- All cell queries now use `filtered_cell_table` (13,923 cells)
- Only returns cells for sites within 30-mile radius

---

### 3. Cell Sector Model (`backend/src/models/cellSector.model.ts`)
**Updated:** All methods using the view

```typescript
// Before: FROM cell_sector_map_view
// After:  FROM filtered_cell_sector_map_view
```

**Methods updated:**
- `getAllSectors()` - For map visualization
- `getSectorsBySite()` - For individual site queries
- `getSectorStats()` - For statistics

**View columns:**
- ✓ CellID, CellName, SiteID, SiteName
- ✓ Technology, Carrier, Azimuth, Height
- ✓ SiteLatitude, SiteLongitude, CellLatitude, CellLongitude
- ✓ CellAnomalyFlag, CellAnomalyScore, SiteAnomalyFlag, SiteAnomalyScore
- ✓ CellCount, DateID

---

### 4. Database View Recreated
**View:** `filtered_cell_sector_map_view`

```sql
CREATE VIEW filtered_cell_sector_map_view AS
SELECT 
    c."CellID", c."CellName", c."SiteID", s."SiteName",
    c."Technology", c."Carrier", c."Azimuth", c."Height",
    s."Latitude" as "SiteLatitude",
    s."Longitude" as "SiteLongitude",
    c."Latitude" as "CellLatitude",
    c."Longitude" as "CellLongitude",
    c."AnomalyFlag" as "CellAnomalyFlag",
    c."AnomalyScore" as "CellAnomalyScore",
    s."AnomalyFlag" as "SiteAnomalyFlag",
    s."AnomalyScore" as "SiteAnomalyScore",
    s."CellCount", c."DateID"
FROM filtered_cell_table c
JOIN filtered_sites s ON c."SiteID" = s."SiteID"
WHERE c."Azimuth" IS NOT NULL
```

- Joins filtered cells with filtered sites
- Includes all necessary columns for map rendering
- **13,923 rows** (down from original cell_sector_map_view)

---

## Data Being Served

| Endpoint | Table | Count |
|----------|-------|-------|
| GET /api/sites | filtered_sites | 3,288 |
| GET /api/cells | filtered_cell_table | 13,923 |
| GET /api/sectors | filtered_cell_sector_map_view | 13,923 |

---

## Geographic Coverage

**Center:** Union City, California (37.5935°N, -122.0177°W)  
**Radius:** 30 miles  
**Distance Range:** 0.4 to 30.0 miles  

**Sample sites (closest to Union City):**
1. UST851704 | CASF-015 | 0.4 mi
2. UST852944 | CASF-015 | 0.6 mi
3. UST641655 | CASF-015 | 0.9 mi
4. UST807581 | CASF-015 | 1.5 mi
5. UST152721 | CASF-015 | 1.6 mi

---

## Files Modified

1. `backend/src/models/site.model.ts` - Updated getAllSites()
2. `backend/src/models/cell.model.ts` - Updated cell queries
3. `backend/src/models/cellSector.model.ts` - Updated all sector queries
4. Database: Recreated `filtered_cell_sector_map_view` with proper columns

---

## Testing

### Verify Backend is Serving Filtered Data:

```bash
# Check health
curl http://localhost:3000/health

# Check sites count (should be ~3,288)
curl http://localhost:3000/api/sites | jq '.data | length'

# Check sectors
curl http://localhost:3000/api/sectors | jq '.data | length'
```

---

## Benefits

✅ **Reduced data size** - 51% of original sites  
✅ **Faster queries** - Smaller dataset  
✅ **Focused geography** - Only Bay Area sites  
✅ **Consistent filtering** - All related data filtered together  
✅ **Better performance** - Less data to transfer and render  

---

## Map Behavior

The map will now:
- Display **3,288 sites** (instead of 6,834)
- Show sectors for **13,923 cells**
- All sites within 30-mile radius of Union City
- Clustering behavior unchanged (stops at zoom 9)
- Sector visibility unchanged (appears at zoom 11)

---

*Last Updated: 2026-02-10*  
*Backend Port: 3000*  
*Status: ✅ Running*
