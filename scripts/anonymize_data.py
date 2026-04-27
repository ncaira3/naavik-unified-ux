"""
Anonymize and dummify the fetched network data
Preserves data structure and patterns while removing sensitive information
"""
import pandas as pd
import numpy as np
import json
import hashlib
from pathlib import Path
from datetime import datetime, timedelta
import random
import string

RAW_DATA_DIR = Path(__file__).parent.parent / "raw_data"
DUMMY_DATA_DIR = Path(__file__).parent.parent / "dummy_data"
DUMMY_DATA_DIR.mkdir(exist_ok=True)

# Seed for reproducibility
random.seed(42)
np.random.seed(42)

class DataAnonymizer:
    def __init__(self):
        # Mappings to keep consistency across tables
        self.site_id_map = {}
        self.cell_id_map = {}
        self.site_id_anon_map = {}  # for site identifier column (output as SiteID)
        self.cell_name_map = {}
        self.site_name_map = {}
        self.ticket_map = {}
        self.alarm_map = {}
        self.equipment_map = {}

        # Counter for generating IDs
        self.site_counter = 1000
        self.cell_counter = 5000
        self.site_id_counter = 10000
    
    def anonymize_id(self, original_id, mapping, prefix="ID"):
        """Anonymize an ID while maintaining consistency"""
        if pd.isna(original_id) or original_id is None:
            return None
        
        original_id = str(original_id)
        if original_id not in mapping:
            mapping[original_id] = f"{prefix}-{len(mapping)+1:05d}"
        return mapping[original_id]
    
    def anonymize_name(self, original_name, mapping, prefix="NAME"):
        """Anonymize a name while maintaining consistency"""
        if pd.isna(original_name) or original_name is None:
            return None
        
        original_name = str(original_name)
        if original_name not in mapping:
            mapping[original_name] = f"{prefix}_{len(mapping)+1:04d}"
        return mapping[original_name]
    
    def anonymize_location(self, lat, lon):
        """Slightly offset lat/lon to anonymize location"""
        if pd.isna(lat) or pd.isna(lon):
            return lat, lon
        
        # Add random offset of ±0.5 degrees (roughly ±55km)
        new_lat = float(lat) + np.random.uniform(-0.5, 0.5)
        new_lon = float(lon) + np.random.uniform(-0.5, 0.5)
        
        # Clamp to valid ranges
        new_lat = np.clip(new_lat, -90, 90)
        new_lon = np.clip(new_lon, -180, 180)
        
        return new_lat, new_lon

    def _site_id_col(self, df):
        """Return the site identifier column name if present (SiteID or legacy)."""
        if "SiteID" in df.columns:
            return "SiteID"
        for c in df.columns:
            if c.upper() == "USID":
                return c
        return None

    def _anonymize_site_id_column(self, df):
        """Anonymize site identifier column and ensure output is SiteID."""
        col = self._site_id_col(df)
        if col is None:
            return df
        df = df.copy()
        df["SiteID"] = df[col].apply(
            lambda x: self.anonymize_id(x, self.site_id_anon_map, "SID")
        )
        if col != "SiteID":
            df = df.drop(columns=[col])
        return df

    def anonymize_cell_table(self, df):
        """Anonymize cell table"""
        print("\n📋 Anonymizing cell_table...")
        
        df = df.copy()
        
        # Anonymize IDs
        df['cell_id'] = df['cell_id'].apply(lambda x: self.anonymize_id(x, self.cell_id_map, "CELL"))
        df['site_id'] = df['site_id'].apply(lambda x: self.anonymize_id(x, self.site_id_map, "SITE"))
        df['cell_name'] = df['cell_name'].apply(lambda x: self.anonymize_name(x, self.cell_name_map, "Cell"))
        df = self._anonymize_site_id_column(df)
        
        # Anonymize locations
        for idx in df.index:
            lat, lon = self.anonymize_location(df.loc[idx, 'LATITUDE'], df.loc[idx, 'LONGITUDE'])
            df.loc[idx, 'LATITUDE'] = lat
            df.loc[idx, 'LONGITUDE'] = lon
        
        print(f"   ✓ Anonymized {len(df)} rows")
        return df
    
    def anonymize_site_table(self, df):
        """Anonymize site table"""
        print("\n📋 Anonymizing site_table...")
        
        df = df.copy()
        
        # Anonymize IDs
        df['site_id'] = df['site_id'].apply(lambda x: self.anonymize_id(x, self.site_id_map, "SITE"))
        df['site_name'] = df['site_name'].apply(lambda x: self.anonymize_name(x, self.site_name_map, "Site"))
        df = self._anonymize_site_id_column(df)

        # Anonymize locations
        for idx in df.index:
            lat, lon = self.anonymize_location(df.loc[idx, 'LATITUDE'], df.loc[idx, 'LONGITUDE'])
            df.loc[idx, 'LATITUDE'] = lat
            df.loc[idx, 'LONGITUDE'] = lon
        
        # Anonymize location fields
        location_fields = ['DISTRICT', 'COUNTY', 'CITY', 'STATE', 'STREET_ADDRESS', 'ZIP']
        for field in location_fields:
            if field in df.columns:
                df[field] = df[field].apply(lambda x: f"Anonymous_{field}" if pd.notna(x) else None)
        
        # Anonymize names
        name_fields = ['ZONE_ENGINEER', 'DISTRICT_MANAGER', 'ENGINEER_UID', 'MANAGER_UID']
        for field in name_fields:
            if field in df.columns:
                df[field] = df[field].apply(lambda x: f"Engineer_{hashlib.md5(str(x).encode()).hexdigest()[:8]}" if pd.notna(x) else None)
        
        print(f"   ✓ Anonymized {len(df)} rows")
        return df
    
    def anonymize_sector_table(self, df):
        """Anonymize sector table"""
        print("\n📋 Anonymizing sector_table...")
        
        df = df.copy()
        df = self._anonymize_site_id_column(df)
        df['site_id'] = df['site_id'].apply(lambda x: self.anonymize_id(x, self.site_id_map, "SITE"))

        print(f"   ✓ Anonymized {len(df)} rows")
        return df

    def anonymize_kpi_table(self, df, table_name):
        """Anonymize KPI tables"""
        print(f"\n📋 Anonymizing {table_name}...")
        
        df = df.copy()
        
        if 'cell_id' in df.columns:
            df['cell_id'] = df['cell_id'].apply(lambda x: self.anonymize_id(x, self.cell_id_map, "CELL"))
        if 'site_id' in df.columns:
            df['site_id'] = df['site_id'].apply(lambda x: self.anonymize_id(x, self.site_id_map, "SITE"))
        df = self._anonymize_site_id_column(df)
        if 'cell_name' in df.columns:
            df['cell_name'] = df['cell_name'].apply(lambda x: self.anonymize_name(x, self.cell_name_map, "Cell"))
        
        print(f"   ✓ Anonymized {len(df)} rows")
        return df
    
    def anonymize_ticket_table(self, df):
        """Anonymize ticket table"""
        print("\n📋 Anonymizing ticket_table...")
        
        df = df.copy()
        
        df['site_id'] = df['site_id'].apply(lambda x: self.anonymize_id(x, self.site_id_map, "SITE"))
        df = self._anonymize_site_id_column(df)
        df['TICKET_NUMBER'] = df['TICKET_NUMBER'].apply(lambda x: self.anonymize_id(x, self.ticket_map, "TKT"))
        
        # Anonymize names and departments
        name_fields = ['ASSIGNED_TO', 'SUBMITTED_BY', 'SUBMITTER_FULL_NAME', 'WF_ASSIGNED_TO_CUID']
        for field in name_fields:
            if field in df.columns:
                df[field] = df[field].apply(lambda x: f"User_{hashlib.md5(str(x).encode()).hexdigest()[:8]}" if pd.notna(x) else None)
        
        # Anonymize descriptions (keep structure but remove details)
        if 'SHORT_DESCRIPTION' in df.columns:
            df['SHORT_DESCRIPTION'] = df['SHORT_DESCRIPTION'].apply(lambda x: "Network Issue - Anonymized" if pd.notna(x) else None)
        if 'PROBLEM_DETAIL' in df.columns:
            df['PROBLEM_DETAIL'] = df['PROBLEM_DETAIL'].apply(lambda x: "Details anonymized for demo" if pd.notna(x) else None)
        
        print(f"   ✓ Anonymized {len(df)} rows")
        return df
    
    def anonymize_alarm_table(self, df):
        """Anonymize alarm table"""
        print("\n📋 Anonymizing alarm_table...")
        
        df = df.copy()
        
        df['site_id'] = df['site_id'].apply(lambda x: self.anonymize_id(x, self.site_id_map, "SITE"))
        df = self._anonymize_site_id_column(df)
        df['IDENTIFIER'] = df['IDENTIFIER'].apply(lambda x: self.anonymize_id(x, self.alarm_map, "ALM"))
        
        if 'site_name' in df.columns:
            df['site_name'] = df['site_name'].apply(lambda x: self.anonymize_name(x, self.site_name_map, "Site"))
        
        # Keep alarm summary/type but anonymize specific details
        if 'SUMMARY' in df.columns:
            df['SUMMARY'] = df['SUMMARY'].apply(lambda x: "Alarm Event - Anonymized" if pd.notna(x) else None)
        
        print(f"   ✓ Anonymized {len(df)} rows")
        return df
    
    def anonymize_eim_table(self, df):
        """Anonymize EIM table"""
        print("\n📋 Anonymizing eim_table...")
        
        df = df.copy()
        
        df['site_id'] = df['site_id'].apply(lambda x: self.anonymize_id(x, self.site_id_map, "SITE"))
        df = self._anonymize_site_id_column(df)

        if 'EQUIPMENT_ID' in df.columns:
            df['EQUIPMENT_ID'] = df['EQUIPMENT_ID'].apply(lambda x: self.anonymize_id(x, self.equipment_map, "EQP"))
        if 'EQUIPMENT_NAME' in df.columns:
            df['EQUIPMENT_NAME'] = df['EQUIPMENT_NAME'].apply(lambda x: f"Equipment_{hashlib.md5(str(x).encode()).hexdigest()[:8]}" if pd.notna(x) else None)
        
        print(f"   ✓ Anonymized {len(df)} rows")
        return df
    
    def anonymize_neighbors_table(self, df):
        """Anonymize neighbors table"""
        print("\n📋 Anonymizing neighbors_table_date_id...")
        
        df = df.copy()
        
        df['site_id'] = df['site_id'].apply(lambda x: self.anonymize_id(x, self.site_id_map, "SITE"))
        df['neighbor_site_id'] = df['neighbor_site_id'].apply(lambda x: self.anonymize_id(x, self.site_id_map, "SITE"))
        if 'SOURCE_USID' in df.columns:
            df['SourceSiteID'] = df['SOURCE_USID'].apply(
                lambda x: self.anonymize_id(x, self.site_id_anon_map, "SID")
            )
            df = df.drop(columns=['SOURCE_USID'])
        if 'NEIGH_USID' in df.columns:
            df['NeighborSiteID'] = df['NEIGH_USID'].apply(
                lambda x: self.anonymize_id(x, self.site_id_anon_map, "SID")
            )
            df = df.drop(columns=['NEIGH_USID'])
        
        print(f"   ✓ Anonymized {len(df)} rows")
        return df
    
    def anonymize_subcomponent_table(self, df):
        """Anonymize subcomponent table"""
        print("\n📋 Anonymizing subcomponent_table...")
        
        df = df.copy()
        
        if 'site_id' in df.columns:
            df['site_id'] = df['site_id'].apply(lambda x: self.anonymize_id(x, self.site_id_map, "SITE"))
        df = self._anonymize_site_id_column(df)

        print(f"   ✓ Anonymized {len(df)} rows")
        return df

    def anonymize_cqx_table(self, df):
        """Anonymize CQX offenders table"""
        print("\n📋 Anonymizing cqx_offenders_truth_table...")
        
        df = df.copy()
        df = self._anonymize_site_id_column(df)

        print(f"   ✓ Anonymized {len(df)} rows")
        return df

def main():
    """
    Anonymize all fetched data
    """
    print("="*70)
    print("🔒 DATA ANONYMIZATION")
    print("="*70)
    print(f"Input directory: {RAW_DATA_DIR}")
    print(f"Output directory: {DUMMY_DATA_DIR}")
    
    anonymizer = DataAnonymizer()
    
    # Process each table
    tables_to_process = {
        'cell_table.csv': anonymizer.anonymize_cell_table,
        'site_table.csv': anonymizer.anonymize_site_table,
        'sector_table.csv': anonymizer.anonymize_sector_table,
        'intermediate_kpi_table.csv': lambda df: anonymizer.anonymize_kpi_table(df, 'intermediate_kpi_table'),
        'ticket_table.csv': anonymizer.anonymize_ticket_table,
        'alarm_table.csv': anonymizer.anonymize_alarm_table,
        'eim_table.csv': anonymizer.anonymize_eim_table,
        'neighbors_table_date_id.csv': anonymizer.anonymize_neighbors_table,
        'subcomponent_table.csv': anonymizer.anonymize_subcomponent_table,
        'cqx_offenders_truth_table.csv': anonymizer.anonymize_cqx_table,
    }
    
    success_count = 0
    
    for filename, anonymize_func in tables_to_process.items():
        input_path = RAW_DATA_DIR / filename
        
        if not input_path.exists():
            print(f"\n⚠ Skipping {filename} - file not found")
            continue
        
        try:
            df = pd.read_csv(input_path)
            df_anonymized = anonymize_func(df)
            
            # Save anonymized data
            output_path = DUMMY_DATA_DIR / filename
            df_anonymized.to_csv(output_path, index=False)
            
            print(f"   ✓ Saved to {output_path.name}")
            success_count += 1
            
        except Exception as e:
            print(f"   ✗ Error processing {filename}: {e}")
    
    print("\n" + "="*70)
    print(f"✅ ANONYMIZATION COMPLETE: {success_count}/{len(tables_to_process)} tables processed")
    print("="*70)
    
    # Save ID mappings for reference
    mappings = {
        'site_id_count': len(anonymizer.site_id_map),
        'cell_id_count': len(anonymizer.cell_id_map),
        'site_id_count': len(anonymizer.site_id_anon_map),
        'cell_name_count': len(anonymizer.cell_name_map),
        'site_name_count': len(anonymizer.site_name_map),
    }
    
    mapping_path = DUMMY_DATA_DIR / "anonymization_summary.json"
    with open(mapping_path, 'w') as f:
        json.dump(mappings, f, indent=2)
    
    print(f"\n📊 Anonymization summary saved to: {mapping_path}")
    print(f"   • {mappings['site_id_count']} unique sites anonymized")
    print(f"   • {mappings['cell_id_count']} unique cells anonymized")
    print(f"   • {mappings['site_id_count']} unique SiteIDs anonymized")

if __name__ == "__main__":
    main()
