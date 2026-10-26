import hashlib
import os
import subprocess
import time

from .config import Settings
from .engine import Engine
from .store import Store


class WorkerLock:
    def __init__(self, path):
        self.path = path

    def __enter__(self):
        self.file = self.path.open("a+b")
        if self.file.tell() == 0:
            self.file.write(b"0")
            self.file.flush()
        self.file.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.file.close()
            raise RuntimeError("Another worker owns this state directory")
        return self

    def __exit__(self, *args):
        self.file.close()


def recover_execution(settings, store):
    if settings.runner == "docker":
        # Only containers labelled for this state directory are recovered.
        label = hashlib.sha256(str(settings.home).encode()).hexdigest()[:24]
        found = subprocess.run(["docker", "ps", "-aq", "--filter", "label=autoresearch.home=" + label], capture_output=True, text=True, timeout=20, check=True)
        containers = found.stdout.split()
        if containers:
            subprocess.run(["docker", "rm", "-f", *containers], timeout=30, check=True)
    store.recover()


def main(once=False):
    settings = Settings.from_env()
    store = Store(settings.home)
    with WorkerLock(settings.home / "worker.lock"):
        recover_execution(settings, store)
        while True:
            run = store.claim()
            if run:
                Engine(settings, store).run(run)
            elif once:
                return
            else:
                time.sleep(0.5)
