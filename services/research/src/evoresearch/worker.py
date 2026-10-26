"""Experiment worker never imports or calls Graphiti or MLflow."""
import time
from autoresearch.config import Settings
from autoresearch.engine import Engine
from autoresearch.worker import WorkerLock, recover_execution
from .adapter import AutoResearchAdapter


def main(once=False):
    settings=Settings.from_env()
    store=AutoResearchAdapter(settings).store
    with WorkerLock(settings.home/'worker.lock'):
        recover_execution(settings,store)
        while True:
            run=store.claim()
            if run:
                Engine(settings,store).run(run)
            elif once:
                return
            else:
                time.sleep(0.5)
