# Systemd Service Configuration

## Overview

The AIPC platform manages service lifecycles on Hailo-15 devices through systemd. All services run as systemd service units.

## Service List

| Service | Unit File | Description |
|---------|-----------|-------------|
| camera-daemon | `aipc-camera-daemon.service` | Media pipeline and RTSP |
| ai-runtime | `aipc-ai-runtime.service` | AI inference |
| event-bus | `aipc-event-bus.service` | Message bus |
| app-manager | `aipc-app-manager.service` | Container management |
| device-control | `aipc-device-control.service` | Device control |
| platform-api | `aipc-platform-api.service` | Web API |
| device-discovery | `aipc-device-discovery.service` | Device discovery |

## Startup Order

Services have dependencies on each other. systemd handles the startup order automatically:

```
containerd ---> app-manager
                    |
camera-daemon ---> ai-runtime ---> event-bus ---> platform-api
                                               device-control
                                               device-discovery
```

- `camera-daemon` and `containerd` have no upstream dependencies
- `platform-api` depends on all other services
- `ai-runtime` depends on `camera-daemon` (DMA-BUF zero-copy)

## Unit File Template

```ini
[Unit]
Description=AIPC <Service Name>
After=network.target
Wants=

[Service]
Type=simple
ExecStart=/opt/aipc/bin/<binary>
Restart=on-failure
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=60

WorkingDirectory=/opt/aipc
Environment=HOME=/opt/aipc

StandardOutput=journal
StandardError=journal
SyslogIdentifier=aipc-<service>

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
```

## Common Commands

```bash
# View service status
systemctl status aipc-platform-api

# Start/stop/restart
sudo systemctl start aipc-camera-daemon
sudo systemctl stop aipc-ai-runtime
sudo systemctl restart aipc-event-bus

# Enable/disable auto-start on boot
sudo systemctl enable aipc-platform-api
sudo systemctl disable aipc-device-discovery

# View logs
journalctl -u aipc-camera-daemon -f
journalctl -u aipc-ai-runtime --since "1 hour ago"

# View all AIPC service statuses
systemctl status 'aipc-*'
```

## CLI Management

```bash
# Via aipc-cli
aipc-cli system start        # Start all services in dependency order
aipc-cli system stop         # Stop in reverse order
aipc-cli system restart      # Restart
aipc-cli system status       # View status
aipc-cli system health       # Health check
aipc-cli system enable       # Enable auto-start on boot
aipc-cli system disable      # Disable auto-start
```

## Service File Locations

- Unit files: `/etc/systemd/system/aipc-*.service`
- Binaries: `/opt/aipc/bin/`
- Configuration files: `/opt/aipc/etc/`
- Log files: `/var/log/aipc/`
- Runtime sockets: `/run/aipc/`

## Log Management

Service logs are written to both journald and files:

- **journald**: `journalctl -u aipc-<service>`
- **File**: `/var/log/aipc/<service>.log` (specified by `log_file` in configuration)
- Application container logs: `/opt/aipc/logs/apps/`
- Log retention: 7 days by default (`log_retention_days`)
