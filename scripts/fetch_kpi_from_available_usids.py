"""
Smart KPI Data Fetcher
1. Query remote database to get all available USIDs
2. Fetch KPI data for those USIDs (14 days daily, 7 days hourly)
3. Map to dummy Site IDs and load into Postgres
"""
import sys
import os
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from datetime import datetime, timedelta
import time
import hashlib

# Add the naavik_data_visualizer to path
sys.path.append('/Users/admin/nirmalc/Code/Naavik/naavik_data_visualizer/backend/database')

from naavik_db_connector import NaavikDBConnector

# Postgres connection details
PG_CONFIG = {
    'host': 'localhost',
    'database': 'naavik_demo',
    'user': 'naavik_user',
    'password': 'naavik_pass_2026',
    'port': int(os.getenv('DB_PORT', '5433'))
}

# KPIs to fetch for LTE
LTE_KPI_NAMES = [
    'DATA_ACC_RATE',
    'DATA_DROP_RATE',
    'NS_ESO_AVAIL',
    'PDCP_MB',
    'DL_DRB_TPUT',
    'AVG_DL_PRB_UTIL',
    'UL_DRB_TPUT',
    'AVG_UL_PRB_UTIL',
    'VOICE_ACC_RATE',
    'VOICE_DROP_RATE'
]

def create_dummy_site_id(real_usid):
    """Generate consistent dummy site ID from real USID"""
    hash_val = int(hashlib.md5(str(real_usid).encode()).hexdigest()[:8], 16)
    return f"UST{hash_val % 900000 + 100000}"

def get_available_usids(connector, limit=None):
    """Get all available USIDs from remote database"""
    print("\n🔍 Querying remote database for available USIDs...")
    
    limit_clause = f"TOP {limit}" if limit else ""
    query = f"SELECT DISTINCT {limit_clause} USID FROM intermediate_kpi_table ORDER BY USID"
    
    df = connector.run_raw_query(query)
    
    if df.empty:
        print("❌ No USIDs found in remote database")
        return []
    
    usids = df['USID'].astype(str).tolist()
    print(f"✅ Found {len(usids)} USIDs in remote database")
    
    return usids

def fetch_daily_data_bulk(connector, usid_list, start_date, end_date, batch_size=500):
    """Fetch daily KPI data using bulk IN clause"""
    print(f"\n📊 Fetching DAILY data for {len(usid_list)} USIDs...")
    print(f"   Date range: {start_date} to {end_date}")
    
    all_data = []
    
    # Process in batches for the IN clause
    for batch_start in range(0, len(usid_list), batch_size):
        batch = usid_list[batch_start:batch_start + batch_size]
        batch_num = (batch_start // batch_size) + 1
        total_batches = (len(usid_list) + batch_size - 1) // batch_size
        
        print(f"\n🔄 Batch {batch_num}/{total_batches} ({len(batch)} USIDs)")
        
        # Use IN clause for bulk query
        usid_list_str = "', '".join(batch)
        query = f"""
        SELECT USID, DATE_ID, cell_name, kpi_name, kpi_value
        FROM intermediate_kpi_table WITH (NOLOCK)
        WHERE USID IN ('{usid_list_str}')
        AND DATE_ID >= CAST('{start_date}' AS DATETIME)
        AND DATE_ID <= CAST('{end_date}' AS DATETIME)
        AND kpi_name IN ('{"', '".join(LTE_KPI_NAMES)}')
        """
        
        try:
            df = connector.run_raw_query(query)
            if not df.empty:
                all_data.append(df)
                print(f"  ✅ Batch {batch_num}: {len(df):,} records")
            else:
                print(f"  ⚠️  Batch {batch_num}: No data")
        except Exception as e:
            print(f"  ❌ Batch {batch_num}: ERROR - {str(e)[:200]}")
    
    if all_data:
        combined = pd.concat(all_data, ignore_index=True)
        print(f"\n✅ Total daily records: {len(combined):,}")
        return combined
    
    return pd.DataFrame()

def fetch_hourly_data_bulk(connector, usid_list, start_date, end_date, batch_size=100):
    """Fetch hourly KPI data using bulk IN clause"""
    print(f"\n📊 Fetching HOURLY data for {len(usid_list)} USIDs...")
    print(f"   Date range: {start_date} to {end_date}")
    
    all_data = []
    
    # Smaller batches for hourly data (more volume)
    for batch_start in range(0, len(usid_list), batch_size):
        batch = usid_list[batch_start:batch_start + batch_size]
        batch_num = (batch_start // batch_size) + 1
        total_batches = (len(usid_list) + batch_size - 1) // batch_size
        
        print(f"\n🔄 Batch {batch_num}/{total_batches} ({len(batch)} USIDs)")
        
        usid_list_str = "', '".join(batch)
        query = f"""
        SELECT USID, DATE_ID, HOUR_ID, cell_name, kpi_name, kpi_value
        FROM hourly_intermediate_kpis_table WITH (NOLOCK)
        WHERE USID IN ('{usid_list_str}')
        AND DATE_ID >= CAST('{start_date}' AS DATETIME)
        AND DATE_ID <= CAST('{end_date}' AS DATETIME)
        AND kpi_name IN ('{"', '".join(LTE_KPI_NAMES)}')
        """
        
        try:
            df = connector.run_raw_query(query)
            if not df.empty:
                all_data.append(df)
                print(f"  ✅ Batch {batch_num}: {len(df):,} records")
            else:
                print(f"  ⚠️  Batch {batch_num}: No data")
        except Exception as e:
            print(f"  ❌ Batch {batch_num}: ERROR - {str(e)[:200]}")
    
    if all_data:
        combined = pd.concat(all_data, ignore_index=True)
        print(f"\n✅ Total hourly records: {len(combined):,}")
        return combined
    
    return pd.DataFrame()

def anonymize_data(df, has_hour=False):
    """Anonymize USIDs and cell names"""
    print(f"\n🔒 Anonymizing data...")
    
    # Create dummy site IDs
    df['site_id'] = df['USID'].apply(create_dummy_site_id)
    
    # Anonymize cell names
    df['cell_name'] = df['cell_name'].apply(
        lambda x: f"CELL_{abs(hash(str(x))) % 1000000:06d}"
    )
    
    # Drop original USID
    df = df.drop('USID', axis=1)
    
    print(f"✅ Anonymized {len(df):,} records")
    return df

def clear_and_load_data(conn, hourly_df, daily_df):
    """Clear old data and load new data"""
    with conn.cursor() as cur:
        # Clear old KPI data
        print("\n🗑️  Clearing old KPI data...")
        cur.execute("TRUNCATE TABLE hourly_kpi_table")
        cur.execute("DELETE FROM intermediate_kpi_table WHERE \"DateID\" >= '2026-01-01'")
        conn.commit()
        print("✅ Old data cleared")
        
        # Create hourly table if needed
        cur.execute("""
            CREATE TABLE IF NOT EXISTS hourly_kpi_table (
                id SERIAL PRIMARY KEY,
                site_id VARCHAR(255),
                cell_name VARCHAR(255),
                kpi_name VARCHAR(255),
                kpi_value DECIMAL(20,6),
                date_id DATE,
                hour_id INTEGER,
                anomaly_flag BOOLEAN DEFAULT FALSE,
                anomaly_score DECIMAL(10,4) DEFAULT 0.0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        cur.execute("CREATE INDEX IF NOT EXISTS idx_hourly_kpi_site ON hourly_kpi_table(site_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_hourly_kpi_date ON hourly_kpi_table(date_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_hourly_kpi_name ON hourly_kpi_table(kpi_name)")
        
        # Load hourly data
        if not hourly_df.empty:
            print(f"\n💾 Loading {len(hourly_df):,} HOURLY records...")
            records = []
            for _, row in hourly_df.iterrows():
                records.append((
                    str(row['site_id']),
                    str(row['cell_name']),
                    str(row['kpi_name']),
                    float(row['kpi_value']) if pd.notna(row['kpi_value']) else None,
                    pd.to_datetime(row['DATE_ID']).date(),
                    int(row['HOUR_ID']) if pd.notna(row['HOUR_ID']) else 0,
                    False,
                    0.0
                ))
            
            execute_values(
                cur,
                """
                INSERT INTO hourly_kpi_table 
                (site_id, cell_name, kpi_name, kpi_value, date_id, hour_id, anomaly_flag, anomaly_score)
                VALUES %s
                """,
                records,
                page_size=10000
            )
            conn.commit()
            print(f"✅ Loaded {len(records):,} hourly records")
        
        # Load daily data
        if not daily_df.empty:
            print(f"\n💾 Loading {len(daily_df):,} DAILY records...")
            records = []
            for _, row in daily_df.iterrows():
                records.append((
                    str(row['site_id']),
                    str(row['cell_name']),
                    str(row['kpi_name']),
                    float(row['kpi_value']) if pd.notna(row['kpi_value']) else None,
                    pd.to_datetime(row['DATE_ID']).date(),
                    False,
                    0.0
                ))
            
            execute_values(
                cur,
                """
                INSERT INTO intermediate_kpi_table 
                ("SiteID", "CellName", "KPIName", "KPIValue", "DateID", "AnomalyFlag", "AnomalyScore")
                VALUES %s
                """,
                records,
                page_size=10000
            )
            conn.commit()
            print(f"✅ Loaded {len(records):,} daily records")

def main():
    """Main execution"""
    print("="*80)
    print("🚀 SMART KPI DATA FETCH - Using Available USIDs from Remote DB")
    print("="*80)
    
    # Initialize connector
    print("\n🔌 Connecting to remote Naavik database...")
    connector = NaavikDBConnector()
    print("✅ Connected")
    
    # Get available USIDs (limit to reasonable number for demo)
    # Remove limit or increase to get all USIDs
    all_usids = get_available_usids(connector, limit=500)
    
    if not all_usids:
        print("\n❌ No USIDs found. Exiting.")
        return
    
    print(f"\n📊 Will fetch data for {len(all_usids)} USIDs")
    
    # Date ranges
    end_date = datetime.now().date()
    daily_start = end_date - timedelta(days=14)
    hourly_start = end_date - timedelta(days=7)
    
    print(f"   Daily: {daily_start} to {end_date} (14 days)")
    print(f"   Hourly: {hourly_start} to {end_date} (7 days)")
    
    # Fetch data using bulk queries
    daily_df = fetch_daily_data_bulk(connector, all_usids, daily_start, end_date, batch_size=500)
    hourly_df = fetch_hourly_data_bulk(connector, all_usids, hourly_start, end_date, batch_size=100)
    
    if daily_df.empty and hourly_df.empty:
        print("\n❌ No data fetched. Exiting.")
        return
    
    # Anonymize
    if not daily_df.empty:
        daily_df = anonymize_data(daily_df, has_hour=False)
    
    if not hourly_df.empty:
        hourly_df = anonymize_data(hourly_df, has_hour=True)
    
    # Save backups
    os.makedirs("data", exist_ok=True)
    
    if not daily_df.empty:
        daily_df.to_csv("data/all_usids_daily_kpi.csv", index=False)
        print(f"\n💾 Saved daily backup: data/all_usids_daily_kpi.csv")
    
    if not hourly_df.empty:
        hourly_df.to_csv("data/all_usids_hourly_kpi.csv", index=False)
        print(f"\n💾 Saved hourly backup: data/all_usids_hourly_kpi.csv")
    
    # Load to Postgres
    try:
        print("\n🔌 Connecting to Postgres...")
        conn = psycopg2.connect(**PG_CONFIG)
        print("✅ Connected")
        
        clear_and_load_data(conn, hourly_df, daily_df)
        
        # Verify
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), COUNT(DISTINCT site_id), COUNT(DISTINCT date_id) FROM hourly_kpi_table")
            h_count, h_sites, h_dates = cur.fetchone()
            
            cur.execute('SELECT COUNT(*), COUNT(DISTINCT "SiteID"), COUNT(DISTINCT "DateID") FROM intermediate_kpi_table')
            d_count, d_sites, d_dates = cur.fetchone()
        
        print("\n" + "="*80)
        print("📊 FINAL DATABASE STATISTICS")
        print("="*80)
        print(f"Hourly KPI Table:")
        print(f"  Records: {h_count:,}")
        print(f"  Sites: {h_sites:,}")
        print(f"  Dates: {h_dates}")
        print(f"\nDaily KPI Table:")
        print(f"  Records: {d_count:,}")
        print(f"  Sites: {d_sites:,}")
        print(f"  Dates: {d_dates}")
        print("="*80)
        
        conn.close()
        print("\n✅ COMPLETE!")
        
    except Exception as e:
        print(f"\n❌ Database Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
