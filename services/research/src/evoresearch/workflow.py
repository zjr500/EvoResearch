from contracts.domain import ExperimentTask, RunReceipt, RunStatus, Evidence
from contracts.ports import ExperimentEnginePort


class ResearchWorkflowService:
    def __init__(self, engine: ExperimentEnginePort, retriever_factory=None):
        self.engine = engine
        self.retriever_factory=retriever_factory

    def start_research(self, task: ExperimentTask) -> RunReceipt:
        if hasattr(self.engine,'existing_receipt'):
            existing=self.engine.existing_receipt(task)
            if existing: return existing
        if not task.use_history:
            return self.engine.start(task,[])
        from .graphiti_adapter import GraphitiAdapter
        backend=None
        try:
            backend=self.retriever_factory() if self.retriever_factory else GraphitiAdapter.from_env(self.engine.store)
            query=f'{task.template_id} {task.metric_key} {task.objective}'
            hits=backend.retrieve_joint(query,task.project_id,8)
            merged={}
            for e in hits:
                key=(e.source_type,e.source_id)
                if key not in merged: merged[key]=[e,[]]
                if e.text not in merged[key][1]: merged[key][1].append(e.text)
            evidence=[Evidence(e.source_type,e.source_id,'\n'.join(texts)[:4000],e.uri,e.score)
                      for e,texts in merged.values()]
            if not evidence: raise KnowledgeUnavailable('No retrievable sources for this project')
            return self.engine.start(task,evidence)
        except KnowledgeUnavailable:
            raise
        except Exception as exc:
            from .adapter import TaskConflict
            if isinstance(exc,TaskConflict): raise
            raise KnowledgeUnavailable('Joint retrieval unavailable; task was not silently downgraded') from None
        finally:
            if backend: backend.close()

    def get_research_status(self, run_id: str) -> RunStatus:
        return self.engine.status(run_id)

    def stop_research(self, run_id: str) -> bool:
        return self.engine.stop(run_id)


class KnowledgeUnavailable(RuntimeError): pass

