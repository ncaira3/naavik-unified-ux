import os
"""
Delete all tables except sites, cells, sectors.
Filter those to 30 miles from Union City, CA
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
RADIUS_MILES = 30  # Changed from 40 to 30

def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate distance in miles between two points"""
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    dlon = lon2 - lon1 
    dlat = lat2 - lat1 
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a)) 
    return c * 3956  # Earth radius in miles

print("=" * 80)
print(f"FILTERING TO {RADIUS_MILES} MILES - CORE TABLES ONLY")
print("=" * 80)

conn = psycopg2.connect(**PG_CONFIG)
cur = conn.cursor()

# Step 1: Drop all filtered tables that are NOT sites/cells/sectors
print("\n🗑️  STEP 1: Dropping KPI and other tables...")
tables_to_drop = [
    'filtered_intermediate_kpi_table',
    'filtered_subcomponent_table',
    'filtered_cqx_offenders_truth_table',
    'filtered_cell_sector_map_view'
]

for table in tables_to_drop:
    try:
        cur.execute(f'DROP TABLE IF EXISTS {table} CASCADE')
        print(f"   ✅ Dropped {table}")
    except Exception as e:
        print(f"   ⚠️  {table}: {e}")

conn.commit()

# Step 2: Filter sites to 30 miles
print(f"\n📍 STEP 2: Filtering sites to {RADIUS_MILES} miles from Union City...")

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
    
    if distance <= RADIUS_MILES:
        filtered_site_ids.add(site_id)
        filtered_sites.append(site + (distance,))

filtered_sites.sort(key=lambda x: x[10])
print(f"   ✅ Filtered sites: {len(filtered_sites):,} sites (from {len(sites):,})")

# Recreate filtered_sites
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

# Step 3: Filter cells
print(f"\n📡 STEP 3: Filtering cells for {len(filtered_site_ids):,} sites...")

cur.execute("""
    SELECT * FROM cell_table 
    WHERE "SiteID" = ANY(%s)
""", (list(filtered_site_ids),))
filtered_cells = cur.fetchall()
print(f"   ✅ Filtered cells: {len(filtered_cells):,}")

cur.execute('DROP TABLE IF EXISTS filtered_cell_table CASCADE')
cur.execute('CREATE TABLE filtered_cell_table (LIKE cell_table INCLUDING ALL)')
if filtered_cells:
    execute_values(cur, 'INSERT INTO filtered_cell_table VALUES %s', filtered_cells)
conn.commit()

# Step 4: Filter sectors
print(f"\n🎯 STEP 4: Filtering sectors for {len(filtered_site_ids):,} sites...")

cur.execute("""
    SELECT * FROM sector_table 
    WHERE site_id = ANY(%s)
""", (list(filtered_site_ids),))
filtered_sectors = cur.fetchall()
print(f"   ✅ Filtered sectors: {len(filtered_sectors):,}")

cur.execute('DROP TABLE IF EXISTS filtered_sector_table CASCADE')
cur.execute('CREATE TABLE filtered_sector_table (LIKE sector_table INCLUDING ALL)')
if filtered_sectors:
    execute_values(cur, 'INSERT INTO filtered_sector_table VALUES %s', filtered_sectors)
conn.commit()

# Step 5: Recreate cell_sector_map_view
print("\n🗺️  STEP 5: Creating cell_sector_map_view...")

cur.execute('DROP VIEW IF EXISTS filtered_cell_sector_map_view CASCADE')
cur.execute("""
    CREATE VIEW filtered_cell_sector_map_view AS
    SELECT 
        c."CellID" as cell_id,
        c."CellName" as cell_name,
        c."SiteID" as site_id,
        c."Azimuth" as azimuth,
        c."Technology" as technology,
        c."Carrier" as carrier,
        s."Latitude" as latitude,
        s."Longitude" as longitude
    FROM filtered_cell_table c
    JOIN filtered_sites s ON c."SiteID" = s."SiteID"
    WHERE c."Azimuth" IS NOT NULL
""")
conn.commit()

cur.execute('SELECT COUNT(*) FROM filtered_cell_sector_map_view')
view_count = cur.fetchone()[0]
print(f"   ✅ Created view: {view_count:,} rows")

# Final summary
print("\n" + "=" * 80)
print("📊 FINAL DATABASE STATUS")
print("=" * 80)
print(f"\nCore Tables (within {RADIUS_MILES} miles):")
print(f"   Sites:                    {len(filtered_sites):>6,}")
print(f"   Cells:                    {len(filtered_cells):>6,}")
print(f"   Sectors:                  {len(filtered_sectors):>6,}")
print(f"   Cell Sector Map View:     {view_count:>6,}")
print(f"\nTotal data rows:             {len(filtered_sites) + len(filtered_cells) + len(filtered_sectors):>6,}")

print(f"\n📍 Geographic Coverage:")
print(f"   Center: Union City, CA ({UNION_CITY_LAT}°N, {UNION_CITY_LON}°W)")
print(f"   Radius: {RADIUS_MILES} miles")
print(f"   Closest site: {filtered_sites[0][0]} at {filtered_sites[0][10]:.1f} miles")
print(f"   Farthest site: {filtered_sites[-1][0]} at {filtered_sites[-1][10]:.1f} miles")

cur.execute('SELECT "ClusterID", COUNT(*) FROM filtered_sites GROUP BY "ClusterID" ORDER BY COUNT(*) DESC LIMIT 5')
print(f"\n   Top 5 clusters:")
for row in cur.fetchall():
    print(f"      {row[0]}: {row[1]:,} sites")

print(f"\n🔢 Data Ratios:")
if len(filtered_sites) > 0:
    print(f"   Average cells per site:   {len(filtered_cells) / len(filtered_sites):.1f}")
    print(f"   Average sectors per site: {len(filtered_sectors) / len(filtered_sites):.1f}")

print("\n" + "=" * 80)
print("✅ DATABASE CLEANED AND FILTERED!")
print("=" * 80)
print("\nRemaining tables:")
print("  • filtered_sites")
print("  • filtered_cell_table")
print("  • filtered_sector_table")
print("  • filtered_cell_sector_map_view")
print("\nAll other tables have been removed.")

cur.close()
conn.close()
