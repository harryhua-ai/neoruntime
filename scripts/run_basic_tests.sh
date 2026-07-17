#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

required_dirs=(
  hal_v2
  platform
  platform/ai-runtime
  platform/event-bus
  platform/device-control
  platform/app-manager
  platform/platform-api
  configs
  scripts
  tests
)

for path in "${required_dirs[@]}"; do
  test -d "$path" || { echo "Missing directory: $path" >&2; exit 1; }
done

required_files=(
  go.mod
  Makefile
  platform/ai-runtime/proto/inference.proto
  platform/event-bus/proto/event.proto
  platform/device-control/proto/device.proto
  platform/app-manager/proto/app.proto
)

for path in "${required_files[@]}"; do
  test -f "$path" || { echo "Missing file: $path" >&2; exit 1; }
done

go test ./tests/unit
echo "Basic checks passed."
