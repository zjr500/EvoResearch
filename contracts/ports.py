"""Stable ports owned by EvoResearch. Provider adapters implement these Protocols."""
from typing import Protocol
from .domain import Evidence, ExperimentTask, RunReceipt, RunStatus, ExperimentEvidence, KnowledgeRecord

class ExperimentEnginePort(Protocol):
    def start(self, task: ExperimentTask, evidence: list[Evidence]) -> RunReceipt: ...
    def status(self, run_id: str) -> RunStatus: ...
    def stop(self, run_id: str) -> bool: ...

class ExperimentTrackerPort(Protocol):
    def record_trial(self, run_id: str, trial_id: str, config: dict, metrics: dict[str,float]) -> str: ...
    def get_evidence(self, run_id: str, trial_id: str) -> ExperimentEvidence: ...

class KnowledgeGraphPort(Protocol):
    def upsert_records(self, records: list[KnowledgeRecord], idempotency_key: str) -> list[str]: ...
    def search(self, query: str, project_id: str) -> list[Evidence]: ...

class RetrieverPort(Protocol):
    def retrieve(self, query: str, project_id: str, limit: int = 8) -> list[Evidence]: ...

class PaperSourcePort(Protocol):
    def load_paper(self, paper_id: str) -> bytes: ...

class KnowledgeIndexPort(Protocol):
    """Graphiti retrieval visibility check, not a separate indexing service.

    Return the subset of requested record IDs whose mapped Graphiti content is
    retrievable in this project. Callers persist visibility_pending and retry
    this check for missing records; do not blindly repeat an episode insertion.
    """
    def verify_retrievable(self, project_id: str, record_ids: list[str]) -> list[str]: ...


class KnowledgeBackendPort(KnowledgeGraphPort, RetrieverPort, KnowledgeIndexPort, Protocol):
    """One GraphitiAdapter implements all three logical ports.

    Narrow ports remain available for consumers and tests. This composite port
    Graphiti owns graph writes, graph queries and hybrid retrieval. No LightRAG
    service or independent index sync is implied by KnowledgeIndexPort.
    """
