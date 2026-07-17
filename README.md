# NE503 AIPC

NE503 AIPC is the platform-core repository for CamThink's edge AI computing
stack. It provides the device services, hardware abstraction layer, management
API, and web console used by NE503-class smart cameras and edge boxes.

This repository is intentionally scoped to platform code. SDKs and sample
applications are published separately:

- `camthink-ai/ne503-aipc-sdks` - client SDKs and protocol copies
- `camthink-ai/ne503-aipc-apps` - sample applications and templates

## Architecture

```text
Application containers
  -> SDKs over gRPC, Unix sockets, and shared memory
Platform services
  -> platform-api, app-manager, event-bus, camera-daemon,
     ai-runtime, device-control, and discovery
Hardware abstraction
  -> HAL v2 media, codec, AI, board, and device interfaces
Hardware and vendor runtimes
  -> Hailo-15, RK3588, Jetson, or stub backends
```

## Repository Layout

| Path | Contents |
| ---- | -------- |
| `platform/` | Go and C++ platform services |
| `hal_v2/` | HAL v2 session-based C/C++ interfaces and backends |
| `web/` | React and TypeScript management console |
| `configs/` | Service configuration templates |
| `systemd/` | System service units |
| `scripts/` | Build, deployment, and maintenance scripts |
| `tools/` | CLI and diagnostics tools |
| `docs/` | Architecture, deployment, API, and development docs |
| `tests/` | Unit and integration test assets |

## Build

Build the open-source stub platform:

```bash
make all
```

Common targets:

```bash
make proto
make hal-v2 HAL_PLATFORM=stub
make platform
make camera-daemon
make ai-runtime
make aipc-cli
make web
make test
```

## Release Packaging

Build a native stub package for validation:

```bash
make pack VERSION=0.1.0
```

Build a Hailo-15 package with a local SDK:

```bash
make pack-release SDK_PATH=/opt/poky/4.0.23 VERSION=0.1.0
```

Build the same Hailo-15 package through the full Docker image:

```bash
make docker-pack-release VERSION=0.1.0
```

The release workflow in `.github/workflows/release.yml` uses
`zerobot/ne503-dev-env-full:4.0.23` and expects a self-hosted runner with the
labels `self-hosted`, `linux`, `x64`, and `docker`. The full image is large, so a
self-hosted runner is recommended over GitHub-hosted runners.

Hardware-specific builds may require a vendor SDK and target sysroot. Keep those
SDKs outside this repository and pass their paths through environment variables
or local, gitignored configuration.

## Configuration

Service configuration templates live in `configs/`. Runtime secrets are not
committed. For platform API authentication, set these values at deployment time:

```bash
export AIPC_TOKEN_KEY="<random-signing-secret>"
export AIPC_AUTH_USERNAME="admin"
export AIPC_AUTH_PASSWORD="<strong-password>"
```

## Related Repositories

- `camthink-ai/ne503-aipc-sdks`
- `camthink-ai/ne503-aipc-apps`

## License

This repository is licensed under the MIT License. See [LICENSE](./LICENSE).
