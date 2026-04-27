"""
Fetch filtered data based on geographic location and date range
1. Get sites from last 5 available dates
2. Filter by 38-mile radius around Union City, California
3. Fetch all data for filtered SiteIDs (30 days for KPIs, 5 days for others)
"""
import requests
import json
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime, timedelta
from math import radians, cos, sin, asin, sqrt

API_URL = "http://3.132.55.183:9050/api/query"
FILTERED_DATA_DIR = Path(__file__).parent.parent / "filtered_data"
FILTERED_DATA_DIR.mkdir(exist_ok=True)

# Source API site identifier column name (we normalize to SiteID in all output CSVs)
_SOURCE_SITE_COL = "SiteID"  # use "SiteID" if API returns it; else set to legacy name for API compatibility

def _site_id_column(df):
    """Return the site identifier column name in the dataframe (prefer SiteID)."""
    if df is None or df.empty:
        return None
    if "SiteID" in df.columns:
        return "SiteID"
    if _SOURCE_SITE_COL in df.columns:
        return _SOURCE_SITE_COL
    return None

def _normalize_site_id_columns(df):
    """Ensure dataframe uses SiteID for site identifier; rename if needed."""
    if df is None or df.empty:
        return df
    col = _site_id_column(df)
    if col and col != "SiteID":
        df = df.rename(columns={col: "SiteID"})
    for old, new in [("SOURCE_USID", "SourceSiteID"), ("NEIGH_USID", "NeighborSiteID")]:
        if old in df.columns:
            df = df.rename(columns={old: new})
    return df

# Union City, California coordinates
UNION_CITY_LAT = 37.5933
UNION_CITY_LON = -122.0438
RADIUS_MILES = 38
RADIUS_KM = RADIUS_MILES * 1.60934  # Convert miles to km

def haversine_distance(lat1, lon1, lat2, lon2):
    """
    Calculate the great circle distance between two points 
    on the earth (specified in decimal degrees)
    Returns distance in kilometers
    """
    # Convert decimal degrees to radians
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    
    # Haversine formula
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a))
    
    # Radius of earth in kilometers
    r = 6371
    
    return c * r

def query_api(query):
    """Execute query against Compass API"""
    try:
        payload = {
            "query": query,
            "params": {}
        }
        
        response = requests.post(
            API_URL,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=120
        )
        
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, dict) and 'result' in data:
                return data['result']
            return data
        else:
            print(f"   API Error {response.status_code}: {response.text[:200]}")
            return None
            
    except Exception as e:
        print(f"   Exception: {e}")
        return None

def get_sites_last_5_dates():
    """Get sites from the last 5 available dates"""
    print("\n📍 Step 1: Fetching sites from last 5 available dates...")
    
    # First, get the last 5 distinct dates
    date_query = """
    SELECT DISTINCT TOP 5 DATE_ID 
    FROM site_table 
    WHERE DATE_ID IS NOT NULL 
    ORDER BY DATE_ID DESC
    """
    
    dates = query_api(date_query)
    if not dates:
        print("   ✗ Could not fetch dates")
        return None
    
    date_list = [d['DATE_ID'] for d in dates]
    print(f"   ✓ Found {len(date_list)} dates: {date_list}")
    
    # Get sites for these dates
    date_str = "', '".join(date_list)
    site_query = f"""
    SELECT DISTINCT site_id, LATITUDE, LONGITUDE, DATE_ID, site_name
    FROM site_table
    WHERE DATE_ID IN ('{date_str}')
    AND LATITUDE IS NOT NULL
    AND LONGITUDE IS NOT NULL
    """
    
    sites = query_api(site_query)
    if sites:
        df = pd.DataFrame(sites)
        df = _normalize_site_id_columns(df)
        if "SiteID" not in df.columns and "site_id" in df.columns:
            df["SiteID"] = df["site_id"]
        print(f"   ✓ Fetched {len(df)} site records")
        return df

    return None

def filter_by_geography(sites_df):
    """Filter sites within 38-mile radius of Union City, CA"""
    print(f"\n🌐 Step 2: Filtering sites within {RADIUS_MILES} miles of Union City, CA...")
    print(f"   Union City coordinates: ({UNION_CITY_LAT}, {UNION_CITY_LON})")
    
    # Calculate distance for each site
    sites_df['distance_km'] = sites_df.apply(
        lambda row: haversine_distance(
            UNION_CITY_LAT, UNION_CITY_LON,
            row['LATITUDE'], row['LONGITUDE']
        ),
        axis=1
    )
    
    sites_df['distance_miles'] = sites_df['distance_km'] / 1.60934
    
    # Filter by radius
    filtered_df = sites_df[sites_df['distance_km'] <= RADIUS_KM].copy()
    
    print(f"   ✓ Found {len(filtered_df)} sites within {RADIUS_MILES} miles")
    print(f"   Distance range: {filtered_df['distance_miles'].min():.1f} - {filtered_df['distance_miles'].max():.1f} miles")
    
    # Get unique SiteIDs
    site_id_col = "SiteID" if "SiteID" in filtered_df.columns else _site_id_column(filtered_df)
    unique_site_ids = filtered_df[site_id_col].unique() if site_id_col else []
    print(f"   ✓ Unique SiteIDs: {len(unique_site_ids)}")

    # Save filtered sites
    filtered_df.to_csv(FILTERED_DATA_DIR / "filtered_sites.csv", index=False)

    return filtered_df, unique_site_ids

def fetch_table_for_sites(table_name, site_id_list, days_back=5, limit_per_site=None):
    """Fetch data for specific SiteIDs. Output CSVs use SiteID column names."""
    print(f"\n📥 Fetching {table_name} for {len(site_id_list)} sites (last {days_back} days)...")

    site_id_str = "', '".join([str(s) for s in site_id_list])

    # Source API filter by site (column name may vary; we output SiteID in CSV)
    if table_name == "neighbors_table_date_id":
        site_condition = f"(SOURCE_USID IN ('{site_id_str}') OR NEIGH_USID IN ('{site_id_str}'))"
    else:
        site_condition = f"{_SOURCE_SITE_COL} IN ('{site_id_str}')"

    total_limit = limit_per_site * len(site_id_list) if limit_per_site else 10000

    query = f"""
    SELECT TOP {total_limit} *
    FROM {table_name}
    WHERE {site_condition}
    AND DATE_ID >= DATEADD(day, -{days_back}, CAST(GETDATE() AS DATE))
    ORDER BY DATE_ID DESC
    """

    result = query_api(query)

    if result:
        df = pd.DataFrame(result)
        df = _normalize_site_id_columns(df)

        # Save to CSV (with SiteID column names)
        output_file = FILTERED_DATA_DIR / f"{table_name}.csv"
        df.to_csv(output_file, index=False)
        
        print(f"   ✓ Fetched {len(df)} rows")
        print(f"   ✓ Saved to {output_file.name}")
        
        return df
    else:
        print(f"   ⚠ No data returned")
        return None

def main():
    """Main execution"""
    print("="*70)
    print("🎯 FILTERED DATA FETCHER - UNION CITY REGION")
    print("="*70)
    
    # Step 1: Get sites from last 5 dates
    sites_df = get_sites_last_5_dates()
    if sites_df is None:
        print("\n✗ Failed to fetch sites. Exiting.")
        return
    
    # Step 2: Filter by geography
    filtered_sites, site_id_list = filter_by_geography(sites_df)

    if len(site_id_list) == 0:
        print("\n✗ No sites found in target area. Exiting.")
        return

    # Step 3: Fetch data for filtered SiteIDs
    print("\n" + "="*70)
    print("📊 FETCHING DATA FOR FILTERED SITES")
    print("="*70)

    tables_config = {
        'intermediate_kpi_table': {'days': 30, 'limit_per_site': 50},
        'cell_table': {'days': 5, 'limit_per_site': 10},
        'site_table': {'days': 5, 'limit_per_site': 5},
        'sector_table': {'days': 5, 'limit_per_site': 10},
        'ticket_table': {'days': 5, 'limit_per_site': 10},
        'alarm_table': {'days': 5, 'limit_per_site': 10},
        'eim_table': {'days': 5, 'limit_per_site': 10},
        'neighbors_table_date_id': {'days': 5, 'limit_per_site': 20},
        'subcomponent_table': {'days': 5, 'limit_per_site': 30},
        'cqx_offenders_truth_table': {'days': 5, 'limit_per_site': 5},
    }

    results = {}
    for table_name, config in tables_config.items():
        df = fetch_table_for_sites(
            table_name,
            site_id_list,
            days_back=config['days'],
            limit_per_site=config['limit_per_site']
        )
        results[table_name] = df
    
    # Summary
    print("\n" + "="*70)
    print("✅ FETCH COMPLETE")
    print("="*70)
    
    print(f"\n📍 Region: {RADIUS_MILES}-mile radius around Union City, CA")
    print(f"📊 Sites found: {len(site_id_list)}")
    print(f"📅 Date range: Last 5 days (30 days for KPIs)")
    
    print("\n📋 Tables fetched:")
    total_rows = 0
    for table_name, df in results.items():
        if df is not None:
            rows = len(df)
            total_rows += rows
            print(f"   • {table_name}: {rows} rows")
        else:
            print(f"   • {table_name}: No data")
    
    print(f"\n✅ Total rows fetched: {total_rows}")
    
    # Save summary
    summary = {
        'fetch_time': datetime.now().isoformat(),
        'center_location': {
            'city': 'Union City, CA',
            'latitude': UNION_CITY_LAT,
            'longitude': UNION_CITY_LON
        },
        'radius_miles': RADIUS_MILES,
        'sites_found': len(site_id_list),
        'site_id_list': list(site_id_list),
        'total_rows': total_rows,
        'tables': {name: len(df) if df is not None else 0 for name, df in results.items()}
    }
    
    with open(FILTERED_DATA_DIR / "fetch_summary.json", 'w') as f:
        json.dump(summary, f, indent=2, default=str)
    
    print(f"\n📊 Summary saved to: filtered_data/fetch_summary.json")

if __name__ == "__main__":
    main()
