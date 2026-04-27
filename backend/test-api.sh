#!/bin/bash
# Naavik Demo API Test Script
# Comprehensive testing of all backend endpoints

BASE_URL="${BASE_URL:-http://localhost:3000}"
# Read admin credentials from the env (matches what the backend reads).
# Set them in your shell or load backend/.env before running this script.
ADMIN_USER="${ADMIN_USERNAME:-${ADMIN_USER:-}}"
ADMIN_PASS="${ADMIN_PASSWORD:-${ADMIN_PASS:-}}"

if [ -z "$ADMIN_USER" ] || [ -z "$ADMIN_PASS" ]; then
  echo "ERROR: ADMIN_USERNAME and ADMIN_PASSWORD env vars must be set." >&2
  echo "  e.g.  set -a; source backend/.env; set +a; ./backend/test-api.sh" >&2
  exit 1
fi

echo "=================================="
echo "Naavik Demo API Test Suite"
echo "=================================="
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASS=0
FAIL=0

# Function to test endpoint
test_endpoint() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4
    local auth=$5
    
    echo -n "Testing: $name... "
    
    if [ "$auth" = "true" ]; then
        if [ -z "$TOKEN" ]; then
            echo -e "${RED}FAIL${NC} (No token)"
            ((FAIL++))
            return
        fi
        headers="-H \"Authorization: Bearer $TOKEN\""
    else
        headers=""
    fi
    
    if [ "$method" = "GET" ]; then
        response=$(eval curl -s -w "\\n%{http_code}" $headers "$BASE_URL$endpoint")
    else
        response=$(eval curl -s -w "\\n%{http_code}" $headers -X $method -H \"Content-Type: application/json\" -d \'$data\' "$BASE_URL$endpoint")
    fi
    
    status=$(echo "$response" | tail -n1)
    
    if [ "$status" = "200" ]; then
        echo -e "${GREEN}PASS${NC} ($status)"
        ((PASS++))
    else
        echo -e "${RED}FAIL${NC} ($status)"
        ((FAIL++))
    fi
}

# 1. Health Check
echo "=== Health & Info ===="
test_endpoint "Health Check" "GET" "/health"
test_endpoint "API Info" "GET" "/api"
echo ""

# 2. Authentication
echo "=== Authentication ===="
echo "Logging in..."
login_response=$(curl -s -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")

TOKEN=$(echo $login_response | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
    echo -e "${RED}Login FAILED${NC}"
    exit 1
else
    echo -e "${GREEN}Login SUCCESS${NC}"
    ((PASS++))
fi
echo ""

# 3. Sites API
echo "=== Sites API ===="
test_endpoint "Get All Sites" "GET" "/api/sites" "" "true"
test_endpoint "Get Map Sites" "GET" "/api/sites/map" "" "true"
test_endpoint "Get Site Anomalies" "GET" "/api/sites/anomalies" "" "true"
test_endpoint "Get Available Dates" "GET" "/api/sites/dates" "" "true"
test_endpoint "Search Sites" "GET" "/api/sites/search?q=UST" "" "true"
test_endpoint "Get Site by ID" "GET" "/api/sites/UST100017" "" "true"
test_endpoint "Get Site Cells" "GET" "/api/sites/UST100017/cells" "" "true"
test_endpoint "Get Site KPIs" "GET" "/api/sites/UST100017/kpis" "" "true"
echo ""

# 4. KPIs API
echo "=== KPIs API ===="
test_endpoint "Get Available KPIs" "GET" "/api/kpis" "" "true"
test_endpoint "Search KPIs" "GET" "/api/kpis/search?q=DROP" "" "true"
test_endpoint "Get KPI Stats" "GET" "/api/kpis/DATA_DROP_RATE/stats" "" "true"
test_endpoint "Get Top Sites by KPI" "GET" "/api/kpis/DATA_DROP_RATE/top-sites?limit=5" "" "true"
test_endpoint "Compare KPI Across Sites" "POST" "/api/kpis/compare" '{"siteIds":["UST100017","UST100052"],"kpiName":"DATA_DROP_RATE"}' "true"
echo ""

# 5. Anomalies API
echo "=== Anomalies API ===="
test_endpoint "Get All Anomalies" "GET" "/api/anomalies" "" "true"
test_endpoint "Get Anomaly Stats" "GET" "/api/anomalies/stats" "" "true"
test_endpoint "Get Site Anomalies" "GET" "/api/anomalies/site/UST100017" "" "true"
test_endpoint "Check If Value is Anomaly" "POST" "/api/anomalies/check" '{"kpiName":"DATA_DROP_RATE","value":6.5}' "true"
echo ""

# 6. RCA API
echo "=== Root Cause Analysis ===="
test_endpoint "Get Active Outages" "GET" "/api/rca/outages" "" "true"
test_endpoint "Get Site RCA" "GET" "/api/rca/site/UST100017" "" "true"
test_endpoint "Analyze Anomaly" "POST" "/api/rca/analyze" '{"siteId":"UST100017"}' "true"
echo ""

# 7. Intent & Agents API
echo "=== Intent & Agent Workflow ===="
test_endpoint "Parse Intent" "POST" "/api/intent/parse" '{"query":"What is wrong with the network?"}' "true"
echo ""

echo "Running full agent workflow..."
echo -n "Testing: Execute Intent with Agents... "
start_time=$(date +%s)
workflow_response=$(curl -s -X POST "$BASE_URL/api/intent/execute" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"query":"Show me critical network issues"}')
end_time=$(date +%s)
duration=$((end_time - start_time))

if echo "$workflow_response" | grep -q '"success":true'; then
    echo -e "${GREEN}PASS${NC} (${duration}s)"
    ((PASS++))
    
    # Extract workflow ID
    workflow_id=$(echo "$workflow_response" | grep -o '"workflowId":"[^"]*' | cut -d'"' -f4)
    
    if [ -n "$workflow_id" ]; then
        echo "  └─ Workflow ID: $workflow_id"
        echo "  └─ Duration: ${duration}s"
        
        # Count agents
        agent_count=$(echo "$workflow_response" | grep -o '"agentName"' | wc -l)
        echo "  └─ Agents executed: $agent_count"
    fi
else
    echo -e "${RED}FAIL${NC}"
    ((FAIL++))
fi
echo ""

# 8. Direct Observe Workflow
echo "Testing: Direct Observe Workflow... "
observe_response=$(curl -s -X POST "$BASE_URL/api/intent/observe" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"filters":{"severity":"critical"}}')

if echo "$observe_response" | grep -q '"success":true'; then
    echo -e "${GREEN}PASS${NC}"
    ((PASS++))
else
    echo -e "${RED}FAIL${NC}"
    ((FAIL++))
fi
echo ""

# Summary
echo "=================================="
echo "Test Results"
echo "=================================="
echo -e "Passed: ${GREEN}$PASS${NC}"
echo -e "Failed: ${RED}$FAIL${NC}"
TOTAL=$((PASS + FAIL))
echo "Total:  $TOTAL"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
else
    echo -e "${YELLOW}⚠️  Some tests failed${NC}"
    exit 1
fi
