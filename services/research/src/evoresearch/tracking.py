"""Recoverable MLflow projection. Single dispatcher per state directory."""
import hashlib
import json
import os
from pathlib import Path
import time

from mlflow import MlflowClient
from autoresearch.worker import WorkerLock
from contracts.domain import ExperimentEvidence
from .events import state


class MLflowAdapter:
    def __init__(self, store, uri=None):
        self.store = store
        self.uri = uri or os.environ.get('MLFLOW_TRACKING_URI') or ('sqlite:///' + (store.home / 'mlflow.db').as_posix())
        self.client = MlflowClient(tracking_uri=self.uri)
        experiment = self.client.get_experiment_by_name('EvoResearch')
        self.experiment_id = experiment.experiment_id if experiment else self.client.create_experiment(
            'EvoResearch', artifact_location=(store.home / 'mlartifacts').as_uri())

    def _ensure(self, rid, item, parent=None):
        with self.store.connect() as con:
            row = con.execute('SELECT mlflow_id FROM evo_tracking WHERE run_id=? AND item=?', (rid,item)).fetchone()
        if row:
            return row[0]
        key = hashlib.sha256(f'{self.store.home}|{rid}|{item}'.encode()).hexdigest()
        found = self.client.search_runs([self.experiment_id], filter_string=f"tags.`evo.key` = '{key}'")
        if len(found) > 1:
            raise RuntimeError('Multiple MLflow records for one logical item')
        tags = {'evo.key':key, 'evo.run_id':rid, 'evo.item':item, 'mlflow.runName':f'{rid}/{item}'}
        if parent:
            tags['mlflow.parentRunId'] = parent
        mid = found[0].info.run_id if found else self.client.create_run(self.experiment_id, tags=tags).info.run_id
        with self.store.connect() as con:
            con.execute('INSERT OR IGNORE INTO evo_tracking VALUES(?,?,?)', (rid,item,mid))
        return mid

    def _metrics(self, mid, metrics):
        # Retry after a remote commit cannot append duplicate metric history.
        for key,value in metrics.items():
            history = self.client.get_metric_history(mid,key)
            if not history:
                self.client.log_metric(mid,key,float(value),step=0,timestamp=0)
            elif any(m.value != float(value) for m in history):
                raise ValueError('Immutable metric conflict: ' + key)

    def record_trial(self, run_id, trial_id, config, metrics):
        parent = self._ensure(run_id,'parent')
        mid = self._ensure(run_id,'trial:'+str(trial_id),parent)
        for key,value in config.items():
            self.client.log_param(mid,key,json.dumps(value,ensure_ascii=False,sort_keys=True))
        self._metrics(mid,metrics)
        return mid

    def get_evidence(self, run_id, trial_id):
        with self.store.connect() as con:
            row = con.execute('SELECT * FROM evo_tasks WHERE run_id=?',(run_id,)).fetchone()
            tracked = con.execute('SELECT mlflow_id FROM evo_tracking WHERE run_id=? AND item=?',
                                  (run_id,'trial:'+str(trial_id))).fetchone()
        if not row or not tracked:
            raise KeyError((run_id,trial_id))
        task = json.loads(row['task_json'])
        trial = next(t for t in self.store.trials(run_id) if str(t['ordinal']) == str(trial_id))
        return ExperimentEvidence(row['project_id'],run_id,str(trial_id),task['template_id'],
            task['template_id'],trial.get('metrics',{}),task,trial.get('code_sha256',''),
            tuple(a['path'] for a in self.store.artifacts(run_id)),(f"runs:/{tracked[0]}/trial.json",))

    def sync_run(self, rid):
        run = self.store.run(rid)
        with self.store.connect() as con:
            mapping = con.execute('SELECT * FROM evo_tasks WHERE run_id=?',(rid,)).fetchone()
        task = json.loads(mapping['task_json'])
        parent = self._ensure(rid,'parent')
        for key,value in {'project_id':mapping['project_id'],'task_id':mapping['task_id'],
                          'template_id':task['template_id']}.items():
            self.client.set_tag(parent,'evo.'+key,value)
        self.client.log_dict(parent,task,'task.json')
        project=self.store.project(mapping['engine_project_id'])
        self.client.log_dict(parent,project['plan'],'plan.json')
        self.client.set_tag(parent,'evo.use_history',str(task['use_history']).lower())
        if project['plan'].get('task_notes'):
            self.client.log_dict(parent,project['plan']['task_notes'],'retrieval.json')
        for trial in self.store.trials(rid):
            if not trial.get('terminal'):
                continue
            mid = self.record_trial(rid,str(trial['ordinal']),
                {'template_id':task['template_id'],'code_sha256':trial.get('code_sha256','')},trial.get('metrics',{}))
            self.client.log_dict(mid,trial,'trial.json')
            self.client.set_terminated(mid,'FINISHED' if trial['status']=='valid' else 'FAILED')
        root = (self.store.home / 'runs' / rid).resolve()
        for artifact in self.store.artifacts(rid):
            path = (root / artifact['path']).resolve()
            if not path.is_relative_to(root) or not path.is_file() or path.is_symlink():
                raise ValueError('Invalid artifact path')
            directory = Path(artifact['path']).parent.as_posix()
            self.client.log_artifact(parent,str(path),None if directory=='.' else directory)
        self.client.log_dict(parent,run,'run.json')
        self.client.set_tag(parent,'evo.experiment_status',run['status'])
        self.client.set_tag(parent,'evo.ingestion_status',state(self.store,rid)['ingestion_status'] or 'not_requested')
        for prefix,values in [('baseline', (run.get('baseline') or {}).get('metrics',{}))]:
            self._metrics(parent,{prefix+'.'+k:v for k,v in values.items()})
        for name in ('confirmation','final_evaluation'):
            if run.get(name):
                self._metrics(parent,{name+'.mean_delta':run[name]['mean_delta']})
        statuses = {'completed':'FINISHED','failed':'FAILED','cancelled':'KILLED',
                    'interrupted':'KILLED','budget_exhausted':'KILLED'}
        if run['status'] in statuses:
            self.client.set_terminated(parent,statuses[run['status']])
        return parent


def dispatch(store, uri=None, replay=False):
    results = []
    with WorkerLock(store.home / 'tracking.lock'):
        try:
            tracker = MLflowAdapter(store,uri)
        except Exception as exc:
            with store.connect() as con:
                con.execute("UPDATE evo_outbox SET tracking_status='retryable_failure',attempts=attempts+1,last_error=? WHERE tracking_status!='delivered'",(type(exc).__name__,))
            raise
        with store.connect() as con:
            ids = [r[0] for r in con.execute('SELECT run_id FROM evo_tasks')]
        for rid in ids:
            event = state(store,rid)['completion_event']
            revision = hashlib.sha256(json.dumps([store.run(rid),store.trials(rid),
                store.artifacts(rid),state(store,rid)['ingestion_status']],sort_keys=True).encode()).hexdigest()
            with store.connect() as con:
                saved = con.execute('SELECT revision FROM evo_projection WHERE run_id=?',(rid,)).fetchone()
            if saved and saved[0]==revision and not replay:
                continue
            try:
                mid = tracker.sync_run(rid)
                with store.connect() as con:
                    con.execute("UPDATE evo_outbox SET tracking_status='delivered',attempts=attempts+1,last_error=NULL,delivered=? WHERE run_id=?",(time.time(),rid))
                    con.execute('INSERT INTO evo_projection VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET revision=excluded.revision',(rid,revision))
                results.append({'run_id':rid,'mlflow_run_id':mid,'status':'synced'})
            except Exception as exc:
                with store.connect() as con:
                    con.execute("UPDATE evo_outbox SET tracking_status='retryable_failure',attempts=attempts+1,last_error=? WHERE run_id=?",(type(exc).__name__,rid))
                results.append({'run_id':rid,'status':'retryable_failure','error':type(exc).__name__})
    return results
