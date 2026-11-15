'use strict';
/* OrbitLauncher – frontend. Talks to the C# host via WebView2 postMessage ({id,cmd,args} → {id,ok,data}, events via {event,data});
   in a normal browser a mock backend (bottom of this file) supplies demo data and live Mojang/Modrinth data. */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsq = s => esc(String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
const ico = (id, cls = 'i') => `<svg class="${cls}"><use href="#${id}"/></svg>`;
const bytes = b => { if (b == null || b < 0) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return (i ? b.toFixed(1).replace('.', ',') : b) + ' ' + u[i]; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' Mio.' : n >= 1e3 ? Math.round(n / 1e3) + ' Tsd.' : String(n ?? 0);
const ago = d => {
  if (!d) return 'Nie gespielt';
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 90) return 'Gerade eben'; if (s < 3600) return `Vor ${Math.round(s / 60)} Min.`; if (s < 86400) return `Vor ${Math.round(s / 3600)} Std.`;
  if (s < 86400 * 30) { const n = Math.round(s / 86400); return `Vor ${n} Tag${n > 1 ? 'en' : ''}`; }
  if (s < 86400 * 365) { const n = Math.round(s / 86400 / 30); return `Vor ${n} Monat${n > 1 ? 'en' : ''}`; }
  const n = Math.round(s / 86400 / 365); return `Vor ${n} Jahr${n > 1 ? 'en' : ''}`;
};
const ptime = s => !s ? '0 Std.' : s < 3600 ? Math.max(1, Math.round(s / 60)) + ' Min.' : (s / 3600).toFixed(s < 36000 ? 1 : 0).replace('.', ',') + ' Std.';
const dateDe = d => d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

const HOST = !!(window.chrome && window.chrome.webview);
let rid = 0; const pending = {};
function api(cmd, args = {}) {
  if (!HOST) return Mock.call(cmd, args);
  return new Promise((res, rej) => { const id = ++rid; pending[id] = { res, rej }; window.chrome.webview.postMessage({ id, cmd, args }); });
}
window.api = api;
if (HOST) window.chrome.webview.addEventListener('message', e => {
  const m = e.data;
  if (m.id && pending[m.id]) { const p = pending[m.id]; delete pending[m.id]; m.ok ? p.res(m.data) : p.rej(new Error(m.error || 'Fehler')); }
  else if (m.event) onEvent(m.event, m.data);
});
document.addEventListener('mousedown', e => { if (e.button === 0 && e.target.closest('[data-drag]') && !e.target.closest('button')) api('win.drag'); });
document.addEventListener('dblclick', e => { if (e.target.closest('[data-drag]') && !e.target.closest('button')) api('win.max'); });

/* Modrinth API (read-only) – through the host (proper user agent), live fetch in the browser preview */
const mrCache = new Map();
async function mr(path, cache = true) {
  if (cache && mrCache.has(path)) return mrCache.get(path);
  const p = api('mr.get', { path });
  if (cache) { mrCache.set(path, p); p.catch(() => mrCache.delete(path)); }
  return p;
}
const openUrl = url => api('open.url', { url });
window.openUrl = openUrl;

const S = {
  settings: {}, instances: [], versions: [], latest: {}, accounts: [], active: null, running: new Set(), logs: {}, tasks: {},
  java: [], version: '0.2.0', root: '', page: 'home', args: {}, hist: [], hi: -1,
};
const LOADERS = { vanilla: ['Vanilla', 'van'], fabric: ['Fabric', 'fab'], quilt: ['Quilt', 'qui'], forge: ['Forge', 'frg'], neoforge: ['NeoForge', 'neo'] };
const LCOL = { vanilla: '#4ADE9A', fabric: '#DBB67C', quilt: '#C48CFF', forge: '#78A0FF', neoforge: '#FF8C50' };
const loaderChip = l => `<span class="chip ${LOADERS[l]?.[1] || 'm'}">${LOADERS[l]?.[0] || esc(cap(l))}</span>`;
const cap = s => String(s || '').replace(/^./, c => c.toUpperCase());
const KIND = { custom: 'Eigene', modpack: 'Modpack', orbit: 'Orbit Client' };

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
  const px = (pts, c) => pts.map(([x, y]) => `<rect x="${x}" y="${y}" width="3" height="3" fill="${c}" opacity=".35"/>`).join('');
  return `<svg viewBox="0 0 64 64"><path d="M32 8 56 21 32 34 8 21Z" fill="${t}"/><path d="M8 21 32 34v24L8 45Z" fill="${l}"/><path d="M56 21 32 34v24l24-13Z" fill="${r}"/>
    ${grass ? `<path d="M8 21 32 34v6L8 27Z" fill="${t}" opacity=".9"/><path d="M56 21 32 34v6l24-13Z" fill="${t}" opacity=".75"/>` : ''}
    ${px([[14, 34], [22, 44], [16, 41], [26, 38]], '#000')}${px([[40, 40], [48, 32], [44, 46], [36, 48]], '#000')}
    <path d="M32 8 56 21 32 34 8 21Z" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="1"/></svg>`;
}
const instIcon = (i, cls = 'iic') => i?.iconUrl ? `<span class="${cls} img"><img src="${esc(i.iconUrl)}" alt="" loading="lazy"></span>` : `<span class="${cls}">${blockSvg(i?.icon || 'grass')}</span>`;
const picHtml = (url, cls = 'pic', icon = 'box') => url ? `<span class="${cls}" style="background-image:url('${esc(url)}')"></span>` : `<span class="${cls}">${ico(icon)}</span>`;

/* ======================= BANNER (original voxel landscape) ======================= */
function bannerSvg(day = false, H0) {
  const W = 1200, H = H0 || (day ? 675 : 300), s = 12, gid = 'bs' + Math.random().toString(36).slice(2, 8); let seed = day ? 7 : 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const a = getComputedStyle(document.documentElement).getPropertyValue('--a').trim() || '#FF7A3D';
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">${day ? '<stop offset="0" stop-color="#5E8FD6"/><stop offset="1" stop-color="#BFD8F2"/>' : `<stop offset="0" stop-color="#0B0B14"/><stop offset=".55" stop-color="#1C1626"/><stop offset="1" stop-color="${a}" stop-opacity=".55"/>`}</linearGradient></defs><rect width="${W}" height="${H}" fill="url(#${gid})"/>`;
  const k = H / (day ? 675 : 260);
  if (!day) for (let i = 0; i < 70; i++) out += `<rect x="${Math.floor(rnd() * W / 4) * 4}" y="${Math.floor(rnd() * 130 * k / 4) * 4}" width="3" height="3" fill="#fff" opacity="${(0.2 + rnd() * 0.6).toFixed(2)}"/>`;
  out += day ? '<rect x="900" y="40" width="50" height="50" fill="#FFF6C9"/><rect x="890" y="30" width="70" height="70" fill="#FFF6C9" opacity=".25"/>' + [[120, 50, 140], [420, 30, 180], [700, 70, 120]].map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="16" fill="#fff" opacity=".85"/><rect x="${x + 20}" y="${y - 10}" width="${w - 50}" height="12" fill="#fff" opacity=".85"/>`).join('')
    : `<rect x="930" y="${70 * k}" width="60" height="60" fill="${a}" opacity=".9"/><rect x="920" y="${60 * k}" width="80" height="80" fill="${a}" opacity=".18"/>`;
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
    : layer(150 * k, 40, '#191825', null, 3) + layer(180 * k, 26, '#1F2A22', '#2F4A2C', 2) + layer(215 * k, 16, '#2A2018', '#3E6B2E', 2);
  return out + '</svg>';
}

/* ======================= MOTION ======================= */
function moveInd() { const a = $('.nav.active'), ind = $('#navInd'); if (!a || !ind) { if (ind) ind.style.opacity = 0; return; } ind.style.transform = `translateY(${a.offsetTop}px)`; ind.style.opacity = 1; }
function enterPage(el) {
  if (!el) return;
  el.classList.remove('enter'); void el.offsetWidth;
  el.querySelectorAll('.card').forEach((c, i) => c.style.setProperty('--i', Math.min(i, 12)));
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

/* ======================= ROUTER (with back/forward like a browser) ======================= */
const NAV_OF = { inst: 'library', project: 'discover' };
const PAGES = {};
function go(p, args = {}, push = true) {
  closePop(); closeCtx();
  if (push) {
    const cur = S.hist[S.hi];
    if (!cur || cur.p !== p || JSON.stringify(cur.a) !== JSON.stringify(args)) { S.hist = S.hist.slice(0, S.hi + 1); S.hist.push({ p, a: args }); S.hi = S.hist.length - 1; }
  }
  const same = S.page === p;
  S.page = p; S.args = args;
  $$('.nav').forEach(n => n.classList.toggle('active', n.dataset.p === (NAV_OF[p] || p)));
  $('.sset').classList.toggle('on', p === 'settings');
  $$('.page').forEach(s => s.classList.toggle('show', s.id === 'p-' + p));
  moveInd();
  const el = $('#p-' + p);
  if (!same || push) el.scrollTop = 0;
  PAGES[p]?.(el, args);
  enterPage(el);
  histUI(); sideUI();
}
window.go = go;
function hist(d) { const n = S.hi + d; if (n < 0 || n >= S.hist.length) return; S.hi = n; const h = S.hist[n]; go(h.p, h.a, false); }
window.hist = hist;
function histUI() { $('#hBack').disabled = S.hi <= 0; $('#hFwd').disabled = S.hi >= S.hist.length - 1; }
function crumbs(list) {
  $('#crumbs').innerHTML = list.map((c, i) => i === list.length - 1 ? `<b>${esc(c[0])}</b>` : `<button onclick="${c[1]}">${esc(c[0])}</button>${ico('right')}`).join('');
}
document.addEventListener('mouseup', e => { if (e.button === 3) hist(-1); if (e.button === 4) hist(1); });
$('#side').addEventListener('click', e => { const n = e.target.closest('.nav'); if (n) go(n.dataset.p); });

/* ======================= TOAST / MODAL / POPOVER / CONTEXT MENU ======================= */
function toast(title, text = '', ok = true) {
  const t = document.createElement('div');
  t.className = 'toast' + (ok ? '' : ' err');
  t.innerHTML = `<div class="ti">${ico(ok ? 'check' : 'alert')}</div><div><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}</div>`;
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, ok ? 3600 : 6500);
}
const fail = (title, e) => toast(title, e?.message || String(e), false);
function modal(html, cls = '') { $('#mbox').className = 'card gb mbox ' + cls; $('#mbox').innerHTML = html; $('#modal').classList.add('show'); }
function closeModal() { $('#modal').classList.remove('show'); const f = S.modalClose; S.modalClose = null; f?.(); }
window.closeModal = closeModal;
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!$('#lightbox').classList.contains('hidden')) return $('#lightbox').classList.add('hidden'); closeModal(); closePop(); closeCtx(); }
  if (e.altKey && e.key === 'ArrowLeft') hist(-1);
  if (e.altKey && e.key === 'ArrowRight') hist(1);
});
function confirmBox(title, text, okText = 'Ja', danger = false) {
  return new Promise(res => {
    S.modalClose = () => res(false);
    modal(`<h1>${esc(title)}</h1><p>${esc(text)}</p><div class="act"><button class="btn" id="cbNo">Abbrechen</button><button class="btn ${danger ? 'd' : 'p'}" id="cbYes">${esc(okText)}</button></div>`);
    $('#cbNo').onclick = () => closeModal();
    $('#cbYes').onclick = () => { S.modalClose = null; closeModal(); res(true); };
  });
}
function promptBox(title, label, value = '', okText = 'Speichern') {
  return new Promise(res => {
    S.modalClose = () => res(null);
    modal(`<h1>${esc(title)}</h1><label class="fl">${esc(label)}</label><input class="in" id="pbIn" value="${esc(value)}"><div class="act" style="justify-content:flex-end"><button class="btn" id="pbNo">Abbrechen</button><button class="btn p" id="pbYes">${esc(okText)}</button></div>`, 'form');
    const ok = () => { const v = $('#pbIn').value.trim(); S.modalClose = null; closeModal(); res(v || null); };
    $('#pbNo').onclick = () => closeModal(); $('#pbYes').onclick = ok;
    $('#pbIn').onkeydown = e => { if (e.key === 'Enter') ok(); };
    setTimeout(() => { $('#pbIn').focus(); $('#pbIn').select(); }, 50);
  });
}
function closePop() { $('#pop')?.classList.add('hidden'); }
function popAt(anchor, html, w = 300, up = false) {
  const pop = $('#pop'), r = anchor.getBoundingClientRect();
  pop.innerHTML = html; pop.style.width = w + 'px';
  pop.classList.remove('hidden');
  pop.style.left = Math.min(innerWidth - w - 10, Math.max(10, r.left)) + 'px';
  pop.style.top = (up ? Math.max(10, r.top - pop.offsetHeight - 8) : Math.min(innerHeight - pop.offsetHeight - 10, r.bottom + 6)) + 'px';
}
document.addEventListener('mousedown', e => {
  if (!e.target.closest('#pop') && !e.target.closest('[data-pop]')) closePop();
  if (!e.target.closest('#ctx')) closeCtx();
});
function closeCtx() { $('#ctx')?.classList.add('hidden'); }
/* items: [icon, label, fn, danger] or '-' */
function ctxMenu(e, items) {
  e.preventDefault(); e.stopPropagation();
  const c = $('#ctx');
  S.ctxFns = [];
  c.innerHTML = items.map(it => it === '-' ? '<hr>' : `<button class="${it[3] ? 'd' : ''}" data-ci="${S.ctxFns.push(it[2]) - 1}">${ico(it[0])}${esc(it[1])}</button>`).join('');
  c.classList.remove('hidden');
  const x = e.clientX ?? e.target.getBoundingClientRect().left, y = e.clientY ?? e.target.getBoundingClientRect().bottom;
  c.style.left = Math.min(innerWidth - c.offsetWidth - 8, x) + 'px';
  c.style.top = Math.min(innerHeight - c.offsetHeight - 8, y) + 'px';
}
$('#ctx').addEventListener('click', e => { const b = e.target.closest('[data-ci]'); if (!b) return; closeCtx(); S.ctxFns[+b.dataset.ci]?.(); });

/* ======================= EVENTS ======================= */
function onEvent(ev, d) {
  if (ev === 'progress') return taskUpdate(d);
  if (ev === 'log') {
    const arr = S.logs[d.id] = S.logs[d.id] || [];
    arr.push(d.line); if (arr.length > 5000) arr.splice(0, arr.length - 5000);
    if (S.page === 'inst' && S.args.id === d.id && S.itab === 'logs' && S.logSel === '__live') appendLog(d.line);
    return;
  }
  if (ev === 'state') {
    d.running ? S.running.add(d.id) : S.running.delete(d.id);
    if (!d.running && d.code && d.code !== 0) {
      const i = S.instances.find(x => x.id === d.id);
      toast('Minecraft wurde beendet', `${i?.name || ''}: Exit-Code ${d.code}${d.crash ? ' · Crash-Report unter Logs' : ''}`, false);
    }
    refreshInstances();
  }
  if (ev === 'instances') { S.instances = d; instancesChanged(); }
  if (ev === 'orbitcfg') orbitCfgEvent(d);
}

/* progress tasks (several can run at once, the newest is shown) */
function taskUpdate(d) {
  if (d.done) delete S.tasks[d.task]; else S.tasks[d.task] = d;
  const list = Object.values(S.tasks), t = list[list.length - 1];
  $('#tbTask').classList.toggle('hidden', !t);
  if (!$('#pop').classList.contains('hidden') && $('#pop .tlist')) tasksPop();
  if (!t) return;
  $('#tbTaskTxt').textContent = (list.length > 1 ? list.length + ' Aufgaben · ' : '') + t.stage + (t.total > 1 ? ' · ' + t.pct + '%' : '');
  $('#tbTaskBar').style.width = (t.total > 1 ? t.pct : 100) + '%';
}
function tasksPop(e) {
  const list = Object.values(S.tasks);
  const html = `<div class="tlist">${list.length ? list.map(t => `<div class="tk"><b>${esc(t.stage)}</b><small>${esc(t.detail || '')}${t.total > 1 ? ' · ' + t.pct + '%' : ''}</small><div class="bar"><i style="width:${t.total > 1 ? t.pct : 100}%"></i></div></div>`).join('') : '<div class="tk"><small>Keine laufenden Downloads</small></div>'}</div>`;
  if (e) { e.stopPropagation(); popAt($('#tbTask'), html, 320); } else $('#pop').innerHTML = html;
}
window.tasksPop = tasksPop;

/* ======================= ACCOUNTS ======================= */
function headHtml(acc, cls = 'head') {
  if (acc?.skin) return `<span class="${cls} skin" style="background-image:url('${esc(acc.skin)}')"></span>`;
  return `<span class="${cls}">${esc((acc?.name || '?')[0].toUpperCase())}</span>`;
}
const activeAcc = () => S.accounts.find(x => x.uuid === S.active) || S.accounts[0];
function accountUI() {
  const a = activeAcc();
  $('#saccHead').outerHTML = headHtml(a, 'head').replace('class="head', 'id="saccHead" class="head');
  $('#saccName').textContent = a ? a.name : 'Anmelden';
  $('#saccSub').textContent = a ? 'Microsoft-Konto' : 'Nicht angemeldet';
}
function accountPop(e) {
  e.stopPropagation();
  if (!$('#pop').classList.contains('hidden')) return closePop();
  const html = (S.accounts.length ? S.accounts.map(a => `<button class="${a.uuid === S.active ? 'on' : ''}" onclick="selectAccount('${jsq(a.uuid)}')">${headHtml(a)}<span class="tx"><b>${esc(a.name)}</b><small>${a.uuid === S.active ? 'Aktiv' : 'Wechseln'}</small></span>${a.uuid === S.active ? ico('check') : ''}</button>`).join('') + '<hr>' : '')
    + `<button onclick="closePop();login()">${ico('plus')}<span class="tx"><b>Konto hinzufügen</b><small>Mit Microsoft anmelden</small></span></button>`
    + (S.accounts.length ? `<button onclick="closePop();go('skins')">${ico('shirt')}<span class="tx"><b>Skins &amp; Umhänge</b></span></button><button onclick="closePop();removeAccount('${jsq(S.active)}')">${ico('logout')}<span class="tx"><b>Abmelden</b></span></button>` : '');
  popAt($('#sacc'), html, 260, true);
}
window.accountPop = accountPop;
window.selectAccount = async uuid => { try { const r = await api('auth.select', { uuid }); S.accounts = r.accounts; S.active = r.active; } catch (e) { fail('Konto', e); } closePop(); accountUI(); if (S.page === 'skins' || S.page === 'settings' || S.page === 'home') go(S.page, S.args, false); };
window.removeAccount = async uuid => {
  const a = S.accounts.find(x => x.uuid === uuid); if (!a) return;
  if (!await confirmBox('Abmelden?', `${a.name} wird aus OrbitLauncher entfernt. Du kannst dich jederzeit wieder anmelden.`, 'Abmelden', true)) return;
  const r = await api('auth.remove', { uuid }); S.accounts = r.accounts; S.active = r.active; accountUI(); go(S.page, S.args, false);
};
async function login() {
  $('#gateErr').textContent = '';
  const b = $('.g-ms'); b?.classList.add('busy');
  try {
    const r = await api('auth.login');
    if (!r) return;
    S.accounts = r.accounts; S.active = r.active; accountUI();
    gate(false); toast('Angemeldet', 'Willkommen, ' + r.account.name);
    if (S.afterLogin) { const f = S.afterLogin; S.afterLogin = null; f(); }
    go(S.page, S.args, false);
  } catch (e) {
    if (e.message === 'NO_APP_ID') { gate(true); $('#gateErr').innerHTML = 'Die Microsoft-Anmeldung ist in dieser Version noch nicht freigeschaltet. Sie kommt mit einem Update, bis dahin kannst du dich umsehen.'; $('#gateDevLink').classList.remove('hidden'); }
    else if (!$('#gate').classList.contains('hidden')) $('#gateErr').textContent = e.message;
    else fail('Anmeldung fehlgeschlagen', e);
  } finally { b?.classList.remove('busy'); }
}
window.login = login;
function gate(show) {
  if (show && !$('#gateBg').innerHTML) $('#gateBg').innerHTML = bannerSvg(false, 675);
  $('#gate').classList.toggle('hidden', !show);
  if (!show) S.afterLogin = null;
}
window.gate = gate;
async function saveAppId() {
  const id = $('#gateAppId').value.trim();
  try { await api('auth.appid', { id }); $('#gateDev').classList.add('hidden'); $('#gateDevLink').classList.add('hidden'); $('#gateErr').textContent = ''; login(); }
  catch (e) { $('#gateErr').textContent = e.message; }
}
window.saveAppId = saveAppId;

/* ======================= INSTANCES (shared) ======================= */
const instById = id => S.instances.find(i => i.id === id);
const instSub = i => `${LOADERS[i.loader]?.[0] || cap(i.loader)} ${i.mcVersion}`;
async function refreshInstances() { try { S.instances = await api('instances.list'); } catch { } instancesChanged(); }
function instancesChanged() {
  sideUI(); runUI();
  if (S.page === 'home') PAGES.home($('#p-home'), S.args, true);
  if (S.page === 'library') renderLibGrid();
  if (S.page === 'inst') { const i = instById(S.args.id); if (i) instHead(i); else go('library'); }
}
function sideUI() {
  $('#navLib').textContent = S.instances.length || '';
  const list = S.instances.slice(0, 7);
  $('#sideInst').innerHTML = list.length ? list.map(i => {
    const run = S.running.has(i.id);
    return `<button class="si ${S.page === 'inst' && S.args.id === i.id ? 'on' : ''}" onclick="go('inst',{id:'${jsq(i.id)}'})" oncontextmenu="instCtx(event,'${jsq(i.id)}')">${instIcon(i)}${run ? '<i class="live"></i>' : ''}<span class="tx"><b>${esc(i.name)}</b><small>${esc(instSub(i))}</small></span>
      <span class="go ${run ? 'run' : ''}" onclick="event.stopPropagation();play('${jsq(i.id)}')" title="${run ? 'Beenden' : 'Spielen'}">${ico(run ? 'stop' : 'play', '')}</span></button>`;
  }).join('') : '<div class="si-empty">Noch keine Instanzen. Leg eine an oder installiere ein Modpack.</div>';
}
function runUI() {
  const ids = [...S.running], rp = $('#runPill');
  if (!ids.length) { rp.className = 'runpill idle'; rp.innerHTML = '<i class="dot"></i>Kein Spiel läuft'; return; }
  const i = instById(ids[0]);
  rp.className = 'runpill';
  rp.innerHTML = `<i class="dot on"></i><b>${esc(i?.name || ids[0])}</b>${ids.length > 1 ? `<span>+${ids.length - 1}</span>` : ''}
    <button title="Logs" onclick="go('inst',{id:'${jsq(ids[0])}',tab:'logs'})">${ico('terminal')}</button><button class="st" title="Beenden" onclick="play('${jsq(ids[0])}')">${ico('stop')}</button>`;
}
async function play(id, extra = {}) {
  const i = instById(id); if (!i) return;
  if (S.running.has(id)) { try { await api('stop', { id }); } catch (e) { fail('Beenden fehlgeschlagen', e); } return; }
  if (!S.accounts.length) { S.afterLogin = () => play(id, extra); return gate(true); }
  toast('Minecraft startet', `${i.name}${extra.world ? ' · Welt ' + extra.worldName : extra.server ? ' · ' + extra.server : ''}`);
  try { await api('launch', { id, ...extra }); }
  catch (e) { fail('Start fehlgeschlagen', e); }
}
window.play = play;
function instCtx(e, id) {
  const i = instById(id); if (!i) return;
  const run = S.running.has(id);
  ctxMenu(e, [[run ? 'stop' : 'play', run ? 'Beenden' : 'Spielen', () => play(id)], ['plus', 'Inhalte hinzufügen', () => go('discover', { type: i.loader === 'vanilla' ? 'resourcepack' : 'mod', target: id })],
    ['eye', 'Anzeigen', () => go('inst', { id })], ['settings', 'Einstellungen', () => instSettings(id)], '-',
    ['folder', 'Ordner öffnen', () => api('folder.open', { id, what: '' })], ['dup', 'Duplizieren', () => duplicateInst(id)], '-',
    ['trash', 'Löschen', () => deleteInst(id), true]]);
}
window.instCtx = instCtx;
async function duplicateInst(id) {
  try { const c = await api('instance.duplicate', { id }); toast('Dupliziert', c.name); await refreshInstances(); go('inst', { id: c.id }); }
  catch (e) { fail('Duplizieren fehlgeschlagen', e); }
}
async function deleteInst(id) {
  const i = instById(id); if (!i) return;
  if (!await confirmBox('Instanz löschen?', `„${i.name}“ wird mit allen Welten, Mods und Einstellungen gelöscht. Das kann nicht rückgängig gemacht werden.`, 'Löschen', true)) return;
  try { await api('instance.delete', { id }); toast('Gelöscht', i.name); if (S.page === 'inst') go('library'); await refreshInstances(); }
  catch (e) { fail('Löschen fehlgeschlagen', e); }
}
window.deleteInst = deleteInst;

/* ======================= HOME ======================= */
const RND_OFF = Math.floor(Math.random() * 4) * 12;
PAGES.home = async (el, a, soft) => {
  crumbs([['Start']]);
  const acc = activeAcc(), last = S.instances[0];
  const total = S.instances.reduce((s, i) => s + (i.playSeconds || 0), 0);
  const hcard = last ? `<div class="hcard">${instIcon(last)}<div class="tx"><small>Weiterspielen</small><b class="ell">${esc(last.name)}</b><small>${esc(instSub(last))} · ${esc(ago(last.lastPlayed))}</small></div>
      <button class="btn lg ${S.running.has(last.id) ? 'stop' : 'play'}" onclick="play('${jsq(last.id)}')">${ico(S.running.has(last.id) ? 'stop' : 'play')}${S.running.has(last.id) ? 'Beenden' : 'Spielen'}</button></div>` : '';
  const head = `<div class="hero2"><div class="hbg">${S.heroSvg || (S.heroSvg = bannerSvg(false, 300))}</div>
    <div class="hl"><div class="kicker">${acc ? 'Angemeldet als ' + esc(acc.name) : 'OrbitLauncher'}</div><h1>${acc ? 'Willkommen zurück, <span class="grad">' + esc(acc.name) + '</span>' : 'Willkommen bei <span class="grad">OrbitLauncher</span>'}</h1>
      <p class="hsub">${S.instances.length ? `${S.instances.length} Instanz${S.instances.length > 1 ? 'en' : ''} · ${ptime(total)} gespielt` : 'Jede Minecraft-Version, alle Mod-Loader und alles von Modrinth an einem Ort.'}</p>
      <div class="hact">${S.instances.length ? '' : `<button class="btn lg p" onclick="newInstance()">${ico('plus')}Erste Instanz erstellen</button><button class="btn lg" onclick="go('discover',{type:'modpack'})">${ico('compass')}Modpacks entdecken</button>`}${!acc ? `<button class="btn lg" onclick="login()">${ico('user')}Anmelden</button>` : ''}</div></div>${hcard}</div>`;
  if (soft && el.querySelector('.hgrid')) { el.querySelector('.hero2').outerHTML = head; homeRecent(); return; }
  el.innerHTML = `${head}<div class="hgrid"><div>
      <div id="hWorlds"></div><div id="hRecent"></div>
      <div class="sec"><h2>Beliebte Modpacks</h2><span class="sp"></span><button class="lnk" onclick="go('discover',{type:'modpack'})">Alle ansehen${ico('right')}</button></div><div class="prow" id="hPacks">${'<div class="skel" style="height:220px"></div>'.repeat(4)}</div>
      <div class="sec"><h2>Mods entdecken</h2><span class="sp"></span><button class="lnk" onclick="go('discover',{type:'mod'})">Alle ansehen${ico('right')}</button></div><div class="prow" id="hMods">${'<div class="skel" style="height:220px"></div>'.repeat(4)}</div>
    </div><div>
      <div class="sec" style="margin-top:28px"><h2>Orbit Client</h2></div>
      <button class="orbitcta" onclick="newInstance('orbit')"><span class="iic">${blockSvg('orbit')}</span><span><b>Eigener PvP-Client</b><small>Keystrokes, CPS, Zoom, Freelook, HUD-Editor und Performance-Mods in einer Instanz.</small></span></button>
      <div class="sec"><h2>Minecraft-News</h2></div><div class="newsl" id="hNews">${'<div class="skel" style="height:190px"></div>'.repeat(2)}</div>
    </div></div>`;
  homeRecent();
  api('worlds.recent').then(w => {
    S.recentWorlds = w;
    $('#hWorlds').innerHTML = w?.length ? `<div class="sec"><h2>Zurück in die Welt</h2></div><div class="wgrid">${w.slice(0, 6).map(x => worldCard(x, x.id, true)).join('')}</div>` : '';
  }).catch(() => { });
  const tile = h => `<button class="ptile" onclick="go('project',{id:'${jsq(h.project_id)}'})"><span class="gimg" style="${h.featured_gallery || h.gallery?.[0] ? `background-image:url('${esc(h.featured_gallery || h.gallery[0])}')` : ''}">${picHtml(h.icon_url)}</span>
    <span class="bd"><b>${esc(h.title)}</b><p>${esc(h.description)}</p><span class="row" style="gap:12px"><span class="stat">${ico('download')}<b>${num(h.downloads)}</b></span><span class="stat">${ico('heart')}<b>${num(h.follows)}</b></span></span></span></button>`;
  mr(`/search?limit=12&index=follows&facets=${encodeURIComponent('[["project_type:modpack"]]')}`).then(r => $('#hPacks') && ($('#hPacks').innerHTML = r.hits.map(tile).join(''))).catch(() => $('#hPacks') && ($('#hPacks').innerHTML = '<div class="empty">Modrinth ist gerade nicht erreichbar.</div>'));
  mr(`/search?limit=12&offset=${RND_OFF}&index=downloads&facets=${encodeURIComponent('[["project_type:mod"]]')}`).then(r => $('#hMods') && ($('#hMods').innerHTML = r.hits.map(tile).join(''))).catch(() => $('#hMods') && ($('#hMods').innerHTML = ''));
  (S.news ? Promise.resolve(S.news) : api('news')).then(n => {
    S.news = n;
    $('#hNews').innerHTML = (n || []).slice(0, 4).map(x => `<button class="nwi" onclick="openUrl('https://www.minecraft.net/de-de/article/minecraft-java-edition-${esc((x.version || '').replace(/\./g, '-'))}')">${x.image ? `<i style="background-image:url('${esc(x.image)}')"></i>` : ''}<div><b>${esc(x.title)}</b><small>${esc(dateDe(x.date))}</small><p>${esc(x.text || '')}</p></div></button>`).join('');
  }).catch(() => { $('#hNews').innerHTML = ''; });
};
function homeRecent() {
  const el = $('#hRecent'); if (!el) return;
  const list = S.instances.slice(0, 8);
  el.innerHTML = list.length ? `<div class="sec"><h2>Zuletzt gespielt</h2><span class="sp"></span><button class="lnk" onclick="go('library')">Bibliothek${ico('right')}</button></div><div class="igrid">${list.map(i => instCard(i, true)).join('')}</div>` : '';
}
function worldCard(w, id, showInst) {
  const i = instById(id), quick = supportsQuickPlay(i?.mcVersion);
  return `<div class="wcard">${w.icon ? `<span class="pic" style="background-image:url('${esc(w.icon)}')"></span>` : `<span class="pic">${ico('earth')}</span>`}
    <div class="tx"><b>${esc(w.name)}</b><small>${showInst ? esc(w.instance || i?.name || '') + ' · ' : ''}${esc(w.mode || 'Welt')} · ${esc(ago(w.lastPlayed))}</small></div>
    <button class="ib p" title="${quick ? 'Direkt in die Welt' : 'Spielen'}" onclick="play('${jsq(id)}',${quick ? `{world:'${jsq(w.folder)}',worldName:'${jsq(w.name)}'}` : '{}'})">${ico('play')}</button></div>`;
}
/* quick play (straight into a world/server) exists since 1.20 */
function supportsQuickPlay(v) {
  if (!v) return false;
  const m = /^(\d+)\.(\d+)/.exec(v); if (!m) return /^\d\dw\d\d/.test(v) && +v.slice(0, 2) >= 23;
  return +m[1] > 1 || +m[2] >= 20;
}
function instCard(i, mini) {
  const run = S.running.has(i.id);
  return `<div class="icard ${mini ? 'mini' : ''}" onclick="go('inst',{id:'${jsq(i.id)}'})" oncontextmenu="instCtx(event,'${jsq(i.id)}')">
    <div class="cv">${instIcon(i)}${run ? '<span class="lv"><i class="dot on"></i>LÄUFT</span>' : ''}</div>
    <button class="pl ${run ? 'run' : ''}" onclick="event.stopPropagation();play('${jsq(i.id)}')" title="${run ? 'Beenden' : 'Spielen'}">${ico(run ? 'stop' : 'play', '')}</button>
    <div class="bd"><b>${esc(i.name)}</b><small>${esc(instSub(i))}${mini ? '' : ' · ' + esc(ago(i.lastPlayed))}</small>${mini ? '' : `<div class="chips">${loaderChip(i.loader)}${i.kind !== 'custom' ? `<span class="chip ${i.kind === 'orbit' ? 'a' : 'm'}">${KIND[i.kind]}</span>` : ''}${i.mods ? `<span class="chip m">${i.mods} Mods</span>` : ''}</div>`}</div></div>`;
}

/* ======================= LIBRARY ======================= */
S.lib = { tab: 'all', q: '', sort: 'played', group: 'group' };
try { Object.assign(S.lib, JSON.parse(localStorage.getItem('orbit.lib') || '{}'), { q: '' }); } catch { }
PAGES.library = el => {
  crumbs([['Bibliothek']]);
  const L = S.lib;
  el.innerHTML = `<div class="ph"><div><div class="kicker">Deine Instanzen</div><h1>Bibliothek</h1></div><div class="ph-r"><button class="btn" onclick="importPack()">${ico('upload')}.mrpack importieren</button><button class="btn p" onclick="newInstance()">${ico('plus')}Instanz erstellen</button></div></div>
    <div class="lbar"><div class="seg" id="libTabs">${[['all', 'Alle'], ['modpack', 'Modpacks'], ['custom', 'Eigene'], ['orbit', 'Orbit Client']].map(([k, n]) => `<button data-k="${k}" class="${L.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="srch">${ico('search')}<input class="in" id="libQ" placeholder="Instanzen durchsuchen…" value="${esc(L.q)}"></div><span class="sp"></span>
      <select class="sel" id="libSort">${[['played', 'Zuletzt gespielt'], ['name', 'Name'], ['created', 'Neueste zuerst'], ['time', 'Meiste Spielzeit'], ['version', 'Spielversion']].map(([k, n]) => `<option value="${k}" ${L.sort === k ? 'selected' : ''}>Sortieren: ${n}</option>`).join('')}</select>
      <select class="sel" id="libGroup">${[['group', 'Gruppe'], ['loader', 'Loader'], ['version', 'Spielversion'], ['none', 'Keine']].map(([k, n]) => `<option value="${k}" ${L.group === k ? 'selected' : ''}>Gruppieren: ${n}</option>`).join('')}</select></div>
    <div id="libGrid"></div>`;
  const save = () => { try { localStorage.setItem('orbit.lib', JSON.stringify(L)); } catch { } renderLibGrid(); };
  $('#libTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; L.tab = b.dataset.k; $$('#libTabs button').forEach(x => x.classList.toggle('on', x === b)); save(); };
  $('#libQ').oninput = e => { L.q = e.target.value; renderLibGrid(); };
  $('#libSort').onchange = e => { L.sort = e.target.value; save(); };
  $('#libGroup').onchange = e => { L.group = e.target.value; save(); };
  renderLibGrid();
};
const vkey = v => (v || '').split(/[.\-]/).map(x => /^\d+$/.test(x) ? x.padStart(4, '0') : x).join('.');
function renderLibGrid() {
  const el = $('#libGrid'); if (!el) return;
  const L = S.lib, q = L.q.trim().toLowerCase();
  let list = S.instances.filter(i => (L.tab === 'all' || i.kind === L.tab) && (!q || (i.name + ' ' + i.mcVersion + ' ' + i.loader).toLowerCase().includes(q)));
  const by = { played: (a, b) => new Date(b.lastPlayed || 0) - new Date(a.lastPlayed || 0), name: (a, b) => a.name.localeCompare(b.name, 'de'), created: (a, b) => new Date(b.created || 0) - new Date(a.created || 0), time: (a, b) => (b.playSeconds || 0) - (a.playSeconds || 0), version: (a, b) => vkey(b.mcVersion).localeCompare(vkey(a.mcVersion)) };
  list.sort(by[L.sort] || by.played);
  if (!S.instances.length) {
    el.innerHTML = `<div class="lempty"><span class="iic">${blockSvg('grass')}</span><h2>Noch keine Instanzen</h2><p>Eine Instanz ist ein eigenes Minecraft mit eigener Version, eigenen Mods und eigenen Welten. Erstell eine oder installier ein Modpack.</p>
      <div class="row" style="justify-content:center"><button class="btn p" onclick="newInstance()">${ico('plus')}Instanz erstellen</button><button class="btn" onclick="go('discover',{type:'modpack'})">${ico('compass')}Modpacks ansehen</button></div></div>`;
    return;
  }
  if (!list.length) { el.innerHTML = `<div class="empty">Keine Instanz passt zu „${esc(L.q)}“.</div>`; return; }
  const keyOf = { group: i => i.group || (i.kind === 'orbit' ? 'Orbit Client' : i.kind === 'modpack' ? 'Modpacks' : 'Ohne Gruppe'), loader: i => LOADERS[i.loader]?.[0] || i.loader, version: i => 'Minecraft ' + i.mcVersion.split('.').slice(0, 2).join('.'), none: () => '' }[L.group];
  const groups = new Map();
  list.forEach(i => { const k = keyOf(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
  el.innerHTML = [...groups].map(([k, l]) => `<div class="ggrp">${k ? `<h3>${esc(k)}<i>${l.length}</i></h3>` : ''}<div class="igrid">${l.map(i => instCard(i)).join('')}</div></div>`).join('');
}
async function importPack() {
  try { const inst = await api('pack.import'); if (!inst) return; toast('Modpack importiert', inst.name); await refreshInstances(); go('inst', { id: inst.id }); }
  catch (e) { fail('Import fehlgeschlagen', e); }
}
window.importPack = importPack;

/* ======================= INSTANCE PAGE ======================= */
const CTYPES = [['mod', 'Mods', 'puzzle'], ['resourcepack', 'Ressourcenpakete', 'image'], ['shader', 'Shader', 'sun']];
PAGES.inst = (el, a) => {
  const i = instById(a.id); if (!i) return go('library');
  S.itab = a.tab || (S.itabFor === i.id ? S.itab : 'content'); S.itabFor = i.id;
  if (!['content', 'worlds', 'logs', 'orbit'].includes(S.itab) || (S.itab === 'orbit' && !hasOrbitMod(i))) S.itab = 'content';
  crumbs([['Bibliothek', "go('library')"], [i.name]]);
  el.innerHTML = `<div id="iHead"></div><div class="itabs" id="iTabs"></div><div id="iBody"></div>`;
  instHead(i);
  $('#iTabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { S.itab = b.dataset.t; S.hist[S.hi].a = { id: i.id, tab: S.itab }; instTabs(i); } };
  instTabs(i);
};
const hasOrbitMod = i => i.kind === 'orbit' && i.loader === 'fabric' && (S.orbitSupported || ['26.3']).includes(i.mcVersion);
function instHead(i) {
  const run = S.running.has(i.id), el = $('#iHead'); if (!el) return;
  el.innerHTML = `<div class="ihead">${instIcon(i)}<div class="tx"><div class="kicker">${KIND[i.kind] || 'Instanz'}${i.group ? ' · ' + esc(i.group) : ''}</div><h1>${esc(i.name)}</h1>
      <div class="meta">${loaderChip(i.loader)}<span class="stat">${ico('cube')}Minecraft <b>${esc(i.mcVersion)}</b></span>${i.loaderVersion ? `<span class="stat">${ico('tag')}${esc(i.loaderVersion)}</span>` : ''}<span class="stat">${ico('clock')}<b>${ptime(i.playSeconds)}</b> gespielt</span><span class="stat">${ico('cal')}${esc(ago(i.lastPlayed))}</span></div></div>
    <div class="acts"><button class="btn lg ${run ? 'stop' : 'play'}" onclick="play('${jsq(i.id)}')">${ico(run ? 'stop' : 'play')}${run ? 'Beenden' : 'Spielen'}</button>
      <button class="ib" title="Ordner öffnen" onclick="api('folder.open',{id:'${jsq(i.id)}',what:''})">${ico('folder')}</button>
      <button class="ib" title="Einstellungen" onclick="instSettings('${jsq(i.id)}')">${ico('settings')}</button>
      <button class="ib nr" title="Mehr" onclick="instCtx(event,'${jsq(i.id)}')">${ico('more')}</button></div></div>`;
}
function instTabs(i) {
  const t = [['content', 'Inhalte', 'layers', S.content?.id === i.id ? S.content.all.length : (i.mods || '')], ['worlds', 'Welten', 'earth'], ['logs', 'Logs', 'terminal']];
  if (hasOrbitMod(i)) t.push(['orbit', 'Orbit Client', 'orbit']);
  $('#iTabs').innerHTML = t.map(([k, n, ic, c]) => `<button data-t="${k}" class="${S.itab === k ? 'on' : ''}">${ico(ic)}${n}${c ? `<span class="c">${c}</span>` : ''}</button>`).join('');
  ({ content: instContent, worlds: instWorlds, logs: instLogs, orbit: instOrbit })[S.itab](i);
}

/* ---------- content ---------- */
async function instContent(i) {
  const body = $('#iBody');
  const C = S.content?.id === i.id ? S.content : (S.content = { id: i.id, all: [], type: 'all', q: '', sel: new Set(), updates: null, loaded: false });
  const types = i.loader === 'vanilla' ? CTYPES.slice(1) : CTYPES;
  body.innerHTML = `<div class="cbar"><div class="fchips" id="cTypes"></div><div class="srch">${ico('search')}<input class="in" id="cQ" placeholder="Inhalte durchsuchen…" value="${esc(C.q)}"></div><span class="sp"></span>
    <button class="btn sm" id="cUpd" onclick="checkUpdates()">${ico('refresh')}Updates</button>
    <button class="btn sm" onclick="addFile()">${ico('file')}Aus Datei</button>
    <button class="btn sm p" onclick="go('discover',{type:'${i.loader === 'vanilla' ? 'resourcepack' : 'mod'}',target:'${jsq(i.id)}'})">${ico('plus')}Inhalte hinzufügen</button></div>
    <div id="cSel"></div><div id="cList">${C.loaded ? '' : '<div class="spinner"></div>'}</div>`;
  const draw = () => renderContent(i, types);
  $('#cQ').oninput = e => { C.q = e.target.value; draw(); };
  if (C.loaded) draw();
  try {
    const res = await Promise.all(types.map(([t]) => api('instance.content', { id: i.id, type: t }).then(l => l.map(x => ({ ...x, type: t }))).catch(() => [])));
    if (S.content !== C) return;
    C.all = res.flat(); C.loaded = true;
    if (S.page === 'inst' && S.args.id === i.id && S.itab === 'content') { draw(); const tb = $('#iTabs [data-t=content] .c'); if (tb) tb.textContent = C.all.length; }
  } catch (e) { fail('Inhalte', e); }
}
function renderContent(i, types) {
  const C = S.content, el = $('#cList'); if (!el) return;
  const counts = Object.fromEntries(types.map(([t]) => [t, C.all.filter(x => x.type === t).length]));
  $('#cTypes').innerHTML = [['all', 'Alle', null]].concat(types).map(([t, n]) => `<button class="fchip ${C.type === t ? 'on' : ''}" data-t="${t}">${n}<i>${t === 'all' ? C.all.length : counts[t]}</i></button>`).join('');
  $('#cTypes').onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; C.type = b.dataset.t; renderContent(i, types); };
  const q = C.q.trim().toLowerCase();
  const list = C.all.filter(x => (C.type === 'all' || x.type === C.type) && (!q || (x.title + ' ' + x.file).toLowerCase().includes(q)))
    .sort((a, b) => (a.dependency - b.dependency) || a.title.localeCompare(b.title, 'de'));
  const upd = new Map((C.updates || []).map(u => [u.projectId, u]));
  if (!C.all.length) {
    el.innerHTML = `<div class="lempty"><span class="iic">${ico('puzzle')}</span><h2>Noch keine Inhalte</h2><p>Füg Mods, Ressourcenpakete oder Shader von Modrinth hinzu. Abhängigkeiten werden automatisch mitinstalliert.</p>
      <button class="btn p" onclick="go('discover',{type:'${i.loader === 'vanilla' ? 'resourcepack' : 'mod'}',target:'${jsq(i.id)}'})">${ico('compass')}Inhalte entdecken</button></div>`;
    $('#cSel').innerHTML = ''; return;
  }
  const key = x => x.type + '|' + x.file;
  const allSel = list.length && list.every(x => C.sel.has(key(x)));
  el.innerHTML = `<div class="ctable"><div class="ch"><span class="cb ${allSel ? 'on' : ''}" data-all><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span><span>Name</span><span>Version</span><span style="text-align:right">Aktionen</span></div>
    ${list.length ? list.map(x => {
      const u = x.projectId && upd.get(x.projectId), k = key(x);
      return `<div class="cr ${x.on ? '' : 'off'}" data-k="${esc(k)}"><span class="cb ${C.sel.has(k) ? 'on' : ''}" data-s><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>
        <div class="nm">${picHtml(x.icon, 'pic', CTYPES.find(c => c[0] === x.type)?.[2] || 'puzzle')}<div><b>${esc(x.title)}${x.dependency ? '<span class="chip m">Abhängigkeit</span>' : ''}</b><small>${esc(x.file)}</small></div></div>
        <div class="vr ell">${esc(x.version || '—')}<small>${bytes(x.size)}${x.projectId ? '' : ' · manuell'}</small></div>
        <div class="ac">${u ? `<button class="ib sm up" title="Update auf ${esc(u.to)}" data-u="${esc(u.projectId)}">${ico('arrowup')}</button>` : ''}${x.projectId ? `<button class="ib sm" title="Auf Modrinth ansehen" data-p="${esc(x.projectId)}">${ico('eye')}</button>` : ''}<div class="tg sm ${x.on ? 'on' : ''}" data-tg></div><button class="ib sm d" title="Entfernen" data-rm>${ico('trash')}</button></div></div>`;
    }).join('') : '<div class="cr"><span></span><span class="muted">Nichts gefunden.</span></div>'}</div>`;
  const selBar = () => {
    const n = C.sel.size;
    $('#cSel').innerHTML = n ? `<div class="selbar"><b>${n} ausgewählt</b><span class="sp"></span><button class="btn sm" data-b="on">${ico('check')}Aktivieren</button><button class="btn sm" data-b="off">${ico('x')}Deaktivieren</button><button class="btn sm d" data-b="rm">${ico('trash')}Entfernen</button><button class="ib sm ghost" data-b="clr">${ico('x')}</button></div>` : '';
  };
  selBar();
  $('#cSel').onclick = async e => {
    const b = e.target.closest('[data-b]'); if (!b) return;
    const items = C.all.filter(x => C.sel.has(key(x)));
    if (b.dataset.b === 'clr') { C.sel.clear(); return renderContent(i, types); }
    if (b.dataset.b === 'rm') { if (!await confirmBox(`${items.length} Einträge entfernen?`, 'Die Dateien werden aus der Instanz gelöscht.', 'Entfernen', true)) return; for (const x of items) { try { await api('content.remove', { id: i.id, type: x.type, file: x.file }); } catch { } } C.all = C.all.filter(x => !C.sel.has(key(x))); }
    else for (const x of items) { const on = b.dataset.b === 'on'; try { await api('content.toggle', { id: i.id, type: x.type, file: x.file, on }); x.on = on; } catch { } }
    C.sel.clear(); renderContent(i, types);
  };
  el.onclick = async e => {
    if (e.target.closest('[data-all]')) { if (allSel) list.forEach(x => C.sel.delete(key(x))); else list.forEach(x => C.sel.add(key(x))); return renderContent(i, types); }
    const row = e.target.closest('.cr[data-k]'); if (!row) return;
    const x = C.all.find(y => key(y) === row.dataset.k); if (!x) return;
    if (e.target.closest('[data-s]')) { C.sel.has(row.dataset.k) ? C.sel.delete(row.dataset.k) : C.sel.add(row.dataset.k); e.target.closest('[data-s]').classList.toggle('on'); return selBar(); }
    if (e.target.closest('[data-p]')) return go('project', { id: x.projectId });
    if (e.target.closest('[data-tg]')) {
      const on = !x.on; x.on = on; row.classList.toggle('off', !on); e.target.closest('[data-tg]').classList.toggle('on', on);
      try { await api('content.toggle', { id: i.id, type: x.type, file: x.file, on }); } catch (er) { fail('Fehler', er); }
      return;
    }
    if (e.target.closest('[data-rm]')) {
      if (!await confirmBox('Entfernen?', `„${x.title}“ wird aus der Instanz gelöscht.`, 'Entfernen', true)) return;
      try { await api('content.remove', { id: i.id, type: x.type, file: x.file }); C.all = C.all.filter(y => y !== x); renderContent(i, types); } catch (er) { fail('Fehler', er); }
      return;
    }
    if (e.target.closest('[data-u]')) return updateAll();
  };
}
async function checkUpdates() {
  const i = instById(S.args.id), C = S.content; if (!i || !C) return;
  const b = $('#cUpd'); b.disabled = true; b.innerHTML = ico('refresh', 'i spin') + 'Prüfe…';
  try {
    C.updates = await api('content.updates', { id: i.id });
    const n = C.updates.length;
    b.disabled = false;
    if (n) { b.className = 'btn sm p'; b.innerHTML = ico('download') + `Alle aktualisieren (${n})`; b.onclick = updateAll; }
    else { b.innerHTML = ico('check') + 'Alles aktuell'; }
    renderContent(i, i.loader === 'vanilla' ? CTYPES.slice(1) : CTYPES);
  } catch (e) { b.disabled = false; b.innerHTML = ico('refresh') + 'Updates prüfen'; fail('Updates', e); }
}
window.checkUpdates = checkUpdates;
async function updateAll() {
  const i = instById(S.args.id); if (!i) return;
  try { const r = await api('content.updateAll', { id: i.id }); toast('Aktualisiert', `${r.count} Datei${r.count === 1 ? '' : 'en'} in ${i.name}`); S.content.updates = []; S.content.loaded = false; instContent(i); }
  catch (e) { fail('Update fehlgeschlagen', e); }
}
async function addFile() {
  const i = instById(S.args.id), C = S.content; if (!i) return;
  const t = C.type === 'all' ? (i.loader === 'vanilla' ? 'resourcepack' : 'mod') : C.type;
  try { const r = await api('content.addFile', { id: i.id, type: t }); if (r?.count) { toast('Hinzugefügt', `${r.count} Datei${r.count > 1 ? 'en' : ''}`); C.loaded = false; instContent(i); } }
  catch (e) { fail('Hinzufügen fehlgeschlagen', e); }
}
window.addFile = addFile;

/* ---------- worlds ---------- */
async function instWorlds(i) {
  const body = $('#iBody');
  body.innerHTML = '<div class="spinner"></div>';
  let r = { worlds: [], servers: [] };
  try { r = await api('instance.worlds', { id: i.id }); } catch (e) { fail('Welten', e); }
  if (S.itab !== 'worlds') return;
  const quick = supportsQuickPlay(i.mcVersion);
  body.innerHTML = `${quick ? '' : `<div class="note" style="margin:0 0 14px">Direkt in eine Welt oder auf einen Server springen geht ab Minecraft 1.20. Bei ${esc(i.mcVersion)} startet das Spiel normal${''}.</div>`}
    <div class="sec" style="margin-top:0"><h2>Welten</h2><span class="muted">${r.worlds.length}</span><span class="sp"></span><button class="btn sm" onclick="api('folder.open',{id:'${jsq(i.id)}',what:'saves'})">${ico('folder')}Ordner</button></div>
    <div class="wlist">${r.worlds.length ? r.worlds.map(w => `<div class="wcard">${w.icon ? `<span class="pic" style="background-image:url('${esc(w.icon)}')"></span>` : `<span class="pic">${ico('earth')}</span>`}<div class="tx"><b>${esc(w.name)}</b><small>${esc(w.mode || 'Welt')} · ${esc(ago(w.lastPlayed))} · ${esc(w.folder)}</small></div>
      <button class="ib" title="Ordner" onclick="api('world.open',{id:'${jsq(i.id)}',folder:'${jsq(w.folder)}'})">${ico('folder')}</button><button class="ib d" title="Löschen (Papierkorb)" onclick="delWorld('${jsq(i.id)}','${jsq(w.folder)}','${jsq(w.name)}')">${ico('trash')}</button>
      <button class="btn sm play" onclick="play('${jsq(i.id)}',${quick ? `{world:'${jsq(w.folder)}',worldName:'${jsq(w.name)}'}` : '{}'})">${ico('play')}Spielen</button></div>`).join('') : '<div class="empty">Noch keine Welten. Starte das Spiel und erstell eine.</div>'}</div>
    <div class="sec"><h2>Server</h2><span class="muted">${r.servers.length}</span></div>
    <div class="wlist">${r.servers.length ? r.servers.map(s => `<div class="wcard">${s.icon ? `<span class="pic" style="background-image:url('${esc(s.icon)}')"></span>` : `<span class="pic">${ico('server')}</span>`}<div class="tx"><b>${esc(s.name)}</b><small>${esc(s.ip)}</small></div>
      <button class="btn sm play" onclick="play('${jsq(i.id)}',{server:'${jsq(s.ip)}'})">${ico('play')}Beitreten</button></div>`).join('') : '<div class="empty">Keine Server gespeichert. Server, die du im Spiel hinzufügst, erscheinen hier.</div>'}</div>`;
}
window.delWorld = async (id, folder, name) => {
  if (!await confirmBox('Welt löschen?', `„${name}“ wird in den Papierkorb verschoben.`, 'Löschen', true)) return;
  try { await api('world.delete', { id, folder }); toast('Welt gelöscht', name); instWorlds(instById(id)); } catch (e) { fail('Löschen fehlgeschlagen', e); }
};

/* ---------- logs ---------- */
async function instLogs(i) {
  const body = $('#iBody');
  S.logSel = S.logSel && S.logFor === i.id ? S.logSel : '__live'; S.logFor = i.id;
  body.innerHTML = `<div class="logs"><div class="loglist" id="logList"></div><div class="logbox"><div class="row"><div class="srch">${ico('search')}<input class="in" id="logQ" placeholder="Im Log suchen…" style="height:36px"></div>
    <button class="btn sm" onclick="copyLog()">${ico('copy')}Kopieren</button><button class="btn sm" onclick="api('folder.open',{id:'${jsq(i.id)}',what:'logs'})">${ico('folder')}Ordner</button></div><div class="logv" id="logv"></div></div></div>`;
  let files = [];
  try { files = await api('instance.logs', { id: i.id }); } catch { }
  const list = () => $('#logList').innerHTML = `<button data-n="__live" class="${S.logSel === '__live' ? 'on' : ''}"><span class="lv"><i class="dot ${S.running.has(i.id) ? 'on' : ''}"></i><b>Live-Konsole</b></span><small>${S.running.has(i.id) ? 'Läuft gerade' : 'Diese Sitzung'}</small></button>`
    + files.map(f => `<button data-n="${esc(f.name)}" class="${S.logSel === f.name ? 'on' : ''}"><b>${esc(f.name.split('/')[1])}</b><small>${f.name.startsWith('crash') ? 'Crash-Report · ' : ''}${esc(new Date(f.date).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }))} · ${bytes(f.size)}</small></button>`).join('');
  list();
  $('#logList').onclick = e => { const b = e.target.closest('[data-n]'); if (!b) return; S.logSel = b.dataset.n; list(); showLog(i); };
  $('#logQ').oninput = () => showLog(i, true);
  showLog(i);
}
const logCls = l => /\b(ERROR|FATAL|Exception)\b|^\s+at /.test(l) ? 'e' : /\bWARN\b/.test(l) ? 'w' : '';
async function showLog(i, filterOnly) {
  const v = $('#logv'); if (!v) return;
  if (!filterOnly) {
    if (S.logSel === '__live') S.logText = (S.logs[i.id] || []);
    else { v.textContent = 'Lädt…'; try { S.logText = (await api('instance.log', { id: i.id, name: S.logSel })).text.split(/\r?\n/); } catch (e) { S.logText = ['Fehler: ' + e.message]; } }
  }
  const q = ($('#logQ')?.value || '').toLowerCase();
  const lines = (S.logText || []).filter(l => !q || l.toLowerCase().includes(q)).slice(-4000);
  v.innerHTML = lines.length ? lines.map(l => `<div class="${logCls(l)}">${esc(l)}</div>`).join('') : `<div class="i">${S.logSel === '__live' ? 'Noch keine Ausgabe. Starte das Spiel, dann erscheint das Log hier live.' : 'Leer.'}</div>`;
  v.scrollTop = v.scrollHeight;
}
function appendLog(line) {
  const v = $('#logv'); if (!v) return;
  const q = ($('#logQ')?.value || '').toLowerCase(); if (q && !line.toLowerCase().includes(q)) return;
  if (v.firstChild?.classList?.contains('i')) v.innerHTML = '';
  const stick = v.scrollTop + v.clientHeight > v.scrollHeight - 30;
  const d = document.createElement('div'); d.className = logCls(line); d.textContent = line; v.append(d);
  if (v.childElementCount > 4000) v.firstChild.remove();
  if (stick) v.scrollTop = v.scrollHeight;
}
window.copyLog = () => { navigator.clipboard?.writeText((S.logText || []).join('\n')); toast('Log kopiert'); };

/* ======================= CREATE INSTANCE ======================= */
async function ensureVersions() { if (!S.versions.length) { const r = await api('versions.list', {}); S.versions = r.versions; S.latest = r.latest; } }
const ICONS = ['grass', 'stone', 'sand', 'wood', 'diamond', 'ruby', 'amethyst', 'nether', 'snow', 'end'];
function msShell(title, iconHtml, tabs, cur) {
  return `<button class="ib x" onclick="closeModal()">${ico('x')}</button><div class="mside"><h3>${iconHtml}<span class="ell">${esc(title)}</span></h3>${tabs.map(([k, n, ic]) => `<button data-mt="${k}" class="${k === cur ? 'on' : ''}">${ico(ic)}${n}</button>`).join('')}</div><div class="mmain" id="mMain"></div>`;
}
async function newInstance(tab = 'custom', pre = {}) {
  const N = S.newInst = { tab, name: pre.name || '', icon: pre.icon || 'grass', loader: pre.loader || 'vanilla', mc: pre.mc || '', lv: '', snaps: false, games: {}, orbitVer: null, packs: new Set((S.settings.orbitPacks || 'perf,shaders,qol').split(',').filter(Boolean)), then: pre.then };
  modal(msShell('Neue Instanz', `<span class="iic">${blockSvg('grass')}</span>`, [['custom', 'Eigene Instanz', 'cube'], ['file', 'Aus Datei', 'file'], ['orbit', 'Orbit Client', 'orbit']], tab), 'ms');
  $('.mside').onclick = e => { const b = e.target.closest('[data-mt]'); if (!b) return; N.tab = b.dataset.mt; $$('.mside [data-mt]').forEach(x => x.classList.toggle('on', x === b)); niRender(); };
  try { await ensureVersions(); } catch (e) { fail('Versionen', e); }
  if (!N.mc) N.mc = S.latest.release;
  niRender();
}
window.newInstance = newInstance;
async function niGames(loader) {
  const N = S.newInst;
  if (loader === 'vanilla') return S.versions.filter(v => N.snaps ? v.type === 'release' || v.type === 'snapshot' : v.type === 'release').map(v => v.id);
  if (!N.games[loader]) { try { N.games[loader] = await api('loader.games', { loader }); } catch { N.games[loader] = []; } }
  const rel = new Set(S.versions.filter(v => v.type === 'release').map(v => v.id));
  return N.games[loader].filter(v => N.snaps || rel.has(v));
}
async function niRender() {
  const N = S.newInst, m = $('#mMain'); if (!m) return;
  if (N.tab === 'file') {
    m.innerHTML = `<h2>Aus Datei importieren</h2><p class="sub">Modrinth-Modpacks (.mrpack) werden als neue Instanz angelegt. Alle Dateien kommen direkt von ihren Quellen und werden per Hash geprüft.</p>
      <button class="mtile" style="margin-top:18px" onclick="closeModal();importPack()"><span class="iic">${ico('upload')}</span><span><b>.mrpack-Datei auswählen</b><small>Modpack von der Festplatte</small></span></button>
      <button class="mtile" style="margin-top:10px" onclick="closeModal();go('discover',{type:'modpack'})"><span class="iic">${ico('compass')}</span><span><b>Modpack von Modrinth</b><small>Über 10.000 Modpacks durchsuchen</small></span></button>`;
    return;
  }
  if (N.tab === 'orbit') {
    const sup = S.orbitInfo?.supported || ['26.3'];
    N.orbitVer = N.orbitVer || sup[0];
    m.innerHTML = `<h2>Orbit Client</h2><p class="sub">Eigener Client mit 21 Modulen: Keystrokes, CPS, Koordinaten, Rüstung, Zoom, Freelook, Fullbright, Fadenkreuz, Toggle Sprint, HUD-Editor. Plus Performance-Pakete von Modrinth.</p>
      <label class="fl">Version</label><div class="seg">${sup.map(v => `<button class="${v === N.orbitVer ? 'on' : ''}" data-ov="${esc(v)}">Minecraft ${esc(v)}</button>`).join('')}</div>
      <label class="fl">Pakete</label><div class="col" style="gap:8px" id="niPacks">${(S.orbitInfo?.packs || [{ id: 'perf', name: 'FPS-Boost', desc: 'Sodium, Lithium, FerriteCore …', icon: 'zap' }, { id: 'shaders', name: 'Shader-Support', desc: 'Iris', icon: 'sun' }, { id: 'qol', name: 'Komfort', desc: 'AppleSkin, Mouse Tweaks …', icon: 'sparkle' }, { id: 'visual', name: 'Optik', desc: 'Dynamische Lichter …', icon: 'layers' }])
        .map(p => `<button class="mtile ${N.packs.has(p.id) ? 'on' : ''}" data-pk="${p.id}"><span class="iic">${ico(p.icon)}</span><span style="flex:1"><b>${esc(p.name)}</b><small>${esc(p.desc)}</small></span><span class="cb ${N.packs.has(p.id) ? 'on' : ''}"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span></button>`).join('')}</div>
      <div class="mfoot"><button class="btn" onclick="closeModal()">Abbrechen</button><button class="btn p" id="niGo">${ico('plus')}Orbit Client einrichten</button></div>`;
    m.onclick = e => {
      const v = e.target.closest('[data-ov]'); if (v) { N.orbitVer = v.dataset.ov; niRender(); return; }
      const p = e.target.closest('[data-pk]'); if (p) { N.packs.has(p.dataset.pk) ? N.packs.delete(p.dataset.pk) : N.packs.add(p.dataset.pk); p.classList.toggle('on'); p.querySelector('.cb').classList.toggle('on'); }
    };
    $('#niGo').onclick = async () => {
      const b = $('#niGo'); b.disabled = true; b.innerHTML = ico('refresh', 'i spin') + 'Wird eingerichtet…';
      api('settings.set', { key: 'orbitPacks', value: [...N.packs].join(',') });
      try { const r = await api('orbit.create', { mc: N.orbitVer, packs: [...N.packs], ramMb: 3072 }); closeModal(); toast('Orbit Client bereit', `${r.installed.length} Teile installiert`); await refreshInstances(); go('inst', { id: r.id }); }
      catch (e) { b.disabled = false; b.innerHTML = ico('plus') + 'Orbit Client einrichten'; fail('Einrichten fehlgeschlagen', e); }
    };
    return;
  }
  const games = await niGames(N.loader);
  if (!games.includes(N.mc)) N.mc = games[0] || N.mc;
  m.innerHTML = `<h2>Eigene Instanz</h2><p class="sub">Wähle Version und Mod-Loader. Alles Nötige wird im Hintergrund geladen, du kannst sofort weitermachen.</p>
    <label class="fl">Name</label><input class="in" id="niName" placeholder="${esc(niDefName())}" value="${esc(N.name)}">
    <label class="fl">Symbol</label><div class="icons" id="niIcons">${ICONS.map(k => `<button class="${k === N.icon ? 'on' : ''}" data-ic="${k}"><span class="iic">${blockSvg(k)}</span></button>`).join('')}</div>
    <label class="fl">Mod-Loader</label><div class="ldsel" id="niLd">${Object.entries(LOADERS).map(([k, [n]]) => `<button class="${k === N.loader ? 'on' : ''}" data-ld="${k}"><i style="background:${LCOL[k]}"></i>${n}</button>`).join('')}</div>
    <div class="vrow2"><div><label class="fl">Spielversion</label><select class="sel wide" id="niMc" style="height:42px">${games.map(v => `<option ${v === N.mc ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
      <div><label class="fl">Loader-Version</label><select class="sel wide" id="niLv" style="height:42px" ${N.loader === 'vanilla' ? 'disabled' : ''}><option value="">${N.loader === 'vanilla' ? '—' : 'Empfohlen'}</option></select></div></div>
    <div class="fsw" style="padding:12px 0 0"><span>Snapshots anzeigen</span><div class="tg sm ${N.snaps ? 'on' : ''}" id="niSnap"></div></div>
    <div class="mfoot"><button class="btn" onclick="closeModal()">Abbrechen</button><button class="btn p" id="niGo">${ico('plus')}Erstellen</button></div>`;
  $('#niName').oninput = e => N.name = e.target.value;
  $('#niIcons').onclick = e => { const b = e.target.closest('[data-ic]'); if (!b) return; N.icon = b.dataset.ic; $$('#niIcons button').forEach(x => x.classList.toggle('on', x === b)); $('.mside h3 .iic').innerHTML = blockSvg(N.icon); };
  $('#niLd').onclick = e => { const b = e.target.closest('[data-ld]'); if (!b) return; N.loader = b.dataset.ld; N.lv = ''; niRender(); };
  $('#niMc').onchange = e => { N.mc = e.target.value; N.lv = ''; $('#niName').placeholder = niDefName(); niLoaderVersions(); };
  $('#niSnap').onclick = () => { N.snaps = !N.snaps; niRender(); };
  $('#niLv').onchange = e => N.lv = e.target.value;
  $('#niGo').onclick = niCreate;
  niLoaderVersions();
}
const niDefName = () => { const N = S.newInst; return `${N.loader === 'vanilla' ? 'Minecraft' : LOADERS[N.loader][0]} ${N.mc}`; };
async function niLoaderVersions() {
  const N = S.newInst, sel = $('#niLv'); if (!sel || N.loader === 'vanilla') return;
  sel.innerHTML = '<option value="">Lädt…</option>';
  try {
    const l = await api('loader.versions', { loader: N.loader, mc: N.mc });
    if (S.newInst !== N) return;
    sel.innerHTML = `<option value="">Empfohlen${l.find(x => x.recommended) ? ' (' + esc(l.find(x => x.recommended).version) + ')' : l[0] ? ' (' + esc(l.find(x => x.stable)?.version || l[0].version) + ')' : ''}</option>` + l.slice(0, 60).map(x => `<option value="${esc(x.version)}">${esc(x.version)}${x.stable ? '' : ' (Beta)'}</option>`).join('');
  } catch { sel.innerHTML = '<option value="">Empfohlen</option>'; }
}
async function niCreate() {
  const N = S.newInst, b = $('#niGo');
  b.disabled = true; b.innerHTML = ico('refresh', 'i spin') + 'Erstelle…';
  try {
    const inst = await api('instance.create', { name: N.name.trim() || niDefName(), mc: N.mc, loader: N.loader, loaderVersion: N.lv || null, icon: N.icon, ramMb: 0 });
    closeModal(); toast('Instanz erstellt', `${inst.name} · Dateien werden im Hintergrund geladen`);
    await refreshInstances();
    if (N.then) N.then(inst); else go('inst', { id: inst.id });
  } catch (e) { b.disabled = false; b.innerHTML = ico('plus') + 'Erstellen'; fail('Erstellen fehlgeschlagen', e); }
}

/* ======================= INSTANCE SETTINGS ======================= */
async function instSettings(id, tab = 'general') {
  const i = instById(id); if (!i) return;
  const E = S.iset = { id, tab, games: {} };
  modal(msShell(i.name, instIcon(i), [['general', 'Allgemein', 'info'], ['install', 'Installation', 'cube'], ['java', 'Java & Speicher', 'coffee'], ['window', 'Fenster', 'monitor']], tab), 'ms');
  $('.mside').onclick = e => { const b = e.target.closest('[data-mt]'); if (!b) return; E.tab = b.dataset.mt; $$('.mside [data-mt]').forEach(x => x.classList.toggle('on', x === b)); isRender(); };
  S.modalClose = () => refreshInstances();
  isRender();
}
window.instSettings = instSettings;
const isPatch = async patch => { try { await api('instance.update', { id: S.iset.id, patch }); Object.assign(instById(S.iset.id), patch); } catch (e) { fail('Speichern fehlgeschlagen', e); } };
async function isRender() {
  const E = S.iset, i = instById(E.id), m = $('#mMain'); if (!i || !m) return;
  if (E.tab === 'general') {
    const groups = [...new Set(S.instances.map(x => x.group).filter(Boolean))];
    m.innerHTML = `<h2>Allgemein</h2><label class="fl">Name</label><input class="in" id="isName" value="${esc(i.name)}">
      ${i.iconUrl ? '' : `<label class="fl">Symbol</label><div class="icons" id="isIcons">${ICONS.concat(i.kind === 'orbit' ? ['orbit'] : []).map(k => `<button class="${k === i.icon ? 'on' : ''}" data-ic="${k}"><span class="iic">${blockSvg(k)}</span></button>`).join('')}</div>`}
      <label class="fl">Gruppe</label><input class="in" id="isGroup" list="isGroups" placeholder="z. B. PvP, Survival, Modpacks" value="${esc(i.group || '')}"><datalist id="isGroups">${groups.map(g => `<option>${esc(g)}</option>`).join('')}</datalist>
      <div class="sec"><h2>Aktionen</h2></div>
      <div class="srow"><div><b>Duplizieren</b><p>Kopie mit allen Mods, Welten und Einstellungen.</p></div><button class="btn sm" onclick="closeModal();duplicateInst('${jsq(i.id)}')">${ico('dup')}Duplizieren</button></div>
      <div class="srow"><div><b>Löschen</b><p>Entfernt die Instanz mit allen Welten. Nicht rückgängig zu machen.</p></div><button class="btn sm d" onclick="closeModal();deleteInst('${jsq(i.id)}')">${ico('trash')}Löschen</button></div>`;
    let t = 0; const deb = f => { clearTimeout(t); t = setTimeout(f, 400); };
    $('#isName').oninput = e => deb(() => { const v = e.target.value.trim(); if (v) { isPatch({ name: v }); $('.mside h3 span.ell').textContent = v; } });
    $('#isGroup').oninput = e => deb(() => isPatch({ group: e.target.value.trim() || null }));
    $('#isIcons') && ($('#isIcons').onclick = e => { const b = e.target.closest('[data-ic]'); if (!b) return; $$('#isIcons button').forEach(x => x.classList.toggle('on', x === b)); isPatch({ icon: b.dataset.ic }); $('.mside h3 .iic').innerHTML = blockSvg(b.dataset.ic); });
    return;
  }
  if (E.tab === 'install') {
    try { await ensureVersions(); } catch { }
    E.loader = E.loader || i.loader; E.mc = E.mc || i.mcVersion;
    const rel = new Set(S.versions.filter(v => v.type === 'release').map(v => v.id));
    let games = E.loader === 'vanilla' ? S.versions.filter(v => v.type === 'release' || v.id === i.mcVersion).map(v => v.id) : (E.games[E.loader] || (E.games[E.loader] = await api('loader.games', { loader: E.loader }).catch(() => []))).filter(v => rel.has(v) || v === i.mcVersion);
    if (!games.includes(E.mc)) games.unshift(E.mc);
    const locked = i.kind === 'modpack' || i.kind === 'orbit';
    m.innerHTML = `<h2>Installation</h2><p class="sub">Version oder Mod-Loader wechseln. Mods, die nicht zur neuen Version passen, musst du danach eventuell aktualisieren.</p>
      ${locked ? `<div class="note w">Diese Instanz ist ${i.kind === 'modpack' ? 'ein Modpack' : 'der Orbit Client'}. Version und Loader zu ändern kann sie kaputt machen.</div>` : ''}
      <label class="fl">Mod-Loader</label><div class="ldsel" id="isLd">${Object.entries(LOADERS).map(([k, [n]]) => `<button class="${k === E.loader ? 'on' : ''}" data-ld="${k}"><i style="background:${LCOL[k]}"></i>${n}</button>`).join('')}</div>
      <div class="vrow2"><div><label class="fl">Spielversion</label><select class="sel wide" id="isMc" style="height:42px">${games.map(v => `<option ${v === E.mc ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
      <div><label class="fl">Loader-Version</label><select class="sel wide" id="isLv" style="height:42px" ${E.loader === 'vanilla' ? 'disabled' : ''}><option value="">${E.loader === 'vanilla' ? '—' : 'Empfohlen'}</option></select></div></div>
      <div class="mfoot" style="justify-content:space-between"><button class="btn" id="isRepair">${ico('refresh')}Dateien prüfen &amp; reparieren</button><button class="btn p" id="isApply">${ico('check')}Übernehmen</button></div>`;
    $('#isLd').onclick = e => { const b = e.target.closest('[data-ld]'); if (!b) return; E.loader = b.dataset.ld; isRender(); };
    $('#isMc').onchange = e => { E.mc = e.target.value; fillLv(); };
    const fillLv = async () => {
      const sel = $('#isLv'); if (E.loader === 'vanilla') return;
      try { const l = await api('loader.versions', { loader: E.loader, mc: E.mc }); sel.innerHTML = '<option value="">Empfohlen</option>' + l.slice(0, 60).map(x => `<option value="${esc(x.version)}" ${x.version === i.loaderVersion && E.loader === i.loader ? 'selected' : ''}>${esc(x.version)}</option>`).join(''); } catch { }
    };
    fillLv();
    $('#isApply').onclick = async () => {
      const patch = { mc: $('#isMc').value, loader: E.loader, loaderVersion: $('#isLv').value || null };
      if (patch.mc === i.mcVersion && patch.loader === i.loader && (patch.loaderVersion || null) === (i.loaderVersion || null)) return toast('Keine Änderung');
      try { await api('instance.update', { id: i.id, patch }); toast('Übernommen', 'Wird beim nächsten Start installiert'); closeModal(); } catch (e) { fail('Fehler', e); }
    };
    $('#isRepair').onclick = async () => { closeModal(); toast('Prüfe Dateien', i.name); try { await api('instance.repair', { id: i.id }); toast('Alles in Ordnung', i.name); } catch (e) { fail('Reparieren fehlgeschlagen', e); } };
    return;
  }
  if (E.tab === 'java') {
    const ram = i.ramMb || 0, def = S.settings.ramMb || 4096;
    m.innerHTML = `<h2>Java &amp; Speicher</h2><p class="sub">Leer lassen = Standard aus den globalen Einstellungen. Java wird pro Version automatisch passend geladen.</p>
      <label class="fl">Arbeitsspeicher</label><div class="fsw" style="padding:0 0 8px"><span>Eigenen Wert nutzen</span><div class="tg sm ${ram ? 'on' : ''}" id="isRamOn"></div></div>
      <div class="ramrow ${ram ? '' : 'dim'}" id="isRamRow"><input type="range" min="1024" max="${Math.max(16384, def)}" step="256" value="${ram || def}" id="isRam"><input class="in" id="isRamN" value="${ram || def} MB" readonly></div>
      <label class="fl">Java-Pfad</label><div class="inline"><input class="in" id="isJava" placeholder="Automatisch (empfohlen)" value="${esc(i.javaPath || '')}"><button class="btn" onclick="pickJava('isJava')">${ico('folder')}Durchsuchen</button></div>
      <label class="fl">JVM-Argumente</label><input class="in" id="isJvm" placeholder="${esc(S.settings.jvmArgs || 'Mojangs Standard (G1GC)')}" value="${esc(i.jvmArgs || '')}" style="font-family:var(--mono);font-size:12px">`;
    const r = $('#isRam'); setRange(r);
    let t = 0; const deb = f => { clearTimeout(t); t = setTimeout(f, 400); };
    r.oninput = () => { setRange(r); $('#isRamN').value = r.value + ' MB'; if ($('#isRamOn').classList.contains('on')) deb(() => isPatch({ ramMb: +r.value })); };
    $('#isRamOn').onclick = e => { const on = !e.target.classList.contains('on'); e.target.classList.toggle('on', on); $('#isRamRow').classList.toggle('dim', !on); isPatch({ ramMb: on ? +r.value : 0 }); };
    $('#isJava').onchange = e => isPatch({ javaPath: e.target.value.trim() || null });
    $('#isJvm').oninput = e => deb(() => isPatch({ jvmArgs: e.target.value.trim() || null }));
    return;
  }
  m.innerHTML = `<h2>Fenster</h2><p class="sub">Startgröße des Spielfensters. 0 = Standard aus den Einstellungen.</p>
    <div class="vrow2"><div><label class="fl">Breite</label><input class="in" id="isW" type="number" min="0" value="${i.width || 0}"></div><div><label class="fl">Höhe</label><input class="in" id="isH" type="number" min="0" value="${i.height || 0}"></div></div>
    <div class="row" style="margin-top:12px;gap:6px">${[[0, 0, 'Standard'], [1280, 720, '1280×720'], [1600, 900, '1600×900'], [1920, 1080, '1920×1080']].map(([w, h, n]) => `<button class="fchip" data-wh="${w},${h}">${n}</button>`).join('')}</div>`;
  const save = () => isPatch({ width: +$('#isW').value || 0, height: +$('#isH').value || 0 });
  $('#isW').onchange = save; $('#isH').onchange = save;
  m.querySelectorAll('[data-wh]').forEach(b => b.onclick = () => { const [w, h] = b.dataset.wh.split(','); $('#isW').value = w; $('#isH').value = h; save(); });
}
window.pickJava = async target => { try { const r = await api('java.pick'); if (r?.path) { const el = $('#' + target); el.value = r.path; el.dispatchEvent(new Event('change')); } } catch (e) { fail('Java', e); } };
function setRange(el) { const p = (el.value - el.min) / (el.max - el.min) * 100; el.style.setProperty('--p', p + '%'); }

/* ======================= DISCOVER ======================= */
const PTYPES = [['modpack', 'Modpacks', 'box'], ['mod', 'Mods', 'puzzle'], ['resourcepack', 'Ressourcenpakete', 'image'], ['shader', 'Shader', 'sun']];
const SORTS = [['relevance', 'Relevanz'], ['downloads', 'Downloads'], ['follows', 'Follower'], ['newest', 'Neueste'], ['updated', 'Zuletzt aktualisiert']];
const PLOADERS = { mod: ['fabric', 'forge', 'neoforge', 'quilt'], modpack: ['fabric', 'forge', 'neoforge', 'quilt'], shader: ['iris', 'optifine', 'canvas', 'vanilla'], resourcepack: [], datapack: [] };
const CAT_DE = { adventure: 'Abenteuer', cursed: 'Verflucht', decoration: 'Deko', economy: 'Wirtschaft', equipment: 'Ausrüstung', food: 'Essen', 'game-mechanics': 'Spielmechanik', library: 'Bibliothek', magic: 'Magie', management: 'Verwaltung', minigame: 'Minispiel', mobs: 'Mobs', optimization: 'Optimierung', social: 'Sozial', storage: 'Lager', technology: 'Technik', transportation: 'Transport', utility: 'Werkzeug', worldgen: 'Weltgenerierung', challenging: 'Herausfordernd', combat: 'Kampf', 'kitchen-sink': 'Alles drin', lightweight: 'Leichtgewicht', multiplayer: 'Multiplayer', quests: 'Quests', vanilla: 'Vanilla', realistic: 'Realistisch', simplistic: 'Schlicht', themed: 'Thematisch', tweaks: 'Tweaks', 'vanilla-like': 'Vanilla-ähnlich', cartoon: 'Cartoon', fantasy: 'Fantasy', 'semi-realistic': 'Halb-realistisch', atmosphere: 'Atmosphäre', bloom: 'Bloom', shadows: 'Schatten', pbr: 'PBR', reflections: 'Spiegelungen', 'colored-lighting': 'Farbiges Licht', 'path-tracing': 'Path Tracing', potato: 'Kartoffel-PC', low: 'Schwacher PC', medium: 'Mittlerer PC', high: 'Starker PC', screenshot: 'Screenshot', foliage: 'Pflanzen', gui: 'GUI', fonts: 'Schriften', audio: 'Audio', blocks: 'Blöcke', items: 'Items', entities: 'Entities', environment: 'Umgebung', models: 'Modelle', locale: 'Sprache', 'core-shaders': 'Core-Shader' };
const HEAD_DE = { categories: 'Kategorien', features: 'Funktionen', resolutions: 'Auflösung', 'performance impact': 'Leistungsbedarf' };
const catName = c => CAT_DE[c] || cap(c).replace(/-/g, ' ');
const D = S.disc = { type: 'mod', q: '', sort: 'relevance', page: 0, per: 20, vers: new Set(), loaders: new Set(), cats: new Set(), env: new Set(), open: false, compat: true, target: null, vq: '', snaps: false, closed: new Set() };
PAGES.discover = async (el, a) => {
  const tgt = a.target ? instById(a.target) : null;
  if (a.type && a.type !== D.type) { D.type = a.type; D.cats.clear(); D.loaders.clear(); D.page = 0; }
  if ((a.target || null) !== D.target) { D.target = a.target || null; D.page = 0; D.compat = true; }
  if (tgt && D.type === 'modpack') D.type = tgt.loader === 'vanilla' ? 'resourcepack' : 'mod';
  crumbs(tgt ? [['Bibliothek', "go('library')"], [tgt.name, `go('inst',{id:'${jsq(tgt.id)}'})`], ['Inhalte hinzufügen']] : [['Entdecken']]);
  const types = PTYPES.filter(t => !tgt || (t[0] !== 'modpack' && (tgt.loader !== 'vanilla' || t[0] !== 'mod')));
  el.innerHTML = `<div class="ph"><div><div class="kicker">Modrinth</div><h1>Entdecken</h1></div></div>
    ${tgt ? `<div class="tgtbar">${instIcon(tgt)}<div class="tx"><b>Installieren in „${esc(tgt.name)}“</b><small>${esc(instSub(tgt))} · nur passende Inhalte werden angezeigt</small></div><button class="btn sm" onclick="go('inst',{id:'${jsq(tgt.id)}'})">${ico('left')}Zur Instanz</button><button class="ib sm ghost" title="Ohne Ziel" onclick="go('discover',{type:'${D.type}'})">${ico('x')}</button></div>` : ''}
    <div class="dtypes" id="dTypes">${types.map(([k, n, ic]) => `<button data-k="${k}" class="${k === D.type ? 'on' : ''}">${ico(ic)}${n}</button>`).join('')}</div>
    <div class="dgrid"><div class="filters" id="dFil"></div><div>
      <div class="rbar"><div class="srch">${ico('search')}<input class="in" id="dQ" placeholder="${esc(PTYPES.find(t => t[0] === D.type)[1])} durchsuchen…" value="${esc(D.q)}"></div>
        <select class="sel" id="dSort">${SORTS.map(([k, n]) => `<option value="${k}" ${k === D.sort ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <select class="sel" id="dPer">${[20, 40, 60].map(n => `<option ${n === D.per ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="rinfo" id="dInfo"></div><div class="rlist" id="dList"></div><div class="pager" id="dPager"></div></div></div>`;
  $('#dTypes').onclick = e => { const b = e.target.closest('[data-k]'); if (b) go('discover', { type: b.dataset.k, target: D.target || undefined }); };
  let t = 0;
  $('#dQ').oninput = e => { clearTimeout(t); t = setTimeout(() => { D.q = e.target.value; D.page = 0; discSearch(); }, 300); };
  $('#dSort').onchange = e => { D.sort = e.target.value; D.page = 0; discSearch(); };
  $('#dPer').onchange = e => { D.per = +e.target.value; D.page = 0; discSearch(); };
  ensureVersions().catch(() => { }).then(() => discFilters());
  discFilters(); discSearch();
};
async function discFilters() {
  const el = $('#dFil'); if (!el) return;
  const tgt = D.target ? instById(D.target) : null;
  let cats = [];
  try { cats = (await mr('/tag/category')).filter(c => c.project_type === (D.type === 'datapack' ? 'mod' : D.type)); } catch { }
  if (!$('#dFil')) return;
  const heads = {};
  cats.forEach(c => (heads[c.header] = heads[c.header] || []).push(c));
  const box = (k, title, body) => `<div class="fbox ${D.closed.has(k) ? 'closed' : ''}" data-box="${k}"><button class="fh">${esc(title)}${ico('chevd')}</button><div class="fbody">${body}</div></div>`;
  const opt = (kind, v, label, on, icon = '') => `<button class="fo ${on ? 'on' : ''}" data-f="${kind}" data-v="${esc(v)}"><span class="cb ${on ? 'on' : ''}"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>${icon}${esc(label)}</button>`;
  let html = '';
  if (tgt) html += `<div class="fbox"><div class="fsw"><span>Nur passend zu ${esc(tgt.mcVersion)}${D.type === 'mod' ? ' · ' + esc(LOADERS[tgt.loader]?.[0] || '') : ''}</span><div class="tg sm ${D.compat ? 'on' : ''}" id="dCompat"></div></div></div>`;
  if (!tgt || !D.compat) {
    const rel = S.versions.filter(v => v.type === 'release' || (D.snaps && v.type === 'snapshot')).map(v => v.id);
    const vq = D.vq.trim();
    html += box('ver', 'Spielversion', `<input class="in" id="dVq" placeholder="Version suchen…" value="${esc(D.vq)}">${[...D.vers].filter(v => !rel.includes(v)).concat(rel).filter(v => !vq || v.includes(vq)).slice(0, 120).map(v => opt('ver', v, v, D.vers.has(v))).join('')}<div class="fsw"><span>Snapshots</span><div class="tg sm ${D.snaps ? 'on' : ''}" id="dSnap"></div></div>`);
    if (PLOADERS[D.type].length) html += box('ld', D.type === 'shader' ? 'Shader-Loader' : 'Loader', PLOADERS[D.type].map(l => opt('ld', l, LOADERS[l]?.[0] || cap(l), D.loaders.has(l))).join(''));
  }
  Object.entries(heads).forEach(([h, list]) => { html += box('h:' + h, HEAD_DE[h] || cap(h), list.sort((a, b) => catName(a.name).localeCompare(catName(b.name), 'de')).map(c => opt('cat', c.name, catName(c.name), D.cats.has(c.name), c.icon ? `<span class="ci" style="display:grid;width:15px;height:15px;color:var(--mute)">${c.icon.replace('<svg', '<svg width="15" height="15"')}</span>` : '')).join('')); });
  if (D.type !== 'resourcepack' && D.type !== 'shader') html += box('env', 'Umgebung', opt('env', 'client', 'Client', D.env.has('client')) + opt('env', 'server', 'Server', D.env.has('server')));
  html += `<div class="fbox"><div class="fsw"><span>Nur Open Source</span><div class="tg sm ${D.open ? 'on' : ''}" id="dOpen"></div></div></div>`;
  el.innerHTML = html;
  el.onclick = e => {
    const fh = e.target.closest('.fh'); if (fh) { const b = fh.parentElement, k = b.dataset.box; b.classList.toggle('closed'); b.classList.contains('closed') ? D.closed.add(k) : D.closed.delete(k); return; }
    const o = e.target.closest('[data-f]');
    if (o) { const set = { ver: D.vers, ld: D.loaders, cat: D.cats, env: D.env }[o.dataset.f], v = o.dataset.v; set.has(v) ? set.delete(v) : set.add(v); o.classList.toggle('on'); o.querySelector('.cb').classList.toggle('on'); D.page = 0; discSearch(); return; }
    if (e.target.id === 'dCompat') { D.compat = !D.compat; D.page = 0; discFilters(); discSearch(); }
    if (e.target.id === 'dOpen') { D.open = !D.open; e.target.classList.toggle('on'); D.page = 0; discSearch(); }
    if (e.target.id === 'dSnap') { D.snaps = !D.snaps; discFilters(); }
  };
  const vq = $('#dVq'); if (vq) vq.oninput = e => { D.vq = e.target.value; const pos = e.target.selectionStart; discFilters().then(() => { const n = $('#dVq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); };
}
function discFacets() {
  const tgt = D.target ? instById(D.target) : null, f = [];
  f.push([`project_type:${D.type}`]);
  if (tgt && D.compat) {
    f.push([`versions:${tgt.mcVersion}`]);
    if (D.type === 'mod') f.push(tgt.loader === 'quilt' ? ['categories:quilt', 'categories:fabric'] : [`categories:${tgt.loader}`]);
  } else {
    if (D.vers.size) f.push([...D.vers].map(v => `versions:${v}`));
    if (D.loaders.size) f.push([...D.loaders].map(l => `categories:${l}`));
  }
  D.cats.forEach(c => f.push([`categories:${c}`]));
  if (D.env.has('client')) f.push(['client_side:required', 'client_side:optional']);
  if (D.env.has('server')) f.push(['server_side:required', 'server_side:optional']);
  if (D.open) f.push(['open_source:true']);
  return f;
}
let dSeq = 0;
async function discSearch() {
  const list = $('#dList'); if (!list) return;
  const seq = ++dSeq;
  list.innerHTML = '<div class="skel"></div>'.repeat(5);
  const path = `/search?limit=${D.per}&offset=${D.page * D.per}&index=${D.sort}${D.q.trim() ? '&query=' + encodeURIComponent(D.q.trim()) : ''}&facets=${encodeURIComponent(JSON.stringify(discFacets()))}`;
  let r;
  try { r = await mr(path); } catch (e) { if (seq === dSeq) list.innerHTML = `<div class="empty">Modrinth ist nicht erreichbar: ${esc(e.message)}</div>`; return; }
  if (seq !== dSeq || !$('#dList')) return;
  const chips = [...D.vers].map(v => ['ver', v, v]).concat([...D.loaders].map(l => ['ld', l, LOADERS[l]?.[0] || cap(l)]), [...D.cats].map(c => ['cat', c, catName(c)]), [...D.env].map(e => ['env', e, cap(e)]));
  $('#dInfo').innerHTML = `<span><b style="color:var(--text)">${r.total_hits.toLocaleString('de-DE')}</b> Ergebnisse</span>${chips.map(([k, v, n]) => `<button class="fchip on" data-rm="${k}" data-v="${esc(v)}">${esc(n)}${ico('x')}</button>`).join('')}${chips.length ? '<button class="fchip" data-clr>Alle Filter entfernen</button>' : ''}`;
  $('#dInfo').onclick = e => {
    if (e.target.closest('[data-clr]')) { D.vers.clear(); D.loaders.clear(); D.cats.clear(); D.env.clear(); }
    const b = e.target.closest('[data-rm]'); if (b) ({ ver: D.vers, ld: D.loaders, cat: D.cats, env: D.env })[b.dataset.rm].delete(b.dataset.v);
    if (b || e.target.closest('[data-clr]')) { D.page = 0; discFilters(); discSearch(); }
  };
  S.hits = Object.fromEntries(r.hits.map(h => [h.project_id, h]));
  list.innerHTML = r.hits.length ? r.hits.map(pcard).join('') : `<div class="lempty"><span class="iic">${ico('search')}</span><h2>Nichts gefunden</h2><p>Versuch einen anderen Suchbegriff oder weniger Filter.</p></div>`;
  const pages = Math.ceil(Math.min(r.total_hits, 10000) / D.per), cur = D.page;
  const nums = [...new Set([0, cur - 1, cur, cur + 1, pages - 1])].filter(n => n >= 0 && n < pages).sort((a, b) => a - b);
  $('#dPager').innerHTML = pages > 1 ? `<button ${cur ? '' : 'disabled'} data-pg="${cur - 1}">${ico('left')}</button>${nums.map((n, i) => (i && n - nums[i - 1] > 1 ? '<span>…</span>' : '') + `<button class="${n === cur ? 'on' : ''}" data-pg="${n}">${n + 1}</button>`).join('')}<button ${cur < pages - 1 ? '' : 'disabled'} data-pg="${cur + 1}">${ico('right')}</button>` : '';
  $('#dPager').onclick = e => { const b = e.target.closest('[data-pg]'); if (!b) return; D.page = +b.dataset.pg; discSearch(); $('#p-discover').scrollTop = 0; };
}
const isInstalled = (inst, pid) => inst && (inst.content || []).some(c => c.projectId === pid);
function pcard(h) {
  const tgt = D.target ? instById(D.target) : null, inst = isInstalled(tgt, h.project_id);
  const lds = (h.categories || []).filter(c => LOADERS[c] || ['iris', 'optifine', 'canvas'].includes(c));
  const cats = (h.display_categories || h.categories || []).filter(c => !lds.includes(c)).slice(0, 3);
  return `<div class="pcard" onclick="go('project',{id:'${jsq(h.project_id)}'${D.target ? `,target:'${jsq(D.target)}'` : ''}})">${picHtml(h.icon_url)}
    <div class="tx"><h3>${esc(h.title)}<small>von ${esc(h.author)}</small></h3><p>${esc(h.description)}</p>
      <div class="tags">${cats.map(c => `<span class="chip m">${ico('tag')}${esc(catName(c))}</span>`).join('')}${lds.map(l => LOADERS[l] ? loaderChip(l) : `<span class="chip m">${esc(cap(l))}</span>`).join('')}</div></div>
    <div class="rs"><div class="stats"><span class="stat">${ico('download')}<b>${num(h.downloads)}</b></span><span class="stat">${ico('heart')}<b>${num(h.follows)}</b></span><span class="stat">${ico('refresh')}${esc(ago(h.date_modified))}</span></div>
      ${inst ? `<button class="btn sm ok">${ico('check')}Installiert</button>` : `<button class="btn sm p" onclick="event.stopPropagation();installProject('${jsq(h.project_id)}',this)">${ico('download')}Installieren</button>`}</div></div>`;
}

/* ---------- install flow ---------- */
const typeOfInst = t => t === 'shader' ? 'shader' : t === 'resourcepack' ? 'resourcepack' : t === 'datapack' ? 'datapack' : 'mod';
function compatible(inst, p) {
  if (!inst) return false;
  if (p.game_versions && !p.game_versions.includes(inst.mcVersion)) return false;
  if (p.project_type === 'mod') { const l = p.loaders || []; if (!(l.includes(inst.loader) || (inst.loader === 'quilt' && l.includes('fabric')) || (l.includes('datapack') && inst.loader === 'vanilla'))) return false; }
  return true;
}
async function installProject(pid, btn, versionId) {
  let p;
  try { p = await mr('/project/' + pid); } catch (e) { return fail('Modrinth', e); }
  if (p.project_type === 'modpack') return installModpack(p, versionId, btn);
  const tgt = D.target && S.page !== 'home' ? instById(D.target) : null;
  if (tgt && !(S.page === 'project' && !S.args.target)) return installInto(tgt, p, versionId, btn);
  pickInstance(p, versionId);
}
window.installProject = installProject;
async function installInto(inst, p, versionId, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = ico('refresh', 'i spin') + 'Installiere…'; }
  try {
    const r = await api('mr.install', { id: inst.id, project: p.id, type: typeOfInst(p.project_type), version: versionId || null });
    toast('Installiert', `${r.installed.join(', ')} → ${inst.name}${r.skipped.length ? ' · übersprungen: ' + r.skipped.join(', ') : ''}`);
    if (btn) { btn.className = 'btn sm ok'; btn.disabled = false; btn.innerHTML = ico('check') + 'Installiert'; }
    if (S.content?.id === inst.id) S.content.loaded = false;
    await refreshInstances();
    return true;
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = ico('download') + 'Installieren'; }
    fail('Installation fehlgeschlagen', e); return false;
  }
}
async function installModpack(p, versionId, btn) {
  if (!await confirmBox('Modpack installieren?', `„${p.title}“ wird als neue Instanz angelegt. Alle Dateien kommen direkt von Modrinth.`, 'Installieren')) return;
  if (btn) { btn.disabled = true; btn.innerHTML = ico('refresh', 'i spin') + 'Installiere…'; }
  try { const inst = await api('mr.modpack', { project: p.id, version: versionId || null }); toast('Modpack bereit', inst.name); await refreshInstances(); go('inst', { id: inst.id }); }
  catch (e) { fail('Modpack fehlgeschlagen', e); if (btn) { btn.disabled = false; btn.innerHTML = ico('download') + 'Installieren'; } }
}
function pickInstance(p, versionId) {
  const list = [...S.instances].sort((a, b) => compatible(b, p) - compatible(a, p));
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button><div class="pd-head">${picHtml(p.icon_url, 'pic')}<div><div class="kicker">Installieren</div><h1>${esc(p.title)}</h1></div></div>
    <p class="sub" style="margin:12px 0 0;max-width:none;text-align:left">In welche Instanz? Passende Instanzen stehen oben, Abhängigkeiten kommen automatisch mit.</p>
    <div class="ipick">${list.length ? list.map(i => { const ok = compatible(i, p), has = isInstalled(i, p.id); return `<div class="ir ${ok ? '' : 'no'}">${instIcon(i)}<div class="tx"><b>${esc(i.name)}</b><small>${esc(instSub(i))}${ok ? '' : ' · passt nicht'}</small></div>
      ${has ? `<button class="btn sm ok">${ico('check')}Installiert</button>` : `<button class="btn sm ${ok ? 'p' : ''}" ${ok ? '' : 'disabled'} data-i="${esc(i.id)}">${ico('download')}Installieren</button>`}</div>`; }).join('') : '<div class="empty">Noch keine Instanz.</div>'}</div>
    <div class="act" style="justify-content:space-between"><span class="muted" style="font-size:12px">Passt zu: ${esc(summarizeVersions(p.game_versions || []))}</span><button class="btn" id="piNew">${ico('plus')}Neue Instanz dafür</button></div>`, 'form');
  $('.ipick').onclick = e => { const b = e.target.closest('[data-i]'); if (b) installInto(instById(b.dataset.i), p, versionId, b); };
  $('#piNew').onclick = async () => {
    await ensureVersions().catch(() => { });
    const rel = S.versions.filter(v => v.type === 'release').map(v => v.id);
    const mc = rel.find(v => (p.game_versions || []).includes(v)) || S.latest.release;
    const ld = p.project_type === 'mod' ? ['fabric', 'neoforge', 'forge', 'quilt'].find(l => (p.loaders || []).includes(l)) || 'vanilla' : 'vanilla';
    closeModal();
    newInstance('custom', { mc, loader: ld, name: `${p.title} ${mc}`, then: inst => installInto(inst, p, versionId).then(() => go('inst', { id: inst.id })) });
  };
}

/* summary like "1.20.1–1.21.4" using the Mojang release order */
function summarizeVersions(list) {
  if (!list.length) return '—';
  const order = S.versions.filter(v => v.type === 'release').map(v => v.id).reverse();
  if (!order.length) return list.length > 3 ? `${list[0]}–${list[list.length - 1]}` : list.join(', ');
  const has = new Set(list), runs = []; let start = null, prev = null;
  order.forEach(v => { if (has.has(v)) { if (start === null) start = v; prev = v; } else if (start !== null) { runs.push([start, prev]); start = null; } });
  if (start !== null) runs.push([start, prev]);
  if (!runs.length) return list.slice(-3).join(', ');
  return runs.reverse().slice(0, 4).map(([a, b]) => a === b ? a : `${a}–${b}`).join(', ') + (runs.length > 4 ? ' …' : '');
}

/* ======================= PROJECT PAGE ======================= */
PAGES.project = async (el, a) => {
  if (a.target) D.target = a.target;
  const tgt = a.target ? instById(a.target) : null;
  el.innerHTML = '<div class="spinner"></div>';
  let p;
  try { p = await mr('/project/' + a.id); } catch (e) { el.innerHTML = `<div class="empty">Projekt nicht gefunden: ${esc(e.message)}</div>`; return; }
  if (S.args.id !== a.id) return;
  S.proj = { p, tab: a.tab || 'desc', versions: null, members: null, vf: { ld: '', mc: '', ch: '' } };
  const tname = PTYPES.find(t => t[0] === p.project_type)?.[1] || 'Projekte';
  crumbs(tgt ? [[tgt.name, `go('inst',{id:'${jsq(tgt.id)}'})`], ['Hinzufügen', `go('discover',{type:'${p.project_type}',target:'${jsq(tgt.id)}'})`], [p.title]] : [['Entdecken', "go('discover')"], [tname, `go('discover',{type:'${p.project_type}'})`], [p.title]]);
  const inst = isInstalled(tgt, p.id);
  el.innerHTML = `<div class="phead">${picHtml(p.icon_url)}<div class="tx"><div class="kicker">${esc(tname.replace(/e$|s$/, ''))}</div><h1>${esc(p.title)}</h1><p class="d">${esc(p.description)}</p>
      <div class="meta"><span class="stat">${ico('download')}<b>${num(p.downloads)}</b> Downloads</span><span class="stat">${ico('heart')}<b>${num(p.followers)}</b> Follower</span><span class="stat">${ico('refresh')}Aktualisiert ${esc(ago(p.updated).replace('Vor', 'vor'))}</span>
        ${(p.categories || []).slice(0, 4).map(c => `<span class="chip m">${esc(catName(c))}</span>`).join('')}</div></div>
    <div class="acts">${inst ? `<button class="btn lg ok">${ico('check')}Installiert</button>` : `<button class="btn lg p" id="pInst">${ico('download')}${tgt ? 'In ' + esc(tgt.name) : 'Installieren'}</button>`}
      <button class="ib" title="Auf Modrinth öffnen" onclick="openUrl('https://modrinth.com/${esc(p.project_type)}/${esc(p.slug)}')">${ico('ext')}</button></div></div>
    <div class="itabs" id="pTabs" style="margin-top:0"></div>
    <div class="pgrid"><div id="pBody"></div><div class="pside" id="pSide"></div></div>`;
  if ($('#pInst')) $('#pInst').onclick = () => installProject(p.id, $('#pInst'));
  $('#pTabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { S.proj.tab = b.dataset.t; S.hist[S.hi].a = { ...a, tab: b.dataset.t }; projTabs(); } };
  projTabs(); projSide();
  mr(`/project/${p.id}/version`).then(v => { if (S.proj?.p !== p) return; S.proj.versions = v; projTabs(true); projSide(); }).catch(() => { });
  mr(`/project/${p.id}/members`).then(m => { if (S.proj?.p !== p) return; S.proj.members = m; projSide(); }).catch(() => { });
};
function projTabs(soft) {
  const P = S.proj, p = P.p;
  const t = [['desc', 'Beschreibung', 'book'], ['versions', 'Versionen', 'layers', P.versions?.length], ['gallery', 'Galerie', 'image', p.gallery?.length]].filter(x => x[0] !== 'gallery' || p.gallery?.length);
  $('#pTabs').innerHTML = t.map(([k, n, ic, c]) => `<button data-t="${k}" class="${P.tab === k ? 'on' : ''}">${ico(ic)}${n}${c ? `<span class="c">${c}</span>` : ''}</button>`).join('');
  if (soft && P.tab !== 'versions') return;
  const b = $('#pBody');
  if (P.tab === 'desc') { b.innerHTML = `<div class="md" id="pMd">${mdRender(p.body || p.description || '')}</div>`; mdBind($('#pMd')); }
  if (P.tab === 'gallery') {
    b.innerHTML = `<div class="gal">${(p.gallery || []).sort((x, y) => (y.featured - x.featured) || (x.ordering - y.ordering)).map((g, i) => `<button data-g="${i}"><i style="background-image:url('${esc(g.url)}')"></i>${g.title || g.description ? `<div><b>${esc(g.title || '')}</b><small>${esc(g.description || '')}</small></div>` : ''}</button>`).join('')}</div>`;
    b.onclick = e => { const g = e.target.closest('[data-g]'); if (!g) return; const x = p.gallery[+g.dataset.g]; $('#lightbox').innerHTML = `<div><img src="${esc(x.raw_url || x.url)}" alt="">${x.title ? `<p>${esc(x.title)}</p>` : ''}</div>`; $('#lightbox').classList.remove('hidden'); };
  }
  if (P.tab === 'versions') projVersions();
}
function projVersions() {
  const P = S.proj, b = $('#pBody'), V = P.versions;
  if (!V) { b.innerHTML = '<div class="spinner"></div>'; return; }
  const f = P.vf, tgt = D.target ? instById(D.target) : null;
  const lds = [...new Set(V.flatMap(v => v.loaders))], mcs = [...new Set(V.flatMap(v => v.game_versions))];
  const rel = new Set(S.versions.filter(v => v.type === 'release').map(v => v.id));
  const list = V.filter(v => (!f.ld || v.loaders.includes(f.ld)) && (!f.mc || v.game_versions.includes(f.mc)) && (!f.ch || v.version_type === f.ch));
  b.innerHTML = `<div class="vfil"><select class="sel" id="vfLd"><option value="">Alle Loader</option>${lds.map(l => `<option value="${esc(l)}" ${f.ld === l ? 'selected' : ''}>${esc(LOADERS[l]?.[0] || cap(l))}</option>`).join('')}</select>
    <select class="sel" id="vfMc"><option value="">Alle Versionen</option>${mcs.filter(v => rel.has(v) || !rel.size).sort((x, y) => vkey(y).localeCompare(vkey(x))).map(v => `<option ${f.mc === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
    <select class="sel" id="vfCh"><option value="">Alle Kanäle</option>${[['release', 'Release'], ['beta', 'Beta'], ['alpha', 'Alpha']].map(([k, n]) => `<option value="${k}" ${f.ch === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
    ${tgt ? `<button class="fchip" onclick="S.proj.vf={ld:'${jsq(tgt.loader === 'vanilla' ? '' : tgt.loader)}',mc:'${jsq(tgt.mcVersion)}',ch:''};projVersions()">Passend zu ${esc(tgt.name)}</button>` : ''}<span class="sp"></span><span class="muted" style="font-size:12px;align-self:center">${list.length} von ${V.length}</span></div>
    <div class="vt"><div class="vh"><span></span><span>Name</span><span>Kompatibel</span><span>Downloads</span><span>Datum</span></div>
    ${list.slice(0, 150).map((v, i) => `<div class="vr2" data-v="${esc(v.id)}"><span class="vtype ${v.version_type}">${v.version_type[0].toUpperCase()}</span><div><b>${esc(v.name || v.version_number)}</b><small>${esc(v.version_number)}</small></div>
      <div class="chips">${v.loaders.slice(0, 3).map(l => LOADERS[l] ? loaderChip(l) : `<span class="chip m">${esc(cap(l))}</span>`).join('')}<span class="chip m">${esc(summarizeVersions(v.game_versions))}</span></div>
      <span class="stat">${num(v.downloads)}</span><span class="stat">${esc(dateDe(v.date_published))}</span></div>`).join('') || '<div class="vr2"><span></span><span class="muted">Keine Version passt zu den Filtern.</span></div>'}</div>`;
  $('#vfLd').onchange = e => { f.ld = e.target.value; projVersions(); };
  $('#vfMc').onchange = e => { f.mc = e.target.value; projVersions(); };
  $('#vfCh').onchange = e => { f.ch = e.target.value; projVersions(); };
  b.querySelector('.vt').onclick = e => { const r = e.target.closest('[data-v]'); if (r) versionDetail(V.find(v => v.id === r.dataset.v)); };
}
window.projVersions = projVersions;
function versionDetail(v) {
  const p = S.proj.p;
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button><div class="kicker">${esc(cap(v.version_type))} · ${esc(dateDe(v.date_published))}</div><h1>${esc(v.name || v.version_number)}</h1>
    <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px">${v.loaders.map(l => LOADERS[l] ? loaderChip(l) : `<span class="chip m">${esc(cap(l))}</span>`).join('')}<span class="chip m">${esc(summarizeVersions(v.game_versions))}</span><span class="chip m">${ico('download')}${num(v.downloads)}</span>${v.dependencies?.filter(d => d.dependency_type === 'required').length ? `<span class="chip a">${v.dependencies.filter(d => d.dependency_type === 'required').length} Abhängigkeit(en)</span>` : ''}</div>
    <div class="vdet"><label class="fl">Änderungen</label><div class="md" id="vdMd">${v.changelog ? mdRender(v.changelog) : '<p class="muted">Kein Changelog.</p>'}</div>
    <div class="files">${v.files.map(fl => `<div class="fr">${ico('file')}<span class="ell" style="flex:1">${esc(fl.filename)}</span><span class="muted">${bytes(fl.size)}</span>${fl.primary ? '<span class="chip a">Haupt</span>' : ''}</div>`).join('')}</div></div>
    <div class="act" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">Schließen</button><button class="btn p" id="vdInst">${ico('download')}Diese Version installieren</button></div>`, 'form');
  mdBind($('#vdMd'));
  $('#vdInst').onclick = () => { closeModal(); installProject(p.id, null, v.id); };
}
function projSide() {
  const P = S.proj, p = P.p, el = $('#pSide'); if (!el) return;
  const env = s => ({ required: 'Benötigt', optional: 'Optional', unsupported: 'Nein' })[s] || '—';
  const links = [[p.issues_url, 'Fehler melden', 'bug'], [p.source_url, 'Quellcode', 'code'], [p.wiki_url, 'Wiki', 'book'], [p.discord_url, 'Discord', 'chat']].concat((p.donation_urls || []).map(d => [d.url, 'Unterstützen (' + d.platform + ')', 'heart'])).filter(l => l[0]);
  el.innerHTML = `<div class="pbox"><h4>Kompatibilität</h4><div class="kv"><span>Minecraft</span><b>${esc(summarizeVersions(p.game_versions || []))}</b></div>
      ${p.loaders?.length ? `<div class="kv"><span>Plattformen</span><b></b></div><div class="chips">${p.loaders.map(l => LOADERS[l] ? loaderChip(l) : `<span class="chip m">${esc(cap(l))}</span>`).join('')}</div>` : ''}
      ${p.project_type !== 'resourcepack' && p.project_type !== 'shader' ? `<div class="kv" style="margin-top:6px"><span>Client</span><b>${env(p.client_side)}</b></div><div class="kv"><span>Server</span><b>${env(p.server_side)}</b></div>` : ''}</div>
    ${links.length ? `<div class="pbox"><h4>Links</h4>${links.map(([u, n, ic]) => `<button class="ln" onclick="openUrl('${jsq(u)}')">${ico(ic)}${esc(n)}</button>`).join('')}</div>` : ''}
    ${P.members ? `<div class="pbox"><h4>Ersteller</h4>${P.members.slice(0, 8).map(m => `<div class="mem">${picHtml(m.user.avatar_url, 'pic', 'user')}<div><b>${esc(m.user.username)}</b><small>${esc(m.role)}</small></div></div>`).join('')}</div>` : ''}
    <div class="pbox"><h4>Details</h4><div class="kv"><span>Lizenz</span><b>${esc(p.license?.id === 'LicenseRef-All-Rights-Reserved' ? 'Alle Rechte vorbehalten' : p.license?.id || '—')}</b></div><div class="kv"><span>Veröffentlicht</span><b>${esc(dateDe(p.published))}</b></div><div class="kv"><span>Aktualisiert</span><b>${esc(dateDe(p.updated))}</b></div>${P.versions ? `<div class="kv"><span>Versionen</span><b>${P.versions.length}</b></div>` : ''}</div>`;
}

/* ---------- markdown + HTML (Modrinth bodies mix both) → sanitized ---------- */
function mdInline(s) {
  return s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`)
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
}
function mdRender(src) {
  const lines = String(src).replace(/\r/g, '').split('\n'), out = [];
  let i = 0;
  const isBlock = l => /^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|\|)|^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l);
  while (i < lines.length) {
    let l = lines[i];
    if (/^\s*```/.test(l)) { const code = []; i++; while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]); i++; out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); continue; }
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = /^\s*(#{1,6})\s+(.*?)#*\s*$/.exec(l))) { out.push(`<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(l)) { const q = []; while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, '')); out.push(`<blockquote>${mdRender(q.join('\n'))}</blockquote>`); continue; }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-+/.test(lines[i + 1])) {
      const row = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => mdInline(c.trim()));
      const h = row(l); i += 2; const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(row(lines[i++]));
      out.push(`<table><thead><tr>${h.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue;
    }
    if ((m = /^(\s*)([-*+]|\d+[.)])\s+/.exec(l))) {
      const ordered = /\d/.test(m[2]), items = [];
      while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const ln = lines[i++];
        if (/^\s*([-*+]|\d+[.)])\s+/.test(ln) && ln.search(/\S/) <= m[1].length + 1) items.push(ln.replace(/^\s*([-*+]|\d+[.)])\s+/, '').replace(/^\[( |x)\]\s/i, (_, x) => x.trim() ? '☑ ' : '☐ '));
        else items[items.length - 1] += '\n' + ln.trim();
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(t => `<li>${t.includes('\n') ? mdRender(t) : mdInline(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`); continue;
    }
    if (/^\s*<\/?[a-zA-Z]/.test(l)) { const h = []; while (i < lines.length && lines[i].trim()) h.push(lines[i++]); out.push(mdInline(h.join('\n'))); continue; }
    const para = []; while (i < lines.length && lines[i].trim() && !isBlock(lines[i]) && !/^\s*<\/?(div|p|center|details|table|h\d)/i.test(lines[i])) para.push(lines[i++]);
    if (!para.length) { out.push(mdInline(lines[i++])); continue; }
    out.push(`<p>${para.map(mdInline).join(' ').replace(/ {2,}/g, '<br>')}</p>`);
  }
  return sanitize(out.join('\n'));
}
const OK_TAGS = new Set('a,b,strong,i,em,u,s,del,code,pre,p,br,hr,h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,img,table,thead,tbody,tr,th,td,div,span,center,details,summary,sup,sub,kbd,small,font,picture,source,figure,figcaption,video,iframe'.split(','));
function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html'), root = doc.body.firstChild;
  const walk = n => {
    [...n.childNodes].forEach(c => {
      if (c.nodeType === 8) return c.remove();
      if (c.nodeType !== 1) return;
      const t = c.tagName.toLowerCase();
      if (!OK_TAGS.has(t)) { if (['script', 'style', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'link', 'meta'].includes(t)) c.remove(); else { walk(c); c.replaceWith(...c.childNodes); } return; }
      if (t === 'iframe' || t === 'video') {
        const src = c.getAttribute('src') || c.querySelector('source')?.getAttribute('src') || '';
        const yt = /(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)([\w-]{6,})/.exec(src);
        const a = doc.createElement('a'); a.className = 'yt'; a.href = yt ? 'https://www.youtube.com/watch?v=' + yt[1] : src; a.textContent = yt ? '▶ Video auf YouTube ansehen' : '▶ Video öffnen';
        if (/^https:/.test(a.href)) c.replaceWith(a); else c.remove(); return;
      }
      [...c.attributes].forEach(at => {
        const k = at.name.toLowerCase(), v = at.value;
        const keep = (k === 'href' && /^https?:/i.test(v)) || ((k === 'src' || k === 'srcset') && /^https:/i.test(v)) || ['alt', 'title', 'width', 'height', 'align', 'colspan', 'rowspan', 'open'].includes(k);
        if (!keep) c.removeAttribute(at.name);
      });
      if (t === 'img') { c.setAttribute('loading', 'lazy'); const w = +c.getAttribute('width'); if (w > 0 && w < 64) c.style.display = 'inline'; }
      walk(c);
    });
  };
  walk(root);
  return root.innerHTML;
}
function mdBind(el) {
  if (!el) return;
  el.onclick = e => {
    const a = e.target.closest('a[href]'); if (!a) return; e.preventDefault();
    const u = a.getAttribute('href'), m = /^https:\/\/modrinth\.com\/(mod|modpack|resourcepack|shader|datapack|plugin)\/([^/?#]+)/.exec(u);
    if (m) return go('project', { id: m[2] });
    openUrl(u);
  };
}

/* ======================= SKINS (CSS 3D viewer, original code) ======================= */
// cuboid faces in Minecraft skin UV layout: [w,h,d,u,v]
function cuboid(w, h, d, u, v, U, tex, ox, oy, oz, inflate = 0) {
  const k = inflate ? 1 + inflate / Math.min(w, h, d) : 1;
  const W = w * U * (inflate ? (w + inflate) / w : 1), H = h * U * (inflate ? (h + inflate) / h : 1), Dp = d * U * (inflate ? (d + inflate) / d : 1);
  const sx = inflate ? (w + inflate) / w : 1, sy = inflate ? (h + inflate) / h : 1, sz = inflate ? (d + inflate) / d : 1;
  const face = (fw, fh, fu, fv, tr, ssx, ssy) => `<div class="f" style="width:${fw * U}px;height:${fh * U}px;margin:${-fh * U / 2}px 0 0 ${-fw * U / 2}px;background-image:url('${tex.url}');background-size:${64 * U}px ${tex.h * U}px;background-position:${-fu * U}px ${-fv * U}px;transform:translate3d(${ox}px,${oy}px,${oz}px) ${tr} scale(${ssx},${ssy})"></div>`;
  return face(w, h, u + d, v + d, `translateZ(${Dp / 2}px)`, sx, sy)
    + face(w, h, u + 2 * d + w, v + d, `rotateY(180deg) translateZ(${Dp / 2}px)`, sx, sy)
    + face(d, h, u, v + d, `rotateY(-90deg) translateZ(${W / 2}px)`, sz, sy)
    + face(d, h, u + d + w, v + d, `rotateY(90deg) translateZ(${W / 2}px)`, sz, sy)
    + face(w, d, u + d, v, `rotateX(90deg) translateZ(${H / 2}px)`, sx, sz)
    + face(w, d, u + d + w, v, `rotateX(-90deg) translateZ(${H / 2}px)`, sx, sz);
}
function skinModel(url, slim, U = 8, legacy = false) {
  const tex = { url: esc(url), h: legacy ? 32 : 64 }, aw = slim ? 3 : 4, ax = 4 + aw / 2;
  const part = (cls, px, py, inner) => `<div class="pt ${cls}" style="transform:translate3d(${px * U}px,${py * U}px,0)">${inner}</div>`;
  // part pivots: head at neck, arms at shoulders, legs at hips (y down, model center = 0)
  const head = cuboid(8, 8, 8, 0, 0, U, tex, 0, -4 * U, 0) + `<div class="ov">${cuboid(8, 8, 8, 32, 0, U, tex, 0, -4 * U, 0, 1)}</div>`;
  const body = cuboid(8, 12, 4, 16, 16, U, tex, 0, 6 * U, 0) + (legacy ? '' : `<div class="ov">${cuboid(8, 12, 4, 16, 32, U, tex, 0, 6 * U, 0, .5)}</div>`);
  const rArm = cuboid(aw, 12, 4, 40, 16, U, tex, 0, 4 * U, 0) + (legacy ? '' : `<div class="ov">${cuboid(aw, 12, 4, 40, 32, U, tex, 0, 4 * U, 0, .5)}</div>`);
  const lArm = legacy ? cuboid(aw, 12, 4, 40, 16, U, tex, 0, 4 * U, 0) : cuboid(aw, 12, 4, 32, 48, U, tex, 0, 4 * U, 0) + `<div class="ov">${cuboid(aw, 12, 4, 48, 48, U, tex, 0, 4 * U, 0, .5)}</div>`;
  const rLeg = cuboid(4, 12, 4, 0, 16, U, tex, 0, 6 * U, 0) + (legacy ? '' : `<div class="ov">${cuboid(4, 12, 4, 0, 32, U, tex, 0, 6 * U, 0, .5)}</div>`);
  const lLeg = legacy ? cuboid(4, 12, 4, 0, 16, U, tex, 0, 6 * U, 0) : cuboid(4, 12, 4, 16, 48, U, tex, 0, 6 * U, 0) + `<div class="ov">${cuboid(4, 12, 4, 0, 48, U, tex, 0, 6 * U, 0, .5)}</div>`;
  return `<div class="mcm">${part('hd', 0, -8, head)}${part('bd', 0, -8, body)}${part('ra', -ax, -6, rArm)}${part('la', ax, -6, lArm)}${part('rl', -2, 4, rLeg)}${part('ll', 2, 4, lLeg)}</div>`;
}
const texH = url => new Promise(r => { const im = new Image(); im.onload = () => r(im.naturalHeight); im.onerror = () => r(64); im.src = url; });
const SV = { rot: -25, tilt: -8, spin: true, walk: false, t: 0, raf: 0 };
function viewerLoop() {
  cancelAnimationFrame(SV.raf);
  const step = () => {
    const m = $('#skStage .mcm'); if (!m || S.page !== 'skins') return;
    if (SV.spin && !SV.drag) SV.rot += 0.35;
    SV.t += 0.06;
    const sw = SV.walk ? Math.sin(SV.t) * 32 : Math.sin(SV.t / 2) * 3;
    m.style.transform = `rotateX(${SV.tilt}deg) rotateY(${SV.rot}deg)`;
    const set = (c, a) => { const p = m.querySelector('.' + c); if (p) p.style.transform = p.style.transform.replace(/ rotateX\([^)]*\)| rotateZ\([^)]*\)/g, '') + a; };
    set('ra', ` rotateX(${sw}deg) rotateZ(${SV.walk ? 0 : 2}deg)`); set('la', ` rotateX(${-sw}deg) rotateZ(${SV.walk ? 0 : -2}deg)`);
    set('rl', ` rotateX(${SV.walk ? -sw : 0}deg)`); set('ll', ` rotateX(${SV.walk ? sw : 0}deg)`);
    SV.raf = requestAnimationFrame(step);
  };
  step();
}
PAGES.skins = async el => {
  crumbs([['Skins']]);
  const acc = activeAcc();
  el.innerHTML = `<div class="ph"><div><div class="kicker">${acc ? esc(acc.name) : 'Nicht angemeldet'}</div><h1>Skins</h1><p class="pd">Sammle Skins, schau sie dir in 3D an und übernimm sie mit einem Klick für dein Konto.</p></div></div>
    <div class="skwrap"><div class="skview"><div class="stage3" id="skStage"><span class="floor"></span></div><div class="sbar" id="skBar"></div></div><div id="skSide"><div class="spinner"></div></div></div>`;
  const [lib, prof] = await Promise.all([api('skins.list').catch(() => []), acc ? api('skin.profile').catch(e => ({ error: e.message })) : Promise.resolve(null)]);
  if (S.page !== 'skins') return;
  S.skins = { lib, prof, sel: S.skins?.sel };
  const active = prof?.skins?.find(s => s.state === 'ACTIVE');
  if (!S.skins.sel || (S.skins.sel !== '__cur' && !lib.find(x => x.id === S.skins.sel))) S.skins.sel = active ? '__cur' : lib[0]?.id || '__def';
  skinSide(); skinShow();
  const st = $('#skStage');
  st.onpointerdown = e => { SV.drag = { x: e.clientX, y: e.clientY, r: SV.rot, t: SV.tilt }; st.setPointerCapture(e.pointerId); };
  st.onpointermove = e => { if (!SV.drag) return; SV.rot = SV.drag.r + (e.clientX - SV.drag.x) * .6; SV.tilt = Math.max(-35, Math.min(35, SV.drag.t - (e.clientY - SV.drag.y) * .3)); };
  st.onpointerup = () => SV.drag = null;
};
function selSkin() {
  const K = S.skins, active = K.prof?.skins?.find(s => s.state === 'ACTIVE');
  if (K.sel === '__cur' && active) return { id: '__cur', name: 'Aktueller Skin', url: active.url.replace('http://', 'https://'), variant: active.variant === 'SLIM' ? 'slim' : 'classic', current: true };
  if (K.sel === '__def' || !K.lib.length) return { id: '__def', name: 'Orbit (Vorlage)', url: demoSkin(0), variant: 'classic', demo: true };
  return K.lib.find(x => x.id === K.sel) || K.lib[0];
}
async function skinShow() {
  const s = selSkin(), st = $('#skStage'); if (!st) return;
  const h = await texH(s.url);
  st.innerHTML = '<span class="floor"></span>' + skinModel(s.url, s.variant === 'slim', 9, h === 32);
  viewerLoop();
  const canApply = !s.current && !s.demo && S.accounts.length;
  $('#skBar').innerHTML = `<div class="row"><b class="ell" style="flex:1">${esc(s.name)}</b>${s.current ? '<span class="chip g">Aktiv</span>' : ''}</div>
    <div class="row"><div class="seg" id="skVar"><button data-v="classic" class="${s.variant !== 'slim' ? 'on' : ''}">Klassisch</button><button data-v="slim" class="${s.variant === 'slim' ? 'on' : ''}">Schlank</button></div><span class="sp"></span>
      <button class="ib ${SV.walk ? 'on' : ''}" id="skWalk" title="Laufen">${ico('walk')}</button><button class="ib ${SV.spin ? 'on' : ''}" id="skSpin" title="Drehen">${ico('rotate')}</button></div>
    ${canApply ? `<button class="btn p" id="skApply" style="justify-content:center">${ico('check')}Für ${esc(activeAcc().name)} übernehmen</button>` : s.current ? `<button class="btn" id="skSave" style="justify-content:center">${ico('download')}In Bibliothek speichern</button>` : !S.accounts.length ? `<button class="btn" onclick="login()" style="justify-content:center">${ico('user')}Anmelden zum Übernehmen</button>` : ''}`;
  $('#skVar').onclick = async e => { const b = e.target.closest('[data-v]'); if (!b) return; s.variant = b.dataset.v; if (!s.current && !s.demo) api('skins.update', { id: s.id, variant: s.variant }); skinShow(); skinSide(); };
  $('#skWalk').onclick = () => { SV.walk = !SV.walk; $('#skWalk').classList.toggle('on', SV.walk); };
  $('#skSpin').onclick = () => { SV.spin = !SV.spin; $('#skSpin').classList.toggle('on', SV.spin); };
  if ($('#skApply')) $('#skApply').onclick = async () => {
    const b = $('#skApply'); b.disabled = true; b.innerHTML = ico('refresh', 'i spin') + 'Wird übernommen…';
    try { const prof = await api('skin.apply', { id: s.id, variant: s.variant }); S.skins.prof = prof; toast('Skin übernommen', 'Im Spiel nach dem nächsten Start sichtbar'); const r = await api('init'); S.accounts = r.accounts; accountUI(); S.skins.sel = '__cur'; skinSide(); skinShow(); }
    catch (e) { b.disabled = false; b.innerHTML = ico('check') + 'Übernehmen'; fail('Skin', e); }
  };
  if ($('#skSave')) $('#skSave').onclick = async () => { try { const e = await api('skins.add', { url: s.url, name: (activeAcc()?.name || 'Skin'), variant: s.variant }); S.skins.lib.unshift(e); toast('Gespeichert'); skinSide(); } catch (e) { fail('Skin', e); } };
}
function skinSide() {
  const K = S.skins, el = $('#skSide'); if (!el) return;
  const active = K.prof?.skins?.find(s => s.state === 'ACTIVE'), capes = K.prof?.capes || [];
  const card = (id, name, url, variant, extra = '') => `<div class="skc ${K.sel === id ? 'on' : ''}" data-sk="${esc(id)}">${extra}<div class="thumb">${skinModel(url, variant === 'slim', 4.2).replace('class="mcm"', 'class="mcm" style="transform:rotateX(-8deg) rotateY(-28deg)"')}</div><b>${esc(name)}</b><small>${variant === 'slim' ? 'Schlank' : 'Klassisch'}</small></div>`;
  el.innerHTML = `${K.prof?.error ? `<div class="note w" style="margin:0 0 14px">Profil konnte nicht geladen werden: ${esc(K.prof.error)}</div>` : ''}
    ${capes.length ? `<div class="sec" style="margin-top:0"><h2>Umhänge</h2></div><div class="capes" id="skCapes"><button class="capeb ${capes.some(c => c.state === 'ACTIVE') ? '' : 'on'}" data-cape=""><i class="none"></i>Keiner</button>${capes.map(c => `<button class="capeb ${c.state === 'ACTIVE' ? 'on' : ''}" data-cape="${esc(c.id)}"><i style="background-image:url('${esc(c.url.replace('http://', 'https://'))}')"></i>${esc(c.alias || 'Umhang')}</button>`).join('')}</div>` : ''}
    <div class="sec" ${capes.length ? '' : 'style="margin-top:0"'}><h2>Deine Skins</h2><span class="muted">${K.lib.length}</span></div>
    <div class="sklib" id="skLib"><button class="skc add" id="skAdd"><span>${ico('plus')}<b>Skin hinzufügen</b><small>PNG, 64×64</small></span></button>
      ${active ? card('__cur', 'Aktueller Skin', active.url.replace('http://', 'https://'), active.variant === 'SLIM' ? 'slim' : 'classic', '<span class="badge">AKTIV</span>') : ''}
      ${K.lib.map(x => card(x.id, x.name, x.url, x.variant, `<span class="act"><button class="ib sm" data-ren="${esc(x.id)}" title="Umbenennen">${ico('edit')}</button><button class="ib sm d" data-del="${esc(x.id)}" title="Löschen">${ico('trash')}</button></span>`)).join('')}
      ${!K.lib.length && !active ? card('__def', 'Orbit (Vorlage)', demoSkin(0), 'classic') : ''}</div>
    <p class="fine">Skins werden nur lokal gespeichert, bis du sie übernimmst. Übernehmen geht direkt über Mojangs offizielle Schnittstelle mit deinem Konto.</p>`;
  $('#skLib').onclick = async e => {
    if (e.target.closest('#skAdd')) { try { const x = await api('skins.add', { variant: 'classic' }); if (x) { K.lib.unshift(x); K.sel = x.id; skinSide(); skinShow(); } } catch (er) { fail('Skin', er); } return; }
    const del = e.target.closest('[data-del]'); if (del) { e.stopPropagation(); if (!await confirmBox('Skin löschen?', 'Er wird aus deiner Bibliothek entfernt.', 'Löschen', true)) return; await api('skins.remove', { id: del.dataset.del }); K.lib = K.lib.filter(x => x.id !== del.dataset.del); if (K.sel === del.dataset.del) K.sel = null; skinSide(); skinShow(); return; }
    const ren = e.target.closest('[data-ren]'); if (ren) { e.stopPropagation(); const x = K.lib.find(y => y.id === ren.dataset.ren); const n = await promptBox('Umbenennen', 'Name', x.name); if (n) { x.name = n; api('skins.update', { id: x.id, name: n }); skinSide(); skinShow(); } return; }
    const c = e.target.closest('[data-sk]'); if (c) { K.sel = c.dataset.sk; $$('#skLib .skc').forEach(x => x.classList.toggle('on', x === c)); skinShow(); }
  };
  if ($('#skCapes')) $('#skCapes').onclick = async e => {
    const b = e.target.closest('[data-cape]'); if (!b) return;
    try { const prof = await api('skin.cape', { id: b.dataset.cape || null }); if (prof?.capes) K.prof = prof; else K.prof.capes.forEach(c => c.state = c.id === b.dataset.cape ? 'ACTIVE' : 'INACTIVE'); toast('Umhang geändert'); skinSide(); }
    catch (er) { fail('Umhang', er); }
  };
}
/* original demo skins drawn on a canvas (no Mojang assets) */
const demoCache = {};
function demoSkin(n) {
  if (demoCache[n]) return demoCache[n];
  const P = [['#E0AC85', '#3B2A1E', '#FF7A3D', '#2A2A33', '#1E1E24', '#4A86FF'], ['#C58C66', '#111', '#2DD4A0', '#33415C', '#222', '#3A2A1A'], ['#F1C9A5', '#E7C35A', '#8B7BFF', '#3C2F55', '#2A2340', '#2EA36B'], ['#8D5A3F', '#1A1A1A', '#F87171', '#E8E8EC', '#3A3A44', '#6B4A2A']][n % 4];
  const [skin, hair, shirt, pants, shoe, eye] = P;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  let seed = 3 + n * 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const box = (u, v, w, h, d, col) => { const r = [[u + d, v, w, d], [u + d + w, v, w, d], [u, v + d, d, h], [u + d, v + d, w, h], [u + d + w, v + d, d, h], [u + 2 * d + w, v + d, w, h]]; r.forEach(([a, b, cw, ch]) => { x.fillStyle = col; x.fillRect(a, b, cw, ch); for (let i = 0; i < cw * ch / 6; i++) { x.fillStyle = `rgba(0,0,0,${rnd() * .12})`; x.fillRect(a + Math.floor(rnd() * cw), b + Math.floor(rnd() * ch), 1, 1); } }); };
  box(0, 0, 8, 8, 8, skin); x.fillStyle = hair; x.fillRect(8, 0, 8, 8); x.fillRect(0, 8, 32, 2); x.fillRect(24, 8, 8, 8); x.fillRect(8, 8, 8, 2); x.fillRect(8, 10, 1, 2); x.fillRect(15, 10, 1, 2);
  x.fillStyle = '#fff'; x.fillRect(9, 12, 2, 1); x.fillRect(13, 12, 2, 1); x.fillStyle = eye; x.fillRect(10, 12, 1, 1); x.fillRect(13, 12, 1, 1);
  x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(11, 14, 2, 1); x.fillStyle = 'rgba(120,60,40,.5)'; x.fillRect(10, 15, 4, 1);
  box(16, 16, 8, 12, 4, shirt); x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(20, 20, 8, 1); x.fillStyle = pants; x.fillRect(20, 30, 8, 2);
  x.fillStyle = 'rgba(255,255,255,.85)'; x.fillRect(22, 23, 4, 4); x.fillStyle = shirt; x.fillRect(23, 24, 2, 2);
  box(40, 16, 4, 12, 4, shirt); x.fillStyle = skin; x.fillRect(40, 28, 16, 4); box(32, 48, 4, 12, 4, shirt); x.fillStyle = skin; x.fillRect(32, 60, 16, 4);
  box(0, 16, 4, 12, 4, pants); x.fillStyle = shoe; x.fillRect(0, 29, 16, 3); box(16, 48, 4, 12, 4, pants); x.fillStyle = shoe; x.fillRect(16, 61, 16, 3);
  x.fillStyle = hair; x.fillRect(40, 0, 8, 8); x.fillRect(32, 8, 32, 3);
  return demoCache[n] = c.toDataURL();
}

/* ======================= SETTINGS ======================= */
const setS = (key, value) => { S.settings[key] = value; return api('settings.set', { key, value }).catch(e => fail('Speichern fehlgeschlagen', e)); };
const STABS = [['account', 'Konten', 'user', 'Microsoft-Anmeldung'], ['design', 'Design', 'palette', 'Farben und Verhalten'], ['java', 'Java', 'coffee', 'Laufzeiten pro Version'], ['defaults', 'Standard-Instanz', 'cube', 'Speicher, Fenster, JVM'], ['storage', 'Speicher & Daten', 'hdd', 'Ordner und Cache'], ['about', 'Über', 'info', 'Version und Lizenzen']];
PAGES.settings = (el, a) => {
  S.stab = a.tab || S.stab || 'account';
  crumbs([['Einstellungen']]);
  el.innerHTML = `<div class="ph"><div><div class="kicker">OrbitLauncher</div><h1>Einstellungen</h1></div></div>
    <div class="sgrid"><div class="snav" id="sNav">${STABS.map(([k, n, ic, d]) => `<button class="tab ${S.stab === k ? 'on' : ''}" data-k="${k}">${ico(ic)}<span>${n}<small>${d}</small></span></button>`).join('')}</div><div id="sBody"></div></div>`;
  $('#sNav').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; S.stab = b.dataset.k; S.hist[S.hi].a = { tab: S.stab }; $$('#sNav .tab').forEach(x => x.classList.toggle('on', x === b)); setBody(); };
  setBody();
};
async function setBody() {
  const b = $('#sBody'), st = S.settings; if (!b) return;
  const card = (t, h) => `<div class="card">${t ? `<h2 style="margin-bottom:6px">${t}</h2>` : ''}${h}</div>`;
  const tg = (k, on) => `<div class="tg ${on ? 'on' : ''}" data-set="${k}"></div>`;
  if (S.stab === 'account') {
    b.innerHTML = card('Microsoft-Konten', (S.accounts.length ? S.accounts.map(a => `<div class="acc">${headHtml(a, 'head lg')}<div class="tx"><b>${esc(a.name)}</b><p>${a.uuid === S.active ? 'Aktives Konto' : 'Gespeichert'} · <code class="cc">${esc(a.uuid.slice(0, 8))}…</code></p></div>
      ${a.uuid === S.active ? '<span class="chip g">Aktiv</span>' : `<button class="btn sm" onclick="selectAccount('${jsq(a.uuid)}')">Wechseln</button>`}<button class="ib sm d" title="Abmelden" onclick="removeAccount('${jsq(a.uuid)}')">${ico('logout')}</button></div>`).join('') : '<p class="sub" style="margin:8px 0">Noch kein Konto. Zum Spielen brauchst du ein Microsoft-Konto mit Minecraft: Java Edition.</p>')
      + `<div class="row" style="margin-top:14px"><button class="btn p" onclick="login()">${ico('plus')}Konto hinzufügen</button></div><p class="fine">Die Anmeldung läuft über das offizielle Microsoft-Fenster. OrbitLauncher sieht dein Passwort nie und speichert nur ein Refresh-Token, verschlüsselt mit Windows (DPAPI).</p>`);
  }
  if (S.stab === 'design') {
    b.innerHTML = card('Akzentfarbe', `<div class="themes" id="sThemes" style="margin-top:12px">${Object.entries(THEMES).map(([k, [n, c1, c2]]) => `<div class="sw ${st.accent === k ? 'on' : ''}" data-th="${k}"><i style="background:linear-gradient(135deg,${c1},${c2})"></i>${n}</div>`).join('')}</div><p class="fine">Gilt auch für das Ingame-Menü des Orbit Clients.</p>`)
      + `<div class="mt"></div>` + card('Verhalten', `<div class="srow"><div><b>Beim Spielstart</b><p>Was der Launcher macht, wenn Minecraft startet.</p></div><div class="seg" id="sOnL">${[['keep', 'Offen lassen'], ['minimize', 'Minimieren'], ['close', 'Schließen']].map(([k, n]) => `<button data-v="${k}" class="${st.onLaunch === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
        <div class="srow"><div><b>Mods automatisch aktualisieren</b><p>Vor jedem Start Updates von Modrinth holen.</p></div>${tg('autoUpdateMods', st.autoUpdateMods)}</div>
        <div class="srow"><div><b>Snapshots anzeigen</b><p>Vorabversionen in Versionslisten.</p></div>${tg('showSnapshots', st.showSnapshots)}</div>`);
    $('#sThemes').onclick = e => { const s = e.target.closest('[data-th]'); if (!s) return; applyTheme(s.dataset.th); setS('accent', s.dataset.th); $$('#sThemes .sw').forEach(x => x.classList.toggle('on', x === s)); S.heroSvg = null; };
    $('#sOnL').onclick = e => { const x = e.target.closest('[data-v]'); if (!x) return; setS('onLaunch', x.dataset.v); $$('#sOnL button').forEach(y => y.classList.toggle('on', y === x)); };
  }
  if (S.stab === 'java') {
    b.innerHTML = card('Java-Laufzeiten', '<div class="spinner"></div>');
    let list = []; try { list = await api('java.list'); } catch { }
    if (S.stab !== 'java') return;
    b.innerHTML = card('Java-Laufzeiten', `<p class="sub" style="margin-bottom:6px">OrbitLauncher lädt für jede Minecraft-Version automatisch das passende Java (Mojang, sonst Eclipse Temurin).</p>
      ${list.length ? list.map(j => `<div class="jrow"><span class="iic">${ico('coffee')}</span><div class="tx"><b>Java ${j.major}</b><p>${esc(j.path)}</p></div><span class="chip m">${esc(j.source)}</span></div>`).join('') : '<div class="empty" style="margin-top:10px">Noch keins geladen. Kommt beim ersten Start automatisch.</div>'}`)
      + '<div class="mt"></div>' + card('Eigenes Java für alle Instanzen', `<div class="inline" style="margin-top:10px"><input class="in" id="sJava" placeholder="Automatisch (empfohlen)" value="${esc(st.javaPath || '')}"><button class="btn" onclick="pickJava('sJava')">${ico('folder')}Durchsuchen</button></div><p class="fine">Nur ändern, wenn du weißt warum. Einzelne Instanzen können ein eigenes Java haben.</p>`);
    $('#sJava').onchange = e => setS('javaPath', e.target.value.trim() || null);
  }
  if (S.stab === 'defaults') {
    b.innerHTML = card('Arbeitsspeicher', `<div class="ramrow" style="margin-top:12px"><input type="range" min="1024" max="16384" step="256" value="${st.ramMb || 4096}" id="sRam"><input class="in" id="sRamN" readonly value="${st.ramMb || 4096} MB"></div><p class="fine">4–6 GB reichen für die meisten Modpacks. Zu viel kann Ruckler machen.</p>`)
      + '<div class="mt"></div>' + card('Fenster', `<div class="vrow2" style="margin-top:6px"><div><label class="fl">Breite</label><input class="in" type="number" id="sW" value="${st.width || 0}"></div><div><label class="fl">Höhe</label><input class="in" type="number" id="sH" value="${st.height || 0}"></div></div><p class="fine">0 = Minecraft-Standard.</p>`)
      + '<div class="mt"></div>' + card('JVM-Argumente', `<input class="in" id="sJvm" style="margin-top:10px;font-family:var(--mono);font-size:12px" placeholder="Leer = Mojangs empfohlene Argumente" value="${esc(st.jvmArgs || '')}">`);
    const r = $('#sRam'); setRange(r); let t = 0;
    r.oninput = () => { setRange(r); $('#sRamN').value = r.value + ' MB'; clearTimeout(t); t = setTimeout(() => setS('ramMb', +r.value), 300); };
    $('#sW').onchange = e => setS('width', +e.target.value || 0); $('#sH').onchange = e => setS('height', +e.target.value || 0);
    $('#sJvm').onchange = e => setS('jvmArgs', e.target.value.trim() || null);
  }
  if (S.stab === 'storage') {
    b.innerHTML = card('Datenordner', `<div class="inline" style="margin-top:10px"><input class="in" readonly value="${esc(S.root)}" style="font-family:var(--mono);font-size:12px"><button class="btn" onclick="api('folder.open')">${ico('folder')}Öffnen</button></div>`) + '<div class="mt"></div>' + card('Speicherbelegung', '<div class="spinner"></div>');
    let info = []; try { info = await api('storage.info'); } catch { }
    if (S.stab !== 'storage') return;
    const N = { instances: ['Instanzen', 'Welten, Mods, Einstellungen'], versions: ['Versionen', 'Spiel-Clients'], libraries: ['Bibliotheken', 'Geteilt von allen Instanzen'], assets: ['Assets', 'Sounds, Sprachen, Texturen'], runtime: ['Java', 'Laufzeiten'], cache: ['Cache', 'Temporäre Downloads'] };
    const total = info.reduce((s, x) => s + x.size, 0);
    b.lastElementChild.outerHTML = card('Speicherbelegung', `<div class="storage">${info.map(x => `<div class="srow"><div><b>${N[x.name]?.[0] || x.name}</b><p>${N[x.name]?.[1] || ''}</p></div><div style="width:180px"><div class="bar"><i style="width:${total ? Math.max(2, x.size / total * 100) : 0}%"></i></div></div><b style="width:80px;text-align:right">${bytes(x.size)}</b>${x.name === 'cache' ? `<button class="btn sm" id="sClr">${ico('trash')}Leeren</button>` : '<span style="width:84px"></span>'}</div>`).join('')}
      <div class="srow"><div><b>Gesamt</b></div><b>${bytes(total)}</b><span style="width:84px"></span></div></div>`);
    if ($('#sClr')) $('#sClr').onclick = async () => { await api('cache.clear'); toast('Cache geleert'); setBody(); };
  }
  if (S.stab === 'about') {
    b.innerHTML = card('', `<div class="row" style="gap:16px"><span class="iic" style="width:64px;height:64px;border-radius:18px">${blockSvg('orbit')}</span><div><h2 style="font-size:22px">Orbit<span class="grad">Launcher</span></h2><p class="sub">Version ${esc(S.version)} · Minecraft-Launcher im OrbitTweak-Design</p></div></div>`)
      + '<div class="mt"></div>' + card('Quellen &amp; Lizenzen', `<div class="srow"><div><b>Minecraft</b><p>Spieldateien kommen direkt von Mojang. Minecraft ist eine Marke von Mojang AB. Nicht offiziell, nicht mit Mojang, Microsoft oder Modrinth verbunden.</p></div></div>
        <div class="srow"><div><b>Modrinth</b><p>Mods, Modpacks, Shader und Ressourcenpakete über die öffentliche Modrinth-API, jeweils unter der Lizenz ihrer Autoren.</p></div></div>
        <div class="srow"><div><b>Mod-Loader</b><p>Fabric, Quilt, Forge und NeoForge über ihre offiziellen Meta-APIs und Installer.</p></div></div>
        <div class="srow"><div><b>Java</b><p>Mojang Java Runtime bzw. Eclipse Temurin (Adoptium).</p></div></div>
        <div class="srow"><div><b>Schriften &amp; Icons</b><p>Geist und Inter (SIL Open Font License), Icons im Stil von Lucide (ISC).</p></div></div>`);
  }
  b.querySelectorAll('[data-set]').forEach(t => t.onclick = () => { const on = !t.classList.contains('on'); t.classList.toggle('on', on); setS(t.dataset.set, on); });
}

/* ======================= ORBIT CLIENT TAB (instance) ======================= */
const COLORS = ['Weiß', 'Akzent', 'Chroma', 'Grün', 'Rot', 'Blau', 'Gelb', 'Pink'];
const HUDSET = [['bg', 'Hintergrund', 'bool', true], ['shadow', 'Textschatten', 'bool', true], ['color', 'Farbe', 'choice', 'Weiß', COLORS], ['scale', 'Größe', 'num', 1, 0.5, 2.5, 0.1]];
const OMODS = [
  ['fps', 'FPS', 'Bilder pro Sekunde', 'HUD', 1, 1, [], 'activity'],
  ['cps', 'CPS', 'Klicks pro Sekunde, links | rechts', 'PvP', 1, 1, [], 'sword'],
  ['keystrokes', 'Keystrokes', 'WASD, Maustasten mit CPS und Leertaste live', 'PvP', 1, 1, [['mouse', 'Maustasten', 'bool', true], ['space', 'Leertaste', 'bool', true], ['cpsInKeys', 'CPS in Maustasten', 'bool', true]], 'keyboard'],
  ['coords', 'Koordinaten', 'XYZ, Blickrichtung und Biom', 'HUD', 1, 1, [['biome', 'Biom anzeigen', 'bool', true], ['facing', 'Richtung anzeigen', 'bool', true]], 'compass'],
  ['armor', 'Rüstung', 'Rüstung und Item in der Hand mit Haltbarkeit', 'PvP', 1, 1, [['dura', 'Haltbarkeit', 'choice', 'Prozent', ['Prozent', 'Zahl', 'Aus']], ['hand', 'Item in der Hand', 'bool', true]], 'shield'],
  ['potions', 'Effekte', 'Aktive Tränke mit Restzeit', 'HUD', 1, 1, [], 'sparkle'],
  ['ping', 'Ping', 'Latenz zum Server', 'HUD', 1, 1, [], 'globe'],
  ['reach', 'Reichweite', 'Distanz deines letzten Treffers', 'PvP', 1, 1, [], 'target'],
  ['combo', 'Combo', 'Treffer in Folge', 'PvP', 1, 1, [], 'zap'],
  ['sprint', 'Sprint-Status', 'Zeigt Toggle-Sprint und Schleichen', 'Komfort', 1, 1, [], 'rocket'],
  ['server', 'Server', 'Aktuelle Server-Adresse', 'HUD', 1, 0, [], 'link'],
  ['clock', 'Uhrzeit', 'Echte Uhrzeit', 'HUD', 1, 0, [['seconds', 'Sekunden', 'bool', false]], 'clock'],
  ['memory', 'Speicher', 'RAM-Verbrauch von Minecraft', 'HUD', 1, 0, [], 'ram'],
  ['speed', 'Tempo', 'Blöcke pro Sekunde', 'HUD', 1, 0, [], 'zap'],
  ['session', 'Sitzung', 'Spielzeit dieser Sitzung', 'HUD', 1, 0, [], 'clock'],
  ['zoom', 'Zoom', 'C halten, Mausrad ändert die Stärke', 'PvP', 0, 1, [['factor', 'Zoomstärke', 'num', 4, 2, 12, 1], ['smooth', 'Weicher Zoom', 'bool', true], ['cinematic', 'Kamera glätten', 'bool', true], ['scroll', 'Mausrad-Zoom', 'bool', true]], 'search'],
  ['freelook', 'Freelook', 'Linke Alt-Taste halten und frei umschauen', 'PvP', 0, 1, [['invert', 'Maus umkehren', 'bool', false]], 'eye'],
  ['fullbright', 'Fullbright', 'Alles hell, auch in Höhlen (Taste G)', 'Grafik', 0, 0, [], 'sun'],
  ['crosshair', 'Fadenkreuz', 'Eigenes Fadenkreuz: Form, Größe, Farbe', 'Grafik', 0, 0, [['style', 'Form', 'choice', 'Plus', ['Plus', 'Plus+Punkt', 'Punkt', 'Kreis', 'X', 'T']], ['size', 'Länge', 'num', 5, 1, 15, 1], ['gap', 'Abstand', 'num', 2, 0, 10, 1], ['thick', 'Dicke', 'num', 1, 1, 4, 1], ['ccolor', 'Farbe', 'choice', 'Weiß', ['Weiß', 'Akzent', 'Grün', 'Rot', 'Cyan', 'Gelb', 'Pink']], ['outline', 'Umrandung', 'bool', true]], 'target'],
  ['togglesprint', 'Toggle Sprint', 'Sprinten einmal drücken statt halten', 'Komfort', 0, 1, [['sneak', 'Auch Schleichen umschalten', 'bool', false]], 'rocket'],
  ['nobob', 'Ruhige Kamera', 'Kein Kamerawackeln und kein FOV-Effekt', 'Grafik', 0, 0, [], 'eye'],
].map(([id, name, desc, cat, hud, def, extra, icon]) => ({ id, name, desc, cat, hud: !!hud, def: !!def, icon, settings: (hud ? HUDSET : []).concat(extra) }));
const OM = Object.fromEntries(OMODS.map(m => [m.id, m]));
const fmtNum = v => Number.isInteger(+v) ? String(+v) : (+v).toFixed(1);
S.orbit = { cfg: null, cat: '' };
const ocfg = id => (S.orbit.cfg.modules = S.orbit.cfg.modules || {})[id] = S.orbit.cfg.modules[id] || {};
const oOn = id => { const c = S.orbit.cfg?.modules?.[id]; return c && c.enabled !== undefined ? !!c.enabled : OM[id].def; };
const oGet = (id, key) => { const v = S.orbit.cfg?.modules?.[id]?.opts?.[key]; if (v !== undefined) return v; const s = OM[id].settings.find(x => x[0] === key); return s ? (s[2] === 'num' ? fmtNum(s[3]) : String(s[3])) : ''; };
const oSet = (id, key, v) => { const c = ocfg(id); (c.opts = c.opts || {})[key] = String(v); oSave(); };
let oSaveT = 0;
const oSync = t => { const e = $('#oSync'); if (e) e.textContent = t; };
function oSave() {
  oSync('Speichert…');
  clearTimeout(oSaveT);
  oSaveT = setTimeout(async () => {
    try { await api('orbit.config.set', { config: S.orbit.cfg }); oSync([...S.running].some(id => instById(id)?.kind === 'orbit') ? 'Live im Spiel übernommen' : 'Gespeichert · gilt live im Spiel'); }
    catch (e) { oSync(''); fail('Speichern fehlgeschlagen', e); }
  }, 250);
}
function orbitCfgEvent(d) {
  if (hbDrag || JSON.stringify(d) === JSON.stringify(S.orbit.cfg)) return;
  S.orbit.cfg = d; S.orbit.cfg.modules = S.orbit.cfg.modules || {};
  if (S.page === 'inst' && S.itab === 'orbit') { renderOMods(); renderStage(); oSync('Aus dem Spiel übernommen'); }
}
async function instOrbit(i) {
  const body = $('#iBody');
  body.innerHTML = '<div class="spinner"></div>';
  try { S.orbit.cfg = await api('orbit.config.get'); } catch { S.orbit.cfg = {}; }
  S.orbit.cfg.modules = S.orbit.cfg.modules || {};
  if (S.itab !== 'orbit') return;
  body.innerHTML = `<div class="cbar"><div class="fchips" id="oCat">${['', 'HUD', 'PvP', 'Grafik', 'Komfort'].map(c => `<button class="fchip ${S.orbit.cat === c ? 'on' : ''}" data-c="${c}">${c || 'Alle'}</button>`).join('')}</div><span class="sp"></span><span class="muted" id="oSync" style="font-size:12px">Gilt live im Spiel · Menü im Spiel: Rechts-Shift</span><button class="btn sm" onclick="orbitReset()">${ico('refresh')}Zurücksetzen</button></div>
    <div class="omods" id="oMods"></div>
    <div class="sec"><h2>HUD-Layout</h2><span class="muted" style="font-size:12px">Ziehen zum Verschieben · Mausrad = Größe · Doppelklick = automatisch</span><span class="sp"></span><button class="btn sm" onclick="hudAuto()">${ico('grid')}Alles automatisch</button></div>
    <div class="card hudc"><div class="stage" id="stage"><div class="stage-bg" id="stageBg"></div><i class="xh"></i></div></div>
    <div class="sec"><h2>Tasten</h2></div><div class="card keys">${[['Rechts-Shift', 'Orbit-Menü öffnen'], ['C (halten)', 'Zoom'], ['Linke Alt (halten)', 'Freelook'], ['G', 'Fullbright'], ['Strg', 'Toggle Sprint']].map(([k, n]) => `<div class="srow"><div><b>${esc(n)}</b></div><kbd>${esc(k)}</kbd></div>`).join('')}<p class="fine">Änderbar im Spiel unter Optionen → Steuerung → „Orbit Client“.</p></div>`;
  $('#oCat').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; S.orbit.cat = b.dataset.c; $$('#oCat .fchip').forEach(x => x.classList.toggle('on', x === b)); renderOMods(); };
  $('#oMods').onclick = e => {
    const st = e.target.closest('[data-oms]'); if (st) return orbitSettings(st.dataset.oms);
    const card = e.target.closest('[data-om]'); if (!card) return;
    const id = card.dataset.om, on = !oOn(id);
    ocfg(id).enabled = on; card.classList.toggle('on', on); card.querySelector('.tg').classList.toggle('on', on);
    oSave(); renderStage();
  };
  bindStage();
  renderOMods(); setTimeout(renderStage, 30);
}
function renderOMods() {
  const el = $('#oMods'); if (!el) return;
  el.innerHTML = OMODS.filter(m => !S.orbit.cat || m.cat === S.orbit.cat).map(m => `<div class="card tcard mcard ${oOn(m.id) ? 'on' : ''}" data-om="${m.id}"><span class="ti">${ico(m.icon)}</span>
    <div class="tx"><b>${esc(m.name)}</b><p>${esc(m.desc)}</p><span class="chip m">${m.cat}</span></div>
    <div class="mact"><div class="tg sm ${oOn(m.id) ? 'on' : ''}"></div>${m.settings.length ? `<button class="ib sm" title="Einstellungen" data-oms="${m.id}">${ico('settings')}</button>` : ''}</div></div>`).join('');
}
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
  box.addEventListener('input', e => { const t = e.target; if (t.dataset.t !== 'num') return; setRange(t); const v = fmtNum(t.value); box.querySelector(`[data-nv="${t.dataset.ok}"]`).textContent = v; oSet(id, t.dataset.ok, v); xhDraw(); });
  S.modalClose = () => { renderOMods(); renderStage(); };
  xhDraw();
}
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
window.orbitReset = async () => {
  if (!await confirmBox('Alles zurücksetzen?', 'Alle Module, Einstellungen und HUD-Positionen gehen auf Standard zurück.', 'Zurücksetzen', true)) return;
  S.orbit.cfg = { modules: {} }; oSave(); renderOMods(); renderStage();
};
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
      : txt === 'armor' ? '<div class="arm"><i></i><i></i><i></i><i></i><i></i></div>' : txt.split('\n').map(l => `<span>${esc(l)}</span>`).join('');
    st.append(d);
  }
}
let hbDrag = null;
function bindStage() {
  const stg = $('#stage');
  stg.addEventListener('pointerdown', e => { const b = e.target.closest('.hb'); if (!b) return; const r = b.getBoundingClientRect(); hbDrag = { id: b.dataset.id, el: b, ox: e.clientX - r.left, oy: e.clientY - r.top }; b.classList.add('drag'); b.setPointerCapture(e.pointerId); });
  stg.addEventListener('pointermove', e => {
    if (!hbDrag) return;
    const st = stg.getBoundingClientRect(), b = hbDrag.el;
    let x = e.clientX - st.left - hbDrag.ox, y = e.clientY - st.top - hbDrag.oy;
    const w = b.offsetWidth, h = b.offsetHeight, sn = 6;
    x = Math.max(0, Math.min(st.width - w, x)); y = Math.max(0, Math.min(st.height - h, y));
    if (Math.abs(x + w / 2 - st.width / 2) < sn) x = st.width / 2 - w / 2;
    if (Math.abs(y + h / 2 - st.height / 2) < sn) y = st.height / 2 - h / 2;
    b.style.left = x + 'px'; b.style.top = y + 'px'; hbDrag.x = x / st.width; hbDrag.y = y / st.height;
  });
  stg.addEventListener('pointerup', () => { if (!hbDrag) return; hbDrag.el.classList.remove('drag'); if (hbDrag.x !== undefined) { const c = ocfg(hbDrag.id); c.x = +hbDrag.x.toFixed(4); c.y = +hbDrag.y.toFixed(4); oSave(); } hbDrag = null; });
  stg.addEventListener('wheel', e => { const b = e.target.closest('.hb'); if (!b) return; e.preventDefault(); const id = b.dataset.id, v = Math.max(0.5, Math.min(2.5, Math.round(((+oGet(id, 'scale') || 1) + (e.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10)); oSet(id, 'scale', fmtNum(v)); renderStage(); }, { passive: false });
  stg.addEventListener('dblclick', e => { const b = e.target.closest('.hb'); if (!b) return; const c = ocfg(b.dataset.id); delete c.x; delete c.y; oSave(); renderStage(); });
}
window.hudAuto = () => { Object.values(S.orbit.cfg.modules || {}).forEach(c => { delete c.x; delete c.y; }); oSave(); renderStage(); };
window.addEventListener('resize', () => { if (S.page === 'inst' && S.itab === 'orbit') renderStage(); moveInd(); });

/* ======================= BOOT ======================= */
async function boot() {
  const t0 = performance.now();
  let init;
  try { init = await api('init'); } catch (e) { fail('Start fehlgeschlagen', e); init = { settings: {}, instances: [], accounts: [] }; }
  S.settings = init.settings || {}; S.instances = init.instances || []; S.accounts = init.accounts || []; S.active = init.active; S.version = init.version || S.version; S.root = init.root || '';
  (init.running || []).forEach(id => S.running.add(id));
  applyTheme(S.settings.accent || 'ember');
  accountUI(); runUI();
  api('orbit.info').then(r => { S.orbitInfo = r; S.orbitSupported = r.supported; }).catch(() => { });
  ensureVersions().catch(() => { });
  const q = new URLSearchParams(location.search);
  const args = {}; ['id', 'tab', 'target', 'type'].forEach(k => { if (q.get(k)) args[k] = q.get(k); });
  go(q.get('page') || 'home', args);
  if (!S.accounts.length && (S.settings.firstRun || q.has('gate'))) { gate(true); if (S.settings.firstRun) setS('firstRun', false); }
  requestAnimationFrame(moveInd);
  if (!HOST && q.get('run')) setTimeout(() => (0, eval)(q.get('run')), 400);
  if (q.has('shot')) $('#splash').remove(); else setTimeout(() => $('#splash').classList.add('out'), Math.max(0, 700 - (performance.now() - t0)));
}

/* ======================= MOCK BACKEND (browser preview) ======================= */
const H = 3600e3, DAY = 86400e3, iso = ms => new Date(Date.now() - ms).toISOString();
const Mock = {
  settings: { accent: 'ember', ramMb: 4096, onLaunch: 'minimize', clientId: '', firstRun: false, orbitPacks: 'perf,shaders,qol' },
  accounts: [{ uuid: '4a6f9e2c1b7d4e8f9a0b1c2d3e4f5a6b', name: 'Ky3ls', skin: null }],
  instances: [
    { id: 'orbit-client-26-3', name: 'Orbit Client 26.3', mcVersion: '26.3', loader: 'fabric', loaderVersion: '0.20.1', kind: 'orbit', icon: 'orbit', ramMb: 3072, playSeconds: 46800, lastPlayed: iso(H), created: iso(DAY * 20), mods: 19, group: 'PvP', content: [] },
    { id: 'fabulously-optimized', name: 'Fabulously Optimized', mcVersion: '1.21.11', loader: 'fabric', loaderVersion: '0.18.4', kind: 'modpack', icon: 'box', iconUrl: null, mpSlug: 'fabulously-optimized', ramMb: 4096, playSeconds: 72000, lastPlayed: iso(DAY), created: iso(DAY * 30), mods: 49, content: [] },
    { id: 'survival-1-21-11', name: 'Survival mit Freunden', mcVersion: '1.21.11', loader: 'vanilla', kind: 'custom', icon: 'grass', ramMb: 0, playSeconds: 210000, lastPlayed: iso(DAY * 2), created: iso(DAY * 90), mods: 0, group: 'Survival', content: [] },
    { id: 'technik-abenteuer', name: 'Technik-Abenteuer', mcVersion: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.266', kind: 'custom', icon: 'ruby', ramMb: 8192, playSeconds: 92000, lastPlayed: iso(DAY * 5), created: iso(DAY * 60), mods: 214, group: 'Survival', content: [] },
    { id: 'pvp-1-8-9', name: 'PvP 1.8.9', mcVersion: '1.8.9', loader: 'vanilla', kind: 'custom', icon: 'diamond', ramMb: 2048, playSeconds: 12000, lastPlayed: iso(DAY * 12), created: iso(DAY * 120), mods: 0, group: 'PvP', content: [] },
    { id: 'beta-nostalgie', name: 'Beta-Nostalgie', mcVersion: 'b1.7.3', loader: 'vanilla', kind: 'custom', icon: 'sand', ramMb: 1024, playSeconds: 5400, lastPlayed: iso(DAY * 40), created: iso(DAY * 200), mods: 0, content: [] },
  ],
  mods: { 'orbit-client-26-3': ['fabric-api', 'modmenu', 'sodium', 'lithium', 'iris', 'ferrite-core', 'entityculling', 'immediatelyfast', 'dynamic-fps', 'appleskin', 'mouse-tweaks', 'no-chat-reports'], 'fabulously-optimized': ['sodium', 'lithium', 'iris', 'continuity', 'entityculling', 'ferrite-core', 'zoomify', 'modmenu', 'fabric-api', 'yacl', 'cloth-config', 'lambdynamiclights'], 'technik-abenteuer': ['create', 'jei', 'jade', 'sophisticated-backpacks', 'waystones', 'appleskin'] },
  versions: null,
  async projs(slugs) {
    try { const r = await (await fetch('https://api.modrinth.com/v2/projects?ids=' + encodeURIComponent(JSON.stringify(slugs)))).json(); return r; } catch { return []; }
  },
  async call(cmd, a) {
    await sleep(50); const M = this;
    const inst = () => M.instances.find(x => x.id === a.id);
    switch (cmd) {
      case 'init': {
        if (/gate|noid/.test(location.search)) M.accounts = [];
        if (!M.fo) { M.fo = 1; try { const p = await (await fetch('https://api.modrinth.com/v2/project/fabulously-optimized')).json(); M.instances[1].iconUrl = p.icon_url; M.instances[1].modpackProject = p.id; } catch { } }
        if (/running/.test(location.search)) setTimeout(() => onEvent('state', { id: 'orbit-client-26-3', running: true }), 400);
        return { needAppId: /noid/.test(location.search), version: '0.2.0', root: 'C:\\Users\\Ky3ls\\AppData\\Roaming\\OrbitLauncher', settings: M.settings, instances: M.instances, accounts: M.accounts, active: M.accounts[0]?.uuid, running: [] };
      }
      case 'instances.list': return M.instances;
      case 'settings.set': M.settings[a.key] = a.value; return {};
      case 'versions.list':
        if (!M.versions) {
          try { const m = await (await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).json(); M.versions = { latest: m.latest, versions: m.versions.map(v => ({ id: v.id, type: v.type, released: v.releaseTime })) }; }
          catch { M.versions = { latest: { release: '26.3', snapshot: '26.4-snapshot-8' }, versions: ['26.3', '26.2', '26.1', '1.21.11', '1.21.10', '1.21.4', '1.21.1', '1.20.6', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.9'].map((id, i) => ({ id, type: 'release', released: iso(i * DAY * 60) })) }; }
        }
        return { ...M.versions, installed: [] };
      case 'loader.versions': return a.loader === 'forge' ? [{ version: a.mc + '-60.1.4', stable: true, recommended: true }, { version: a.mc + '-60.1.3', stable: true }] : a.loader === 'neoforge' ? [{ version: '21.1.266', stable: true }, { version: '21.1.265', stable: true }] : [{ version: '0.20.1', stable: true }, { version: '0.20.0', stable: true }, { version: '0.19.2', stable: true }];
      case 'loader.games': return (await M.call('versions.list', {})).versions.filter(v => v.type === 'release').map(v => v.id).slice(0, a.loader === 'neoforge' ? 14 : 60);
      case 'instance.create': { const i = { id: a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: a.name, mcVersion: a.mc, loader: a.loader, loaderVersion: a.loaderVersion, kind: 'custom', icon: a.icon, ramMb: a.ramMb, playSeconds: 0, lastPlayed: null, created: iso(0), mods: 0, content: [] }; M.instances.unshift(i); return i; }
      case 'instance.update': Object.assign(inst(), a.patch); return inst();
      case 'instance.delete': M.instances = M.instances.filter(i => i.id !== a.id); return {};
      case 'instance.duplicate': { const c = { ...inst(), id: a.id + '-kopie', name: inst().name + ' (Kopie)', lastPlayed: null, playSeconds: 0 }; M.instances.unshift(c); return c; }
      case 'instance.repair': await sleep(800); return { ok: true };
      case 'instance.content': {
        const i = inst();
        if (a.type === 'mod') {
          const slugs = M.mods[a.id] || []; if (!slugs.length) return [];
          const ps = await M.projs(slugs);
          return slugs.map((s, k) => { const p = ps.find(x => x.slug === s); return { title: p?.title || s, file: `${s}-${i.mcVersion}.jar`, version: p ? (p.versions?.length ? `${(k % 3) + 1}.${k + 2}.${k * 3 % 10}` : '1.0') : '1.0', size: (0.3 + (k * 0.37) % 3) * 1e6, on: k !== 7, dependency: ['fabric-api', 'yacl', 'cloth-config'].includes(s), projectId: p?.id, icon: p?.icon_url }; });
        }
        if (a.type === 'shader' && i.loader === 'fabric') return [{ title: 'Complementary Reimagined', file: 'ComplementaryReimagined_r5.6.zip', on: true, size: 4.1e6, version: 'r5.6' }];
        if (a.type === 'resourcepack' && i.kind !== 'orbit') return [{ title: 'Fresh Animations', file: 'FreshAnimations_v1.10.zip', on: true, size: 2.2e6, version: '1.10' }];
        return [];
      }
      case 'content.updates': return [{ projectId: 'AANobbMI', title: 'Sodium', from: '0.8.14', to: '0.8.15' }];
      case 'content.updateAll': await sleep(600); return { count: 1 };
      case 'content.addFile': return { count: 0 };
      case 'instance.worlds': {
        const i = inst();
        if (i.loader === 'vanilla' && i.mcVersion.startsWith('b')) return { worlds: [{ folder: 'World1', name: 'World1', lastPlayed: iso(DAY * 40), mode: 'Überleben' }], servers: [] };
        return { worlds: [{ folder: 'Neue Welt', name: 'Basis am Fluss', lastPlayed: iso(H * 3), mode: 'Überleben', icon: 'data:image/svg+xml,' + encodeURIComponent(bannerSvg(true, 675)) }, { folder: 'Kreativ', name: 'Bauprojekt Burg', lastPlayed: iso(DAY * 4), mode: 'Kreativ', icon: 'data:image/svg+xml,' + encodeURIComponent(bannerSvg(false, 675)) }, { folder: 'HC', name: 'Hardcore #3', lastPlayed: iso(DAY * 16), mode: 'Hardcore' }],
          servers: [{ name: 'Hypixel', ip: 'mc.hypixel.net' }, { name: 'Freunde-Server', ip: 'freunde.example.net:25565' }] };
      }
      case 'worlds.recent': return [{ id: 'survival-1-21-11', instance: 'Survival mit Freunden', mcVersion: '1.21.11', folder: 'Neue Welt', name: 'Basis am Fluss', lastPlayed: iso(H * 3), mode: 'Überleben', icon: 'data:image/svg+xml,' + encodeURIComponent(bannerSvg(true, 675)) }, { id: 'technik-abenteuer', instance: 'Technik-Abenteuer', mcVersion: '1.21.1', folder: 'Fabrik', name: 'Create-Fabrik', lastPlayed: iso(DAY * 5), mode: 'Überleben', icon: 'data:image/svg+xml,' + encodeURIComponent(bannerSvg(false, 675)) }, { id: 'orbit-client-26-3', instance: 'Orbit Client 26.3', mcVersion: '26.3', folder: 'pvp', name: 'PvP-Training', lastPlayed: iso(H * 26), mode: 'Kreativ' }];
      case 'world.delete': return {};
      case 'instance.logs': return [{ name: 'logs/latest.log', size: 48211, date: iso(H) }, { name: 'logs/2026-11-14-2.log.gz', size: 9120, date: iso(DAY) }, { name: 'logs/2026-11-14-1.log.gz', size: 11002, date: iso(DAY + H * 4) }, { name: 'crash-reports/crash-2026-11-12_20.14.03-client.txt', size: 18200, date: iso(DAY * 3) }];
      case 'instance.log': return { text: ['[18:42:01] [main/INFO]: Loading Minecraft 26.3 with Fabric Loader 0.20.1', '[18:42:02] [main/INFO]: Loading 19 mods:', '\t- fabric-api 0.166.2+26.3', '\t- orbitclient 1.0.0', '\t- sodium 0.8.14', '[18:42:05] [Render thread/INFO]: Backend library: LWJGL version 3.4.3', '[18:42:06] [Render thread/WARN]: Shader complementary: option not found', '[18:42:09] [Render thread/INFO]: Sound engine started', '[18:55:12] [Render thread/ERROR]: Failed to load skin texture', 'java.io.IOException: connection reset', '\tat net.minecraft.client.resources.SkinManager.load(SkinManager.java:120)', '[18:58:40] [Render thread/INFO]: Stopping!'].join('\n') };
      case 'launch': {
        const id = a.id; await sleep(200);
        for (const [st, n] of [['Bibliotheken', 64], ['Assets', 120]]) for (let k = 0; k <= n; k += 8) { onEvent('progress', { task: 'l' + id, stage: st, pct: Math.round(k / n * 100), total: n, detail: `${k}/${n}` }); await sleep(25); }
        onEvent('progress', { task: 'l' + id, done: true });
        onEvent('state', { id, running: true });
        ['[OrbitLauncher] java -Xmx3072M … net.fabricmc.loader.impl.launch.knot.KnotClient', '[18:42:01] [main/INFO]: Loading Minecraft with Fabric Loader 0.20.1', '[18:42:05] [Render thread/INFO]: Backend library: LWJGL version 3.4.3', '[18:42:06] [Render thread/WARN]: Shader complementary: option not found', '[18:42:09] [Render thread/INFO]: Sound engine started'].forEach(l => onEvent('log', { id, line: l }));
        return {};
      }
      case 'stop': onEvent('state', { id: a.id, running: false, code: 0 }); return {};
      case 'news': try {
        const j = await (await fetch('https://launchercontent.mojang.com/v2/javaPatchNotes.json')).json();
        return j.entries.slice(0, 6).map(e => ({ title: e.title, version: e.version, type: e.type, date: e.date, text: e.shortText, image: e.image ? 'https://launchercontent.mojang.com' + e.image.url : null }));
      } catch { return [{ title: 'Minecraft Java Edition 26.3', type: 'release', date: '2026-10-21', text: 'Das Herbst-Update ist da.' }]; }
      case 'mr.get': { const r = await fetch('https://api.modrinth.com/v2' + a.path); if (!r.ok) throw new Error('Modrinth ' + r.status); return r.json(); }
      case 'mr.install': { await sleep(900); const i = inst(); i.content = (i.content || []).concat([{ projectId: a.project, type: a.type }]); return { installed: ['Projekt'], skipped: [] }; }
      case 'mr.modpack': await sleep(800); return M.instances[1];
      case 'pack.import': return null;
      case 'orbit.info': return { supported: ['26.3'], packs: [['perf', 'FPS-Boost', 'Sodium, Lithium, FerriteCore, Entity Culling, ImmediatelyFast, Dynamic FPS', 'zap'], ['shaders', 'Shader-Support', 'Iris für Shaderpacks wie Complementary oder BSL', 'sun'], ['qol', 'Komfort', 'AppleSkin, Mouse Tweaks, BetterF3, No Chat Reports', 'sparkle'], ['visual', 'Optik', 'Dynamische Lichter, Connected Textures, 3D-Skin-Layer', 'layers']].map(([id, name, desc, icon]) => ({ id, name, desc, icon })) };
      case 'orbit.create': await sleep(900); return { id: 'orbit-client-26-3', installed: ['Orbit Client', 'Sodium', 'Iris'], skipped: [] };
      case 'orbit.config.get': return M.ocfg || (M.ocfg = { accent: '#FF7A3D', modules: { crosshair: { enabled: true, opts: { style: 'Plus+Punkt', ccolor: 'Akzent' } }, fullbright: { enabled: true }, clock: { enabled: true } } });
      case 'orbit.config.set': M.ocfg = JSON.parse(JSON.stringify(a.config)); return {};
      case 'java.list': return [{ path: 'C:\\Users\\Ky3ls\\AppData\\Roaming\\OrbitLauncher\\runtime\\java-runtime-epsilon\\bin\\javaw.exe', major: 25, source: 'Mojang' }, { path: 'C:\\Users\\Ky3ls\\AppData\\Roaming\\OrbitLauncher\\runtime\\java-runtime-delta\\bin\\javaw.exe', major: 21, source: 'Mojang' }, { path: 'C:\\Users\\Ky3ls\\AppData\\Roaming\\OrbitLauncher\\runtime\\jre-legacy\\bin\\javaw.exe', major: 8, source: 'Mojang' }];
      case 'java.pick': return null;
      case 'storage.info': return [['instances', 14.2e9], ['versions', 1.1e9], ['libraries', 2.4e9], ['assets', 1.9e9], ['runtime', 0.9e9], ['cache', 0.21e9]].map(([name, size]) => ({ name, size }));
      case 'cache.clear': return {};
      case 'skins.list': return M.skins || (M.skins = [['Orbit', 0, 'classic'], ['Waldläufer', 1, 'classic'], ['Lila Hoodie', 2, 'slim'], ['Rotes Trikot', 3, 'classic']].map(([name, n, variant]) => ({ id: 's' + n, name, variant, url: demoSkin(n), added: iso(n * DAY) })));
      case 'skins.add': if (a.url) { const e = { id: 's' + Date.now(), name: a.name, variant: a.variant, url: a.url }; M.skins.unshift(e); return e; } return null;
      case 'skins.update': { const e = M.skins.find(x => x.id === a.id); if (a.name) e.name = a.name; if (a.variant) e.variant = a.variant; return {}; }
      case 'skins.remove': M.skins = M.skins.filter(x => x.id !== a.id); return {};
      case 'skin.profile': return M.prof || (M.prof = { id: M.accounts[0]?.uuid, name: 'Ky3ls', skins: [{ id: 'cur', state: 'ACTIVE', url: demoSkin(0), variant: 'CLASSIC' }], capes: [] });
      case 'skin.apply': { await sleep(700); const e = M.skins.find(x => x.id === a.id); M.prof.skins = [{ id: 'cur', state: 'ACTIVE', url: e.url, variant: a.variant === 'slim' ? 'SLIM' : 'CLASSIC' }]; return M.prof; }
      case 'skin.cape': return M.prof;
      case 'auth.appid': M.appid = a.id; return { ok: true };
      case 'auth.login': if (/noid/.test(location.search) && !M.appid) throw new Error('NO_APP_ID'); await sleep(900); M.accounts = [{ uuid: '4a6f9e2c1b7d4e8f9a0b1c2d3e4f5a6b', name: 'Ky3ls', skin: null }]; return { account: M.accounts[0], accounts: M.accounts, active: M.accounts[0].uuid };
      case 'auth.select': return { accounts: M.accounts, active: a.uuid };
      case 'auth.remove': M.accounts = M.accounts.filter(x => x.uuid !== a.uuid); return { accounts: M.accounts, active: M.accounts[0]?.uuid };
      default: return {};
    }
  }
};

boot();
