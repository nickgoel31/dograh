import os, re
d = 'api/alembic/versions'
revs = {}
downs = set()
for f in os.listdir(d):
    if not f.endswith('.py'): continue
    content = open(os.path.join(d, f), encoding='utf-8').read()
    rev = re.search(r"revision\s*(?::\s*str)?\s*=\s*['\"]([^'\"]+)['\"]", content)
    down = re.search(r"down_revision\s*(?::\s*[^=]+)?\s*=\s*(?:\([^)]+\)|['\"]([^'\"]+)['\"])", content)
    if rev:
        r = rev.group(1)
        revs[r] = f
        if down:
            if down.group(1):
                downs.add(down.group(1))
            else:
                # It might be a tuple like in 2b3c4d5e6f7a_merge_org_fields.py
                t = re.findall(r"['\"]([^'\"]+)['\"]", down.group(0))
                for item in t: downs.add(item)
heads = set(revs.keys()) - downs
print('HEADS:', heads)
for h in heads: print(h, revs[h])
