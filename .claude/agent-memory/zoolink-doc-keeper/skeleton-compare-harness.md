---
name: skeleton-compare-harness
description: Python harness to verify EN↔RU OpenAPI yaml are structurally identical except translated prose
metadata:
  type: reference
---

For EN↔RU yaml mirror verification (identifiers/numbers/structure identical, only prose translated), this
check is fast and reliable — run from `ZooLink/`:

```python
import yaml, json
def skel(o):
    if isinstance(o,dict):
        return {k:(skel(v) if k not in ('description','summary') else '<<prose>>') for k,v in o.items()}
    if isinstance(o,list): return [skel(x) for x in o]
    return o
a=yaml.safe_load(open('docs/03-architecture/api-contracts/X.yaml'))
b=yaml.safe_load(open('docsRU/03-architecture/api-contracts/X.yaml'))
print(json.dumps(skel(a),sort_keys=True)==json.dumps(skel(b),sort_keys=True))
```

`title` in `info` and inline flow-map values are also compared. **Pitfall caught once:** an inline
`{ description: text, with a comma }` parses the post-comma fragment as a second map key → structure
mismatch. Quote prose with commas, or use block style `description:` on its own line. Also scan residual
snake_case body keys by collecting all keys under `properties:` and flagging those containing `_`.
