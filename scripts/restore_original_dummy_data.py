import os
"""
Restore the original dummy data that was accidentally deleted
This will reload all the original sites and cells from filtered_data CSVs
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
print("RESTORING ORIGINAL DUMMY DATA")
print("=" * 80)

# Connect to database
conn = psycopg2.connect(**PG_CONFIG)
cur = conn.cursor()

# Check current state
cur.execute('SELECT COUNT(*) FROM site_table')
sites_before = cur.fetchone()[0]
cur.execute('SELECT COUNT(*) FROM cell_table')
cells_before = cur.fetchone()[0]

print(f"\n📊 Current database state:")
print(f"   Sites: {sites_before}")
print(f"   Cells: {cells_before}")

# Load original site data
print(f"\n📂 Loading original site data from filtered_data/site_table.csv...")
sites_df = pd.read_csv('filtered_data/site_table.csv')
print(f"   Found {len(sites_df)} sites in CSV")

# Insert sites (avoid duplicates by checking SiteID)
print(f"\n💾 Restoring sites...")
inserted_sites = 0
for _, row in sites_df.iterrows():
    site_id = str(row['SiteID'])  # Convert to string
    # Check if site already exists
    cur.execute('SELECT COUNT(*) FROM site_table WHERE "SiteID" = %s', (site_id,))
    if cur.fetchone()[0] == 0:
        cur.execute("""
            INSERT INTO site_table (
                "SiteIDOriginal", "SiteID", "SiteName", "CellCount",
                "Latitude", "Longitude", "DateID", "AnomalyFlag", "AnomalyScore"
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            row.get('site_id'),  # lowercase in CSV
            site_id,
            row.get('site_name', f'Site_{site_id}'),  # lowercase in CSV
            row.get('cell_num', 3),  # lowercase in CSV
            row.get('LATITUDE'),  # uppercase in CSV
            row.get('LONGITUDE'),  # uppercase in CSV
            row.get('DATE_ID', '2026-02-03'),  # uppercase in CSV
            row.get('anomaly_flag', False),  # lowercase in CSV
            row.get('anomaly_score', 0)  # lowercase in CSV
        ))
        inserted_sites += 1

conn.commit()
print(f"   ✅ Restored {inserted_sites} sites")

# Load original cell data
print(f"\n📂 Loading original cell data from filtered_data/cell_table.csv...")
cells_df = pd.read_csv('filtered_data/cell_table.csv')
print(f"   Found {len(cells_df)} cells in CSV")

# Insert cells (avoid duplicates)
print(f"\n💾 Restoring cells...")
inserted_cells = 0
batch_size = 1000
cells_batch = []

for _, row in cells_df.iterrows():
    cell_id = str(row['cell_id'])  # Convert to string, lowercase in CSV
    site_id = str(row['site_id'])  # Convert to string, lowercase in CSV
    # Check if cell already exists
    cur.execute('SELECT COUNT(*) FROM cell_table WHERE "CellID" = %s', (cell_id,))
    if cur.fetchone()[0] == 0:
        cells_batch.append((
            cell_id,
            row.get('cell_name', f'Cell_{cell_id}'),  # lowercase in CSV
            site_id,
            row.get('TECH', 'LTE'),  # uppercase in CSV
            row.get('CARRIER', ''),  # uppercase in CSV
            row.get('num_kpis', 0),  # lowercase in CSV
            row.get('LATITUDE'),  # uppercase in CSV
            row.get('LONGITUDE'),  # uppercase in CSV
            row.get('AZIMUTH'),  # uppercase in CSV
            row.get('DATE_ID', '2026-02-03'),  # uppercase in CSV
            row.get('anomaly_flag', False),  # lowercase in CSV
            row.get('anomaly_score', 0)  # lowercase in CSV
        ))
        
        if len(cells_batch) >= batch_size:
            execute_values(
                cur,
                """
                INSERT INTO cell_table (
                    "CellID", "CellName", "SiteID", "Technology", "Carrier",
                    "NumKPIs", "Latitude", "Longitude", "Azimuth", "DateID",
                    "AnomalyFlag", "AnomalyScore"
                ) VALUES %s
                """,
                cells_batch
            )
            inserted_cells += len(cells_batch)
            conn.commit()
            print(f"   Inserted {inserted_cells} cells...")
            cells_batch = []

# Insert remaining cells
if cells_batch:
    execute_values(
        cur,
        """
        INSERT INTO cell_table (
            "CellID", "CellName", "SiteID", "Technology", "Carrier",
            "NumKPIs", "Latitude", "Longitude", "Azimuth", "DateID",
            "AnomalyFlag", "AnomalyScore"
        ) VALUES %s
        """,
        cells_batch
    )
    inserted_cells += len(cells_batch)
    conn.commit()

print(f"   ✅ Restored {inserted_cells} cells")

# Verify final state
cur.execute('SELECT COUNT(*) FROM site_table')
sites_after = cur.fetchone()[0]
cur.execute('SELECT COUNT(*) FROM cell_table')
cells_after = cur.fetchone()[0]
cur.execute('SELECT COUNT(*) FROM site_table WHERE "RealUSID" IS NOT NULL')
mapped_sites = cur.fetchone()[0]

print(f"\n📊 Final database state:")
print(f"   Sites: {sites_after} (was {sites_before})")
print(f"   Cells: {cells_after} (was {cells_before})")
print(f"   Sites with real data mapping: {mapped_sites}")
print(f"   Sites with local dummy data: {sites_after - mapped_sites}")

cur.close()
conn.close()

print("\n" + "=" * 80)
print("✅ ORIGINAL DATA RESTORED!")
print("=" * 80)
