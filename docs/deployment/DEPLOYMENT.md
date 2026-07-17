# Cross-Platform Deployment Guide

## Overview

The `build/output/` directory contains compiled binaries that can be deployed directly to the target platform. Before deployment, ensure the target platform architecture matches the build artifacts.

## Current Build Artifacts

```bash
build/output/
├── ai-runtime          # AI inference service (Go)
├── app-manager         # Application management service (Go)
├── device-control      # Device control service (Go)
├── event-bus           # Event bus service (Go)
├── platform-api        # Platform API gateway (Go)
└── hal/                # HAL libraries (C++)
    └── libhal-*.so
```

## Architecture Check

### Check Current Build Artifact Architecture

```bash
# Check binary architecture
file build/output/ai-runtime

# Example output:
# ELF 64-bit LSB executable, x86-64  # x86_64 architecture
# ELF 64-bit LSB executable, ARM aarch64  # ARM64 architecture
```

### Check Target Platform Architecture

```bash
# Execute on target platform
uname -m
# Output: x86_64 or aarch64 or armv7l
```

**Important:** The build artifact architecture must match the target platform architecture.

## Cross-Platform Build

### Go Service Cross-Compilation

Go services support cross-compilation without building on the target platform:

```bash
# ARM64 (common embedded platform)
export GOOS=linux
export GOARCH=arm64
make platform

# ARMv7 (32-bit ARM)
export GOOS=linux
export GOARCH=arm
export GOARM=7
make platform

# x86_64 (default)
export GOOS=linux
export GOARCH=amd64
make platform
```

### C++ Component Cross-Compilation

C++ components (camera-daemon, HAL libraries) require a cross-compilation toolchain:

```bash
# Install cross-compilation toolchain (ARM64 example)
sudo apt-get install gcc-aarch64-linux-gnu g++-aarch64-linux-gnu

# Cross-compile camera-daemon
cd platform/camera-daemon
mkdir -p build && cd build
cmake .. \
  -DCMAKE_SYSTEM_NAME=Linux \
  -DCMAKE_SYSTEM_PROCESSOR=aarch64 \
  -DCMAKE_C_COMPILER=aarch64-linux-gnu-gcc \
  -DCMAKE_CXX_COMPILER=aarch64-linux-gnu-g++
make -j$(nproc)
```

## Deployment Methods

### Method 1: Using Deployment Script (Recommended)

```bash
# Deploy to target device
./scripts/deploy.sh <target-ip> [username]

# Example
./scripts/deploy.sh 192.168.1.100 root
```

The script automatically:
- Checks SSH connection
- Creates directory structure
- Transfers binary files
- Deploys configuration files
- Installs systemd services

### Method 2: Manual Deployment

#### Step 1: Prepare Deployment Package

```bash
# Create deployment directory
mkdir -p deploy/aipc/{bin,lib/hal,etc,logs}

# Copy binary files
cp build/output/* deploy/aipc/bin/
cp build/output/hal/*.so deploy/aipc/lib/hal/ 2>/dev/null || true

# Copy configuration files
cp -r configs/* deploy/aipc/etc/

# Package
cd deploy
tar czf aipc-platform.tar.gz aipc/
```

#### Step 2: Transfer to Target Platform

```bash
# Using scp
scp deploy/aipc-platform.tar.gz user@target:/tmp/

# Or using rsync (incremental sync)
rsync -avz build/output/ user@target:/opt/aipc/bin/
```

#### Step 3: Install on Target Platform

```bash
# SSH to target platform
ssh user@target

# Extract
cd /tmp
tar xzf aipc-platform.tar.gz -C /opt/

# Set permissions
chmod +x /opt/aipc/bin/*
chmod 644 /opt/aipc/etc/*.yaml

# Create runtime directories
mkdir -p /run/aipc/{shm,sockets}
mkdir -p /opt/aipc/logs
```

### Method 3: Using Docker Container

```bash
# Build image containing all artifacts
docker build -t aipc-platform:latest -f Dockerfile.deploy .

# Run on target platform
docker run -d \
  --name aipc-platform \
  --privileged \
  -v /opt/aipc/etc:/opt/aipc/etc \
  -v /opt/aipc/logs:/opt/aipc/logs \
  aipc-platform:latest
```

## Dependency Check

### Runtime Dependencies

The target platform requires the following dependencies:

#### Go Binary Dependencies

```bash
# Check dynamic libraries
ldd build/output/ai-runtime

# Common dependencies:
# - libc.so.6 (glibc)
# - libpthread.so.0
```

**Static Compilation (Recommended):**

```bash
# Add static compilation flags in Makefile
GO_BUILD_FLAGS := -v -ldflags '-linkmode external -extldflags "-static"'

# Or use CGO_ENABLED=0 (pure Go code)
CGO_ENABLED=0 go build -o build/output/ai-runtime ./platform/ai-runtime/server
```

#### C++ Binary Dependencies

```bash
# Check dependencies
ldd build/output/camera-daemon

# May need:
# - libstdc++.so.6
# - libgcc_s.so.1
# - libc.so.6
```

### System Service Dependencies

```bash
# containerd (required by app-manager)
systemctl status containerd

# If not installed
# Ubuntu/Debian:
sudo apt-get install containerd

# Or use the project-provided containerd configuration
```

## Configuration File Adaptation

When deploying to different platforms, configuration files need to be modified:

### 1. Network Configuration

```yaml
# configs/platform/platform-api.yaml
service:
  listen: "0.0.0.0:8080"  # Adjust based on target platform network
```

### 2. Path Configuration

```yaml
# configs/platform/app-manager.yaml
apps:
  registry_path: /opt/aipc/apps/registry
  instances_path: /opt/aipc/apps/instances
  manifests_path: /etc/aipc/apps
```

### 3. Socket Paths

```yaml
# Ensure socket directory exists and has write permissions
service:
  listen: unix:///run/aipc/app-manager.sock
```

## Verify Deployment

### 1. Check Binary Files

```bash
# Execute on target platform
file /opt/aipc/bin/ai-runtime
ldd /opt/aipc/bin/ai-runtime
```

### 2. Test Service Startup

```bash
# Manual startup test
/opt/aipc/bin/ai-runtime -config /opt/aipc/etc/ai/ai-runtime.yaml

# Check logs
tail -f /opt/aipc/logs/ai-runtime.log
```

### 3. Check Service Status

```bash
# If using systemd
systemctl status aipc-ai-runtime
systemctl status aipc-platform.target

# View all services
systemctl list-units 'aipc-*'
```

## Common Issues

### Issue 1: "exec format error"

**Cause:** Architecture mismatch

**Solution:** Re-cross-compile to match target architecture

```bash
export GOOS=linux GOARCH=arm64
make platform
```

### Issue 2: "No such file or directory"

**Cause:** Missing dynamic libraries

**Solution:**
- Use static compilation, or
- Install missing libraries on the target platform

```bash
# Check missing libraries
ldd /opt/aipc/bin/ai-runtime | grep "not found"
```

### Issue 3: "Permission denied"

**Cause:** File permission issue

**Solution:**
```bash
chmod +x /opt/aipc/bin/*
```

### Issue 4: Socket Creation Failure

**Cause:** Directory does not exist or insufficient permissions

**Solution:**
```bash
mkdir -p /run/aipc/sockets
chmod 777 /run/aipc/sockets  # Or use appropriate permissions
```

## Quick Deployment Checklist

- [ ] Check target platform architecture (`uname -m`)
- [ ] Cross-compile binaries matching the architecture
- [ ] Check runtime dependencies (`ldd`)
- [ ] Prepare configuration files and adapt paths
- [ ] Create necessary directory structure
- [ ] Set correct file permissions
- [ ] Test service startup
- [ ] Configure systemd services (if needed)

## Automated Deployment Script Example

```bash
#!/bin/bash
# deploy-to-target.sh

TARGET=$1
ARCH=$(ssh $TARGET "uname -m")

echo "Target architecture: $ARCH"

# Cross-compile
export GOOS=linux
case $ARCH in
  aarch64) export GOARCH=arm64 ;;
  armv7l) export GOARCH=arm GOARM=7 ;;
  x86_64) export GOARCH=amd64 ;;
esac

make clean
make platform

# Deploy
./scripts/deploy.sh $TARGET
```

Usage:
```bash
./deploy-to-target.sh user@192.168.1.100
```