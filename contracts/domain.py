"""EvoResearch domain contracts (design proposal, not existing implementation)."""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

class RunStatus(str, Enum):
    QUEUED="queued"
    RUNNING="running"
    COMPLETED="completed"
    FAILED="failed"
    STOPPED="stopped"
    INTERRUPTED="interrupted"

class IngestionStatus(str, Enum):
    PENDING="pending"
    GRAPH_WRITTEN="graph_written"
    VISIBILITY_PENDING="visibility_pending"
    RETRIEVABLE="retrievable"
    # Source-level aliases for old callers; persisted legacy values need migration.
    INDEX_PENDING="visibility_pending"
    INDEXED="retrievable"
    INVALID="invalid"
    RETRYABLE_FAILURE="retryable_failure"

@dataclass(frozen=True)
class Evidence:
    source_type: str
    source_id: str
    text: str
    uri: str | None = None
    score: float | None = None

@dataclass(frozen=True)
class ExperimentBudget:
    max_trials: int
    max_seconds: int
    max_gpu_hours: float | None = None

@dataclass(frozen=True)
class TaskTemplate:
    template_id: str
    version: str
    task_family: str
    metric_key: str
    metric_direction: str
    allowed_edit_paths: tuple[str, ...]
    supported_runners: tuple[str, ...]

@dataclass(frozen=True)
class ExperimentTask:
    task_id: str
    project_id: str
    template_id: str
    objective: str
    metric_key: str
    metric_direction: str
    budget: ExperimentBudget
    allowed_edit_paths: tuple[str, ...]
    use_history: bool = True

@dataclass(frozen=True)
class RunReceipt:
    run_id: str
    status: RunStatus
    task_id: str

@dataclass(frozen=True)
class ExperimentEvidence:
    project_id: str
    run_id: str
    trial_id: str
    model_name: str
    dataset_name: str
    metrics: dict[str, float]
    config: dict[str, Any]
    code_revision: str
    artifacts: tuple[str, ...] = ()
    source_uris: tuple[str, ...] = ()

@dataclass(frozen=True)
class ExperimentCompleted:
    event_id: str
    project_id: str
    run_id: str
    successful_trial_ids: tuple[str, ...]
    schema_version: int = 1

@dataclass(frozen=True)
class KnowledgeRecord:
    record_id: str
    project_id: str
    source_type: str
    source_ref: str
    summary: str
    entities: tuple[dict[str,str], ...]
    relations: tuple[dict[str,str], ...]
    evidence_uris: tuple[str, ...]
