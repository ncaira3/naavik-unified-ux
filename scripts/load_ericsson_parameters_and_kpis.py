"""
Load Ericsson Parameters and KPI Descriptions from Excel into PostgreSQL
"""
import pandas as pd
import psycopg2
from psycopg2.extras import execute_batch
import os
from dotenv import load_dotenv
import numpy as np

# Load environment variables from backend/.env
base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(base_path, 'backend', '.env')
load_dotenv(env_path)

# Database connection
DB_CONFIG = {
    'dbname': os.getenv('DB_NAME', 'naavik_demo'),
    'user': os.getenv('DB_USER', 'naavik_user'),
    'password': os.getenv('DB_PASSWORD', 'naavik_pass_2026'),
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': os.getenv('DB_PORT', '5433')
}

def clean_value(value, is_boolean=False, is_integer=False, is_decimal=False):
    """Clean and convert values for PostgreSQL"""
    if pd.isna(value):
        return None
    
    # Handle boolean columns
    if is_boolean:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            # Only accept explicit True/False values
            lower_val = value.lower().strip()
            if lower_val in ('true', 'yes', '1'):
                return True
            elif lower_val in ('false', 'no', '0'):
                return False
            # Any other string value for boolean column means NULL/None
            return None
        return None
    
    # Handle integer columns
    if is_integer:
        if isinstance(value, (int, np.integer)):
            return int(value)
        if isinstance(value, str):
            # Try to parse integer, if it fails or contains range, return None
            try:
                return int(value)
            except:
                return None
        return None
    
    # Handle decimal columns
    if is_decimal:
        if isinstance(value, (int, np.integer, float, np.floating)):
            if isinstance(value, (float, np.floating)) and (np.isnan(value) or np.isinf(value)):
                return None
            return float(value)
        if isinstance(value, str):
            # Try to parse decimal, handle comma as decimal separator
            try:
                # Replace comma with period for European format
                cleaned = value.replace(',', '.')
                return float(cleaned)
            except:
                return None
        return None
    
    # Handle numeric values
    if isinstance(value, (np.integer, np.floating)):
        if np.isnan(value) or np.isinf(value):
            return None
        return float(value) if isinstance(value, np.floating) else int(value)
    
    # Handle strings
    if isinstance(value, str):
        # Truncate very long strings
        return value[:10000] if len(value) > 10000 else value
    
    # Handle booleans
    if isinstance(value, bool):
        return value
    
    return str(value)

def load_ericsson_parameters(conn, excel_path):
    """Load Ericsson Parameters from Excel"""
    print(f"\n📊 Loading Ericsson Parameters from {excel_path}...")
    
    try:
        df = pd.read_excel(excel_path)
        print(f"   Found {len(df)} parameters")
        
        # Column mapping from Excel to database
        column_map = {
            'Model': 'model',
            'MO Class': 'mo_class',
            'Parameter Name': 'parameter_name',
            'Sequence Length': 'sequence_length',
            'Parameter Description': 'parameter_description',
            'Data Type': 'data_type',
            'Range and Values': 'range_and_values',
            'Default Value': 'default_value',
            'MultiplicationFactor': 'multiplication_factor',
            'Unit': 'unit',
            'Resolution': 'resolution',
            'ReadOnly': 'read_only',
            'Restricted': 'restricted',
            'Mandatory': 'mandatory',
            'Persistent': 'persistent',
            'SystemCreated': 'system_created',
            'Change Take Effect': 'change_take_effect',
            'Disturbances': 'disturbances',
            'Dependencies': 'dependencies',
            'Deprecated': 'deprecated',
            'Obsolete': 'obsolete',
            'Precondition': 'precondition'
        }
        
        # Prepare insert query
        insert_query = """
            INSERT INTO ericsson_parameters (
                model, mo_class, parameter_name, sequence_length, parameter_description,
                data_type, range_and_values, default_value, multiplication_factor,
                unit, resolution, read_only, restricted, mandatory, persistent,
                system_created, change_take_effect, disturbances, dependencies,
                deprecated, obsolete, precondition
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            ON CONFLICT (model, mo_class, parameter_name) DO UPDATE SET
                parameter_description = EXCLUDED.parameter_description,
                data_type = EXCLUDED.data_type,
                range_and_values = EXCLUDED.range_and_values,
                default_value = EXCLUDED.default_value
        """
        
        # Prepare data
        boolean_columns = ['ReadOnly', 'Restricted', 'Mandatory', 'Persistent', 
                          'SystemCreated', 'Deprecated', 'Obsolete']
        integer_columns = ['Sequence Length']
        decimal_columns = ['MultiplicationFactor', 'Resolution']
        data = []
        for _, row in df.iterrows():
            values = []
            for excel_col, db_col in column_map.items():
                if excel_col in df.columns:
                    is_bool = excel_col in boolean_columns
                    is_int = excel_col in integer_columns
                    is_dec = excel_col in decimal_columns
                    values.append(clean_value(row[excel_col], is_boolean=is_bool, is_integer=is_int, is_decimal=is_dec))
                else:
                    values.append(None)
            data.append(tuple(values))
        
        # Batch insert
        cursor = conn.cursor()
        execute_batch(cursor, insert_query, data, page_size=1000)
        conn.commit()
        
        print(f"   ✅ Loaded {len(data)} parameters successfully")
        return len(data)
        
    except Exception as e:
        print(f"   ❌ Error loading parameters: {e}")
        conn.rollback()
        raise

def load_ericsson_kpis(conn, excel_path):
    """Load Ericsson KPI Descriptions from Excel"""
    print(f"\n📊 Loading Ericsson KPI Descriptions from {excel_path}...")
    
    try:
        df = pd.read_excel(excel_path)
        print(f"   Found {len(df)} KPIs")
        
        # Prepare insert query
        insert_query = """
            INSERT INTO ericsson_kpi_descriptions (
                metric, vendor, db_counter_name, description, category, poc
            ) VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
        """
        
        # Prepare data
        data = []
        for _, row in df.iterrows():
            data.append((
                clean_value(row.get('Metric')),
                clean_value(row.get('Vendor')),
                clean_value(row.get('DB Counter Name')),
                clean_value(row.get('Description')),
                clean_value(row.get('Category')),
                clean_value(row.get('POC')) if 'POC' in df.columns else None
            ))
        
        # Batch insert
        cursor = conn.cursor()
        execute_batch(cursor, insert_query, data, page_size=1000)
        conn.commit()
        
        print(f"   ✅ Loaded {len(data)} KPIs successfully")
        return len(data)
        
    except Exception as e:
        print(f"   ❌ Error loading KPIs: {e}")
        conn.rollback()
        raise

def main():
    """Main execution"""
    print("=" * 60)
    print("Ericsson Parameters & KPI Descriptions Loader")
    print("=" * 60)
    
    # Paths to Excel files
    base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    param_path = os.path.join(base_path, 'dummy_data', 'Ericsson Parameters.xlsx')
    kpi_path = os.path.join(base_path, 'dummy_data', 'Ericsson_KPI_Descriptions.xlsx')
    
    # Check if files exist
    if not os.path.exists(param_path):
        print(f"❌ Parameters file not found: {param_path}")
        return
    
    if not os.path.exists(kpi_path):
        print(f"❌ KPI file not found: {kpi_path}")
        return
    
    # Connect to database
    try:
        print("\n🔌 Connecting to PostgreSQL...")
        conn = psycopg2.connect(**DB_CONFIG)
        print("   ✅ Connected successfully")
        
        # Load data
        param_count = load_ericsson_parameters(conn, param_path)
        kpi_count = load_ericsson_kpis(conn, kpi_path)
        
        # Summary
        print("\n" + "=" * 60)
        print("✅ Loading Complete!")
        print("=" * 60)
        print(f"   Parameters loaded: {param_count}")
        print(f"   KPIs loaded: {kpi_count}")
        print("=" * 60)
        
        conn.close()
        
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        raise

if __name__ == '__main__':
    main()
