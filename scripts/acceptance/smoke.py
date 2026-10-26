"""Real CPU training using the original Engine and an explicitly labelled rule proposer."""
import json
from pathlib import Path
import tempfile

from autoresearch.config import Settings
from autoresearch.engine import Engine
from fastapi.testclient import TestClient
from evoresearch.api import create_app


def main():
    phase = Path(__file__).resolve().parents[2]
    root = phase
    output = root / ".audit-data/phase5"
    output.mkdir(parents=True, exist_ok=True)
    home = Path(tempfile.mkdtemp(prefix="smoke-", dir=output))
    settings = Settings(home, runner="local_trusted", provider="feedback_demo")
    app = create_app(settings, "smoke-only-local-token-12345678")
    with TestClient(app) as client:
        client.headers["Authorization"] = "Bearer smoke-only-local-token-12345678"
        payload = json.loads((phase / "examples/start.json").read_text())
        response = client.post("/api/experiments", json=payload)
        assert response.status_code == 202, response.text
        rid = response.json()["run_id"]
        store = app.state.adapter.store
        run = store.claim()
        assert run["id"] == rid
        Engine(settings, store).run(run)
        result = client.get(f"/api/experiments/{rid}").json()
        result.update(home=str(home), proposer="feedback_demo", real_training=True)
        (output / "latest-smoke.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        assert result["status"] == "completed", result
        assert len(result["trials"]) == 2
        assert all(t["status"] == "valid" for t in result["trials"])
        assert result["artifacts"]
        print(json.dumps({k: result[k] for k in ("run_id", "status", "elapsed_seconds", "trials", "home")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
