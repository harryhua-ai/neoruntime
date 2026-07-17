#!/usr/bin/env bash
# Wrapper: deploy HAL v2 (see hal_v2/scripts for usage).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/../hal_v2/scripts/deploy_hal_v2_to_hailo.sh" "$@"
