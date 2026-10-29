import asyncio,sys
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[2] / "apps/workbench"))
from projection import configure_deepseek

def test_long_document_json_settings_preserve_request():
    seen=[]
    async def create(**kwargs):seen.append(kwargs);return {'ok':True}
    llm=SimpleNamespace(client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))),max_tokens=8192)
    configure_deepseek(llm)
    result=asyncio.run(llm.client.chat.completions.create(model='deepseek-v4-flash',messages=[{'role':'user','content':'json'}],response_format={'type':'json_object'}))
    assert result=={'ok':True} and llm.max_tokens==16384
    assert seen[0]['extra_body']=={'thinking':{'type':'disabled'}}
    assert seen[0]['response_format']=={'type':'json_object'}
