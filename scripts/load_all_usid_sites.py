import os
"""
Add ALL 7758 USIDs from remote database as new sites
This ensures we have data for sites visible on the map
"""
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import random

# Postgres connection
PG_CONFIG = {
    'host': 'localhost',
    'database': 'naavik_demo',
    'user': 'naavik_user',
    'password': 'naavik_pass_2026',
    'port': int(os.getenv('DB_PORT', '5433'))
}

def load_usid_mapping():
    """Load the USID mapping CSV"""
    df = pd.read_csv('/Users/admin/nirmalc/Code/Naavik/naavik_unified_ux/data/usid_mapping.csv')
    print(f"✅ Loaded {len(df)} USID mappings from CSV")
    return df

def get_existing_sites(conn):
    """Get existing dummy site IDs"""
    cur = conn.cursor()
    cur.execute('SELECT "SiteID" FROM site_table')
    existing = set(row[0] for row in cur.fetchall())
    cur.close()
    print(f"📊 Found {len(existing)} existing sites in database")
    return existing

def add_sites_to_database(df, conn):
    """Add missing sites to site_table"""
    existing_sites = get_existing_sites(conn)
    
    # Find sites that need to be added
    new_sites = df[~df['SiteID'].isin(existing_sites)].copy()
    print(f"\n🆕 Need to add {len(new_sites)} new sites")
    
    if len(new_sites) == 0:
        print("✅ All sites already exist")
        
        # Just update RealUSID for existing sites
        print("\n🔄 Updating RealUSID for existing sites...")
        cur = conn.cursor()
        for _, row in df.iterrows():
            cur.execute("""
                UPDATE site_table
                SET "RealUSID" = %s
                WHERE "SiteID" = %s
            """, (row['RealUSID'], row['SiteID']))
        conn.commit()
        print(f"✅ Updated {len(df)} existing sites")
        return
    
    # Generate fake location data for new sites (scatter across a region)
    # Using Northern California coordinates
    new_sites['Latitude'] = new_sites.apply(
        lambda x: 37.0 + random.uniform(-2, 2), axis=1
    )
    new_sites['Longitude'] = new_sites.apply(
        lambda x: -121.0 + random.uniform(-2, 2), axis=1
    )
    new_sites['SiteName'] = new_sites['SiteID'].apply(lambda x: f"Site_{x}")
    new_sites['CellCount'] = 3  # Default cell count
    new_sites['DateID'] = '2026-02-03'
    new_sites['AnomalyFlag'] = False
    new_sites['AnomalyScore'] = 0.0
    new_sites['SiteIDOriginal'] = None  # No UUID for these
    
    # Prepare data for bulk insert
    values = [
        (
            row['SiteIDOriginal'],
            row['SiteID'],
            row['SiteName'],
            row['CellCount'],
            row['Latitude'],
            row['Longitude'],
            row['DateID'],
            row['AnomalyFlag'],
            row['AnomalyScore'],
            row['RealUSID']
        )
        for _, row in new_sites.iterrows()
    ]
    
    # Insert new sites
    print("\n💾 Inserting new sites...")
    cur = conn.cursor()
    
    execute_values(
        cur,
        """
        INSERT INTO site_table (
            "SiteIDOriginal", "SiteID", "SiteName", "CellCount",
            "Latitude", "Longitude", "DateID", "AnomalyFlag", "AnomalyScore",
            "RealUSID"
        ) VALUES %s
        """,
        values,
        page_size=1000
    )
    
    conn.commit()
    print(f"✅ Inserted {len(new_sites)} new sites")
    
    # Also update existing sites with RealUSID
    print("\n🔄 Updating RealUSID for existing sites...")
    existing_updates = df[df['SiteID'].isin(existing_sites)]
    for _, row in existing_updates.iterrows():
        cur.execute("""
            UPDATE site_table
            SET "RealUSID" = %s
            WHERE "SiteID" = %s
        """, (row['RealUSID'], row['SiteID']))
    conn.commit()
    print(f"✅ Updated {len(existing_updates)} existing sites")
    
    cur.close()

def verify_mappings(conn):
    """Verify the mappings were loaded"""
    cur = conn.cursor()
    
    # Count total mappings
    cur.execute('SELECT COUNT(*) FROM site_table WHERE "RealUSID" IS NOT NULL')
    total = cur.fetchone()[0]
    print(f"\n✅ Total sites with RealUSID: {total}")
    
    # Sample some mappings
    cur.execute('SELECT "SiteID", "RealUSID" FROM site_table WHERE "RealUSID" IS NOT NULL LIMIT 10')
    print("\n📋 Sample mappings:")
    for row in cur.fetchall():
        print(f"   {row[0]} → {row[1]}")
    
    # Check specific sites
    test_sites = ['UST109271', 'UST852037', 'UST85203']
    print("\n🔍 Checking specific sites:")
    for site in test_sites:
        cur.execute('SELECT "SiteID", "RealUSID" FROM site_table WHERE "SiteID" = %s', (site,))
        result = cur.fetchone()
        if result:
            print(f"   ✅ {result[0]} → {result[1]}")
        else:
            print(f"   ❌ {site} not found")
    
    cur.close()

if __name__ == "__main__":
    print("=" * 80)
    print("Loading ALL USID Mappings to Database")
    print("=" * 80)
    
    # Load mapping
    mapping_df = load_usid_mapping()
    
    # Connect to database
    conn = psycopg2.connect(**PG_CONFIG)
    
    try:
        # Add sites
        add_sites_to_database(mapping_df, conn)
        
        # Verify
        verify_mappings(conn)
        
    finally:
        conn.close()
    
    print("\n" + "=" * 80)
    print("✅ ALL USID mappings loaded successfully!")
    print("=" * 80)
