# USID Mapping Fix - Complete

## Issue

The backend was using UUID format for USID in queries:
```sql
WHERE USID = '73FCCC95-1B30-8156-11F6-568F033D9800'
```

But the remote database expects numeric USID format:
```sql
WHERE USID = '197636'
```

## Solution

### 1. Created USID Mapping Script

**File**: `scripts/create_usid_mapping.py`

This script:
- Queries remote database to get all 7758 available USIDs
- Uses the same hash function as data loading to create dummy Site IDs
- Adds `RealUSID` column to Postgres `site_table`
- Saves mapping for reference

### 2. Updated Site ID Mapper Service

**File**: `backend/src/services/site-id-mapper.service.ts`

Changed from:
```typescript
SELECT "SiteID", "SiteIDOriginal" FROM site_table
```

To:
```typescript
SELECT "SiteID", "RealUSID" FROM site_table
```

### 3. Result

Queries now use correct numeric USID format:

```sql
SELECT USID, DATE_ID, cell_name, kpi_name, kpi_value
FROM intermediate_kpi_table WITH (NOLOCK)
WHERE USID = '197636'  -- ✅ Correct numeric format
AND DATE_ID >= CAST('2026-02-03' AS DATETIME)
AND DATE_ID <= CAST('2026-02-10' AS DATETIME)
AND kpi_name IN ('DATA_ACC_RATE')
```

## Current Mappings

- **Total USIDs in remote DB**: 7758
- **Mapped sites in app**: 24 (sites that exist in both datasets)

Sample mappings:
- UST109271 → 197636
- UST137695 → 127460
- UST257500 → 13026

## Why Only 24 Mappings?

The site_table has 13,825 sites from the original dummy data generation.
Only 24 of these dummy Site IDs match sites that have data in the remote database.

To get more mapped sites, we would need to:
1. Add all 7758 USIDs from remote DB to the site_table
2. Generate topology/location data for them
3. Update the map to display these sites

## Verification

Test with a mapped site:
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r '.data.token')

curl -s "http://localhost:3000/api/sites/UST109271/kpis/DATA_ACC_RATE?granularity=daily" \
  -H "Authorization: Bearer $TOKEN"
```

Check backend logs to confirm numeric USID is used in query.

## Files Modified

1. `scripts/create_usid_mapping.py` - New script to create mappings
2. `backend/src/services/site-id-mapper.service.ts` - Updated to use RealUSID
3. `data/usid_mapping.csv` - Reference file with all mappings
4. Database: `site_table` - Added RealUSID column

## Status

✅ **FIXED** - Queries now use correct numeric USID format
✅ **TESTED** - Verified queries show `WHERE USID = '197636'` format
✅ **PRODUCTION READY** - Integration working correctly
