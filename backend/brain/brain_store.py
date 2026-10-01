"""Offline, versioned SQLite/FTS5 + TurboVec snapshots. Never edits the source index."""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid

# Avoid excessive BLAS thread startup for small query matrices.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")
import numpy as np


def unit(v):
    v = np.asarray(v, dtype=np.float32)
    norms = np.linalg.norm(v, axis=-1, keepdims=True)
    if not np.isfinite(v).all() or np.any(norms < 1e-10):
        raise ValueError("Invalid or zero embedding")
    return np.ascontiguousarray(v / norms)


def build(source, output, dimensions=(384, 256), graph=True):
    from turbovec import IdMapIndex
    began = time.perf_counter()
    source = Path(source)
    before = source.stat()
    brain = json.loads(source.read_text(encoding="utf-8"))
    chunks = [c for f in brain["files"].values() for c in f["chunks"]]
    vectors = unit([c["embedding"] for c in chunks])
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    generation = root / ("store-" + uuid.uuid4().hex)
    generation.mkdir()
    db = sqlite3.connect(generation / "brain.sqlite")
    db.executescript("""
      CREATE TABLE chunks (id INTEGER PRIMARY KEY, path TEXT NOT NULL, data TEXT NOT NULL, vector BLOB NOT NULL);
      CREATE INDEX chunk_paths ON chunks(path);
      CREATE VIRTUAL TABLE passages USING fts5(path, section, text, tokenize='unicode61 remove_diacritics 2');
      CREATE TABLE edges (source INTEGER, target INTEGER, similarity REAL, PRIMARY KEY(source,target));
      CREATE TABLE files (path TEXT PRIMARY KEY, count INTEGER);
      CREATE VIRTUAL TABLE vocabulary USING fts5vocab(passages, 'row');
    """)
    for i, c in enumerate(chunks):
        data = {k: v for k, v in c.items() if k != "embedding"}
        db.execute("INSERT INTO chunks VALUES(?,?,?,?)", (i, c["path"], json.dumps(data, ensure_ascii=False), vectors[i].tobytes()))
        db.execute("INSERT INTO passages(rowid,path,section,text) VALUES(?,?,?,?)", (i, c["path"], c.get("section", ""), c["text"]))
    db.executemany("INSERT INTO files VALUES(?,?)", [(p, len(f["chunks"])) for p, f in brain["files"].items()])
    db.commit()
    # Fit only on documents; query evaluation must be held out from PCA fitting.
    sample = vectors[np.linspace(0, len(vectors) - 1, min(8192, len(vectors)), dtype=np.int64)]
    mean = sample.mean(axis=0)
    covariance = (sample - mean).T @ (sample - mean) / max(1, len(sample) - 1)
    eigenvalues, components = np.linalg.eigh(covariance.astype(np.float64))
    components = components[:, ::-1].astype(np.float32)
    variants = {}
    for dimension in [vectors.shape[1], *dimensions]:
        if dimension > min(vectors.shape[1], len(sample) - 1) and dimension != vectors.shape[1]:
            continue
        reduced = vectors if dimension == vectors.shape[1] else unit((vectors - mean) @ components[:, :dimension])
        index = IdMapIndex(dim=dimension, bit_width=4)
        index.calibrate(reduced[np.linspace(0, len(reduced)-1, min(2048,len(reduced)), dtype=np.int64)])
        for offset in range(0, len(reduced), 4096):
            index.add_with_ids(reduced[offset:offset+4096], np.arange(offset, min(offset+4096,len(reduced)), dtype=np.uint64))
        index.prepare()
        index.write(str(generation / f"vectors-{dimension}.tvim"))
        if dimension != vectors.shape[1]:
            np.savez(generation / f"pca-{dimension}.npz", mean=mean, components=components[:, :dimension])
        variants[str(dimension)] = {"bytes": (generation / f"vectors-{dimension}.tvim").stat().st_size,
            "variance": 1.0 if dimension == vectors.shape[1] else float(eigenvalues[-dimension:].sum()/eigenvalues.sum())}
        if graph and dimension == vectors.shape[1]:
            for offset in range(0, len(vectors), 128):
                _, ids = index.search(vectors[offset:offset+128], k=min(9,len(vectors)))
                for row, neighbors in enumerate(ids):
                    i = offset + row
                    scored = sorted(((int(j), float(vectors[i] @ vectors[int(j)])) for j in neighbors if int(j) != i and int(j) >= 0), key=lambda v: -v[1])[:4]
                    db.executemany("INSERT OR IGNORE INTO edges VALUES(?,?,?)", [(i,j,s) for j,s in scored if s >= .58])
            db.commit()
    db.close()
    after = source.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise RuntimeError("Source changed during build; snapshot not published")
    manifest = {"schema": 1, "generation": generation.name, "updatedAt": brain["updatedAt"], "model": brain["model"],
        "sourceSize": after.st_size, "sourceMtimeMs": after.st_mtime_ns / 1e6,
        "dimension": int(vectors.shape[1]), "count": len(chunks), "files": len(brain["files"]), "errors": brain["errors"],
        "variants": variants, "graph": graph, "buildMs": round((time.perf_counter()-began)*1000)}
    temporary = root / (uuid.uuid4().hex + ".json")
    temporary.write_text(json.dumps(manifest), encoding="utf-8")
    os.replace(temporary, root / "active.json")
    print(json.dumps({k:v for k,v in manifest.items() if k != "errors"}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--no-graph", action="store_true")
    args = parser.parse_args()
    build(args.source, args.output, graph=not args.no_graph)
