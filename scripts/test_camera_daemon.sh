#!/bin/bash
# test_camera_daemon.sh - Build and run camera-daemon with stub HAL
#
# Usage:
#   ./scripts/test_camera_daemon.sh              # Build + run (5 seconds)
#   ./scripts/test_camera_daemon.sh --build-only  # Build only
#   ./scripts/test_camera_daemon.sh --duration 10  # Run for 10 seconds
#   ./scripts/test_camera_daemon.sh --with-reader   # Also run SHM reader

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUILD_DIR="${PROJECT_DIR}/build"

# Defaults
DURATION=5
BUILD_ONLY=false
WITH_READER=false

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --build-only)  BUILD_ONLY=true; shift ;;
        --duration)    DURATION="$2"; shift 2 ;;
        --with-reader) WITH_READER=true; shift ;;
        -h|--help)
            echo "Usage: $0 [--build-only] [--duration N] [--with-reader]"
            exit 0 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

echo "=== AIPC Camera Daemon Test ==="
echo "Project:  ${PROJECT_DIR}"
echo "Build:    ${BUILD_DIR}"
echo ""

# ---- Step 1: Build stub HAL .so ----
echo "--- Building stub HAL library ---"
mkdir -p "${BUILD_DIR}/hal-stub"
cd "${BUILD_DIR}/hal-stub"
cmake "${PROJECT_DIR}/hal/media/stub" \
    -DCMAKE_BUILD_TYPE=Debug \
    -DCMAKE_C_FLAGS="-Wall -Wextra -g"
make -j"$(nproc)"
echo "  Built: $(ls -la libhal-stub.so)"
echo ""

# ---- Step 2: Build camera-daemon ----
echo "--- Building camera-daemon ---"
mkdir -p "${BUILD_DIR}/camera-daemon"
cd "${BUILD_DIR}/camera-daemon"
cmake "${PROJECT_DIR}/platform/camera-daemon" \
    -DCMAKE_BUILD_TYPE=Debug \
    -DCMAKE_CXX_FLAGS="-Wall -Wextra -g"
make -j"$(nproc)"
echo "  Built: $(ls -la camera-daemon)"
echo ""

# ---- Step 3: Build SHM reader test tool ----
echo "--- Building SHM reader tool ---"
gcc -Wall -Wextra -g -O2 \
    "${PROJECT_DIR}/tools/shm_reader/shm_reader.c" \
    -o "${BUILD_DIR}/shm_reader" \
    -lpthread
echo "  Built: $(ls -la ${BUILD_DIR}/shm_reader)"
echo ""

if [ "$BUILD_ONLY" = true ]; then
    echo "=== Build complete (build-only mode) ==="
    exit 0
fi

# ---- Step 4: Prepare runtime directories ----
echo "--- Preparing runtime environment ---"
SHM_DIR="/run/aipc/shm"
SOCK_DIR="/run/aipc"

mkdir -p "${SHM_DIR}" 2>/dev/null || sudo mkdir -p "${SHM_DIR}"
mkdir -p "${SOCK_DIR}" 2>/dev/null || sudo mkdir -p "${SOCK_DIR}"

# Clean stale SHM files
rm -f "${SHM_DIR}"/*.shm 2>/dev/null || true
rm -f "${SOCK_DIR}/camera.sock" 2>/dev/null || true
echo "  SHM dir: ${SHM_DIR}"
echo ""

# ---- Step 5: Generate test config with absolute paths ----
HAL_LIB="${BUILD_DIR}/hal-stub/libhal-stub.so"
TEST_CONFIG="${BUILD_DIR}/test-config.yaml"

cat > "${TEST_CONFIG}" << EOF
# Auto-generated test config
hal:
  video_library: ${HAL_LIB}
  codec_library: ${HAL_LIB}
  osd_library: ${HAL_LIB}

video:
  device_path: /dev/video0

watchdog:
  scan_interval_ms: 100
  frame_timeout_ms: 500
  warn_threshold_ms: 300

service:
  log_level: debug
EOF
echo "  Config: ${TEST_CONFIG}"
echo ""

# ---- Step 6: Run camera-daemon ----
echo "=== Starting camera-daemon (${DURATION}s) ==="
DAEMON_BIN="${BUILD_DIR}/camera-daemon/camera-daemon"
DAEMON_PID=""

cleanup() {
    echo ""
    echo "--- Cleaning up ---"
    if [ -n "${DAEMON_PID}" ] && kill -0 "${DAEMON_PID}" 2>/dev/null; then
        echo "  Stopping daemon (PID=${DAEMON_PID})"
        kill -SIGTERM "${DAEMON_PID}" 2>/dev/null || true
        wait "${DAEMON_PID}" 2>/dev/null || true
    fi
    if [ -n "${READER_PID:-}" ] && kill -0 "${READER_PID}" 2>/dev/null; then
        echo "  Stopping SHM reader (PID=${READER_PID})"
        kill -SIGTERM "${READER_PID}" 2>/dev/null || true
        wait "${READER_PID}" 2>/dev/null || true
    fi

    echo ""
    echo "--- SHM files created ---"
    ls -la "${SHM_DIR}"/ 2>/dev/null || echo "  (none)"

    echo ""
    echo "=== Test complete ==="
}
trap cleanup EXIT

"${DAEMON_BIN}" -c "${TEST_CONFIG}" &
DAEMON_PID=$!
echo "  Daemon PID: ${DAEMON_PID}"

# Wait for daemon to initialize and create SHM files
sleep 1

# Check SHM files exist
echo ""
echo "--- SHM files ---"
ls -la "${SHM_DIR}"/ 2>/dev/null || echo "  (waiting for SHM creation...)"

# ---- Optional: Run SHM reader ----
if [ "$WITH_READER" = true ]; then
    echo ""
    echo "--- Starting SHM reader on main stream ---"
    SHM_FILE="${SHM_DIR}/main.raw"
    if [ -f "${SHM_FILE}" ]; then
        "${BUILD_DIR}/shm_reader" "${SHM_FILE}" -n 30 -s &
        READER_PID=$!
        echo "  Reader PID: ${READER_PID}"
    else
        echo "  WARNING: ${SHM_FILE} not found, skipping reader"
    fi
fi

# Wait for test duration
echo ""
echo "--- Running for ${DURATION}s (Ctrl+C to stop early) ---"
sleep "${DURATION}"

echo ""
echo "--- Sending SIGTERM to daemon ---"
kill -SIGTERM "${DAEMON_PID}" 2>/dev/null || true
wait "${DAEMON_PID}" 2>/dev/null || true
DAEMON_PID=""

echo ""
echo "--- Final SHM state ---"
for f in "${SHM_DIR}"/*.raw; do
    if [ -f "$f" ]; then
        SIZE=$(stat -c%s "$f" 2>/dev/null || echo "?")
        echo "  $f  (${SIZE} bytes)"
    fi
done
