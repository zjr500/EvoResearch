from dataclasses import dataclass
import os
from pathlib import Path


@dataclass
class Settings:
    home: Path
    runner: str = "docker"
    provider: str = "openai_compatible"
    image: str = "shenzhi-ar-experiment:0.1.0"
    signing_secret: str = ""
    demo_auth: bool = False
    demo_token: str = "local-demo-only"
    team_auth: bool = False

    @classmethod
    def from_env(cls):
        return cls(
            Path(os.getenv("AUTORESEARCH_HOME", "var")).resolve(),
            os.getenv("AUTORESEARCH_RUNNER", "docker"),
            os.getenv("AUTORESEARCH_PROVIDER", "openai_compatible"),
            os.getenv("AUTORESEARCH_IMAGE", "shenzhi-ar-experiment:0.1.0"),
            os.getenv("SHENZHI_SIGNING_SECRET", ""),
            os.getenv("AUTORESEARCH_DEMO_AUTH", "false").lower() == "true",
            os.getenv("AUTORESEARCH_DEMO_TOKEN", "local-demo-only"),
            os.getenv("AUTORESEARCH_TEAM_AUTH", "false").lower() == "true",
        )

    def __post_init__(self):
        self.home = self.home.resolve()
        if self.runner not in {"docker", "local_trusted"}:
            raise ValueError("Unknown experiment runner")
        if self.provider not in {"openai_compatible", "feedback_demo"}:
            raise ValueError("Unknown proposal provider")
        if self.team_auth and (self.demo_token == "local-demo-only" or len(self.demo_token) < 16):
            raise ValueError("Team access needs a non-default token of at least 16 characters")


class Halt(Exception):
    """Cancellation or total-budget stop, with partial evidence preserved."""
