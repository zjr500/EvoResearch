-- Execution lifecycle: idempotent starts and deadline tracked from start time.
ALTER TABLE experiment_executions ADD COLUMN idempotency_key TEXT;
ALTER TABLE experiment_executions ADD COLUMN deadline TEXT;
ALTER TABLE experiment_executions ADD COLUMN image_id TEXT;
CREATE UNIQUE INDEX experiment_executions_idempotency
  ON experiment_executions(owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
