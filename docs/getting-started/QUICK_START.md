# AIPC Platform - Quick Start Guide

Get up and running with the AIPC Platform in minutes.

---

## Prerequisites

- **Go** 1.25+ ([Install](https://golang.org/dl/))
- **CMake** 3.16+ ([Install](https://cmake.org/download/))
- **protoc** 3.12+ ([Install](https://grpc.io/docs/protoc-installation/))
- **Python 3** 3.8+
- **Node.js** 20+ (for web console)
- **GCC/G++** 10+ (for C++ components)

**Windows users:** See [WINDOWS_SETUP.md](WINDOWS_SETUP.md) for detailed instructions.

---

## Quick Setup

### 1. Clone and Enter Project

```bash
cd /path/to/ne503
```

### 2. Build Everything

```bash
# Layer 1: Go services + web + SDK (no hardware needed)
make layer1

# Or build individual components
make proto          # Generate protobuf code
make platform       # Build all Go services
make web            # Build web console
make sdk-python     # Build Python SDK
```

### 3. Verify Build

```bash
./scripts/check_build.sh
ls -lh build/output/
```

You should see:
- `device-control`, `event-bus`, `app-manager`, `platform-api`
- `web/dist/` (web assets)

### 4. Build C++ Components (Optional)

```bash
# Layer 2: adds HAL stub + camera-daemon (requires cmake, g++, gRPC C++)
make layer2
```

---

## Deploy to Device

```bash
# Quick deploy
./scripts/deploy.sh <target-ip>

# Build release package
make pack VERSION=nx-1.0
```

---

## Start Services

```bash
# Using MVP scripts
./scripts/start_mvp.sh

# On device with systemd
sudo systemctl start aipc-platform

# Verify
sudo systemctl status aipc-platform
# Web Console: http://<device-ip>:8080
```

---

## Development Workflow

### Build Commands

```bash
make all              # Build everything
make layer1           # Go services + web + SDK
make layer2           # + HAL + camera-daemon
make proto            # Compile .proto files
make platform         # Build all Go services
make hal-v2           # Build HAL v2 (default: stub)
make hal-v2 HAL_PLATFORM=hailo15  # Build for Hailo-15
make camera-daemon    # Build camera-daemon
make web              # Build web console
make sdk-python       # Build Python SDK
make clean            # Clean build artifacts
```

### Test Commands

```bash
make test                        # Run all tests
./scripts/run_unit_tests.sh      # Unit tests
./scripts/test_mvp.sh            # Integration tests
go test ./platform/...           # Go tests only
```

---

## Troubleshooting

### "protoc: not found"

```bash
sudo apt install protobuf-compiler
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
export PATH="$PATH:$(go env GOPATH)/bin"
```

### Build Fails

```bash
make clean && make layer1
```

### Services Won't Start

```bash
ls -l /run/aipc/          # Check runtime directories
ls -l /opt/aipc/lib/hal/  # Check HAL library
journalctl -u "aipc-*" -f # Check logs
```

---

## Next Steps

1. [Build Guide](BUILD.md) - Detailed build instructions
2. [Architecture](architecture/README.md) - System architecture
3. [Developer Guide](DEVELOPER_GUIDE.md) - Development workflow
4. [App Development](APP_DEVELOPMENT_GUIDE.md) - App development guide
5. [HAL Porting Guide](hal/porting-guide.md) - Porting to new SoC

