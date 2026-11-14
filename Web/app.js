'use strict';
/* OrbitLauncher – frontend. Talks to the C# host via WebView2 postMessage ({id,cmd,args} → {id,ok,data}, events via {event,data});
   in a normal browser a mock backend (bottom of this file) supplies demo data and live Mojang/Modrinth data. */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (id, cls = 'i') => `<svg class="${cls}"><use href="#${id}"/></svg>`;
const bytes = b => { if (b == null || b < 0) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return (i ? b.toFixed(1) : b) + ' ' + u[i]; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' Mio.' : n >= 1e3 ? Math.round(n / 1e3) + ' Tsd.' : String(n ?? 0);
const ago = d => {
  if (!d) return 'Nie gespielt';
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 90) return 'Gerade eben'; if (s < 3600) return `Vor ${Math.round(s / 60)} Min.`; if (s < 86400) return `Vor ${Math.round(s / 3600)} Std.`;
  if (s < 86400 * 30) return `Vor ${Math.round(s / 86400)} Tag${Math.round(s / 86400) > 1 ? 'en' : ''}`;
  return new Date(d).toLocaleDateString('de-DE');
};
const ptime = s => !s ? '0 Std.' : s < 3600 ? Math.max(1, Math.round(s / 60)) + ' Min.' : (s / 3600).toFixed(s < 36000 ? 1 : 0).replace('.', ',') + ' Std.';
const dateDe = d => d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

const HOST = !!(window.chrome && window.chrome.webview);
let rid = 0; const pending = {};
function api(cmd, args = {}) {
  if (!HOST) return Mock.call(cmd, args);
  return new Promise((res, rej) => { const id = ++rid; pending[id] = { res, rej }; window.chrome.webview.postMessage({ id, cmd, args }); });
}
if (HOST) window.chrome.webview.addEventListener('message', e => {
  const m = e.data;
  if (m.id && pending[m.id]) { const p = pending[m.id]; delete pending[m.id]; m.ok ? p.res(m.data) : p.rej(new Error(m.error || 'Fehler')); }
  else if (m.event) onEvent(m.event, m.data);
});
document.addEventListener('mousedown', e => { if (e.button === 0 && e.target.closest('[data-drag]') && !e.target.closest('button')) api('win.drag'); });
document.addEventListener('dblclick', e => { if (e.target.closest('[data-drag]') && !e.target.closest('button')) api('win.max'); });

const S = {
  settings: {}, instances: [], versions: [], latest: {}, accounts: [], active: null, running: new Set(), sel: null, cur: null,
  logs: {}, tasks: {}, java: [], version: '0.1.0', root: '',
};
const LOADERS = { vanilla: ['Vanilla', 'van'], fabric: ['Fabric', 'fab'], quilt: ['Quilt', 'qui'], forge: ['Forge', 'frg'], neoforge: ['NeoForge', 'neo'] };
const loaderChip = l => `<span class="chip ${LOADERS[l]?.[1] || 'm'}">${LOADERS[l]?.[0] || esc(l)}</span>`;
const vtypeChip = t => t === 'release' ? '<span class="chip van">Release</span>' : t === 'snapshot' ? '<span class="chip snap">Snapshot</span>' : t === 'old_beta' ? '<span class="chip old">Beta</span>' : '<span class="chip old">Alpha</span>';

/* ======================= THEMES ======================= */
const THEMES = {
  ember: ['Ember', '#FF7A3D', '#FFB067'], rose: ['Rosé', '#FF5C8A', '#FFA3BD'], violet: ['Violet', '#8B7BFF', '#C9B8FF'],
  ocean: ['Ocean', '#3D9BFF', '#7FD4FF'], mint: ['Mint', '#2DD4A0', '#9AF2D4'], gold: ['Gold', '#F5B53D', '#FFE08A'],
  mono: ['Mono', '#E8E8EC', '#A8A8B3'], crimson: ['Crimson', '#FF3B4E', '#FF8A7A'], sunset: ['Sunset', '#FF6B3D', '#FFC93D'],
  magenta: ['Magenta', '#E040FB', '#F5A3FF'], sky: ['Sky', '#38BDF8', '#A5F3FC'], teal: ['Teal', '#14B8A6', '#5EEAD4'],
  lime: ['Lime', '#84CC16', '#D9F99D'], copper: ['Copper', '#D97745', '#F2B07E'], ice: ['Ice', '#93C5FD', '#E0F2FE'],
};
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)).join(',');
function applyTheme(k) {
  const t = THEMES[k] || THEMES.ember, r = document.documentElement.style;
  r.setProperty('--a', t[1]); r.setProperty('--b', t[2]);
  r.setProperty('--a-rgb', hexRgb(t[1])); r.setProperty('--b-rgb', hexRgb(t[2]));
}

/* ======================= BLOCK ICONS (original, generic) ======================= */
const BLOCKS = {
  grass: ['#6DBE45', '#8A5A35', '#6E4529', 1], stone: ['#9A9A9F', '#7C7C82', '#636369'], sand: ['#E8D9A0', '#D2C07E', '#B9A866'],
  diamond: ['#7FF3E8', '#3CC9C0', '#2A9E97'], ruby: ['#FF6B6B', '#D94444', '#B03030'], nether: ['#B5463F', '#8E3530', '#6E2622'],
  wood: ['#C79A5B', '#9C6E3A', '#7F582C'], snow: ['#F4F8FF', '#C9D6E6', '#AEBDD1'], end: ['#EDEBB5', '#C9C68C', '#A9A66D'],
  amethyst: ['#B98CFF', '#8E5FE0', '#6F45B8'],
};
function blockSvg(key) {
  if (key === 'orbit') return `<svg viewBox="0 0 64 64"><path d="M32 13 49 22.5 32 32 15 22.5Z" fill="url(#rg)"/><path d="M15 22.5 32 32v19L15 41.5Z" fill="var(--a)" opacity=".55"/><path d="M49 22.5 32 32v19l17-9.5Z" fill="var(--b)" opacity=".8"/><ellipse cx="32" cy="32" rx="30" ry="10" fill="none" stroke="url(#rg)" stroke-width="3.2" transform="rotate(-28 32 32)"/><circle cx="54" cy="12" r="4" fill="#fff"/></svg>`;
  if (key === 'box') key = 'wood';
  const [t, l, r, grass] = BLOCKS[key] || BLOCKS.grass;
  // pixel texture: a few darker squares on the faces
  const px = (pts, c) => pts.map(([x, y]) => `<rect x="${x}" y="${y}" width="3" height="3" fill="${c}" opacity=".35"/>`).join('');
  return `<svg viewBox="0 0 64 64"><path d="M32 8 56 21 32 34 8 21Z" fill="${t}"/><path d="M8 21 32 34v24L8 45Z" fill="${l}"/><path d="M56 21 32 34v24l24-13Z" fill="${r}"/>
    ${grass ? `<path d="M8 21 32 34v6L8 27Z" fill="${t}" opacity=".9"/><path d="M56 21 32 34v6l24-13Z" fill="${t}" opacity=".75"/>` : ''}
    ${px([[14, 34], [22, 44], [16, 41], [26, 38]], '#000')}${px([[40, 40], [48, 32], [44, 46], [36, 48]], '#000')}
    <path d="M32 8 56 21 32 34 8 21Z" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="1"/></svg>`;
}
const instIcon = (i, cls = 'iic') => `<span class="${cls}">${blockSvg(i?.icon || 'grass')}</span>`;

/* ======================= BANNER (original voxel landscape) ======================= */
function bannerSvg(day = false) {
  const W = 1200, H = day ? 675 : 260, s = 12, gid = day ? 'bskyd' : 'bsky'; let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const a = getComputedStyle(document.documentElement).getPropertyValue('--a').trim() || '#FF7A3D';
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">${day ? '<stop offset="0" stop-color="#5E8FD6"/><stop offset="1" stop-color="#BFD8F2"/>' : `<stop offset="0" stop-color="#0B0B14"/><stop offset=".55" stop-color="#1C1626"/><stop offset="1" stop-color="${a}" stop-opacity=".55"/>`}</linearGradient></defs><rect width="${W}" height="${H}" fill="url(#${gid})"/>`;
  if (!day) for (let i = 0; i < 60; i++) out += `<rect x="${Math.floor(rnd() * W / 4) * 4}" y="${Math.floor(rnd() * 120 / 4) * 4}" width="3" height="3" fill="#fff" opacity="${(0.2 + rnd() * 0.6).toFixed(2)}"/>`;
  out += day ? '<rect x="900" y="40" width="50" height="50" fill="#FFF6C9"/><rect x="890" y="30" width="70" height="70" fill="#FFF6C9" opacity=".25"/>' + [[120, 50, 140], [420, 30, 180], [700, 70, 120]].map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="16" fill="#fff" opacity=".85"/><rect x="${x + 20}" y="${y - 10}" width="${w - 50}" height="12" fill="#fff" opacity=".85"/>`).join('')
    : `<rect x="930" y="70" width="60" height="60" fill="${a}" opacity=".9"/><rect x="920" y="60" width="80" height="80" fill="${a}" opacity=".18"/>`;
  const layer = (base, amp, color, top, step) => {
    let h = base, g = '';
    for (let x = 0; x < W; x += s) {
      h += Math.round((rnd() - 0.5) * step) * s / 2; h = Math.max(base - amp, Math.min(base + amp, h));
      g += `<rect x="${x}" y="${h}" width="${s}" height="${H - h}" fill="${color}"/>`;
      if (top) g += `<rect x="${x}" y="${h}" width="${s}" height="${s / 2}" fill="${top}"/>`;
    }
    return g;
  };
  out += day ? layer(430, 50, '#8DB0D3', null, 3) + layer(500, 30, '#5F7F4A', '#6FAA4A', 2) + layer(590, 16, '#7A5634', '#5FA03A', 2)
    : layer(150, 40, '#191825', null, 3) + layer(180, 26, '#1F2A22', '#2F4A2C', 2) + layer(215, 16, '#2A2018', '#3E6B2E', 2);
  return out + '</svg>';
}

/* ======================= MOTION ======================= */
function moveInd() { const a = $('.nav.active'), ind = $('#navInd'); if (!a || !ind) return; ind.style.transform = `translateY(${a.offsetTop}px)`; ind.style.opacity = 1; }
function enterPage(el) {
  if (!el) return;
  el.classList.remove('enter'); void el.offsetWidth;
  el.querySelectorAll('.card,.tabs,.addbar,.empty').forEach((c, i) => c.style.setProperty('--i', Math.min(i, 12)));
  el.classList.add('enter');
  clearTimeout(el._et); el._et = setTimeout(() => el.classList.remove('enter'), 1400);
}
let spotRaf = 0;
document.addEventListener('pointermove', e => {
  if (spotRaf) return;
  spotRaf = requestAnimationFrame(() => {
    spotRaf = 0;
    const c = e.target.closest && e.target.closest('.card'); if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });
});

/* ======================= NAV ======================= */
let curPage = 'home';
const NAV_OF = { inst: 'settings', instances: 'settings', versions: 'settings' };
function go(p) {
  curPage = p; closePop();
  $$('.nav').forEach(n => n.classList.toggle('active', n.dataset.p === (NAV_OF[p] || p)));
  $$('.page').forEach(s => s.classList.toggle('show', s.id === 'p-' + p));
  moveInd(); enterPage($('#p-' + p));
  ({ home: renderHome, instances: renderInstances, mods: loadOrbit, hud: () => loadOrbit().then(() => setTimeout(renderStage, 30)), browse: () => { browseInit(); }, shots: loadShots, versions: () => S.versions.length ? renderVersions() : loadVersions(), settings: renderSettings })[p]?.();
}
window.go = go;
$('#side').addEventListener('click', e => { const n = e.target.closest('.nav'); if (n) go(n.dataset.p); });

/* ======================= TOAST / MODAL ======================= */
function toast(title, text = '', ok = true) {
  const t = document.createElement('div');
  t.className = 'toast' + (ok ? '' : ' err');
  t.innerHTML = `<div class="ti">${ico(ok ? 'check' : 'alert')}</div><div><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}</div>`;
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, ok ? 3600 : 6500);
}
const fail = (title, e) => toast(title, e?.message || String(e), false);
function modal(html, cls = '') { $('#mbox').className = 'card gb mbox ' + cls; $('#mbox').innerHTML = html; $('#modal').classList.add('show'); }
function closeModal() { $('#modal').classList.remove('show'); S.modalClose?.(); S.modalClose = null; }
window.closeModal = closeModal;
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closePop(); } });
function confirmBox(title, text, okText = 'Ja', danger = false) {
  return new Promise(res => {
    S.modalClose = () => res(false);
    modal(`<h1>${esc(title)}</h1><p>${esc(text)}</p><div class="act"><button class="btn" id="cbNo">Abbrechen</button><button class="btn ${danger ? 'd' : 'p'}" id="cbYes">${esc(okText)}</button></div>`);
    $('#cbNo').onclick = () => closeModal();
    $('#cbYes').onclick = () => { S.modalClose = null; closeModal(); res(true); };
  });
}

/* ======================= EVENTS ======================= */
function onEvent(ev, d) {
  if (ev === 'progress') return taskUpdate(d);
  if (ev === 'log') {
    const arr = S.logs[d.id] = S.logs[d.id] || [];
    arr.push(d.line); if (arr.length > 4000) arr.splice(0, arr.length - 4000);
    if (S.cur?.id === d.id && !$('[data-pane="inst:console"]').classList.contains('hidden')) appendLog(d.line);
    return;
  }
  if (ev === 'state') {
    d.running ? S.running.add(d.id) : S.running.delete(d.id);
    if (!d.running && d.code && d.code !== 0) {
      const i = S.instances.find(x => x.id === d.id);
      toast('Minecraft wurde beendet', `${i?.name || ''}: Exit-Code ${d.code}${d.crash ? ' · Crash-Report vorhanden' : ''}`, false);
    }
    refreshInstances(); runUI();
    renderOrbitHero();
  }
  if (ev === 'instances') { S.instances = d; renderAllInstances(); }
  if (ev === 'orbitcfg') {
    if (hbDrag || JSON.stringify(d) === JSON.stringify(S.orbit.cfg)) return;
    S.orbit.cfg = d; S.orbit.cfg.modules = S.orbit.cfg.modules || {};
    renderOMods(); renderOrbitHero(); renderQuick(); if (curPage === 'hud') renderStage();
    $('#oSync').textContent = 'Aus dem Spiel übernommen'; $('#hudSync').textContent = 'Aus dem Spiel übernommen'; $('#qsync').textContent = 'Gerade aus dem Spiel übernommen';
  }
}

/* progress tasks (several can run at once, the newest is shown) */
function taskUpdate(d) {
  if (d.done) delete S.tasks[d.task]; else S.tasks[d.task] = d;
  const list = Object.values(S.tasks), t = list[list.length - 1];
  $('#task').classList.toggle('hidden', !t); $('#tbTask').classList.toggle('hidden', !t);
  if (!t) return;
  $('#taskStage').textContent = t.stage; $('#taskDetail').textContent = t.detail || '';
  $('#taskPct').textContent = t.total > 1 ? t.pct + '%' : '';
  $('#taskBar').style.width = (t.total > 1 ? t.pct : 100) + '%';
  $('#tbTaskTxt').textContent = t.stage + (t.total > 1 ? ' · ' + t.pct + '%' : '');
  $('#tbTaskBar').style.width = (t.total > 1 ? t.pct : 100) + '%';
}

/* ======================= ACCOUNT HEAD ======================= */
function headHtml(acc, cls = 'head') {
  if (acc?.skin) return `<span class="${cls} skin" style="background-image:url('${esc(acc.skin)}')"></span>`;
  return `<span class="${cls}">${esc((acc?.name || '?')[0].toUpperCase())}</span>`;
}
function accountUI() {
  const a = S.accounts.find(x => x.uuid === S.active) || S.accounts[0];
  $('#acctHead').outerHTML = headHtml(a, 'head').replace('class="head', 'id="acctHead" class="head');
  $('#acctName').textContent = a ? a.name : 'Anmelden';
  $('#acctSub').textContent = a ? 'Microsoft-Konto' : 'Microsoft-Konto fehlt';
  $('#uname').textContent = a ? a.name : 'Spieler';
}

/* ======================= INSTANCE SELECTION / PLAY ======================= */
const selInst = () => S.instances.find(i => i.id === S.sel) || S.instances[0];
function instSub(i) { return `${i.mcVersion} · ${LOADERS[i.loader]?.[0] || i.loader}`; }
function runUI() {
  const v = S.orbit?.ver || '26.3', full = (S.orbit?.info?.supported || ['26.3']).includes(v);
  const oi = orbitInstFor(v), run = oi && S.running.has(oi.id);
  $('#iselIcon').outerHTML = `<span class="iic" id="iselIcon">${blockSvg('orbit')}</span>`;
  $('#iselName').textContent = 'Minecraft ' + v;
  $('#iselSub').textContent = full ? 'Voller Client' : 'Overlay-Client';
  $('#launchBtn').classList.toggle('run', !!run);
  $('#launchTxt').textContent = run ? 'Beenden' : 'Spielen';
  $('#launchSub').textContent = run ? 'Orbit Client läuft' : 'Orbit Client · ' + v;
  $('#launchBtn .pi').innerHTML = ico(run ? 'stop' : 'play');
  const n = S.running.size;
  $('#tbDot').classList.toggle('on', n > 0);
  $('#tbState').textContent = n ? 'Minecraft läuft' : 'Bereit';
  $('#navRun').classList.toggle('hidden', !n);
  if (curPage === 'inst' && S.cur) renderInstHead();
}
function selectInstance(id) { S.sel = id; api('settings.set', { key: 'lastInstance', value: id }); runUI(); closePop(); if (curPage === 'home') renderHome(); }
window.selectInstance = selectInstance;
function pickInstance(e) {
  e.stopPropagation();
  const pop = $('#pop');
  if (!pop.classList.contains('hidden')) return closePop();
  const r = $('#isel').getBoundingClientRect();
  pop.innerHTML = (S.instances.map(i => `<button class="${i.id === S.sel ? 'on' : ''}" onclick="selectInstance('${i.id}')">${instIcon(i)}<span class="tx"><b>${esc(i.name)}</b><small>${esc(instSub(i))}</small></span>${S.running.has(i.id) ? '<i class="dot on"></i>' : ''}</button>`).join('') || '<div class="muted" style="padding:12px;font-size:12px">Noch keine Instanzen</div>')
    + `<hr><button onclick="closePop();newInstance()"><span class="iic">${ico('plus')}</span><span class="tx"><b>Neue Instanz</b><small>Version und Loader wählen</small></span></button>`;
  pop.style.left = r.left + 'px'; pop.style.width = r.width + 40 + 'px';
  pop.classList.remove('hidden');
  pop.style.top = Math.max(60, r.top - pop.offsetHeight - 8) + 'px';
}
window.pickInstance = pickInstance;
function closePop() { $('#pop')?.classList.add('hidden'); }
document.addEventListener('click', e => { if (!e.target.closest('#pop') && !e.target.closest('#isel') && !e.target.closest('#cver')) closePop(); });

async function play(id) {
  const i = id ? S.instances.find(x => x.id === id) : selInst();
  if (!i) return newInstance();
  if (S.running.has(i.id)) { if (await confirmBox('Minecraft beenden?', `„${i.name}“ wird sofort geschlossen. Nicht gespeicherter Fortschritt kann verloren gehen.`, 'Beenden', true)) api('stop', { id: i.id }); return; }
  if (!S.accounts.length) return needAccount();
  S.sel = i.id; runUI();
  $('#launchBtn').classList.add('busy');
  try { await api('launch', { id: i.id }); toast('Minecraft startet', `${i.name} · ${instSub(i)}`); }
  catch (e) { fail('Start fehlgeschlagen', e); }
  finally { $('#launchBtn').classList.remove('busy'); }
}
window.play = play;
function needAccount() { return gate(true);
}
function needAccountOld() {
  modal(`<div class="kicker">Konto</div><h1>Melde dich zuerst an</h1><p>Zum Spielen brauchst du ein Microsoft-Konto, das Minecraft: Java Edition besitzt. Die Anmeldung läuft über die offizielle Microsoft-Seite.</p>
    <div class="act"><button class="btn" onclick="closeModal()">Später</button><button class="btn p" onclick="closeModal();login()">${ico('user')}Mit Microsoft anmelden</button></div>`);
}

/* ======================= HOME ======================= */
function renderHome() {
  const h = new Date().getHours();
  $('#greet').textContent = h < 5 ? 'Noch wach' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Bereit' : 'Guten Abend';
  if (!$('#bnScene').innerHTML) $('#bnScene').innerHTML = bannerSvg();
  renderOrbitHero(); renderQuick();
  loadNews();
}
const QUICK = ['keystrokes', 'cps', 'zoom', 'freelook', 'fullbright', 'crosshair', 'togglesprint', 'coords'];
function renderQuick() {
  if (!S.orbit.cfg) return;
  $('#qtog').innerHTML = QUICK.map(id => `<div class="qrow" data-q="${id}"><span class="qi">${ico(OM[id].icon)}</span><span class="tx"><b>${esc(OM[id].name)}</b><small>${(S.orbit.info?.overlay || []).includes(id) ? 'alle Versionen' : 'voller Client'}</small></span><div class="tg sm ${oOn(id) ? 'on' : ''}"></div></div>`).join('');
}
$('#qtog').addEventListener('click', e => {
  const r = e.target.closest('[data-q]'); if (!r) return;
  const id = r.dataset.q, on = !oOn(id);
  ocfg(id).enabled = on; r.querySelector('.tg').classList.toggle('on', on);
  oSave(); renderOrbitHero();
});
async function loadNews() {
  if (S.news) return renderNews();
  try { S.news = await api('news'); renderNews(); } catch { $('#news').innerHTML = '<div class="empty">Neuigkeiten konnten nicht geladen werden.</div>'; }
}
function renderNews() {
  $('#news').innerHTML = (S.news || []).slice(0, 6).map(n => `<button class="card hov nw" onclick="api('open.url',{url:'https://www.minecraft.net/de-de/article/minecraft-java-edition-${esc((n.version || '').replace(/\./g, '-'))}'})">
    <div class="ni" style="${n.image ? `background-image:url('${esc(n.image)}')` : 'background:linear-gradient(135deg,rgba(var(--a-rgb),.35),#151518)'}">${vtypeChip(n.type)}</div>
    <div class="nt"><b>${esc(n.title)}</b><p>${esc(n.text)}</p><small>${dateDe(n.date)}</small></div></button>`).join('');
}

/* ======================= INSTANCES ======================= */
async function refreshInstances() { try { S.instances = await api('instances.list'); } catch { } renderAllInstances(); }
function renderAllInstances() {
  if (!S.instances.find(i => i.id === S.sel)) S.sel = S.instances[0]?.id || null;
  runUI();
  if (curPage === 'instances') renderInstances();
  if (curPage === 'home') renderHome();
  if (curPage === 'inst' && S.cur) { S.cur = S.instances.find(i => i.id === S.cur.id) || S.cur; renderInstHead(); }
  fillTargets();
}
let instFilter = 'all';
$('#instFilter').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; instFilter = b.dataset.f; $$('#instFilter button').forEach(x => x.classList.toggle('on', x === b)); renderInstances(); });
function renderInstances() {
  const q = ($('#instQ').value || '').toLowerCase();
  const list = S.instances.filter(i => (!q || (i.name + ' ' + i.mcVersion + ' ' + i.loader).toLowerCase().includes(q))
    && (instFilter === 'all' || (instFilter === 'vanilla' && i.loader === 'vanilla') || (instFilter === 'modded' && i.loader !== 'vanilla') || (instFilter === 'modpack' && i.kind === 'modpack')));
  $('#igrid').innerHTML = list.map(i => {
    const run = S.running.has(i.id);
    return `<div class="card hov icard ${run ? 'run' : ''}" onclick="openInst('${i.id}')">
      <div class="top">${instIcon(i, 'iic lg')}<div class="tx"><b>${esc(i.name)}</b><span>${esc(i.mcVersion)}${i.loaderVersion ? ' · ' + esc(LOADERS[i.loader]?.[0]) + ' ' + esc(i.loaderVersion) : ''}</span></div></div>
      <div class="chips">${loaderChip(i.loader)}${i.kind === 'orbit' ? '<span class="chip a">Orbit Client</span>' : i.kind === 'modpack' ? '<span class="chip m">Modpack</span>' : ''}${i.mods ? `<span class="chip m">${i.mods} Mods</span>` : ''}</div>
      <div class="foot">${run ? '<span class="livedot"><i class="dot on"></i>Läuft</span>' : `${ico('clock')}<span>${ago(i.lastPlayed)} · ${ptime(i.playSeconds)}</span>`}
        <button class="btn sm ${run ? 'd' : 'p'}" onclick="event.stopPropagation();play('${i.id}')">${ico(run ? 'stop' : 'play')}${run ? 'Stop' : 'Spielen'}</button></div></div>`;
  }).join('') + `<button class="card hov icard new" onclick="newInstance()"><span class="qi">${ico('plus')}</span><b style="font-size:14px">Neue Instanz</b><span style="font-size:12px">Vanilla, Fabric, Quilt, Forge, NeoForge</span></button>`;
}
window.renderInstances = renderInstances;

/* ---------- instance detail ---------- */
async function openInst(id) {
  S.cur = S.instances.find(i => i.id === id); if (!S.cur) return;
  S.sel = id; runUI();
  go('inst');
  renderInstHead();
  pageTab('inst', 'mods');
}
window.openInst = openInst;
function renderInstHead() {
  const i = S.cur, run = S.running.has(i.id);
  $('#ihead').innerHTML = `${instIcon(i, 'iic xl')}<div class="tx"><button class="btn sm" onclick="go('instances')" style="margin-bottom:6px">${ico('back')}Instanzen</button><h1>${esc(i.name)}</h1>
    <div class="chips"><span class="chip m">Minecraft ${esc(i.mcVersion)}</span>${loaderChip(i.loader)}${i.loaderVersion ? `<span class="chip m">${esc(i.loaderVersion)}</span>` : ''}<span class="chip m">${ico('clock')}${ptime(i.playSeconds)}</span>${run ? '<span class="chip g"><i class="dot on"></i>Läuft</span>' : ''}</div></div>
    <div class="acts"><button class="ib" title="Ordner öffnen" onclick="openFolder('')">${ico('folder')}</button><button class="btn" onclick="addContent()">${ico('plus')}Inhalte hinzufügen</button><button class="btn ${run ? 'd' : 'p'}" onclick="play('${i.id}')">${ico(run ? 'stop' : 'play')}${run ? 'Beenden' : 'Spielen'}</button></div>`;
}
function openFolder(sub) { api('folder.open', { id: S.cur?.id, what: sub }); }
window.openFolder = openFolder;
function addContent() { const t = $('[data-tabs="inst"] .tab.on')?.dataset.tab; S.browse.type = ['resourcepack', 'shader'].includes(t) ? t : 'mod'; S.browse.target = S.cur.id; go('browse'); }
window.addContent = addContent;

const CTYPES = { mods: 'mod', resourcepack: 'resourcepack', shader: 'shader' };
async function loadContent(tab) {
  const type = CTYPES[tab], pane = $(`[data-pane="inst:${tab}"]`), i = S.cur;
  if (type === 'mod' && i.loader === 'vanilla') {
    pane.innerHTML = `<div class="card note">${ico('info')}<div><b>Vanilla-Instanz</b><p>Mods brauchen einen Mod-Loader. Lege eine neue Instanz mit Fabric, Quilt, Forge oder NeoForge an, oder nutze den Orbit Client. Ressourcenpakete und Shader (mit Iris) gehen trotzdem.</p></div></div>`;
    return;
  }
  pane.innerHTML = '<div class="skel"></div>';
  let files = [];
  try { files = await api('instance.content', { id: i.id, type }); } catch (e) { pane.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const label = { mod: 'Mods', resourcepack: 'Ressourcenpakete', shader: 'Shaderpacks' }[type];
  $({ mod: '#cntMods', resourcepack: '#cntRp', shader: '#cntSh' }[type]).textContent = files.length;
  pane.innerHTML = `<div class="ctool"><div class="srch"><svg class="i"><use href="#search"/></svg><input class="in" placeholder="${label} filtern…" oninput="filterRows(this)"></div>
      ${type === 'mod' ? `<button class="btn" onclick="checkUpdates()">${ico('refresh')}Updates prüfen</button>` : ''}
      <button class="btn" onclick="openFolder('${type === 'mod' ? 'mods' : type === 'shader' ? 'shaderpacks' : 'resourcepacks'}')">${ico('folder')}Ordner</button>
      <button class="btn p" onclick="addContent()">${ico('plus')}Hinzufügen</button></div>
    ${files.length ? `<div class="card clist">${files.map(f => `<div class="crow ${f.on ? '' : 'off'}" data-q="${esc((f.title + ' ' + f.file).toLowerCase())}">
        <span class="iic">${f.icon ? `<img src="${esc(f.icon)}" alt="" loading="lazy">` : ico(type === 'shader' ? 'sun' : type === 'mod' ? 'puzzle' : 'image')}</span>
        <div class="tx"><b>${esc(f.title)}</b>${f.dependency ? ' <span class="chip m">Abhängigkeit</span>' : ''}<p>${esc(f.file)}${f.version ? ' · ' + esc(f.version) : ''}${f.size ? ' · ' + bytes(f.size) : ''}</p></div>
        <span class="up" data-up="${esc(f.projectId || '')}"></span>
        <div class="tg sm ${f.on ? 'on' : ''}" onclick="toggleContent(this,'${type}','${esc(f.file)}')"></div>
        <button class="ib sm d" title="Entfernen" onclick="removeContent('${type}','${esc(f.file)}','${esc(f.title)}')">${ico('trash')}</button></div>`).join('')}</div>`
      : `<div class="empty">${ico(type === 'shader' ? 'sun' : type === 'mod' ? 'puzzle' : 'image')}<p style="margin-top:8px">Noch keine ${label}. Hol dir welche von Modrinth.</p><button class="btn p mt" onclick="addContent()">${ico('compass')}${label} entdecken</button></div>`}`;
}
window.filterRows = el => { const q = el.value.toLowerCase(); el.closest('.ipane').querySelectorAll('.crow').forEach(r => r.classList.toggle('hidden', !!q && !r.dataset.q.includes(q))); };
window.toggleContent = async (el, type, file) => { const on = !el.classList.contains('on'); el.classList.toggle('on', on); el.closest('.crow').classList.toggle('off', !on); try { await api('content.toggle', { id: S.cur.id, type, file, on }); } catch (e) { fail('Fehler', e); } };
window.removeContent = async (type, file, title) => {
  if (!await confirmBox('Entfernen?', `„${title}“ wird aus der Instanz gelöscht.`, 'Entfernen', true)) return;
  try { await api('content.remove', { id: S.cur.id, type, file }); toast('Entfernt', title); loadContent($('[data-tabs="inst"] .tab.on').dataset.tab); refreshInstances(); } catch (e) { fail('Fehler', e); }
};
async function checkUpdates() {
  try {
    const ups = await api('content.updates', { id: S.cur.id });
    $$('[data-up]').forEach(e => e.innerHTML = '');
    if (!ups.length) return toast('Alles aktuell', 'Keine Mod-Updates gefunden');
    ups.forEach(u => { const e = $(`[data-up="${u.projectId}"]`); if (e) e.innerHTML = `<span class="chip a">${esc(u.from)} → ${esc(u.to)}</span>`; });
    if (await confirmBox(`${ups.length} Update${ups.length > 1 ? 's' : ''} gefunden`, ups.map(u => `${u.title}: ${u.from} → ${u.to}`).join('\n'), 'Alle aktualisieren')) {
      await api('content.updateAll', { id: S.cur.id }); toast('Mods aktualisiert', `${ups.length} Mod${ups.length > 1 ? 's' : ''}`); loadContent('mods');
    }
  } catch (e) { fail('Update-Prüfung fehlgeschlagen', e); }
}
window.checkUpdates = checkUpdates;
function appendLog(line) {
  const v = $('#logv'); if (v.querySelector('.muted')) v.innerHTML = '';
  const d = document.createElement('div'); d.textContent = line;
  if (/\/(ERROR|FATAL)\]|Exception|Caused by/.test(line)) d.className = 'e'; else if (/\/WARN\]/.test(line)) d.className = 'w';
  const stick = v.scrollTop + v.clientHeight >= v.scrollHeight - 30;
  v.append(d); if (v.childElementCount > 2000) v.firstChild.remove();
  if (stick) v.scrollTop = v.scrollHeight;
}
function renderLog() {
  const v = $('#logv'), lines = S.logs[S.cur.id] || [];
  v.innerHTML = lines.length ? '' : '<span class="muted">Noch keine Ausgabe. Starte die Instanz, dann erscheint hier das Log.</span>';
  lines.slice(-1500).forEach(appendLog);
}
window.copyLog = () => { navigator.clipboard?.writeText((S.logs[S.cur.id] || []).join('\n')); toast('Log kopiert'); };

function renderOpts() {
  const i = S.cur;
  $('#iopts').innerHTML = `<div class="card">
    <div class="srow"><div><b>Name</b><p>Wie die Instanz im Launcher heißt</p></div><input class="in" id="oName" style="width:280px" value="${esc(i.name)}"></div>
    <div class="srow"><div><b>Symbol</b></div><div class="icons" id="oIcons">${Object.keys(BLOCKS).concat('orbit').map(k => `<button data-ic="${k}" class="${i.icon === k ? 'on' : ''}"><span class="iic">${blockSvg(k)}</span></button>`).join('')}</div></div>
    <div class="srow"><div><b>Arbeitsspeicher</b><p id="oRamV">${i.ramMb ? (i.ramMb / 1024) + ' GB' : 'Standard aus den Einstellungen'}</p></div><input type="range" id="oRamI" min="0" max="32" step="1" value="${(i.ramMb || 0) / 1024}" style="width:200px"></div>
    <div class="srow"><div><b>Java</b><p>Leer = passendes Java automatisch</p></div><div class="row"><input class="in" id="oJava" style="width:260px" placeholder="automatisch" value="${esc(i.javaPath || '')}"><button class="btn sm" onclick="pickJava('oJava')">Wählen</button></div></div>
    <div class="srow"><div><b>JVM-Argumente</b><p>Nur für diese Instanz</p></div><input class="in" id="oJvm" style="width:320px" placeholder="Standard" value="${esc(i.jvmArgs || '')}"></div>
    <div class="srow"><div><b>Fenstergröße</b><p>Leer = Einstellung des Launchers</p></div><div class="row"><input class="in num" id="oW" style="width:90px" placeholder="Breite" value="${i.width || ''}"><span class="muted">×</span><input class="in num" id="oH" style="width:90px" placeholder="Höhe" value="${i.height || ''}"></div></div>
    <div class="srow"><div><b>Version &amp; Loader</b><p>Minecraft ${esc(i.mcVersion)} · ${LOADERS[i.loader]?.[0]} ${esc(i.loaderVersion || '')}</p></div><button class="btn sm" onclick="api('instance.repair',{id:'${i.id}'}).then(()=>toast('Dateien geprüft','Fehlende Dateien wurden neu geladen')).catch(e=>fail('Fehler',e))">${ico('refresh')}Dateien prüfen</button></div>
    <div class="srow"><div><b>Instanz löschen</b><p>Welten, Mods und Einstellungen dieser Instanz werden gelöscht</p></div><button class="btn d sm" onclick="deleteInst()">${ico('trash')}Löschen</button></div>
    <div class="row mt"><span class="sp"></span><button class="btn p" onclick="saveOpts()">${ico('check')}Speichern</button></div></div>`;
  $('#oRamI').oninput = e => { $('#oRamV').textContent = +e.target.value ? e.target.value + ' GB' : 'Standard aus den Einstellungen'; setRange(e.target); };
  setRange($('#oRamI'));
  $('#oIcons').onclick = e => { const b = e.target.closest('[data-ic]'); if (!b) return; $$('#oIcons button').forEach(x => x.classList.toggle('on', x === b)); };
}
window.saveOpts = async () => {
  const patch = { name: $('#oName').value.trim() || S.cur.name, icon: $('#oIcons .on')?.dataset.ic || S.cur.icon, ramMb: +$('#oRamI').value * 1024, javaPath: $('#oJava').value.trim() || null, jvmArgs: $('#oJvm').value.trim() || null, width: +$('#oW').value || 0, height: +$('#oH').value || 0 };
  try { await api('instance.update', { id: S.cur.id, patch }); Object.assign(S.cur, patch); toast('Gespeichert', S.cur.name); refreshInstances(); renderInstHead(); } catch (e) { fail('Fehler', e); }
};
window.deleteInst = async () => {
  if (!await confirmBox('Instanz löschen?', `„${S.cur.name}“ mit allen Welten und Mods wird endgültig gelöscht.`, 'Endgültig löschen', true)) return;
  try { await api('instance.delete', { id: S.cur.id }); toast('Gelöscht', S.cur.name); S.cur = null; await refreshInstances(); go('instances'); } catch (e) { fail('Fehler', e); }
};
window.pickJava = async target => { try { const r = await api('java.pick'); if (r?.path) $('#' + target).value = r.path; } catch { } };

/* ======================= GENERIC PAGE TABS ======================= */
function pageTab(group, k) {
  $$(`[data-tabs="${group}"] .tab`).forEach(b => b.classList.toggle('on', b.dataset.tab === k));
  $$(`[data-pane^="${group}:"]`).forEach(p => p.classList.toggle('hidden', p.dataset.pane !== group + ':' + k));
  if (group === 'inst') { if (CTYPES[k]) loadContent(k); else if (k === 'console') renderLog(); else if (k === 'options') renderOpts(); }
}
document.addEventListener('click', e => { const b = e.target.closest('[data-tabs] .tab'); if (b) pageTab(b.closest('[data-tabs]').dataset.tabs, b.dataset.tab); });
function setRange(el) { const p = (el.value - el.min) / (el.max - el.min) * 100; el.style.setProperty('--p', p + '%'); }
document.addEventListener('input', e => { if (e.target.type === 'range') setRange(e.target); });

/* ======================= NEW INSTANCE ======================= */
async function ensureVersions() { if (!S.versions.length) { const r = await api('versions.list', {}); S.versions = r.versions; S.latest = r.latest; } }
async function newInstance(pre = {}) {
  try { await ensureVersions(); } catch (e) { return fail('Versionen nicht erreichbar', e); }
  const st = { mc: pre.mc || S.latest.release, loader: pre.loader || 'vanilla', type: 'release', q: '', icon: 'grass', ram: (S.settings.ramMb || 4096) / 1024, lv: null, lvs: [], supported: null };
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button><div class="kicker">Neue Instanz</div><h1>Was willst du spielen?</h1>
    <label class="fl">Mod-Loader</label><div class="seg" id="niLoader">${Object.entries(LOADERS).map(([k, [n]]) => `<button data-l="${k}">${n}</button>`).join('')}</div>
    <label class="fl">Minecraft-Version</label>
    <div class="row" style="margin-bottom:8px"><div class="srch"><svg class="i"><use href="#search"/></svg><input class="in" id="niQ" placeholder="Version suchen…" style="height:36px"></div>
      <div class="seg" id="niType"><button data-t="release">Releases</button><button data-t="snapshot">Snapshots</button><button data-t="old">Beta/Alpha</button></div></div>
    <div class="vpick" id="niList"></div>
    <div class="vrow2"><div><label class="fl">Loader-Version</label><select class="in sel wide" id="niLv"></select></div>
      <div><label class="fl">Name</label><input class="in" id="niName" style="height:36px"></div></div>
    <label class="fl">Arbeitsspeicher: <span id="niRamT"></span></label><input type="range" id="niRam" min="1" max="32" step="1">
    <div class="act" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">Abbrechen</button><button class="btn p" id="niGo">${ico('plus')}Instanz erstellen</button></div>`, 'form');
  const nameAuto = () => `${st.loader === 'vanilla' ? 'Vanilla' : LOADERS[st.loader][0]} ${st.mc}`;
  let userNamed = false;
  $('#niName').oninput = () => userNamed = true;
  const list = () => {
    const vs = S.versions.filter(v => (st.type === 'old' ? v.type.startsWith('old') : v.type === st.type) && (!st.q || v.id.includes(st.q)) && (!st.supported || st.supported.has(v.id)));
    $('#niList').innerHTML = vs.slice(0, 400).map(v => `<button data-v="${esc(v.id)}" class="${v.id === st.mc ? 'on' : ''}"><b>${esc(v.id)}</b>${vtypeChip(v.type)}<span>${dateDe(v.released)}</span></button>`).join('') || `<div class="muted" style="padding:14px;font-size:12.5px">${st.supported ? 'Keine passende Version für diesen Loader.' : 'Nichts gefunden.'}</div>`;
    if (!userNamed) $('#niName').value = nameAuto();
  };
  const loaderVersions = async () => {
    const sel = $('#niLv');
    if (st.loader === 'vanilla') { sel.innerHTML = '<option>–</option>'; sel.disabled = true; return; }
    sel.disabled = true; sel.innerHTML = '<option>Lade…</option>';
    try {
      st.lvs = await api('loader.versions', { loader: st.loader, mc: st.mc });
      sel.innerHTML = st.lvs.length ? st.lvs.slice(0, 120).map((l, i) => `<option value="${esc(l.version)}">${esc(l.version)}${l.recommended ? ' (empfohlen)' : !l.stable ? ' (beta)' : ''}</option>`).join('') : '<option value="">Nicht verfügbar</option>';
      const best = st.lvs.find(l => l.recommended) || st.lvs.find(l => l.stable) || st.lvs[0]; if (best) sel.value = best.version;
      sel.disabled = !st.lvs.length;
    } catch (e) { sel.innerHTML = `<option value="">${esc(e.message)}</option>`; }
  };
  const setLoader = async l => {
    st.loader = l; $$('#niLoader button').forEach(b => b.classList.toggle('on', b.dataset.l === l));
    st.supported = null;
    if (l !== 'vanilla') { try { st.supported = new Set(await api('loader.games', { loader: l })); if (!st.supported.has(st.mc)) st.mc = S.versions.find(v => v.type === 'release' && st.supported.has(v.id))?.id || st.mc; } catch { } }
    list(); loaderVersions();
  };
  const setType = t => { st.type = t; $$('#niType button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); list(); };
  $('#niLoader').onclick = e => { const b = e.target.closest('button'); if (b) setLoader(b.dataset.l); };
  $('#niType').onclick = e => { const b = e.target.closest('button'); if (b) setType(b.dataset.t); };
  $('#niQ').oninput = e => { st.q = e.target.value.trim(); list(); };
  $('#niList').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; st.mc = b.dataset.v; $$('#niList button').forEach(x => x.classList.toggle('on', x === b)); if (!userNamed) $('#niName').value = nameAuto(); loaderVersions(); };
  const ram = $('#niRam'); ram.value = st.ram; setRange(ram); $('#niRamT').textContent = st.ram + ' GB';
  ram.oninput = () => { $('#niRamT').textContent = ram.value + ' GB'; };
  const vt = S.versions.find(v => v.id === st.mc)?.type;
  setType(vt === 'snapshot' ? 'snapshot' : vt?.startsWith('old') ? 'old' : 'release'); setLoader(st.loader);
  $('#niGo').onclick = async () => {
    const lv = st.loader === 'vanilla' ? null : $('#niLv').value || null;
    if (st.loader !== 'vanilla' && !lv) return toast('Kein Loader verfügbar', `${LOADERS[st.loader][0]} gibt es nicht für ${st.mc}`, false);
    $('#niGo').disabled = true;
    try {
      const inst = await api('instance.create', { name: $('#niName').value.trim() || nameAuto(), mc: st.mc, loader: st.loader, loaderVersion: lv, icon: st.loader === 'vanilla' ? 'grass' : st.loader === 'fabric' ? 'wood' : st.loader === 'quilt' ? 'amethyst' : st.loader === 'neoforge' ? 'ruby' : 'stone', ramMb: +ram.value * 1024 });
      closeModal(); toast('Instanz erstellt', `${inst.name} wird im Hintergrund vorbereitet`);
      await refreshInstances(); selectInstance(inst.id); openInst(inst.id);
    } catch (e) { $('#niGo').disabled = false; fail('Erstellen fehlgeschlagen', e); }
  };
}
window.newInstance = newInstance;
async function importPack() {
  try { const r = await api('pack.import'); if (!r) return; toast('Modpack importiert', `${r.name} · ${r.mcVersion}`); await refreshInstances(); openInst(r.id); }
  catch (e) { fail('Import fehlgeschlagen', e); }
}
window.importPack = importPack;

/* ======================= VERSIONS PAGE ======================= */
let vType = 'release';
$('#vType').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; vType = b.dataset.t; $$('#vType button').forEach(x => x.classList.toggle('on', x === b)); renderVersions(); });
async function loadVersions(refresh = false) {
  $('#vList').innerHTML = '<div class="skel" style="margin:12px 0"></div>';
  try { const r = await api('versions.list', { refresh }); S.versions = r.versions; S.latest = r.latest; S.installedVersions = new Set(r.installed || []); renderVersions(); }
  catch (e) { $('#vList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
window.loadVersions = loadVersions;
function renderVersions() {
  const q = ($('#vQ').value || '').trim().toLowerCase();
  const c = t => S.versions.filter(v => v.type === t).length;
  $('#vStats').innerHTML = `<div><b>${c('release')}</b><span>Releases · neueste ${esc(S.latest.release || '')}</span></div><div><b>${c('snapshot')}</b><span>Snapshots · ${esc(S.latest.snapshot || '')}</span></div><div><b>${c('old_beta')}</b><span>Beta-Versionen</span></div><div><b>${c('old_alpha')}</b><span>Alpha-Versionen</span></div>`;
  const vs = S.versions.filter(v => (vType === 'all' || v.type === vType) && (!q || v.id.toLowerCase().includes(q))).slice(0, 300);
  const inst = new Set(S.instances.map(i => i.mcVersion));
  $('#vList').innerHTML = vs.map(v => `<div class="vrow"><b>${esc(v.id)}</b>${vtypeChip(v.type)}<span class="d">${dateDe(v.released)}${inst.has(v.id) ? ` · <span class="ok">${ico('check')}Instanz vorhanden</span>` : ''}</span>
    <div class="a"><button class="btn sm" onclick="newInstance({mc:'${esc(v.id)}'})">${ico('plus')}Instanz</button><button class="btn sm p" onclick="quickPlay('${esc(v.id)}')">${ico('play')}Spielen</button></div></div>`).join('') || '<div class="empty" style="margin:12px 0">Keine Version gefunden.</div>';
}
window.renderVersions = renderVersions;
async function quickPlay(mc) {
  let i = S.instances.find(x => x.mcVersion === mc && x.loader === 'vanilla');
  if (!i) { try { i = await api('instance.create', { name: 'Vanilla ' + mc, mc, loader: 'vanilla', icon: 'grass', ramMb: 0 }); await refreshInstances(); } catch (e) { return fail('Fehler', e); } }
  selectInstance(i.id); play(i.id);
}
window.quickPlay = quickPlay;

/* ======================= BROWSE (MODRINTH) ======================= */
S.browse = { type: 'mod', sort: 'relevance', loader: '', ver: '', cats: new Set(), q: '', offset: 0, target: null, total: 0, catList: null, installed: new Set() };
function fillTargets() {
  const sel = $('#bTarget'); if (!sel) return;
  const b = S.browse;
  const opts = S.instances.map(i => `<option value="${i.id}">${esc(i.name)} · ${esc(instSub(i))}</option>`).join('');
  sel.innerHTML = `<option value="">Ohne Instanz (nur stöbern)</option>${opts}`;
  sel.value = b.target && S.instances.find(i => i.id === b.target) ? b.target : '';
}
async function browseInit() {
  const b = S.browse;
  if (b.target === null) b.target = orbitInstFor(S.orbit.ver)?.id || selInst()?.id || '';
  fillTargets();
  $$('#bTabs .tab').forEach(t => t.classList.toggle('on', t.dataset.bt === b.type));
  try { await ensureVersions(); } catch { }
  const vs = $('#bVer');
  if (!vs.options.length) vs.innerHTML = '<option value="">Alle Versionen</option>' + S.versions.filter(v => v.type === 'release').map(v => `<option>${esc(v.id)}</option>`).join('');
  applyTarget(true);
  if (!b.catList) { try { b.catList = await api('mr.categories'); } catch { b.catList = []; } }
  renderCats();
  browse(true);
}
function applyTarget(silent) {
  const b = S.browse; b.target = $('#bTarget').value;
  const i = S.instances.find(x => x.id === b.target);
  if (i) {
    $('#bVer').value = i.mcVersion;
    b.loader = b.type === 'mod' || b.type === 'modpack' ? (i.loader === 'vanilla' ? '' : i.loader) : '';
  }
  $$('#bLoader button').forEach(x => x.classList.toggle('on', x.dataset.l === b.loader));
  if (!silent) browse(true);
}
window.browseTarget = () => applyTarget(false);
$('#bTabs').addEventListener('click', e => {
  const t = e.target.closest('[data-bt]'); if (!t) return;
  const b = S.browse; b.type = t.dataset.bt; b.cats.clear();
  $$('#bTabs .tab').forEach(x => x.classList.toggle('on', x === t));
  $('#bQ').placeholder = { mod: 'Mods suchen, z. B. Sodium, Create, JEI…', modpack: 'Modpacks suchen, z. B. Fabulously Optimized…', resourcepack: 'Ressourcenpakete suchen…', shader: 'Shader suchen, z. B. Complementary, BSL…' }[b.type];
  $('#bLoader').classList.toggle('hidden', !['mod', 'modpack'].includes(b.type)); $('#bLoaderH').classList.toggle('hidden', !['mod', 'modpack'].includes(b.type));
  applyTarget(true); renderCats(); browse(true);
});
$('#bSort').addEventListener('click', e => { const t = e.target.closest('button'); if (!t) return; S.browse.sort = t.dataset.s; $$('#bSort button').forEach(x => x.classList.toggle('on', x === t)); browse(true); });
$('#bLoader').addEventListener('click', e => { const t = e.target.closest('button'); if (!t) return; S.browse.loader = t.dataset.l; $$('#bLoader button').forEach(x => x.classList.toggle('on', x === t)); browse(true); });
let bqT = 0; $('#bQ').addEventListener('input', () => { clearTimeout(bqT); bqT = setTimeout(() => browse(true), 320); });
const CAT_DE = { adventure: 'Abenteuer', cursed: 'Verflucht', decoration: 'Deko', economy: 'Wirtschaft', equipment: 'Ausrüstung', food: 'Essen', 'game-mechanics': 'Spielmechanik', library: 'Bibliothek', magic: 'Magie', management: 'Verwaltung', minigame: 'Minispiel', mobs: 'Mobs', optimization: 'Optimierung', social: 'Sozial', storage: 'Lager', technology: 'Technik', transportation: 'Transport', utility: 'Werkzeug', worldgen: 'Weltgenerierung', challenging: 'Herausfordernd', combat: 'Kampf', 'kitchen-sink': 'Alles drin', lightweight: 'Leichtgewicht', multiplayer: 'Multiplayer', quests: 'Quests', vanilla: 'Vanilla', realistic: 'Realistisch', simplistic: 'Schlicht', themed: 'Thematisch', tweaks: 'Tweaks', 'vanilla-like': 'Vanilla-ähnlich', cartoon: 'Cartoon', fantasy: 'Fantasy', 'semi-realistic': 'Halb-realistisch', atmosphere: 'Atmosphäre', bloom: 'Bloom', shadows: 'Schatten', pbr: 'PBR', reflections: 'Spiegelungen', 'colored-lighting': 'Farbiges Licht', 'path-tracing': 'Path Tracing', potato: 'Kartoffel-PC', low: 'Schwacher PC', medium: 'Mittlerer PC', high: 'Starker PC', screenshot: 'Screenshot', 'foliage': 'Pflanzen', 'gui': 'GUI', 'fonts': 'Schriften', 'audio': 'Audio', 'blocks': 'Blöcke', 'items': 'Items', 'entities': 'Entities', 'environment': 'Umgebung', 'equipment ': 'Ausrüstung', 'models': 'Modelle', 'locale': 'Sprache', 'core-shaders': 'Core-Shader', '8x-': '8x', '16x': '16x', '32x': '32x', '48x': '48x', '64x': '64x', '128x': '128x', '256x': '256x', '512x+': '512x+' };
function renderCats() {
  const b = S.browse, pt = b.type;
  const cats = (b.catList || []).filter(c => c.project_type === pt && c.header !== 'resolutions' && c.header !== 'performance impact' || (c.project_type === pt && pt === 'shader'));
  $('#bCats').innerHTML = cats.map(c => `<button class="cat ${b.cats.has(c.name) ? 'on' : ''}" data-c="${esc(c.name)}">${esc(CAT_DE[c.name] || c.name)}</button>`).join('') || '<span class="muted" style="font-size:12px">–</span>';
}
$('#bCats').addEventListener('click', e => { const c = e.target.closest('[data-c]'); if (!c) return; const s = S.browse.cats; s.has(c.dataset.c) ? s.delete(c.dataset.c) : s.add(c.dataset.c); c.classList.toggle('on'); browse(true); });
let bSeq = 0;
async function browse(reset) {
  const b = S.browse, seq = ++bSeq;
  if (reset) { b.offset = 0; $('#bList').innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>'; }
  const i = S.instances.find(x => x.id === b.target);
  b.installed = new Set((i?.content || []).map(c => c.projectId));
  const args = { query: $('#bQ').value, type: b.type, mc: $('#bVer').value, loader: b.loader, cats: [...b.cats], sort: b.sort, offset: b.offset, limit: 20 };
  let r;
  try { r = await api('mr.search', args); } catch (e) { if (seq === bSeq) $('#bList').innerHTML = `<div class="empty">Modrinth nicht erreichbar: ${esc(e.message)}</div>`; return; }
  if (seq !== bSeq) return;
  b.total = r.total_hits; b.offset += r.hits.length;
  $('#bInfo').textContent = `${num(r.total_hits).replace(' Tsd.', '.000')} Ergebnisse${i ? ` · passend für ${i.name}` : ''}`;
  const html = r.hits.map(h => projRow(h, i)).join('');
  if (reset) $('#bList').innerHTML = html || '<div class="empty">Nichts gefunden. Andere Suchbegriffe oder weniger Filter?</div>'; else $('#bList').insertAdjacentHTML('beforeend', html);
  $('#bMore').classList.toggle('hidden', b.offset >= b.total);
  if (reset) enterPage($('#p-browse'));
}
window.browse = browse;
function projRow(h, i) {
  const has = S.browse.installed.has(h.project_id), t = S.browse.type;
  const btn = t === 'modpack' ? `<button class="btn sm p" onclick="event.stopPropagation();installPack('${h.project_id}','${esc(h.title)}')">${ico('download')}Als Instanz</button>`
    : has ? `<button class="btn sm ok" onclick="event.stopPropagation()">${ico('check')}Installiert</button>`
      : `<button class="btn sm p" onclick="event.stopPropagation();install(this,'${h.project_id}','${esc(h.title)}')">${ico('download')}Installieren</button>`;
  const cats = (h.display_categories || h.categories || []).filter(c => !LOADERS[c]).slice(0, 3);
  const lds = (h.categories || []).filter(c => LOADERS[c] && c !== 'vanilla').slice(0, 3);
  return `<div class="card hov proj" onclick="projDetail('${h.project_id}')"><span class="pic" style="${h.icon_url ? `background-image:url('${esc(h.icon_url)}')` : ''}"></span>
    <div class="tx"><div class="t"><b>${esc(h.title)}</b><span>von ${esc(h.author)}</span></div><p>${esc(h.description)}</p>
    <div class="meta"><span class="st">${ico('download')}${num(h.downloads)}</span><span class="st">${ico('heart')}${num(h.follows)}</span>${lds.map(loaderChip).join('')}${cats.map(c => `<span class="chip m">${esc(CAT_DE[c] || c)}</span>`).join('')}</div></div>
    <div class="act">${btn}<small class="muted" style="font-size:11px">${h.date_modified ? 'Aktualisiert ' + ago(h.date_modified).replace('Vor', 'vor') : ''}</small></div></div>`;
}
async function install(btn, project, title, version) {
  const b = S.browse;
  if (!b.target) { toast('Keine Instanz gewählt', 'Wähle oben rechts eine Ziel-Instanz', false); $('#bTarget').focus(); return; }
  const i = S.instances.find(x => x.id === b.target);
  if (b.type === 'mod' && i.loader === 'vanilla') return toast('Vanilla-Instanz', 'Mods brauchen Fabric, Quilt, Forge oder NeoForge', false);
  if (btn) { btn.disabled = true; btn.innerHTML = ico('refresh', 'i spin') + 'Lädt…'; }
  try {
    const r = await api('mr.install', { id: i.id, project, type: b.type, version });
    toast(`${title} installiert`, r.installed.length > 1 ? `+ ${r.installed.length - 1} Abhängigkeit${r.installed.length > 2 ? 'en' : ''}: ${r.installed.slice(1).join(', ')}` : i.name);
    if (r.skipped?.length) toast('Nicht alles verfügbar', 'Übersprungen: ' + r.skipped.join(', '), false);
    b.installed.add(project);
    if (btn) { btn.disabled = false; btn.className = 'btn sm ok'; btn.innerHTML = ico('check') + 'Installiert'; }
    refreshInstances();
  } catch (e) { if (btn) { btn.disabled = false; btn.innerHTML = ico('download') + 'Installieren'; } fail('Installation fehlgeschlagen', e); }
}
window.install = install;
async function installPack(project, title, version) {
  if (!await confirmBox('Modpack installieren?', `„${title}“ wird als neue Instanz angelegt. Alle Dateien kommen von Modrinth.`, 'Installieren')) return;
  try { const inst = await api('mr.modpack', { project, version }); toast('Modpack bereit', inst.name); await refreshInstances(); openInst(inst.id); }
  catch (e) { fail('Modpack fehlgeschlagen', e); }
}
window.installPack = installPack;
function md(src) {
  // tiny, safe markdown subset (text is escaped first)
  let h = esc(src || '').replace(/&lt;br\s*\/?&gt;/g, '<br>');
  h = h.replace(/!\[[^\]]*\]\((https:[^)\s]+)\)/g, '<img src="$1" alt="" loading="lazy">')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="#" onclick="api(\'open.url\',{url:\'$2\'});return false">$1</a>')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/^\s*[-*] (.*)$/gm, '• $1').replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
  return h;
}
async function projDetail(id) {
  modal('<div class="skel"></div>', 'form');
  let p; try { p = await api('mr.project', { id }); } catch (e) { return modal(`<h1>Fehler</h1><p>${esc(e.message)}</p><div class="act"><button class="btn" onclick="closeModal()">OK</button></div>`); }
  const b = S.browse, i = S.instances.find(x => x.id === b.target);
  const gal = (p.gallery || []).slice(0, 3);
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button>
    <div class="pd-head"><span class="pic" style="${p.icon_url ? `background-image:url('${esc(p.icon_url)}')` : ''}"></span><div style="flex:1;min-width:0"><h1>${esc(p.title)}</h1><p class="sub" style="font-size:13px;margin-top:4px">${esc(p.description)}</p>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px"><span class="chip m">${ico('download')}${num(p.downloads)}</span><span class="chip m">${esc(p.license?.id || '')}</span>${(p.loaders || []).filter(l => LOADERS[l]).map(loaderChip).join('')}</div></div></div>
    ${gal.length ? `<div class="pd-gal">${gal.map(g => `<i style="background-image:url('${esc(g.url)}')"></i>`).join('')}</div>` : ''}
    <div class="pd-body">${md((p.body || '').slice(0, 6000))}</div>
    <div class="act" style="justify-content:space-between"><button class="btn" onclick="api('open.url',{url:'https://modrinth.com/${esc(p.project_type)}/${esc(p.slug)}'})">${ico('ext')}Auf Modrinth</button>
      ${p.project_type === 'modpack' ? `<button class="btn p" onclick="closeModal();installPack('${p.id}','${esc(p.title)}')">${ico('download')}Als Instanz installieren</button>`
      : i ? `<button class="btn p" id="pdInst" onclick="install(this,'${p.id}','${esc(p.title)}')">${ico('download')}In „${esc(i.name)}“ installieren</button>` : '<span class="muted" style="font-size:12px">Wähle eine Ziel-Instanz zum Installieren</span>'}</div>`, 'form');
}
window.projDetail = projDetail;

/* ======================= ORBIT CLIENT ======================= */
// mirror of the in-game modules (client-mod/…/Modules.java); values are stored as strings like in the mod
const COLORS = ['Weiß', 'Akzent', 'Chroma', 'Grün', 'Rot', 'Blau', 'Gelb', 'Pink'];
const HUDSET = [['bg', 'Hintergrund', 'bool', true], ['shadow', 'Textschatten', 'bool', true], ['color', 'Farbe', 'choice', 'Weiß', COLORS], ['scale', 'Größe', 'num', 1, 0.5, 2.5, 0.1]];
const OMODS = [
  ['fps', 'FPS', 'Bilder pro Sekunde', 'HUD', 1, 1, [], 'activity'],
  ['cps', 'CPS', 'Klicks pro Sekunde, links | rechts, jeder Klick zählt', 'PvP', 1, 1, [], 'sword'],
  ['keystrokes', 'Keystrokes', 'WASD, Maustasten mit CPS und Leertaste live', 'PvP', 1, 1, [['mouse', 'Maustasten', 'bool', true], ['space', 'Leertaste', 'bool', true], ['cpsInKeys', 'CPS in Maustasten', 'bool', true]], 'keyboard'],
  ['coords', 'Koordinaten', 'XYZ, Blickrichtung und Biom', 'HUD', 1, 1, [['biome', 'Biom anzeigen', 'bool', true], ['facing', 'Richtung anzeigen', 'bool', true]], 'compass'],
  ['armor', 'Rüstung', 'Rüstung und Item in der Hand mit Haltbarkeit', 'PvP', 1, 1, [['dura', 'Haltbarkeit', 'choice', 'Prozent', ['Prozent', 'Zahl', 'Aus']], ['hand', 'Item in der Hand', 'bool', true]], 'shield'],
  ['potions', 'Effekte', 'Aktive Tränke mit Restzeit', 'HUD', 1, 1, [], 'sparkle'],
  ['ping', 'Ping', 'Latenz zum Server', 'HUD', 1, 1, [], 'globe'],
  ['reach', 'Reichweite', 'Distanz deines letzten Treffers', 'PvP', 1, 1, [], 'target'],
  ['combo', 'Combo', 'Treffer in Folge, ohne getroffen zu werden', 'PvP', 1, 1, [], 'zap'],
  ['sprint', 'Sprint-Status', 'Zeigt Toggle-Sprint und Schleichen', 'Komfort', 1, 1, [], 'rocket'],
  ['server', 'Server', 'Aktuelle Server-Adresse', 'HUD', 1, 0, [], 'link'],
  ['clock', 'Uhrzeit', 'Echte Uhrzeit', 'HUD', 1, 0, [['seconds', 'Sekunden', 'bool', false]], 'clock'],
  ['memory', 'Speicher', 'RAM-Verbrauch von Minecraft', 'HUD', 1, 0, [], 'ram'],
  ['speed', 'Tempo', 'Geschwindigkeit in Blöcken pro Sekunde', 'HUD', 1, 0, [], 'zap'],
  ['session', 'Sitzung', 'Spielzeit dieser Sitzung', 'HUD', 1, 0, [], 'clock'],
  ['zoom', 'Zoom', 'C halten, Mausrad ändert die Stärke, weich animiert', 'PvP', 0, 1, [['factor', 'Zoomstärke', 'num', 4, 2, 12, 1], ['smooth', 'Weicher Zoom', 'bool', true], ['cinematic', 'Kamera glätten', 'bool', true], ['scroll', 'Mausrad-Zoom', 'bool', true]], 'search'],
  ['freelook', 'Freelook', 'Linke Alt-Taste halten und frei umschauen', 'PvP', 0, 1, [['invert', 'Maus umkehren', 'bool', false]], 'eye'],
  ['fullbright', 'Fullbright', 'Alles hell, auch in Höhlen (Taste G)', 'Grafik', 0, 0, [], 'sun'],
  ['crosshair', 'Fadenkreuz', 'Eigenes Fadenkreuz: Form, Größe, Farbe', 'Grafik', 0, 0, [['style', 'Form', 'choice', 'Plus', ['Plus', 'Plus+Punkt', 'Punkt', 'Kreis', 'X', 'T']], ['size', 'Länge', 'num', 5, 1, 15, 1], ['gap', 'Abstand', 'num', 2, 0, 10, 1], ['thick', 'Dicke', 'num', 1, 1, 4, 1], ['ccolor', 'Farbe', 'choice', 'Weiß', ['Weiß', 'Akzent', 'Grün', 'Rot', 'Cyan', 'Gelb', 'Pink']], ['outline', 'Umrandung', 'bool', true]], 'target'],
  ['togglesprint', 'Toggle Sprint', 'Sprinten einmal drücken statt halten', 'Komfort', 0, 1, [['sneak', 'Auch Schleichen umschalten', 'bool', false]], 'rocket'],
  ['nobob', 'Ruhige Kamera', 'Kein Kamerawackeln und kein FOV-Effekt', 'Grafik', 0, 0, [], 'eye'],
].map(([id, name, desc, cat, hud, def, extra, icon]) => ({ id, name, desc, cat, hud: !!hud, def: !!def, icon, settings: (hud ? HUDSET : []).concat(extra) }));
const OM = Object.fromEntries(OMODS.map(m => [m.id, m]));
const fmtNum = v => Number.isInteger(+v) ? String(+v) : (+v).toFixed(1);

S.orbit = { packs: null, info: null, inst: null, cfg: null, cat: '' };
const ocfg = id => (S.orbit.cfg.modules = S.orbit.cfg.modules || {})[id] = S.orbit.cfg.modules[id] || {};
const oOn = id => { const c = S.orbit.cfg?.modules?.[id]; return c && c.enabled !== undefined ? !!c.enabled : OM[id].def; };
const oGet = (id, key) => { const v = S.orbit.cfg?.modules?.[id]?.opts?.[key]; if (v !== undefined) return v; const s = OM[id].settings.find(x => x[0] === key); return s ? (s[2] === 'num' ? fmtNum(s[3]) : String(s[3])) : ''; };
const oSet = (id, key, v) => { const c = ocfg(id); (c.opts = c.opts || {})[key] = String(v); oSave(); };
let oSaveT = 0;
function oSave() {
  $('#oSync').textContent = 'Speichert…';
  clearTimeout(oSaveT);
  oSaveT = setTimeout(async () => {
    try { await api('orbit.config.set', { config: S.orbit.cfg }); const t = [...S.running].some(id => S.instances.find(i => i.id === id)?.kind === 'orbit') ? 'Live im Spiel übernommen' : 'Gespeichert · gilt für alle Versionen'; $('#oSync').textContent = t; $('#hudSync').textContent = t; }
    catch (e) { $('#oSync').textContent = ''; fail('Speichern fehlgeschlagen', e); }
  }, 250);
}

async function loadOrbit() {
  let info;
  try { info = S.orbit.info = await api('orbit.info'); } catch (e) { return fail('Orbit Client', e); }
  try { S.orbit.cfg = await api('orbit.config.get'); } catch { S.orbit.cfg = {}; }
  S.orbit.cfg.modules = S.orbit.cfg.modules || {};
  S.orbit.ver = S.orbit.ver || S.settings.orbitVersion || info.last;
  S.orbit.packs = new Set((info.selPacks || 'perf,shaders,qol').split(',').filter(Boolean));
  renderOrbitHero(); renderOMods(); renderPacks(info); renderKeys(); renderQuick();
  if (curPage === 'hud') renderStage();
}
function orbitInstFor(v) { return (S.orbit.info?.existing || []).find(i => i.mcVersion === v) || S.instances.find(i => i.kind === 'orbit' && i.mcVersion === v); }
function renderOrbitHero() {
  const info = S.orbit.info; if (!info || !$('#cverTxt')) return;
  const v = S.orbit.ver, full = info.supported.includes(v), inst = orbitInstFor(v), run = inst && S.running.has(inst.id);
  const on = OMODS.filter(m => oOn(m.id)).length;
  $('#cverTxt').textContent = v;
  const go = $('#oPlay'); go.classList.toggle('run', !!run);
  if (!go.disabled) go.innerHTML = `${ico(run ? 'stop' : 'play')}<span>${run ? 'Beenden' : 'Spielen'}</span>`;
  $('#cmode').innerHTML = `<span class="omode ${full ? 'full' : ''}">${ico(full ? 'sparkle' : 'layers')}<span><b>${full ? 'Voller Client im Spiel' : 'Overlay-Client'}</b><small>${full ? 'Alle 21 Mods, Menü auf Rechts-Shift' : 'Keystrokes, CPS, Fadenkreuz und Uhr über dem Spiel'}${inst ? '' : ' · erster Start richtet alles ein'}</small></span></span>`;
  $('#ohStats').innerHTML = `<div><b>${on}/${OMODS.length}</b><span>Mods aktiv</span></div><div><b>${ptime(S.instances.filter(i => i.kind === 'orbit').reduce((a, i) => a + (i.playSeconds || 0), 0))}</b><span>gespielt</span></div><div><b>${info.versions.filter(x => x.type === 'release').length}</b><span>Versionen</span></div>`;
  if ($('#oCnt')) $('#oCnt').textContent = on + '/' + OMODS.length;
  $('#navMods').textContent = on;
  runUI();
}
function orbitPickVersion(e, anchor = 'cver') {
  e.stopPropagation();
  if (!S.orbit.info) return;
  const pop = $('#pop'), info = S.orbit.info;
  if (!pop.classList.contains('hidden')) return closePop();
  const r = $('#' + anchor).getBoundingClientRect();
  const types = ['release'].concat(S.settings.showSnapshots ? ['snapshot'] : [], S.settings.showOld ? ['old_beta', 'old_alpha'] : []);
  const list = info.versions.filter(x => types.includes(x.type));
  const has = new Set((info.existing || []).map(i => i.mcVersion));
  pop.innerHTML = `<div class="vps"><input class="in" id="vpq" placeholder="Version suchen…"></div><div id="vpl">${list.map(x => `<button data-v="${esc(x.id)}" class="${x.id === S.orbit.ver ? 'on' : ''}"><span class="tx"><b>${esc(x.id)}</b><small>${info.supported.includes(x.id) ? 'Voller Client' : 'Overlay-Client'}${has.has(x.id) ? ' · installiert' : ''}</small></span>${info.supported.includes(x.id) ? '<span class="chip a">MOD</span>' : x.type !== 'release' ? vtypeChip(x.type) : ''}</button>`).join('')}</div>`;
  pop.style.left = r.left + 'px'; pop.style.width = '300px';
  pop.classList.remove('hidden');
  pop.style.top = (anchor === 'isel' ? Math.max(60, r.top - pop.offsetHeight - 8) : r.bottom + 6) + 'px';
  $('#vpq').focus();
  $('#vpq').oninput = ev => { const q = ev.target.value.trim(); $$('#vpl button').forEach(b => b.classList.toggle('hidden', !!q && !b.dataset.v.includes(q))); };
  $('#vpl').onclick = ev => { const b = ev.target.closest('[data-v]'); if (!b) return; S.orbit.ver = b.dataset.v; setS('orbitVersion', b.dataset.v); closePop(); renderOrbitHero(); };
}
window.orbitPickVersion = orbitPickVersion;
async function orbitPlay() {
  const v = S.orbit.ver, inst = orbitInstFor(v);
  if (inst && S.running.has(inst.id)) return play(inst.id);
  if (!S.accounts.length) return gate(true);
  const btns = [$('#oPlay'), $('#launchBtn')];
  btns.forEach(b => b.classList.add('busy'));
  $('#oPlay').disabled = true; $('#oPlay').innerHTML = ico('refresh', 'i spin') + `<span>${inst ? 'Startet…' : 'Richte ein…'}</span>`;
  try {
    const r = await api('orbit.play', { mc: v });
    toast('Orbit Client startet', `Minecraft ${v} · ${r.mod ? 'voller Client' : 'Overlay-Client'}`);
    await refreshInstances();
    S.orbit.info = await api('orbit.info');
  } catch (e) { fail('Start fehlgeschlagen', e); }
  finally { btns.forEach(b => b.classList.remove('busy')); $('#oPlay').disabled = false; renderOrbitHero(); }
}
window.orbitPlay = orbitPlay;

function renderOMods() {
  const list = OMODS.filter(m => !S.orbit.cat || m.cat === S.orbit.cat);
  $('#oMods').innerHTML = list.map(m => `<div class="card mcard ${oOn(m.id) ? 'on' : ''}" data-om="${m.id}"><span class="ti">${ico(m.icon)}</span>
    <div class="tx"><b>${esc(m.name)}</b><p>${esc(m.desc)}</p><span class="chip m">${m.cat}${m.hud && m.cat !== 'HUD' ? ' · HUD' : ''}</span>${(S.orbit.info?.overlay || []).includes(m.id) ? '<span class="chip a">Alle Versionen</span>' : '<span class="chip m">26.3</span>'}</div>
    <div class="mact"><div class="tg sm ${oOn(m.id) ? 'on' : ''}" data-omt="${m.id}"></div>${m.settings.length ? `<button class="ib sm" title="Einstellungen" data-oms="${m.id}">${ico('settings')}</button>` : ''}</div></div>`).join('');
  if (!$('#oSync').textContent) $('#oSync').textContent = 'Gilt für alle Versionen · live im Spiel';
}
$('#oCat').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.orbit.cat = b.dataset.c; $$('#oCat button').forEach(x => x.classList.toggle('on', x === b)); renderOMods(); });
$('#oMods').addEventListener('click', e => {
  const st = e.target.closest('[data-oms]'); if (st) return orbitSettings(st.dataset.oms);
  const card = e.target.closest('[data-om]'); if (!card) return;
  const id = card.dataset.om, on = !oOn(id);
  ocfg(id).enabled = on; card.classList.toggle('on', on); card.querySelector('.tg').classList.toggle('on', on);
  renderOrbitHero();
  oSave();
});
function orbitSettings(id) {
  const m = OM[id];
  const row = s => {
    const [key, label, type] = s, v = oGet(id, key);
    if (type === 'bool') return `<div class="srow"><div><b>${esc(label)}</b></div><div class="tg ${v === 'true' ? 'on' : ''}" data-ok="${key}" data-t="bool"></div></div>`;
    if (type === 'choice') return `<div class="srow"><div><b>${esc(label)}</b></div><div class="seg" data-ok="${key}" data-t="choice">${s[4].map(c => `<button class="${c === v ? 'on' : ''}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>`;
    return `<div class="srow"><div><b>${esc(label)}</b><p><span data-nv="${key}">${esc(v)}</span>${key === 'scale' ? 'x' : ''}</p></div><input type="range" min="${s[4]}" max="${s[5]}" step="${s[6]}" value="${esc(v)}" data-ok="${key}" data-t="num" style="width:200px"></div>`;
  };
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button><div class="kicker">${esc(m.cat)}${m.hud ? ' · HUD' : ''}</div><h1>${esc(m.name)}</h1><p class="sub" style="margin:4px 0 0;max-width:none">${esc(m.desc)}</p>
    ${id === 'crosshair' ? '<div class="xprev"><canvas id="xhPrev" width="160" height="100"></canvas></div>' : ''}
    <div class="osets">${m.settings.map(row).join('')}</div>
    <div class="act" style="justify-content:flex-end"><button class="btn p" onclick="closeModal()">${ico('check')}Fertig</button></div>`, 'form');
  $$('.osets input[type=range]').forEach(setRange);
  const box = $('.osets');
  box.addEventListener('click', e => {
    const t = e.target.closest('[data-t]'); if (!t) return;
    if (t.dataset.t === 'bool') { const on = !t.classList.contains('on'); t.classList.toggle('on', on); oSet(id, t.dataset.ok, on); }
    if (t.dataset.t === 'choice') { const b = e.target.closest('button'); if (!b) return; t.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); oSet(id, t.dataset.ok, b.dataset.v); }
    xhDraw();
  });
  box.addEventListener('input', e => { const t = e.target; if (t.dataset.t !== 'num') return; const v = fmtNum(t.value); box.querySelector(`[data-nv="${t.dataset.ok}"]`).textContent = v; oSet(id, t.dataset.ok, v); xhDraw(); });
  S.modalClose = () => { renderOMods(); renderOrbitHero(); };
  xhDraw();
}
window.orbitSettings = orbitSettings;
function xhDraw() {
  const c = $('#xhPrev'); if (!c) return;
  const x = c.getContext('2d'), sc = 4; x.clearRect(0, 0, c.width, c.height);
  const g = x.createLinearGradient(0, 0, 0, c.height); g.addColorStop(0, '#5b86c2'); g.addColorStop(.6, '#8fb3d9'); g.addColorStop(.6, '#3E6B2E'); g.addColorStop(1, '#2A2018'); x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
  const cols = { 'Weiß': '#fff', 'Akzent': getComputedStyle(document.documentElement).getPropertyValue('--a').trim(), 'Grün': '#4ADE9A', 'Rot': '#F87171', 'Cyan': '#67E8F9', 'Gelb': '#FDE047', 'Pink': '#F472B6' };
  const col = cols[oGet('crosshair', 'ccolor')] || '#fff', size = +oGet('crosshair', 'size'), gap = +oGet('crosshair', 'gap'), t = Math.max(1, +oGet('crosshair', 'thick')), ol = oGet('crosshair', 'outline') === 'true', st = oGet('crosshair', 'style');
  const cx = c.width / 2, cy = c.height / 2, h0 = Math.floor(t / 2), h1 = t - h0;
  const R = (a, b, cc, d) => { if (ol) { x.fillStyle = 'rgba(0,0,0,.75)'; x.fillRect(cx + (a - 1) * sc, cy + (b - 1) * sc, (cc - a + 2) * sc, (d - b + 2) * sc); } x.fillStyle = col; x.fillRect(cx + a * sc, cy + b * sc, (cc - a) * sc, (d - b) * sc); };
  const plus = top => { R(-gap - size, -h0, -gap, h1); R(gap + 1, -h0, gap + 1 + size, h1); if (top) R(-h0, -gap - size, h1, -gap); R(-h0, gap + 1, h1, gap + 1 + size); };
  if (st === 'Punkt') R(-h0 - 1, -h0 - 1, h1 + 1, h1 + 1);
  else if (st === 'Kreis') { const r = gap + Math.floor(size / 2) + 2; for (let a = 0; a < 360; a += 6) { const px = Math.round(Math.cos(a * Math.PI / 180) * r), py = Math.round(Math.sin(a * Math.PI / 180) * r); x.fillStyle = col; x.fillRect(cx + (px - h0) * sc, cy + (py - h0) * sc, t * sc, t * sc); } R(-1, -1, 1, 1); }
  else if (st === 'X') { x.save(); x.translate(cx, cy); x.rotate(Math.PI / 4); x.translate(-cx, -cy); plus(true); x.restore(); }
  else { plus(st !== 'T'); if (st === 'Plus+Punkt') R(-h0, -h0, h1, h1); }
}
async function orbitReset() {
  if (!await confirmBox('Alles zurücksetzen?', 'Alle Module, Einstellungen und HUD-Positionen gehen auf Standard zurück.', 'Zurücksetzen', true)) return;
  S.orbit.cfg = { modules: {} }; oSave(); renderOMods(); renderOrbitHero(); renderStage();
}
window.orbitReset = orbitReset;

/* ---------- HUD layout stage (mirror of the in-game auto layout) ---------- */
const HUDBOX = { fps: [52, 16, '60 FPS'], cps: [62, 16, '9 | 2 CPS'], coords: [150, 36, 'X 128.5  Y 64.0  Z -42.3\nRichtung Nord (-Z)\nBiom Plains'], keystrokes: [70, 108, 'keys'], armor: [52, 90, 'armor'],
  potions: [116, 26, 'Stärke II  1:24\nSchnelligkeit  3:00'], ping: [42, 16, '23 ms'], server: [96, 16, 'play.example.net'], clock: [38, 16, '18:42'], memory: [126, 16, 'RAM 41%  1.2/3.0 GB'],
  speed: [60, 16, '5.61 m/s'], reach: [46, 16, '3.12 m'], combo: [54, 16, '4 Combo'], sprint: [140, 16, '[Sprinten (umgeschaltet)]'], session: [104, 16, 'Sitzung 0:42:10'] };
const ANCHOR = id => ['clock', 'memory', 'session', 'potions'].includes(id) ? 'tr' : ['keystrokes', 'sprint'].includes(id) ? 'bl' : id === 'armor' ? 'br' : ['reach', 'combo'].includes(id) ? 'c' : 'tl';
const GW = 960, GH = 540;
function hudLayout() {
  const pos = {}, cur = { tl: 3, tr: 3, bl: GH - 3, br: GH - 27, c: GH / 2 + 14 };
  const hud = OMODS.filter(m => m.hud && oOn(m.id));
  for (const pass of [true, false]) for (const m of pass ? [...hud].reverse() : hud) {
    const c = S.orbit.cfg.modules?.[m.id] || {}, sc = +oGet(m.id, 'scale') || 1, [bw, bh] = HUDBOX[m.id], w = bw * sc, h = bh * sc;
    if (c.x !== undefined && c.y !== undefined) { if (pass) pos[m.id] = [Math.min(GW - w, c.x * GW), Math.min(GH - h, c.y * GH), w, h]; continue; }
    const a = ANCHOR(m.id), up = a[0] === 'b'; if (up !== pass) continue;
    const x = a === 'tr' || a === 'br' ? GW - 3 - w : a === 'c' ? (GW - w) / 2 : 3;
    let y; if (up) { y = cur[a] - h; cur[a] = y - 2; } else { y = cur[a]; cur[a] = y + h + 2; }
    pos[m.id] = [x, y, w, h];
  }
  return pos;
}
function renderStage() {
  const st = $('#stage'); if (!st) return;
  if (!$('#stageBg').innerHTML) $('#stageBg').innerHTML = bannerSvg(true);
  const k = st.clientWidth / GW, pos = hudLayout();
  st.querySelectorAll('.hb').forEach(e => e.remove());
  for (const [id, [x, y, w, h]] of Object.entries(pos)) {
    const sc = +oGet(id, 'scale') || 1, bg = oGet(id, 'bg') !== 'false';
    const d = document.createElement('div');
    d.className = 'hb' + (bg ? ' bg' : ''); d.dataset.id = id; d.title = OM[id].name;
    d.style.cssText = `left:${x * k}px;top:${y * k}px;width:${w * k}px;height:${h * k}px;--fs:${8.4 * sc * k}px`;
    const txt = HUDBOX[id][2];
    d.innerHTML = txt === 'keys' ? `<div class="ks">${['', 'W', '', 'A', 'S', 'D'].map(t => `<i class="${t ? '' : 'e'}">${t}</i>`).join('')}<i class="w2">LMB 9</i><i class="w2">RMB 2</i><i class="w3">▬</i></div>`
      : txt === 'armor' ? '<div class="arm"><i></i><i></i><i></i><i></i><i></i></div>'
        : txt.split('\n').map(l => `<span>${esc(l)}</span>`).join('');
    st.append(d);
  }
}
let hbDrag = null;
$('#stage').addEventListener('pointerdown', e => {
  const b = e.target.closest('.hb'); if (!b) return;
  const r = b.getBoundingClientRect();
  hbDrag = { id: b.dataset.id, el: b, ox: e.clientX - r.left, oy: e.clientY - r.top };
  b.classList.add('drag'); b.setPointerCapture(e.pointerId);
});
$('#stage').addEventListener('pointermove', e => {
  if (!hbDrag) return;
  const st = $('#stage').getBoundingClientRect(), b = hbDrag.el;
  let x = e.clientX - st.left - hbDrag.ox, y = e.clientY - st.top - hbDrag.oy;
  const w = b.offsetWidth, h = b.offsetHeight, sn = 6;
  x = Math.max(0, Math.min(st.width - w, x)); y = Math.max(0, Math.min(st.height - h, y));
  if (Math.abs(x + w / 2 - st.width / 2) < sn) x = st.width / 2 - w / 2;
  if (Math.abs(y + h / 2 - st.height / 2) < sn) y = st.height / 2 - h / 2;
  b.style.left = x + 'px'; b.style.top = y + 'px';
  hbDrag.x = x / st.width; hbDrag.y = y / st.height;
});
$('#stage').addEventListener('pointerup', () => {
  if (!hbDrag) return;
  hbDrag.el.classList.remove('drag');
  if (hbDrag.x !== undefined) { const c = ocfg(hbDrag.id); c.x = +hbDrag.x.toFixed(4); c.y = +hbDrag.y.toFixed(4); oSave(); }
  hbDrag = null;
});
$('#stage').addEventListener('wheel', e => {
  const b = e.target.closest('.hb'); if (!b) return; e.preventDefault();
  const id = b.dataset.id, v = Math.max(0.5, Math.min(2.5, Math.round(((+oGet(id, 'scale') || 1) + (e.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10));
  oSet(id, 'scale', fmtNum(v)); renderStage();
}, { passive: false });
$('#stage').addEventListener('dblclick', e => { const b = e.target.closest('.hb'); if (!b) return; const c = ocfg(b.dataset.id); delete c.x; delete c.y; oSave(); renderStage(); });
window.hudAuto = () => { Object.values(S.orbit.cfg.modules || {}).forEach(c => { delete c.x; delete c.y; }); oSave(); renderStage(); };
window.addEventListener('resize', () => { if (curPage === 'hud') renderStage(); });

/* ---------- packs + install + keys ---------- */
function renderPacks(info) {
  const cur = orbitInstFor(S.orbit.ver);
  $('#oPacks').innerHTML = info.packs.map(m => `<div class="card mcard ${S.orbit.packs.has(m.id) ? 'on' : ''}" data-m="${m.id}"><span class="ti">${ico(m.icon)}</span><div class="tx"><b>${esc(m.name)}</b><p>${esc(m.desc)}</p><span class="chip m">${m.mods} Mod${m.mods > 1 ? 's' : ''}</span></div>
    <span class="cb ${S.orbit.packs.has(m.id) ? 'on' : ''}"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>
    ${cur && cur.loader === 'fabric' ? `<button class="btn sm" onclick="event.stopPropagation();addPack('${m.id}',this)">${ico('download')}In ${esc(cur.mcVersion)} nachladen</button>` : ''}</div>`).join('');
}
$('#oPacks').addEventListener('click', e => {
  const c = e.target.closest('[data-m]'); if (!c || e.target.closest('button')) return;
  const s = S.orbit.packs; s.has(c.dataset.m) ? s.delete(c.dataset.m) : s.add(c.dataset.m);
  c.classList.toggle('on'); c.querySelector('.cb')?.classList.toggle('on');
  setS('orbitPacks', [...s].join(','));
});
const PACK_MODS = { perf: ['sodium', 'lithium', 'ferrite-core', 'entityculling', 'immediatelyfast', 'dynamic-fps', 'sodium-extra', 'reeses-sodium-options'], shaders: ['iris'], qol: ['appleskin', 'mouse-tweaks', 'betterf3', 'no-chat-reports'], visual: ['lambdynamiclights', 'continuity', '3dskinlayers'] };
async function addPack(id, btn) {
  const i = orbitInstFor(S.orbit.ver); if (!i) return; btn.disabled = true; btn.innerHTML = ico('refresh', 'i spin') + 'Lädt…';
  let n = 0;
  for (const slug of PACK_MODS[id] || []) { try { await api('mr.install', { id: i.id, project: slug, type: 'mod' }); n++; } catch { } }
  btn.disabled = false; btn.innerHTML = ico('check') + 'Installiert';
  toast('Paket installiert', `${n} Mod${n === 1 ? '' : 's'} in ${i.name}`); refreshInstances();
}
window.addPack = addPack;
function renderKeys() {
  $('#oKeys').innerHTML = [['Rechts-Shift', 'Orbit-Menü öffnen', 'Module an/aus, Einstellungen, HUD bearbeiten'], ['C (halten)', 'Zoom', 'Mausrad ändert die Stärke'], ['Linke Alt (halten)', 'Freelook', 'Kamera dreht, du läufst geradeaus'], ['G', 'Fullbright', 'An/aus, auch wenn das Modul aus ist'], ['Strg (Sprint)', 'Toggle Sprint', 'Einmal drücken, bleibt an']]
    .map(([k, n, d]) => `<div class="srow"><div><b>${esc(n)}</b><p>${esc(d)}</p></div><kbd>${esc(k)}</kbd></div>`).join('')
    + '<p class="fine">Alle Tasten kannst du im Spiel unter Optionen → Steuerung → Kategorie „Orbit Client“ ändern.</p>';
}

/* ======================= SCREENSHOTS ======================= */
async function loadShots() {
  let list = [];
  try { list = await api('screenshots.list'); } catch { }
  $('#sgal').innerHTML = list.length ? list.map((x, i) => `<button class="card hov shot" data-i="${i}"><i style="background-image:url('${esc(x.url)}')"></i><span><b>${esc(x.version)}</b><small>${new Date(x.date).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</small></span></button>`).join('')
    : `<div class="empty">${ico('image')}<p style="margin-top:8px">Noch keine Screenshots. Drück im Spiel F2.</p></div>`;
  S.shots = list;
}
window.loadShots = loadShots;
$('#sgal').addEventListener('click', e => {
  const b = e.target.closest('[data-i]'); if (!b) return;
  const x = S.shots[+b.dataset.i];
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button><img class="shotbig" src="${esc(x.url)}" alt="">
    <div class="act" style="justify-content:space-between"><span class="muted" style="font-size:12px">${esc(x.file)} · Minecraft ${esc(x.version)}</span>
    <span class="row"><button class="btn" onclick="api('screenshots.open',{id:'${esc(x.id)}',file:'${esc(x.file)}'})">${ico('folder')}Im Ordner zeigen</button><button class="btn d" onclick="api('screenshots.delete',{id:'${esc(x.id)}',file:'${esc(x.file)}'}).then(()=>{closeModal();loadShots();})">${ico('trash')}Löschen</button></span></div>`, 'form wide');
});

/* ======================= SETTINGS ======================= */
function setTab(k) {
  $$('#setTabs .tab').forEach(b => b.classList.toggle('on', b.dataset.st === k));
  $$('.stab').forEach(p => p.classList.toggle('hidden', p.dataset.stp !== k));
  if (k === 'java') loadJava();
}
window.setTab = setTab;
$('#setTabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) setTab(b.dataset.st); });
const setS = (key, value) => { S.settings[key] = value; return api('settings.set', { key, value }).catch(e => fail('Speichern fehlgeschlagen', e)); };
function renderSettings() {
  const s = S.settings;
  renderAccounts();
  const ram = $('#sRam'); ram.value = (s.ramMb || 4096) / 1024; setRange(ram); $('#sRamTxt').textContent = ram.value + ' GB für neue Instanzen';
  $('#sW').value = s.width || ''; $('#sH').value = s.height || '';
  $$('#sOnLaunch button').forEach(b => b.classList.toggle('on', b.dataset.v === (s.onLaunch || 'minimize')));
  $('#sSnap').classList.toggle('on', !!s.showSnapshots); $('#sOld').classList.toggle('on', !!s.showOld); $('#sAutoUp').classList.toggle('on', !!s.autoUpdateMods);
  $('#sJvm').value = s.jvmArgs || ''; $('#sJava').value = s.javaPath || '';
  $('#themes').innerHTML = Object.entries(THEMES).map(([k, [n, a, b]]) => `<div class="sw ${k === (s.accent || 'ember') ? 'on' : ''}" data-th="${k}"><i style="background:linear-gradient(135deg,${a},${b})"></i>${n}</div>`).join('');
  $('#aboutVer').textContent = 'OrbitLauncher ' + S.version; $('#aboutRoot').textContent = S.root;
}
window.renderSettings = renderSettings;
$('#sRam').addEventListener('input', e => { $('#sRamTxt').textContent = e.target.value + ' GB für neue Instanzen'; });
$('#sRam').addEventListener('change', e => setS('ramMb', +e.target.value * 1024));
$('#sW').addEventListener('change', e => setS('width', +e.target.value || 0));
$('#sH').addEventListener('change', e => setS('height', +e.target.value || 0));
$('#sJvm').addEventListener('change', e => setS('jvmArgs', e.target.value.trim() || null));
$('#sJava').addEventListener('change', e => setS('javaPath', e.target.value.trim() || null));
$('#sOnLaunch').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $$('#sOnLaunch button').forEach(x => x.classList.toggle('on', x === b)); setS('onLaunch', b.dataset.v); });
[['#sSnap', 'showSnapshots'], ['#sOld', 'showOld'], ['#sAutoUp', 'autoUpdateMods']].forEach(([sel, key]) => $(sel).addEventListener('click', e => { const on = !e.currentTarget.classList.contains('on'); e.currentTarget.classList.toggle('on', on); setS(key, on); }));
$('#themes').addEventListener('click', e => { const t = e.target.closest('[data-th]'); if (!t) return; applyTheme(t.dataset.th); setS('accent', t.dataset.th); $$('#themes .sw').forEach(x => x.classList.toggle('on', x === t)); $('#bnScene').innerHTML = bannerSvg(); });

function renderAccounts() {
  $('#accList').innerHTML = S.accounts.length ? S.accounts.map(a => `<div class="acc">${headHtml(a, 'head lg')}<div class="tx"><b>${esc(a.name)}</b><p>${a.uuid === S.active ? 'Aktives Konto' : 'Microsoft-Konto'} · UUID ${esc(a.uuid.slice(0, 8))}…</p></div>
      ${a.uuid === S.active ? '<span class="chip g">Aktiv</span>' : `<button class="btn sm" onclick="selectAccount('${a.uuid}')">Verwenden</button>`}<button class="ib sm d" title="Abmelden" onclick="removeAccount('${a.uuid}','${esc(a.name)}')">${ico('logout')}</button></div>`).join('')
    : `<div class="acc"><span class="head lg">?</span><div class="tx"><b>Kein Konto</b><p>Melde dich mit dem Microsoft-Konto an, das Minecraft besitzt.</p></div></div>`;
}
window.selectAccount = async uuid => { await api('auth.select', { uuid }); S.active = uuid; renderAccounts(); accountUI(); };
window.removeAccount = async (uuid, name) => {
  if (!await confirmBox('Abmelden?', `${name} wird aus dem Launcher entfernt. Das gespeicherte Token wird gelöscht.`, 'Abmelden', true)) return;
  const r = await api('auth.remove', { uuid }); S.accounts = r.accounts; S.active = r.active; renderAccounts(); accountUI();
};
async function login() {
  const err = $('#gateErr'); if (err) err.textContent = '';
  const btn = $('.g-ms'); if (btn) { btn.disabled = true; btn.classList.add('busy'); }
  try {
    const r = await api('auth.login');
    if (!r) return;   // window closed
    S.accounts = r.accounts; S.active = r.active; accountUI(); renderAccounts();
    gate(false);
    toast('Angemeldet', `Willkommen, ${r.account.name}!`);
  } catch (e) {
    if (e.message === 'NO_APP_ID') { gate(true); $('#gateDev').classList.remove('hidden'); $('#gateErr').textContent = ''; $('#gateAppId').focus(); }
    else if (!$('#gate').classList.contains('hidden')) $('#gateErr').textContent = e.message; else fail('Anmeldung fehlgeschlagen', e);
  } finally { if (btn) { btn.disabled = false; btn.classList.remove('busy'); } }
}
function gate(show) {
  $('#gate').classList.toggle('hidden', !show);
  if (show && !$('#gateBg').innerHTML) $('#gateBg').innerHTML = bannerSvg();
}
window.gate = gate;
async function saveAppId() {
  try {
    await api('auth.appid', { id: $('#gateAppId').value });
    $('#gateDev').classList.add('hidden'); $('#gateErr').textContent = '';
    toast('App-ID gespeichert', 'Jetzt mit Microsoft anmelden');
  } catch (e) { $('#gateErr').textContent = e.message; }
}
window.saveAppId = saveAppId;
window.login = login;
async function loadJava() {
  try {
    const j = await api('java.list');
    $('#javaList').innerHTML = j.length ? j.map(x => `<div class="jrow"><span class="iic">${ico('coffee')}</span><div class="tx"><b>Java ${x.major || '?'} · ${esc(x.source)}</b><p>${esc(x.path)}</p></div></div>`).join('')
      : '<div class="jrow"><div class="tx"><b>Noch keine Runtime geladen</b><p>Wird beim ersten Start automatisch heruntergeladen</p></div></div>';
  } catch { }
}

/* ======================= BOOT ======================= */
async function boot() {
  const t0 = performance.now();
  let init;
  try { init = await api('init'); } catch (e) { fail('Start fehlgeschlagen', e); init = { settings: {}, instances: [], accounts: [] }; }
  S.settings = init.settings || {}; S.instances = init.instances || []; S.accounts = init.accounts || []; S.active = init.active; S.version = init.version || S.version; S.root = init.root || '';
  (init.running || []).forEach(id => S.running.add(id));
  S.sel = S.settings.lastInstance && S.instances.find(i => i.id === S.settings.lastInstance) ? S.settings.lastInstance : S.instances[0]?.id;
  applyTheme(S.settings.accent || 'ember');
  $('#verTxt').textContent = 'v' + S.version;
  accountUI();
  S.orbit.ver = S.settings.orbitVersion || '26.3';
  try { await loadOrbit(); } catch { }
  runUI();
  if (!S.accounts.length) { gate(true); if (init.needAppId) $('#gateDev').classList.remove('hidden'); }
  api('versions.list', {}).then(r => { S.versions = r.versions; S.latest = r.latest; if (curPage === 'home') $('#bnLatest').textContent = `Neueste Version ${r.latest.release}`; }).catch(() => { });
  renderHome();
  requestAnimationFrame(moveInd);
  setTimeout(() => $('#splash').classList.add('out'), Math.max(0, 900 - (performance.now() - t0)));
  const q = new URLSearchParams(location.search).get('page'); if (q) setTimeout(() => go(q), 50);
}

/* ======================= MOCK BACKEND (browser preview) ======================= */
const Mock = {
  settings: { accent: 'ember', ramMb: 4096, onLaunch: 'minimize', clientId: '', lastInstance: 'orbit-client-26-3' },
  accounts: [{ uuid: '4a6f9e2c1b7d4e8f9a0b1c2d3e4f5a6b', name: 'Ky3ls', skin: null }],
  instances: [
    { id: 'orbit-client-26-3', name: 'Orbit Client 26.3', mcVersion: '26.3', loader: 'fabric', loaderVersion: '0.20.1', kind: 'orbit', icon: 'orbit', ramMb: 3072, playSeconds: 46800, lastPlayed: new Date(Date.now() - 3600e3).toISOString(), mods: 19 },
    { id: 'survival-1-21-11', name: 'Survival mit Freunden', mcVersion: '1.21.11', loader: 'vanilla', kind: 'custom', icon: 'grass', ramMb: 0, playSeconds: 210000, lastPlayed: new Date(Date.now() - 86400e3 * 2).toISOString(), mods: 0 },
    { id: 'technik-abenteuer', name: 'Technik-Abenteuer', mcVersion: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.266', kind: 'modpack', icon: 'ruby', ramMb: 8192, playSeconds: 92000, lastPlayed: new Date(Date.now() - 86400e3 * 5).toISOString(), mods: 214 },
    { id: 'pvp-1-8-9', name: 'PvP 1.8.9', mcVersion: '1.8.9', loader: 'vanilla', kind: 'custom', icon: 'diamond', ramMb: 2048, playSeconds: 12000, lastPlayed: new Date(Date.now() - 86400e3 * 12).toISOString(), mods: 0 },
    { id: 'fabric-snapshot', name: 'Snapshot-Test', mcVersion: '26.4-snapshot-8', loader: 'vanilla', kind: 'custom', icon: 'amethyst', ramMb: 0, playSeconds: 1800, lastPlayed: null, mods: 0 },
    { id: 'beta-nostalgie', name: 'Beta-Nostalgie', mcVersion: 'b1.7.3', loader: 'vanilla', kind: 'custom', icon: 'sand', ramMb: 1024, playSeconds: 5400, lastPlayed: new Date(Date.now() - 86400e3 * 40).toISOString(), mods: 0 },
  ],
  content: {
    mod: [['Sodium', 'sodium-fabric-0.8.14+mc26.3.jar', 'mc26.3-0.8.14', 1.2e6], ['Iris Shaders', 'iris-fabric-1.10.4+mc26.3.jar', '1.10.4', 2.6e6], ['Lithium', 'lithium-fabric-0.18.1+mc26.3.jar', '0.18.1', 0.8e6], ['AxolotlClient', 'axolotlclient-3.2.0+26.3.jar', '3.2.0', 3.1e6], ['Zoomify (Zoom)', 'zoomify-2.16.0+26.3.jar', '2.16.0', 0.4e6], ['Fabric API', 'fabric-api-0.142.1+26.3.jar', '0.142.1', 2.2e6, true], ['YetAnotherConfigLib (YACL)', 'yet_another_config_lib_v3-3.9.0.jar', '3.9.0', 1.1e6, true], ['Mod Menu', 'modmenu-17.0.0.jar', '17.0.0', 0.6e6]],
  },
  versions: null,
  async call(cmd, a) {
    await sleep(60); const M = this;
    switch (cmd) {
      case 'init': if (/gate/.test(location.search)) M.accounts = []; if (/noid/.test(location.search)) { M.accounts = []; return { needAppId: true, version: '0.1.0', root: '', settings: M.settings, instances: M.instances, accounts: [], active: null, running: [] }; } return { version: '0.1.0', root: 'C:\\Users\\Ky3ls\\AppData\\Roaming\\OrbitLauncher', settings: M.settings, instances: M.instances, accounts: M.accounts, active: M.accounts[0]?.uuid, running: [] };
      case 'instances.list': return M.instances;
      case 'settings.set': M.settings[a.key] = a.value; return {};
      case 'versions.list': {
        if (!M.versions) {
          try { const m = await (await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).json(); M.versions = { latest: m.latest, versions: m.versions.map(v => ({ id: v.id, type: v.type, released: v.releaseTime })) }; }
          catch { M.versions = { latest: { release: '26.3', snapshot: '26.4-snapshot-8' }, versions: ['26.3', '26.2', '26.1.2', '26.1', '1.21.11', '1.21.10', '1.21.4', '1.21.1', '1.20.6', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.9', '1.7.10'].map((id, i) => ({ id, type: 'release', released: new Date(Date.now() - i * 864e5 * 60).toISOString() })) }; }
        }
        return { ...M.versions, installed: ['26.3', '1.21.11', '1.8.9'] };
      }
      case 'loader.versions': return a.loader === 'forge' ? [{ version: a.mc + '-60.1.4', stable: true, recommended: true }, { version: a.mc + '-60.1.3', stable: true }] : a.loader === 'neoforge' ? [{ version: '21.1.266', stable: true }, { version: '21.1.265', stable: true }] : [{ version: '0.20.1', stable: true }, { version: '0.20.0', stable: true }, { version: '0.19.2', stable: true }];
      case 'loader.games': return (M.versions?.versions || []).filter(v => v.type === 'release').map(v => v.id).slice(0, a.loader === 'neoforge' ? 14 : 60);
      case 'instance.create': { const i = { id: a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: a.name, mcVersion: a.mc, loader: a.loader, loaderVersion: a.loaderVersion, kind: 'custom', icon: a.icon, ramMb: a.ramMb, playSeconds: 0, lastPlayed: null, mods: 0 }; M.instances.unshift(i); return i; }
      case 'instance.update': Object.assign(M.instances.find(i => i.id === a.id), a.patch); return {};
      case 'instance.delete': M.instances = M.instances.filter(i => i.id !== a.id); return {};
      case 'instance.content': {
        const i = M.instances.find(x => x.id === a.id);
        if (a.type === 'mod' && i.kind === 'orbit') return M.content.mod.map(([title, file, version, size, dep]) => ({ title, file, version, size, on: true, dependency: !!dep, projectId: title }));
        if (a.type === 'shader' && i.kind === 'orbit') return [{ title: 'ComplementaryReimagined_r5.6.zip', file: 'ComplementaryReimagined_r5.6.zip', on: true, size: 4.1e6 }];
        if (a.type === 'resourcepack') return [{ title: 'Faithful 32x', file: 'Faithful 32x - 26.3.zip', on: true, size: 9.8e6, version: '26.3' }];
        return [];
      }
      case 'content.updates': return [{ projectId: 'Sodium', title: 'Sodium', from: 'mc26.3-0.8.14', to: 'mc26.3-0.8.15' }];
      case 'launch': {
        const id = a.id; await sleep(200);
        for (const [st, n] of [['Bibliotheken', 64], ['Assets', 120]]) for (let k = 0; k <= n; k += 8) { onEvent('progress', { task: 'l' + id, stage: st, pct: Math.round(k / n * 100), total: n, detail: `${k}/${n}` }); await sleep(30); }
        onEvent('progress', { task: 'l' + id, done: true });
        onEvent('state', { id, running: true });
        ['[OrbitLauncher] java -Xmx3072M … net.fabricmc.loader.impl.launch.knot.KnotClient', '[18:42:01] [main/INFO]: Loading Minecraft 26.3 with Fabric Loader 0.20.1', '[18:42:02] [main/INFO]: Loading 19 mods', '[18:42:05] [Render thread/INFO]: Backend library: LWJGL version 3.4.3', '[18:42:06] [Render thread/WARN]: Shader complementary: option not found', '[18:42:09] [Render thread/INFO]: Sound engine started'].forEach(l => onEvent('log', { id, line: l }));
        return {};
      }
      case 'stop': onEvent('state', { id: a.id, running: false, code: 0 }); return {};
      case 'news': try {
        const j = await (await fetch('https://launchercontent.mojang.com/v2/javaPatchNotes.json')).json();
        return j.entries.slice(0, 6).map(e => ({ title: e.title, version: e.version, type: e.type, date: e.date, text: e.shortText, image: e.image ? 'https://launchercontent.mojang.com' + e.image.url : null }));
      } catch { return [{ title: 'Minecraft 26.4 Snapshot 8', type: 'snapshot', date: '2026-11-10', text: 'Fixes für den Enderdrachen und zwei neue Sprachen.' }, { title: 'Minecraft Java Edition 26.3', type: 'release', date: '2026-10-21', text: 'Das Herbst-Update ist da.' }, { title: 'Minecraft 26.3 Release Candidate 2', type: 'snapshot', date: '2026-10-16', text: 'Letzte Fehlerbehebungen.' }]; }
      case 'mr.categories': try { return await (await fetch('https://api.modrinth.com/v2/tag/category')).json(); } catch { return [{ name: 'optimization', project_type: 'mod', header: 'categories' }, { name: 'utility', project_type: 'mod', header: 'categories' }]; }
      case 'mr.search': {
        const facets = [['project_type:' + a.type]]; if (a.mc) facets.push(['versions:' + a.mc]); if (a.loader && ['mod', 'modpack'].includes(a.type)) facets.push(['categories:' + a.loader]); (a.cats || []).forEach(c => facets.push(['categories:' + c]));
        const u = `https://api.modrinth.com/v2/search?limit=${a.limit}&offset=${a.offset}&index=${a.sort}&facets=${encodeURIComponent(JSON.stringify(facets))}${a.query ? '&query=' + encodeURIComponent(a.query) : ''}`;
        try { return await (await fetch(u)).json(); } catch { return { total_hits: 2, hits: [{ project_id: 'AANobbMI', title: 'Sodium', author: 'jellysquid3', description: 'The fastest and most compatible rendering optimization mod for Minecraft.', downloads: 98e6, follows: 31e3, categories: ['optimization', 'fabric', 'neoforge'], icon_url: null }, { project_id: 'YL57xq9U', title: 'Iris Shaders', author: 'coderbot', description: 'A modern shader pack loader for Minecraft.', downloads: 76e6, follows: 22e3, categories: ['decoration', 'fabric'], icon_url: null }] }; }
      }
      case 'mr.project': return await (await fetch('https://api.modrinth.com/v2/project/' + a.id)).json();
      case 'mr.install': await sleep(900); return { installed: ['Zoomify (Zoom)', 'Fabric API', 'YetAnotherConfigLib (YACL)'], skipped: [] };
      case 'mr.modpack': await sleep(800); return M.instances[0];
      case 'orbit.info': return {
        best: '26.3', supported: ['26.3'], overlay: ['keystrokes', 'cps', 'crosshair', 'clock', 'session', 'memory'], last: '26.3',
        versions: (await Mock.call('versions.list', {})).versions,
        packs: [['perf', 'FPS-Boost', 'Sodium, Lithium, FerriteCore, Entity Culling, ImmediatelyFast, Dynamic FPS', 'zap', 1, 8], ['shaders', 'Shader-Support', 'Iris für Shaderpacks wie Complementary oder BSL', 'sun', 1, 1], ['qol', 'Komfort', 'AppleSkin, Mouse Tweaks, BetterF3, No Chat Reports', 'sparkle', 1, 4], ['visual', 'Optik', 'Dynamische Lichter, Connected Textures, 3D-Skin-Layer', 'layers', 0, 3]].map(([id, name, desc, icon, d, mods]) => ({ id, name, desc, icon, default: !!d, mods })),
        selPacks: M.settings.orbitPacks || 'perf,shaders,qol',
        existing: M.instances.filter(i => i.kind === 'orbit'),
      };
      case 'orbit.play': { await sleep(500); let i = M.instances.find(x => x.kind === 'orbit' && x.mcVersion === a.mc); if (!i) { i = { id: 'orbit-client-' + a.mc.replace(/\./g, '-'), name: 'Orbit Client ' + a.mc, mcVersion: a.mc, loader: 'fabric', kind: 'orbit', icon: 'orbit', ramMb: 3072, playSeconds: 0, mods: 14 }; M.instances.unshift(i); } await M.call('launch', { id: i.id }); return { id: i.id, mod: a.mc === '26.3' }; }
      case 'orbit.config.get': return M.ocfg || (M.ocfg = { accent: '#FF7A3D', modules: { crosshair: { enabled: true, opts: { style: 'Plus+Punkt', ccolor: 'Akzent' } }, fullbright: { enabled: true }, clock: { enabled: true }, armor: { opts: { color: 'Akzent' } } } });
      case 'orbit.config.set': M.ocfg = JSON.parse(JSON.stringify(a.config)); return {};
      case 'java.list': return [{ path: 'C:\\Users\\Ky3ls\\AppData\\Roaming\\OrbitLauncher\\runtime\\java-runtime-epsilon\\bin\\java.exe', major: 25, source: 'Mojang' }, { path: 'C:\\Users\\Ky3ls\\AppData\\Roaming\\OrbitLauncher\\runtime\\java-runtime-delta\\bin\\java.exe', major: 21, source: 'Mojang' }, { path: 'C:\\Users\\Ky3ls\\AppData\\Roaming\\OrbitLauncher\\runtime\\jre-legacy\\bin\\java.exe', major: 8, source: 'Mojang' }];
      case 'auth.appid': return { ok: true };
      case 'auth.login': if (/noid/.test(location.search) && !M.appid) throw new Error('NO_APP_ID'); await sleep(900); M.accounts = [{ uuid: '4a6f9e2c1b7d4e8f9a0b1c2d3e4f5a6b', name: 'Ky3ls', skin: null }]; return { account: M.accounts[0], accounts: M.accounts, active: M.accounts[0].uuid };
      case 'screenshots.list': return ['26.3', '26.3', '1.8.9', '1.21.11', '26.3', '1.21.11'].map((v, i) => ({ id: 'orbit-client-26-3', version: v, file: `2026-11-1${4 - (i >> 1)}_2${i}.14.0${i}.png`, url: 'data:image/svg+xml,' + encodeURIComponent(bannerSvg(i % 2 === 0)), date: new Date(Date.now() - i * 86400e3 / 2).toISOString() }));
      case 'auth.start': return { userCode: 'K7Q2-M9XD', verificationUri: 'https://www.microsoft.com/link' };
      case 'auth.finish': await sleep(600000); return {};
      case 'auth.remove': M.accounts = M.accounts.filter(x => x.uuid !== a.uuid); return { accounts: M.accounts, active: M.accounts[0]?.uuid };
      default: return {};
    }
  }
};

boot();
