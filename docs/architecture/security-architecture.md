# Security Architecture

## Overview

The AIPC platform employs a multi-layered security architecture, providing defense in depth from hardware to application layer. Core principles: least privilege, access path convergence, explicit authorization.

## Security Layers

```
┌──────────────────────────────────────┐
│     Application Container Layer      │
│  Namespace / Seccomp / Capabilities  │
│  Cgroup / ReadOnly Rootfs            │
└────────────┬─────────────────────────┘
             │ gRPC over Unix Socket
┌────────────┴─────────────────────────┐
│     Platform Services Layer          │
│  Authentication / Permission Convergence │
└────────────┬─────────────────────────┘
             │ HAL C API
┌────────────┴─────────────────────────┐
│     Hardware Layer                   │
│  TrustZone / Secure Boot             │
└──────────────────────────────────────┘
```

## Container Isolation

### Linux Namespaces

All application containers have 5 namespaces enabled by default:

| Namespace | Isolation Scope | Effect |
|-----------|----------------|--------|
| PID | Process IDs | Container processes cannot see host processes |
| NET | Network stack | No network by default (`none` mode) |
| IPC | System V IPC / POSIX message queues | IPC isolation between processes |
| UTS | Hostname and domain name | Container has independent hostname |
| MOUNT | Filesystem mounts | Independent filesystem view |

### Capabilities

All dangerous Linux capabilities are removed by default:

```
CAP_SYS_ADMIN     # System administration
CAP_NET_ADMIN     # Network administration
CAP_SYS_MODULE    # Kernel modules
CAP_SYS_TIME      # System time
CAP_SYS_BOOT      # Reboot
CAP_SYS_RAWIO     # Raw I/O
CAP_SYS_PTRACE    # Process tracing
CAP_SYS_CHROOT    # chroot
CAP_MKNOD         # Device node creation
```

### Seccomp BPF

System calls are restricted through seccomp filters:
- Default profile: `/etc/aipc/seccomp-default.json`
- Allowlist mode: only safe system calls are permitted
- Supports custom profiles (specified in manifest)
- Profile format validation at startup

### Cgroups Resource Limits

```yaml
resources:
  default_cpu_quota: 50       # 50% of one core
  default_memory_mb: 256      # 256MB
  default_pids_limit: 128     # Maximum process count
```

### Filesystem

- **Read-only rootfs**: Containers cannot modify system files
- **No New Privileges**: Privilege escalation is prohibited
- **Explicit mounts**: Only declared directories are mounted into the container

## Access Path Convergence

All resource access must go through platform services; containers cannot directly access hardware:

```
Video streams -> media-gateway SHM
AI inference -> ai-runtime gRPC
Peripheral control -> device-control gRPC
Event messages -> event-bus gRPC
```

### Unix Socket Permissions

- Service sockets are located at `/run/aipc/*.sock`
- Access is controlled through Linux groups (AIPC group)
- GID is automatically injected at container startup (Main container only)
- Sub containers cannot access any sockets by default

## Manifest Declarative Permissions

Applications declare required permissions through the `permissions` field in `app.yaml`:

```yaml
permissions:
  video: [cam0_main.raw]           # Video stream access
  inference:
    models: [person_v1]             # Available models
    max_qps: 30
  events:
    publish: [app/myapp/*]          # Publishable topics
    subscribe: [model/*/detections] # Subscribable topics
  device:
    light: true
    ptz: false
  network:
    outbound: [https://api.example.com]
```

Undeclared permissions are inaccessible by default.

## Network Security

### Container Networking

- Default `none` mode: no network access
- Optional bridge mode: through `aipc-br0` bridge
- DNS server: configurable (default 8.8.8.8)
- Outbound allowlist: only addresses declared in manifest are permitted

### API Authentication

Platform API supports optional Bearer Token authentication:
- JWT Token with secret key configured in `platform-api.yaml`
- Public endpoints: `/api/login`, `/api/v1/system/health`
- WebSocket passes token via query parameter

## Security Configuration Files

| File | Purpose |
|------|---------|
| `configs/security/seccomp-default.json` | Default Seccomp Profile |
| `configs/platform/app-manager.yaml` | Container security configuration |
| `configs/platform-api.yaml` | API authentication configuration |
| `configs/platform/event-bus.yaml` | Topic ACL configuration |

## Auditing and Monitoring

- All API calls are logged
- Container resource usage monitoring
- Event logging system (operations, security, alerts, system)
- Automatic circuit breaking: health check failures trigger automatic restart (with backoff strategy)

## Multi-Container Security

Security boundaries for the Main/Sub container architecture:

- **Main Container**: Granted platform socket access (AIPC group GID)
- **Sub Containers**: Fully isolated, no platform service access
- Shared network namespace is used for internal communication only
- Security configuration is role-based (Main vs Sub)
