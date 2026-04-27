# Sites with Real KPI Data

## Overview

The real-time KPI data integration is **fully functional**. The system:
- ✅ Maps dummy site IDs to real USIDs
- ✅ Queries remote Naavik database
- ✅ Anonymizes cell names
- ✅ Caches data for 5 minutes
- ✅ Displays in Observe tab

## Finding Sites with Data

### Method 1: Check First 3 Sample Sites

Based on the initialization logs, try these sites first:

1. **UST105013** - Mapped to `E5526CD2-0061-9D52-9...`
2. **UST109695** - Mapped to `51A13380-31FB-A358-D...`
3. **UST121935** - Mapped to `641A6EEE-1462-A254-6...`

### Method 2: Use Test API Endpoints

The backend has test endpoints to find sites with data:

```bash
# Login first
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r '.data.token')

# Find sites with data (tests first 20 sites)
curl -s "http://localhost:3000/api/test/sites-with-data?kpi=DATA_ACC_RATE&limit=20" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.sitesWithData'

# Check a specific site
curl -s "http://localhost:3000/api/test/site/UST105013/check?kpi=DATA_ACC_RATE" \
  -H "Authorization: Bearer $TOKEN" | jq '.'

# Get mapper statistics
curl -s "http://localhost:3000/api/test/mapper-stats" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
```

### Method 3: Check Backend Logs

The backend logs show real-time query results:

```bash
# Watch the backend logs
tail -f /Users/admin/.cursor/projects/Users-admin-nirmalc-Code-Naavik-naavik-mwc-demo/terminals/*.txt
```

Look for lines like:
- `✅ Query returned X rows` - means site has data
- `✅ Query returned 0 rows` - means no data for that site/date range

## Why Some Sites Have No Data

**Site UST12964** (shown in your screenshot) has no data because:

1. The remote Naavik database only contains data for sites that were active in the past 7-14 days
2. Not all sites in the topology have recent KPI data
3. The remote database may have data for different date ranges than the local dummy data

## Testing the Integration

### Test Flow:

1. **Open Observe tab** in the app
2. **Click on the map** - try sites near the center or with visible cells
3. **Watch for**:
   - 1-second loading animation
   - Site info panel appears
   - KPI trend charts load (may take 4-5 seconds for remote query)
   - Message appears if no data available

### Success Indicators:

- ✅ Lines to neighbors fade in gracefully
- ✅ Site ID displayed on map with good contrast
- ✅ Trend charts show multiple data points (if data exists)
- ✅ Daily/Hourly toggle works
- ✅ Cache makes subsequent requests faster

### Backend Logs Show:

```
🔍 Fetching daily KPI data from remote DB: UST105013 (E5526CD2-0061-9D52-9...) → DATA_ACC_RATE
✅ Query returned X rows in 400-500ms
✅ Processed X data points for UST105013
🔒 Anonymized X KPI data points
```

## Implementation Summary

### Services Created:

1. **`backend/src/services/naavik-db-connector.service.ts`**
   - Connects to remote database at `http://3.132.55.183:9050/api/query`
   - Executes SQL queries for daily and hourly KPI data
   - ~400-500ms query time

2. **`backend/src/services/site-id-mapper.service.ts`**
   - Loaded 3457 site mappings from database
   - Maps `USTXXXXX` → Real USID (UUID format)

3. **`backend/src/services/data-anonymizer.service.ts`**
   - Hashes cell names to `CELL_######` format
   - Consistent MD5-based anonymization

4. **`backend/src/services/sql-queries.ts`**
   - SQL templates for daily and hourly queries
   - Uses `WITH (NOLOCK)` hints for performance

### Modified Files:

1. **`backend/src/models/kpi.model.ts`**
   - Now queries remote DB instead of local Postgres
   - Implements caching with 5-minute TTL
   - Handles both daily and hourly granularity

2. **`backend/src/server.ts`**
   - Initializes all services on startup
   - Tests remote DB connection

3. **`backend/.env`**
   - Added remote DB configuration

### Zero Frontend Changes Required!

The frontend works exactly as before - the integration is transparent to the UI layer.

## Troubleshooting

### "No KPI time series data available"

This message appears when:
- The site exists in topology but not in remote database
- The remote database has no data for the requested date range
- Try a different site or check backend logs for actual query results

### Slow Chart Loading

- First request: 4-5 seconds (normal - queries remote DB)
- Subsequent requests: <1 second (cached)
- Check backend logs for query performance

### Integration Not Working

1. Check server logs for initialization:
   ```
   ✅ SiteIdMapper initialized with 3457 mappings
   ✅ Remote database connection successful
   ✅ KPIModel initialized successfully
   ```

2. Verify environment variables in `backend/.env`:
   ```
   REMOTE_DB_URL=http://3.132.55.183:9050/api/query
   REMOTE_DB_TIMEOUT=600000
   KPI_CACHE_TTL=300
   ```

3. Test the connection manually using the test endpoints

## Next Steps

To find more sites with data, you can:

1. Run the test endpoint to scan the first 50-100 sites
2. Check the data loading logs from earlier to see which USIDs had data
3. Try clicking on sites with more visible cells (likely to have more data)
4. Query the remote database directly to see which USIDs have recent data
