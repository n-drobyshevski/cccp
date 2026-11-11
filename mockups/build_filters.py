"""Build cccp-filters.html from filters.src.html, reusing the data already built into cccp-app-page.html."""
import json, sys
page, src, out = sys.argv[1:4]
s = open(page, encoding='utf-8').read()
a = s.index('const D = ') + 10; b = s.index(';\nconst NOTES', a)
rows = [{k: r[k] for k in ('n', 'd', 'sd', 'g', 'lc', 't', 'o', 'so', 'st', 'why')} for r in json.loads(s[a:b].replace('<\\/', '</'))]
data = json.dumps(rows, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
t = open(src, encoding='utf-8').read(); assert t.count('/*DATA*/') == 1
open(out, 'w', encoding='utf-8').write(t.replace('/*DATA*/', data)); print(len(rows), 'apps,', len(data) // 1024, 'KB')
