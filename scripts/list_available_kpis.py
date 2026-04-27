"""
List all available KPIs in the remote database
"""
import sys
sys.path.append('/Users/admin/nirmalc/Code/Naavik/naavik_data_visualizer/backend/database')

from naavik_db_connector import NaavikDBConnector

connector = NaavikDBConnector()

print("=" * 80)
print("Available KPIs in Remote Database")
print("=" * 80)

query = """
SELECT kpi_name, COUNT(DISTINCT USID) as usid_count, COUNT(*) as total_records
FROM intermediate_kpi_table WITH (NOLOCK)
GROUP BY kpi_name
ORDER BY usid_count DESC, kpi_name
"""

df = connector.run_raw_query(query)

if not df.empty:
    print(f"\n✅ Found {len(df)} different KPIs")
    print("\nTop 20 KPIs by USID count:")
    print(df.head(20).to_string(index=False))
    
    # Check if any of our expected KPIs exist
    expected_kpis = [
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
    
    print("\n" + "=" * 80)
    print("Checking Expected KPIs:")
    print("=" * 80)
    
    for kpi in expected_kpis:
        if kpi in df['kpi_name'].values:
            row = df[df['kpi_name'] == kpi].iloc[0]
            print(f"✅ {kpi}: {row['usid_count']} USIDs, {row['total_records']} records")
        else:
            print(f"❌ {kpi}: NOT FOUND")
else:
    print("❌ No KPIs found")

# Also check for DRB_TPUT variations
print("\n" + "=" * 80)
print("DRB_TPUT Variations:")
print("=" * 80)

if not df.empty:
    drb_kpis = df[df['kpi_name'].str.contains('DRB_TPUT', case=False, na=False)]
    if not drb_kpis.empty:
        print(drb_kpis.to_string(index=False))
    else:
        print("No DRB_TPUT KPIs found")
