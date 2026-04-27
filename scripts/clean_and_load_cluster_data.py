import os
"""
Clean database and load site_df.csv and cell_df.csv with ClusterID support
"""
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

PG_CONFIG = {
    'host': 'localhost',
    'database': 'naavik_demo',
    'user': 'naavik_user',
    'password': 'naavik_pass_2026',
    'port': int(os.getenv('DB_PORT', '5433'))
}

print("=" * 80)
print("CLEANING DATABASE AND LOADING CLUSTER DATA")
print("=" * 80)

conn = psycopg2.connect(**PG_CONFIG)
cur = conn.cursor()

# Step 1: Clean all tables
print("\n🗑️  Step 1: Cleaning all tables...")
tables = ['cell_table', 'site_table', 'cell_sector_map_view']
for table in tables:
    try:
        cur.execute(f'TRUNCATE TABLE "{table}" CASCADE')
        print(f"   Cleaned {table}")
    except Exception as e:
        print(f"   Note: {table} - {str(e)}")
conn.commit()

# Step 2: Add ClusterID column to site_table if it doesn't exist
print("\n🔧 Step 2: Adding ClusterID column...")
try:
    cur.execute('''
        ALTER TABLE site_table 
        ADD COLUMN IF NOT EXISTS "ClusterID" VARCHAR(50)
    ''')
    print("   ✅ ClusterID column added/verified")
except Exception as e:
    print(f"   Note: {e}")
conn.commit()

# Step 3: Load site_df.csv
print("\n📂 Step 3: Loading site_df.csv...")
site_df = pd.read_csv('dummy_data/site_df.csv')
print(f"   Found {len(site_df)} sites")
print(f"   ClusterIDs: {sorted(site_df['ClusterID'].unique())}")

site_values = []
date_id = '2026-02-10'

for _, row in site_df.iterrows():
    site_values.append((
        None,  # SiteIDOriginal
        str(row['SiteID']),  # SiteID
        f"Site_{row['SiteID']}",  # SiteName
        0,  # CellCount (will update later)
        float(row['Latitude']),
        float(row['Longitude']),
        date_id,
        False,  # AnomalyFlag
        0.0,  # AnomalyScore
        None,  # RealUSID
        str(row['ClusterID'])  # ClusterID
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
print(f"   ✅ Inserted {len(site_values)} sites")

# Step 4: Load cell_df.csv
print("\n📂 Step 4: Loading cell_df.csv...")
cell_df = pd.read_csv('dummy_data/cell_df.csv')
print(f"   Found {len(cell_df)} cells")

# Add CellID column if not present
if 'CellID' not in cell_df.columns:
    cell_df['CellID'] = cell_df['cell_name']

cell_values = []
for _, row in cell_df.iterrows():
    # Only load cells for sites we have in site_table
    site_id = str(row['site_id']) if pd.notna(row['site_id']) else None
    if not site_id:
        continue
        
    cell_values.append((
        str(row.get('CellID', row['cell_name'])),  # CellID
        str(row['cell_name']),  # CellName
        site_id,  # SiteID
        str(row['TECH']) if pd.notna(row['TECH']) else '4G',  # Technology
        '',  # Carrier
        0,  # NumKPIs
        float(row['LATITUDE']) if pd.notna(row['LATITUDE']) else None,
        float(row['LONGITUDE']) if pd.notna(row['LONGITUDE']) else None,
        float(row['AZIMUTH']) if pd.notna(row['AZIMUTH']) else None,
        date_id,
        False,  # AnomalyFlag
        0.0  # AnomalyScore
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
        ON CONFLICT DO NOTHING
        """,
        batch
    )
    print(f"   Inserted batch {i//batch_size + 1}/{(len(cell_values)-1)//batch_size + 1}")

conn.commit()
print(f"   ✅ Inserted {len(cell_values)} cells")

# Step 5: Update cell counts
print("\n🔢 Step 5: Updating cell counts...")
cur.execute("""
    UPDATE site_table s
    SET "CellCount" = (
        SELECT COUNT(*) 
        FROM cell_table c 
        WHERE c."SiteID" = s."SiteID"
    )
""")
conn.commit()
print(f"   ✅ Updated cell counts")

# Step 6: Verify results
print("\n📊 Final Statistics:")
cur.execute('SELECT COUNT(*) FROM site_table')
total_sites = cur.fetchone()[0]
print(f"   Total sites: {total_sites}")

cur.execute('SELECT COUNT(*) FROM cell_table')
total_cells = cur.fetchone()[0]
print(f"   Total cells: {total_cells}")

cur.execute('SELECT "ClusterID", COUNT(*) FROM site_table GROUP BY "ClusterID" ORDER BY "ClusterID"')
print(f"\n   Sites by ClusterID:")
for row in cur.fetchall():
    print(f"      {row[0]}: {row[1]} sites")

cur.execute('SELECT "SiteID", "SiteName", "ClusterID", "Latitude", "Longitude", "CellCount" FROM site_table LIMIT 5')
print(f"\n   Sample sites:")
for row in cur.fetchall():
    print(f"      {row[0]} | {row[2]} | Cells: {row[5]} | ({row[3]:.4f}, {row[4]:.4f})")

cur.close()
conn.close()

print("\n" + "=" * 80)
print("✅ DATABASE CLEANED AND LOADED!")
print("=" * 80)
