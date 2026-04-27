"""
Fetch data from the Compass API and save to local files for anonymization
API: http://3.132.55.183:9050/api/query
"""
import requests
import json
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta

API_URL = "http://3.132.55.183:9050/api/query"
RAW_DATA_DIR = Path(__file__).parent.parent / "raw_data"
RAW_DATA_DIR.mkdir(exist_ok=True)

# Table configurations with their query details
TABLE_CONFIGS = {
    "cell_table": {
        "table": "cell_table",
        "limit": 100,
        "has_date_id": True
    },
    "site_table": {
        "table": "site_table",
        "limit": 50,
        "has_date_id": True
    },
    "sector_table": {
        "table": "sector_table",
        "limit": 100,
        "has_date_id": True
    },
    "intermediate_kpi_table": {
        "table": "intermediate_kpi_table",
        "limit": 500,
        "has_date_id": True
    },
    "hourly_intermediate_kpis_table": {
        "table": "hourly_intermediate_kpis_table",
        "limit": 1000,
        "has_date_id": True
    },
    "ticket_table": {
        "table": "ticket_table",
        "limit": 100,
        "has_date_id": True
    },
    "alarm_table": {
        "table": "alarm_table",
        "limit": 100,
        "has_date_id": True
    },
    "eim_table": {
        "table": "eim_table",
        "limit": 100,
        "has_date_id": True
    },
    "neighbors_table_date_id": {
        "table": "neighbors_table_date_id",
        "limit": 200,
        "has_date_id": True
    },
    "subcomponent_table": {
        "table": "subcomponent_table",
        "limit": 300,
        "has_date_id": True
    },
    "cqx_offenders_truth_table": {
        "table": "cqx_offenders_truth_table",
        "limit": 100,
        "has_date_id": True
    }
}

def build_query(table_name, config):
    """
    Build SQL query for the API (SQL Server syntax)
    """
    limit = config['limit']
    
    # Simple query to get data - no date filtering since data might be old
    if config['has_date_id']:
        # Order by DATE_ID to get most recent data available
        query = f"""
        SELECT TOP {limit} * 
        FROM {table_name}
        ORDER BY DATE_ID DESC
        """
    else:
        query = f"""
        SELECT TOP {limit} * 
        FROM {table_name}
        """
    
    return query.strip()

def fetch_table_data(table_name, config):
    """
    Fetch data for a specific table from the API
    """
    print(f"\n📥 Fetching {table_name}...")
    
    try:
        query = build_query(config['table'], config)
        
        print(f"   Query: {query[:100]}...")
        
        payload = {
            "query": query,
            "params": {}  # Required by the API - must be a dict
        }
        
        response = requests.post(
            API_URL,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=60
        )
        
        if response.status_code == 200:
            data = response.json()
            
            # Save raw JSON response
            json_path = RAW_DATA_DIR / f"{table_name}.json"
            with open(json_path, 'w') as f:
                json.dump(data, f, indent=2, default=str)
            
            # Extract result from response (API returns {result: [...]})
            if isinstance(data, dict) and 'result' in data:
                data = data['result']
            
            # Convert to DataFrame and save as CSV for easier inspection
            if isinstance(data, list) and len(data) > 0:
                df = pd.DataFrame(data)
                csv_path = RAW_DATA_DIR / f"{table_name}.csv"
                df.to_csv(csv_path, index=False)
                
                print(f"   ✓ Fetched {len(df)} rows, {len(df.columns)} columns")
                print(f"   ✓ Saved to {json_path.name} and {csv_path.name}")
                
                return df
            else:
                print(f"   ⚠ No data returned")
                return None
                
        else:
            print(f"   ✗ Error {response.status_code}: {response.text[:200]}")
            return None
            
    except Exception as e:
        print(f"   ✗ Exception: {str(e)}")
        return None

def main():
    """
    Fetch all tables from the API
    """
    print("="*70)
    print("🌐 COMPASS API DATA FETCHER")
    print("="*70)
    print(f"API URL: {API_URL}")
    print(f"Output directory: {RAW_DATA_DIR}")
    print(f"Tables to fetch: {len(TABLE_CONFIGS)}")
    
    results = {}
    success_count = 0
    
    for table_name, config in TABLE_CONFIGS.items():
        df = fetch_table_data(table_name, config)
        results[table_name] = df
        if df is not None:
            success_count += 1
    
    print("\n" + "="*70)
    print(f"✅ FETCH COMPLETE: {success_count}/{len(TABLE_CONFIGS)} tables fetched successfully")
    print("="*70)
    
    # Create summary report
    summary = {
        "fetch_time": datetime.now().isoformat(),
        "tables_fetched": success_count,
        "total_tables": len(TABLE_CONFIGS),
        "tables": {}
    }
    
    for table_name, df in results.items():
        if df is not None:
            summary["tables"][table_name] = {
                "rows": len(df),
                "columns": len(df.columns),
                "column_names": list(df.columns)
            }
    
    summary_path = RAW_DATA_DIR / "fetch_summary.json"
    with open(summary_path, 'w') as f:
        json.dump(summary, f, indent=2)
    
    print(f"\n📊 Summary saved to: {summary_path}")

if __name__ == "__main__":
    main()
