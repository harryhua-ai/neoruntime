#!/bin/bash
# Build the NE503 dev Docker image (no SDK baked in — mount at runtime).
#
# Usage:
#   ./build.sh                                   # default image name
#   ./build.sh org/ne503-dev-env                 # custom image name
#
# At runtime, mount the SDK:
#   docker run -it -v /opt/poky/4.0.23:/opt/hailo-sdk ne503-dev-env

set -e

IMAGE_NAME="${1:-ne503-dev-env:latest}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Building dev image (SDK mounted at runtime, not included)"
docker build \
    -f "$SCRIPT_DIR/Dockerfile.dev" \
    -t "$IMAGE_NAME" \
    "$SCRIPT_DIR"

echo ""
echo "==> Image built: $IMAGE_NAME"
echo "==> Push to Docker Hub:"
echo "    docker push $IMAGE_NAME"
echo ""
echo "==> User workflow:"
echo "    docker pull $IMAGE_NAME"
echo "    docker run -it -v /opt/poky/4.0.23:/opt/hailo-sdk $IMAGE_NAME"
echo "    # Inside: git clone <repo> ~/ne503 && cd ~/ne503 && make pack-release VERSION=1.0.0"
