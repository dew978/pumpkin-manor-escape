import json, os, sys
import pyarrow.parquet as pq

root = sys.argv[1]
out = sys.argv[2]
t = pq.read_table(os.path.join(root, "data", "train-00000-of-00001.parquet"))
cols = [c for c in t.column_names if c not in ("preview",)]
print("columns:", t.column_names, file=sys.stderr)
rows = t.select(cols).to_pylist()
res = []
for r in rows:
    outs = r.get("outputs") or {}
    files = []
    def walk(o):
        if isinstance(o, dict):
            p = o.get("path")
            if isinstance(p, str):
                files.append(p)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(outs)
    glbs = []
    for f in files:
        if f.lower().endswith(".glb"):
            full = os.path.join(root, f)
            glbs.append({"path": f, "size": os.path.getsize(full) if os.path.exists(full) else None})
    prompt = r.get("prompt")
    if not isinstance(prompt, str):
        prompt = json.dumps(r.get("inputs", {}).get("prompt"), ensure_ascii=False) if isinstance(r.get("inputs"), dict) else ""
    res.append({"id": r.get("id") or r.get("example_id"), "prompt": prompt, "glbs": glbs,
                "preview": (r.get("preview_file") or {}).get("path") if isinstance(r.get("preview_file"), dict) else r.get("preview_file")})
with open(out, "w", encoding="utf-8") as f:
    json.dump(res, f, ensure_ascii=False, indent=0)
print("rows", len(res), "with glb", sum(1 for r in res if r["glbs"]), file=sys.stderr)
print(json.dumps(rows[0], ensure_ascii=False, default=str)[:1500], file=sys.stderr)
