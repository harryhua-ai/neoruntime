# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

NE503 AIPC is CamThink's platform-core repository for edge AI computing. It
provides the device services, hardware abstraction layer (HAL v2), management
API, and web console used by NE503-class smart cameras and edge boxes. The Go
module path is `aipc`.

This repo is **platform code only**. Client SDKs live in `camthink-ai/ne503-aipc-sdks`
and sample applications in `camthink-ai/ne503-aipc-apps`.

Target platforms are **Linux** (Hailo-15, RK3588, Jetson). macOS works for the
Go core and web console only — see [Build platform notes](#build-platform-notes).

## Quick commands

```bash
make proto                # Generate Go protobuf packages (run first; Go services import them)
make platform             # Build the Go platform services
make aipc-cli             # Build the CLI (tools/aipc-cli -> build/output/aipc-cli)
make web                  # Build the web console (pnpm install + pnpm build)
make all                  # proto + hal-v2 + platform + ai-runtime + camera-daemon + aipc-cli (Linux)
make test                 # unit + integration
make test-unit            # ./platform/... and ./tests/unit (-race)
make lint                 # golangci-lint run ./platform/...
make fmt                  # gofmt (via go fmt) + clang-format on C/C++
make pack VERSION=0.1.0   # Native stub release tarball (validation)
```

For first-time or iterative dev on the Go core on macOS, the minimum loop is:

```bash
make proto platform aipc-cli
```

## Architecture

```text
Application containers
  -> SDKs over gRPC, Unix sockets, and shared memory
Platform services
  -> platform-api, app-manager, event-bus, camera-daemon,
     ai-runtime, device-control, device-discovery, os-updater
Hardware abstraction
  -> HAL v2 media, codec, AI, board, and device interfaces
Hardware and vendor runtimes
  -> Hailo-15, RK3588, Jetson, or stub backends
```

Services communicate over gRPC and Unix sockets; AI/camera data flows through
shared memory. Each service maps to a systemd unit in `systemd/`.

## Repository layout

| Path | Contents |
| ---- | -------- |
| `platform/` | Go and C++ platform services |
| `hal_v2/` | HAL v2 session-based C/C++ interfaces and backends (default `HAL_PLATFORM=stub`) |
| `web/` | React 19 + TypeScript + Vite management console |
| `tools/` | `aipc-cli` (Go), `ct-disc` (separate Go 1.22 module), `shm-reader` |
| `configs/` | Service configuration templates (`platform-api.yaml`, `preload.yaml`, + subdirs) |
| `systemd/` | System service units (one per platform service) |
| `scripts/` | Build, deploy, test, and maintenance shell scripts |
| `docker/` | Base image and dev container definitions |
| `docs/` | Architecture, deployment, API, HAL, and development docs |
| `tests/` | `unit/` and `integration/` test assets (+ `TESTING_GUIDE.md`) |
| `mcu_board_prj/` | MCU board firmware project |
| `sdk/` | SDK scaffolding hosted here |

## Platform services

| Service | Language | Notes |
| ------- | -------- | ----- |
| `platform/platform-api` | Go | Management API; Gin HTTP + auth |
| `platform/app-manager` | Go | Application container lifecycle |
| `platform/device-control` | Go | Device control + lens (gRPC) |
| `platform/event-bus` | Go | Event distribution |
| `platform/device-discovery` | Go | Network/device discovery |
| `platform/os-updater` | Go | OTA; uses `renameat2(RENAME_EXCHANGE)` — **Linux-only** |
| `platform/common` | Go | Shared library code |
| `platform/ai-runtime` | C++ | AI inference runtime (CMake) |
| `platform/camera-daemon` | C++ | Camera pipeline (CMake) |

## Build prerequisites

- Go 1.25+ (module declares `go 1.25.0`)
- `protoc` + `protoc-gen-go` + `protoc-gen-go-grpc` (CI pins v1.36.11 / v1.5.1)
- `cmake`, a C/C++ toolchain, and grpc/protobuf dev libs for C++ targets
- Node 24 + pnpm for `web/`
- Hardware-specific builds additionally require the vendor SDK (e.g. Hailo Poky
  SDK at `SDK_PATH=/opt/poky/4.0.23`)

## Build platform notes

`make all` runs C++ targets (`hal-v2`, `ai-runtime`, `camera-daemon`) and
`os-updater`, all of which depend on Linux-only symbols (`sem_timedwait`,
`nproc`, `unix.Renameat2`). They do **not** build on macOS.

- **macOS (native)**: build the Go core + CLI + web only — `make proto platform aipc-cli` and `make web`.
- **Full / Hailo-15 builds**: run in the Docker dev-env image
  `zerobot/ne503-dev-env-full:4.0.23` via `make docker-pack-release VERSION=...`,
  or on a Linux host / self-hosted runner.

## Go module notes

- Always use module mode. The committed `vendor/modules.txt` is stale relative
  to `go.mod`, so vendor mode fails with "inconsistent vendoring". Builds and
  tests run with `-mod=mod` (see `Makefile` and `.golangci.yml`); match that.
- `make proto` **must** run before `go build ./platform/...` — the generated
  `*/proto/*.pb.go` and `device-control/lens/lenspb` packages are gitignored.
- CGO is disabled for Go services (`CGO_ENABLED=0`); on `hailo15` the Makefile
  cross-compiles `GOOS=linux GOARCH=arm64`.

## Web console (`web/`)

- React 19, TypeScript, Vite 7, TanStack Query/Table, Tailwind v4, Zustand,
  i18next, ECharts, xterm. Tests via Vitest.
- Dev server: `cd web && pnpm dev`. Build: `pnpm build` (`tsc -b && vite build`).
- Lint/format: `pnpm lint`, `pnpm format`.
- **pnpm 11+ requires `web/pnpm-workspace.yaml`** with `allowBuilds` enabled for
  `esbuild`, `msw`, `unrs-resolver`; otherwise their postinstall scripts are
  blocked and any `pnpm run` fails with `ERR_PNPM_IGNORED BUILDS`. CI pins
  pnpm 10.34.5 where this is only a warning.
- Husky pre-commit runs `tsc --noEmit` + lint-staged (ESLint).

## Configuration and secrets

- Service config templates live in `configs/` (e.g. `configs/platform-api.yaml`).
- **Never commit secrets.** Platform API auth values are supplied at deployment
  time via environment variables:

  ```bash
  export AIPC_TOKEN_KEY="<random-signing-secret>"
  export AIPC_AUTH_USERNAME="admin"
  export AIPC_AUTH_PASSWORD="<strong-password>"
  ```

- Keep vendor SDKs, model files, generated binaries, and device credentials
  outside this repo (gitignored or local config).

## Git workflow and CI

- Conventional Commits enforced via commitlint (`commitlint.config.mjs`) and
  the `commitlint` CI workflow. Types: `feat`, `fix`, `refactor`, `docs`,
  `test`, `chore`, `perf`, `ci`, `build`.
- PRs target `main`. Husky installs a pre-commit hook via `web/.husky`.
- CI (`.github/workflows/ci.yml`, Ubuntu 22.04) has three jobs: `core`
  (`make all` + `make test-unit`), `ct-disc` (Go 1.22, `tools/ct-disc`), and
  `web` (pnpm 10.34.5 / Node 24). Additional workflows: `codeql.yml`,
  `release.yml`.
- Remote setup for this fork: `origin` → `harryhua-ai/ne503-aipc`,
  `upstream` → `camthink-ai/ne503-aipc`.

## Protobuf

Definitions live under `platform/*/proto/`. `make proto` regenerates Go code
into the same directories (`paths=source_relative`). For the Hailo-15 target,
`scripts/generate_proto_arm.sh` runs when `SDK_PATH` is set.

## Pointers

- Start here: `docs/getting-started/QUICK_START.md`, `docs/getting-started/BUILD.md`
- Architecture: `docs/architecture/README.md`, `docs/architecture/hal_v2_overview.md`
- Services: `docs/services/`
- HAL API/porting: `docs/references/hal-v2-api-reference.md`, `docs/hal/porting-guide.md`
- Config reference: `docs/references/config-reference.md`
- Deployment: `docs/deployment/DEPLOYMENT.md`
- Contributing: `CONTRIBUTING.md`
