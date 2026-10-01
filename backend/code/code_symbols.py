"""Parse Python syntax without importing or executing the inspected module."""
import ast
import json
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text(encoding="utf-8-sig")
tree = ast.parse(source)
lines = source.splitlines()
symbols, imports = [], []
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        imports.extend(alias.name for alias in node.names)
    elif isinstance(node, ast.ImportFrom):
        imports.append("." * node.level + (node.module or ""))
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        calls = sorted({ast.unparse(child.func) for child in ast.walk(node) if isinstance(child, ast.Call)})[:100]
        symbols.append({"name": node.name, "kind": type(node).__name__, "startLine": node.lineno,
            "endLine": node.end_lineno, "signature": lines[node.lineno - 1][:300], "references": calls})
print(json.dumps({"symbols": symbols, "imports": imports}))
