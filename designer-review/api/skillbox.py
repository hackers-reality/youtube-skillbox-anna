"""Standalone HTTP adapter for the same read-only Skillbox tools used in Anna."""
from http.server import BaseHTTPRequestHandler
import json
import threading

try:
    from ._skillbox_engine import MANIFEST, invoke
except ImportError:
    from _skillbox_engine import MANIFEST, invoke

MAX_BODY = 3_500_000
ALLOWED_TOOLS = {entry["name"] for entry in MANIFEST.get("tools", [])}
# The shared Executa adapter temporarily replaces sys.stdout/sys.argv while
# invoking the upstream CLI. Serialize those critical sections per warm worker.
ENGINE_LOCK = threading.Lock()


def dispatch_tool(method, args):
    if method not in ALLOWED_TOOLS:
        return 400, {"error": "Unknown Skillbox tool."}
    if not isinstance(args, dict):
        return 400, {"error": "Tool arguments must be an object."}
    try:
        with ENGINE_LOCK:
            result = invoke(method, args)
        return 200, {"result": result}
    except Exception:
        return 500, {"error": "Skillbox could not complete this research call."}


class handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(200, {"status": "ready", "engine": "YouTube Skillbox", "tools": sorted(ALLOWED_TOOLS)})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._send(400, {"error": "Invalid request length."})
        if length <= 0 or length > MAX_BODY:
            return self._send(413 if length > MAX_BODY else 400, {"error": "Request body is empty or too large."})
        try:
            request = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return self._send(400, {"error": "Request body must be valid JSON."})
        if not isinstance(request, dict):
            return self._send(400, {"error": "Request body must be an object."})
        method = request.get("method")
        args = request.get("args", {})
        status, result = dispatch_tool(method, args)
        return self._send(status, result)

    def log_message(self, _format, *_args):
        # Avoid logging channel handles or request payloads in deployment logs.
        return
