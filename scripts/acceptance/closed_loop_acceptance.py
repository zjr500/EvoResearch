"""Real paper + history -> DeepSeek -> training -> Graphiti -> next experiment."""
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import httpx

from autoresearch.config import Settings
from evoresearch.adapter import AutoResearchAdapter
from evoresearch.models import TaskInput
from evoresearch.papers import PaperInput,enqueue
from evoresearch.workflow import ResearchWorkflowService
from evoresearch.worker import main as worker
from evoresearch.projection_worker import main as projection
from evoresearch.knowledge import records
from evoresearch.graphiti_adapter import GraphitiAdapter

PROJECT='phase5-real-closed-loop'


def configure():
    root=Path(__file__).resolve().parents[2]
    os.environ.setdefault('AUTORESEARCH_HOME',str(root/'.audit-data/phase5/acceptance'))
    os.environ['AUTORESEARCH_RUNNER']='local_trusted'
    os.environ['AUTORESEARCH_PROVIDER']='openai_compatible'
    os.environ.setdefault('GRAPHITI_URI','bolt://127.0.0.1:17687')
    for name in ('GRAPHITI_PASSWORD','AUTORESEARCH_MODEL_API_KEY'):
        if not os.environ.get(name):raise RuntimeError(f'Set {name} in the environment')
    os.environ.setdefault('AUTORESEARCH_MODEL_BASE_URL','https://api.deepseek.com')
    os.environ.setdefault('AUTORESEARCH_MODEL','deepseek-v4-flash')
    os.environ['GRAPHITI_EMBEDDING_CACHE']=str(root/'.audit-cache/phase4-embeddings')
    os.environ['GRAPHITI_TELEMETRY_ENABLED']='false'
    return root


def task(name,history,objective='Optimize diabetes Ridge validation RMSE by changing only alpha. Explain the plan before training.'):
    return TaskInput.model_validate(dict(project_id=PROJECT,task_id=name,template_id='diabetes-ridge-v1',
        objective=objective,metric_key='rmse',metric_direction='minimize',allowed_edit_paths=['model.py'],
        budget={'max_trials':2,'max_seconds':600},use_history=history)).to_domain()


def provenance(adapter,rid):
    run=adapter.snapshot(rid)
    project=adapter.store.project(adapter._run(rid)[0]['engine_project_id'])
    folder=adapter.store.home/'runs'/rid
    proposals=[]
    for path in sorted(folder.glob('trials/*/proposal-*/proposal.json')):
        value=json.loads(path.read_text(encoding='utf-8'))
        context=json.loads(path.with_name('context.json').read_text(encoding='utf-8'))
        proposals.append({'path':str(path.relative_to(folder)),'proposal':value,
                          'context_sha256':hashlib.sha256(path.with_name('context.json').read_bytes()).hexdigest(),
                          'available_sources':context.get('task_notes',{}).get('sources',[])})
    calls=[json.loads(p.read_text(encoding='utf-8')) for p in sorted(folder.rglob('*.model_call.json'))]
    return {'snapshot':run,'project':project,'proposals':proposals,'model_calls':calls,
            'trials':adapter.store.trials(rid)}


def main():
    root=configure();phase=Path(__file__).resolve().parents[2]
    output=root/'.audit-data/phase5';output.mkdir(parents=True,exist_ok=True)
    a=AutoResearchAdapter(Settings.from_env())
    wf=ResearchWorkflowService(a)
    # Official versioned source, with exact downloaded document hash. Only an
    # explicitly labelled paraphrase is ingested; not a claim of full-text ingestion.
    source=output/'paper/source.html';source.parent.mkdir(exist_ok=True)
    if not source.exists():
        response=httpx.get('https://arxiv.org/abs/1509.09169v9',timeout=60,follow_redirects=True)
        response.raise_for_status();source.write_bytes(response.content)
    assert b'Lecture notes on ridge regression' in source.read_bytes()
    paper=PaperInput(project_id=PROJECT,paper_id='arxiv-1509.09169',version='v9',
        title='Lecture notes on ridge regression',authors='Wessel N. van Wieringen',
        uri='https://arxiv.org/abs/1509.09169v9',section='Abstract — source-grounded paraphrase',
        document_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
        text='Ridge regression augments the regression loss with a penalty on squared coefficients. '
             'This addresses estimation identifiability problems in high-dimensional regression. '
             'The paper reviews estimator moments, mean squared error, constrained-estimation and Bayesian interpretations. '
             'It also discusses generalized penalties and logistic regression. '
             'The abstract does not provide a diabetes dataset result or an optimal alpha for this experiment; '
             'parameter choices remain hypotheses to evaluate on validation data.')
    paper_receipt=enqueue(a.store,paper)
    assert enqueue(a.store,paper)==paper_receipt
    (output/'paper/ingested-source.json').write_text(paper.model_dump_json(indent=2),encoding='utf-8')
    # History is measured in a real seed run, not hand-entered scores.
    seed_task=task('history-seed',False)
    seed_settings=Settings(a.store.home,runner='local_trusted',provider='feedback_demo')
    seed_adapter=AutoResearchAdapter(seed_settings)
    seed=seed_adapter.start(seed_task,[]).run_id
    if a.status(seed).value=='queued':
        from autoresearch.engine import Engine
        Engine(seed_settings,a.store).run(a.store.claim())
    assert a.status(seed).value=='completed'
    projection(once=True)
    assert records(a.store,seed)[0]['status']=='retrievable',records(a.store,seed)
    with a.store.connect() as con:
        assert con.execute('SELECT status FROM evo_knowledge WHERE record_id=?',(paper_receipt['record_id'],)).fetchone()[0]=='retrievable'
    print('paper and historical seed are retrievable',flush=True)
    # Freeze enhanced evidence before either comparison arm runs or flows back.
    enhanced=wf.start_research(task('enhanced',True)).run_id
    control=wf.start_research(task('control',False)).run_id
    snapshot=a.snapshot(enhanced)['retrieval_snapshot']
    assert {s['type'] for s in snapshot['sources']}=={'paper','experiment'}
    # A separate process holds the knowledge lock while experiments train.
    blocker=subprocess.Popen([sys.executable,'-c',
        'from autoresearch.worker import WorkerLock;from pathlib import Path;import sys,time;'
        'lock=WorkerLock(Path(sys.argv[1]));lock.__enter__();print("locked",flush=True);time.sleep(900)',
        str(a.store.home/'ingestion.lock')],stdout=subprocess.PIPE,text=True)
    try:
        assert blocker.stdout.readline().strip()=='locked'
        worker(once=True)
    finally:
        blocker.terminate();blocker.wait(timeout=10)
    for rid in (enhanced,control):
        assert a.status(rid).value=='completed',a.snapshot(rid)
        assert len(a.store.trials(rid))==2 and all(t['status']=='valid' for t in a.store.trials(rid))
    e=provenance(a,enhanced);c=provenance(a,control)
    assert e['project']['budget']==c['project']['budget']
    assert e['model_calls'] and c['model_calls']
    assert c['snapshot']['retrieval_snapshot'] is None
    required={s['id'] for s in snapshot['sources']}
    declared={sid for p in e['proposals'] for sid in p['proposal'].get('source_ids',[])}
    assert declared and declared<=required
    print('real model enhanced/control completed under identical budgets',flush=True)
    projection(once=True)
    enhanced_record=records(a.store,enhanced)[0]
    assert enhanced_record['status']=='retrievable',enhanced_record
    nxt=wf.start_research(task('next-experiment',True,
        f'Optimize diabetes Ridge validation RMSE using paper guidance and the newly completed experiment {enhanced}; '
        'explain how its validated alpha observations influence the next code change.')).run_id
    next_sources=a.snapshot(nxt)['retrieval_snapshot']['sources']
    assert enhanced_record['record_id'] in {s['id'] for s in next_sources},next_sources
    worker(once=True)
    assert a.status(nxt).value=='completed',a.snapshot(nxt)
    n=provenance(a,nxt)
    assert all(t['status']=='valid' for t in n['trials'])
    assert any(enhanced_record['record_id'] in p['proposal'].get('source_ids',[]) for p in n['proposals'])
    projection(once=True)
    backend=GraphitiAdapter.from_env(a.store)
    try:
        hits=backend.retrieve_joint('ridge regression regularization validation RMSE',PROJECT,12)
    finally:backend.close()
    report={'paper':paper.model_dump(),'paper_receipt':paper_receipt,'history_run_id':seed,
        'enhanced':provenance(a,enhanced),'control':provenance(a,control),'next':provenance(a,nxt),
        'joint_results':[asdict(x) for x in hits],
        'checks':{'real_paper_ingested':True,'joint_retrieval':True,'real_llm_training':True,
                  'next_uses_previous_knowledge':True,'equal_experiment_budgets':True,
                  'experiment_worker_independent_of_ingestion_lock':True},
        'limitations':['One paired comparison, not statistical evidence of superiority.',
                      'Knowledge preparation/retrieval cost reported separately from fixed experiment budget.',
                      'Paper abstract paraphrase only, not full-paper ingestion.']}
    (output/'closed-loop.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'report':str(output/'closed-loop.json'),'enhanced':enhanced,'control':control,'next':nxt}),flush=True)


if __name__=='__main__':main()
