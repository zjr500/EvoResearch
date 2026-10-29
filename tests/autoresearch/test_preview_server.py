import importlib.util
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
import zipfile

spec = importlib.util.spec_from_file_location("workbench_server", (Path(__file__).resolve().parents[2] / "packages/autoresearch") / "server.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Upstream(BaseHTTPRequestHandler):
    observed = []

    def do_GET(self):
        self.observed.append((self.path, self.headers.get("Authorization")))
        if self.path.endswith("/export"):
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w") as archive:
                archive.writestr("fixture.json", '{"test_fixture":true}')
            data = output.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", 'attachment; filename="fixture.zip"')
        else:
            data = json.dumps({"test_fixture": True, "path": self.path}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        data = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.observed.append((self.path, json.loads(data)))
        self.send_response(409)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"detail":"fixture conflict"}')

    def log_message(self, *_):
        pass


class PreviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        cls.preview = ThreadingHTTPServer(("127.0.0.1", 0), partial(module.WorkbenchHandler, backend=f"http://127.0.0.1:{cls.upstream.server_port}"))
        cls.empty = ThreadingHTTPServer(("127.0.0.1", 0), module.WorkbenchHandler)
        cls.team = ThreadingHTTPServer(("127.0.0.1", 0), partial(module.WorkbenchHandler, backend=f"http://127.0.0.1:{cls.upstream.server_port}", team_token="runtime-fixture-not-real"))
        for server in (cls.upstream, cls.preview, cls.empty, cls.team):
            threading.Thread(target=server.serve_forever, daemon=True).start()
        cls.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    @classmethod
    def tearDownClass(cls):
        for server in (cls.preview, cls.empty, cls.team, cls.upstream):
            server.shutdown()
            server.server_close()

    def get(self, path, server=None, **kwargs):
        return self.opener.open(urllib.request.Request(f"http://127.0.0.1:{(server or self.preview).server_port}{path}", **kwargs), timeout=5)

    def test_module_mime_overrides_windows_registry(self):
        with patch("mimetypes.guess_type", return_value=("text/plain", None)):
            for path, expected in [("/app.js", "text/javascript"), ("/styles.css", "text/css")]:
                with self.get(path, self.empty) as response:
                    self.assertEqual(response.headers["Content-Type"], expected)
                    self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(module.WorkbenchHandler.guess_type(module.WorkbenchHandler.__new__(module.WorkbenchHandler), "fixture.mjs"), "text/javascript")

    def test_static_and_source_boundary(self):
        with self.get("/") as response:
            self.assertEqual(response.status, 200)
            self.assertIn("研究工作台", response.read().decode())
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.get("/server.py")
        self.assertEqual(error.exception.code, 404)

    def test_proxy_auth_and_download(self):
        with self.get("/api/templates", headers={"Authorization": "Bearer fixture-only"}) as response:
            self.assertEqual(json.load(response)["path"], "/api/templates")
        self.assertIn(("/api/templates", "Bearer fixture-only"), Upstream.observed)
        with self.get("/api/runs/run_fixture/export") as response:
            self.assertEqual(response.headers["Content-Type"], "application/zip")
            with zipfile.ZipFile(io.BytesIO(response.read())) as archive:
                self.assertIn("fixture.json", archive.namelist())

    def test_proxy_preserves_error_and_request(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.get("/api/projects/p_fixture/runs", data=b'{"confirm_plan":true}', headers={"Content-Type": "application/json"}, method="POST")
        self.assertEqual(error.exception.code, 409)
        self.assertEqual(json.load(error.exception)["detail"], "fixture conflict")
        self.assertIn(("/api/projects/p_fixture/runs", {"confirm_plan": True}), Upstream.observed)

    def test_missing_backend_is_explicit_not_sample(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.get("/api/templates", self.empty)
        self.assertEqual(error.exception.code, 503)
        self.assertIn("未配置真实后台", json.load(error.exception)["detail"])

    def test_runtime_team_token_stays_in_proxy(self):
        with self.get("/api/templates", self.team) as response:
            self.assertEqual(response.status, 200)
        self.assertIn(("/api/templates", "Bearer runtime-fixture-not-real"), Upstream.observed)
        with self.get("/config.js", self.team) as response:
            self.assertNotIn(b"runtime-fixture-not-real", response.read())
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.get("/../04_%E7%BB%99%E5%89%8D%E7%AB%AF%E7%9A%84%E5%AF%B9%E6%8E%A5%E8%AF%B4%E6%98%8E.md", self.team)
        self.assertEqual(error.exception.code, 404)

    def test_cross_origin_writes_never_reach_upstream(self):
        count = len(Upstream.observed)
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.get("/api/projects/p/runs", self.team, data=b'{"confirm_plan":true}', headers={"Origin": "https://other-site.invalid", "Content-Type": "application/json"}, method="POST")
        self.assertEqual(error.exception.code, 403)
        self.assertEqual(len(Upstream.observed), count)

    def test_private_evidence_not_bundled(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.get("/evidence/zhang-20261022/manifest.json", self.empty)
        self.assertEqual(error.exception.code, 404)


if __name__ == "__main__":
    unittest.main(verbosity=2)
