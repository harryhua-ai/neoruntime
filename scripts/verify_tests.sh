#!/bin/bash
# AIPC Platform - Comprehensive Test Verification Script
# Tests build, unit tests, integration, and service functionality

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test results
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

test_pass() {
    echo -e "${GREEN}✓${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

test_fail() {
    echo -e "${RED}✗${NC} $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

test_skip() {
    echo -e "${YELLOW}⊘${NC} $1 (skipped)"
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
}

test_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

echo "=========================================="
echo "AIPC Platform - Test Verification"
echo "=========================================="
echo ""

# ============================================
# Phase 1: Build Verification
# ============================================
echo -e "${BLUE}[Phase 1] Build Verification${NC}"
echo ""

# Check Go installation
if command -v go &> /dev/null; then
    GO_VERSION=$(go version | awk '{print $3}')
    test_pass "Go installed: $GO_VERSION"
else
    test_fail "Go not installed"
    exit 1
fi

# Check protoc
if command -v protoc &> /dev/null; then
    PROTOC_VERSION=$(protoc --version | awk '{print $2}')
    test_pass "protoc installed: $PROTOC_VERSION"
else
    test_fail "protoc not installed"
    test_info "Install: sudo apt-get install protobuf-compiler"
fi

# Check if protobuf Go plugins are available
if command -v protoc-gen-go &> /dev/null; then
    test_pass "protoc-gen-go available"
else
    test_fail "protoc-gen-go not found"
    test_info "Install: go install google.golang.org/protobuf/cmd/protoc-gen-go@latest"
fi

if command -v protoc-gen-go-grpc &> /dev/null; then
    test_pass "protoc-gen-go-grpc available"
else
    test_fail "protoc-gen-go-grpc not found"
    test_info "Install: go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest"
fi

# Check build outputs
echo ""
echo "Checking build outputs..."
BUILD_DIR="build/output"
if [ ! -d "$BUILD_DIR" ]; then
    test_info "Build directory not found, running build..."
    make layer2 || test_fail "Build failed"
fi

SERVICES=("event-bus" "device-control" "ai-runtime" "app-manager" "platform-api")
for service in "${SERVICES[@]}"; do
    if [ -f "$BUILD_DIR/$service" ]; then
        test_pass "$service binary exists"
    else
        test_fail "$service binary not found"
        test_info "Run: make layer2"
    fi
done

if [ -f "$BUILD_DIR/camera-daemon" ]; then
    test_pass "camera-daemon binary exists"
else
    test_fail "camera-daemon binary not found"
fi

echo ""

# ============================================
# Phase 2: Code Quality Checks
# ============================================
echo -e "${BLUE}[Phase 2] Code Quality Checks${NC}"
echo ""

# Check Go module
if [ -f "go.mod" ]; then
    test_pass "go.mod exists"
    go mod verify && test_pass "go.mod verified" || test_fail "go.mod verification failed"
else
    test_fail "go.mod not found"
fi

# Check for common issues
if go vet ./... 2>&1 | grep -q .; then
    test_info "go vet found issues (check output above)"
else
    test_pass "go vet passed"
fi

# Check for fmt issues
FMT_ISSUES=$(gofmt -l . 2>/dev/null | wc -l)
if [ "$FMT_ISSUES" -eq 0 ]; then
    test_pass "gofmt check passed"
else
    test_fail "gofmt found $FMT_ISSUES files with formatting issues"
    test_info "Run: gofmt -w ."
fi

echo ""

# ============================================
# Phase 3: Unit Tests
# ============================================
echo -e "${BLUE}[Phase 3] Unit Tests${NC}"
echo ""

# Test common utilities
if [ -d "platform/common" ]; then
    echo "  Testing common utilities..."
    cd platform/common
    if go test -v ./... 2>&1 | tail -1 | grep -q "PASS"; then
        test_pass "Common utilities unit tests"
    else
        test_fail "Common utilities unit tests failed"
    fi
    cd "$PROJECT_ROOT"
fi

# Test AI Runtime core
if [ -d "platform/ai-runtime/core" ]; then
    echo "  Testing AI Runtime core..."
    cd platform/ai-runtime/core
    if go test -v ./... 2>&1 | tail -1 | grep -q "PASS"; then
        test_pass "AI Runtime core unit tests"
    else
        test_fail "AI Runtime core unit tests failed"
    fi
    cd "$PROJECT_ROOT"
fi

# Test App Manager modules
if [ -d "platform/app-manager" ]; then
    echo "  Testing App Manager modules..."
    cd platform/app-manager
    if find . -name "*_test.go" | grep -q .; then
        if go test -v ./... 2>&1 | tail -1 | grep -q "PASS"; then
            test_pass "App Manager unit tests"
        else
            test_fail "App Manager unit tests failed"
        fi
    else
        test_skip "App Manager unit tests (no test files)"
    fi
    cd "$PROJECT_ROOT"
fi

# Test Event Bus
if [ -f "platform/event-bus/server/main_test.go" ]; then
    echo "  Testing Event Bus..."
    cd platform/event-bus/server
    if go test -v . 2>&1 | tail -1 | grep -q "PASS"; then
        test_pass "Event Bus unit tests"
    else
        test_fail "Event Bus unit tests failed"
    fi
    cd "$PROJECT_ROOT"
fi

echo ""

# ============================================
# Phase 4: Integration Test Preparation
# ============================================
echo -e "${BLUE}[Phase 4] Integration Test Preparation${NC}"
echo ""

# Check HAL stub library
HAL_STUB="/opt/aipc/lib/hal/libhal-stub.so"
if [ -f "$HAL_STUB" ]; then
    test_pass "HAL stub library found"
else
    test_skip "HAL stub library not found (optional for unit tests)"
    test_info "Build HAL stub: cd hal/build && cmake .. && make && sudo make install"
fi

# Check runtime directories
RUN_DIR="/run/aipc"
if [ -d "$RUN_DIR" ] && [ -w "$RUN_DIR" ]; then
    test_pass "Runtime directory writable"
else
    test_info "Creating runtime directories..."
    sudo mkdir -p "$RUN_DIR"/{shm,sockets} 2>/dev/null || true
    sudo chmod 777 "$RUN_DIR"/{shm,sockets} 2>/dev/null || true
    if [ -w "$RUN_DIR/shm" ]; then
        test_pass "Runtime directories created"
    else
        test_fail "Cannot create runtime directories"
    fi
fi

# Check configuration files
CONFIG_DIR="configs"
# Check in subdirectories
if [ -f "$CONFIG_DIR/ai/ai-runtime.yaml" ] || [ -f "$CONFIG_DIR/platform/ai-runtime.yaml" ]; then
    test_pass "Config file exists: ai-runtime.yaml"
else
    test_fail "Config file missing: ai-runtime.yaml"
fi

if [ -f "$CONFIG_DIR/platform/event-bus.yaml" ]; then
    test_pass "Config file exists: event-bus.yaml"
else
    test_fail "Config file missing: event-bus.yaml"
fi

if [ -f "$CONFIG_DIR/platform/device-control.yaml" ]; then
    test_pass "Config file exists: device-control.yaml"
else
    test_fail "Config file missing: device-control.yaml"
fi

if [ -f "$CONFIG_DIR/platform/app-manager.yaml" ]; then
    test_pass "Config file exists: app-manager.yaml"
else
    test_fail "Config file missing: app-manager.yaml"
fi

if [ -f "$CONFIG_DIR/platform-api.yaml" ]; then
    test_pass "Config file exists: platform-api.yaml"
else
    test_fail "Config file missing: platform-api.yaml"
fi

echo ""

# ============================================
# Phase 5: Service Compilation Check
# ============================================
echo -e "${BLUE}[Phase 5] Service Compilation Check${NC}"
echo ""

# Try to compile each service
for service in "${SERVICES[@]}"; do
    SERVICE_DIR="platform/$service"
    if [ -d "$SERVICE_DIR" ]; then
        echo "  Checking $service compilation..."
        cd "$SERVICE_DIR"
        if go build -o /tmp/test_$service ./... 2>&1; then
            test_pass "$service compiles successfully"
            rm -f /tmp/test_$service
        else
            test_fail "$service compilation failed"
        fi
        cd "$PROJECT_ROOT"
    fi
done

echo ""

# ============================================
# Phase 6: Protobuf Compilation
# ============================================
echo -e "${BLUE}[Phase 6] Protobuf Compilation${NC}"
echo ""

# Check if proto files compile
PROTO_DIRS=("platform/ai-runtime/proto" "platform/event-bus/proto" "platform/device-control/proto" "platform/app-manager/proto")
for proto_dir in "${PROTO_DIRS[@]}"; do
    if [ -d "$proto_dir" ]; then
        PROTO_FILES=$(find "$proto_dir" -name "*.proto" 2>/dev/null | wc -l)
        if [ "$PROTO_FILES" -gt 0 ]; then
            test_pass "Proto files found in $(basename $proto_dir)"
        fi
    fi
done

# Try compiling protos
if ./scripts/compile_proto.sh 2>&1 | grep -q "Success\|Complete"; then
    test_pass "Protobuf compilation successful"
else
    test_fail "Protobuf compilation failed"
fi

echo ""

# ============================================
# Summary
# ============================================
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "${GREEN}Passed:${NC} $TESTS_PASSED"
echo -e "${RED}Failed:${NC} $TESTS_FAILED"
echo -e "${YELLOW}Skipped:${NC} $TESTS_SKIPPED"
echo ""

TOTAL=$((TESTS_PASSED + TESTS_FAILED + TESTS_SKIPPED))
if [ $TOTAL -gt 0 ]; then
    PASS_RATE=$((TESTS_PASSED * 100 / TOTAL))
    echo "Pass Rate: ${PASS_RATE}%"
fi

echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All critical tests passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Run integration tests: cd tests/integration && go test -v ./..."
    echo "  2. Start services: ./scripts/start_mvp.sh"
    echo "  3. Test services: ./scripts/test_mvp.sh"
    exit 0
else
    echo -e "${RED}✗ Some tests failed. Please review the errors above.${NC}"
    exit 1
fi

