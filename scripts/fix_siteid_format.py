import os
"""
Fix SiteID format: Add 'UST' prefix to numeric SiteIDs
Convert: 105013 → UST105013
"""
import psycopg2

PG_CONFIG = {
    'host': 'localhost',
    'database': 'naavik_demo',
    'user': 'naavik_user',
    'password': 'naavik_pass_2026',
    'port': int(os.getenv('DB_PORT', '5433'))
}

print("=" * 80)
print("FIXING SITEID FORMAT")
print("=" * 80)

conn = psycopg2.connect(**PG_CONFIG)
cur = conn.cursor()

# Find all SiteIDs without UST prefix (numeric only)
print("\n🔍 Finding SiteIDs without UST prefix...")
cur.execute("""
    SELECT DISTINCT "SiteID" 
    FROM site_table 
    WHERE "SiteID" NOT LIKE 'UST%'
    ORDER BY "SiteID"
    LIMIT 20
""")
sample_old = cur.fetchall()
print(f"Sample old format:")
for row in sample_old[:10]:
    print(f"   {row[0]} → UST{row[0]}")

# Count how many need fixing
cur.execute('SELECT COUNT(*) FROM site_table WHERE "SiteID" NOT LIKE \'UST%\'')
sites_to_fix = cur.fetchone()[0]
print(f"\n📊 Sites to fix: {sites_to_fix}")

if sites_to_fix == 0:
    print("✅ All SiteIDs already have UST prefix!")
    cur.close()
    conn.close()
    exit(0)

# Update site_table SiteIDs
print(f"\n🔄 Updating site_table SiteIDs...")
cur.execute("""
    UPDATE site_table
    SET "SiteID" = 'UST' || "SiteID"
    WHERE "SiteID" NOT LIKE 'UST%'
""")
print(f"   Updated {cur.rowcount} site rows")

# Update cell_table SiteIDs
print(f"\n🔄 Updating cell_table SiteIDs...")
cur.execute("""
    UPDATE cell_table
    SET "SiteID" = 'UST' || "SiteID"
    WHERE "SiteID" NOT LIKE 'UST%'
""")
print(f"   Updated {cur.rowcount} cell rows")

conn.commit()

# Verify
print(f"\n✅ Verification:")
cur.execute('SELECT COUNT(*) FROM site_table WHERE "SiteID" NOT LIKE \'UST%\'')
remaining = cur.fetchone()[0]
print(f"   Sites without UST prefix: {remaining}")

cur.execute('SELECT "SiteID" FROM site_table ORDER BY "SiteID" LIMIT 10')
print(f"\n   Sample SiteIDs after fix:")
for row in cur.fetchall():
    print(f"      {row[0]}")

cur.close()
conn.close()

print("\n" + "=" * 80)
print("✅ SITEID FORMAT FIXED!")
print("=" * 80)
