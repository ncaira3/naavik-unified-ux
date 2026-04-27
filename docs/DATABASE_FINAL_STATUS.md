# 📊 Final Database Status - 30 Miles from Union City, CA

## Summary

**Geographic Coverage:**
- **Center:** Union City, California (37.5935°N, -122.0177°W)
- **Radius:** 30 miles (reduced from 40 miles)
- **Closest Site:** 0.4 miles
- **Farthest Site:** 30.0 miles

---

## Database Tables

### Core Filtered Tables (30-mile radius):

| Table | Count | Description |
|-------|-------|-------------|
| **filtered_sites** | **3,288** | Site locations with cluster info |
| **filtered_cell_table** | **13,923** | Cell tower data |
| **filtered_sector_table** | **3,166** | Sector configurations |
| **filtered_cell_sector_map_view** | **13,923** | View joining cells with site coordinates |

**Total Data Rows:** 20,377 (sites + cells + sectors)

---

## Data Metrics

### Site-Level Statistics:
- **Total Sites:** 3,288
- **Average Cells per Site:** 4.2
- **Average Sectors per Site:** 1.0

### Top 5 Clusters (by site count):
1. **CASF-037:** 162 sites
2. **CASF-041:** 139 sites
3. **CASF-039:** 126 sites
4. **CASF-059:** 121 sites
5. **CASF-045:** 120 sites

---

## Changes from Previous State

### Deleted Tables:
- ❌ `filtered_intermediate_kpi_table` (was 4,878 rows)
- ❌ `filtered_subcomponent_table` (was 251 rows)
- ❌ `filtered_cqx_offenders_truth_table` (was 32 rows)

### Radius Reduction:
- **Before:** 40 miles → 3,481 sites
- **After:** 30 miles → 3,288 sites
- **Reduction:** 193 sites removed (5.5% decrease)

---

## Geographic Coverage

### Coverage Area:
The filtered data covers the **San Francisco Bay Area** centered on Union City:
- **North:** Extends to Napa Valley area (~30 mi)
- **South:** Extends to Morgan Hill area (~30 mi)
- **East:** Extends to Livermore area (~30 mi)
- **West:** Extends to San Francisco Peninsula (~30 mi)

### Major Cities Included (estimated):
- Union City (center)
- Fremont
- San Jose (partial)
- Oakland (partial)
- San Francisco (partial)
- Hayward
- Pleasanton
- Palo Alto
- Mountain View
- Sunnyvale

---

## Database Schema

### filtered_sites
```sql
"SiteID" VARCHAR(50) PRIMARY KEY
"SiteName" VARCHAR(255)
"Latitude" NUMERIC
"Longitude" NUMERIC
"CellCount" INTEGER
"ClusterID" VARCHAR(50)
"RealUSID" VARCHAR(50)
"DateID" VARCHAR(50)
"AnomalyFlag" BOOLEAN
"AnomalyScore" NUMERIC
"DistanceFromUnionCity" NUMERIC
```

### filtered_cell_table
```sql
id INTEGER
"CellID" VARCHAR(50)
"SiteIDRef" VARCHAR(50)
"CellName" VARCHAR(255)
"NumKPIs" INTEGER
"Azimuth" NUMERIC
"Height" NUMERIC
"Latitude" NUMERIC
"Longitude" NUMERIC
"Technology" VARCHAR(50)
"SiteID" VARCHAR(50)
"Carrier" VARCHAR(50)
"DateID" DATE
"AnomalyFlag" BOOLEAN
"AnomalyScore" NUMERIC
created_at TIMESTAMP
```

### filtered_sector_table
```sql
id INTEGER
site_id VARCHAR(50)
azimuth NUMERIC
created_at TIMESTAMP
```

---

## Status

✅ **Database cleaned and optimized**
✅ **Only core tables remain (sites, cells, sectors)**
✅ **Filtered to 30-mile radius from Union City**
✅ **Ready for map visualization**

---

## Next Steps

To use this filtered data:
1. Backend is already configured to query `filtered_sites`
2. Map will display only these 3,288 sites
3. Sector shapes will be drawn from `filtered_cell_table` via `filtered_cell_sector_map_view`
4. All sites are within 30 miles of Union City, CA

---

*Last Updated: 2026-02-10*
*Database: naavik_demo*
*Filter Radius: 30 miles*
*Total Sites: 3,288*
