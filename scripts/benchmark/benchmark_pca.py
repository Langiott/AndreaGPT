"""Held-out query recall against exact original-space neighbors; no training on queries."""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import time
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")
import numpy as np
from turbovec import IdMapIndex

def unit(x):
    x = np.asarray(x, dtype=np.float32)
    return np.ascontiguousarray(x / np.maximum(np.linalg.norm(x, axis=-1, keepdims=True),1e-10))

def benchmark(root, queries):
    meta = json.loads((root / "active.json").read_text())
    folder = root / meta["generation"]
    db = sqlite3.connect(folder / "brain.sqlite")
    original = np.stack([np.frombuffer(row[0], dtype=np.float32) for row in db.execute("SELECT vector FROM chunks ORDER BY id")])
    db.close()
    q = unit([item["vector"] for item in json.loads(queries.read_text())])
    truth = np.argsort(-(q @ original.T),axis=1)[:,:20]
    results = []
    for dim in meta["variants"]:
        projected = q
        if int(dim) != meta["dimension"]:
            with np.load(folder / f"pca-{dim}.npz", allow_pickle=False) as p:
                projected = unit((q-p["mean"]) @ p["components"])
        index = IdMapIndex.load(str(folder / f"vectors-{dim}.tvim"))
        for candidates in [64,96,256,512]:
            samples=[]
            for _ in range(5):
                start=time.perf_counter(); _, ids=index.search(projected,k=min(candidates,len(index)))
                samples.append((time.perf_counter()-start)*1000/len(q))
            recall = lambda k: float(np.mean([len(set(expected[:k]) & set(found))/k for expected,found in zip(truth,ids)]))
            results.append({"dimension":int(dim),"candidates":candidates,"candidateRecallAt5":recall(5),"candidateRecallAt20":recall(20),"meanSearchMsPerQuery":float(np.mean(samples)),**meta["variants"][dim]})
    return {"queries":len(q),"reference":"exact float32 cosine 768D; candidate containment, not semantic correctness","results":results}

if __name__ == "__main__":
    parser=argparse.ArgumentParser(); parser.add_argument("--root",required=True); parser.add_argument("--queries",required=True); parser.add_argument("--output",required=True)
    args=parser.parse_args(); report=benchmark(Path(args.root),Path(args.queries)); Path(args.output).write_text(json.dumps(report,indent=2)); print(json.dumps(report))
