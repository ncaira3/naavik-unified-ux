import os
"""
Remove all sites that don't have RealUSID mappings
This ensures only sites with real data are in the database
"""
import psycopg2

PG_CONFIG = {
    'host': 'localhost',
    'database': 'naavik_demo',
    'user': 'naavik_user',
    'password': 'naavik_pass_2026',
    'port': int(os.getenv('DB_PORT', '5433'))
}

conn = psycopg2.connect(**PG_CONFIG)
cur = conn.cursor()

print("=" * 80)
print("Cleaning Up Unmapped Sites")
print("=" * 80)

# Count before
cur.execute('SELECT COUNT(*) FROM site_table')
total_before = cur.fetchone()[0]
cur.execute('SELECT COUNT(*) FROM site_table WHERE "RealUSID" IS NULL')
unmapped = cur.fetchone()[0]
cur.execute('SELECT COUNT(*) FROM site_table WHERE "RealUSID" IS NOT NULL')
mapped = cur.fetchone()[0]

print(f"\n📊 Current status:")
print(f"   Total sites: {total_before}")
print(f"   Sites WITH data mapping: {mapped}")
print(f"   Sites WITHOUT mapping: {unmapped}")

# Also delete cells for unmapped sites
print(f"\n🗑️  Deleting cells for unmapped sites...")
cur.execute("""
    DELETE FROM cell_table 
    WHERE "SiteID" IN (
        SELECT "SiteID" FROM site_table WHERE "RealUSID" IS NULL
    )
""")
deleted_cells = cur.rowcount
print(f"   Deleted {deleted_cells} cells")

# Delete unmapped sites
print(f"\n🗑️  Deleting {unmapped} unmapped sites...")
cur.execute('DELETE FROM site_table WHERE "RealUSID" IS NULL')
deleted_sites = cur.rowcount

conn.commit()

# Verify
cur.execute('SELECT COUNT(*) FROM site_table')
total_after = cur.fetchone()[0]
cur.execute('SELECT COUNT(*) FROM cell_table')
total_cells = cur.fetchone()[0]

print(f"\n✅ Cleanup complete!")
print(f"   Deleted {deleted_sites} sites")
print(f"   Deleted {deleted_cells} cells")
print(f"   Remaining sites: {total_after}")
print(f"   Remaining cells: {total_cells}")

# Sample remaining sites
cur.execute('SELECT "SiteID", "RealUSID" FROM site_table LIMIT 10')
print(f"\n📋 Sample remaining sites:")
for row in cur.fetchall():
    print(f"   {row[0]} → {row[1]}")

cur.close()
conn.close()

print("\n" + "=" * 80)
print("✅ Database cleaned! Only sites with real data remain.")
print("=" * 80)
