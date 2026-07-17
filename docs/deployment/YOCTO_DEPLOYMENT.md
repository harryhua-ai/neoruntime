# Yocto Deployment Guide

This document describes how to build and deploy AIPC Platform in a Yocto environment.

## Quick Start

### 1. Local Cross-Compilation (Development/Testing)

```bash
# Build arm64 version
./scripts/build_multi_platform.sh PLATFORMS=linux/arm64

# Or use Makefile
make multi-platform PLATFORMS=linux/arm64

# Artifact location
ls -la build/output/linux_arm64/
```

### 2. Install to Yocto rootfs

```bash
# Method 1: Using install script (recommended)
./scripts/install_to_yocto.sh /path/to/yocto/rootfs linux_arm64

# Method 2: Manual installation
cp -r build/output/linux_arm64/opt/aipc/* /path/to/yocto/rootfs/opt/aipc/
cp systemd/*.service /path/to/yocto/rootfs/etc/systemd/system/
```

### 3. Yocto Recipe Integration (Production)

Refer to `yocto/README.md` and `yocto/aipc-platform.bb`.

## Build Process

### Multi-Platform Build

```bash
# Build all platforms
make multi-platform PLATFORMS=linux/amd64,linux/arm64

# Build arm64 only (Hailo devices)
make multi-platform PLATFORMS=linux/arm64

# Artifact structure
build/output/
├── linux_amd64/
│   ├── opt/aipc/bin/     # All binary files
│   ├── opt/aipc/etc/     # Configuration files
│   ├── opt/aipc/lib/     # Library files
│   └── etc/systemd/system/ # systemd services (optional)
├── linux_arm64/
│   └── ...
└── aipc-platform-*.tar.gz  # Packaged files
```

### Cross-Compilation Requirements

**Go Services** (no additional tools required):
- Go 1.21+
- Set `GOOS` and `GOARCH` environment variables

**C/C++ Components** (cross-compiler required):
```bash
# Ubuntu/Debian
sudo apt-get install gcc-aarch64-linux-gnu g++-aarch64-linux-gnu

# Verify
aarch64-linux-gnu-gcc --version
```

## Deploy to Device

### Method 1: Direct Installation to rootfs

```bash
# 1. Build
./scripts/build_multi_platform.sh PLATFORMS=linux/arm64

# 2. Install
./scripts/install_to_yocto.sh /path/to/rootfs linux_arm64

# 3. Enable services on device
systemctl enable ai-runtime.service
systemctl enable app-manager.service
systemctl enable device-control.service
systemctl enable event-bus.service
systemctl enable platform-api.service
```

### Method 2: Using Yocto Recipe

1. Add `yocto/aipc-platform.bb` to your layer
2. Add `IMAGE_INSTALL += "aipc-platform"` to your image recipe
3. Build image: `bitbake <your-image>`

### Method 3: Using tar Package

```bash
# 1. Build and package
./scripts/build_multi_platform.sh PLATFORMS=linux/arm64

# 2. Transfer to device
scp build/output/aipc-platform-linux_arm64.tar.gz device:/tmp/

# 3. Extract on device
ssh device "cd / && sudo tar -xzf /tmp/aipc-platform-linux_arm64.tar.gz"

# 4. Enable services
ssh device "sudo systemctl enable ai-runtime.service && ..."
```

## Service Configuration

### Service Dependencies

```
event-bus (starts first)
    |
ai-runtime (depends on event-bus)
    |
app-manager (depends on ai-runtime + event-bus)
    |
platform-api (depends on all services)
```

device-control and camera-daemon can be started independently.

### Configuration File Locations

All configuration files are located at `/etc/aipc/`:
- `ai-runtime.yaml`
- `app-manager.yaml`
- `device-control.yaml`
- `event-bus.yaml`
- `platform-api.yaml`

### Runtime Directories

- `/opt/aipc/logs/` - Log files
- `/opt/aipc/apps/registry/` - Application registry
- `/opt/aipc/apps/instances/` - Running application instances
- `/run/aipc/` - Unix socket files

## Verify Deployment

### 1. Check Service Status

```bash
systemctl status ai-runtime.service
systemctl status app-manager.service
systemctl status device-control.service
systemctl status event-bus.service
systemctl status platform-api.service
```

### 2. Check Logs

```bash
journalctl -u ai-runtime.service -f
journalctl -u app-manager.service -f
```

### 3. Test API

```bash
# Platform API should listen on the configured port (default may vary)
curl http://localhost:8080/api/health

# Or use CLI
/usr/bin/aipc-cli status
```

### 4. Check Processes

```bash
ps aux | grep -E "ai-runtime|app-manager|device-control|event-bus|platform-api"
```

## Common Issues

### Q: Service Fails to Start

**A:** Check:
1. Is containerd running: `systemctl status containerd`
2. Do configuration files exist: `ls -la /etc/aipc/*.yaml`
3. Logs: `journalctl -u <service-name> -n 50`

### Q: Cross-Compilation of C/C++ Fails

**A:**
1. Install cross-compiler: `sudo apt-get install gcc-aarch64-linux-gnu g++-aarch64-linux-gnu`
2. Or use the toolchain from the Yocto SDK

### Q: Go Service Cannot Find Dependencies

**A:**
1. Ensure `go.mod` exists and dependencies are downloaded
2. Check `GOPROXY` and network connection
3. Use `go mod download` to manually download

### Q: systemd Service Cannot Find Binary

**A:**
1. Check binary path: service files use `/usr/bin/<service-name>`
2. Ensure the install script correctly copied files
3. Verify permissions: `ls -la /usr/bin/ai-runtime`

## Next Steps

- Configure hardware-specific settings (HAL, device nodes, etc.)
- Adjust resource limits (MemoryLimit, CPUQuota in systemd service files)
- Configure log rotation
- Set up monitoring and alerting