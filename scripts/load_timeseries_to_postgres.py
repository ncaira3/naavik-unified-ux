"""
Load LTE Hourly and Daily time series data from CSV to Postgres
This script loads the already-fetched and anonymized data
"""
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import os

# Postgres connection details
PG_CONFIG = {
    'host': 'localhost',
    'database': 'naavik_demo',
    'user': 'naavik_user',
    'password': 'naavik_pass_2026',
    'port': int(os.getenv('DB_PORT', '5433'))
}

def load_hourly_data(csv_path, conn):
    """Load hourly KPI data from CSV to Postgres"""
    print(f"\n📊 Loading hourly data from {csv_path}...")
    
    df = pd.read_csv(csv_path)
    print(f"  Read {len(df)} records from CSV")
    
    # Prepare records
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
    
    with conn.cursor() as cur:
        # Create table if not exists
        print("  Creating/verifying hourly_kpi_table...")
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
        print("  Truncating existing hourly data...")
        cur.execute("TRUNCATE TABLE hourly_kpi_table")
        
        # Insert data
        print(f"  Inserting {len(records)} hourly records...")
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

def load_daily_data(csv_path, conn):
    """Load daily KPI data from CSV to Postgres"""
    print(f"\n📊 Loading daily data from {csv_path}...")
    
    df = pd.read_csv(csv_path)
    print(f"  Read {len(df)} records from CSV")
    
    # Get unique site IDs
    unique_sites = df['site_id'].unique()
    print(f"  Processing {len(unique_sites)} unique sites")
    
    # Prepare records
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
        # Check what columns actually exist in the table
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'intermediate_kpi_table'
            ORDER BY ordinal_position
        """)
        columns = [row[0] for row in cur.fetchall()]
        print(f"  Table columns found: {', '.join(columns[:10])}...")
        
        # Clear data ONLY for these sites in this date range
        min_date = pd.to_datetime(df['DATE_ID'].min()).date()
        max_date = pd.to_datetime(df['DATE_ID'].max()).date()
        
        # Use correct column names based on what exists
        site_col = next((c for c in columns if c.lower() == 'siteid'), 'site_id')
        date_col = next((c for c in columns if c.lower() == 'dateid'), 'date_id')
        
        # Delete only for these specific sites and date range
        site_list = ','.join([f"'{s}'" for s in unique_sites])
        delete_query = f"""
            DELETE FROM intermediate_kpi_table 
            WHERE "{site_col}" IN ({site_list})
            AND "{date_col}" >= '{min_date}' AND "{date_col}" <= '{max_date}'
        """
        print(f"  Clearing existing records for sites in date range {min_date} to {max_date}...")
        cur.execute(delete_query)
        deleted = cur.rowcount
        print(f"  Deleted {deleted} existing records")
        
        # Determine insert column names
        col_mapping = {
            'site_id': next((c for c in columns if c.lower() == 'siteid'), 'site_id'),
            'cell_name': next((c for c in columns if c.lower() == 'cellname'), 'cell_name'),
            'kpi_name': next((c for c in columns if c.lower() == 'kpiname'), 'kpi_name'),
            'kpi_value': next((c for c in columns if c.lower() == 'kpivalue'), 'kpi_value'),
            'date_id': next((c for c in columns if c.lower() == 'dateid'), 'date_id'),
            'anomaly_flag': next((c for c in columns if c.lower() == 'anomalyflag'), 'anomaly_flag'),
            'anomaly_score': next((c for c in columns if c.lower() == 'anomalyscore'), 'anomaly_score'),
        }
        
        col_names = ', '.join([f'"{col_mapping[k]}"' for k in ['site_id', 'cell_name', 'kpi_name', 'kpi_value', 'date_id', 'anomaly_flag', 'anomaly_score']])
        
        # Insert new data
        print(f"  Inserting {len(records)} daily records...")
        insert_query = f"""
            INSERT INTO intermediate_kpi_table 
            ({col_names})
            VALUES %s
        """
        execute_values(cur, insert_query, records, page_size=1000)
    
    conn.commit()
    print(f"✅ Loaded {len(records)} daily records to Postgres")

def main():
    """Main execution"""
    print("="*80)
    print("💾 Loading LTE Time Series Data to Postgres")
    print("="*80)
    
    hourly_csv = "data/lte_hourly_timeseries.csv"
    daily_csv = "data/lte_daily_timeseries.csv"
    
    # Check files exist
    if not os.path.exists(hourly_csv):
        print(f"❌ Hourly data file not found: {hourly_csv}")
        return
    
    if not os.path.exists(daily_csv):
        print(f"❌ Daily data file not found: {daily_csv}")
        return
    
    # Connect to Postgres
    try:
        print("\n🔌 Connecting to Postgres...")
        conn = psycopg2.connect(**PG_CONFIG)
        print("✅ Connected successfully")
        
        # Load hourly data
        load_hourly_data(hourly_csv, conn)
        
        # Load daily data
        load_daily_data(daily_csv, conn)
        
        # Verify data
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM hourly_kpi_table")
            hourly_count = cur.fetchone()[0]
            
            cur.execute("SELECT COUNT(DISTINCT date_id) FROM hourly_kpi_table")
            hourly_dates = cur.fetchone()[0]
            
            cur.execute('SELECT COUNT(*) FROM intermediate_kpi_table WHERE "DateID" > \'2026-02-01\'')
            daily_count = cur.fetchone()[0]
            
            cur.execute('SELECT COUNT(DISTINCT "DateID") FROM intermediate_kpi_table')
            daily_dates = cur.fetchone()[0]
        
        print("\n" + "="*80)
        print("📊 Database Statistics:")
        print(f"  Hourly KPI Table: {hourly_count:,} records across {hourly_dates} dates")
        print(f"  Daily KPI Table: {daily_count:,} new records, {daily_dates} total dates")
        print("="*80)
        
        conn.close()
        print("\n✅ All data loaded successfully!")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
