#!/usr/bin/env python3
"""Local server for the Recipe Aggregator app.

Serves the static assets/ directory and emulates the Cloudflare Worker's
POST /api/recipe-page endpoint (same validation, redirect and size limits)
so URL import works locally.

Cloud-storage API (see README-cloud.md):
  GET  /api/config               public client IDs + redirect URI + mock flag
  GET  /api/mock-cloud/list|read and POST /api/mock-cloud/write|delete
                                 local stand-in for Drive when
                                 dev.mock_cloud is true in cloud-config.json

Usage: python3 serve.py [assets_dir] [port]
"""
import base64
import json
import mimetypes
import os
import re
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ASSETS_DIR = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
    "~/www/recipe-aggregator/assets"))
PORT = int(sys.argv[2] if len(sys.argv) > 2 else 8000)
MAX_BODY = 2_000_000
TIMEOUT = 12
UA = "RecipeCollection/1.0"
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cloud-config.json")
MOCK_CLOUD_DIR = os.path.expanduser("~/.recipe-collection-cloud")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Return 3xx responses as-is so we can follow redirects manually."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def load_cloud_config():
    """Read cloud-config.json from next to serve.py. Never raises."""
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except Exception:
        return {}
    return raw if isinstance(raw, dict) else {}


def public_config():
    """The subset of the config the browser is allowed to see.

    Only public client IDs and the redirect URI — secrets stay server-side.
    """
    raw = load_cloud_config()

    def pub(section):
        section = raw.get(section) or {}
        if not isinstance(section, dict) or not section.get("client_id"):
            return None
        return {"client_id": section["client_id"]}

    dev = raw.get("dev") or {}
    return {
        "google": pub("google"),
        "redirect_uri": raw.get("redirect_uri") or ("http://localhost:%d/oauth-callback.html" % PORT),
        "mock": bool(isinstance(dev, dict) and dev.get("mock_cloud")),
    }


def _b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


_B64URL_ALPHABET = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")


def b64url_decode_strict(content):
    """Decode a base64url string (unpadded, or with trailing padding) strictly.
    urlsafe_b64decode() has no validate kwarg, so check the alphabet first."""
    if not isinstance(content, str) or not content:
        raise ValueError("not base64url")
    body = content.rstrip("=")
    pad = len(content) - len(body)
    if pad > 2 or "=" in body or any(c not in _B64URL_ALPHABET for c in body) or len(body) % 4 == 1:
        raise ValueError("not base64url")
    return base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))


def _mock_name_ok(name):
    """Resolve a cloud file name (e.g. 'img/abc.webp') inside MOCK_CLOUD_DIR.
    Returns the absolute path, or None for unsafe names."""
    if not isinstance(name, str):
        return None
    name = name.strip()
    if not name or name.startswith(("/", "~", "\\")) or "\\" in name:
        return None
    while name.startswith("./"):
        name = name[2:]
    if not name or name == "." or name != os.path.normpath(name) or ".." in name.split("/"):
        return None
    base = os.path.abspath(MOCK_CLOUD_DIR)
    full = os.path.abspath(os.path.join(base, *name.split("/")))
    if os.path.commonpath([base, full]) != base or full == base:
        return None
    return full


def valid_public_url(raw):
    """Mirror the worker's public HTTPS URL validation."""
    try:
        u = urlparse(raw)
    except Exception:
        return None
    host = u.hostname or ""
    host = host.lower()
    if u.scheme != "https" or u.username or u.password:
        return None
    if u.port not in (None, 443):
        return None
    if "." not in host or host.endswith("."):
        return None
    if re.search(r"^\d|:", host):
        return None
    if re.search(r"\.(local|localhost|internal|test|invalid|example)$", host):
        return None
    return u


def fetch_public_page(raw_url):
    """Fetch a public HTTPS page manually following up to 3 redirects.

    Returns (status, html_or_None, target_url, error_or_None).
    """
    target = valid_public_url(raw_url)
    if not target:
        return 400, None, None, "Enter a public HTTPS recipe URL."
    url = target.geturl()
    for _ in range(4):  # initial request + up to 3 redirects
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "Accept": "text/html,application/xhtml+xml",
                    "User-Agent": UA,
                },
            )
            resp = OPENER.open(req, timeout=TIMEOUT)
        except urllib.error.HTTPError as e:
            if 300 <= e.code < 400:
                location = e.headers.get("Location")
                if not location:
                    return 400, None, None, "The page redirect loop could not be followed."
                url = urllib.parse.urljoin(url, location)
                if not valid_public_url(url):
                    return 400, None, None, "Enter a public HTTPS recipe URL."
                continue
            return 400, None, None, f"The recipe site could not be read (HTTP {e.code})."
        except Exception:
            return 400, None, None, (
                "Could not reach that recipe page. The site may block automated requests.")
        try:
            ctype = resp.headers.get("Content-Type") or ""
            if not re.search(r"text/html|application/xhtml\+xml", ctype, re.I):
                return 400, None, None, "That address did not return a recipe web page."
            size = 0
            chunks = []
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_BODY:
                    return 400, None, None, "This page is too large to import."
                chunks.append(chunk)
            return 200, b"".join(chunks).decode("utf-8", "replace"), url, None
        finally:
            resp.close()
    return 400, None, None, "The page redirect loop could not be followed."


class Handler(BaseHTTPRequestHandler):
    server_version = "RecipeAggregator/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quieter logs
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status, body, ctype):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status, data):
        self._send(status, json.dumps(data).encode("utf-8"), "application/json; charset=utf-8")

    def _origin_ok(self):
        # Same-origin check by host: works for direct localhost access and
        # behind `tailscale serve` (https origin, http backend).
        origin = self.headers.get("Origin")
        if not origin:
            return False
        origin_host = urllib.parse.urlparse(origin).netloc.lower()
        request_host = (self.headers.get("Host") or "").lower()
        return bool(origin_host) and origin_host == request_host

    def _read_json_body(self):
        """Read + parse a bounded JSON POST body. Returns dict or None."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(min(length, 1 << 20)) or b"{}")
            return data if isinstance(data, dict) else None
        except Exception:
            return None

    def do_POST(self):
        path = urlparse(self.path).path
        if path in ("/api/mock-cloud/write", "/api/mock-cloud/delete"):
            return self._mock_cloud_post(path)
        if path != "/api/recipe-page":
            return self._json(404, {"error": "Not found"})
        if not self._origin_ok():
            return self._json(403, {"error": "Request origin is not allowed."})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(min(length, 1 << 20)) or b"")
        except Exception:
            return self._json(400, {"error": "Enter a valid recipe URL."})
        url = data.get("url") if isinstance(data, dict) else None
        if not isinstance(url, str) or len(url) > 2048:
            return self._json(400, {"error": "Enter a valid public HTTPS URL."})
        status, html, target, error = fetch_public_page(url)
        if error:
            return self._json(status, {"error": error})
        self._json(200, {"html": html, "url": target})

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/config":
            return self._json(200, public_config())
        if path.startswith("/api/mock-cloud/"):
            return self._mock_cloud_get(urlparse(self.path))
        if path.startswith("/api/"):
            return self._send(405, b"Method not allowed", "text/plain")
        self._serve_static()

    def _mock_cloud_get(self, parsed):
        if not public_config()["mock"]:
            return self._json(404, {"error": "Mock cloud is not enabled. Set dev.mock_cloud in cloud-config.json."})
        if parsed.path == "/api/mock-cloud/list":
            entries = []
            if os.path.isdir(MOCK_CLOUD_DIR):
                for root, _dirs, files in os.walk(MOCK_CLOUD_DIR):
                    for f in files:
                        full = os.path.join(root, f)
                        rel = os.path.relpath(full, MOCK_CLOUD_DIR).replace(os.sep, "/")
                        try:
                            entries.append({"name": rel, "size": os.path.getsize(full)})
                        except OSError:
                            pass
            entries.sort(key=lambda e: e["name"])
            return self._json(200, {"entries": entries})
        if parsed.path == "/api/mock-cloud/read":
            qs = urllib.parse.parse_qs(parsed.query)
            full = _mock_name_ok((qs.get("name") or [""])[0])
            if not full or not os.path.isfile(full):
                return self._json(404, {"error": "Not found."})
            ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
            with open(full, "rb") as f:
                return self._send(200, f.read(), ctype)
        return self._json(404, {"error": "Not found."})

    def _mock_cloud_post(self, path):
        if not public_config()["mock"]:
            return self._json(404, {"error": "Mock cloud is not enabled. Set dev.mock_cloud in cloud-config.json."})
        if not self._origin_ok():
            return self._json(403, {"error": "Request origin is not allowed."})
        data = self._read_json_body()
        if data is None:
            return self._json(400, {"error": "Invalid JSON body."})
        name = data.get("name")
        if not isinstance(name, str):
            return self._json(400, {"error": "Missing file name."})
        full = _mock_name_ok(name)
        if not full:
            return self._json(400, {"error": "Invalid file name."})
        if path == "/api/mock-cloud/write":
            content = data.get("contentBase64")
            if not isinstance(content, str) or not content:
                return self._json(400, {"error": "Missing contentBase64."})
            try:
                raw = b64url_decode_strict(content)
            except Exception:
                return self._json(400, {"error": "Bad base64 content."})
            os.makedirs(os.path.dirname(full) or MOCK_CLOUD_DIR, exist_ok=True)
            with open(full, "wb") as f:
                f.write(raw)
            return self._json(200, {"ok": True, "name": name, "size": len(raw)})
        if path == "/api/mock-cloud/delete":
            try:
                if os.path.isfile(full):
                    os.remove(full)
            except OSError:
                pass
            return self._json(200, {"ok": True})
        return self._json(404, {"error": "Not found."})

    do_HEAD = do_GET

    def _serve_static(self):
        path = urllib.parse.unquote(urlparse(self.path).path)
        if path == "/":
            path = "/index.html"
        full = os.path.normpath(os.path.join(ASSETS_DIR, path.lstrip("/")))
        if not full.startswith(ASSETS_DIR + os.sep) and full != ASSETS_DIR:
            return self._send(403, b"Forbidden", "text/plain")
        if not os.path.isfile(full):
            return self._send(404, b"Not found", "text/plain")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            self._send(200, f.read(), ctype)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Recipe Aggregator: http://localhost:{PORT}  (assets: {ASSETS_DIR})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
