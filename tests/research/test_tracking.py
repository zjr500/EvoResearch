import json
import pytest
from autoresearch.config import Settings
from evoresearch.adapter import AutoResearchAdapter
from evoresearch.models import TaskInput
from evoresearch.events import state
from evoresearch.tracking import MLflowAdapter, dispatch


def make(tmp_path):
    adapter = AutoResearchAdapter(Settings(tmp_path,runner='local_trusted',provider='feedback_demo'))
    task = TaskInput.model_validate(dict(project_id='p',task_id='t',template_id='diabetes-ridge-v1',
        objective='Improve regression',metric_key='rmse',metric_direction='minimize',
        allowed_edit_paths=['model.py'],budget={'max_trials':2,'max_seconds':300},use_history=False)).to_domain()
    return adapter,task


def test_atomic_completion_and_duplicate_submission(tmp_path):
    adapter,task=make(tmp_path)
    rid=adapter.start(task,[]).run_id
    assert adapter.start(task,[]).run_id==rid
    with pytest.raises(RuntimeError):
        with adapter.store.connect() as con:
            con.execute("UPDATE runs SET status='completed' WHERE id=?",(rid,))
            raise RuntimeError('crash before commit')
    assert state(adapter.store,rid)['completion_event'] is None
    assert adapter.status(rid).value=='queued'
    adapter.store.trial(rid,0,{'status':'valid','terminal':True,'metrics':{'rmse':1.5}})
    adapter.store.update(rid,status='completed')
    adapter.store.update(rid,status='completed')
    event=state(adapter.store,rid)
    assert event['completion_event']['payload']['successful_trial_ids']==['0']
    assert event['ingestion_status']=='pending'
    assert adapter.start(task,[]).run_id==rid


def test_mlflow_failure_replay_and_remote_commit_recovery(tmp_path,monkeypatch):
    adapter,task=make(tmp_path); rid=adapter.start(task,[]).run_id
    adapter.store.trial(rid,0,{'status':'valid','terminal':True,'metrics':{'rmse':1.5}})
    adapter.store.update(rid,status='completed')
    original=MLflowAdapter.sync_run
    def fail(self,rid):
        raise OSError('offline')
    monkeypatch.setattr(MLflowAdapter,'sync_run',fail)
    assert dispatch(adapter.store)[0]['status']=='retryable_failure'
    assert adapter.status(rid).value=='completed'
    assert state(adapter.store,rid)['ingestion_status']=='pending'
    monkeypatch.setattr(MLflowAdapter,'sync_run',original)
    assert dispatch(adapter.store)[0]['status']=='synced'
    tracker=MLflowAdapter(adapter.store)
    before=tracker.client.search_runs([tracker.experiment_id])
    with adapter.store.connect() as con:
        # Simulate lost local mapping after successful remote create/log.
        con.execute('DELETE FROM evo_tracking')
    assert dispatch(adapter.store,replay=True)[0]['status']=='synced'
    after=tracker.client.search_runs([tracker.experiment_id])
    assert {r.info.run_id for r in before}=={r.info.run_id for r in after}
    child=next(r for r in after if r.data.tags['evo.item']=='trial:0')
    assert len(tracker.client.get_metric_history(child.info.run_id,'rmse'))==1
    assert tracker.get_evidence(rid,'0').metrics=={'rmse':1.5}
    assert state(adapter.store,rid)['completion_event']['attempts']==3


def test_interruption_has_no_completion_event(tmp_path):
    adapter,task=make(tmp_path); rid=adapter.start(task,[]).run_id
    adapter.store.claim(); adapter.store.recover()
    assert adapter.status(rid).value=='interrupted'
    assert state(adapter.store,rid)['completion_event'] is None
    assert state(adapter.store,rid)['ingestion_status'] is None
    dispatch(adapter.store)
    tracker=MLflowAdapter(adapter.store)
    parent=tracker.client.get_run(state(adapter.store,rid)['mlflow_run_id'])
    assert parent.info.status=='KILLED'
