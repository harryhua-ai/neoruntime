#!/bin/bash
# Mock API Server for CLI testing
# Usage: ./scripts/mock_api_server.sh

set -e

PORT=${1:-8080}

echo "Starting mock API server on port $PORT..."
echo "Press Ctrl+C to stop"
echo ""

# Create a simple mock server using Python
python3 << 'EOF'
import http.server
import json
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

# In-memory app registry for stateful testing
APP_REGISTRY = {}

class MockAPIHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[{time.strftime('%H:%M:%S')}] {args[0]}")

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]

        # System endpoints
        if path == '/api/v1/system/info':
            self.send_json({
                "version": "0.2.0",
                "services": {
                    "ai-runtime": True,
                    "event-bus": True,
                    "device-control": True,
                    "app-manager": True
                }
            })
        elif path == '/api/v1/system/health':
            self.send_json({
                "status": "healthy",
                "time": int(time.time()),
                "service": "platform-api"
            })
        elif path == '/api/v1/system/stats':
            self.send_json({
                "timestamp": int(time.time()),
                "services": {
                    "ai-runtime": {"status": "running"},
                    "event-bus": {"status": "running"}
                }
            })

        # App endpoints
        elif path == '/api/v1/apps':
            # List all apps (including dynamically installed ones)
            apps = []
            for app_id, app_data in APP_REGISTRY.items():
                apps.append(app_data)
            # Add some default apps if registry is empty
            if not apps:
                apps = [
                    {
                        "id": "object_detector",
                        "name": "Object Detector",
                        "version": "1.0.0",
                        "state": "running",
                        "installed_at": int(time.time()) - 3600,
                        "started_at": int(time.time()) - 1800
                    }
                ]
            self.send_json({"apps": apps})
        elif path.startswith('/api/v1/apps/') and path.endswith('/stats'):
            app_id = path.split('/')[4]
            self.send_json({
                "app_id": app_id,
                "cpu_usage_percent": 15.5,
                "memory_usage_bytes": 134217728,
                "memory_limit_bytes": 268435456,
                "thread_count": 4,
                "uptime_seconds": 1800
            })
        elif path.startswith('/api/v1/apps/') and path.endswith('/logs'):
            self.send_json({"timestamp": int(time.time()), "level": "info", "message": "Sample log message"})
        elif path.startswith('/api/v1/apps/') and not path.endswith('/stats') and not path.endswith('/logs'):
            # Get specific app info
            parts = path.split('/')
            app_id = parts[4] if len(parts) > 4 else ''
            if app_id in APP_REGISTRY:
                self.send_json(APP_REGISTRY[app_id])
            else:
                self.send_json({
                    "id": app_id,
                    "name": app_id.replace('_', ' ').title(),
                    "version": "1.0.0",
                    "state": "stopped",
                    "container_id": "",
                    "pid": 0,
                    "installed_at": int(time.time()) - 3600,
                    "started_at": 0,
                    "restart_count": 0
                })

        # Model endpoints
        elif path == '/api/v1/ai/models':
            self.send_json({
                "models": [
                    {
                        "model_id": "yolov8n",
                        "model_path": "/opt/aipc/models/yolov8n.onnx",
                        "version": "8.0.0",
                        "estimated_tops": 6.2,
                        "estimated_memory": 6291456,
                        "load_timestamp": int(time.time()) - 3600
                    },
                    {
                        "model_id": "face_detection",
                        "model_path": "/opt/aipc/models/face_detection.onnx",
                        "version": "1.0.0",
                        "estimated_tops": 2.1,
                        "estimated_memory": 2097152,
                        "load_timestamp": int(time.time()) - 3600
                    }
                ]
            })
        elif path == '/api/v1/ai/stats':
            self.send_json({
                "device_utilization": 0.45,
                "device_temperature": 52.5,
                "total_memory_bytes": 536870912,
                "used_memory_bytes": 134217728
            })

        # Device endpoints
        elif path == '/api/v1/device/status':
            self.send_json({
                "soc_temp_c": 48.5,
                "mcu_temp_c": 42.3,
                "light_sensor": 850,
                "ptz_pan_pos": 0,
                "ptz_tilt_pos": 0,
                "zoom_pos": 100,
                "focus_pos": 50,
                "mcu_version": "1.2.3"
            })

        # Event endpoints
        elif path == '/api/v1/events/topics':
            self.send_json({
                "topics": [
                    "system/status",
                    "app/object_detector/detections",
                    "model/yolov8n/inference",
                    "device/temperature"
                ]
            })

        else:
            self.send_json({"error": f"Not found: {path}"}, 404)

    def do_POST(self):
        path = self.path.split('?')[0]

        # Read request body
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b''

        try:
            data = json.loads(body) if body else {}
        except:
            data = {}

        if path.endswith('/start'):
            app_id = path.split('/')[4]
            if app_id in APP_REGISTRY:
                APP_REGISTRY[app_id]['state'] = 'running'
                APP_REGISTRY[app_id]['started_at'] = int(time.time())
                APP_REGISTRY[app_id]['container_id'] = f'aipc-{app_id}'
                APP_REGISTRY[app_id]['pid'] = 12345
            self.send_json({"success": True, "message": f"Application {app_id} started"})
        elif path.endswith('/stop'):
            app_id = path.split('/')[4]
            if app_id in APP_REGISTRY:
                APP_REGISTRY[app_id]['state'] = 'stopped'
                APP_REGISTRY[app_id]['stopped_at'] = int(time.time())
                APP_REGISTRY[app_id]['pid'] = 0
            self.send_json({"success": True, "message": f"Application {app_id} stopped"})
        elif path == '/api/v1/apps':
            # Install app - parse manifest_path to get app_id
            manifest_path = data.get('manifest_path', '')
            app_id = 'hello_world'  # Default
            app_name = 'Hello World'
            app_version = '1.0.0'
            if manifest_path:
                try:
                    import yaml
                    with open(manifest_path, 'r') as f:
                        manifest = yaml.safe_load(f)
                        app_id = manifest.get('metadata', {}).get('id', 'hello_world')
                        app_name = manifest.get('metadata', {}).get('name', app_id)
                        app_version = manifest.get('metadata', {}).get('version', '1.0.0')
                except Exception as e:
                    print(f"Warning: Could not parse manifest: {e}")

            # Register the app
            APP_REGISTRY[app_id] = {
                "id": app_id,
                "name": app_name,
                "version": app_version,
                "state": "stopped",
                "container_id": "",
                "pid": 0,
                "installed_at": int(time.time()),
                "started_at": 0,
                "stopped_at": 0,
                "restart_count": 0
            }
            print(f"[MOCK] App installed: {app_id}")

            self.send_json({
                "status": {"success": True, "message": "Installed"},
                "app_id": app_id,
                "message": f"Application {app_id} installed successfully"
            })
        elif path == '/api/v1/device/light':
            self.send_json({"success": True, "message": "Light set"})
        elif path == '/api/v1/device/ir-led':
            self.send_json({"success": True, "message": "IR LED set"})
        elif path == '/api/v1/device/ir-cut':
            self.send_json({"success": True, "message": "IR-Cut set"})
        elif path == '/api/v1/device/ptz':
            self.send_json({"success": True, "message": "PTZ command executed"})
        elif path == '/api/v1/events/publish':
            self.send_json({"success": True, "message": "Published"})
        else:
            self.send_json({"success": True, "message": "OK"})

    def do_DELETE(self):
        path = self.path.split('?')[0]
        # Handle uninstall
        if '/apps/' in path:
            parts = path.split('/')
            app_id = parts[4] if len(parts) > 4 else ''
            if app_id in APP_REGISTRY:
                del APP_REGISTRY[app_id]
                print(f"[MOCK] App removed: {app_id}")
            self.send_json({"success": True, "message": f"Application {app_id} removed"})
        else:
            self.send_json({"success": True, "message": "Deleted"})

if __name__ == '__main__':
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = HTTPServer(('0.0.0.0', port), MockAPIHandler)
    print(f"Mock API server running on http://localhost:{port}")
    print("Available endpoints:")
    print("  GET  /api/v1/system/info")
    print("  GET  /api/v1/system/health")
    print("  GET  /api/v1/apps")
    print("  GET  /api/v1/ai/models")
    print("  GET  /api/v1/device/status")
    print("  GET  /api/v1/events/topics")
    print("  POST /api/v1/device/light")
    print("  ... and more")
    print("")
    server.serve_forever()
EOF
