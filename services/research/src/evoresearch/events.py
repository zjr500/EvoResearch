"""Transactional completion outbox; knowledge state never changes run status."""
import json


def initialize(store):
    with store.connect() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS evo_outbox (
          event_id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
          payload TEXT NOT NULL, created REAL NOT NULL,
          tracking_status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT, delivered REAL);
        CREATE TABLE IF NOT EXISTS evo_ingestion (
          run_id TEXT PRIMARY KEY REFERENCES runs(id), status TEXT NOT NULL DEFAULT 'pending',
          updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS evo_tracking (
          run_id TEXT NOT NULL REFERENCES runs(id), item TEXT NOT NULL,
          mlflow_id TEXT NOT NULL, PRIMARY KEY(run_id,item));
        CREATE TABLE IF NOT EXISTS evo_projection (
          run_id TEXT PRIMARY KEY REFERENCES runs(id), revision TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS evo_completed AFTER UPDATE OF status ON runs
        WHEN NEW.status='completed' AND EXISTS(SELECT 1 FROM evo_tasks WHERE run_id=NEW.id)
        BEGIN
          INSERT OR IGNORE INTO evo_outbox(event_id,run_id,payload,created)
          SELECT 'completed:' || NEW.id, NEW.id,
            json_object('event_id','completed:' || NEW.id,'run_id',NEW.id,
              'project_id',t.project_id,'schema_version',1,
              'successful_trial_ids',json((SELECT json_group_array(CAST(ordinal AS TEXT))
                FROM trials WHERE run=NEW.id AND json_extract(body,'$.status')='valid'))),
            NEW.updated FROM evo_tasks t WHERE t.run_id=NEW.id;
          INSERT OR IGNORE INTO evo_ingestion(run_id,updated) VALUES(NEW.id,NEW.updated);
        END;
        """)


def state(store, run_id):
    with store.connect() as con:
        event = con.execute('SELECT * FROM evo_outbox WHERE run_id=?', (run_id,)).fetchone()
        ingestion = con.execute('SELECT status FROM evo_ingestion WHERE run_id=?', (run_id,)).fetchone()
        tracking = con.execute("SELECT mlflow_id FROM evo_tracking WHERE run_id=? AND item='parent'", (run_id,)).fetchone()
    return {'ingestion_status': ingestion[0] if ingestion else None,
            'completion_event': dict(event) | {'payload': json.loads(event['payload'])} if event else None,
            'mlflow_run_id': tracking[0] if tracking else None}
