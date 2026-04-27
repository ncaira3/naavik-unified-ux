#!/bin/bash

# Naavik Unified UX Prototype - Development Server Startup Script
# This script starts both the backend and frontend development servers.
# Requires PostgreSQL (e.g. via docker-compose) for KPI, AppGen catalog, and settings.

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 Starting Naavik Unified UX Prototype..."
echo ""

# =====================================================
# Clear existing processes on ports 3000, 5050, 5175, 5433
# =====================================================
echo "Clearing any existing processes on ports 3000, 5175..."

clear_port() {
  local port=$1
  # Check if port is in use
  if lsof -i :$port 2>/dev/null | grep -q LISTEN; then
    echo "  Killing processes on port $port..."
    lsof -i :$port 2>/dev/null | grep -v COMMAND | awk '{print $2}' | sort -u | xargs kill -9 2>/dev/null
    sleep 1
    echo "  ✓ Port $port cleared"
  else
    echo "  ✓ Port $port is free"
  fi
}

# Only clear app ports — never kill 5433 (Postgres) or 5050 (pgAdmin)
clear_port 3000
clear_port 5175

echo ""

# Check if PostgreSQL is reachable on port 5433; if not, try to start it via Docker
pg_check() {
  node -e "
    const n=require('net');const s=n.createConnection(5433,'127.0.0.1',()=>{s.destroy();process.exit(0)});
    s.on('error',()=>process.exit(1));s.setTimeout(2000,()=>{s.destroy();process.exit(1)});
  " 2>/dev/null
}
if pg_check; then
  PG_UP=1
else
  PG_UP=
fi

if [ -z "$PG_UP" ]; then
  echo "PostgreSQL is not running on localhost:5433."
  # Support both legacy docker-compose and the Docker Desktop plugin (docker compose).
  # Docker Desktop on macOS may expose its socket at a non-standard path; exporting it
  # here ensures the docker CLI can find the daemon even when DOCKER_HOST is not set.
  if [ -z "$DOCKER_HOST" ]; then
    for sock in \
      "$HOME/.docker/run/docker.sock" \
      "$HOME/.docker/desktop/run/docker.sock" \
      "/var/run/docker.sock"; do
      if [ -S "$sock" ]; then
        export DOCKER_HOST="unix://$sock"
        break
      fi
    done
  fi

  if command -v docker-compose &>/dev/null || (command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1); then
    echo "Starting PostgreSQL and pgAdmin with Docker..."
    (cd "$PROJECT_ROOT" && (docker-compose up -d postgres pgadmin 2>&1 | grep -v "obsolete" || docker compose up -d postgres pgadmin 2>&1 | grep -v "obsolete")) || true

    echo "Waiting for PostgreSQL to be ready (up to 60 seconds)..."
    TIMEOUT=60
    ELAPSED=0
    while [ $ELAPSED -lt $TIMEOUT ]; do
      if pg_check; then
        sleep 2
        PG_UP=1
        break
      fi
      ELAPSED=$((ELAPSED + 1))
      printf "."
      sleep 1
    done

    if [ ! -z "$PG_UP" ]; then
      echo ""
      echo "✓ PostgreSQL is running on localhost:5433"
      echo "✓ pgAdmin is running on http://localhost:5050 (admin@naavik.com / admin123)"
    else
      echo ""
      echo "⚠️  PostgreSQL is starting but may not be ready yet."
      echo "    Containers are running. Proceeding with server startup."
      echo "    Database operations may fail initially but should work within 30 seconds."
    fi
  fi
else
  echo "✓ PostgreSQL is already running on localhost:5433"
  echo "✓ pgAdmin should be available at http://localhost:5050 (admin@naavik.com / admin123)"
fi

# Start backend in background
echo "Starting backend server..."
cd "$PROJECT_ROOT/backend" && npm run dev &
BACKEND_PID=$!

# Give backend a moment to start
sleep 2

# Start frontend in foreground
echo "Starting frontend server..."
cd "$PROJECT_ROOT/frontend" && npm run dev

# Cleanup: kill backend when frontend is stopped
trap "echo ''; echo 'Shutting down servers...'; kill $BACKEND_PID 2>/dev/null; exit" EXIT INT TERM
