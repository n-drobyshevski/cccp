"""Build cccp-leanix.html: prototype source + LeanIX-direction extensions (lx.ext.html), data from cccp-app-page.html."""
import sys
proto, ext, page, out = sys.argv[1:5]
s = open(proto, encoding='utf-8').read(); e = open(ext, encoding='utf-8').read()
css = e.split('<!--CSS-->')[1].split('<!--HTML-->')[0]
html = e.split('<!--HTML-->')[1].split('<!--JS-->')[0]
js = e.split('<!--JS-->')[1]
s = s.replace('<title>CCCP Prototype</title>', '<title>CCCP LeanIX Direction</title>')
a = s.index('</style>'); s = s[:a] + css + s[a:]
a = s.index('<div class="shell">'); b = s.index('<div id="root"></div>') + len('<div id="root"></div>')
s = s[:a] + html.rstrip() + s[b:].replace('<div id="root"></div>', '', 0)
assert s.count('\nroute();\n</script>') == 1
s = s.replace('\nroute();\n</script>', '\n</script>\n' + js)
p = open(page, encoding='utf-8').read(); i = p.index('const D = ') + 10; j = p.index(';\nconst NOTES', i)
assert s.count('/*DATA*/') == 1; s = s.replace('/*DATA*/', p[i:j])
open(out, 'w', encoding='utf-8').write(s); print('ok', len(s)//1024, 'KB')
