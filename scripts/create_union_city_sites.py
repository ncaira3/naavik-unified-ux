import os
"""
Create filtered sites table with sites within 40 miles of Union City, California
Union City coordinates: 37.5935° N, 122.0177° W
"""
import psycopg2
from math import radians, cos, sin, asin, sqrt

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
    """
    Calculate the great circle distance between two points 
    on the earth (specified in decimal degrees)
    Returns distance in miles
    """
    # convert decimal degrees to radians 
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    
    # haversine formula 
    dlon = lon2 - lon1 
    dlat = lat2 - lat1 
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a)) 
    
    # Radius of earth in miles
    r = 3956
    
    return c * r

print("=" * 80)
print("CREATING UNION CITY FILTERED SITES TABLE")
print("=" * 80)

conn = psycopg2.connect(**PG_CONFIG)
cur = conn.cursor()

# Step 1: Create filtered_sites table
print("\n🏗️  Step 1: Creating filtered_sites table...")
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
conn.commit()
print("   ✅ filtered_sites table created")

# Step 2: Fetch all sites and calculate distances
print(f"\n📍 Step 2: Filtering sites within {RADIUS_MILES} miles of Union City...")
cur.execute("""
    SELECT "SiteID", "SiteName", "Latitude", "Longitude", 
           "CellCount", "ClusterID", "RealUSID", "DateID",
           "AnomalyFlag", "AnomalyScore"
    FROM site_table
""")

sites = cur.fetchall()
print(f"   Total sites in database: {len(sites):,}")

# Filter sites by distance
filtered = []
for site in sites:
    site_id, site_name, lat, lon, cell_count, cluster_id, real_usid, date_id, anomaly_flag, anomaly_score = site
    distance = haversine_distance(UNION_CITY_LAT, UNION_CITY_LON, float(lat), float(lon))
    
    if distance <= RADIUS_MILES:
        filtered.append((
            site_id, site_name, lat, lon, cell_count, cluster_id, 
            real_usid, date_id, anomaly_flag, anomaly_score, distance
        ))

filtered.sort(key=lambda x: x[10])  # Sort by distance
print(f"   Found {len(filtered):,} sites within {RADIUS_MILES} miles")

# Step 3: Insert filtered sites
print("\n💾 Step 3: Inserting filtered sites...")
if filtered:
    from psycopg2.extras import execute_values
    execute_values(
        cur,
        """
        INSERT INTO filtered_sites (
            "SiteID", "SiteName", "Latitude", "Longitude", "CellCount",
            "ClusterID", "RealUSID", "DateID", "AnomalyFlag", "AnomalyScore",
            "DistanceFromUnionCity"
        ) VALUES %s
        """,
        filtered
    )
    conn.commit()
    print(f"   ✅ Inserted {len(filtered):,} sites")

# Step 4: Show statistics
print("\n📊 Filtered Sites Statistics:")
print(f"   Total sites: {len(filtered):,}")
print(f"   Closest site: {filtered[0][10]:.2f} miles")
print(f"   Farthest site: {filtered[-1][10]:.2f} miles")

cur.execute('SELECT "ClusterID", COUNT(*) FROM filtered_sites GROUP BY "ClusterID" ORDER BY COUNT(*) DESC LIMIT 10')
print(f"\n   Top 10 clusters:")
for row in cur.fetchall():
    print(f"      {row[0]}: {row[1]:,} sites")

print(f"\n   Sample filtered sites (closest to Union City):")
for i in range(min(5, len(filtered))):
    site = filtered[i]
    print(f"      {site[0]} | {site[5]} | {site[10]:.1f} miles | ({site[2]:.4f}, {site[3]:.4f})")

cur.close()
conn.close()

print("\n" + "=" * 80)
print("✅ FILTERED SITES TABLE CREATED!")
print("=" * 80)
print(f"\nCreated filtered_sites table with {len(filtered)} sites")
print(f"within {RADIUS_MILES} miles of Union City, CA")
