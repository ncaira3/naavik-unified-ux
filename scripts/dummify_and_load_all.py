import os
"""
Comprehensive data dummification and loading:
1. Load site_df, cell_df, and sectors_df
2. Create dummy SiteIDs from USID (USTXXXXX format)
3. Dummify all identifying columns (cell names, site names, etc.)
4. Save mapping tables for KPI lookup
5. Load into Postgres with proper relationships
"""
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import hashlib
import uuid

PG_CONFIG = {
    'host': 'localhost',
    'database': 'naavik_demo',
    'user': 'naavik_user',
    'password': 'naavik_pass_2026',
    'port': int(os.getenv('DB_PORT', '5433'))
}

def create_dummy_site_id(usid):
    """Create consistent dummy site ID from USID using hash"""
    hash_obj = hashlib.md5(str(usid).encode())
    hash_int = int(hash_obj.hexdigest()[:8], 16)
    dummy_id = hash_int % 1000000
    return f"UST{dummy_id:06d}"

def dummify_cell_name(cell_name):
    """Dummify cell name"""
    hash_obj = hashlib.md5(str(cell_name).encode())
    hash_int = int(hash_obj.hexdigest()[:6], 16)
    return f"CELL_{hash_int % 1000000:06d}"

print("=" * 80)
print("COMPREHENSIVE DATA DUMMIFICATION AND LOADING")
print("=" * 80)

# Load all three files
print("\n📂 Loading CSV files...")
site_df = pd.read_csv('dummy_data/site_df.csv')
cell_df = pd.read_csv('dummy_data/cell_df.csv')
sectors_df = pd.read_csv('dummy_data/sectors_df.csv')

print(f"   Sites: {len(site_df)} rows")
print(f"   Cells: {len(cell_df)} rows, {cell_df['USID'].nunique()} unique USIDs")
print(f"   Sectors: {len(sectors_df)} rows, {sectors_df['USID'].nunique()} unique USIDs")

# Connect to database
conn = psycopg2.connect(**PG_CONFIG)
cur = conn.cursor()

# Step 1: Clean all tables
print("\n🗑️  Step 1: Cleaning database...")
tables = ['cell_table', 'site_table', 'sector_table']
for table in tables:
    try:
        cur.execute(f'DELETE FROM "{table}"')
        print(f"   Deleted from {table}")
    except Exception as e:
        print(f"   {table}: {str(e)}")
conn.commit()

# Step 2: Create mapping tables if they don't exist
print("\n🗄️  Step 2: Creating mapping tables...")

# Drop and recreate mapping tables
cur.execute('DROP TABLE IF EXISTS usid_mapping')
cur.execute("""
    CREATE TABLE usid_mapping (
        real_usid VARCHAR(50) PRIMARY KEY,
        dummy_site_id VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
""")

cur.execute('DROP TABLE IF EXISTS cell_name_mapping')
cur.execute("""
    CREATE TABLE cell_name_mapping (
        real_cell_name VARCHAR(200) PRIMARY KEY,
        dummy_cell_name VARCHAR(50) NOT NULL,
        real_usid VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
""")

conn.commit()
print("   ✅ Mapping tables created")

# Step 3: Process and dummify site_df
print("\n📊 Step 3: Processing site_df...")
# site_df has SiteID column (which is actually USID in the data)
site_df['RealUSID'] = site_df['SiteID'].astype(str)
site_df['DummySiteID'] = site_df['RealUSID'].apply(create_dummy_site_id)
site_df['DummySiteName'] = site_df['DummySiteID'].apply(lambda x: f"Site_{x}")

print(f"   Created {len(site_df)} dummy site IDs")
print(f"   Sample mapping: USID {site_df['RealUSID'].iloc[0]} → {site_df['DummySiteID'].iloc[0]}")

# Step 4: Process and dummify cell_df
print("\n📊 Step 4: Processing cell_df...")
cell_df['RealUSID'] = cell_df['USID'].astype(str)
cell_df['DummySiteID'] = cell_df['RealUSID'].apply(create_dummy_site_id)
cell_df['DummyCellName'] = cell_df['cell_name'].apply(dummify_cell_name)

print(f"   Dummified {len(cell_df)} cells")

# Step 5: Process and dummify sectors_df
print("\n📊 Step 5: Processing sectors_df...")
sectors_df['RealUSID'] = sectors_df['USID'].astype(str)
sectors_df['DummySiteID'] = sectors_df['RealUSID'].apply(create_dummy_site_id)
sectors_df['DummySectorName'] = sectors_df.apply(
    lambda row: f"{row['DummySiteID']}_FACE_{row['FACE']}", axis=1
)

print(f"   Dummified {len(sectors_df)} sectors")

# Step 6: Save mappings to database
print("\n💾 Step 6: Saving USID mappings...")
usid_mappings = site_df[['RealUSID', 'DummySiteID']].drop_duplicates()
execute_values(
    cur,
    "INSERT INTO usid_mapping (real_usid, dummy_site_id) VALUES %s ON CONFLICT DO NOTHING",
    usid_mappings.values.tolist()
)
print(f"   ✅ Saved {len(usid_mappings)} USID mappings")

print("\n💾 Saving cell name mappings...")
cell_mappings = cell_df[['cell_name', 'DummyCellName', 'RealUSID']].drop_duplicates()
execute_values(
    cur,
    "INSERT INTO cell_name_mapping (real_cell_name, dummy_cell_name, real_usid) VALUES %s ON CONFLICT DO NOTHING",
    cell_mappings.values.tolist()
)
print(f"   ✅ Saved {len(cell_mappings)} cell name mappings")
conn.commit()

# Step 7: Load sites into site_table
print("\n💾 Step 7: Loading sites...")
date_id = '2026-02-10'
site_values = []

for _, row in site_df.iterrows():
    site_values.append((
        str(uuid.uuid4()),  # SiteIDOriginal
        row['DummySiteID'],  # SiteID (dummy)
        row['DummySiteName'],  # SiteName (dummy)
        0,  # CellCount (will update)
        float(row['Latitude']),
        float(row['Longitude']),
        date_id,
        False,
        0.0,
        row['RealUSID'],  # RealUSID for mapping
        str(row['ClusterID'])
    ))

execute_values(
    cur,
    """
    INSERT INTO site_table (
        "SiteIDOriginal", "SiteID", "SiteName", "CellCount",
        "Latitude", "Longitude", "DateID", "AnomalyFlag", "AnomalyScore",
        "RealUSID", "ClusterID"
    ) VALUES %s
    """,
    site_values
)
conn.commit()
print(f"   ✅ Loaded {len(site_values)} sites")

# Step 8: Load cells into cell_table
print("\n💾 Step 8: Loading cells...")
cell_values = []

for _, row in cell_df.iterrows():
    cell_values.append((
        str(uuid.uuid4()),  # CellID
        row['DummyCellName'],  # CellName (dummified)
        row['DummySiteID'],  # SiteID (dummy)
        str(row['TECH']) if pd.notna(row['TECH']) else '4G',
        str(row['Band']) if pd.notna(row['Band']) else '',
        0,  # NumKPIs
        float(row['LATITUDE']) if pd.notna(row['LATITUDE']) else None,
        float(row['LONGITUDE']) if pd.notna(row['LONGITUDE']) else None,
        float(row['AZIMUTH']) if pd.notna(row['AZIMUTH']) else None,
        date_id,
        False,
        0.0
    ))

# Insert in batches
batch_size = 1000
for i in range(0, len(cell_values), batch_size):
    batch = cell_values[i:i+batch_size]
    execute_values(
        cur,
        """
        INSERT INTO cell_table (
            "CellID", "CellName", "SiteID", "Technology", "Carrier",
            "NumKPIs", "Latitude", "Longitude", "Azimuth", "DateID",
            "AnomalyFlag", "AnomalyScore"
        ) VALUES %s
        """,
        batch
    )
    if i % 10000 == 0:
        print(f"   Loaded {i:,} cells...")

conn.commit()
print(f"   ✅ Loaded {len(cell_values):,} cells")

# Step 9: Load sectors into existing sector_table
# Note: Using existing schema with columns: id, SiteID, Azimuth, site_id, etc.
print("\n💾 Step 9: Loading sectors...")
sector_values = []

for _, row in sectors_df.iterrows():
    sector_values.append((
        row['DummySiteID'],  # SiteID (dummy, using PascalCase)
        float(row['AZIMUTH']),  # Azimuth
        row['DummySiteID'],  # site_id (lowercase, for compatibility)
        None,  # strongest_factors
        False,  # AnomalyFlag
        0.0,  # AnomalyScore
        date_id,  # DateID
        1  # version
    ))

execute_values(
    cur,
    """
    INSERT INTO sector_table (
        "SiteID", "Azimuth", site_id, strongest_factors, 
        "AnomalyFlag", "AnomalyScore", "DateID", version
    ) VALUES %s
    """,
    sector_values
)
conn.commit()
print(f"   ✅ Loaded {len(sector_values):,} sectors")

# Step 11: Update cell counts
print("\n🔢 Step 11: Updating cell counts...")
cur.execute("""
    UPDATE site_table s
    SET "CellCount" = (
        SELECT COUNT(*) 
        FROM cell_table c 
        WHERE c."SiteID" = s."SiteID"
    )
""")
conn.commit()

# Step 12: Recreate cell_sector_map_view using actual cell data
print("\n🔄 Step 12: Recreating cell_sector_map_view...")
cur.execute('DROP VIEW IF EXISTS cell_sector_map_view')
cur.execute("""
    CREATE VIEW cell_sector_map_view AS
    SELECT 
        c."CellID",
        c."CellName",
        c."SiteID",
        s."SiteName",
        c."Technology",
        c."Carrier",
        c."Azimuth",
        CAST(0 as NUMERIC) as "Height",
        s."Latitude" as "SiteLatitude",
        s."Longitude" as "SiteLongitude",
        COALESCE(c."Latitude", s."Latitude") as "CellLatitude",
        COALESCE(c."Longitude", s."Longitude") as "CellLongitude",
        c."AnomalyFlag" as "CellAnomalyFlag",
        c."AnomalyScore" as "CellAnomalyScore",
        s."AnomalyFlag" as "SiteAnomalyFlag",
        s."AnomalyScore" as "SiteAnomalyScore",
        s."CellCount",
        c."DateID"
    FROM cell_table c
    INNER JOIN site_table s ON c."SiteID" = s."SiteID"
    WHERE c."Azimuth" IS NOT NULL
""")
conn.commit()

# Step 13: Verify everything
print("\n📊 FINAL STATISTICS:")
print("=" * 80)

cur.execute('SELECT COUNT(*) FROM site_table')
print(f"Sites: {cur.fetchone()[0]:,}")

cur.execute('SELECT COUNT(*) FROM cell_table')
print(f"Cells: {cur.fetchone()[0]:,}")

cur.execute('SELECT COUNT(*) FROM sector_table')
print(f"Sectors: {cur.fetchone()[0]:,}")

cur.execute('SELECT COUNT(*) FROM cell_sector_map_view')
print(f"Cell sectors in view: {cur.fetchone()[0]:,}")

cur.execute('SELECT COUNT(*) FROM usid_mapping')
print(f"USID mappings: {cur.fetchone()[0]:,}")

cur.execute('SELECT COUNT(*) FROM cell_name_mapping')
print(f"Cell name mappings: {cur.fetchone()[0]:,}")

print("\n📋 Sample Mappings:")
cur.execute('SELECT real_usid, dummy_site_id FROM usid_mapping LIMIT 5')
print("\n  USID → Dummy SiteID:")
for row in cur.fetchall():
    print(f"    {row[0]} → {row[1]}")

cur.execute('SELECT real_cell_name, dummy_cell_name FROM cell_name_mapping LIMIT 5')
print("\n  Real Cell Name → Dummy Cell Name:")
for row in cur.fetchall():
    print(f"    {row[0]} → {row[1]}")

print("\n📊 Cluster Distribution:")
cur.execute('SELECT "ClusterID", COUNT(*) FROM site_table GROUP BY "ClusterID" ORDER BY COUNT(*) DESC LIMIT 10')
for row in cur.fetchall():
    print(f"  {row[0]}: {row[1]:,} sites")

print("\n🎯 Sample Sector Data:")
cur.execute('SELECT "SectorName", "SiteID", "Face", "Azimuth", "Height" FROM sector_table LIMIT 5')
for row in cur.fetchall():
    print(f"  {row[0]} | Site: {row[1]} | Face: {row[2]} | Az: {row[3]}° | H: {row[4]:.1f}m")

cur.close()
conn.close()

print("\n" + "=" * 80)
print("✅ DUMMIFICATION AND LOADING COMPLETE!")
print("=" * 80)
print("\nAll data is now dummified with mapping preserved for KPI lookups.")
print("Restart backend and refresh browser to see sectors on map!")
