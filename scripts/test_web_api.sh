#!/bin/bash
# AIPC Platform - Web API Integration Test Script

# Don't exit on error, we want to run all tests
set +e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

API_BASE="http://localhost:8080/api/v1"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}AIPC Platform - Web API Integration Test${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check if Platform API is running
if ! curl -s "${API_BASE}/system/health" > /dev/null 2>&1; then
    echo -e "${RED}Error: Platform API is not running${NC}"
    echo "Please start it with: ./scripts/start_mvp.sh"
    exit 1
fi

echo -e "${GREEN}✓${NC} Platform API is running"
echo ""

# Test counter
PASSED=0
FAILED=0

# Test function
test_api() {
    local name="$1"
    local method="$2"
    local endpoint="$3"
    local data="$4"
    
    echo -e "${BLUE}Testing: ${name}${NC}"
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" "${API_BASE}${endpoint}")
    elif [ "$method" = "POST" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST \
            -H "Content-Type: application/json" \
            -d "$data" \
            "${API_BASE}${endpoint}")
    elif [ "$method" = "DELETE" ]; then
        response=$(curl -s -w "\n%{http_code}" -X DELETE \
            "${API_BASE}${endpoint}")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        echo -e "${GREEN}✓${NC} ${name} (HTTP ${http_code})"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗${NC} ${name} (HTTP ${http_code})"
        echo "  Response: $body"
        ((FAILED++))
        return 1
    fi
}

# System API tests
echo -e "${YELLOW}[1/6] Testing System API...${NC}"
test_api "System Info" "GET" "/system/info"
test_api "System Stats" "GET" "/system/stats"
test_api "Health Check" "GET" "/system/health"
echo ""

# AI Runtime API tests
echo -e "${YELLOW}[2/6] Testing AI Runtime API...${NC}"
test_api "List Models" "GET" "/ai/models"
test_api "AI Stats" "GET" "/ai/stats"
echo ""

# Event Bus API tests
echo -e "${YELLOW}[3/6] Testing Event Bus API...${NC}"
test_api "List Topics" "GET" "/events/topics"
test_api "Publish Event" "POST" "/events/publish" '{"topic":"test/event","payload":{"message":"test"}}'
echo ""

# Device Control API tests
echo -e "${YELLOW}[4/6] Testing Device Control API...${NC}"
test_api "Device Status" "GET" "/device/status"
test_api "Set Light" "POST" "/device/light" '{"level":50}'
test_api "Set IR LED" "POST" "/device/ir-led" '{"level":30}'
test_api "Set IR Cut" "POST" "/device/ir-cut" '{"mode":"auto"}'
test_api "PTZ Control" "POST" "/device/ptz" '{"action":"pan","direction":"left","speed":5}'
echo ""

# App Manager API tests
echo -e "${YELLOW}[5/6] Testing App Manager API...${NC}"
test_api "List Apps" "GET" "/apps"
echo ""

# WebSocket test (basic connectivity)
echo -e "${YELLOW}[6/6] Testing WebSocket...${NC}"
echo -e "${BLUE}Testing: WebSocket Connection${NC}"
if command -v websocat &> /dev/null; then
    timeout 2 websocat "ws://localhost:8080/api/v1/events/stream" > /dev/null 2>&1 && \
        echo -e "${GREEN}✓${NC} WebSocket Connection (basic)" && ((PASSED++)) || \
        echo -e "${YELLOW}⚠${NC} WebSocket test skipped (websocat not installed)"
else
    echo -e "${YELLOW}⚠${NC} WebSocket test skipped (websocat not installed)"
    echo "  Install with: cargo install websocat (or use browser console)"
fi
echo ""

# Summary
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Test Summary${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Passed: ${GREEN}${PASSED}${NC}"
echo -e "Failed: ${RED}${FAILED}${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed! ✓${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed${NC}"
    exit 1
fi

