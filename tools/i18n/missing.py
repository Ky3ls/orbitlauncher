"""Lists interface texts that have no English translation yet.
Run: python3 tools/i18n/missing.py   then add the lines to Web/lang/en.js ("German": "English")."""
import json, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
subprocess.run([sys.executable, os.path.join(HERE, 'extract.py')], check=True, stdout=subprocess.DEVNULL)
seg = json.load(open(os.path.join(HERE, 'segments.json'), encoding='utf-8'))
src = open(os.path.join(HERE, '..', '..', 'Web', 'lang', 'en.js'), encoding='utf-8').read()
d = json.loads(src[src.index('ORBIT_LANG.en = ') + 16:].rstrip().rstrip(';'))
norm = lambda s: re.sub(r'\s+', ' ', s).strip()
GER = re.compile(r'[äöüÄÖÜß]|\b(der|die|das|und|nicht|mit|für|wird|ist|ein|eine|dein|deine|Instanz|Einstellungen)\b')
for s in seg['exact']:
    if norm(s) not in d['exact'] and GER.search(s): print('exact\t' + s)
for s in seg['tpl']:
    if norm(s) not in d['tpl'] and GER.search(s): print('tpl\t' + s)
os.remove(os.path.join(HERE, 'segments.json'))
