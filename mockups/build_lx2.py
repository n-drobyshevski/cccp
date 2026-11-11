"""Build cccp-leanix2.html = cccp-settings.html + round-2 LeanIX options (lx2.ext.html)."""
import sys
base, ext, out = sys.argv[1:4]
s = open(base, encoding='utf-8').read(); e = open(ext, encoding='utf-8').read()
css = e.split('<!--CSS-->')[1].split('<!--OPTS-->')[0]
opts = e.split('<!--OPTS-->')[1].split('<!--JS-->')[0].strip()
js = e.split('<!--JS-->')[1]
s = s.replace('<title>CCCP Settings</title>', '<title>CCCP LeanIX Round Two</title>')
a = s.index('</style>'); s = s[:a] + css + s[a:]
a = s.index('<div class="opts">'); b = s.index('<header class="appbar">')
s = s[:a] + opts + '\n' + s[b:]
i = s.rindex('</script>') + len('</script>'); s = s[:i] + '\n' + js + s[i:]
open(out, 'w', encoding='utf-8').write(s); print('ok', len(s)//1024, 'KB')
