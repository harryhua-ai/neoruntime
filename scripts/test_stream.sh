#!/bin/bash
#
# Test video stream preview
# Usage: ./scripts/test_stream.sh
#
set -euo pipefail

HLS_DIR="/run/aipc/hls/main"
API_PORT=8080

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[stream]${NC} $*"; }
warn() { echo -e "${YELLOW}[stream]${NC} $*"; }

# Create HLS directory
log "Creating HLS directory: $HLS_DIR"
mkdir -p "$HLS_DIR"

# Check if ffmpeg is available
if ! command -v ffmpeg &>/dev/null; then
    warn "ffmpeg not found. Please install ffmpeg first."
    warn "  Ubuntu: apt install ffmpeg"
    exit 1
fi

# Generate test stream
log "Starting test stream (press Ctrl+C to stop)..."
log ""
log "Preview URLs:"
log "  Web Console: http://localhost:$API_PORT"
log "  HLS Direct:  http://localhost:$API_PORT/api/v1/streams/main/hls/stream.m3u8"
log ""

# Start platform-api in background if not running
if ! curl -s "http://localhost:$API_PORT/api/v1/system/health" &>/dev/null; then
    log "Starting platform-api..."
    cd "$(dirname "$0")/.."
    go run ./platform/platform-api/server/ -config configs/platform-api.yaml &
    API_PID=$!
    sleep 2
    trap "kill $API_PID 2>/dev/null" EXIT
fi

# Generate test video stream
ffmpeg -re -f lavfi -i "testsrc=size=1280x720:rate=25" \
    -c:v libx264 -preset ultrafast -tune zerolatency \
    -g 25 -keyint_min 25 \
    -f hls \
    -hls_time 1 \
    -hls_list_size 3 \
    -hls_flags delete_segments+append_list \
    -hls_segment_filename "$HLS_DIR/segment_%03d.ts" \
    "$HLS_DIR/stream.m3u8"
