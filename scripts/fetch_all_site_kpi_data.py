"""
Comprehensive KPI Data Fetcher
Fetches LTE Hourly and Daily KPI data for ALL sites in the topology
Maps real USIDs to dummy Site IDs and loads into Postgres
"""
import sys
import os
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from datetime import datetime, timedelta
import time

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

def load_usid_mapping(csv_path):
    """Load USID mapping from site_table CSV"""
    print(f"\n📂 Loading USID mapping from {csv_path}...")
    df = pd.read_csv(csv_path)
    
    # Create mapping: SiteIDOriginal (real USID) -> SiteID (dummy)
    mapping = dict(zip(df['SiteIDOriginal'].astype(str), df['SiteID'].astype(str)))
    unique_usids = df['SiteIDOriginal'].astype(str).unique()
    
    print(f"✅ Loaded {len(unique_usids)} unique USIDs")
    print(f"✅ Created mapping for {len(mapping)} records")
    
    return mapping, unique_usids.tolist()

def fetch_kpi_data_batch(connector, usid_list, start_date, end_date, granularity='daily', batch_size=50):
    """Fetch KPI data in batches to handle large numbers of USIDs"""
    print(f"\n📊 Fetching {granularity.upper()} data for {len(usid_list)} USIDs...")
    print(f"   Date range: {start_date} to {end_date}")
    print(f"   Batch size: {batch_size}")
    
    all_data = []
    failed_usids = []
    
    # Process in batches
    for batch_start in range(0, len(usid_list), batch_size):
        batch = usid_list[batch_start:batch_start + batch_size]
        batch_num = (batch_start // batch_size) + 1
        total_batches = (len(usid_list) + batch_size - 1) // batch_size
        
        print(f"\n🔄 Batch {batch_num}/{total_batches} ({len(batch)} USIDs)")
        
        batch_data = []
        for i, usid in enumerate(batch, 1):
            try:
                if granularity == 'hourly':
                    query = f"""
                    SELECT USID, DATE_ID, HOUR_ID, cell_name, kpi_name, kpi_value
                    FROM hourly_intermediate_kpis_table WITH (NOLOCK)
                    WHERE USID = '{usid}'
                    AND DATE_ID >= CAST('{start_date}' AS DATETIME)
                    AND DATE_ID <= CAST('{end_date}' AS DATETIME)
                    AND kpi_name IN ('{"', '".join(LTE_KPI_NAMES)}')
                    """
                else:  # daily
                    query = f"""
                    SELECT USID, DATE_ID, cell_name, kpi_name, kpi_value
                    FROM intermediate_kpi_table WITH (NOLOCK)
                    WHERE USID = '{usid}'
                    AND DATE_ID >= CAST('{start_date}' AS DATETIME)
                    AND DATE_ID <= CAST('{end_date}' AS DATETIME)
                    AND kpi_name IN ('{"', '".join(LTE_KPI_NAMES)}')
                    """
                
                df = connector.run_raw_query(query)
                
                if not df.empty:
                    batch_data.append(df)
                    print(f"  [{i}/{len(batch)}] {usid}: {len(df)} records ✓")
                else:
                    print(f"  [{i}/{len(batch)}] {usid}: No data")
                    
            except Exception as e:
                print(f"  [{i}/{len(batch)}] {usid}: ERROR - {str(e)[:100]}")
                failed_usids.append(usid)
            
            # Small delay to avoid overwhelming the API
            if i % 10 == 0:
                time.sleep(0.5)
        
        if batch_data:
            all_data.extend(batch_data)
            print(f"  ✅ Batch {batch_num} complete: {sum(len(df) for df in batch_data)} records")
    
    if all_data:
        combined = pd.concat(all_data, ignore_index=True)
        print(f"\n✅ Total {granularity} records fetched: {len(combined):,}")
        if failed_usids:
            print(f"⚠️  Failed USIDs: {len(failed_usids)}")
        return combined
    
    print(f"\n⚠️  No {granularity} data fetched")
    return pd.DataFrame()

def apply_usid_mapping(df, usid_mapping):
    """Apply dummy USID mapping to dataframe"""
    print(f"\n🔒 Applying USID mapping...")
    
    original_count = len(df)
    
    # Map USID to dummy site_id
    df['site_id'] = df['USID'].map(usid_mapping)
    
    # Remove rows where mapping failed
    unmapped = df['site_id'].isna().sum()
    if unmapped > 0:
        print(f"  ⚠️  {unmapped} records had no mapping, dropping them")
        df = df.dropna(subset=['site_id'])
    
    # Anonymize cell names
    df['cell_name'] = df.apply(
        lambda row: f"CELL_{pd.util.hash_pandas_object([row['cell_name']])[0] % 1000000:06d}",
        axis=1
    )
    
    # Drop original USID
    df = df.drop('USID', axis=1)
    
    print(f"✅ Mapped {len(df):,} records (dropped {original_count - len(df)})")
    return df

def clear_old_kpi_data(conn):
    """Clear old KPI data to start fresh"""
    print("\n🗑️  Clearing old KPI data...")
    with conn.cursor() as cur:
        cur.execute("TRUNCATE TABLE hourly_kpi_table")
        cur.execute("DELETE FROM intermediate_kpi_table WHERE \"DateID\" >= '2026-02-01'")
    conn.commit()
    print("✅ Old data cleared")

def load_hourly_to_postgres(df, conn):
    """Load hourly data to Postgres"""
    if df.empty:
        print("\n⚠️  No hourly data to load")
        return
    
    print(f"\n💾 Loading {len(df):,} HOURLY records to Postgres...")
    
    records = []
    for _, row in df.iterrows():
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
    
    with conn.cursor() as cur:
        # Ensure table exists
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
        
        # Insert in batches
        execute_values(
            cur,
            """
            INSERT INTO hourly_kpi_table 
            (site_id, cell_name, kpi_name, kpi_value, date_id, hour_id, anomaly_flag, anomaly_score)
            VALUES %s
            """,
            records,
            page_size=5000
        )
    
    conn.commit()
    print(f"✅ Loaded {len(records):,} hourly records")

def load_daily_to_postgres(df, conn):
    """Load daily data to Postgres"""
    if df.empty:
        print("\n⚠️  No daily data to load")
        return
    
    print(f"\n💾 Loading {len(df):,} DAILY records to Postgres...")
    
    records = []
    for _, row in df.iterrows():
        records.append((
            str(row['site_id']),
            str(row['cell_name']),
            str(row['kpi_name']),
            float(row['kpi_value']) if pd.notna(row['kpi_value']) else None,
            pd.to_datetime(row['DATE_ID']).date(),
            False,
            0.0
        ))
    
    with conn.cursor() as cur:
        # Insert in batches
        execute_values(
            cur,
            """
            INSERT INTO intermediate_kpi_table 
            ("SiteID", "CellName", "KPIName", "KPIValue", "DateID", "AnomalyFlag", "AnomalyScore")
            VALUES %s
            """,
            records,
            page_size=5000
        )
    
    conn.commit()
    print(f"✅ Loaded {len(records):,} daily records")

def main():
    """Main execution"""
    print("="*80)
    print("🚀 COMPREHENSIVE KPI DATA FETCH FOR ALL SITES")
    print("="*80)
    
    # Load USID mapping
    csv_path = "dummy_data_mapped/site_table.csv"
    usid_mapping, all_usids = load_usid_mapping(csv_path)
    
    print(f"\n📊 Statistics:")
    print(f"   Total USIDs to fetch: {len(all_usids)}")
    
    # Date range (last 14 days)
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=14)
    print(f"   Date range: {start_date} to {end_date}")
    
    # Initialize connector
    print("\n🔌 Connecting to remote Naavik database...")
    connector = NaavikDBConnector()
    print("✅ Connected")
    
    # Fetch daily data (all 14 days for all sites)
    daily_df = fetch_kpi_data_batch(
        connector, 
        all_usids, 
        start_date, 
        end_date, 
        granularity='daily',
        batch_size=100  # Larger batch for daily data
    )
    
    # Fetch hourly data (last 7 days only due to volume)
    hourly_start = end_date - timedelta(days=7)
    hourly_df = fetch_kpi_data_batch(
        connector, 
        all_usids, 
        hourly_start, 
        end_date, 
        granularity='hourly',
        batch_size=50  # Smaller batch for hourly data (more volume)
    )
    
    if daily_df.empty and hourly_df.empty:
        print("\n❌ No data fetched. Exiting.")
        return
    
    # Apply mapping
    if not daily_df.empty:
        daily_df = apply_usid_mapping(daily_df, usid_mapping)
    
    if not hourly_df.empty:
        hourly_df = apply_usid_mapping(hourly_df, usid_mapping)
    
    # Save to CSV for backup
    os.makedirs("data", exist_ok=True)
    
    if not daily_df.empty:
        daily_csv = "data/all_sites_daily_kpi.csv"
        daily_df.to_csv(daily_csv, index=False)
        print(f"\n💾 Saved daily data to {daily_csv}")
    
    if not hourly_df.empty:
        hourly_csv = "data/all_sites_hourly_kpi.csv"
        hourly_df.to_csv(hourly_csv, index=False)
        print(f"\n💾 Saved hourly data to {hourly_csv}")
    
    # Connect to Postgres
    try:
        print("\n🔌 Connecting to Postgres...")
        conn = psycopg2.connect(**PG_CONFIG)
        print("✅ Connected")
        
        # Clear old data
        clear_old_kpi_data(conn)
        
        # Load data
        load_hourly_to_postgres(hourly_df, conn)
        load_daily_to_postgres(daily_df, conn)
        
        # Verify
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), COUNT(DISTINCT site_id) FROM hourly_kpi_table")
            h_count, h_sites = cur.fetchone()
            
            cur.execute('SELECT COUNT(*), COUNT(DISTINCT "SiteID") FROM intermediate_kpi_table')
            d_count, d_sites = cur.fetchone()
        
        print("\n" + "="*80)
        print("📊 FINAL DATABASE STATISTICS")
        print("="*80)
        print(f"Hourly KPI Table:")
        print(f"  Records: {h_count:,}")
        print(f"  Sites: {h_sites:,}")
        print(f"\nDaily KPI Table:")
        print(f"  Records: {d_count:,}")
        print(f"  Sites: {d_sites:,}")
        print("="*80)
        
        conn.close()
        
    except Exception as e:
        print(f"\n❌ Database Error: {e}")
        import traceback
        traceback.print_exc()
    
    print("\n✅ COMPLETE!")

if __name__ == "__main__":
    main()
