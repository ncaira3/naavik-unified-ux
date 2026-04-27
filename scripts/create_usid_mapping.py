"""
Create mapping between Dummy Site IDs and Real USIDs
This recreates the mapping that was used during data loading
"""
import sys
import os
import pandas as pd
import hashlib
import psycopg2

# Add naavik_data_visualizer to path
sys.path.append('/Users/admin/nirmalc/Code/Naavik/naavik_data_visualizer/backend/database')

from naavik_db_connector import NaavikDBConnector

# Postgres connection
PG_CONFIG = {
    'host': 'localhost',
    'database': 'naavik_demo',
    'user': 'naavik_user',
    'password': 'naavik_pass_2026',
    'port': int(os.getenv('DB_PORT', '5433'))
}

def create_dummy_site_id(real_usid):
    """Same function used in data loading - must match exactly"""
    hash_val = int(hashlib.md5(str(real_usid).encode()).hexdigest()[:8], 16)
    return f"UST{hash_val % 900000 + 100000}"

def get_all_usids_from_remote():
    """Get all USIDs from remote database"""
    print("🔍 Fetching all USIDs from remote database...")
    connector = NaavikDBConnector()
    query = "SELECT DISTINCT USID FROM intermediate_kpi_table ORDER BY USID"
    df = connector.run_raw_query(query)
    usids = df['USID'].astype(str).tolist()
    print(f"✅ Found {len(usids)} USIDs")
    return usids

def create_mapping(usids):
    """Create mapping dataframe"""
    print(f"\n🔄 Creating dummy ID mapping...")
    
    mapping = []
    for usid in usids:
        dummy_id = create_dummy_site_id(usid)
        mapping.append({
            'SiteID': dummy_id,
            'RealUSID': usid
        })
    
    df = pd.DataFrame(mapping)
    print(f"✅ Created {len(df)} mappings")
    print(f"\nSample mappings:")
    print(df.head(10))
    
    return df

def save_to_postgres(df):
    """Save mapping to Postgres"""
    print(f"\n💾 Saving mapping to Postgres...")
    
    conn = psycopg2.connect(**PG_CONFIG)
    cur = conn.cursor()
    
    try:
        # Add RealUSID column to site_table if it doesn't exist
        print("  Adding RealUSID column to site_table...")
        cur.execute("""
            ALTER TABLE site_table 
            ADD COLUMN IF NOT EXISTS "RealUSID" VARCHAR(50)
        """)
        conn.commit()
        print("  ✅ Column added")
        
        # Update site_table with real USIDs
        print("  Updating site_table with real USIDs...")
        update_count = 0
        for _, row in df.iterrows():
            cur.execute("""
                UPDATE site_table
                SET "RealUSID" = %s
                WHERE "SiteID" = %s
            """, (row['RealUSID'], row['SiteID']))
            update_count += cur.rowcount
        
        conn.commit()
        print(f"  ✅ Updated {update_count} rows")
        
        # Verify
        cur.execute('SELECT "SiteID", "RealUSID" FROM site_table WHERE "RealUSID" IS NOT NULL LIMIT 5')
        print("\n  Sample from database:")
        for row in cur.fetchall():
            print(f"    {row[0]} → {row[1]}")
        
    finally:
        cur.close()
        conn.close()
    
    print("\n✅ Mapping saved to Postgres!")

def save_to_csv(df):
    """Save mapping to CSV for reference"""
    output_path = '/Users/admin/nirmalc/Code/Naavik/naavik_unified_ux/data/usid_mapping.csv'
    df.to_csv(output_path, index=False)
    print(f"✅ Also saved to: {output_path}")

if __name__ == "__main__":
    print("=" * 80)
    print("Creating USID Mapping")
    print("=" * 80)
    
    # Get USIDs from remote
    usids = get_all_usids_from_remote()
    
    # Create mapping
    mapping_df = create_mapping(usids)
    
    # Save to Postgres
    save_to_postgres(mapping_df)
    
    # Save to CSV
    save_to_csv(mapping_df)
    
    print("\n" + "=" * 80)
    print("✅ USID mapping creation complete!")
    print("=" * 80)
