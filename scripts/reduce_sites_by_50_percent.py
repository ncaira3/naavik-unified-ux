import os
"""
Reduce filtered sites by 50% - change radius from 30 miles to 21 miles
This will give us approximately 1,644 sites (50% of 3,288)
"""
import psycopg2
from math import radians, cos, sin, asin, sqrt
from psycopg2.extras import execute_values

PG_CONFIG = {
    'host': 'localhost',
    'database': 'naavik_demo',
    'user': 'naavik_user',
    'password': 'naavik_pass_2026',
    'port': int(os.getenv('DB_PORT', '5433'))
}

# Union City, California coordinates
UNION_CITY_LAT = 37.5935
UNION_CITY_LON = -122.0177
NEW_RADIUS_MILES = 21  # Reduced from 30 to get ~50% fewer sites

def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate distance in miles between two points"""
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    dlon = lon2 - lon1 
    dlat = lat2 - lat1 
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a)) 
    return c * 3956  # Earth radius in miles

print("=" * 80)
print(f"REDUCING SITES BY 50% - NEW RADIUS: {NEW_RADIUS_MILES} MILES")
print("=" * 80)

conn = psycopg2.connect(**PG_CONFIG)
cur = conn.cursor()

# Get current counts
print("\n📊 BEFORE:")
cur.execute('SELECT COUNT(*) FROM filtered_sites')
old_site_count = cur.fetchone()[0]
print(f"   Filtered sites: {old_site_count:,}")

# Step 1: Get all sites from site_table and filter by new radius
print(f"\n📍 Step 1: Filtering sites to {NEW_RADIUS_MILES} miles from Union City...")

cur.execute("""
    SELECT DISTINCT ON ("SiteID") 
        "SiteID", "SiteName", "Latitude", "Longitude", 
        "CellCount", "ClusterID", "RealUSID", "DateID",
        "AnomalyFlag", "AnomalyScore"
    FROM site_table
    ORDER BY "SiteID", "DateID" DESC
""")

sites = cur.fetchall()
filtered_site_ids = set()
filtered_sites = []

for site in sites:
    site_id, site_name, lat, lon = site[0], site[1], site[2], site[3]
    distance = haversine_distance(UNION_CITY_LAT, UNION_CITY_LON, float(lat), float(lon))
    
    if distance <= NEW_RADIUS_MILES:
        filtered_site_ids.add(site_id)
        filtered_sites.append(site + (distance,))

filtered_sites.sort(key=lambda x: x[10])
print(f"   ✅ New filtered sites: {len(filtered_sites):,} (from {len(sites):,})")
print(f"   📉 Reduction: {((old_site_count - len(filtered_sites)) / old_site_count * 100):.1f}%")

# Step 2: Recreate filtered_sites
print(f"\n🔄 Step 2: Updating filtered_sites table...")
cur.execute('DROP TABLE IF EXISTS filtered_sites CASCADE')
cur.execute("""
    CREATE TABLE filtered_sites (
        "SiteID" VARCHAR(50) PRIMARY KEY,
        "SiteName" VARCHAR(255),
        "Latitude" NUMERIC,
        "Longitude" NUMERIC,
        "CellCount" INTEGER,
        "ClusterID" VARCHAR(50),
        "RealUSID" VARCHAR(50),
        "DateID" VARCHAR(50),
        "AnomalyFlag" BOOLEAN,
        "AnomalyScore" NUMERIC,
        "DistanceFromUnionCity" NUMERIC
    )
""")
execute_values(cur, 'INSERT INTO filtered_sites VALUES %s', filtered_sites)
conn.commit()
print(f"   ✅ Updated: {len(filtered_sites):,} sites")

# Step 3: Update filtered_cell_table
print(f"\n📡 Step 3: Updating filtered_cell_table...")
cur.execute("""
    SELECT * FROM cell_table 
    WHERE "SiteID" = ANY(%s)
""", (list(filtered_site_ids),))
filtered_cells = cur.fetchall()

cur.execute('DROP TABLE IF EXISTS filtered_cell_table CASCADE')
cur.execute('CREATE TABLE filtered_cell_table (LIKE cell_table INCLUDING ALL)')
if filtered_cells:
    execute_values(cur, 'INSERT INTO filtered_cell_table VALUES %s', filtered_cells)
conn.commit()
print(f"   ✅ Updated: {len(filtered_cells):,} cells")

# Step 4: Update filtered_sector_table
print(f"\n🎯 Step 4: Updating filtered_sector_table...")
cur.execute("""
    SELECT * FROM sector_table 
    WHERE site_id = ANY(%s)
""", (list(filtered_site_ids),))
filtered_sectors = cur.fetchall()

cur.execute('DROP TABLE IF EXISTS filtered_sector_table CASCADE')
cur.execute('CREATE TABLE filtered_sector_table (LIKE sector_table INCLUDING ALL)')
if filtered_sectors:
    execute_values(cur, 'INSERT INTO filtered_sector_table VALUES %s', filtered_sectors)
conn.commit()
print(f"   ✅ Updated: {len(filtered_sectors):,} sectors")

# Step 5: Recreate filtered_cell_sector_map_view
print(f"\n🗺️  Step 5: Recreating filtered_cell_sector_map_view...")
cur.execute('DROP VIEW IF EXISTS filtered_cell_sector_map_view CASCADE')
cur.execute("""
    CREATE VIEW filtered_cell_sector_map_view AS
    SELECT 
        c."CellID" as "CellID",
        c."CellName" as "CellName",
        c."SiteID" as "SiteID",
        s."SiteName" as "SiteName",
        c."Technology" as "Technology",
        c."Carrier" as "Carrier",
        c."Azimuth" as "Azimuth",
        c."Height" as "Height",
        s."Latitude" as "SiteLatitude",
        s."Longitude" as "SiteLongitude",
        c."Latitude" as "CellLatitude",
        c."Longitude" as "CellLongitude",
        c."AnomalyFlag" as "CellAnomalyFlag",
        c."AnomalyScore" as "CellAnomalyScore",
        s."AnomalyFlag" as "SiteAnomalyFlag",
        s."AnomalyScore" as "SiteAnomalyScore",
        s."CellCount" as "CellCount",
        c."DateID" as "DateID"
    FROM filtered_cell_table c
    JOIN filtered_sites s ON c."SiteID" = s."SiteID"
    WHERE c."Azimuth" IS NOT NULL
""")
conn.commit()

cur.execute('SELECT COUNT(*) FROM filtered_cell_sector_map_view')
view_count = cur.fetchone()[0]
print(f"   ✅ View recreated: {view_count:,} rows")

# Final summary
print("\n" + "=" * 80)
print("📊 AFTER (NEW COUNTS):")
print("=" * 80)
print(f"   Sites:                    {len(filtered_sites):>6,}")
print(f"   Cells:                    {len(filtered_cells):>6,}")
print(f"   Sectors:                  {len(filtered_sectors):>6,}")
print(f"   Cell Sector View:         {view_count:>6,}")

print(f"\n📍 Geographic Coverage:")
print(f"   Center: Union City, CA ({UNION_CITY_LAT}°N, {UNION_CITY_LON}°W)")
print(f"   Radius: {NEW_RADIUS_MILES} miles (reduced from 30)")
print(f"   Closest site: {filtered_sites[0][0]} at {filtered_sites[0][10]:.1f} miles")
print(f"   Farthest site: {filtered_sites[-1][0]} at {filtered_sites[-1][10]:.1f} miles")

cur.execute('SELECT "ClusterID", COUNT(*) FROM filtered_sites GROUP BY "ClusterID" ORDER BY COUNT(*) DESC LIMIT 5')
print(f"\n   Top 5 clusters:")
for row in cur.fetchall():
    print(f"      {row[0]}: {row[1]:,} sites")

print(f"\n📉 Reduction Summary:")
print(f"   Original (30 mi): {old_site_count:,} sites")
print(f"   New (21 mi):      {len(filtered_sites):,} sites")
print(f"   Reduction:        {old_site_count - len(filtered_sites):,} sites ({((old_site_count - len(filtered_sites)) / old_site_count * 100):.1f}%)")

cur.close()
conn.close()

print("\n" + "=" * 80)
print("✅ SITES REDUCED BY ~50%!")
print("=" * 80)
print("\nRefresh your browser to see the updated map with fewer sites.")
