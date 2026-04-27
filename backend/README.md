# Naavik Unified UX Prototype Backend API

Node.js + Express + TypeScript backend for Naavik Unified UX Prototype.

## Status

✅ **Core Services:**
- Authentication (JWT)
- Database connection (PostgreSQL)
- Site management
- KPI metrics
- Caching layer
- Error handling & logging

✅ **Advanced Services:**
- Intent Parser (OpenAI GPT-4 + fallback)
- Agent Orchestration (4 parallel agents)
- Anomaly Detection (threshold-based)
- Root Cause Analysis (outage detection)

🚧 **In Progress:**
- App Generation (GenAI AppGen)
- Zero-Touch Provisioning
- WebSocket real-time updates

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Start dev server (with hot reload)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login with username/password
- `GET /api/auth/verify` - Verify JWT token
- `POST /api/auth/logout` - Logout

**Default Credentials:**
- Username: `admin`
- Password: `admin123`

### Sites
- `GET /api/sites` - Get all sites
- `GET /api/sites/map` - Get sites for map visualization
- `GET /api/sites/anomalies` - Get sites with anomalies
- `GET /api/sites/search?q={query}` - Search sites
- `GET /api/sites/dates` - Get available date range
- `GET /api/sites/:siteId` - Get site details
- `GET /api/sites/:siteId/cells` - Get cells for a site
- `GET /api/sites/:siteId/kpis` - Get latest KPIs for a site
- `GET /api/sites/:siteId/kpis/:kpiName` - Get KPI time series

### KPIs
- `GET /api/kpis` - Get list of available KPIs
- `GET /api/kpis/search?q={query}` - Search KPIs
- `GET /api/kpis/:kpiName/stats` - Get KPI statistics
- `GET /api/kpis/:kpiName/top-sites` - Get top sites by KPI
- `POST /api/kpis/compare` - Compare KPI across sites

### Anomalies
- `GET /api/anomalies` - Get all anomalies
- `GET /api/anomalies/stats` - Get statistics
- `GET /api/anomalies/site/:siteId` - Get site anomalies
- `POST /api/anomalies/check` - Check if value is anomalous

### Root Cause Analysis
- `GET /api/rca/outages` - Get active outages
- `GET /api/rca/site/:siteId` - Get site RCA
- `POST /api/rca/analyze` - Analyze specific anomaly

### Intent & Agents
- `POST /api/intent/parse` - Parse natural language query
- `POST /api/intent/execute` - Execute full workflow
- `POST /api/intent/observe` - Direct observe workflow
- `GET /api/intent/workflow/:id` - Get workflow history

### Health
- `GET /health` - Health check
- `GET /api` - API information

## Environment Variables

See `.env.example` for full list. Key variables:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=naavik_demo
DB_USER=naavik_user
DB_PASSWORD=naavik_pass_2026
JWT_SECRET=your-secret-key
OPENAI_API_KEY=your-openai-key  # For AI features
```

## Architecture

```
backend/
├── src/
│   ├── config/          # Database, OpenAI, constants
│   ├── middleware/      # Auth, logging, error handling
│   ├── models/          # Database queries
│   ├── routes/          # API endpoints
│   ├── services/        # Business logic (coming)
│   ├── types/           # TypeScript definitions
│   ├── utils/           # Logger, cache
│   └── server.ts        # Main entry point
├── logs/                # Application logs
└── dist/                # Compiled JavaScript
```

## Database Schema

Connected to PostgreSQL with:
- **34,570** cells
- **13,824** sites
- **172,850** KPI records
- **13,109** CQX impact records
- Plus tickets, alarms, neighbors, subcomponents

## Performance Targets

- Intent parsing: **< 500ms**
- Site queries: **< 200ms**
- KPI queries: **< 500ms**
- Agent workflows: **< 5s**

## Tech Stack

- **Runtime:** Node.js v24+
- **Framework:** Express 4.x
- **Language:** TypeScript 5.x
- **Database:** PostgreSQL 15 (via pg)
- **Auth:** JWT (jsonwebtoken)
- **AI:** OpenAI API
- **Logging:** Winston
- **Cache:** node-cache
- **Dev Tools:** tsx (hot reload)

## Development

```bash
# Watch mode (auto-reload)
npm run dev

# Check logs
tail -f logs/combined.log

# Database status
docker ps -a | grep naavik_postgres
```

## Testing API

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Get sites (with token)
TOKEN="your-jwt-token"
curl http://localhost:3000/api/sites \
  -H "Authorization: Bearer $TOKEN"

# Health check
curl http://localhost:3000/health
```

## Current Status

**Server Running:** ✅  
**Database Connected:** ✅  
**Data Loaded:** ✅  
**Authentication:** ✅  
**Core Endpoints:** ✅  

Ready for frontend integration!
