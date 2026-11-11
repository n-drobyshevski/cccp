"""Build cccp-settings.html = cccp-leanix.html (light, sections, data quality) + settings mockups (st.ext.html)."""
import sys
lx, ext, out = sys.argv[1:4]
s = open(lx, encoding='utf-8').read(); e = open(ext, encoding='utf-8').read()
css = e.split('<!--CSS-->')[1].split('<!--OPTS-->')[0]
opts = e.split('<!--OPTS-->')[1].split('<!--JS-->')[0].strip()
js = e.split('<!--JS-->')[1]
s = s.replace('<title>CCCP LeanIX Direction</title>', '<title>CCCP Settings</title>')
a = s.index('</style>'); s = s[:a] + css + s[a:]
a = s.index('<div class="opts">'); b = s.index('<header class="appbar">')
s = s[:a] + opts + '\n' + s[b:]
s = s.replace('const O = {shell:\'bar\', page:\'sections\', dq:\'on\'};', "const O = {shell:'light', page:'sections', dq:'on', set:'tabs'};")
# the option-strip handler from the LeanIX page must ignore the new "set" switch
old = "document.querySelector('.opts').addEventListener('click',e=>{ const b = e.target.closest('.seg button'); if(!b) return;"
assert s.count(old) == 1; s = s.replace(old, "document.querySelector('.opts').addEventListener('click',e=>{ const b = e.target.closest('.seg button'); if(!b || b.parentElement.dataset.o==='set') return;")
i = s.rindex('</script>') + len('</script>'); s = s[:i] + '\n' + js + s[i:]
open(out, 'w', encoding='utf-8').write(s); print('ok', len(s)//1024, 'KB')
