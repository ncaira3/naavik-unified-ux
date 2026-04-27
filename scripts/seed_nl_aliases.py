"""
Seed Natural Language Aliases for Parameters and KPIs
Generates synonyms and variations for easier natural language matching
"""
import psycopg2
from psycopg2.extras import execute_batch
import os
from dotenv import load_dotenv
import re

# Load environment variables
base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(base_path, 'backend', '.env')
load_dotenv(env_path)

DB_CONFIG = {
    'dbname': os.getenv('DB_NAME', 'naavik_demo'),
    'user': os.getenv('DB_USER', 'naavik_user'),
    'password': os.getenv('DB_PASSWORD', 'naavik_pass_2026'),
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': os.getenv('DB_PORT', '5433')
}

def camel_case_to_variations(name):
    """Convert camelCase to various formats for aliases"""
    if not name:
        return []
    
    # Split camelCase
    words = re.sub('([A-Z][a-z]+)', r' \1', re.sub('([A-Z]+)', r' \1', name)).split()
    
    variations = [
        name.lower(),  # lowercase original
        ' '.join(words).lower(),  # space separated
        '_'.join(words).lower(),  # underscore separated
        ''.join(words).lower(),  # no spaces
    ]
    
    # Remove duplicates and empty strings
    return list(set([v for v in variations if v]))

def snake_case_to_variations(name):
    """Convert SNAKE_CASE to various formats for aliases"""
    if not name:
        return []
    
    variations = [
        name.lower(),  # lowercase original
        name.replace('_', ' ').lower(),  # space separated
        name.replace('_', '').lower(),  # no separators
    ]
    
    # Add shortened versions for common patterns
    if '_' in name:
        parts = name.split('_')
        # Create acronym
        acronym = ''.join([p[0] for p in parts if p]).lower()
        variations.append(acronym)
        
        # Last word only (often the key metric)
        if len(parts) > 1:
            variations.append(parts[-1].lower())
    
    # Remove duplicates and empty strings
    return list(set([v for v in variations if v]))

def seed_parameter_aliases(conn):
    """Generate and seed aliases for parameters"""
    print("\n📊 Seeding Parameter Aliases...")
    
    cursor = conn.cursor()
    
    # Get all parameters
    cursor.execute("""
        SELECT id, parameter_name, mo_class 
        FROM ericsson_parameters 
        WHERE parameter_name IS NOT NULL
    """)
    
    parameters = cursor.fetchall()
    print(f"   Found {len(parameters)} parameters")
    
    # Generate aliases
    insert_query = """
        INSERT INTO parameter_nl_aliases (parameter_id, alias, canonical_parameter_name, confidence)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT DO NOTHING
    """
    
    aliases_data = []
    
    for param_id, param_name, mo_class in parameters:
        # Get variations of parameter name
        variations = camel_case_to_variations(param_name)
        
        for variation in variations:
            if variation and len(variation) >= 3:  # Skip very short aliases
                aliases_data.append((param_id, variation, param_name, 1.0))
        
        # Add MO class + parameter name combination
        if mo_class:
            mo_variations = camel_case_to_variations(mo_class)
            for mo_var in mo_variations:
                combined = f"{mo_var} {param_name.lower()}"
                if len(combined) >= 5:
                    aliases_data.append((param_id, combined, param_name, 0.9))
    
    # Insert aliases in batches
    execute_batch(cursor, insert_query, aliases_data, page_size=1000)
    conn.commit()
    
    print(f"   ✅ Generated {len(aliases_data)} parameter aliases")
    return len(aliases_data)

def seed_kpi_aliases(conn):
    """Generate and seed aliases for KPIs"""
    print("\n📊 Seeding KPI Aliases...")
    
    cursor = conn.cursor()
    
    # Get all KPIs
    cursor.execute("""
        SELECT id, metric, db_counter_name 
        FROM ericsson_kpi_descriptions 
        WHERE metric IS NOT NULL
    """)
    
    kpis = cursor.fetchall()
    print(f"   Found {len(kpis)} KPIs")
    
    # Generate aliases
    insert_query = """
        INSERT INTO kpi_nl_aliases (kpi_id, alias, canonical_db_counter_name, confidence)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT DO NOTHING
    """
    
    aliases_data = []
    
    for kpi_id, metric, db_counter in kpis:
        # Get variations of metric name
        if metric:
            metric_clean = metric.replace('\n', ' ').replace('  ', ' ').strip()
            metric_variations = [
                metric_clean.lower(),
                metric_clean.replace('%', 'percent').lower(),
                metric_clean.replace('(', '').replace(')', '').lower(),
            ]
            
            for variation in metric_variations:
                if variation and len(variation) >= 3:
                    aliases_data.append((kpi_id, variation, db_counter or metric, 1.0))
        
        # Get variations of DB counter name
        if db_counter:
            db_clean = db_counter.replace('\n', ' ').strip()
            db_variations = snake_case_to_variations(db_clean)
            
            for variation in db_variations:
                if variation and len(variation) >= 2:
                    aliases_data.append((kpi_id, variation, db_counter, 1.0))
    
    # Common telecom synonyms
    common_synonyms = {
        'drop': ['drop rate', 'erab drop', 'call drop', 'dropped'],
        'throughput': ['tput', 'tp', 'data rate', 'speed'],
        'prb': ['physical resource block', 'resource block'],
        'utilization': ['util', 'usage'],
        'availability': ['avail', 'uptime'],
        'accessibility': ['acc', 'access'],
        'latency': ['delay', 'lag'],
        'packet loss': ['loss', 'pl'],
    }
    
    # Add common synonyms
    cursor.execute("SELECT id, metric FROM ericsson_kpi_descriptions")
    for kpi_id, metric in cursor.fetchall():
        if metric:
            metric_lower = metric.lower()
            for base, synonyms in common_synonyms.items():
                if base in metric_lower:
                    for syn in synonyms:
                        aliases_data.append((kpi_id, syn, metric, 0.8))
    
    # Insert aliases in batches
    execute_batch(cursor, insert_query, aliases_data, page_size=1000)
    conn.commit()
    
    print(f"   ✅ Generated {len(aliases_data)} KPI aliases")
    return len(aliases_data)

def main():
    """Main execution"""
    print("=" * 60)
    print("Natural Language Alias Seeder")
    print("=" * 60)
    
    try:
        print("\n🔌 Connecting to PostgreSQL...")
        conn = psycopg2.connect(**DB_CONFIG)
        print("   ✅ Connected successfully")
        
        # Seed aliases
        param_count = seed_parameter_aliases(conn)
        kpi_count = seed_kpi_aliases(conn)
        
        # Summary
        print("\n" + "=" * 60)
        print("✅ Alias Seeding Complete!")
        print("=" * 60)
        print(f"   Parameter aliases: {param_count}")
        print(f"   KPI aliases: {kpi_count}")
        print("=" * 60)
        
        conn.close()
        
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        raise

if __name__ == '__main__':
    main()
