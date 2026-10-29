from contracts.domain import ExperimentTask, ExperimentBudget, RunReceipt, RunStatus

def test_domain_contract_smoke():
    t = ExperimentTask('t1','p1','digits-mlp-v1','increase accuracy','accuracy','maximize',ExperimentBudget(5,3600),('model.py',))
    r = RunReceipt('r1',RunStatus.QUEUED,t.task_id)
    assert r.status.value == 'queued'
