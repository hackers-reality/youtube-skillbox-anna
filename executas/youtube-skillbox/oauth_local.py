"""Local Windows OAuth backend for controlled development, NOT a hosted identity service.

The Executa owns tokens; the iframe only receives opaque connection IDs and
Google-returned channel identities. No token is passed through Anna RPC/logs.
"""
import base64
import ctypes
from ctypes import wintypes
from datetime import date, timedelta
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import threading
import time
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener

REDIRECT_URI = "http://127.0.0.1:5192/oauth/callback"
SCOPES = ("openid", "email", "profile", "https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly")
ROOT = Path(__file__).resolve().parents[2]
REPORTS = {
    "overview": ("views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost", ""),
    "demographics": ("viewerPercentage", "ageGroup,gender"),
    "geography": ("views,estimatedMinutesWatched", "country"),
    "traffic-sources": ("views,estimatedMinutesWatched", "insightTrafficSourceType"),
    "devices": ("views,estimatedMinutesWatched", "deviceType"),
    "content-comparison": ("views,estimatedMinutesWatched,averageViewDuration", "creatorContentType"),
    "historical-trends": ("views,estimatedMinutesWatched,averageViewDuration", "day"),
}


class OAuthError(Exception):
    pass


def _dpapi(data, decrypt=False):
    if os.name != "nt":
        raise OAuthError("This local vault requires Windows DPAPI. A hosted cross-platform vault is not configured.")
    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]
    buffer = ctypes.create_string_buffer(data)
    incoming = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    function = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    if not function(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
        raise OAuthError("The Windows credential vault could not be opened by this OS user.")
    try:
        return ctypes.string_at(outgoing.pbData, outgoing.cbData)
    finally:
        kernel.LocalFree(ctypes.cast(outgoing.pbData, ctypes.c_void_p))


class Vault:
    def __init__(self, path):
        self.path = path

    def load(self):
        if not self.path.exists():
            return {}
        return json.loads(_dpapi(self.path.read_bytes(), decrypt=True))

    def save(self, value):
        encrypted = _dpapi(json.dumps(value).encode("utf-8"))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_bytes(encrypted)
        os.replace(temporary, self.path)


def google_request(url, *, form=None, token=None):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in {"oauth2.googleapis.com", "openidconnect.googleapis.com", "www.googleapis.com", "youtubeanalytics.googleapis.com"}:
        raise OAuthError("Unexpected Google endpoint; credentials were not sent.")
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, *_args, **_kwargs):
            return None
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None
    if form is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        data = urlencode(form).encode("utf-8")
    try:
        with build_opener(NoRedirect).open(Request(url, data=data, headers=headers), timeout=25) as response:
            raw = response.read(2_000_000)
            return json.loads(raw) if raw else {}
    except HTTPError as error:
        # Never surface provider payloads that might echo sensitive input.
        raise OAuthError(f"Google returned HTTP {error.code}. Check API enablement, test-user consent, scope and channel eligibility.") from None
    except Exception:
        raise OAuthError("Google request failed. Check connectivity and try again; credentials were not logged.") from None


class GoogleOAuth:
    def __init__(self, root=ROOT, request=google_request, vault=None, clock=time.time):
        self.root = Path(root)
        self.request = request
        self.vault = vault or Vault(self.root / ".local" / "google-grants.dpapi")
        self.clock = clock
        self.lock = threading.RLock()
        self.attempts = {}
        self.server = None

    def config(self):
        path = self.root / ".local" / "google-oauth-client.json"
        if not path.exists():
            raise OAuthError("Save the Google Web application client JSON to .local/google-oauth-client.json. See GOOGLE_OAUTH_SETUP.md.")
        try:
            config = json.loads(path.read_text(encoding="utf-8"))["web"]
            if not isinstance(config.get("client_id"), str) or not isinstance(config.get("client_secret"), str) or not config["client_id"] or not config["client_secret"] or REDIRECT_URI not in config.get("redirect_uris", []):
                raise ValueError("Invalid Web client configuration")
        except Exception:
            raise OAuthError("Use a Web application client JSON containing the exact loopback redirect URI; no client secret belongs in the iframe.") from None
        return config

    def _serve(self):
        if self.server:
            return
        manager = self
        class Callback(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass  # HTTP callback URLs contain authorization codes.

            def do_GET(self):
                uri = urlsplit(self.path)
                if self.headers.get("Host") != "127.0.0.1:5192" or uri.path != "/oauth/callback" or len(self.path) > 8192:
                    self.send_error(404)
                    return
                try:
                    values = parse_qs(uri.query)
                    manager.callback(values)
                    message = "Google connection completed. Return to Skillbox and click Check connection. Your public profile was not changed."
                    code = 200
                except OAuthError as error:
                    # Only our own bounded, non-secret errors reach this page.
                    message = str(error)
                    code = 400
                except Exception:
                    message = "Connection could not be completed. Return to Skillbox and start a new connection."
                    code = 400
                import html
                content = ("<!doctype html><html><meta charset=utf-8><title>Skillbox Google connection</title><h1>YouTube Skillbox</h1><p>" + html.escape(message) + "</p></html>").encode()
                self.send_response(code)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
        try:
            self.server = ThreadingHTTPServer(("127.0.0.1", 5192), Callback)
        except OSError:
            raise OAuthError("OAuth callback port 5192 is busy. Stop only the identified old Skillbox callback service.") from None
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def begin(self, serve=True):
        with self.lock:
            config = self.config()
            if os.name != "nt" and isinstance(self.vault, Vault):
                raise OAuthError("This local test backend requires Windows secure storage.")
            if serve:
                self._serve()
            now = self.clock()
            self.attempts = {key: item for key, item in self.attempts.items() if now - item["created"] < 600}
            state, attempt_id, verifier = (secrets.token_urlsafe(32) for _ in range(3))
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
            self.attempts[state] = {"id": attempt_id, "created": now, "verifier": verifier, "status": "pending", "client_id": config["client_id"]}
            params = {"client_id": config["client_id"], "redirect_uri": REDIRECT_URI, "response_type": "code", "scope": " ".join(SCOPES), "state": state, "code_challenge": challenge, "code_challenge_method": "S256", "access_type": "offline", "prompt": "consent"}
            return {"attempt_id": attempt_id, "authorization_url": "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params), "redirect_uri": REDIRECT_URI}

    def callback(self, values):
        with self.lock:
            state = values.get("state", [""])[0]
            item = self.attempts.get(state)
            if not item or item["status"] != "pending" or self.clock() - item["created"] >= 600:
                raise OAuthError("Invalid, expired or already-used OAuth state. Start a new connection.")
            item["status"] = "exchanging"  # Consume before any network call: no replays.
            try:
                if values.get("error"):
                    raise OAuthError("Google consent was cancelled or denied. No channel was verified.")
                code = values.get("code", [""])[0]
                if not code:
                    raise OAuthError("The callback has no authorization code.")
                config = self.config()
                if config["client_id"] != item["client_id"]:
                    raise OAuthError("OAuth client configuration changed. Start again.")
                tokens = self.request("https://oauth2.googleapis.com/token", form={"client_id": config["client_id"], "client_secret": config["client_secret"], "code": code, "code_verifier": item["verifier"], "redirect_uri": REDIRECT_URI, "grant_type": "authorization_code"})
                scope = tokens.get("scope", "").split()
                if not all(required in scope for required in SCOPES[3:]) or not tokens.get("access_token"):
                    raise OAuthError("Both read-only YouTube and Analytics permissions are required. Reconnect and approve them.")
                identity = self.request("https://openidconnect.googleapis.com/v1/userinfo", token=tokens["access_token"])
                channels = self.request("https://www.googleapis.com/youtube/v3/channels?" + urlencode({"part": "snippet", "mine": "true", "maxResults": 50}), token=tokens["access_token"])
                owned = [{"id": channel["id"], "title": channel.get("snippet", {}).get("title", "YouTube channel"), "handle": channel.get("snippet", {}).get("customUrl", "")} for channel in channels.get("items", []) if channel.get("id")]
                if not identity.get("sub") or not owned:
                    raise OAuthError("Google did not return an owned YouTube channel. Select the Google/Brand account that owns your channel.")
                grant_id = secrets.token_urlsafe(32)
                grants = self.vault.load()
                owned_ids = {channel["id"] for channel in owned}
                matching = [(key, grant) for key, grant in grants.items() if grant["client_id"] == config["client_id"] and grant["subject"] == identity["sub"] and {channel["id"] for channel in grant["channels"]} == owned_ids]
                if matching:
                    grant_id, previous = max(matching, key=lambda pair: pair[1]["expires_at"])
                    if not tokens.get("refresh_token"):
                        tokens["refresh_token"] = previous.get("refresh_token")
                    for key, _grant in matching:
                        if key != grant_id:
                            del grants[key]
                grants[grant_id] = {"id": grant_id, "client_id": config["client_id"], "subject": identity["sub"], "email": identity.get("email", ""), "channels": owned, "access_token": tokens["access_token"], "refresh_token": tokens.get("refresh_token"), "scope": scope, "expires_at": self.clock() + int(tokens.get("expires_in", 3600))}
                self.vault.save(grants)
                item.update(status="connected", grant_id=grant_id)
            except OAuthError:
                item["status"] = "failed"
                raise
            except Exception:
                item["status"] = "failed"
                raise OAuthError("The connection could not be securely saved. Start again; no tokens were sent to the app.") from None
            finally:
                item.pop("verifier", None)

    def status(self, attempt_id=None):
        with self.lock:
            try:
                config = self.config()
            except OAuthError as error:
                return {"configured": False, "connections": [], "message": str(error), "local_only": True}
            connections = []
            seen = set()
            for key, grant in sorted(self.vault.load().items(), key=lambda pair: pair[1]["expires_at"], reverse=True):
                if grant["client_id"] != config["client_id"]:
                    continue
                channels = []
                for channel in grant["channels"]:
                    identity = (grant["subject"], channel["id"])
                    if identity not in seen:
                        seen.add(identity)
                        channels.append(channel)
                if channels:
                    connections.append({"id": key, "email": grant["email"], "channels": channels, "expires_at": grant["expires_at"]})
            attempt = next((item for item in self.attempts.values() if item["id"] == attempt_id), None)
            progress = attempt["status"] if attempt else "unknown"
            if attempt and progress == "pending" and self.clock() - attempt["created"] >= 600:
                progress = "expired"
            return {"configured": True, "connections": connections, "attempt_status": progress, "local_only": True}

    def _access(self, grant_id, channel_id=None):
        grants = self.vault.load()
        grant = grants.get(grant_id)
        config = self.config()
        if not grant or grant["client_id"] != config["client_id"]:
            raise OAuthError("This Google connection is unavailable. Connect again.")
        if channel_id is not None and channel_id not in {item["id"] for item in grant["channels"]}:
            raise OAuthError("The selected channel is not authorized by this Google connection.")
        if grant["expires_at"] <= self.clock() + 120:
            if not grant.get("refresh_token"):
                raise OAuthError("Google connection expired without a refresh grant. Reconnect.")
            fresh = self.request("https://oauth2.googleapis.com/token", form={"client_id": config["client_id"], "client_secret": config["client_secret"], "refresh_token": grant["refresh_token"], "grant_type": "refresh_token"})
            if not fresh.get("access_token"):
                raise OAuthError("Google refresh failed. Reconnect.")
            grant.update(access_token=fresh["access_token"], expires_at=self.clock() + int(fresh.get("expires_in", 3600)))
            if fresh.get("refresh_token"):
                grant["refresh_token"] = fresh["refresh_token"]
            self.vault.save(grants)
        return grant

    def report(self, args):
        with self.lock:
            channel = args.get("channel_id")
            grant = self._access(args.get("grant_id"), channel)
            if channel not in {item["id"] for item in grant["channels"]}:
                raise OAuthError("The selected channel is not authorized by this Google connection.")
            report = args.get("report", "overview")
            if report not in REPORTS:
                raise OAuthError("Unsupported Analytics report.")
            try:
                end = date.fromisoformat(args.get("end_date") or (date.today() - timedelta(days=1)).isoformat())
                start = date.fromisoformat(args.get("start_date") or (end - timedelta(days=27)).isoformat())
            except (ValueError, TypeError):
                raise OAuthError("Enter valid start/end dates in YYYY-MM-DD format.") from None
            if start > end:
                raise OAuthError("Start date must not be after end date.")
            if end >= date.today():
                raise OAuthError("End date must be yesterday or earlier; today's Analytics data is not complete.")
            metrics, dimensions = REPORTS[report]
            query = {"ids": "channel==" + channel, "startDate": start.isoformat(), "endDate": end.isoformat(), "metrics": metrics, "maxResults": 200}
            if dimensions:
                query["dimensions"] = dimensions
            response = None
            rows = []
            truncated = False
            for page in range(5):
                query["startIndex"] = page * 200 + 1
                result = self.request("https://youtubeanalytics.googleapis.com/v2/reports?" + urlencode(query), token=grant["access_token"])
                if response is None:
                    response = result
                current = result.get("rows", [])
                rows.extend(current)
                if len(current) < 200:
                    break
                if page == 4:
                    truncated = True
            response["rows"] = rows
            response["_meta"] = {"channel_id": channel, "start_date": start.isoformat(), "end_date": end.isoformat(), "report_type": report, "source": "YouTube Analytics API v2", "retrieved_at": self.clock(), "label": "MEASURED", "row_limit": 1000, "truncated": truncated, "limitations": ["Google can omit recent/private/small-cohort data; empty rows are unavailable, not zero.", "Up to 1000 rows are returned per request; capped daily reports need a narrower date range.", "No revenue, impressions or CTR are invented or requested by this read-only report."]}
            return response

    def disconnect(self, grant_id):
        with self.lock:
            grants = self.vault.load()
            grant = grants.get(grant_id)
            if not grant:
                raise OAuthError("Google connection not found; nothing was removed.")
            self.request("https://oauth2.googleapis.com/revoke", form={"token": grant.get("refresh_token") or grant["access_token"]})
            # Google revocation is per account/client, not a per-channel grant.
            grants = {key: value for key, value in grants.items() if not (value["subject"] == grant["subject"] and value["client_id"] == grant["client_id"])}
            self.vault.save(grants)
            return {"disconnected": True, "profile_unchanged": True}


_manager = GoogleOAuth()


def invoke_oauth(method, args):
    try:
        if method == "oauth_begin":
            result = _manager.begin()
        elif method == "oauth_status":
            result = _manager.status(args.get("attempt_id"))
        elif method == "oauth_disconnect":
            result = _manager.disconnect(args.get("grant_id"))
        elif method == "oauth_analytics":
            result = _manager.report(args)
        else:
            raise OAuthError("Unknown OAuth method")
        return {"success": True, "data": result}
    except OAuthError as error:
        return {"success": False, "error": str(error)}
    except Exception:
        return {"success": False, "error": "Local Google connection failed safely; no credentials were returned. Check configuration and reconnect."}
