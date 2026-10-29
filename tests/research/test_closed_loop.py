from dataclasses import replace
import hashlib
import json
from pathlib import Path
import pytest
from autoresearch.config import Settings
from fastapi.testclient import TestClient
from contracts.domain import Evidence
from evoresearch.adapter import AutoResearchAdapter,TaskConflict
from evoresearch.api import create_app
from evoresearch.models import TaskInput
from evoresearch.papers import PaperInput,PaperConflict,enqueue,LocalPaperSource
from evoresearch.workflow import ResearchWorkflowService,KnowledgeUnavailable


def task():
    return TaskInput.model_validate(dict(project_id='p',task_id='t',template_id='diabetes-ridge-v1',
        objective='Optimize validation RMSE',metric_key='rmse',metric_direction='minimize',
        allowed_edit_paths=['model.py'],budget={'max_trials':2,'max_seconds':300},use_history=True)).to_domain()


def paper(project='p'):
    return PaperInput(project_id=project,paper_id='arxiv-example',version='v1',title='Ridge method paper',
        authors='Test Author',uri='https://example.org/paper',section='abstract',
        text='Ridge regression penalizes squared coefficients and the penalty must be validated on held-out validation data.',
        document_sha256='a'*64)


def test_paper_version_project_idempotence_and_provenance(tmp_path):
    a=AutoResearchAdapter(Settings(tmp_path))
    receipt=enqueue(a.store,paper())
    assert enqueue(a.store,paper())==receipt
    with pytest.raises(PaperConflict): enqueue(a.store,paper().model_copy(update={'text':paper().text+' Changed.'}))
    other=enqueue(a.store,paper('q'))
    assert other['record_id']!=receipt['record_id']
    source=json.loads(LocalPaperSource(a.store,'p').load_paper('arxiv-example'))
    assert source['document_sha256']=='a'*64
    with a.store.connect() as con:
        rows=list(con.execute('SELECT * FROM evo_knowledge'))
    assert len(rows)==2 and all(r['run_id'] is None for r in rows)


class Retriever:
    def __init__(self):self.calls=0;self.closed=0
    def retrieve_joint(self,query,project,limit):
        self.calls+=1
        return [Evidence('paper','p1','Ridge penalizes squared coefficients.','https://example.org/paper'),
                Evidence('experiment','e1','alpha 0.1 validation RMSE 57.03','runs:/m/trial.json')]
    def close(self): self.closed+=1


def test_retrieval_snapshot_immutable_duplicate_and_conflict(tmp_path):
    a=AutoResearchAdapter(Settings(tmp_path,runner='local_trusted'))
    b=Retriever();wf=ResearchWorkflowService(a,lambda:b)
    r=wf.start_research(task())
    assert wf.start_research(task()).run_id==r.run_id
    assert b.calls==1 and b.closed==1
    with pytest.raises(TaskConflict):wf.start_research(replace(task(),objective='Different objective'))
    assert b.calls==1
    snap=a.snapshot(r.run_id)['retrieval_snapshot']
    assert {s['type'] for s in snap['sources']}=={'paper','experiment'}
    assert all(s['sha256']==hashlib.sha256(s['text'].encode()).hexdigest() for s in snap['sources'])
    project=a.store.project(a._run(r.run_id)[0]['engine_project_id'])
    from autoresearch.engine import feedback_context
    context=feedback_context(project,{'rmse':99},[], 'code')
    assert context['task_notes']==snap
    assert 'test' not in context and 'final_evaluation' not in context


def test_control_never_calls_knowledge_backend(tmp_path):
    a=AutoResearchAdapter(Settings(tmp_path,runner='local_trusted'))
    def forbidden():raise AssertionError('Control called Graphiti')
    r=ResearchWorkflowService(a,forbidden).start_research(replace(task(),use_history=False))
    assert a.snapshot(r.run_id)['retrieval_snapshot'] is None


def test_empty_history_does_not_enqueue(tmp_path):
    a=AutoResearchAdapter(Settings(tmp_path,runner='local_trusted'))
    b=Retriever();b.retrieve_joint=lambda *args:[]
    with pytest.raises(KnowledgeUnavailable):ResearchWorkflowService(a,lambda:b).start_research(task())
    with a.store.connect() as con:assert con.execute('SELECT count(*) FROM runs').fetchone()[0]==0


def test_paper_http_and_search_route_not_shadowed(tmp_path,monkeypatch):
    c=TestClient(create_app(Settings(tmp_path),'closed-loop-testing-service-token'))
    assert c.post('/api/papers',json=paper().model_dump()).status_code==401
    c.headers['Authorization']='Bearer closed-loop-testing-service-token'
    receipt=c.post('/api/papers',json=paper().model_dump())
    assert receipt.status_code==202
    rid=receipt.json()['record_id']
    assert c.get(f'/api/knowledge/records/{rid}',params={'project_id':'p'}).status_code==200
    assert c.get(f'/api/knowledge/records/{rid}',params={'project_id':'q'}).status_code==404
    from evoresearch.graphiti_adapter import GraphitiAdapter
    monkeypatch.setattr(GraphitiAdapter,'from_env',lambda store:Retriever())
    assert c.get('/api/knowledge/search',params={'project_id':'p','query':'ridge'}).status_code==200


def test_experiment_worker_has_no_projection_dependency():
    from evoresearch import worker
    source=Path(worker.__file__).read_text()
    assert 'dispatch(' not in source and 'GraphitiAdapter' not in source


def test_engine_rejects_missing_source_type(tmp_path):
    from autoresearch.engine import Engine
    from evoresearch.ridge_tasks import BASELINE
    a=AutoResearchAdapter(Settings(tmp_path,runner='local_trusted'))
    b=Retriever();rid=ResearchWorkflowService(a,lambda:b).start_research(task()).run_id
    e=Engine(a.settings,a.store)
    e.rid=rid;e.root=tmp_path/'proposal';e.project=a.store.project(a._run(rid)[0]['engine_project_id'])
    e.check=lambda:600;e.register=lambda folder:None
    e.proposer=lambda context:{'hypothesis':'Test alpha','rationale':'Paper only','code':BASELINE,'source_ids':['p1']}
    context={'history':[],'task_notes':e.project['plan']['task_notes']}
    with pytest.raises(ValueError,match='missing_source_type'):e.proposal(0,1,context)


def test_enhanced_plan_can_render_upstream_report(tmp_path):
    from autoresearch.engine import Engine
    a=AutoResearchAdapter(Settings(tmp_path,runner='local_trusted'))
    rid=ResearchWorkflowService(a,lambda:Retriever()).start_research(task()).run_id
    e=Engine(a.settings,a.store);e.rid=rid;e.root=tmp_path/'runs'/rid;e.root.mkdir(parents=True)
    e.project=a.store.project(a._run(rid)[0]['engine_project_id']);e.metric='rmse';e.direction='minimize'
    e.report()
    report=(e.root/'report.md').read_text(encoding='utf-8')
    assert 'paper:p1' in report and 'experiment:e1' in report
    assert e.project['plan']['sha256'] in report
