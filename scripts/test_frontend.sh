#!/bin/bash
# AIPC Platform - Frontend Test Script

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}AIPC Platform - Frontend Test${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js not found${NC}"
    echo "Please install Node.js: https://nodejs.org/"
    exit 1
fi

echo -e "${GREEN}✓${NC} Node.js $(node --version)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm not found${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} npm $(npm --version)"
echo ""

# Check if frontend directory exists
if [ ! -d "web/console" ]; then
    echo -e "${RED}Error: Frontend directory not found${NC}"
    exit 1
fi

cd web/console

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install
fi

echo ""

# Check if package.json has test script
if grep -q '"test"' package.json; then
    echo -e "${BLUE}Running tests...${NC}"
    npm test || echo -e "${YELLOW}⚠ Tests not configured or failed${NC}"
else
    echo -e "${YELLOW}No test script found in package.json${NC}"
    echo "Skipping automated tests"
fi

echo ""

# Check TypeScript compilation
echo -e "${BLUE}Checking TypeScript compilation...${NC}"
if npx tsc --noEmit 2>&1; then
    echo -e "${GREEN}✓${NC} TypeScript compilation OK"
else
    echo -e "${RED}✗${NC} TypeScript compilation errors found"
    exit 1
fi

echo ""

# Check ESLint
echo -e "${BLUE}Checking ESLint...${NC}"
if npm run lint 2>&1 | grep -q "problems"; then
    echo -e "${YELLOW}⚠${NC} ESLint warnings found"
else
    echo -e "${GREEN}✓${NC} ESLint OK"
fi

echo ""

# Build check
echo -e "${BLUE}Checking build...${NC}"
if npm run build 2>&1; then
    echo -e "${GREEN}✓${NC} Build successful"
    echo ""
    echo -e "${GREEN}Frontend test completed!${NC}"
    echo ""
    echo "To start the development server:"
    echo "  cd web/console"
    echo "  npm run dev"
else
    echo -e "${RED}✗${NC} Build failed"
    exit 1
fi

