import os
"""
Load the large KPI CSV files into Postgres
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

def load_hourly(conn):
    print("\n📊 Loading HOURLY data...")
    df = pd.read_csv("data/all_usids_hourly_kpi.csv")
    print(f"  Read {len(df):,} records from CSV")
    
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
        cur.execute("CREATE TABLE IF NOT EXISTS hourly_kpi_table (id SERIAL PRIMARY KEY, site_id VARCHAR(255), cell_name VARCHAR(255), kpi_name VARCHAR(255), kpi_value DECIMAL(20,6), date_id DATE, hour_id INTEGER, anomaly_flag BOOLEAN DEFAULT FALSE, anomaly_score DECIMAL(10,4) DEFAULT 0.0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_hourly_kpi_site ON hourly_kpi_table(site_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_hourly_kpi_date ON hourly_kpi_table(date_id)")
        cur.execute("TRUNCATE TABLE hourly_kpi_table")
        
        execute_values(cur, "INSERT INTO hourly_kpi_table (site_id, cell_name, kpi_name, kpi_value, date_id, hour_id, anomaly_flag, anomaly_score) VALUES %s", records, page_size=10000)
    
    conn.commit()
    print(f"✅ Loaded {len(records):,} hourly records")

def load_daily(conn):
    print("\n📊 Loading DAILY data...")
    df = pd.read_csv("data/all_usids_daily_kpi.csv")
    print(f"  Read {len(df):,} records from CSV")
    
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
        cur.execute('DELETE FROM intermediate_kpi_table WHERE "DateID" >= \'2026-01-01\'')
        execute_values(cur, 'INSERT INTO intermediate_kpi_table ("SiteID", "CellName", "KPIName", "KPIValue", "DateID", "AnomalyFlag", "AnomalyScore") VALUES %s', records, page_size=10000)
    
    conn.commit()
    print(f"✅ Loaded {len(records):,} daily records")

def main():
    print("="*60)
    print("💾 LOADING LARGE KPI DATA FILES")
    print("="*60)
    
    conn = psycopg2.connect(**PG_CONFIG)
    print("✅ Connected to Postgres")
    
    load_hourly(conn)
    load_daily(conn)
    
    # Verify
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*), COUNT(DISTINCT site_id), COUNT(DISTINCT date_id) FROM hourly_kpi_table")
        h_count, h_sites, h_dates = cur.fetchone()
        
        cur.execute('SELECT COUNT(*), COUNT(DISTINCT "SiteID"), COUNT(DISTINCT "DateID") FROM intermediate_kpi_table')
        d_count, d_sites, d_dates = cur.fetchone()
    
    print("\n" + "="*60)
    print("📊 FINAL DATABASE STATISTICS")
    print("="*60)
    print(f"Hourly KPI Table:")
    print(f"  Records: {h_count:,}")
    print(f"  Sites: {h_sites}")
    print(f"  Dates: {h_dates}")
    print(f"\nDaily KPI Table:")
    print(f"  Records: {d_count:,}")
    print(f"  Sites: {d_sites}")
    print(f"  Dates: {d_dates}")
    print("="*60)
    
    conn.close()
    print("\n✅ COMPLETE!")

if __name__ == "__main__":
    main()
