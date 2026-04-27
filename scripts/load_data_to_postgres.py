import os
"""
Load anonymized data into PostgreSQL database
"""
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from pathlib import Path
import sys

DUMMY_DATA_DIR = Path(__file__).parent.parent / "dummy_data"

# Database connection parameters
DB_CONFIG = {
    'host': 'localhost',
    'port': int(os.getenv('DB_PORT', '5433')),
    'database': 'naavik_demo',
    'user': 'naavik_user',
    'password': 'naavik_pass_2026'
}

# Table mappings - CSV filename to database table name
TABLE_MAPPINGS = {
    'cell_table.csv': 'cell_table',
    'site_table.csv': 'site_table',
    'sector_table.csv': 'sector_table',
    'intermediate_kpi_table.csv': 'intermediate_kpi_table',
    'ticket_table.csv': 'ticket_table',
    'alarm_table.csv': 'alarm_table',
    'eim_table.csv': 'eim_table',
    'neighbors_table_date_id.csv': 'neighbors_table_date_id',
    'subcomponent_table.csv': 'subcomponent_table',
    'cqx_offenders_truth_table.csv': 'cqx_offenders_truth_table',
}

def normalize_column_name(col):
    """Normalize column names to PostgreSQL format (lowercase)"""
    return col.lower()

def create_connection():
    """Create database connection"""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        print(f"✓ Connected to database: {DB_CONFIG['database']}")
        return conn
    except Exception as e:
        print(f"✗ Error connecting to database: {e}")
        sys.exit(1)

def load_schema(conn):
    """Load database schema"""
    schema_path = Path(__file__).parent.parent / "database" / "schema.sql"
    
    print(f"\n📋 Loading schema from {schema_path}...")
    
    try:
        with open(schema_path, 'r') as f:
            schema_sql = f.read()
        
        with conn.cursor() as cur:
            cur.execute(schema_sql)
            conn.commit()
        
        print("✓ Schema loaded successfully")
        return True
    except Exception as e:
        print(f"✗ Error loading schema: {e}")
        conn.rollback()
        return False

def load_table_data(conn, csv_file, table_name):
    """Load data from CSV into database table"""
    csv_path = DUMMY_DATA_DIR / csv_file
    
    if not csv_path.exists():
        print(f"⚠ File not found: {csv_file}")
        return False
    
    print(f"\n📥 Loading {csv_file} into {table_name}...")
    
    try:
        # Read CSV
        df = pd.read_csv(csv_path)
        
        # Normalize column names
        df.columns = [normalize_column_name(col) for col in df.columns]
        
        # Handle boolean columns - convert NaN and numeric to proper boolean
        boolean_cols = ['anomaly_flag', 'outage']
        for col in boolean_cols:
            if col in df.columns:
                # Convert to proper boolean: 1/True -> True, 0/False -> False, NaN/None -> None
                df[col] = df[col].apply(lambda x: None if pd.isna(x) else bool(x) if isinstance(x, (int, float, bool)) and not pd.isna(x) else None)
        
        # Handle timestamp columns - set NaN/NaT to None
        timestamp_cols = ['outage_timestamp', 'deletedat', 'lastoccurrence', 'create_time', 
                         'modified_time', 'closed_time', 'actual_start_dts', 'update_time',
                         'initiated_at', 'completed_at', 'started_at']
        for col in timestamp_cols:
            if col in df.columns:
                # Convert timestamp columns, setting invalid values to None
                df[col] = pd.to_datetime(df[col], errors='coerce')
                # Replace NaT with None
                df[col] = df[col].apply(lambda x: None if pd.isna(x) or pd.isnull(x) else x)
        
        # Handle integer columns that might have string values or be too large
        integer_cols = ['equipmentpriority', 'alarm_duration', 'handover_count', 'ho_rank', 
                       'total_handover', 'cummulative_sum', 'num_kpis', 'cell_num']
        for col in integer_cols:
            if col in df.columns:
                # Convert non-numeric values to None, handle large values
                df[col] = pd.to_numeric(df[col], errors='coerce')
                # Cap very large integers (PostgreSQL INT max is ~2 billion)
                if df[col].dtype in ['int64', 'float64']:
                    df[col] = df[col].apply(lambda x: None if pd.isna(x) else (int(min(max(x, -2147483647), 2147483647)) if abs(x) < 1e10 else None))
        
        # Replace NaN with None for SQL NULL
        df = df.where(pd.notnull(df), None)
        
        # Get column names and prepare INSERT statement
        columns = list(df.columns)
        columns_str = ', '.join(columns)
        placeholders = ', '.join(['%s'] * len(columns))
        
        insert_sql = f"INSERT INTO {table_name} ({columns_str}) VALUES ({placeholders})"
        
        # Convert dataframe to list of tuples
        data = [tuple(row) for row in df.values]
        
        # Insert data in batches
        with conn.cursor() as cur:
            # First, truncate the table
            cur.execute(f"TRUNCATE TABLE {table_name} CASCADE")
            
            # Insert data using execute_values for better performance
            execute_values(
                cur,
                f"INSERT INTO {table_name} ({columns_str}) VALUES %s",
                data,
                page_size=1000
            )
            
            conn.commit()
        
        print(f"   ✓ Loaded {len(df)} rows into {table_name}")
        return True
        
    except Exception as e:
        print(f"   ✗ Error loading {csv_file}: {e}")
        conn.rollback()
        return False

def verify_data(conn):
    """Verify loaded data"""
    print("\n" + "="*70)
    print("📊 DATA VERIFICATION")
    print("="*70)
    
    tables = list(TABLE_MAPPINGS.values())
    
    with conn.cursor() as cur:
        for table in tables:
            try:
                cur.execute(f"SELECT COUNT(*) FROM {table}")
                count = cur.fetchone()[0]
                print(f"   {table}: {count} rows")
            except Exception as e:
                print(f"   {table}: Error - {e}")

def main():
    """Main function"""
    print("="*70)
    print("🗄️  POSTGRESQL DATA LOADER")
    print("="*70)
    print(f"Database: {DB_CONFIG['database']}@{DB_CONFIG['host']}:{DB_CONFIG['port']}")
    print(f"Data directory: {DUMMY_DATA_DIR}")
    
    # Create connection
    conn = create_connection()
    
    try:
        # Load schema (continue even if some parts fail, tables might already exist)
        load_schema(conn)
        
        # Load data for each table
        success_count = 0
        for csv_file, table_name in TABLE_MAPPINGS.items():
            if load_table_data(conn, csv_file, table_name):
                success_count += 1
        
        print("\n" + "="*70)
        print(f"✅ DATA LOAD COMPLETE: {success_count}/{len(TABLE_MAPPINGS)} tables loaded")
        print("="*70)
        
        # Verify data
        verify_data(conn)
        
    finally:
        conn.close()
        print("\n✓ Database connection closed")

if __name__ == "__main__":
    main()
