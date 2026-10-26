"""Versioned paper source snapshots, queued through the shared Graphiti pipeline."""
from dataclasses import asdict
import hashlib
import json
import time
from pydantic import Field, field_validator
from .models import StrictModel
from .knowledge import initialize as initialize_knowledge, stable_id
from contracts.domain import KnowledgeRecord


class PaperInput(StrictModel):
    project_id: str=Field(min_length=1,max_length=128,pattern=r'^[A-Za-z0-9_-]+$')
    paper_id: str=Field(min_length=1,max_length=128,pattern=r'^[A-Za-z0-9_.-]+$')
    version: str=Field(min_length=1,max_length=32)
    title: str=Field(min_length=3,max_length=500)
    authors: str=Field(min_length=1,max_length=500)
    uri: str=Field(min_length=8,max_length=1000,pattern=r'^https://')
    section: str=Field(min_length=1,max_length=300)
    text: str=Field(min_length=50,max_length=16000)
    document_sha256: str=Field(pattern=r'^[a-f0-9]{64}$')
    @field_validator('uri')
    @classmethod
    def no_embedded_credentials(cls,value):
        from urllib.parse import urlparse
        parsed=urlparse(value)
        if not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('Invalid citation URI')
        return value


class PaperConflict(ValueError): pass


def initialize(store):
    initialize_knowledge(store)
    with store.connect() as con:
        con.execute('''CREATE TABLE IF NOT EXISTS evo_papers (
          project_id TEXT NOT NULL,paper_id TEXT NOT NULL,version TEXT NOT NULL,
          body TEXT NOT NULL,digest TEXT NOT NULL,record_id TEXT NOT NULL UNIQUE,
          created REAL NOT NULL,PRIMARY KEY(project_id,paper_id,version))''')


def enqueue(store,paper):
    initialize(store)
    body=json.dumps(paper.model_dump(),ensure_ascii=False,sort_keys=True)
    digest=hashlib.sha256(body.encode()).hexdigest()
    source=f'paper:{paper.project_id}:{paper.paper_id}:{paper.version}'
    rid=stable_id(paper.project_id,source)
    record=KnowledgeRecord(rid,paper.project_id,'paper',source,
        f'Paper {paper.title}, {paper.authors}, {paper.version}. Section: {paper.section}. '+paper.text,
        ({'type':'Paper','id':paper.paper_id,'title':paper.title,'version':paper.version,
          'document_sha256':paper.document_sha256,'excerpt_sha256':hashlib.sha256(paper.text.encode()).hexdigest()},),
        (), (paper.uri,))
    encoded=json.dumps(asdict(record),ensure_ascii=False,sort_keys=True)
    with store.connect() as con:
        con.execute('BEGIN IMMEDIATE')
        existing=con.execute('SELECT digest FROM evo_papers WHERE project_id=? AND paper_id=? AND version=?',
                             (paper.project_id,paper.paper_id,paper.version)).fetchone()
        if existing and existing[0]!=digest:
            raise PaperConflict('Paper version already exists with different source content')
        con.execute('INSERT OR IGNORE INTO evo_papers VALUES(?,?,?,?,?,?,?)',
            (paper.project_id,paper.paper_id,paper.version,body,digest,rid,time.time()))
        con.execute('''INSERT OR IGNORE INTO evo_knowledge
          (record_id,event_id,project_id,body,digest,updated) VALUES(?,?,?,?,?,?)''',
          (rid,source,paper.project_id,encoded,hashlib.sha256(encoded.encode()).hexdigest(),time.time()))
    return {'record_id':rid,'paper_id':paper.paper_id,'version':paper.version}


class LocalPaperSource:
    def __init__(self,store,project_id): self.store,self.project_id=store,project_id
    def load_paper(self,paper_id):
        initialize(self.store)
        with self.store.connect() as con:
            row=con.execute('SELECT body FROM evo_papers WHERE project_id=? AND paper_id=? ORDER BY created DESC LIMIT 1',
                            (self.project_id,paper_id)).fetchone()
        if not row: raise KeyError(paper_id)
        return row[0].encode()
