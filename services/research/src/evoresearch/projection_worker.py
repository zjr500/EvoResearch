"""Independent process for slow tracking and Graphiti work; no experiment lock."""
import logging
import time
from autoresearch.config import Settings
from autoresearch.worker import WorkerLock
from .adapter import AutoResearchAdapter


def main(once=False):
    store=AutoResearchAdapter(Settings.from_env()).store
    with WorkerLock(store.home/'projection-worker.lock'):
        while True:
            from .tracking import dispatch as track
            from .knowledge import dispatch as ingest
            for fn in (track,ingest,track):
                try:
                    fn(store)
                except Exception as exc:
                    logging.getLogger(__name__).warning('Projection retry pending: %s',type(exc).__name__)
            if once: return
            time.sleep(5)
