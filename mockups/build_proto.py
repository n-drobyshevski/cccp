"""Build cccp-prototype.html from proto.src.html, reusing the data built into cccp-app-page.html."""
import json, sys
page, src, out = sys.argv[1:4]
s = open(page, encoding='utf-8').read()
a = s.index('const D = ') + 10; b = s.index(';\nconst NOTES', a)
data = s[a:b]; json.loads(data.replace('<\\/', '</'))
t = open(src, encoding='utf-8').read(); assert t.count('/*DATA*/') == 1
open(out, 'w', encoding='utf-8').write(t.replace('/*DATA*/', data)); print(len(data) // 1024, 'KB data')
