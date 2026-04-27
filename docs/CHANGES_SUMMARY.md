# Map Updates Summary

## Changes Implemented

### 1. Geographic Filtering (Union City, CA - 40 mile radius)

**Database Changes:**
- Created new `filtered_sites` table with 3,481 sites within 40 miles of Union City, CA (37.5935° N, 122.0177° W)
- Table includes `DistanceFromUnionCity` column for sorting
- Sites are sorted by distance from Union City (closest first)

**Backend Changes:**
- Updated `backend/src/models/site.model.ts` to query from `filtered_sites` table instead of `site_table`
- Removed date filtering and limit constraints (all filtered sites are returned)

**Script:**
- `scripts/create_union_city_sites.py` - Creates filtered sites table using Haversine distance calculation

---

### 2. Increased Site Circle Size

**Frontend Changes:**
- Increased site marker circle radius from 6px to 8px (normal state)
- Increased dragging state radius from 4px to 6px
- Increased stroke width from 2px to 2.5px (normal state)
- Increased stroke width from 1px to 1.5px (dragging state)

**File:** `frontend/src/components/MapView.tsx`

---

### 3. Clustering Behavior (Zoom Level 9)

**Frontend Changes:**
- Clustering now dynamically controlled: `cluster={viewState.zoom > 9}`
- When zooming IN past zoom 9: clustering stops, all sites appear individually
- When zooming OUT to zoom 9: clustering starts again
- Cluster settings: `clusterMaxZoom={9}`, `clusterRadius={50}`, `clusterMinPoints={3}`

**File:** `frontend/src/components/MapView.tsx`

---

### 4. Sector Shapes Visibility (Zoom Level 11)

**Frontend Changes:**
- Sector shapes now appear at zoom level ≥ 11 (was 10)
- When zooming IN past zoom 11: sector shapes appear
- When zooming OUT to zoom 11: sectors converge back to circles
- Updated helper text in hamburger menu: "Sectors visible at zoom ≥ 11"

**File:** `frontend/src/components/MapView.tsx`

---

## Database Statistics

```
Total sites in original database: 6,834
Filtered sites (Union City area): 3,481
Distance range: 0.4 to 40.0 miles

Top Clusters in filtered area:
- CASF-037: 162 sites
- CASF-041: 139 sites
- CASF-039: 127 sites
- CASF-059: 121 sites
- CASF-045: 120 sites
```

---

## Testing

✅ Backend running on port 3000
✅ Frontend running on port 5173
✅ Database has 3,481 filtered sites
✅ Sites sorted by distance from Union City

**To verify changes:**
1. Open map at http://localhost:5173
2. Zoom in/out around zoom level 9 to see clustering behavior
3. Zoom in/out around zoom level 11 to see sector appearance/disappearance
4. Notice larger site circles
5. Verify only Union City area sites are visible (San Francisco Bay Area)

---

## Files Modified

1. `backend/src/models/site.model.ts` - Query from filtered_sites
2. `frontend/src/components/MapView.tsx` - Circle size, clustering logic, sector visibility
3. `scripts/create_union_city_sites.py` - New filtering script (created)

---

## Coordinates Reference

**Union City, California:**
- Latitude: 37.5935° N
- Longitude: -122.0177° W
- Radius: 40 miles

**Closest Sites:**
1. UST851704 (0.4 miles)
2. UST852944 (0.6 miles)
3. UST641655 (0.9 miles)
