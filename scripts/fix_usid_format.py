import os
"""
Fix RealUSID format - remove .0 from float values
Convert 13068.0 → 13068
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
print("Fixing RealUSID Format")
print("=" * 80)

# Check current format
print("\n📊 Checking current RealUSID values...")
cur.execute('SELECT "RealUSID" FROM site_table WHERE "RealUSID" IS NOT NULL LIMIT 10')
samples = cur.fetchall()
print("\nSample values:")
for row in samples:
    print(f"  {row[0]}")

# Update all RealUSID values to remove .0
print("\n🔄 Removing .0 from float values...")

cur.execute("""
    UPDATE site_table
    SET "RealUSID" = REPLACE("RealUSID", '.0', '')
    WHERE "RealUSID" LIKE '%.0'
""")

affected = cur.rowcount
conn.commit()

print(f"✅ Updated {affected} rows")

# Verify
print("\n✅ Verification - Sample values after fix:")
cur.execute('SELECT "SiteID", "RealUSID" FROM site_table WHERE "RealUSID" IS NOT NULL LIMIT 10')
for row in cur.fetchall():
    print(f"  {row[0]} → {row[1]}")

# Check specific sites
test_sites = ['UST109271', 'UST852037', 'UST619593']
print("\n🔍 Checking test sites:")
for site in test_sites:
    cur.execute('SELECT "SiteID", "RealUSID" FROM site_table WHERE "SiteID" = %s', (site,))
    result = cur.fetchone()
    if result:
        print(f"  ✅ {result[0]} → {result[1]}")

cur.close()
conn.close()

print("\n" + "=" * 80)
print("✅ RealUSID format fixed!")
print("=" * 80)
