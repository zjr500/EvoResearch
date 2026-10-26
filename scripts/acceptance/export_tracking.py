"""Export real MLflow databases and artifacts; rebase paths on the recipient."""
import json
from pathlib import Path
import shutil
import sqlite3


def main():
    root=Path(__file__).resolve().parents[2]
    phase=Path(__file__).resolve().parents[2]
    destination=phase/'.audit-data/exports'
    destination.mkdir(exist_ok=True)
    for name in ('acceptance',):
        source=root/'.audit-data/phase5'/name
        if not (source/'mlflow.db').exists():
            continue
        target=destination/name
        target.mkdir(exist_ok=True)
        with sqlite3.connect(source/'mlflow.db') as src, sqlite3.connect(target/'mlflow.db') as dst:
            src.backup(dst)
        with sqlite3.connect(source/'state.sqlite3') as src, sqlite3.connect(target/'state.sqlite3') as dst:
            src.backup(dst)
        shutil.copytree(source/'mlartifacts',target/'mlartifacts',dirs_exist_ok=True)
    for name in ('closed-loop.json',):
        source=root/'.audit-data/phase5'/name
        if source.exists():
            shutil.copyfile(source,destination/name)
    paper = root / '.audit-data/phase5/paper/ingested-source.json'
    if paper.exists():
        shutil.copyfile(paper,destination/'paper-source.json')
    print(destination)


if __name__=='__main__': main()
