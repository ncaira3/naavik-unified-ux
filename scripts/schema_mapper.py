"""
Schema Mapper: Transform API schema to DUMMY schema for UI display
Key transformations:
1. Source site identifier → SiteID with format UST#### (UST + numeric id)
2. Randomize lat/long within 50m radius
3. Cell names: NodeName_BandSector_Carrier nomenclature
4. Uniform transformations across all datasets
"""
import pandas as pd
import numpy as np
from pathlib import Path
import json
import hashlib

# Seed for reproducibility
np.random.seed(42)

# Approximately 50 meters in degrees (varies by latitude)
# At latitude 37° (Union City), 1 degree ≈ 111 km
# 50m = 0.05km = 0.05/111 ≈ 0.00045 degrees
LOCATION_OFFSET_DEGREES = 0.00045

class SchemaMapper:
    def __init__(self):
        # Mapping caches for consistency
        self.source_id_to_siteid = {}
        self.cell_id_map = {}
        self.cell_name_map = {}
        self.site_name_map = {}
        self.location_offsets = {}
        
        # Counters
        self.node_counter = 1
        
    def map_to_site_id(self, source_id):
        """
        Convert source site identifier to SiteID format: UST####
        Where #### is the numeric part of the identifier
        """
        if pd.isna(source_id) or source_id is None:
            return None

        src_str = str(source_id)

        if src_str not in self.source_id_to_siteid:
            try:
                numeric_part = ''.join(filter(str.isdigit, src_str))
                if numeric_part:
                    self.source_id_to_siteid[src_str] = f"UST{numeric_part}"
                else:
                    hash_val = int(hashlib.md5(src_str.encode()).hexdigest(), 16) % 10000
                    self.source_id_to_siteid[src_str] = f"UST{hash_val:04d}"
            except Exception:
                self.source_id_to_siteid[src_str] = f"UST{len(self.source_id_to_siteid):04d}"

        return self.source_id_to_siteid[src_str]
    
    def randomize_location(self, lat, lon, identifier):
        """
        Randomize lat/lon within 50m radius
        Use identifier to ensure same offset for same location
        """
        if pd.isna(lat) or pd.isna(lon):
            return lat, lon
        
        # Use identifier to ensure consistent offset
        key = f"{lat}_{lon}_{identifier}"
        
        if key not in self.location_offsets:
            # Generate random offset within 50m (≈0.00045 degrees)
            offset_lat = np.random.uniform(-LOCATION_OFFSET_DEGREES, LOCATION_OFFSET_DEGREES)
            offset_lon = np.random.uniform(-LOCATION_OFFSET_DEGREES, LOCATION_OFFSET_DEGREES)
            self.location_offsets[key] = (offset_lat, offset_lon)
        
        offset_lat, offset_lon = self.location_offsets[key]
        
        new_lat = float(lat) + offset_lat
        new_lon = float(lon) + offset_lon
        
        # Clamp to valid ranges
        new_lat = np.clip(new_lat, -90, 90)
        new_lon = np.clip(new_lon, -180, 180)
        
        return new_lat, new_lon
    
    def generate_cell_name(self, original_name, tech, carrier):
        """
        Generate cell name with NodeName_BandSector_Carrier nomenclature
        Example: NODE0001_5G_A_1, NODE0234_4G_B_2
        """
        if pd.isna(original_name) or original_name is None:
            return None
        
        original_name = str(original_name)
        
        if original_name not in self.cell_name_map:
            # Determine band from tech
            if tech == '5G' or tech == '5g':
                band = '5G'
            elif tech == '4G' or tech == 'LTE':
                band = '4G'
            elif tech == '3G':
                band = '3G'
            else:
                band = '4G'  # Default
            
            # Generate sector (A, B, C based on hash)
            sector_hash = hash(original_name) % 3
            sector = chr(65 + sector_hash)  # A, B, C
            
            # Extract or generate carrier
            if pd.notna(carrier):
                carrier_str = str(carrier).split('_')[-1] if '_' in str(carrier) else str(carrier)
            else:
                carrier_str = str((hash(original_name) % 3) + 1)
            
            # Generate node name
            node_num = (hash(original_name) % 9999) + 1
            node_name = f"NODE{node_num:04d}"
            
            # Combine: NodeName_Band_Sector_Carrier
            self.cell_name_map[original_name] = f"{node_name}_{band}_{sector}_{carrier_str}"
        
        return self.cell_name_map[original_name]
    
    def generate_site_name(self, original_name, siteid):
        """Generate consistent site name"""
        if pd.isna(original_name) or original_name is None:
            return f"Site_{siteid}" if siteid else None
        
        original_name = str(original_name)
        
        if original_name not in self.site_name_map:
            # Extract numeric part from SiteID
            if siteid:
                self.site_name_map[original_name] = f"Site_{siteid}"
            else:
                self.site_name_map[original_name] = f"Site_{len(self.site_name_map):04d}"
        
        return self.site_name_map[original_name]
    
    def transform_cell_table(self, df):
        """Transform cell_table"""
        print("\n🔄 Transforming cell_table...")
        df = df.copy()
        
        # Map source site identifier to SiteID (accept SiteID or legacy column name)
        id_col = 'SiteID' if 'SiteID' in df.columns else next((c for c in df.columns if c.lower() == 'usid'), None)
        if id_col:
            df['SiteID'] = df[id_col].apply(self.map_to_site_id)
            if id_col != 'SiteID':
                df = df.drop(columns=[id_col])
        if 'site_id' in df.columns:
            df['site_id_mapped'] = df['site_id'].apply(self.map_to_site_id)

        # Generate cell names
        df['CellName'] = df.apply(
            lambda row: self.generate_cell_name(row['cell_name'], row['TECH'], row['CARRIER']),
            axis=1
        )

        # Transform locations
        for idx in df.index:
            lat, lon = self.randomize_location(
                df.loc[idx, 'LATITUDE'],
                df.loc[idx, 'LONGITUDE'],
                df.loc[idx, 'cell_id']
            )
            df.loc[idx, 'Latitude'] = lat
            df.loc[idx, 'Longitude'] = lon
        
        # Handle boolean anomaly_flag
        if 'anomaly_flag' in df.columns:
            df['anomaly_flag'] = df['anomaly_flag'].apply(lambda x: None if pd.isna(x) else bool(int(x)) if not pd.isna(x) else None)
        
        # Select and rename columns for clean schema
        column_mapping = {
            'cell_id': 'CellID',
            'site_id_mapped': 'SiteIDRef',
            'CellName': 'CellName',
            'num_kpis': 'NumKPIs',
            'AZIMUTH': 'Azimuth',
            'HEIGHT': 'Height',
            'Latitude': 'Latitude',
            'Longitude': 'Longitude',
            'TECH': 'Technology',
            'SiteID': 'SiteID',
            'CARRIER': 'Carrier',
            'DATE_ID': 'DateID',
            'anomaly_flag': 'AnomalyFlag',
            'anomaly_score': 'AnomalyScore',
        }
        
        df_transformed = df.rename(columns=column_mapping)
        
        # Select only the columns we want
        final_columns = [col for col in column_mapping.values() if col in df_transformed.columns]
        df_final = df_transformed[final_columns]
        
        # Note: Keep duplicates across dates - this is intentional for time-series data
        print(f"   ✓ Transformed {len(df_final)} rows")
        return df_final
    
    def transform_site_table(self, df):
        """Transform site_table"""
        print("\n🔄 Transforming site_table...")
        df = df.copy()
        
        # Map source site identifier to SiteID
        id_col = 'SiteID' if 'SiteID' in df.columns else next((c for c in df.columns if c.lower() == 'usid'), None)
        if id_col:
            df['SiteID'] = df[id_col].apply(self.map_to_site_id)
            if id_col != 'SiteID':
                df = df.drop(columns=[id_col])

        # Generate site names
        df['SiteName'] = df.apply(
            lambda row: self.generate_site_name(row['site_name'], row['SiteID']),
            axis=1
        )
        
        # Transform locations
        for idx in df.index:
            lat, lon = self.randomize_location(
                df.loc[idx, 'LATITUDE'],
                df.loc[idx, 'LONGITUDE'],
                df.loc[idx, 'site_id']
            )
            df.loc[idx, 'Latitude'] = lat
            df.loc[idx, 'Longitude'] = lon
        
        # Handle boolean anomaly_flag
        if 'anomaly_flag' in df.columns:
            df['anomaly_flag'] = df['anomaly_flag'].apply(lambda x: None if pd.isna(x) else bool(int(x)) if not pd.isna(x) else None)
        
        # Select and rename columns
        column_mapping = {
            'site_id': 'SiteIDOriginal',
            'SiteID': 'SiteID',
            'SiteName': 'SiteName',
            'cell_num': 'CellCount',
            'Latitude': 'Latitude',
            'Longitude': 'Longitude',
            'DATE_ID': 'DateID',
            'anomaly_flag': 'AnomalyFlag',
            'anomaly_score': 'AnomalyScore',
        }
        
        df_transformed = df.rename(columns=column_mapping)
        final_columns = [col for col in column_mapping.values() if col in df_transformed.columns]
        df_final = df_transformed[final_columns]
        
        # Note: Keep duplicates across dates - this is intentional for time-series data
        print(f"   ✓ Transformed {len(df_final)} rows")
        return df_final
    
    def transform_kpi_table(self, df):
        """Transform intermediate_kpi_table"""
        print("\n🔄 Transforming intermediate_kpi_table...")
        df = df.copy()
        
        # Map source site identifier to SiteID
        id_col = 'SiteID' if 'SiteID' in df.columns else next((c for c in df.columns if c.lower() == 'usid'), None)
        if id_col:
            df['SiteID'] = df[id_col].apply(self.map_to_site_id)
            if id_col != 'SiteID':
                df = df.drop(columns=[id_col])

        # Generate cell names
        df['CellName'] = df.apply(
            lambda row: self.generate_cell_name(row.get('cell_name'), row.get('TECH'), None),
            axis=1
        )
        
        # Handle boolean anomaly_flag - convert NaN to None
        if 'anomaly_flag' in df.columns:
            df['anomaly_flag'] = df['anomaly_flag'].apply(lambda x: None if pd.isna(x) else bool(int(x)) if not pd.isna(x) else None)
        
        # Select and rename columns
        column_mapping = {
            'kpi_id': 'KPIID',
            'cell_id': 'CellID',
            'site_id': 'SiteIDRef',
            'SiteID': 'SiteID',
            'CellName': 'CellName',
            'kpi_name': 'KPIName',
            'kpi_value': 'KPIValue',
            'TECH': 'Technology',
            'anomaly_flag': 'AnomalyFlag',
            'anomaly_score': 'AnomalyScore',
            'DATE_ID': 'DateID',
        }
        
        df_transformed = df.rename(columns=column_mapping)
        final_columns = [col for col in column_mapping.values() if col in df_transformed.columns]
        df_final = df_transformed[final_columns]
        
        print(f"   ✓ Transformed {len(df_final)} rows")
        return df_final
    
    def transform_generic_table(self, df, table_name):
        """Generic transformation for other tables"""
        print(f"\n🔄 Transforming {table_name}...")
        df = df.copy()
        
        # Map source site identifier columns to SiteID
        site_id_col = next((c for c in df.columns if c == 'SiteID' or c.lower() == 'usid'), None)
        if site_id_col:
            df['SiteID'] = df[site_id_col].apply(self.map_to_site_id)
            if site_id_col != 'SiteID':
                df = df.drop(columns=[site_id_col])
        src_col = next((c for c in df.columns if c.lower() == 'source_usid'), None)
        if src_col:
            df['SourceSiteID'] = df[src_col].apply(self.map_to_site_id)
            df = df.drop(columns=[src_col])
        neigh_col = next((c for c in df.columns if c.lower() == 'neigh_usid'), None)
        if neigh_col:
            df['NeighborSiteID'] = df[neigh_col].apply(self.map_to_site_id)
            df = df.drop(columns=[neigh_col])
        
        # Handle boolean columns - convert NaN to None
        boolean_cols = ['anomaly_flag', 'AnomalyFlag']
        for col in boolean_cols:
            if col in df.columns:
                df[col] = df[col].apply(lambda x: None if pd.isna(x) else bool(int(x)) if not pd.isna(x) else None)
        
        # Basic column renaming
        df = df.rename(columns={
            'DATE_ID': 'DateID',
            'anomaly_flag': 'AnomalyFlag',
            'anomaly_score': 'AnomalyScore',
            'AZIMUTH': 'Azimuth',
            'TICKET_NUMBER': 'TicketNumber',
            'ADVISORY_ID': 'AdvisoryID',
        })
        
        print(f"   ✓ Transformed {len(df)} rows")
        return df

def main():
    """Transform all tables"""
    from pathlib import Path
    
    FILTERED_DATA_DIR = Path(__file__).parent.parent / "filtered_data"
    DUMMY_DATA_DIR = Path(__file__).parent.parent / "dummy_data_mapped"
    DUMMY_DATA_DIR.mkdir(exist_ok=True)
    
    print("="*70)
    print("🗺️  SCHEMA MAPPER - API to DUMMY SCHEMA")
    print("="*70)
    print(f"Input: {FILTERED_DATA_DIR}")
    print(f"Output: {DUMMY_DATA_DIR}")
    
    mapper = SchemaMapper()
    
    # Transform cell_table
    if (FILTERED_DATA_DIR / "cell_table.csv").exists():
        df = pd.read_csv(FILTERED_DATA_DIR / "cell_table.csv")
        df_transformed = mapper.transform_cell_table(df)
        df_transformed.to_csv(DUMMY_DATA_DIR / "cell_table.csv", index=False)
    
    # Transform site_table
    if (FILTERED_DATA_DIR / "site_table.csv").exists():
        df = pd.read_csv(FILTERED_DATA_DIR / "site_table.csv")
        df_transformed = mapper.transform_site_table(df)
        df_transformed.to_csv(DUMMY_DATA_DIR / "site_table.csv", index=False)
    
    # Transform KPI table
    if (FILTERED_DATA_DIR / "intermediate_kpi_table.csv").exists():
        df = pd.read_csv(FILTERED_DATA_DIR / "intermediate_kpi_table.csv")
        df_transformed = mapper.transform_kpi_table(df)
        df_transformed.to_csv(DUMMY_DATA_DIR / "intermediate_kpi_table.csv", index=False)
    
    # Transform other tables generically
    other_tables = [
        'sector_table', 'ticket_table', 'eim_table',
        'subcomponent_table', 'cqx_offenders_truth_table'
    ]
    
    for table in other_tables:
        file_path = FILTERED_DATA_DIR / f"{table}.csv"
        if file_path.exists():
            df = pd.read_csv(file_path)
            df_transformed = mapper.transform_generic_table(df, table)
            df_transformed.to_csv(DUMMY_DATA_DIR / f"{table}.csv", index=False)
    
    # Save mapping metadata
    mapping_meta = {
        'total_sites_mapped': len(mapper.source_id_to_siteid),
        'total_cells_mapped': len(mapper.cell_name_map),
        'total_site_names_mapped': len(mapper.site_name_map),
        'location_offset_meters': 50,
        'site_id_format': 'UST#### where #### is numeric site identifier',
        'cell_name_format': 'NodeName_Band_Sector_Carrier',
    }

    with open(DUMMY_DATA_DIR / "mapping_metadata.json", 'w') as f:
        json.dump(mapping_meta, f, indent=2)

    print("\n" + "="*70)
    print("✅ SCHEMA MAPPING COMPLETE")
    print("="*70)
    print(f"   • SiteIDs mapped: {len(mapper.source_id_to_siteid)}")
    print(f"   • Cells mapped: {len(mapper.cell_name_map)}")
    print(f"   • Sites mapped: {len(mapper.site_name_map)}")
    print(f"   • Location randomization: ±50m")
    print(f"\n📊 Metadata saved to: {DUMMY_DATA_DIR / 'mapping_metadata.json'}")

if __name__ == "__main__":
    main()
