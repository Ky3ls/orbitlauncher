"""Pulls every user-visible German text out of the launcher (JS strings, template literals, HTML, C# messages).
Output: segments.json  {"exact": [...], "tpl": [...]}  where tpl entries use {0},{1} for the ${...} parts."""
import json, re, sys, os

ROOT = '/home/orbittweak/OrbitLauncher'
OUT = os.path.dirname(os.path.abspath(__file__))

def js_literals(src):
    """Yields (kind, parts) for each string literal; template parts are text and None (= ${...})."""
    i, n = 0, len(src)
    last_sig = ''  # last significant char, for regex detection
    out = []
    def read_template(i):
        parts, buf = [], []
        i += 1
        while i < n:
            c = src[i]
            if c == '\\': buf.append(src[i:i + 2]); i += 2; continue
            if c == '`': parts.append(''.join(buf)); return parts, i + 1
            if c == '$' and i + 1 < n and src[i + 1] == '{':
                parts.append(''.join(buf)); buf = []
                i = read_expr(i + 2)
                parts.append(None)
                continue
            buf.append(c); i += 1
        return parts, i
    def read_expr(i):
        depth = 1
        while i < n and depth:
            c = src[i]
            if c in '\'"':
                j = skip_str(i); out.append(('s', [unescape(src[i + 1:j - 1])])); i = j; continue
            if c == '`':
                parts, i = read_template(i); out.append(('t', parts)); continue
            if c == '{': depth += 1
            elif c == '}': depth -= 1
            i += 1
        return i
    def skip_str(i):
        q = src[i]; i += 1
        while i < n and src[i] != q:
            if src[i] == '\\': i += 2; continue
            if src[i] == '\n': break
            i += 1
        return i + 1
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i); i = n if j < 0 else j; continue
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2); i = n if j < 0 else j + 2; continue
        if c == '/' and (last_sig == '' or last_sig in '(,=:[!&|?{};+-*%<>~^' or src[max(0, i - 7):i].rstrip().endswith('return')):
            # regex literal
            j = i + 1; cls = False
            while j < n:
                d = src[j]
                if d == '\\': j += 2; continue
                if d == '[': cls = True
                elif d == ']': cls = False
                elif d == '/' and not cls: break
                elif d == '\n': break
                j += 1
            i = j + 1
            while i < n and src[i].isalpha(): i += 1
            last_sig = ')'
            continue
        if c in '\'"':
            j = skip_str(i); out.append(('s', [unescape(src[i + 1:j - 1])])); i = j; last_sig = ')'; continue
        if c == '`':
            parts, i = read_template(i); out.append(('t', parts)); last_sig = ')'; continue
        if not c.isspace(): last_sig = c if not (c.isalnum() or c in '_$') else 'a'
        i += 1
    return out

def unescape(s):
    return s.replace("\\'", "'").replace('\\"', '"').replace('\\n', '\n').replace('\\\\', '\\')

GER = re.compile(r'[äöüÄÖÜß]|\b(der|die|das|und|oder|nicht|mit|für|von|zu|ist|wird|werden|auf|aus|bei|noch|kein|keine|alle|neu|neue|jetzt|hier|dein|deine|ein|eine|wählen|öffnen|speichern|löschen|abbrechen|fertig|zurück|weiter|laden|installieren|starten|spielen|einstellungen|instanz|instanzen|konto|fehler|bitte|schon|nur|mehr|als|wenn|im|am|an|den|dem|des|sich|sie|du|dich|dir|es|sind|hat|haben|kann|soll|muss|gibt|bis|seit|vor|nach|über|unter|ohne|durch|gegen|um|wie|was|wer|wo|warum)\b', re.I)
CODEY = re.compile(r'^[\w.\-:/#%?=&+,@*|\[\]()!\'"]+$')

def segments_of(text):
    """Splits markup into visible text pieces; keeps {n} placeholders."""
    text = re.sub(r'<!--.*?-->', ' ', text, flags=re.S)
    pieces = re.split(r'<[^<>]*>', text)
    res = []
    for p in pieces:
        p = p.replace('&amp;', '&').replace('&nbsp;', ' ').replace('&lt;', '<').replace('&gt;', '>')
        if not p.strip(): continue
        res.append(p)
    return res

def wanted(seg):
    s = seg.strip()
    if len(s) < 2: return False
    plain = re.sub(r'\{\d+\}', '', s)
    if not re.search(r'[A-Za-zÄÖÜäöüß]{2}', plain): return False
    if re.search(r'^(https?:|data:|#|\.|--)', s): return False
    if re.search(r'[{};]\s*$|^\s*[\w-]+\s*:\s*[^ ]+;|=>|\bfunction\b|\$\(|\bconst\b|\breturn\b', s): return False
    if CODEY.match(plain.replace(' ', '')) and ' ' not in plain and not GER.search(plain) and not re.match(r'^[A-ZÄÖÜ][a-zäöüß]+$', plain): return False
    if re.match(r'^[a-z]+([A-Z][a-z]+)+$', plain): return False          # camelCase identifiers
    if re.search(r"\w\(|\)\s*[,;]|'\s*\+|\+\s*'|:\d+px|^[\w-]+:[\w#.(-]", plain) and not re.search(r'[äöüÄÖÜß]', plain): return False  # code / css
    if re.match(r'^[\d\s.,:/×x%-]+$', plain): return False
    if re.match(r'^[a-z0-9_.\-]+$', plain) and not GER.search(plain): return False  # keys, ids, classes
    if re.search(r'\b(px|rem|rgba?|var\(|translate|rotate|scale)\b', plain) and not GER.search(plain): return False
    return True

exact, tpl = set(), set()
def add_parts(parts):
    # template: join with {n} markers, then split by tags
    k = 0; buf = []
    for p in parts:
        if p is None: buf.append('{%d}' % k); k += 1
        else: buf.append(p)
    whole = ''.join(buf)
    for seg in segments_of(whole):
        s = seg.strip()
        # an icon or a value glued to the text is its own DOM node: drop it from the ends
        s = re.sub(r'^(\{\d+\})+(?=\S)', '', s); s = re.sub(r'(?<=\S)(\{\d+\})+$', '', s).strip()
        if not wanted(s): continue
        if re.search(r'\{\d+\}', s):
            # renumber from 0 inside the segment
            idx = [int(x) for x in re.findall(r'\{(\d+)\}', s)]
            m = {v: i for i, v in enumerate(dict.fromkeys(idx))}
            s2 = re.sub(r'\{(\d+)\}', lambda mm: '{%d}' % m[int(mm.group(1))], s)
            if re.sub(r'\{\d+\}', '', s2).strip(' .:·–-,()/%+×'):
                tpl.add(s2)
        else:
            exact.add(s)

src = open(f'{ROOT}/Web/app.js', encoding='utf-8').read()
# only the real app, not the preview backend at the end
cut = src.find('/* ======================= MOCK')
if cut < 0: cut = src.find('const M = {')
app = src
for kind, parts in js_literals(app):
    add_parts(parts)
html = open(f'{ROOT}/Web/index.html', encoding='utf-8').read()
html = re.sub(r'<script.*?</script>|<style.*?</style>|<svg.*?</svg>', ' ', html, flags=re.S)
for seg in segments_of(html):
    if wanted(seg.strip()): exact.add(seg.strip())
for attr in re.findall(r'(?:title|placeholder|aria-label)="([^"]+)"', open(f'{ROOT}/Web/index.html', encoding='utf-8').read()):
    if wanted(attr): exact.add(attr)
# C# messages that reach the screen (exceptions, progress)
for root, _, files in os.walk(ROOT):
    if '/bin' in root or '/obj' in root or '/tests' in root or '/publish' in root: continue
    for f in files:
        if not f.endswith('.cs'): continue
        cs = open(os.path.join(root, f), encoding='utf-8').read()
        for m in re.finditer(r'\$?@?"((?:[^"\\]|\\.)*)"', cs):
            raw = m.group(0); body = m.group(1)
            if not GER.search(body): continue
            if raw.startswith('$'):
                k = [0]
                def rep(mm):
                    r = '{%d}' % k[0]; k[0] += 1; return r
                body2 = re.sub(r'\{[^{}]+\}', rep, body.replace('{{', '\x01').replace('}}', '\x02')).replace('\x01', '{').replace('\x02', '}')
                for seg in segments_of(unescape(body2)):
                    if wanted(seg.strip()):
                        (tpl if re.search(r'\{\d+\}', seg) else exact).add(seg.strip())
            else:
                for seg in segments_of(unescape(body)):
                    if wanted(seg.strip()): exact.add(seg.strip())

# drop pure English / names that need no translation is left to the translator
json.dump({'exact': sorted(exact), 'tpl': sorted(tpl)}, open(f'{OUT}/segments.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(exact), 'exact', len(tpl), 'templates')
