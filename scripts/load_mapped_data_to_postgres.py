import os
"""
Load mapped/transformed data into PostgreSQL database
"""
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from pathlib import Path
import sys

MAPPED_DATA_DIR = Path(__file__).parent.parent / "dummy_data_mapped"

# Database connection parameters
DB_CONFIG = {
    'host': 'localhost',
    'port': int(os.getenv('DB_PORT', '5433')),
    'database': 'naavik_demo',
    'user': 'naavik_user',
    'password': 'naavik_pass_2026'
}

# Table mappings
TABLE_MAPPINGS = {
    'cell_table.csv': 'cell_table',
    'site_table.csv': 'site_table',
    'sector_table.csv': 'sector_table',
    'intermediate_kpi_table.csv': 'intermediate_kpi_table',
    'ticket_table.csv': 'ticket_table',
    'eim_table.csv': 'eim_table',
    'subcomponent_table.csv': 'subcomponent_table',
    'cqx_offenders_truth_table.csv': 'cqx_offenders_truth_table',
}

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
    """Load mapped database schema"""
    schema_path = Path(__file__).parent.parent / "database" / "schema_mapped.sql"
    
    print(f"\n📋 Loading mapped schema from {schema_path}...")
    
    try:
        with open(schema_path, 'r') as f:
            schema_sql = f.read()
        
        with conn.cursor() as cur:
            cur.execute(schema_sql)
            conn.commit()
        
        print("✓ Mapped schema loaded successfully")
        return True
    except Exception as e:
        print(f"⚠ Schema load warning: {e}")
        # Continue anyway - tables might already exist
        conn.rollback()
        return True

def load_table_data(conn, csv_file, table_name):
    """Load data from CSV into database table"""
    csv_path = MAPPED_DATA_DIR / csv_file
    
    if not csv_path.exists():
        print(f"⚠ File not found: {csv_file}")
        return False
    
    print(f"\n📥 Loading {csv_file} into {table_name}...")
    
    try:
        # Read CSV
        df = pd.read_csv(csv_path)
        
        # Get column names (preserve case for mapped columns)
        columns = list(df.columns)
        
        # Handle boolean columns - convert empty strings and NaN to None
        boolean_cols = ['AnomalyFlag']
        for col in boolean_cols:
            if col in df.columns:
                def convert_bool(x):
                    if pd.isna(x) or x == '' or x is None:
                        return None
                    if isinstance(x, bool):
                        return x
                    if isinstance(x, (int, float)):
                        return bool(int(x)) if not pd.isna(x) else None
                    if isinstance(x, str):
                        return x.lower() in ['true', '1', 't', 'yes']
                    return None
                df[col] = df[col].apply(convert_bool)
        
        # Handle timestamp columns
        timestamp_cols = ['create_time', 'modified_time', 'closed_time', 'actual_start_dts']
        for col in timestamp_cols:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors='coerce')
                df[col] = df[col].apply(lambda x: None if pd.isna(x) or pd.isnull(x) else x)
        
        # Handle date columns
        date_cols = ['DateID']
        for col in date_cols:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors='coerce')
                df[col] = df[col].apply(lambda x: None if pd.isna(x) else x)
        
        # Replace NaN with None for SQL NULL
        df = df.where(pd.notnull(df), None)
        
        # Prepare INSERT statement with quoted column names (preserve case)
        columns_str = ', '.join([f'"{col}"' for col in columns])
        placeholders = ', '.join(['%s'] * len(columns))
        
        # Convert dataframe to list of tuples
        data = [tuple(row) for row in df.values]
        
        # Insert data in batches
        with conn.cursor() as cur:
            # First, truncate the table
            cur.execute(f'TRUNCATE TABLE {table_name} CASCADE')
            
            # Insert data using execute_values for better performance
            execute_values(
                cur,
                f'INSERT INTO {table_name} ({columns_str}) VALUES %s',
                data,
                page_size=1000
            )
            
            conn.commit()
        
        print(f"   ✓ Loaded {len(df)} rows into {table_name}")
        
        # Show sample data
        if len(df) > 0:
            print(f"   ✓ Sample columns: {', '.join(columns[:5])}")
        
        return True
        
    except Exception as e:
        print(f"   ✗ Error loading {csv_file}: {e}")
        import traceback
        traceback.print_exc()
        conn.rollback()
        return False

def verify_data(conn):
    """Verify loaded data"""
    print("\n" + "="*70)
    print("📊 DATA VERIFICATION")
    print("="*70)
    
    tables = list(TABLE_MAPPINGS.values())
    
    total_rows = 0
    with conn.cursor() as cur:
        for table in tables:
            try:
                cur.execute(f"SELECT COUNT(*) FROM {table}")
                count = cur.fetchone()[0]
                print(f"   {table}: {count:,} rows")
                total_rows += count
            except Exception as e:
                print(f"   {table}: Error - {e}")
    
    print(f"\n   TOTAL: {total_rows:,} rows")
    
    # Show sample data from key tables
    print("\n" + "="*70)
    print("🔍 SAMPLE DATA")
    print("="*70)
    
    with conn.cursor() as cur:
        # Sample from site_table
        try:
            cur.execute('SELECT "SiteID", "SiteName", "Latitude", "Longitude" FROM site_table LIMIT 5')
            rows = cur.fetchall()
            print("\n📍 Sample Sites:")
            for row in rows:
                print(f"   {row[0]} | {row[1]} | ({row[2]:.4f}, {row[3]:.4f})")
        except:
            pass
        
        # Sample from cell_table
        try:
            cur.execute('SELECT "CellName", "SiteID", "Technology" FROM cell_table LIMIT 5')
            rows = cur.fetchall()
            print("\n📡 Sample Cells:")
            for row in rows:
                print(f"   {row[0]} | {row[1]} | {row[2]}")
        except:
            pass
        
        # Sample KPIs
        try:
            cur.execute('SELECT DISTINCT "KPIName" FROM intermediate_kpi_table LIMIT 10')
            rows = cur.fetchall()
            print("\n📈 Available KPIs:")
            for row in rows:
                print(f"   • {row[0]}")
        except:
            pass

def main():
    """Main function"""
    print("="*70)
    print("🗄️  POSTGRESQL MAPPED DATA LOADER")
    print("="*70)
    print(f"Database: {DB_CONFIG['database']}@{DB_CONFIG['host']}:{DB_CONFIG['port']}")
    print(f"Data directory: {MAPPED_DATA_DIR}")
    print(f"Schema: MAPPED (dummy schema for UI)")
    
    # Create connection
    conn = create_connection()
    
    try:
        # Load schema
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
