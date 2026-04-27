import os
"""
Restore the original 3,457 dummy sites from dummy_data_mapped
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
print("RESTORING DUMMY DATA FROM dummy_data_mapped")
print("=" * 80)

conn = psycopg2.connect(**PG_CONFIG)
cur = conn.cursor()

# Current state
cur.execute('SELECT COUNT(*) FROM site_table')
sites_before = cur.fetchone()[0]
cur.execute('SELECT COUNT(*) FROM cell_table')
cells_before = cur.fetchone()[0]

print(f"\n📊 Current database:")
print(f"   Sites: {sites_before}")
print(f"   Cells: {cells_before}")

# Load site data from dummy_data_mapped
print(f"\n📂 Loading sites from dummy_data_mapped/site_table.csv...")
sites_df = pd.read_csv('dummy_data_mapped/site_table.csv')
print(f"   Total rows: {len(sites_df)}")
print(f"   Unique SiteIDs: {sites_df['SiteID'].nunique()}")

# Bulk insert sites
print(f"\n💾 Inserting sites...")
site_values = []
for _, row in sites_df.iterrows():
    site_values.append((
        row['SiteIDOriginal'] if pd.notna(row['SiteIDOriginal']) else None,
        row['SiteID'],
        row['SiteName'],
        int(row['CellCount']),
        float(row['Latitude']),
        float(row['Longitude']),
        row['DateID'],
        bool(row['AnomalyFlag']) if pd.notna(row['AnomalyFlag']) else False,
        float(row['AnomalyScore']) if pd.notna(row['AnomalyScore']) else 0.0
    ))

execute_values(
    cur,
    """
    INSERT INTO site_table (
        "SiteIDOriginal", "SiteID", "SiteName", "CellCount",
        "Latitude", "Longitude", "DateID", "AnomalyFlag", "AnomalyScore"
    ) VALUES %s
    ON CONFLICT ("SiteID", "DateID") DO NOTHING
    """,
    site_values,
    page_size=1000
)
conn.commit()
print(f"   ✅ Sites inserted")

# Load cell data from dummy_data_mapped
print(f"\n📂 Loading cells from dummy_data_mapped/cell_table.csv...")
cells_df = pd.read_csv('dummy_data_mapped/cell_table.csv')
print(f"   Total rows: {len(cells_df)}")

# Bulk insert cells
print(f"\n💾 Inserting cells...")
cell_values = []
for _, row in cells_df.iterrows():
    cell_values.append((
        row['CellID'],
        row['CellName'],
        row['SiteID'],
        row['Technology'],
        row['Carrier'] if pd.notna(row['Carrier']) else '',
        int(row['NumKPIs']) if pd.notna(row['NumKPIs']) else 0,
        float(row['Latitude']) if pd.notna(row['Latitude']) else None,
        float(row['Longitude']) if pd.notna(row['Longitude']) else None,
        float(row['Azimuth']) if pd.notna(row['Azimuth']) else None,
        row['DateID'],
        bool(row['AnomalyFlag']) if pd.notna(row['AnomalyFlag']) else False,
        float(row['AnomalyScore']) if pd.notna(row['AnomalyScore']) else 0.0
    ))

execute_values(
    cur,
    """
    INSERT INTO cell_table (
        "CellID", "CellName", "SiteID", "Technology", "Carrier",
        "NumKPIs", "Latitude", "Longitude", "Azimuth", "DateID",
        "AnomalyFlag", "AnomalyScore"
    ) VALUES %s
    ON CONFLICT ("CellID", "DateID") DO NOTHING
    """,
    cell_values,
    page_size=1000
)
conn.commit()
print(f"   ✅ Cells inserted")

# Final counts
cur.execute('SELECT COUNT(*) FROM site_table')
sites_after = cur.fetchone()[0]
cur.execute('SELECT COUNT(*) FROM cell_table')
cells_after = cur.fetchone()[0]
cur.execute('SELECT COUNT(DISTINCT "SiteID") FROM site_table')
unique_sites = cur.fetchone()[0]
cur.execute('SELECT COUNT(*) FROM site_table WHERE "RealUSID" IS NOT NULL')
mapped_sites = cur.fetchone()[0]

print(f"\n📊 Final database:")
print(f"   Total site rows: {sites_after} (was {sites_before}, added {sites_after - sites_before})")
print(f"   Unique sites: {unique_sites}")
print(f"   Total cell rows: {cells_after} (was {cells_before}, added {cells_after - cells_before})")
print(f"   Sites with real USID mapping: {mapped_sites}")
print(f"   Sites with local dummy data only: {unique_sites - mapped_sites}")

cur.close()
conn.close()

print("\n" + "=" * 80)
print("✅ RESTORATION COMPLETE!")
print("=" * 80)
