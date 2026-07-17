#!/bin/bash
# AIPC Platform - WebSocket Test Script

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

API_BASE="http://localhost:8080/api/v1"
WS_URL="ws://localhost:8080/api/v1/events/stream"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}AIPC Platform - WebSocket Test${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check if Platform API is running
if ! curl -s "${API_BASE}/system/health" > /dev/null 2>&1; then
    echo -e "${RED}Error: Platform API is not running${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Platform API is running"
echo ""

# Test WebSocket connection
echo -e "${BLUE}Testing WebSocket connection...${NC}"

# Check if Python websockets is available
if python3 -c "import websockets" 2>/dev/null; then
    python3 << 'EOF'
import asyncio
import websockets
import json
import sys

async def test_websocket():
    uri = "ws://localhost:8080/api/v1/events/stream"
    try:
        async with websockets.connect(uri) as websocket:
            print("✓ WebSocket connected")
            
            # Wait for a message or timeout
            try:
                message = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                data = json.loads(message)
                print(f"✓ Received event: {data.get('topic', 'unknown')}")
                print("  WebSocket is working correctly")
                sys.exit(0)
            except asyncio.TimeoutError:
                print("⚠ No events received (this is OK if no events are being published)")
                print("  WebSocket connection is working")
                sys.exit(0)
    except Exception as e:
        print(f"✗ WebSocket connection failed: {e}")
        sys.exit(1)

asyncio.run(test_websocket())
EOF
    WS_RESULT=$?
    
    if [ $WS_RESULT -eq 0 ]; then
        echo ""
        echo -e "${GREEN}✓${NC} WebSocket test passed"
    else
        echo ""
        echo -e "${RED}✗${NC} WebSocket connection test failed"
    fi
else
    echo -e "${YELLOW}⚠${NC} Python websockets library not found"
    echo ""
    echo "  Option 1: Install Python websockets library"
    echo "    pip3 install websockets"
    echo ""
    echo "  Option 2: Test manually in browser console"
    echo "    Open http://localhost:3000 and go to Events page"
    echo "    Or run in browser console:"
    echo "      const ws = new WebSocket('${WS_URL}');"
    echo "      ws.onopen = () => console.log('✓ Connected');"
    echo "      ws.onmessage = (e) => console.log('Event:', JSON.parse(e.data));"
    echo "      ws.onerror = (e) => console.error('Error:', e);"
    echo ""
    echo "  Option 3: Use curl to test HTTP upgrade (basic check)"
    echo "    curl -i -N -H 'Connection: Upgrade' -H 'Upgrade: websocket' \\"
    echo "         -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: test' \\"
    echo "         '${WS_URL}'"
    echo ""
    
    # Basic HTTP upgrade test
    echo -e "${BLUE}Performing basic HTTP upgrade test...${NC}"
    HTTP_TEST=$(curl -s -o /tmp/ws_test_response.txt -w "%{http_code}" \
        -H "Connection: Upgrade" \
        -H "Upgrade: websocket" \
        -H "Sec-WebSocket-Version: 13" \
        -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
        "http://localhost:8080/api/v1/events/stream" 2>&1)
    
    HTTP_CODE=$(echo "$HTTP_TEST" | tail -n1)
    
    if [ "$HTTP_CODE" = "101" ] || [ "$HTTP_CODE" = "426" ] || [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "401" ]; then
        echo -e "${GREEN}✓${NC} WebSocket endpoint is responding (HTTP ${HTTP_CODE})"
        echo "  This indicates the WebSocket endpoint is accessible"
    elif [ "$HTTP_CODE" = "000" ]; then
        echo -e "${YELLOW}⚠${NC} Could not connect to WebSocket endpoint"
        echo "  This may be normal - WebSocket requires a proper handshake"
    else
        echo -e "${YELLOW}⚠${NC} Unexpected HTTP response: ${HTTP_CODE}"
        echo "  Response saved to /tmp/ws_test_response.txt"
    fi
fi

echo ""
echo -e "${BLUE}Testing event publishing...${NC}"

# Publish a test event
PUBLISH_RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d '{"topic":"test/websocket","payload":{"message":"WebSocket test event","timestamp":'$(date +%s)'}}' \
    "${API_BASE}/events/publish")

if echo "$PUBLISH_RESPONSE" | grep -q "success\|event_id"; then
    echo -e "${GREEN}✓${NC} Event published successfully"
    echo "  Response: $PUBLISH_RESPONSE"
else
    echo -e "${YELLOW}⚠${NC} Event publish response: $PUBLISH_RESPONSE"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}WebSocket Test Complete${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "💡 To test in browser:"
echo "   1. Open http://localhost:3000"
echo "   2. Go to Events page"
echo "   3. Open browser console (F12)"
echo "   4. Check WebSocket connection status"

