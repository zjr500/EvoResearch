"""Workbench projection with explicit DeepSeek structured-output settings."""
import time
from urllib.parse import urlparse
from evoresearch.graphiti_adapter import GraphitiAdapter

def configure_deepseek(llm):
    original=llm.client.chat.completions.create
    async def create(**kwargs):
        kwargs['extra_body']={**kwargs.get('extra_body',{}),'thinking':{'type':'disabled'}}
        return await original(**kwargs)
    llm.client.chat.completions.create=create
    # Long paper relation arrays require more room than short trial records.
    llm.max_tokens=16384

class WorkbenchGraphitiAdapter(GraphitiAdapter):
    async def _open(self,uri,user,password,key,model,base_url,cache_dir):
        await super()._open(uri,user,password,key,model,base_url,cache_dir)
        if urlparse(base_url).hostname=='api.deepseek.com':configure_deepseek(self.graph.llm_client)

def main():
    from autoresearch.config import Settings
    from evoresearch.adapter import AutoResearchAdapter
    from autoresearch.worker import WorkerLock
    from evoresearch import tracking,knowledge
    a=AutoResearchAdapter(Settings.from_env())
    with WorkerLock(a.store.home/'projection-worker.lock'):
        while True:
            for step in (lambda:tracking.dispatch(a.store),
                         lambda:knowledge.dispatch(a.store,lambda:WorkbenchGraphitiAdapter.from_env(a.store)),
                         lambda:tracking.dispatch(a.store)):
                try:step()
                except Exception as exc:print('Projection retry:',type(exc).__name__,flush=True)
            time.sleep(5)

if __name__=='__main__':main()
