# NE503 Build Guide

## Quick Start

```bash
# Check dependencies
make env-check

# Build all Go services + web + SDK (no hardware needed)
make layer1

# Build everything for native Linux (stub HAL + camera-daemon)
make layer2
```

## Build Layers

| Layer | What | Requirements | Command |
|-------|------|-------------|---------|
| 1 | Go services, web, SDK | Go, Node, protoc | `make layer1` |
| 2 | + stub HAL, camera-daemon | + cmake, g++, gRPC | `make layer2` |
| 3 | Hailo-15 cross-compile | + Hailo SDK 4.0.23 | manual |

## Environment Setup

### Automated (Ubuntu/macOS)

```bash
./scripts/setup_env.sh layer1    # Go + Node + protoc
./scripts/setup_env.sh layer2    # + cmake + g++ + gRPC
./scripts/setup_env.sh layer3    # + Hailo SDK instructions
```

### Manual — Ubuntu 22.04

```bash
# Layer 1
sudo apt install -y golang-go nodejs protobuf-compiler
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
export PATH="$PATH:$(go env GOPATH)/bin"

# Layer 2
sudo apt install -y build-essential cmake protobuf-compiler-grpc libgrpc++-dev libprotobuf-dev
```

### Manual — macOS

```bash
brew install go node protobuf cmake grpc
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
```

## Layer 1: Universal Build

No hardware dependencies. Works on any Linux/macOS.

| Tool | Min Version | Check |
|------|-------------|-------|
| Go | 1.25+ | `go version` |
| Node.js | 20+ | `node --version` |
| protoc | 3.12+ | `protoc --version` |
| protoc-gen-go | latest | `which protoc-gen-go` |
| protoc-gen-go-grpc | latest | `which protoc-gen-go-grpc` |
| Python | 3.8+ | `python3 --version` |

```bash
make layer1
# equivalent to: make proto platform web sdk-python
```

Output binaries in `build/output/`:
- `device-control`, `event-bus`, `app-manager`, `platform-api`, `device-discovery`
- `web/dist/` (web assets)

All Go services compile with `CGO_ENABLED=0` (pure Go, no C dependencies).

## Layer 2: Native C/C++ Build

Adds HAL stub library and camera-daemon built for the host architecture.

| Tool | Min Version | Check |
|------|-------------|-------|
| CMake | 3.16+ | `cmake --version` |
| GCC/G++ | 10+ (C++20) | `g++ --version` |
| gRPC C++ | 1.30+ | `which grpc_cpp_plugin` |

```bash
make layer2
# equivalent to: make layer1 hal-v2 camera-daemon
```

Additional output:
- `build/output/hal/stub/libaipc_hal*.so` (stub HAL)
- `build/output/camera-daemon` (native binary)

## Layer 3: Hailo-15 Cross-Compile

Requires Hailo Yocto Poky SDK for ARM cross-compilation.

### Prerequisites

- Hailo SDK 4.0.23 installed at `/opt/poky/4.0.23/`
- Available from Hailo developer portal

### Build Steps

```bash
# Source SDK environment (sets CC, CXX, CMAKE_TOOLCHAIN_FILE, etc.)
source /opt/poky/4.0.23/environment-setup-aarch64-poky-linux

# Verify cross-compiler
echo $CC   # should show: aarch64-poky-linux-gcc

# Build HAL v2 for Hailo-15
make hal-v2 PLATFORM=hailo15

# Cross-compile camera-daemon (uses cmake toolchain from SDK)
mkdir -p platform/camera-daemon/build && cd platform/camera-daemon/build
cmake -DCMAKE_TOOLCHAIN_FILE=$OECORE_TARGET_SYSROOT/../cmake/toolchain-file.cmake ..
make -j$(nproc)
```

### Deploy to Device

```bash
# HAL libraries
scp build/output/hal/hailo15/*.so root@192.0.2.72:/opt/aipc/lib/hal/

# Platform services (Go ARM64 binaries)
scp build/output/device-control build/output/event-bus \
    build/output/app-manager build/output/platform-api \
    root@192.0.2.72:/opt/aipc/bin/

# Camera daemon
scp build/output/camera-daemon root@192.0.2.72:/opt/aipc/bin/
```

## Individual Targets

```bash
make proto                  # Generate Go protobuf code
make platform               # Build all Go services
make platform-device-control # Build device-control only
make hal-v2                 # Build HAL v2 (PLATFORM=stub, default)
make hal-v2 PLATFORM=hailo15 # Build HAL v2 for Hailo-15
make camera-daemon          # Build camera-daemon (native)
make aipc-cli               # Build CLI tool
make tools                  # Build shm-reader, nv12-to-jpeg
make web                    # Build web console
make sdk-python             # Build Python SDK
make install                # Install to /opt/aipc
make clean                  # Clean build artifacts
make env-check              # Check build dependencies
make help                   # Show all targets
```

## Release Packaging

Build everything and produce a self-contained deployment tarball:

```bash
# Local stub release (for testing)
make pack
make pack VERSION=nx-1.0

# Hailo-15 full release (requires SDK)
make pack-release SDK_PATH=/opt/poky/4.0.23
make pack-release SDK_PATH=/opt/poky/4.0.23 VERSION=nx-1.0

# Legacy script (still works, delegates to Makefile)
./scripts/pack_release.sh --version nx-1.0
./scripts/pack_release.sh --sdk-path /opt/poky/4.0.23 --version nx-1.0
./scripts/pack_release.sh --skip-build --version nx-1.0   # repack only
```

Output: `build/release/aipc-<platform>-<version>.tar.gz`

### Tarball Contents

| Path | Contents |
|------|----------|
| `opt/aipc/bin/` | All binaries (services, CLI, tools) |
| `opt/aipc/lib/hal/` | HAL shared libraries |
| `opt/aipc/etc/` | Configuration files |
| `opt/aipc/web/` | Web console assets |
| `opt/aipc/models/` | HEF model files (if present) |
| `opt/aipc/swagger-ui/` | API documentation |
| `systemd/` | Systemd service units |
| `deploy.sh` | Hot-swap deployment script |
| `VERSION` | Version metadata |

### Deploy to Target

```bash
scp build/release/aipc-hailo15-nx-1.0.tar.gz root@192.0.2.72:/tmp/
ssh root@192.0.2.72
cd /tmp && tar xzf aipc-hailo15-nx-1.0.tar.gz
cd aipc-hailo15-nx-1.0 && ./deploy.sh

# Rollback
./deploy.sh --rollback
```

## CGo Status

All Go platform services build with `CGO_ENABLED=0`:

| Service | CGo | Notes |
|---------|-----|-------|
| device-control | No | CGo dlopen code behind build tag; gRPC lens client used instead |
| event-bus | No | Pure Go |
| platform-api | No | Pure Go |
| app-manager | No | Pure Go |

device-control has optional CGo code (dlopen/dlsym for lens HAL bridge) behind
`//go:build linux && cgo` tags. When CGo is disabled, a stub returns an error
and the gRPC lens client path is used instead.

## FAQ

### `protoc: not found`

```bash
sudo apt install protobuf-compiler
```

### `protoc-gen-go: not found`

```bash
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
export PATH="$PATH:$(go env GOPATH)/bin"
```

### `grpc_cpp_plugin: not found` (camera-daemon build)

```bash
sudo apt install protobuf-compiler-grpc libgrpc++-dev libprotobuf-dev
```

### camera-daemon cmake picks up wrong toolchain

```bash
rm -rf platform/camera-daemon/build
mkdir platform/camera-daemon/build && cd platform/camera-daemon/build
cmake ..  # fresh configure
```

### HAL v2 hailo15 build fails — SDK not found

```bash
source /opt/poky/4.0.23/environment-setup-aarch64-poky-linux
make hal-v2 PLATFORM=hailo15
```
