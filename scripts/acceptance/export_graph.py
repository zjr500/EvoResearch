"""Read-only Graphiti evidence snapshot and cross-system trace map."""
import json
from pathlib import Path
from neo4j import GraphDatabase
from closed_loop_acceptance import configure, PROJECT
from autoresearch.config import Settings
from evoresearch.adapter import AutoResearchAdapter
from evoresearch.graphiti_adapter import project_group
import os


def main():
    root = configure()
    adapter = AutoResearchAdapter(Settings.from_env())
    with adapter.store.connect() as con:
        rows = [dict(r) for r in con.execute('SELECT * FROM evo_knowledge WHERE project_id=?', (PROJECT,))]
    assert len(rows) == 5 and all(r['status'] == 'retrievable' for r in rows)
    with GraphDatabase.driver(os.environ['GRAPHITI_URI'], auth=('neo4j', os.environ['GRAPHITI_PASSWORD'])) as driver:
        nodes, _, _ = driver.execute_query('MATCH (n {group_id:$group}) RETURN labels(n) AS labels, properties(n) AS properties', group=project_group(PROJECT))
        edges, _, _ = driver.execute_query('MATCH (a)-[r]->(b) WHERE a.group_id=$group AND b.group_id=$group RETURN a.uuid AS source, b.uuid AS target, type(r) AS type, properties(r) AS properties', group=project_group(PROJECT))
    def clean(records):
        result = []
        for record in records:
            value = record.data()
            value['properties'] = {k:v for k,v in value['properties'].items() if 'embedding' not in k}
            result.append(value)
        return result
    nodes, edges = clean(nodes), clean(edges)
    episode_ids = {n['properties']['uuid'] for n in nodes if 'Episodic' in n['labels']}
    assert all(r['episode_id'] in episode_ids for r in rows)
    trace=[]
    for row in rows:
        body=json.loads(row['body'])
        trace.append({'record_id':row['record_id'],'episode_id':row['episode_id'],
                      'run_id':row['run_id'],'source':body.get('source'),
                      'knowledge_record':body,'status':row['status']})
    output=root/'.audit-data/exports'
    output.mkdir(exist_ok=True)
    (output/'graphiti-snapshot.json').write_text(json.dumps({'group_id':project_group(PROJECT),'nodes':nodes,'edges':edges,'trace':trace},ensure_ascii=False,indent=2,default=str),encoding='utf-8')
    print(json.dumps({'records':len(rows),'nodes':len(nodes),'edges':len(edges),'episodes':len(episode_ids)}))


if __name__=='__main__':main()
