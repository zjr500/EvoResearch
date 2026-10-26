"""Durable experiment knowledge projection, independent of experiment execution."""
from dataclasses import asdict
import hashlib
import json
import time
import uuid

from autoresearch.worker import WorkerLock
from contracts.domain import KnowledgeRecord


class InvalidKnowledge(ValueError):
    """Permanent source-integrity failure; requires operator correction."""


def stable_id(project_id, source_ref):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, 'evoresearch:' + project_id + ':' + source_ref))


def initialize(store):
    with store.connect() as con:
        con.executescript('''
        CREATE TABLE IF NOT EXISTS evo_knowledge (
          record_id TEXT PRIMARY KEY, run_id TEXT UNIQUE REFERENCES runs(id),
          event_id TEXT UNIQUE, project_id TEXT NOT NULL,
          body TEXT NOT NULL, digest TEXT NOT NULL, episode_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending', stage TEXT NOT NULL DEFAULT 'write',
          attempts INTEGER NOT NULL DEFAULT 0, next_attempt REAL NOT NULL DEFAULT 0,
          last_error TEXT, updated REAL NOT NULL);
        ''')


def structure(store, event):
    """Deterministic source facts; LLM hypotheses are not treated as findings."""
    rid = event['run_id']
    if event.get('schema_version') != 1:
        raise ValueError('unsupported_event_schema')
    with store.connect() as con:
        row = con.execute('SELECT * FROM evo_tasks WHERE run_id=?',(rid,)).fetchone()
        tracked = dict(con.execute('SELECT item,mlflow_id FROM evo_tracking WHERE run_id=?',(rid,)))
    if not row or row['project_id'] != event['project_id']:
        raise ValueError('event_source_mismatch')
    run = store.run(rid)
    if run['status'] != 'completed':
        raise ValueError('source_not_completed')
    task = json.loads(row['task_json'])
    valid = [t for t in store.trials(rid) if t.get('status') == 'valid']
    if sorted(str(t['ordinal']) for t in valid) != sorted(event['successful_trial_ids']):
        raise ValueError('event_trials_mismatch')
    if not tracked.get('parent') or any('trial:'+str(t['ordinal']) not in tracked for t in valid):
        raise RuntimeError('tracking_evidence_pending')
    record_id = stable_id(row['project_id'],event['event_id'])
    sources = [f"runs:/{tracked['parent']}/run.json",f"evoresearch://events/{event['event_id']}"]
    entities = [{'type':'Experiment','id':rid,'template':task['template_id'],
                 'metric':task['metric_key'],'direction':task['metric_direction']}]
    relations = []
    statements = [f"Experiment {rid} completed the {task['template_id']} task."]
    for trial in valid:
        tid = str(trial['ordinal'])
        uri = f"runs:/{tracked['trial:'+tid]}/trial.json"
        sources.append(uri)
        from .task_registry import registry
        config=registry.get(task['template_id']).validate(trial['code']) if trial.get('code') else {}
        entities.append({'type':'Trial','id':rid+':'+tid,'code_sha256':trial.get('code_sha256',''),
                         'metrics_json':json.dumps(trial['metrics'],sort_keys=True),'config_json':json.dumps(config,sort_keys=True),'source_uri':uri})
        relations.append({'source':rid,'target':rid+':'+tid,'type':'HAS_VALIDATED_TRIAL'})
        statements.append(f"Trial {tid} of experiment {rid} measured validation {task['metric_key']} "
                          f"{trial['metrics'][task['metric_key']]:.12g} with parameters {json.dumps(config,sort_keys=True)}. Its code SHA256 is {trial.get('code_sha256','unknown')}.")
    baseline = (run.get('baseline') or {}).get('metrics',{})
    if task['metric_key'] in baseline:
        statements.append(f"The baseline validation {task['metric_key']} was {baseline[task['metric_key']]:.12g}.")
    statements.append('These are bounded experiment observations, not universal performance claims. '
                      'Final paired evaluation and candidate selection are in the parent run evidence; '
                      'they must not be attributed to every trial.')
    return KnowledgeRecord(record_id,row['project_id'],'experiment',event['event_id'],
                           ' '.join(statements),tuple(entities),tuple(relations),tuple(sources))


def materialize(store):
    initialize(store)
    with store.connect() as con:
        events = list(con.execute("SELECT * FROM evo_outbox WHERE tracking_status='delivered'"))
    for row in events:
        with store.connect() as con:
            if con.execute('SELECT 1 FROM evo_knowledge WHERE event_id=?',(row['event_id'],)).fetchone():
                continue
        try:
            record = structure(store,json.loads(row['payload']))
            body = json.dumps(asdict(record),ensure_ascii=False,sort_keys=True,allow_nan=False)
            digest = hashlib.sha256(body.encode()).hexdigest()
            with store.connect() as con:
                con.execute('''INSERT OR IGNORE INTO evo_knowledge
                  (record_id,run_id,event_id,project_id,body,digest,updated) VALUES(?,?,?,?,?,?,?)''',
                  (record.record_id,row['run_id'],row['event_id'],record.project_id,body,digest,time.time()))
        except (ValueError,KeyError,TypeError):
            with store.connect() as con:
                con.execute("UPDATE evo_ingestion SET status='invalid',updated=? WHERE run_id=?",(time.time(),row['run_id']))


def records(store, run_id):
    initialize(store)
    with store.connect() as con:
        return [dict(r) | {'body':json.loads(r['body'])} for r in
                con.execute('SELECT * FROM evo_knowledge WHERE run_id=?',(run_id,))]


def transition(store, rid, status, stage, error=None, delay=0, episode=None):
    now = time.time()
    with store.connect() as con:
        con.execute('BEGIN IMMEDIATE')
        con.execute('''UPDATE evo_knowledge SET status=?,stage=?,last_error=?,next_attempt=?,
          episode_id=COALESCE(?,episode_id),updated=? WHERE record_id=?''',
          (status,stage,error,now+delay,episode,now,rid))
        con.execute('''UPDATE evo_ingestion SET status=?,updated=? WHERE run_id=
          (SELECT run_id FROM evo_knowledge WHERE record_id=?)''',(status,now,rid))


def dispatch(store, backend_factory=None, force=False):
    from .graphiti_adapter import GraphitiAdapter
    factory = backend_factory or (lambda: GraphitiAdapter.from_env(store))
    initialize(store)
    results=[]
    with WorkerLock(store.home/'ingestion.lock'):
        materialize(store)
        with store.connect() as con:
            pending=list(con.execute("SELECT * FROM evo_knowledge WHERE status NOT IN ('retrievable','invalid') AND (? OR next_attempt<=?)",
                                     (force,time.time())))
        if not pending:
            return results
        backend=None
        try:
            for row in pending:
                stage=row['stage']
                with store.connect() as con:
                    con.execute('UPDATE evo_knowledge SET attempts=attempts+1 WHERE record_id=?',(row['record_id'],))
                try:
                    if hashlib.sha256(row['body'].encode()).hexdigest()!=row['digest']:
                        raise InvalidKnowledge('source_digest_mismatch')
                    if backend is None:
                        backend=factory()
                    record=KnowledgeRecord(**json.loads(row['body']))
                    if stage=='write':
                        ids=backend.upsert_records([record],row['event_id'])
                        if ids != [record.record_id]:
                            raise RuntimeError('write_not_acknowledged')
                        stage='visibility'
                        transition(store,record.record_id,'graph_written',stage,episode=backend.episode_id(record))
                    transition(store,record.record_id,'visibility_pending',stage)
                    visible=backend.verify_retrievable(record.project_id,[record.record_id])
                    if record.record_id in visible:
                        transition(store,record.record_id,'retrievable','done')
                        results.append({'record_id':record.record_id,'status':'retrievable'})
                    else:
                        transition(store,record.record_id,'visibility_pending',stage,delay=min(300,2**min(row['attempts']+1,8)))
                        results.append({'record_id':record.record_id,'status':'visibility_pending'})
                except InvalidKnowledge:
                    transition(store,row['record_id'],'invalid',stage,'InvalidKnowledge')
                    results.append({'record_id':row['record_id'],'status':'invalid','stage':stage})
                except Exception as exc:
                    # Store class/category only; backend messages can contain credentials.
                    transition(store,row['record_id'],'retryable_failure',stage,type(exc).__name__,
                               min(300,2**min(row['attempts']+1,8)))
                    results.append({'record_id':row['record_id'],'status':'retryable_failure','stage':stage})
        finally:
            if backend is not None:
                backend.close()
    return results
