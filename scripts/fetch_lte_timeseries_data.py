"""
Fetch LTE Hourly and Daily KPI data from Naavik DB Connector
Maps real USIDs to dummy Site IDs and loads into Postgres
"""
import sys
import os
import pandas as pd
import hashlib
from datetime import datetime, timedelta
import psycopg2
from psycopg2.extras import execute_values

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

def create_site_id_mapping(real_usids):
    """
    Create a mapping from real USIDs to dummy Site IDs (UST format)
    Uses hash to ensure consistency
    """
    mapping = {}
    for usid in real_usids:
        # Create a consistent hash-based dummy ID
        hash_val = int(hashlib.md5(str(usid).encode()).hexdigest()[:8], 16)
        dummy_id = f"UST{hash_val % 900000 + 100000}"  # Range: UST100000 - UST999999
        mapping[usid] = dummy_id
    return mapping

def fetch_hourly_data(connector, usid_list, start_date, end_date):
    """Fetch hourly KPI data for given USIDs"""
    print(f"\n🕐 Fetching HOURLY data for {len(usid_list)} USIDs from {start_date} to {end_date}...")
    
    all_data = []
    for i, usid in enumerate(usid_list, 1):
        print(f"  [{i}/{len(usid_list)}] Fetching hourly data for USID: {usid}")
        try:
            query = f"""
            SELECT USID, DATE_ID, HOUR_ID, cell_name, kpi_name, kpi_value
            FROM hourly_intermediate_kpis_table WITH (NOLOCK)
            WHERE USID = '{usid}'
            AND DATE_ID >= CAST('{start_date}' AS DATETIME)
            AND DATE_ID <= CAST('{end_date}' AS DATETIME)
            AND kpi_name IN ('{"', '".join(LTE_KPI_NAMES)}')
            """
            df = connector.run_raw_query(query)
            if not df.empty:
                all_data.append(df)
                print(f"    ✓ Got {len(df)} hourly records")
            else:
                print(f"    ⚠ No hourly data found")
        except Exception as e:
            print(f"    ❌ Error: {e}")
    
    if all_data:
        combined = pd.concat(all_data, ignore_index=True)
        print(f"\n✅ Total hourly records fetched: {len(combined)}")
        return combined
    return pd.DataFrame()

def fetch_daily_data(connector, usid_list, start_date, end_date):
    """Fetch daily KPI data for given USIDs"""
    print(f"\n📅 Fetching DAILY data for {len(usid_list)} USIDs from {start_date} to {end_date}...")
    
    all_data = []
    for i, usid in enumerate(usid_list, 1):
        print(f"  [{i}/{len(usid_list)}] Fetching daily data for USID: {usid}")
        try:
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
                all_data.append(df)
                print(f"    ✓ Got {len(df)} daily records")
            else:
                print(f"    ⚠ No daily data found")
        except Exception as e:
            print(f"    ❌ Error: {e}")
    
    if all_data:
        combined = pd.concat(all_data, ignore_index=True)
        print(f"\n✅ Total daily records fetched: {len(combined)}")
        return combined
    return pd.DataFrame()

def anonymize_data(df, usid_mapping, cell_name_mapping=None):
    """Replace real USIDs and cell names with dummy ones"""
    print("\n🔒 Anonymizing data...")
    
    # Replace USIDs
    df['site_id'] = df['USID'].map(usid_mapping)
    
    # Anonymize cell names if mapping provided
    if cell_name_mapping:
        df['cell_name'] = df['cell_name'].map(cell_name_mapping)
    else:
        # Generate dummy cell names based on site_id
        df['cell_name'] = df.apply(
            lambda row: f"NODE{hashlib.md5(str(row['cell_name']).encode()).hexdigest()[:8].upper()}_{row['kpi_name'][:3]}",
            axis=1
        )
    
    # Drop original USID column
    df = df.drop('USID', axis=1)
    
    print(f"✅ Anonymized {len(df)} records")
    return df

def load_to_postgres_hourly(df, conn):
    """Load hourly data into Postgres"""
    print("\n💾 Loading HOURLY data to Postgres...")
    
    # Prepare data for insertion
    records = []
    for _, row in df.iterrows():
        records.append((
            str(row['site_id']),
            str(row['cell_name']),
            str(row['kpi_name']),
            float(row['kpi_value']) if pd.notna(row['kpi_value']) else None,
            pd.to_datetime(row['DATE_ID']).date(),
            int(row['HOUR_ID']) if pd.notna(row['HOUR_ID']) else 0,
            False,  # anomaly_flag
            0.0     # anomaly_score
        ))
    
    # Create table if not exists
    with conn.cursor() as cur:
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
        
        # Create indexes
        cur.execute("CREATE INDEX IF NOT EXISTS idx_hourly_kpi_site ON hourly_kpi_table(site_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_hourly_kpi_date ON hourly_kpi_table(date_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_hourly_kpi_name ON hourly_kpi_table(kpi_name)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_hourly_kpi_hour ON hourly_kpi_table(hour_id)")
        
        # Clear existing data
        cur.execute("TRUNCATE TABLE hourly_kpi_table")
        
        # Insert data
        execute_values(
            cur,
            """
            INSERT INTO hourly_kpi_table 
            (site_id, cell_name, kpi_name, kpi_value, date_id, hour_id, anomaly_flag, anomaly_score)
            VALUES %s
            """,
            records,
            page_size=1000
        )
    
    conn.commit()
    print(f"✅ Loaded {len(records)} hourly records to Postgres")

def load_to_postgres_daily(df, conn):
    """Load daily data into Postgres (update existing intermediate_kpi_table)"""
    print("\n💾 Loading DAILY data to Postgres...")
    
    # Get unique site IDs from this dataset
    unique_sites = df['site_id'].unique()
    
    # Prepare data for insertion
    records = []
    for _, row in df.iterrows():
        records.append((
            str(row['site_id']),
            str(row['cell_name']),
            str(row['kpi_name']),
            float(row['kpi_value']) if pd.notna(row['kpi_value']) else None,
            pd.to_datetime(row['DATE_ID']).date(),
            False,  # anomaly_flag
            0.0     # anomaly_score
        ))
    
    with conn.cursor() as cur:
        # Clear existing data ONLY for the sites we're updating
        min_date = pd.to_datetime(df['DATE_ID'].min()).date()
        max_date = pd.to_datetime(df['DATE_ID'].max()).date()
        
        # Delete only for these specific sites and date range
        site_list = ','.join([f"'{s}'" for s in unique_sites])
        cur.execute(f"""
            DELETE FROM intermediate_kpi_table 
            WHERE site_id IN ({site_list})
            AND date_id >= '{min_date}' AND date_id <= '{max_date}'
        """)
        deleted_count = cur.rowcount
        print(f"  Cleared {deleted_count} existing records for {len(unique_sites)} sites from {min_date} to {max_date}")
        
        # Insert new data
        execute_values(
            cur,
            """
            INSERT INTO intermediate_kpi_table 
            (site_id, cell_name, kpi_name, kpi_value, date_id, anomaly_flag, anomaly_score)
            VALUES %s
            """,
            records,
            page_size=1000
        )
    
    conn.commit()
    print(f"✅ Loaded {len(records)} daily records to Postgres")

def main():
    """Main execution"""
    print("="*80)
    print("🚀 Starting LTE Time Series Data Fetch & Load")
    print("="*80)
    
    # Initialize DB connector
    connector = NaavikDBConnector()
    
    # Define date range (last 7 days)
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=7)
    
    print(f"\n📅 Date Range: {start_date} to {end_date}")
    
    # Get sample USIDs (use a small subset for testing)
    # In production, you'd want to get USIDs from your dummy data
    print("\n🔍 Getting available USIDs...")
    try:
        # Get USIDs from the remote database
        all_usids_query = "SELECT DISTINCT TOP 10 USID FROM subcomponent_table ORDER BY USID"
        usids_df = connector.run_raw_query(all_usids_query)
        
        if usids_df.empty:
            print("❌ No USIDs found in database")
            return
        
        usid_list = usids_df['USID'].astype(str).tolist()
        print(f"✅ Found {len(usid_list)} USIDs to process: {usid_list[:5]}...")
        
    except Exception as e:
        print(f"❌ Error getting USIDs: {e}")
        return
    
    # Create USID to Site ID mapping
    usid_mapping = create_site_id_mapping(usid_list)
    print(f"\n🗺️ Created mapping for {len(usid_mapping)} USIDs")
    print("Sample mappings:")
    for real_usid, dummy_id in list(usid_mapping.items())[:3]:
        print(f"  {real_usid} → {dummy_id}")
    
    # Fetch hourly data
    hourly_df = fetch_hourly_data(connector, usid_list, start_date, end_date)
    
    # Fetch daily data  
    daily_df = fetch_daily_data(connector, usid_list, start_date, end_date)
    
    if hourly_df.empty and daily_df.empty:
        print("\n⚠️ No data fetched. Exiting.")
        return
    
    # Anonymize data
    if not hourly_df.empty:
        hourly_df = anonymize_data(hourly_df, usid_mapping)
        
        # Save to CSV
        hourly_output = "data/lte_hourly_timeseries.csv"
        os.makedirs("data", exist_ok=True)
        hourly_df.to_csv(hourly_output, index=False)
        print(f"\n💾 Saved hourly data to {hourly_output}")
    
    if not daily_df.empty:
        daily_df = anonymize_data(daily_df, usid_mapping)
        
        # Save to CSV
        daily_output = "data/lte_daily_timeseries.csv"
        os.makedirs("data", exist_ok=True)
        daily_df.to_csv(daily_output, index=False)
        print(f"\n💾 Saved daily data to {daily_output}")
    
    # Load to Postgres
    try:
        conn = psycopg2.connect(**PG_CONFIG)
        print("\n✅ Connected to Postgres")
        
        if not hourly_df.empty:
            load_to_postgres_hourly(hourly_df, conn)
        
        if not daily_df.empty:
            load_to_postgres_daily(daily_df, conn)
        
        conn.close()
        print("\n✅ Database connection closed")
        
    except Exception as e:
        print(f"\n❌ Error connecting to Postgres: {e}")
        print("Make sure PostgreSQL is running and credentials are correct")
    
    print("\n" + "="*80)
    print("✅ LTE Time Series Data Fetch & Load Complete!")
    print("="*80)

if __name__ == "__main__":
    main()
