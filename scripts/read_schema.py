"""
Read the Compass schema Excel file and extract table/column information
"""
import pandas as pd
import json
from pathlib import Path

def read_schema_excel(file_path):
    """
    Read the Excel schema file and extract all sheets with their columns
    """
    excel_file = pd.ExcelFile(file_path)
    schema_info = {}
    
    print(f"📋 Reading schema from: {file_path}")
    print(f"📊 Found {len(excel_file.sheet_names)} sheets\n")
    
    for sheet_name in excel_file.sheet_names:
        print(f"Reading sheet: {sheet_name}")
        df = pd.read_excel(excel_file, sheet_name=sheet_name)
        
        # Extract column information
        columns = list(df.columns)
        
        # Get sample data if available
        sample_data = df.head(3).to_dict('records') if not df.empty else []
        
        schema_info[sheet_name] = {
            'columns': columns,
            'row_count': len(df),
            'sample_data': sample_data
        }
        
        print(f"  ✓ Columns: {', '.join(columns)}")
        print(f"  ✓ Rows: {len(df)}\n")
    
    return schema_info

def save_schema_to_json(schema_info, output_path):
    """Save schema information to JSON for easy reference"""
    with open(output_path, 'w') as f:
        json.dump(schema_info, f, indent=2, default=str)
    print(f"💾 Schema saved to: {output_path}")

if __name__ == "__main__":
    schema_file = Path(__file__).parent.parent / "Compass_queries_schema_v2.xlsx"
    output_file = Path(__file__).parent.parent / "schema_info.json"
    
    schema = read_schema_excel(schema_file)
    save_schema_to_json(schema, output_file)
    
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    for sheet_name, info in schema.items():
        has_site_id = 'SiteID' in info['columns'] or any(
            c.upper() in ('USID', 'SOURCE_USID') for c in info['columns']
        )
        has_date = 'DATE_ID' in info['columns']
        has_cell = any('CELL' in col.upper() for col in info['columns'])

        print(f"\n{sheet_name}:")
        print(f"  • Columns: {len(info['columns'])}")
        print(f"  • Has SiteID/site id: {'✓' if has_site_id else '✗'}")
        print(f"  • Has DATE_ID: {'✓' if has_date else '✗'}")
        print(f"  • Has Cell fields: {'✓' if has_cell else '✗'}")
