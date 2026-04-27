"""
Test the API to see what it returns
"""
import requests
import json

API_URL = "http://3.132.55.183:9050/api/query"

# Try a simple query
test_queries = [
    "SELECT TOP 5 * FROM cell_table",
    "SELECT TOP 5 * FROM site_table",
    "SELECT TOP 1 * FROM cell_table",
]

for query in test_queries:
    print(f"\n{'='*70}")
    print(f"Testing query: {query}")
    print('='*70)
    
    payload = {
        "query": query,
        "params": {}
    }
    
    try:
        response = requests.post(
            API_URL,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        print(f"Status Code: {response.status_code}")
        print(f"Response Headers: {dict(response.headers)}")
        print(f"\nResponse Text (first 1000 chars):")
        print(response.text[:1000])
        
        if response.status_code == 200:
            try:
                data = response.json()
                print(f"\nData Type: {type(data)}")
                if isinstance(data, list):
                    print(f"Number of records: {len(data)}")
                    if len(data) > 0:
                        print(f"First record: {json.dumps(data[0], indent=2, default=str)}")
                elif isinstance(data, dict):
                    print(f"Keys: {list(data.keys())}")
                    print(f"Full data: {json.dumps(data, indent=2, default=str)[:500]}")
            except json.JSONDecodeError as e:
                print(f"JSON Decode Error: {e}")
        
        # Try first query only for now
        if "cell_table" in query:
            break
            
    except Exception as e:
        print(f"Exception: {e}")
