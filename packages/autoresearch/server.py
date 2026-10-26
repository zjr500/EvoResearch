"""Local static preview and optional same-origin proxy; no third-party packages.

python server.py --open
python server.py --backend http://127.0.0.1:8765 --open
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "src/autoresearch/web"
TEAM_BACKEND = os.getenv("AUTORESEARCH_TEAM_BACKEND", "")


def load_team_token():
    """Keep the already supplied access credential outside public assets."""
    value = os.getenv("AUTORESEARCH_TEAM_TOKEN", "").strip()
    return value


class WorkbenchHandler(SimpleHTTPRequestHandler):
    # Explicit types override Windows registry MIME associations for module scripts.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css"}

    def __init__(self, *args, backend="", team_token="", **kwargs):
        self.backend = backend.rstrip("/")
        self.team_token = team_token
        super().__init__(*args, directory=str(WEB), **kwargs)

    def list_directory(self, path):
        self.send_error(404, "Directory listing is disabled")

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def api_path(self):
        path = urllib.parse.urlsplit(self.path).path
        return path == "/health" or path == "/api" or path.startswith("/api/")

    def do_GET(self):
        if self.api_path():
            return self.proxy()
        super().do_GET()

    def do_HEAD(self):
        if self.api_path():
            return self.send_error(405)
        super().do_HEAD()

    def do_POST(self):
        if self.api_path():
            origin = self.headers.get("Origin")
            if origin:
                parsed = urllib.parse.urlsplit(origin)
                if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"} or parsed.port != self.server.server_port:
                    return self.json_error(403, "本地转发不接受其他网站发起的写操作。")
            return self.proxy()
        self.send_error(405)

    def json_error(self, status, detail):
        body = json.dumps({"detail": detail}, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def proxy(self):
        if not self.backend:
            return self.json_error(503, "未配置真实后台。样例模式无需后台；连接本地服务时用 --backend http://127.0.0.1:8765 启动工作台。")
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.json_error(400, "Invalid content length")
        if size < 0 or size > 1024 * 1024:
            return self.json_error(413, "Request body too large")
        data = self.rfile.read(size) if self.command == "POST" else None
        headers = {key: self.headers[key] for key in ("Accept", "Content-Type", "Authorization") if key in self.headers}
        if self.team_token:
            headers["Authorization"] = "Bearer " + self.team_token
        # self.path is appended to an operator-configured host; the browser cannot choose a proxy target.
        path = urllib.parse.urlsplit(self.path)
        request_path = path.path + ("?" + path.query if path.query else "")
        request = urllib.request.Request(self.backend + request_path, data=data, headers=headers, method=self.command)
        try:
            # Loopback development does not use the machine's outbound proxy.
            parsed = urllib.parse.urlsplit(self.backend)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if parsed.hostname in {"localhost", "127.0.0.1", "::1"} else urllib.request.build_opener()
            try:
                download = path.path.endswith("/export") or path.path.startswith("/api/artifacts/")
                response = opener.open(request, timeout=180 if download else 30)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                body = response.read()
                self.send_response(response.status)
                for key in ("Content-Type", "Content-Disposition"):
                    if response.headers.get(key):
                        self.send_header(key, response.headers[key])
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except (urllib.error.URLError, TimeoutError, OSError):
            self.json_error(502, "无法连接已配置的后台，请检查服务是否启动和访问地址。未切换为样例。")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--backend", default="", help="Research service root URL, without /api")
    parser.add_argument("--open", action="store_true", help="Open the local workbench in a browser")
    parser.add_argument("--records", action="store_true", help="Open imported read-only handoff records")
    parser.add_argument("--members", action="store_true", help="Open the offline team evidence page")
    parser.add_argument("--team-handoff", action="store_true", help="Read team auth from the local handoff note or process environment, without publishing it")
    args = parser.parse_args()
    team_token = ""
    if args.team_handoff:
        args.backend = args.backend or TEAM_BACKEND
        team_token = load_team_token()
        if not team_token:
            parser.error("未找到本地团队访问配置。请保留工作区根目录的前端对接说明，或由维护者设置AUTORESEARCH_TEAM_TOKEN；不要把凭据写到web/config.js。")
    if args.backend:
        url = urllib.parse.urlsplit(args.backend)
        if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in {"", "/"}:
            parser.error("--backend需要HTTP(S)服务根地址，不含/api、账号、查询参数或子路径")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(WorkbenchHandler, backend=args.backend, team_token=team_token))
    mode = "handoff" if args.records or args.members else "live" if args.team_handoff else "sample"
    url = f"http://127.0.0.1:{server.server_port}/?mode={mode}" + ("#/handoffs" if args.members else "")
    print(f"Local: {url}", flush=True)
    print(f"Mode: {mode}. Ctrl+C to stop. Historical records do not start training.", flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
