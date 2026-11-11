"""Build cccp-app-page.html: real (anonymized) inventory + generated placeholder security values."""
import csv, json, random, sys
from datetime import date, timedelta
csv_path, src, out = sys.argv[1:4]
TODAY = date(2026, 11, 11)
def rdate(r, lo, hi): return TODAY - timedelta(days=r.randint(lo, hi))
def old(d, days): return (TODAY - d).days > days
rows = []
for x in csv.DictReader(open(csv_path, encoding='utf-8')):
    r = random.Random(x['UUID'])
    t = int(x['Tiering']) if x['Tiering'].strip() else 0
    p = {1: .92, 2: .8, 3: .65, 4: .5, 0: .35}[t]
    so, lc, ty = x['Security Officer Name'].strip(), x['Lifecycle'], x['Typology'].title()
    st, why = [], []
    # Cyber
    ex = r.random() < .35
    pt = rdate(r, 30, 1000) if r.random() < p * .8 else None
    f = r.choices(['None', '1 medium', f'{r.randint(1,3)} high', '1 critical'], [.6, .15, .15, .1])[0] if pt else ''
    if not so: s = ('bad', 'No security officer assigned')
    elif not pt: s = ('bad', 'Internet exposed, never tested') if ex else ('none', 'No pentest on record')
    elif 'critical' in f: s = ('bad', '1 critical finding open')
    elif 'high' in f: s = ('warn', f + ' findings open' if f[0] != '1' else '1 high finding open')
    elif old(pt, 540): s = ('warn', 'Pentest older than 18 months')
    else: s = ('ok', 'Pentest clean' if f == 'None' else '1 medium finding, planned')
    st.append(s[0]); why.append(s[1])
    # Compliance
    lo = 2 if t in (1, 2) else 1
    ciat = [r.randint(lo, 4) for _ in range(4)] if r.random() < p + .08 else None
    val = rdate(r, 20, 1100) if ciat and r.random() < p else None
    au = rdate(r, 40, 1100) if r.random() < p * .6 else None
    aur = r.choices(['Passed', '1 minor finding', '2 major findings'], [.7, .2, .1])[0] if au else ''
    if not ciat: s = ('none', 'Not classified')
    elif not val: s = ('warn', 'Classification awaiting validation')
    elif 'major' in aur: s = ('bad', '2 major audit findings')
    elif old(val, 730): s = ('warn', 'Classification older than 2 years')
    else: s = ('ok', 'Classification validated')
    st.append(s[0]); why.append(s[1])
    # Continuity
    rto = r.choice({1: [1, 2, 4], 2: [4, 8, 24], 3: [24, 48], 4: [48, 72], 0: [8, 24, 48]}[t]) if r.random() < p + .05 else None
    rpo = r.choice([0, 1, 4, 24]) if rto else None
    mtd = rto * r.choice([1, 2]) if rto else None
    dt = rdate(r, 20, 1100) if rto and r.random() < p * .75 else None
    dtr = ('Passed' if r.random() < .87 else 'Failed') if dt else ''
    if not rto: s = ('none', 'No DRP data')
    elif not dt: s = ('bad', 'No DRP test on record') if t in (1, 2) else ('warn', 'DRP never tested')
    elif dtr == 'Failed': s = ('bad', 'Last DRP test failed')
    elif old(dt, 730): s = ('warn', 'DRP test older than 2 years')
    else: s = ('ok', 'DRP tested, passed')
    st.append(s[0]); why.append(s[1])
    # Platform
    h = r.choices(['Cloud', 'SaaS', 'On-premise', 'Hybrid'], [.3, .5, .1, .1] if ty == 'Buy' else [.7, .05, .15, .1])[0]
    sso = r.random() < .85
    if lc in ('END_OF_LIFE', 'END_OF_SUPPORT'): s = ('bad', 'Past end of life, still running')
    elif lc == 'DECOMMISSIONING': s = ('warn', 'Being decommissioned')
    elif not sso: s = ('warn', 'No single sign-on')
    elif not ty: s = ('none', 'Typology not set')
    else: s = ('ok', 'Complete')
    st.append(s[0]); why.append(s[1])
    yn = lambda b: 'Yes' if b else 'No'
    iso = lambda d: d.isoformat() if d else ''
    rows.append(dict(n=x['Name'], d=x['Domain'] or 'NO DOMAIN', sd=x['Subdomain'], g=x['Support Group'], lc=lc, ty=ty, t=t,
        o=x['Owner Name'], bo=x['Backup Owner Name'], so=so, ex=yn(ex), pt=[iso(pt), f], ciat=ciat,
        pd=yn(r.random() < .3) if ciat else '', psd=yn(r.random() < .08) if ciat else '', csd=yn(r.random() < .2) if ciat else '',
        val=iso(val), au=[iso(au), aur], rto=rto, rpo=rpo, mtd=mtd, dt=[iso(dt), dtr], h=h, sso=yn(sso),
        iu=r.choice(['<20', '20-100', '100-500', '500+']), eu=r.choices(['0', '<20', '20-100', '500+'], [.7, .1, .1, .1])[0], st=st, why=why))
rows.sort(key=lambda a: (a['d'], a['n'].lower()))
data = json.dumps(rows, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
t = open(src, encoding='utf-8').read(); assert t.count('/*DATA*/') == 1
open(out, 'w', encoding='utf-8').write(t.replace('/*DATA*/', data))
print(len(rows), 'apps,', len(data) // 1024, 'KB data')
