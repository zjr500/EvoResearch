"""Strict HTTP boundary mapped to the shared 1_contracts dataclasses."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from contracts.domain import ExperimentBudget, ExperimentTask


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class BudgetInput(StrictModel):
    max_trials: int = Field(ge=2, le=10)
    max_seconds: int = Field(ge=10, le=3600)
    # The current Engine cannot enforce a GPU-hours budget.
    max_gpu_hours: None = None


class TaskInput(StrictModel):
    task_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    project_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    template_id: str = Field(min_length=1, max_length=128)
    objective: str = Field(min_length=3, max_length=2000)
    metric_key: str
    metric_direction: Literal["maximize", "minimize"]
    budget: BudgetInput
    allowed_edit_paths: list[str] = Field(min_length=1, max_length=1)
    # Freeze joint retrieval evidence before enqueue when enabled.
    use_history: bool = True

    def to_domain(self) -> ExperimentTask:
        values = self.model_dump()
        values["budget"] = ExperimentBudget(**values["budget"])
        values["allowed_edit_paths"] = tuple(values["allowed_edit_paths"])
        return ExperimentTask(**values)


class StartInput(StrictModel):
    task: TaskInput

