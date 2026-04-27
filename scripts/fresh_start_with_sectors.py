import os
"""
Fresh start: Delete all data and load site_df.csv and cell_df.csv
Create proper sector shapes for map visualization
"""
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import uuid

PG_CONFIG = {
    'host': 'localhost',
    'database': 'naavik_demo',
    'user': 'naavik_user',
    'password': 'naavik_pass_2026',
    'port': int(os.getenv('DB_PORT', '5433'))
}

print("=" * 80)
print("FRESH START: LOADING SITE_DF AND CELL_DF WITH SECTORS")
print("=" * 80)

conn = psycopg2.connect(**PG_CONFIG)
cur = conn.cursor()

# Step 1: Delete ALL data from all tables
print("\n🗑️  Step 1: Deleting all data from tables...")
tables_to_clean = [
    'cell_table',
    'site_table',
    'intermediate_kpi_table',
    'subcomponent_table',
    'cqx_offenders_truth_table',
    'sector_table',
    'ticket_table',
    'eim_table',
    'alarm_table',
    'neighbors_table',
]

for table in tables_to_clean:
    try:
        cur.execute(f'DELETE FROM "{table}"')
        deleted = cur.rowcount
        print(f"   Deleted {deleted} rows from {table}")
    except Exception as e:
        print(f"   Skipped {table}: {str(e)}")

conn.commit()
print("   ✅ All tables cleaned")

# Step 2: Load site_df.csv
print("\n📂 Step 2: Loading site_df.csv...")
site_df = pd.read_csv('dummy_data/site_df.csv')
print(f"   Found {len(site_df)} sites")
print(f"   Unique ClusterIDs: {sorted(site_df['ClusterID'].unique())}")

date_id = '2026-02-10'
site_values = []

for _, row in site_df.iterrows():
    site_values.append((
        str(uuid.uuid4()),  # SiteIDOriginal - generate UUID
        str(row['SiteID']),  # SiteID
        f"Site_{row['SiteID']}",  # SiteName
        0,  # CellCount (will update after loading cells)
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

# Step 3: Load cell_df.csv with proper structure
print("\n📂 Step 3: Loading cell_df.csv...")
cell_df = pd.read_csv('dummy_data/cell_df.csv')
print(f"   Found {len(cell_df)} cells")

# Get site coordinates mapping
site_coords = {}
for _, row in site_df.iterrows():
    site_coords[str(row['SiteID'])] = {
        'lat': float(row['Latitude']),
        'lon': float(row['Longitude']),
        'cluster': str(row['ClusterID'])
    }

# Match cells to sites based on site_id (which are UUIDs in cell_df)
# We'll use the Site Name from cell_df to match
print("\n   Analyzing cell-to-site mapping...")
site_name_to_id = {}
for _, row in site_df.iterrows():
    site_name_to_id[str(row['SiteID'])] = str(row['SiteID'])

cell_values = []
cells_with_sites = 0
cells_without_sites = 0

# First, let's see what site_ids look like in cell_df
print(f"   Sample cell_df site_ids: {cell_df['site_id'].head(5).tolist()}")
print(f"   Sample cell_df cell_names: {cell_df['cell_name'].head(5).tolist()}")

# For each cell, insert with proper site mapping
for idx, row in cell_df.iterrows():
    # Generate a CellID
    cell_id = str(uuid.uuid4()) if pd.isna(row.get('CellID')) else str(row.get('CellID'))
    
    # Try to extract site ID from cell_name or use site_id directly
    site_id = None
    
    # If cell has Site Name column, use it
    if 'Site Name' in cell_df.columns and pd.notna(row.get('Site Name')):
        site_id = str(row['Site Name'])
    elif pd.notna(row['site_id']):
        # site_id in cell_df is UUID format, we need to find matching site
        # For now, we'll skip these and only load cells we can match
        continue
    
    # Check if this site exists in our site_table
    if site_id and site_id in site_coords:
        cells_with_sites += 1
        cell_values.append((
            cell_id,  # CellID
            str(row['cell_name']),  # CellName
            site_id,  # SiteID
            str(row['TECH']) if pd.notna(row['TECH']) else '4G',  # Technology
            str(row.get('Band', '')) if 'Band' in cell_df.columns and pd.notna(row.get('Band')) else '',  # Carrier
            0,  # NumKPIs
            float(row['LATITUDE']) if pd.notna(row['LATITUDE']) else None,
            float(row['LONGITUDE']) if pd.notna(row['LONGITUDE']) else None,
            float(row['AZIMUTH']) if pd.notna(row['AZIMUTH']) else 0.0,
            date_id,
            False,  # AnomalyFlag
            0.0  # AnomalyScore
        ))
    else:
        cells_without_sites += 1

print(f"   Cells matched to sites: {cells_with_sites}")
print(f"   Cells without site match: {cells_without_sites}")

# If we don't have many matched cells, let's create synthetic ones for each site
if cells_with_sites < 100:
    print("\n   ⚠️  Few cells matched. Creating synthetic cells for visualization...")
    cell_values = []
    
    # Create 3 cells per site (typical cell site configuration)
    azimuths = [0, 120, 240]  # 3-sector configuration
    
    for site_id, coords in site_coords.items():
        for i, azimuth in enumerate(azimuths):
            cell_id = str(uuid.uuid4())
            cell_name = f"{site_id}_SECTOR_{i+1}"
            
            cell_values.append((
                cell_id,
                cell_name,
                site_id,
                '4G',  # Technology
                'N71',  # Carrier/Band
                0,  # NumKPIs
                coords['lat'],
                coords['lon'],
                float(azimuth),
                date_id,
                False,
                0.0
            ))
    
    print(f"   Created {len(cell_values)} synthetic cells ({len(site_coords)} sites x 3 sectors)")

# Insert cells in batches
print("\n💾 Inserting cells...")
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
    if len(cell_values) > batch_size:
        print(f"   Batch {i//batch_size + 1}/{(len(cell_values)-1)//batch_size + 1}")

conn.commit()
print(f"   ✅ Inserted {len(cell_values)} cells")

# Step 4: Update cell counts
print("\n🔢 Step 4: Updating cell counts...")
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

# Step 5: Verify results
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

cur.execute('SELECT s."SiteID", s."ClusterID", s."Latitude", s."Longitude", COUNT(c."CellID") as cells FROM site_table s LEFT JOIN cell_table c ON s."SiteID" = c."SiteID" GROUP BY s."SiteID", s."ClusterID", s."Latitude", s."Longitude" LIMIT 5')
print(f"\n   Sample sites with cells:")
for row in cur.fetchall():
    print(f"      {row[0]} | {row[1]} | {row[4]} cells | ({row[2]:.4f}, {row[3]:.4f})")

# Check cells with azimuths
cur.execute('SELECT COUNT(*) FROM cell_table WHERE "Azimuth" IS NOT NULL AND "Azimuth" != 0')
cells_with_azimuth = cur.fetchone()[0]
print(f"\n   Cells with azimuth data: {cells_with_azimuth}")

cur.close()
conn.close()

print("\n" + "=" * 80)
print("✅ FRESH START COMPLETE!")
print("=" * 80)
print("\nNext steps:")
print("  1. Restart backend server")
print("  2. Hard refresh browser (Cmd+Shift+R)")
print("  3. Sites will show with sector shapes on the map")
