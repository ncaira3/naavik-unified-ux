import os
"""
Filter ALL PostgreSQL tables to only include data within 40 miles of Union City, CA
This creates new filtered versions of all major tables
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
RADIUS_MILES = 40

def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate distance in miles between two points"""
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    dlon = lon2 - lon1 
    dlat = lat2 - lat1 
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a)) 
    return c * 3956  # Earth radius in miles

print("=" * 80)
print("FILTERING ALL TABLES TO UNION CITY AREA (40 MILES)")
print("=" * 80)

conn = psycopg2.connect(**PG_CONFIG)
cur = conn.cursor()

# Get original counts
print("\n📊 ORIGINAL TABLE COUNTS:")
tables = ['site_table', 'cell_table', 'sector_table', 'intermediate_kpi_table', 
          'subcomponent_table', 'cqx_offenders_truth_table']
original_counts = {}
for table in tables:
    cur.execute(f'SELECT COUNT(*) FROM {table}')
    count = cur.fetchone()[0]
    original_counts[table] = count
    print(f"   {table}: {count:,}")

print("\n" + "=" * 80)
print("STEP 1: Filter Sites")
print("=" * 80)

# Get all sites and filter by distance
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
print(f"✅ Filtered sites: {len(filtered_sites):,} (from {len(sites):,})")

# Recreate filtered_sites table
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

print("\n" + "=" * 80)
print("STEP 2: Filter Cells (only for filtered sites)")
print("=" * 80)

cur.execute("""
    SELECT * FROM cell_table 
    WHERE "SiteID" = ANY(%s)
""", (list(filtered_site_ids),))
filtered_cells = cur.fetchall()
print(f"✅ Filtered cells: {len(filtered_cells):,}")

# Recreate filtered_cell_table
cur.execute('DROP TABLE IF EXISTS filtered_cell_table CASCADE')
cur.execute("""
    CREATE TABLE filtered_cell_table (
        LIKE cell_table INCLUDING ALL
    )
""")
if filtered_cells:
    # Get column names
    cur.execute("""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'cell_table' 
        ORDER BY ordinal_position
    """)
    columns = [row[0] for row in cur.fetchall()]
    placeholders = ','.join(['%s'] * len(columns))
    execute_values(
        cur,
        f'INSERT INTO filtered_cell_table VALUES %s',
        filtered_cells
    )
conn.commit()

print("\n" + "=" * 80)
print("STEP 3: Filter Sectors (only for filtered sites)")
print("=" * 80)

cur.execute("""
    SELECT * FROM sector_table 
    WHERE site_id = ANY(%s)
""", (list(filtered_site_ids),))
filtered_sectors = cur.fetchall()
print(f"✅ Filtered sectors: {len(filtered_sectors):,}")

# Recreate filtered_sector_table
cur.execute('DROP TABLE IF EXISTS filtered_sector_table CASCADE')
cur.execute("""
    CREATE TABLE filtered_sector_table (
        LIKE sector_table INCLUDING ALL
    )
""")
if filtered_sectors:
    cur.execute("""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'sector_table' 
        ORDER BY ordinal_position
    """)
    columns = [row[0] for row in cur.fetchall()]
    execute_values(
        cur,
        f'INSERT INTO filtered_sector_table VALUES %s',
        filtered_sectors
    )
conn.commit()

print("\n" + "=" * 80)
print("STEP 4: Filter KPI Tables (only for filtered sites)")
print("=" * 80)

# Filter intermediate_kpi_table
cur.execute("""
    SELECT * FROM intermediate_kpi_table 
    WHERE "SiteID" = ANY(%s)
""", (list(filtered_site_ids),))
filtered_kpis = cur.fetchall()
print(f"✅ Filtered intermediate KPIs: {len(filtered_kpis):,}")

cur.execute('DROP TABLE IF EXISTS filtered_intermediate_kpi_table CASCADE')
cur.execute('CREATE TABLE filtered_intermediate_kpi_table (LIKE intermediate_kpi_table INCLUDING ALL)')
if filtered_kpis:
    execute_values(cur, 'INSERT INTO filtered_intermediate_kpi_table VALUES %s', filtered_kpis)
conn.commit()

# Filter subcomponent_table
cur.execute("""
    SELECT * FROM subcomponent_table 
    WHERE "SiteID" = ANY(%s)
""", (list(filtered_site_ids),))
filtered_subcomponents = cur.fetchall()
print(f"✅ Filtered subcomponents: {len(filtered_subcomponents):,}")

cur.execute('DROP TABLE IF EXISTS filtered_subcomponent_table CASCADE')
cur.execute('CREATE TABLE filtered_subcomponent_table (LIKE subcomponent_table INCLUDING ALL)')
if filtered_subcomponents:
    execute_values(cur, 'INSERT INTO filtered_subcomponent_table VALUES %s', filtered_subcomponents)
conn.commit()

# Filter cqx_offenders_truth_table
cur.execute("""
    SELECT * FROM cqx_offenders_truth_table 
    WHERE "SiteID" = ANY(%s)
""", (list(filtered_site_ids),))
filtered_cqx = cur.fetchall()
print(f"✅ Filtered CQX offenders: {len(filtered_cqx):,}")

cur.execute('DROP TABLE IF EXISTS filtered_cqx_offenders_truth_table CASCADE')
cur.execute('CREATE TABLE filtered_cqx_offenders_truth_table (LIKE cqx_offenders_truth_table INCLUDING ALL)')
if filtered_cqx:
    execute_values(cur, 'INSERT INTO filtered_cqx_offenders_truth_table VALUES %s', filtered_cqx)
conn.commit()

print("\n" + "=" * 80)
print("STEP 5: Recreate cell_sector_map_view for filtered data")
print("=" * 80)

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
print(f"✅ Created filtered_cell_sector_map_view: {view_count:,} rows")

print("\n" + "=" * 80)
print("📊 FINAL FILTERED TABLE COUNTS")
print("=" * 80)

filtered_counts = {
    'filtered_sites': len(filtered_sites),
    'filtered_cell_table': len(filtered_cells),
    'filtered_sector_table': len(filtered_sectors),
    'filtered_intermediate_kpi_table': len(filtered_kpis),
    'filtered_subcomponent_table': len(filtered_subcomponents),
    'filtered_cqx_offenders_truth_table': len(filtered_cqx),
    'filtered_cell_sector_map_view': view_count
}

for table, count in filtered_counts.items():
    original_table = table.replace('filtered_', '')
    original_count = original_counts.get(original_table, 0)
    if original_count > 0:
        percent = (count / original_count) * 100
        print(f"   {table}: {count:,} ({percent:.1f}% of original)")
    else:
        print(f"   {table}: {count:,}")

print("\n" + "=" * 80)
print("📍 GEOGRAPHIC SUMMARY")
print("=" * 80)
print(f"Center: Union City, CA ({UNION_CITY_LAT}°N, {UNION_CITY_LON}°W)")
print(f"Radius: {RADIUS_MILES} miles")
print(f"Closest site: {filtered_sites[0][0]} at {filtered_sites[0][10]:.1f} miles")
print(f"Farthest site: {filtered_sites[-1][0]} at {filtered_sites[-1][10]:.1f} miles")

cur.execute('SELECT "ClusterID", COUNT(*) FROM filtered_sites GROUP BY "ClusterID" ORDER BY COUNT(*) DESC LIMIT 5')
print(f"\nTop 5 clusters in area:")
for row in cur.fetchall():
    print(f"   {row[0]}: {row[1]:,} sites")

cur.close()
conn.close()

print("\n" + "=" * 80)
print("✅ ALL TABLES FILTERED SUCCESSFULLY!")
print("=" * 80)
print("\nFiltered tables created:")
print("  • filtered_sites")
print("  • filtered_cell_table")
print("  • filtered_sector_table")
print("  • filtered_intermediate_kpi_table")
print("  • filtered_subcomponent_table")
print("  • filtered_cqx_offenders_truth_table")
print("  • filtered_cell_sector_map_view")
