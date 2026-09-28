import argparse
import json
import sys
from pathlib import Path

import numpy as np
from turbovec import IdMapIndex


def normalized(values):
    vectors = np.asarray(values, dtype=np.float32)
    if vectors.ndim != 2 or not vectors.shape[0] or not vectors.shape[1]:
        raise ValueError("Nessun embedding valido nell'indice Brain")
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    if np.any(norms <= 1e-10):
        raise ValueError("Embedding nullo nell'indice Brain")
    return np.ascontiguousarray(vectors / norms, dtype=np.float32)


def build(source, destination, metadata):
    with Path(source).open("r", encoding="utf-8") as handle:
        brain = json.load(handle)
    values = []
    for file_data in brain.get("files", {}).values():
        for chunk in file_data.get("chunks", []):
            values.append(chunk.get("embedding", []))
    vectors = normalized(values)
    index = IdMapIndex(dim=vectors.shape[1], bit_width=4)
    # TQ+ va calibrato prima dell'inserimento. Un campione uniforme e
    # deterministico conserva una buona recall senza duplicare l'indice.
    sample_size = min(2048, vectors.shape[0])
    sample_ids = np.linspace(0, vectors.shape[0] - 1, sample_size, dtype=np.int64)
    index.calibrate(np.ascontiguousarray(vectors[sample_ids]))
    for offset in range(0, vectors.shape[0], 4096):
        batch = vectors[offset:offset + 4096]
        ids = np.arange(offset, offset + len(batch), dtype=np.uint64)
        index.add_with_ids(batch, ids)
    index.prepare()
    Path(destination).parent.mkdir(parents=True, exist_ok=True)
    index.write(destination)
    Path(metadata).write_text(json.dumps({
        "updatedAt": brain.get("updatedAt"),
        "count": int(vectors.shape[0]),
        "dimension": int(vectors.shape[1]),
        "bitWidth": 4,
    }), encoding="utf-8")
    print(json.dumps({"count": int(vectors.shape[0]), "dimension": int(vectors.shape[1])}))


def search(index_path, request_path):
    request = json.loads(Path(request_path).read_text(encoding="utf-8"))
    vector = normalized([request["vector"]])
    index = IdMapIndex.load(index_path)
    allowlist = request.get("allowlist")
    kwargs = {}
    if allowlist:
        kwargs["allowlist"] = np.asarray(allowlist, dtype=np.uint64)
    scores, ids = index.search(vector, k=min(int(request.get("k", 256)), len(index)), **kwargs)
    print(json.dumps({
        "results": [{"id": int(item_id), "score": float(score)} for item_id, score in zip(ids[0], scores[0])]
    }))


def serve():
    cached_path, cached_stamp, cached_index = None, None, None
    projection_path, projection = None, None
    for line in sys.stdin:
        try:
            request = json.loads(line)
            index_path = request["index"]
            stamp = Path(index_path).stat().st_mtime_ns
            if cached_index is None or cached_path != index_path or cached_stamp != stamp:
                cached_index = IdMapIndex.load(index_path)
                cached_path, cached_stamp = index_path, stamp
            vector = normalized([request["vector"]])
            if request.get("projection"):
                if projection_path != request["projection"]:
                    with np.load(request["projection"], allow_pickle=False) as data:
                        projection = (data["mean"], data["components"])
                    projection_path = request["projection"]
                vector = normalized((vector - projection[0]) @ projection[1])
            kwargs = {}
            if request.get("allowlist") == []:
                print(json.dumps({"results": []}), flush=True)
                continue
            if request.get("allowlist") is not None:
                kwargs["allowlist"] = np.asarray(request["allowlist"], dtype=np.uint64)
            scores, ids = cached_index.search(vector, k=min(int(request.get("k", 256)), len(cached_index)), **kwargs)
            result = {"results": [{"id": int(item_id), "score": float(score)} for item_id, score in zip(ids[0], scores[0])]}
        except Exception as error:
            result = {"error": str(error)}
        print(json.dumps(result), flush=True)


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    build_parser = commands.add_parser("build")
    build_parser.add_argument("--source", required=True)
    build_parser.add_argument("--output", required=True)
    build_parser.add_argument("--metadata", required=True)
    search_parser = commands.add_parser("search")
    search_parser.add_argument("--index", required=True)
    search_parser.add_argument("--request", required=True)
    commands.add_parser("serve")
    args = parser.parse_args()
    if args.command == "build":
        build(args.source, args.output, args.metadata)
    elif args.command == "search":
        search(args.index, args.request)
    else:
        serve()


if __name__ == "__main__":
    main()
