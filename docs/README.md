# Naavik Unified UX Prototype - E2E Product Demonstration

**From Manual Operations to Autonomous Networks**

A comprehensive demonstration of Naavik's AI-powered network intelligence platform showcasing 4 core workflows:
1. **Observe & Analyze** - AI-driven insights and consolidated observability
2. **GenAI AppGen** - Conversational application development
3. **Agentic Orchestration** - Parallel AI agents for network operations
4. **Provision (ZTP)** - Zero-Touch Provisioning with auto remediation

## 🏗️ Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌──────────────┐
│  React Frontend │─────▶│  Node.js API     │─────▶│  PostgreSQL  │
│  (Vite + React) │      │  (Express + WS)  │      │  Database    │
└─────────────────┘      └──────────────────┘      └──────────────┘
```

## 📊 Database Status

Successfully loaded **1,400+ rows** of anonymized telecom network data across 7 tables:

| Table | Rows | Description |
|-------|------|-------------|
| cell_table | 100 | Cell tower information with KPIs |
| sector_table | 100 | Sector configuration data |
| intermediate_kpi_table | 500 | Network KPI measurements |
| ticket_table | 100 | Network issue tickets |
| eim_table | 100 | Equipment maintenance data |
| neighbors_table_date_id | 200 | Cell neighbor relationships |
| subcomponent_table | 300 | KPI subcomponent breakdowns |
| cqx_offenders_truth_table | 100 | Customer experience metrics |

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for backend)
- Python 3.9+ (for data scripts)

### 1. Start the Database

```bash
# Start PostgreSQL and pgAdmin
docker-compose up -d

# Verify containers are running
docker ps | grep naavik

# Access pgAdmin at http://localhost:5050
# Login: admin@naavik.com / admin123
```

### 2. Database is Already Loaded

The database has been pre-loaded with anonymized data. To reload or update data:

```bash
# Fetch fresh data from API (optional)
python3 scripts/fetch_api_data.py

# Anonymize the data
python3 scripts/anonymize_data.py

# Load into PostgreSQL
python3 scripts/load_data_to_postgres.py
```

### 3. Start the Backend API (Coming Next)

```bash
cd backend
npm install
npm run dev
```

### 4. Start the Frontend (Coming Next)

```bash
cd frontend
npm install
npm run dev
```

## 📂 Project Structure

```
naavik_unified_ux/
├── backend/                  # Node.js Express API
│   ├── server.js
│   ├── routes/
│   └── services/
├── frontend/                 # React application
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── hooks/
│   └── package.json
├── database/                 # Database files
│   ├── schema.sql           # PostgreSQL schema
│   └── init/                # Initialization scripts
├── scripts/                  # Data processing scripts
│   ├── fetch_api_data.py    # Fetch from Compass API
│   ├── anonymize_data.py    # Anonymize network data
│   └── load_data_to_postgres.py
├── dummy_data/              # Anonymized CSV files
├── raw_data/                # Original fetched data (gitignored)
├── docker-compose.yml       # Database services
└── README.md

```

## 🔑 Database Credentials

**PostgreSQL:**
- Host: `localhost:5432`
- Database: `naavik_demo`
- User: `naavik_user`
- Password: `naavik_pass_2026`

**pgAdmin:**
- URL: `http://localhost:5050`
- Email: `admin@naavik.com`
- Password: `admin123`

## 📋 Available Scripts

### Data Pipeline

```bash
# Read Excel schema
python3 scripts/read_schema.py

# Fetch data from Compass API
python3 scripts/fetch_api_data.py

# Anonymize fetched data
python3 scripts/anonymize_data.py

# Load data into PostgreSQL
python3 scripts/load_data_to_postgres.py
```

### Database Management

```bash
# Start database
docker-compose up -d

# Stop database
docker-compose down

# View logs
docker-compose logs -f postgres

# Reset database (removes all data)
docker-compose down -v
docker-compose up -d
```

## 🎯 Demo Workflows

### 1. Observe & Analyze
**Natural Language Intent:** "What's wrong with the network?"

Features:
- AI-driven anomaly detection
- Consolidated KPI visualization
- Real-time agent orchestration display
- Drill-down capability by region/cell
- Parameter modification via deployed apps

### 2. GenAI AppGen
**Natural Language Intent:** "Create an app to monitor data drop rate"

Features:
- Conversational app development
- Automatic code generation in network domain language
- Deployment location selection (SMO / Naavik Store / Future Use)
- Real-time logic validation
- Simulated deployment with status updates

### 3. Agentic Orchestration
**Parallel Agent Workflow:**
- **Observation Agent**: Detects network issues
- **Reasoning Agent**: Determines root causes
- **Perception Agent**: Validates hypothesis
- **Sensing Agent**: Monitors and suggests fixes

### 4. Zero-Touch Provisioning
**Natural Language Intent:** "Provision new base station in Region B"

Features:
- Automated provisioning workflow
- ADRCA (Automated Deployment, Remediation, Configuration, Assurance)
- Network topology visualization
- Configuration validation
- Self-healing capabilities

## 🗄️ Database Schema

Key tables and relationships:

- **cell_table** → Contains cell tower data with SiteID, location, tech type
- **site_table** → Site-level aggregated information
- **intermediate_kpi_table** → Time-series KPI metrics (DATA_ACC_RATE, DATA_DROP_RATE, NS_ESO_AVAIL, etc.)
- **neighbors_table_date_id** → Cell neighbor relationships with handover counts
- **ticket_table** → Network issue tickets
- **cqx_offenders_truth_table** → Customer experience impact metrics

## 🔒 Data Anonymization

All network data has been anonymized:
- ✅ Site IDs, Cell IDs mapped to dummy values
- ✅ Location coordinates offset by ±0.5 degrees
- ✅ Engineer names hashed
- ✅ Ticket descriptions generalized
- ✅ Equipment IDs randomized
- ✅ **Data patterns and anomalies preserved for realistic demo**

## 🛠️ Development

### Technology Stack

**Backend:**
- Node.js 18+
- Express.js
- WebSocket (Socket.io)
- PostgreSQL client (pg)

**Frontend:**
- React 18
- Vite
- Tailwind CSS
- Chart.js / Recharts
- shadcn/ui or Material-UI

**Database:**
- PostgreSQL 15
- Docker & Docker Compose

### API Endpoints (Planned)

```
GET  /api/kpis                    - Get KPI metrics
GET  /api/sites                   - Get site information
GET  /api/cells                   - Get cell data
GET  /api/anomalies               - Get detected anomalies
POST /api/intent                  - Process natural language intent
GET  /api/agents                  - Get agent activity
POST /api/apps/generate           - Generate application
POST /api/apps/deploy             - Deploy application
GET  /api/provisioning            - Get provisioning history
POST /api/provisioning/initiate   - Initiate ZTP workflow
```

## 📝 Next Steps

### Phase 1: Backend API ✅ (In Progress)
- [ ] Set up Express server
- [ ] Create database connection pool
- [ ] Build REST endpoints for KPIs and sites
- [ ] Implement WebSocket for real-time updates
- [ ] Add intent parsing service

### Phase 2: Frontend Foundation
- [ ] Initialize React app with Vite
- [ ] Set up Tailwind CSS and component library
- [ ] Create main dashboard layout
- [ ] Build intent input component
- [ ] Implement routing

### Phase 3: Workflow Implementation
- [ ] Observe & Analyze workflow
- [ ] GenAI AppGen workflow
- [ ] Agentic Orchestration dashboard
- [ ] ZTP Provisioning workflow

### Phase 4: Demo Enhancements
- [ ] Add pre-configured demo paths
- [ ] Implement demo mode controls
- [ ] Add animations and transitions
- [ ] Create presentation mode
- [ ] Record demo videos

## 🐛 Known Issues

- site_table and alarm_table not loaded (data type mismatches) - **not critical for demo**
- Need to increase data volume for more realistic time-series
- Missing hourly KPI data (table too large, timed out during fetch)

## 📚 Additional Resources

- Original schema: `Compass_queries_schema_v2.xlsx`
- Anonymization summary: `dummy_data/anonymization_summary.json`
- Fetch summary: `raw_data/fetch_summary.json`

## 🤝 Support

For issues or questions about the demo setup, contact the Naavik team.

---

**Naavik Unified UX Prototype**
