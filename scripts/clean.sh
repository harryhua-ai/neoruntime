#!/bin/bash
# Clean build artifacts and temporary files

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo "=========================================="
echo "AIPC Platform - Clean Build Artifacts"
echo "=========================================="
echo ""

# Clean build directories
echo -e "${YELLOW}Cleaning build directories...${NC}"
rm -rf build/output/*
rm -rf build/output/hal/*
rm -rf hal/build/*
rm -rf platform/*/build/*
rm -rf platform/camera-daemon/build/*
echo -e "${GREEN}✓${NC} Build directories cleaned"

# Clean Go build cache
echo -e "${YELLOW}Cleaning Go build cache...${NC}"
echo -e "${YELLOW}⚠ This clears ALL Go module/test caches (affects other projects)${NC}"
echo -e "${YELLOW}  Use 'make clean' for a safer, project-only clean${NC}"
go clean -cache -modcache -testcache 2>/dev/null || true
echo -e "${GREEN}✓${NC} Go cache cleaned"

# Clean protobuf generated files
echo -e "${YELLOW}Cleaning generated protobuf files...${NC}"
find platform -name "*.pb.go" -delete 2>/dev/null || true
find platform -name "*_grpc.pb.go" -delete 2>/dev/null || true
echo -e "${GREEN}✓${NC} Protobuf files cleaned"

# Clean test artifacts
echo -e "${YELLOW}Cleaning test artifacts...${NC}"
rm -rf tests/unit/*.o
rm -rf tests/unit/*_test
rm -rf tests/integration/*.test
rm -rf coverage.out coverage.html
echo -e "${GREEN}✓${NC} Test artifacts cleaned"

# Clean temporary files
echo -e "${YELLOW}Cleaning temporary files...${NC}"
find . -name "*.swp" -delete 2>/dev/null || true
find . -name "*.swo" -delete 2>/dev/null || true
find . -name "*~" -delete 2>/dev/null || true
find . -name ".DS_Store" -delete 2>/dev/null || true
echo -e "${GREEN}✓${NC} Temporary files cleaned"

echo ""
echo "=========================================="
echo -e "${GREEN}Clean complete!${NC}"
echo "=========================================="
echo ""
echo "To rebuild:"
echo "  make layer2"
echo ""

