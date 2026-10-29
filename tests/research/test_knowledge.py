from dataclasses import asdict
import json
import pytest
from autoresearch.config import Settings
from evoresearch.adapter import AutoResearchAdapter
from evoresearch.models import TaskInput
from evoresearch import knowledge


def completed(tmp_path):
    a=AutoResearchAdapter(Settings(tmp_path,runner='local_trusted',provider='feedback_demo'))
    task=TaskInput.model_validate(dict(project_id='p',task_id='t',template_id='diabetes-ridge-v1',
        objective='Improve regression',metric_key='rmse',metric_direction='minimize',
        allowed_edit_paths=['model.py'],budget={'max_trials':2,'max_seconds':300},use_history=False)).to_domain()
    rid=a.start(task,[]).run_id
    a.store.trial(rid,0,{'status':'valid','terminal':True,'metrics':{'rmse':1.5},'code_sha256':'abc'})
    a.store.update(rid,status='completed')
    with a.store.connect() as con:
        con.execute("UPDATE evo_outbox SET tracking_status='delivered' WHERE run_id=?",(rid,))
        con.execute('INSERT INTO evo_tracking VALUES(?,?,?)',(rid,'parent','parent-id'))
        con.execute('INSERT INTO evo_tracking VALUES(?,?,?)',(rid,'trial:0','child-id'))
    return a,rid


class Backend:
    def __init__(self):
        self.writes=0;self.checks=0;self.visible=True;self.fail_write=False;self.fail_check=False
    def upsert_records(self,records,key):
        self.writes+=1
        if self.fail_write: raise OSError('backend down')
        return [r.record_id for r in records]
    def episode_id(self,record): return record.record_id
    def verify_retrievable(self,project,ids):
        self.checks+=1
        if self.fail_check: raise OSError('search unavailable')
        return ids if self.visible else []
    def close(self): pass


def test_visibility_retry_does_not_reinsert_and_replay_is_noop(tmp_path):
    a,rid=completed(tmp_path); b=Backend();b.visible=False
    assert knowledge.dispatch(a.store,lambda:b)[0]['status']=='visibility_pending'
    assert a.status(rid).value=='completed'
    assert b.writes==1
    # Backoff is durable; force is an explicit operator retry.
    assert knowledge.dispatch(a.store,lambda:b)==[]
    b.visible=True
    assert knowledge.dispatch(a.store,lambda:b,force=True)[0]['status']=='retrievable'
    for _ in range(3):
        a.store.update(rid,status='completed')
        assert knowledge.dispatch(a.store,lambda:b,force=True)==[]
    assert b.writes==1 and b.checks==2
    rows=knowledge.records(a.store,rid)
    assert len(rows)==1 and rows[0]['body']['evidence_uris'][0]=='runs:/parent-id/run.json'
    assert rows[0]['body']['entities'][1]['code_sha256']=='abc'


@pytest.mark.parametrize('where',['factory','write','check'])
def test_backend_failure_never_changes_experiment_and_recovers(tmp_path,where):
    a,rid=completed(tmp_path);b=Backend()
    b.fail_write=where=='write';b.fail_check=where=='check'
    def factory():
        if where=='factory': raise OSError('credentials not printed')
        return b
    assert knowledge.dispatch(a.store,factory)[0]['status']=='retryable_failure'
    assert a.status(rid).value=='completed'
    row=knowledge.records(a.store,rid)[0]
    assert row['last_error']=='OSError'
    b.fail_write=b.fail_check=False
    assert knowledge.dispatch(a.store,lambda:b,force=True)[0]['status']=='retrievable'
    assert b.writes==(1 if where in ('factory','check') else 2)


def test_invalid_event_does_not_enter_graph(tmp_path):
    a,rid=completed(tmp_path)
    with a.store.connect() as con:
        event=json.loads(con.execute('SELECT payload FROM evo_outbox').fetchone()[0])
        event['project_id']='other'
        con.execute('UPDATE evo_outbox SET payload=?',(json.dumps(event),))
    b=Backend()
    assert knowledge.dispatch(a.store,lambda:b)==[]
    assert b.writes==0
    assert a.snapshot(rid)['ingestion_status']=='invalid'
    assert a.status(rid).value=='completed'


def test_project_groups_and_source_ids_are_stable_and_isolated():
    from evoresearch.graphiti_adapter import project_group
    assert project_group('p')==project_group('p')
    assert project_group('p')!=project_group('q')
    assert knowledge.stable_id('p','e')!=knowledge.stable_id('q','e')


def test_corrupted_source_is_invalid_without_remote_write(tmp_path):
    a,rid=completed(tmp_path)
    knowledge.materialize(a.store)
    with a.store.connect() as con:
        con.execute("UPDATE evo_knowledge SET body='{}'")
    b=Backend()
    assert knowledge.dispatch(a.store,lambda:b)[0]['status']=='invalid'
    assert b.writes==0 and a.status(rid).value=='completed'
