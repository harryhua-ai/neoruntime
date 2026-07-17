#!/usr/bin/env python3
"""Mock API server with stateful app registry for CLI testing."""

import http.server
import json
import time
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

APP_REGISTRY = {}

class MockAPIHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[{time.strftime('%H:%M:%S')}] {args[0]}", flush=True)

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/v1/system/health":
            self.send_json({"status": "healthy", "time": int(time.time()), "service": "platform-api"})
        elif path == "/api/v1/system/info":
            self.send_json({"version": "0.2.0", "services": {"ai-runtime": True, "event-bus": True, "app-manager": True}})
        elif path == "/api/v1/apps":
            self.send_json({"apps": list(APP_REGISTRY.values())})
        elif path.startswith("/api/v1/apps/") and "/stats" in path:
            app_id = path.split("/")[4]
            self.send_json({"app_id": app_id, "cpu_usage_percent": 5.0, "memory_usage_bytes": 32000000, "memory_limit_bytes": 64000000, "thread_count": 1, "uptime_seconds": 60})
        elif path.startswith("/api/v1/apps/"):
            app_id = path.split("/")[4]
            if app_id in APP_REGISTRY:
                self.send_json(APP_REGISTRY[app_id])
            else:
                self.send_json({"error": f"App not found: {app_id}"}, 404)
        else:
            self.send_json({"error": f"Not found: {path}"}, 404)

    def do_POST(self):
        path = self.path.split("?")[0]
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b""
        try:
            data = json.loads(body) if body else {}
        except:
            data = {}

        if path.endswith("/start"):
            app_id = path.split("/")[4]
            if app_id in APP_REGISTRY:
                APP_REGISTRY[app_id]["state"] = "running"
                APP_REGISTRY[app_id]["started_at"] = int(time.time())
                APP_REGISTRY[app_id]["pid"] = 12345
            self.send_json({"success": True, "message": f"Application {app_id} started"})
        elif path.endswith("/stop"):
            app_id = path.split("/")[4]
            if app_id in APP_REGISTRY:
                APP_REGISTRY[app_id]["state"] = "stopped"
                APP_REGISTRY[app_id]["pid"] = 0
            self.send_json({"success": True, "message": f"Application {app_id} stopped"})
        elif path == "/api/v1/apps":
            manifest_path = data.get("manifest_path", "")
            app_id = "unknown"
            app_name = "Unknown"
            app_version = "1.0.0"
            if manifest_path:
                try:
                    import yaml
                    with open(manifest_path, "r") as f:
                        manifest = yaml.safe_load(f)
                        app_id = manifest.get("metadata", {}).get("id", "unknown")
                        app_name = manifest.get("metadata", {}).get("name", app_id)
                        app_version = manifest.get("metadata", {}).get("version", "1.0.0")
                except Exception as e:
                    print(f"Warning: {e}", flush=True)
            APP_REGISTRY[app_id] = {
                "id": app_id, "name": app_name, "version": app_version,
                "state": "stopped", "pid": 0,
                "installed_at": int(time.time()), "started_at": 0, "restart_count": 0
            }
            print(f"[MOCK] Installed: {app_id}", flush=True)
            self.send_json({"status": {"success": True}, "app_id": app_id, "message": f"Installed {app_id}"})
        else:
            self.send_json({"success": True})

    def do_DELETE(self):
        path = self.path.split("?")[0]
        if "/apps/" in path:
            app_id = path.split("/")[4]
            if app_id in APP_REGISTRY:
                del APP_REGISTRY[app_id]
                print(f"[MOCK] Removed: {app_id}", flush=True)
            self.send_json({"success": True, "message": f"Removed {app_id}"})
        else:
            self.send_json({"success": True})

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = HTTPServer(("0.0.0.0", port), MockAPIHandler)
    print(f"Mock API server running on http://localhost:{port}", flush=True)
    server.serve_forever()
