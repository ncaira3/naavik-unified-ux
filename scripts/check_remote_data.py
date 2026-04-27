"""
Check what data is actually available in the remote database
"""
import sys
sys.path.append('/Users/admin/nirmalc/Code/Naavik/naavik_data_visualizer/backend/database')

from naavik_db_connector import NaavikDBConnector
import pandas as pd
from datetime import datetime, timedelta

connector = NaavikDBConnector()

# Check what USIDs have data
print("=" * 80)
print("1. Checking which USIDs have DATA_ACC_RATE data...")
print("=" * 80)

query = """
SELECT TOP 10 USID, COUNT(*) as record_count, MIN(DATE_ID) as min_date, MAX(DATE_ID) as max_date
FROM intermediate_kpi_table WITH (NOLOCK)
WHERE kpi_name = 'DATA_ACC_RATE'
GROUP BY USID
ORDER BY record_count DESC
"""

df = connector.run_raw_query(query)
print("\nTop 10 USIDs with DATA_ACC_RATE data:")
print(df)

# Check specific USID
print("\n" + "=" * 80)
print("2. Checking USID 197636 specifically...")
print("=" * 80)

query2 = """
SELECT TOP 20 USID, DATE_ID, cell_name, kpi_name, kpi_value
FROM intermediate_kpi_table WITH (NOLOCK)
WHERE USID = '197636'
AND kpi_name = 'DATA_ACC_RATE'
ORDER BY DATE_ID DESC
"""

df2 = connector.run_raw_query(query2)
if df2.empty:
    print("\n❌ NO DATA found for USID 197636 with DATA_ACC_RATE")
    
    # Check if USID 197636 exists at all
    query3 = """
    SELECT TOP 20 USID, DATE_ID, kpi_name
    FROM intermediate_kpi_table WITH (NOLOCK)
    WHERE USID = '197636'
    ORDER BY DATE_ID DESC
    """
    df3 = connector.run_raw_query(query3)
    if df3.empty:
        print("❌ USID 197636 does NOT exist in the database at all")
    else:
        print(f"\n✅ USID 197636 EXISTS with {len(df3)} records:")
        print(df3)
else:
    print(f"\n✅ Found {len(df2)} records for USID 197636:")
    print(df2.head(10))

# Check our mapped USIDs
print("\n" + "=" * 80)
print("3. Checking our mapped USIDs...")
print("=" * 80)

mapped_usids = ['197636', '127460', '13026']

for usid in mapped_usids:
    query4 = f"""
    SELECT COUNT(*) as count
    FROM intermediate_kpi_table WITH (NOLOCK)
    WHERE USID = '{usid}'
    AND kpi_name = 'DATA_ACC_RATE'
    """
    
    df4 = connector.run_raw_query(query4)
    count = df4['count'].iloc[0] if not df4.empty else 0
    print(f"USID {usid}: {count} DATA_ACC_RATE records")

# Check what date range has data
print("\n" + "=" * 80)
print("4. Checking date range of available data...")
print("=" * 80)

query5 = """
SELECT 
    MIN(DATE_ID) as earliest_date,
    MAX(DATE_ID) as latest_date,
    COUNT(DISTINCT DATE_ID) as distinct_dates,
    COUNT(DISTINCT USID) as distinct_usids
FROM intermediate_kpi_table WITH (NOLOCK)
WHERE kpi_name = 'DATA_ACC_RATE'
"""

df5 = connector.run_raw_query(query5)
print("\nDate range summary:")
print(df5)
