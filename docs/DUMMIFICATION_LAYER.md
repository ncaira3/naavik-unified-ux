# Frontend Dummification Layer

## Overview

A comprehensive dummification layer has been implemented on the frontend to hide all real identifiers while maintaining consistent mappings for API calls.

---

## Features

### 1. **Consistent Hashing**
- All dummification uses a deterministic hash function
- Same real ID always produces the same dummy ID
- Mappings persisted in localStorage for consistency across sessions

### 2. **Dummification Types**

| Real Data | Dummy Format | Example |
|-----------|--------------|---------|
| Site ID | `SITE_A1234` | `UST851704` → `SITE_A1234` |
| Site Name | `Site Alpha 1234` | `Site_UST851704` → `Site Alpha 1234` |
| Cell ID | `CELL_X789` | `CELL_123456` → `CELL_X789` |
| Cell Name | `Cell Antenna 42` | `CELL_UST_1` → `Cell Antenna 42` |
| Cluster ID | `CLUSTER_15` or `null` | `CASF-015` → `CLUSTER_15` |

### 3. **Two-Way Mapping**
- **Display Layer:** Shows dummy IDs to users
- **API Layer:** Uses real IDs for backend requests
- Automatic translation at component boundaries

---

## Implementation

### Core Module: `/frontend/src/utils/dummification.ts`

```typescript
import { dummifier, dummifyMapSite, dummifyCell } from '../utils/dummification';

// Dummify site for display
const displaySite = dummifyMapSite(backendSite);

// Get real ID for API call
const realId = dummifier.getRealSiteId(displaySite.siteId);
const kpiData = await api.getSiteKpis(realId);
```

### Key Functions

#### `dummifier.dummifySiteId(realId)`
- Converts real site ID to dummy ID
- Creates consistent mapping stored in localStorage
- Returns: `SITE_A1234` format

#### `dummifier.getRealSiteId(dummyId)`
- Reverse lookup: dummy ID → real ID
- Used for API calls
- Returns: Original `UST123456` format

#### `dummifyMapSite(site)`
- Dummifies entire site object
- Preserves both dummy (for display) and real (for API) IDs
- Returns: `DummifiedMapSite` object

#### `dummifyCell(cell)`
- Dummifies cell/sector data
- Maintains mapping for sector display
- Returns: Dummified cell with real ID backup

---

## Data Flow

```
Backend (Real IDs)
       ↓
   API Response
       ↓
Dummification Layer  ← dummifyMapSite()
       ↓
Frontend State (Dummy IDs for display, Real IDs hidden)
       ↓
   UI Display (Shows dummy IDs only)
       ↓
User Click Event
       ↓
Reverse Mapping  ← getRealSiteId()
       ↓
API Call (Uses real ID)
       ↓
Backend
```

---

## UI Changes

### Map View
- **Site Labels:** `SITE_A1234` instead of `UST851704`
- **Site Names:** `Site Alpha 1234` instead of `Site_UST851704`
- **Hover Tooltips:** Cluster IDs **removed** for privacy
- **Cell Sectors:** Dummified cell names

### KPI Trends Panel
- **Site ID Header:** Shows dummy ID
- **API Calls:** Uses real ID automatically
- **Chart Labels:** Uses dummy IDs

---

## Privacy Protection

### What's Hidden:
- ❌ Real site IDs (UST format)
- ❌ Real site names
- ❌ Real cell IDs and names
- ❌ Cluster identifiers (CASF format)
- ❌ Geographic cluster information

### What's Shown:
- ✅ Generic site IDs (SITE_A format)
- ✅ Greek letter site names (Alpha, Beta, etc.)
- ✅ Generic cell IDs (CELL_X format)
- ✅ Site locations (coordinates unchanged)
- ✅ KPI metrics (values unchanged)

---

## Persistence

### localStorage Keys:
- `dummification_mappings`: Stores all ID mappings

### Structure:
```json
{
  "sites": [["UST851704", "SITE_A1234"], ...],
  "cells": [["CELL_123456", "CELL_X789"], ...],
  "clusters": [["CASF-015", "CLUSTER_15"], ...]
}
```

### Benefits:
- Consistent dummy IDs across page reloads
- No re-hashing on every render
- Faster lookup performance

---

## API Integration

### Before (Direct Real IDs):
```typescript
// User clicks site UST851704
const kpis = await api.getSiteKpis('UST851704');
```

### After (Dummification Layer):
```typescript
// User sees and clicks SITE_A1234
// Component displays: SITE_A1234
// Component uses: UST851704 for API
const realId = dummifier.getRealSiteId(site.siteId);
const kpis = await api.getSiteKpis(realId);
```

---

## Testing

### Verify Dummification:
1. Open browser console
2. Check localStorage: `localStorage.getItem('dummification_mappings')`
3. Hover over sites - should see `SITE_A####` format
4. Click site - KPIs should load correctly
5. Check network tab - API calls should use real UST IDs

### Clear Mappings:
```javascript
// In browser console
localStorage.removeItem('dummification_mappings');
location.reload();
```

---

## Maintenance

### Adding New Data Types:
1. Add mapping in `DummificationMapper` class
2. Create `dummifyNewType()` function
3. Add `getRealNewType()` reverse function
4. Update storage save/load logic

### Modifying Dummy Formats:
- Edit hash functions in `dummification.ts`
- Clear localStorage to regenerate mappings
- Test consistency across page reloads

---

## Status

✅ **Implemented:**
- Site ID dummification
- Site name dummification
- Cell ID dummification
- Cell name dummification
- Cluster ID removal from UI
- Two-way mapping (display ↔ API)
- localStorage persistence
- MapView integration
- KPI trends integration

🔄 **Auto-applies:** On every data fetch from backend

---

*Last Updated: 2026-02-10*
*Version: 1.0*
