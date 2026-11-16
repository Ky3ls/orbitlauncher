'use strict';
/* OrbitLauncher – frontend. Talks to the C# host via WebView2 postMessage ({id,cmd,args} → {id,ok,data}, events via {event,data});
   in a normal browser a mock backend (bottom of this file) supplies demo data and live Mojang/catalog data. */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsq = s => esc(String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
const ico = (id, cls = 'i') => `<svg class="${cls}"><use href="#${id}"/></svg>`;
const bytes = b => { if (b == null || b < 0) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return (i ? b.toFixed(1).replace('.', ',') : b) + ' ' + u[i]; };
const plain = s => String(s ?? '').replace(/§./g, '').replace(/ {2,}/g, ' ').trim();
const contentName = x => {
  const file = plain(x.file);
  const stem = file.replace(/\.disabled$/i, '').replace(/\.(zip|jar)$/i, '');
  const t = plain(x.title);
  if (!t || t.toLowerCase() === file.toLowerCase() || t.toLowerCase() === stem.toLowerCase()) return stem || file;
  return t;
};
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

/* catalog API (read-only) – through the host (proper user agent), live fetch in the browser preview */
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
  java: [], version: '0.3.0', root: '', page: 'home', args: {}, hist: [], hi: -1,
};
const LOADERS = { vanilla: ['Vanilla', 'van'], fabric: ['Fabric', 'fab'], quilt: ['Quilt', 'qui'], forge: ['Forge', 'frg'], neoforge: ['NeoForge', 'neo'] };
const LCOL = { vanilla: '#4ADE9A', fabric: '#DBB67C', quilt: '#C48CFF', forge: '#78A0FF', neoforge: '#FF8C50' };
const loaderChip = l => `<span class="chip ${LOADERS[l]?.[1] || 'm'}">${LOADERS[l]?.[0] || esc(cap(l))}</span>`;
const cap = s => String(s || '').replace(/^./, c => c.toUpperCase());
/** Orbit Client is switched off for now (no new instances, no menu entries). */
const ORBIT_ON = false;
const KIND = { custom: 'Eigene', modpack: 'Modpack', orbit: 'Orbit Client' };

/* ======================= THEMES ======================= */
const THEMES = {
  ember: ['Ember', '#FF7A3D', '#FFB067'], gold: ['Gold', '#F5B53D', '#FFE08A'], lime: ['Lime', '#9BDB24', '#D9F99D'], forest: ['Wald', '#22C55E', '#86EFAC'],
  mint: ['Mint', '#2DD4A0', '#9AF2D4'], teal: ['Teal', '#14B8A6', '#5EEAD4'], aqua: ['Aqua', '#22D3EE', '#A5F3FC'], sky: ['Himmel', '#38BDF8', '#BAE6FD'],
  ocean: ['Ozean', '#3D7BFF', '#93B8FF'], indigo: ['Indigo', '#6366F1', '#A5B4FC'], violet: ['Violett', '#8B7BFF', '#C9B8FF'], grape: ['Traube', '#A855F7', '#D8B4FE'],
  magenta: ['Magenta', '#E040FB', '#F5A3FF'], rose: ['Rosé', '#FF5C8A', '#FFA3BD'], crimson: ['Rot', '#FF3B4E', '#FF8A8A'], ice: ['Eis', '#93C5FD', '#E0F2FE'],
  sand: ['Sand', '#D6BC8C', '#F1E3C6'], slate: ['Schiefer', '#94A3B8', '#CBD5E1'], mono: ['Weiß', '#E8E8EC', '#A8A8B3'], cherry: ['Kirsche', '#E11D74', '#F9A8D4'],
};
const MODES = [['dark', 'Dunkel', 'Standard'], ['oled', 'OLED', 'Echtes Schwarz'], ['light', 'Hell', 'Weißer Hintergrund']];
function applyMode(m) { document.documentElement.dataset.mode = MODES.some(x => x[0] === m) ? m : 'dark'; }
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)).join(',');
function applyTheme(k) {
  const t = THEMES[k] || THEMES.ember, r = document.documentElement.style;
  r.setProperty('--a', t[1]); r.setProperty('--b', t[2]);
  r.setProperty('--a-rgb', hexRgb(t[1])); r.setProperty('--b-rgb', hexRgb(t[2]));
  // dark text on light accents (gold, lime, ice, mono …), white on the strong ones
  const [R, G, B] = t[1].match(/\w\w/g).map(h => parseInt(h, 16)); r.setProperty('--on', (R * 299 + G * 587 + B * 114) / 1000 > 150 ? '#141416' : '#FFFFFF');
  if (typeof FX !== 'undefined') { FX.acc = hexRgb(t[1]); FX.spr = {}; }
}

/* ======================= BLOCK ICONS (original, generic) ======================= */
// [top, left side, right side, pattern, detail colour] – drawn as original pixel art on an isometric cube
const BLOCKS = {
  grass: ['#6DBE45', '#8A5A35', '#6E4529', 'grass'], dirt: ['#9B6B43', '#86593A', '#6E4529', 'spots', '#5E3B22'],
  mycelium: ['#8E7A98', '#8A5A35', '#6E4529', 'grass'], podzol: ['#6B4A26', '#8A5A35', '#6E4529', 'grass'],
  stone: ['#9A9A9F', '#7C7C82', '#636369', 'spots', '#55555b'], cobble: ['#8E8E93', '#77777C', '#5F5F64', 'cobble', '#4a4a4f'],
  mossy: ['#7C9A55', '#6F7670', '#585e5a', 'cobble', '#6C9A44'], deepslate: ['#4E4E55', '#404046', '#323238', 'stripes', '#2a2a30'],
  sand: ['#E8D9A0', '#D2C07E', '#B9A866', 'spots', '#c9b678'], gravel: ['#9A938E', '#837C77', '#6B6560', 'spots', '#5a524c'],
  wood: ['#C79A5B', '#9C6E3A', '#7F582C', 'planks', '#6f4c22'], log: ['#C9A46A', '#6B4F2F', '#5A4127', 'log', '#8a6a3c'],
  birch: ['#E6D7A8', '#E8E4DA', '#CFCAC0', 'birch', '#3a3a3a'], bricks: ['#B5543F', '#9A4535', '#7E382B', 'bricks', '#d9c7b5'],
  tnt: ['#D9473A', '#C23A2F', '#A32F26', 'tnt', '#EDE6D6'], bookshelf: ['#C49A5C', '#7A5531', '#644427', 'books', '#B23A3A'],
  crafting: ['#B07A44', '#9C6E3A', '#7F582C', 'craft', '#5a3e20'], furnace: ['#8E8E93', '#6A6A70', '#55555A', 'furnace', '#26262a'],
  pumpkin: ['#E8902E', '#D47A1E', '#B86615', 'pumpkin', '#2b1d08'], melon: ['#9BC23A', '#6E9A22', '#5A8019', 'stripes', '#C9E06A'],
  cactus: ['#5BA83A', '#3F8A28', '#2F6E1E', 'stripes', '#8FD46A'], hay: ['#D9B53A', '#C49E2A', '#A8851F', 'stripes', '#8a6a12'],
  coalore: ['#8E8E93', '#77777C', '#5F5F64', 'ore', '#1E1E22'], ironore: ['#8E8E93', '#77777C', '#5F5F64', 'ore', '#E8C4A8'],
  goldore: ['#8E8E93', '#77777C', '#5F5F64', 'ore', '#FFD447'], diamondore: ['#8E8E93', '#77777C', '#5F5F64', 'ore', '#5FF3E6'],
  emeraldore: ['#8E8E93', '#77777C', '#5F5F64', 'ore', '#3BE07A'], redstoneore: ['#8E8E93', '#77777C', '#5F5F64', 'ore', '#FF3030'],
  lapisore: ['#8E8E93', '#77777C', '#5F5F64', 'ore', '#3D63E0'], diamond: ['#7FF3E8', '#3CC9C0', '#2A9E97', 'shine'],
  gold: ['#FFE36B', '#E8C341', '#C9A52E', 'shine'], emerald: ['#4BE58A', '#2EBE6A', '#219A54', 'shine'],
  lapis: ['#4B72E8', '#3557C4', '#28449E', 'shine'], iron: ['#F0F0F0', '#D4D4D4', '#B4B4B4', 'shine'],
  copper: ['#E08A5E', '#C06F46', '#9E5837', 'shine'], netherite: ['#4A4448', '#3A3538', '#2C282B', 'shine'],
  ruby: ['#FF6B6B', '#D94444', '#B03030', 'shine'], amethyst: ['#B98CFF', '#8E5FE0', '#6F45B8', 'shine'],
  quartz: ['#EFE9E1', '#D9D1C6', '#C2B9AC', 'shine'], obsidian: ['#3A2A55', '#2A1E40', '#1E1530', 'spots', '#6B4FA0'],
  nether: ['#B5463F', '#8E3530', '#6E2622', 'spots', '#6a1f1b'], glowstone: ['#F8D27A', '#E0B35A', '#C49640', 'glow', '#FFF6CF'],
  sculk: ['#0E3A47', '#0A2A35', '#071F28', 'glow', '#3DE0E8'], prismarine: ['#6CC2B0', '#4FA392', '#3D8676', 'spots', '#9BE3D3'],
  purpur: ['#B98AC9', '#9A6DAA', '#7E558C', 'bricks', '#d6b3e2'], end: ['#EDEBB5', '#C9C68C', '#A9A66D', 'spots', '#b9b67a'],
  snow: ['#F4F8FF', '#C9D6E6', '#AEBDD1', 'spots', '#e2eaf5'], ice: ['#A8D4FF', '#8BBDF0', '#6FA3DB', 'shine'],
  slime: ['#8BE07A', '#6CC25B', '#55A346', 'shine'], honey: ['#F5B63A', '#DE9A22', '#C08218', 'shine'],
  sponge: ['#D9CF4E', '#C2B83E', '#A69D31', 'spots', '#a59a2a'], wool: ['#F2F2F2', '#D8D8D8', '#BDBDBD', 'spots', '#cfcfcf'],
};
const BLOCK_NAMES = { grass: 'Gras', dirt: 'Erde', mycelium: 'Myzel', podzol: 'Podsol', stone: 'Stein', cobble: 'Bruchstein', mossy: 'Moosstein', deepslate: 'Tiefenschiefer', sand: 'Sand', gravel: 'Kies', wood: 'Bretter', log: 'Stamm', birch: 'Birke', bricks: 'Ziegel', tnt: 'TNT', bookshelf: 'Bücherregal', crafting: 'Werkbank', furnace: 'Ofen', pumpkin: 'Kürbis', melon: 'Melone', cactus: 'Kaktus', hay: 'Heu', coalore: 'Kohleerz', ironore: 'Eisenerz', goldore: 'Golderz', diamondore: 'Diamanterz', emeraldore: 'Smaragderz', redstoneore: 'Redstone-Erz', lapisore: 'Lapiserz', diamond: 'Diamant', gold: 'Gold', emerald: 'Smaragd', lapis: 'Lapis', iron: 'Eisen', copper: 'Kupfer', netherite: 'Netherit', ruby: 'Rubin', amethyst: 'Amethyst', quartz: 'Quarz', obsidian: 'Obsidian', nether: 'Netherrack', glowstone: 'Leuchtstein', sculk: 'Sculk', prismarine: 'Prismarin', purpur: 'Purpur', end: 'Endstein', snow: 'Schnee', ice: 'Eis', slime: 'Schleim', honey: 'Honig', sponge: 'Schwamm', wool: 'Wolle' };
// tiny deterministic random so every block always looks the same
const seedRand = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; };
function blockFace(kind, face, x, key) {
  const r = seedRand(key + face), px = (a, b, w = 1, h = 1, c = x, o = 1) => `<rect x="${a}" y="${b}" width="${w}" height="${h}" fill="${c}" opacity="${o}"/>`;
  let s = '';
  const spots = (n, c, o = .8) => { for (let i = 0; i < n; i++) s += px(Math.floor(r() * 15), Math.floor(r() * 15), 1 + (r() > .7), 1, c, o); };
  switch (kind) {
    case 'grass':
      if (face === 'top') spots(14, '#000', .12);
      else { s += px(0, 0, 16, 3, null); s = s.replace('fill="null"', `fill="var(--gt)"`); for (let i = 0; i < 16; i++) if (r() > .45) s += `<rect x="${i}" y="3" width="1" height="${1 + Math.floor(r() * 3)}" fill="var(--gt)"/>`; spots(6, '#000', .18); }
      break;
    case 'spots': spots(face === 'top' ? 12 : 10, x, .9); break;
    case 'ore': spots(6, '#000', .15); for (let i = 0; i < 4; i++) { const a = 1 + Math.floor(r() * 12), b = 1 + Math.floor(r() * 12); s += px(a, b, 2, 2) + px(a + 1, b + 2, 1, 1) + px(a + 2, b + 1, 1, 1, '#fff', .5); } break;
    case 'cobble': for (let i = 0; i < 7; i++) { const a = Math.floor(r() * 13), b = Math.floor(r() * 13); s += px(a, b, 3 + Math.floor(r() * 2), 1) + px(a, b, 1, 3); } spots(5, x, .9); break;
    case 'planks': [4, 8, 12].forEach(y => s += px(0, y, 16, 1)); [[5, 0], [11, 4], [3, 8], [9, 12]].forEach(([a, b]) => s += px(a, b, 1, 4)); break;
    case 'log': if (face === 'top') { s += px(2, 2, 12, 12, x) + px(4, 4, 8, 8, null).replace('fill="null"', 'fill="var(--t)"') + px(6, 6, 4, 4, x); } else for (let i = 0; i < 16; i += 3) s += px(i, 0, 1, 16, '#000', .2) + px(i + 1, Math.floor(r() * 12), 1, 4, x, .8); break;
    case 'birch': if (face === 'top') s += px(3, 3, 10, 10, '#C9B27A'); else for (let i = 0; i < 6; i++) s += px(Math.floor(r() * 13), Math.floor(r() * 15), 2 + Math.floor(r() * 2), 1); break;
    case 'bricks': for (let y = 0; y < 16; y += 4) { s += px(0, y, 16, 1); const off = (y / 4) % 2 ? 0 : 4; for (let xx = off; xx < 16; xx += 8) s += px(xx, y, 1, 4); } break;
    case 'tnt': if (face === 'top') s += px(4, 4, 8, 8, '#000', .5) + px(7, 7, 2, 2, '#fff', .6); else s += px(0, 5, 16, 6) + px(3, 7, 3, 1, '#222') + px(4, 7, 1, 3, '#222') + px(7, 7, 1, 3, '#222') + px(8, 7, 1, 1, '#222') + px(9, 8, 1, 2, '#222') + px(11, 7, 3, 1, '#222') + px(12, 7, 1, 3, '#222'); break;
    case 'books': if (face !== 'top') { s += px(0, 0, 16, 2, '#C49A5C') + px(0, 7, 16, 2, '#C49A5C') + px(0, 14, 16, 2, '#C49A5C'); const cols = ['#B23A3A', '#3A6BB2', '#3AA05A', '#C9A13A', '#7A3AB2', '#B26A3A']; for (let i = 0; i < 6; i++) s += px(1 + i * 2.5, 2, 2, 5, cols[i]) + px(1 + i * 2.5, 9, 2, 5, cols[(i + 3) % 6]); } break;
    case 'craft': if (face === 'top') { s += px(1, 1, 14, 14, x, .5); [5, 10].forEach(v => s += px(v, 1, 1, 14, '#000', .3) + px(1, v, 14, 1, '#000', .3)); } else s += px(0, 0, 16, 3, '#C49A5C') + px(3, 6, 2, 6, '#888') + px(2, 5, 4, 2, '#aaa') + px(10, 6, 1, 7, '#7a5a2e') + px(9, 5, 4, 2, '#888'); break;
    case 'furnace': if (face === 'left') s += px(4, 8, 8, 6, x) + px(5, 11, 6, 2, '#FF8A2A') + px(6, 10, 4, 1, '#FFD447') + px(3, 3, 10, 2, '#000', .25); else spots(8, '#000', .2); break;
    case 'pumpkin': if (face === 'top') s += px(7, 7, 2, 2, '#3F8A28'); else { for (let i = 1; i < 16; i += 3) s += px(i, 0, 1, 16, '#000', .18); if (face === 'left') s += px(3, 5, 3, 3) + px(10, 5, 3, 3) + px(3, 10, 10, 2) + px(5, 12, 2, 1) + px(9, 12, 2, 1); } break;
    case 'stripes': for (let i = 1; i < 16; i += 3) s += px(i, 0, 1, 16, x, .9); if (face === 'top') s += px(5, 5, 6, 6, '#000', .12); break;
    case 'shine': s += px(0, 0, 16, 1, '#fff', .35) + px(0, 0, 1, 16, '#fff', .3) + px(2, 2, 3, 1, '#fff', .5) + px(2, 2, 1, 3, '#fff', .5) + px(10, 11, 3, 1, '#000', .15) + px(15, 0, 1, 16, '#000', .15); break;
    case 'glow': spots(4, '#000', .2); for (let i = 0; i < 7; i++) s += px(Math.floor(r() * 14), Math.floor(r() * 14), 2, 2, x, .95); break;
  }
  return s;
}
function blockSvg(key) {
  if (key === 'orbit') return `<svg viewBox="0 0 64 64"><path d="M32 13 49 22.5 32 32 15 22.5Z" fill="url(#rg)"/><path d="M15 22.5 32 32v19L15 41.5Z" fill="var(--a)" opacity=".55"/><path d="M49 22.5 32 32v19l17-9.5Z" fill="var(--b)" opacity=".8"/><ellipse cx="32" cy="32" rx="30" ry="10" fill="none" stroke="url(#rg)" stroke-width="3.2" transform="rotate(-28 32 32)"/><circle cx="54" cy="12" r="4" fill="#fff"/></svg>`;
  if (key === 'box') key = 'wood';
  if (!BLOCKS[key]) key = 'grass';
  const [t, l, r, kind, x] = BLOCKS[key];
  const M = { top: 'matrix(1.5 -.8125 1.5 .8125 8 21)', left: 'matrix(1.5 .8125 0 1.5 8 21)', right: 'matrix(1.5 -.8125 0 1.5 32 34)' };
  const face = (f, c) => `<g transform="${M[f]}"><rect width="16" height="16" fill="${c}"/>${blockFace(kind, f, x, key)}</g>`;
  return `<svg viewBox="0 0 64 64" style="--gt:${t};--t:${t}" shape-rendering="crispEdges">${face('top', t)}${face('left', l)}${face('right', r)}
    <path d="M8 21 32 34 56 21" fill="none" stroke="rgba(255,255,255,.18)" stroke-width=".8"/><path d="M32 34v24" stroke="rgba(0,0,0,.25)" stroke-width=".8"/></svg>`;
}
// own simple loader marks (not the projects' logos)
function ldIcon(k) {
  const c = LCOL[k] || '#888';
  const svg = {
    vanilla: blockSvg('grass'),
    fabric: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" fill="${c}" opacity=".18"/><path d="M5 15 15 5M9 19 19 9M5 9l4-4M15 19l4-4" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/><path d="M5 5h14v14H5z" fill="none" stroke="${c}" stroke-width="1.2" stroke-dasharray="2 2" opacity=".8"/></svg>`,
    quilt: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2" fill="${c}"/><rect x="13" y="3" width="8" height="8" rx="2" fill="${c}" opacity=".55"/><rect x="3" y="13" width="8" height="8" rx="2" fill="${c}" opacity=".55"/><rect x="13.5" y="13.5" width="7" height="7" rx="2" fill="none" stroke="${c}" stroke-width="1.6" stroke-dasharray="1.6 1.4" transform="rotate(12 17 17)"/></svg>`,
    forge: `<svg viewBox="0 0 24 24"><path d="M2 7h14c0 3 2 4 5 4v2h-6l2 4H7l2-4H6C4 13 2 11 2 7Z" fill="${c}"/><path d="M6 19h12v2H6z" fill="${c}" opacity=".7"/></svg>`,
    neoforge: `<svg viewBox="0 0 24 24"><path d="M2 9h12c0 2.6 1.8 3.6 4.5 3.6v1.8h-5l1.6 3.4H6.6l1.6-3.4H5.6C3.6 14.4 2 12.8 2 9Z" fill="${c}"/><path d="M5 19.5h11v1.8H5z" fill="${c}" opacity=".7"/><path d="m19 2 .9 2.3L22 5l-2.1.8L19 8l-.9-2.2L16 5l2.1-.7Z" fill="${c}"/></svg>`,
  }[k] || '';
  return `<span class="ldi ${k}">${svg}</span>`;
}
const instIcon = (i, cls = 'iic') => i?.iconUrl ? `<span class="${cls} img"><img src="${esc(i.iconUrl)}" alt="" loading="lazy"></span>` : `<span class="${cls}">${blockSvg(i?.icon || 'grass')}</span>`;
// projects without screenshots: blurred icon in the project colour instead of an empty area
const coverFb = h => { const c = typeof h.color === 'number' ? '#' + h.color.toString(16).padStart(6, '0') : ''; return `<i class="cfb" style="${c ? `--c:${c};` : ''}${h.icon_url ? `background-image:url('${esc(h.icon_url)}')` : ''}"></i>`; };
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
function toast(title, text = '', ok = true, action = null) {
  const key = (ok ? '1' : '0') + title + '\u0000' + text, box = $('#toasts');
  const close = t => { if (t._gone) return; t._gone = true; clearTimeout(t._tm); t.classList.add('out'); setTimeout(() => t.remove(), 250); };
  const arm = t => { clearTimeout(t._tm); t._tm = setTimeout(() => close(t), action ? 6000 : ok ? 3600 : 6500); };
  // the same message again: count it on the existing one instead of stacking
  const same = [...box.children].find(t => t._key === key && !t._gone);
  if (same) {
    same._n = (same._n || 1) + 1;
    let c = same.querySelector('.tn'); if (!c) { c = document.createElement('em'); c.className = 'tn'; same.append(c); }
    c.textContent = '×' + same._n; same.classList.remove('bump'); void same.offsetWidth; same.classList.add('bump'); arm(same); return same;
  }
  const t = document.createElement('div');
  t._key = key;
  t.className = 'toast' + (ok ? '' : ' err');
  t.innerHTML = `<div class="ti">${ico(ok ? 'check' : 'alert')}</div><div class="tx"><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}</div>${action ? `<button class="ta">${esc(action[0])}</button>` : ''}<button class="tx-x" title="Schließen">${ico('x')}</button>`;
  if (action) t.querySelector('.ta').onclick = () => { close(t); action[1](); };
  t.querySelector('.tx-x').onclick = () => close(t);
  box.append(t);
  const live = [...box.children].filter(x => !x._gone);
  if (live.length > 4) close(live[0]);
  arm(t);
  return t;
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
    if (!d.running && !S.running.size && S.upd?.available && S.settings.autoInstall) installUpdate(true);
  }
  if (ev === 'instances') { S.instances = d; instancesChanged(); }
  if (ev === 'orbitcfg') orbitCfgEvent(d);
  if (ev === 'update') updProgress(d);
  if (ev === 'cloud') cloudEvent(d);
  if (ev === 'settings') { S.settings = d; applyTheme(d.accent || 'ember'); applyMode(d.mode); fxSet(d.fx); }
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
  $('#saccSub').textContent = a ? 'Microsoft-Konto' : '';
  $('#sacc').classList.toggle('out', !a);
}
function accountPop(e) {
  e.stopPropagation();
  if (!$('#pop').classList.contains('hidden')) return closePop();
  const oc = S.cloud || {};
  const html = `<div class="popsec">Orbit-Konto</div>` + (oc.loggedIn ? `<button onclick="closePop();go('settings',{tab:'cloud'})"><span class="head orb">${blockSvg('orbit')}</span><span class="tx"><b>${esc(oc.name)}</b><small>${oc.lastSync ? 'Synchronisiert ' + esc(ago(oc.lastSync).toLowerCase()) : 'Cloud-Sync aktiv'}</small></span>${ico('cloud')}</button>`
    : `<button onclick="closePop();orbitLogin(false)"><span class="head orb">${blockSvg('orbit')}</span><span class="tx"><b>Bei Orbit anmelden</b><small>Instanzen auf jedem PC</small></span></button>`) + `<hr><div class="popsec">Minecraft</div>` + (S.accounts.length ? S.accounts.map(a => `<button class="${a.uuid === S.active ? 'on' : ''}" onclick="selectAccount('${jsq(a.uuid)}')">${headHtml(a)}<span class="tx"><b>${esc(a.name)}</b><small>${a.uuid === S.active ? 'Aktiv' : 'Wechseln'}</small></span>${a.uuid === S.active ? ico('check') : ''}</button>`).join('') + '<hr>' : '')
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
async function login(device) {
  $('#gateErr').textContent = '';
  const b = $('.g-ms'); b?.classList.add('busy');
  try {
    let r = device ? await deviceLogin() : await api('auth.login');
    if (r?.fallback === 'device') r = await deviceLogin();
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
/* sign-in in the normal browser with a short code (Microsoft device code flow) */
async function deviceLogin() {
  let dc;
  try { dc = await api('auth.start'); } catch (e) { fail('Anmeldung', e); return null; }
  return new Promise(res => {
    S.modalClose = () => { api('auth.cancel'); res(null); };
    modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button><div class="kicker">Mit Microsoft anmelden</div><h1>Im Browser anmelden</h1>
      <p>Öffne die Microsoft-Seite, gib diesen Code ein und melde dich an. OrbitLauncher merkt es automatisch.</p>
      <div class="code"><b>${esc(dc.userCode)}</b></div>
      <div class="act"><button class="btn p" id="dcGo">${ico('ext')}Code kopieren &amp; Seite öffnen</button></div>
      <div class="wait">${ico('refresh', 'i spin')}Warte auf die Anmeldung…</div>`);
    $('#dcGo').onclick = () => { navigator.clipboard?.writeText(dc.userCode); openUrl(dc.verificationUri); };
    api('auth.finish').then(r => { S.modalClose = null; closeModal(); res(r); }).catch(e => { S.modalClose = null; closeModal(); fail('Anmeldung fehlgeschlagen', e); res(null); });
  });
}
window.deviceLogin = deviceLogin;

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
  const mode = S.settings.playMode || 'auto';
  if (mode === 'official' || (mode === 'auto' && !S.accounts.length && S.needAppId)) return playOfficial(id);
  if (!S.accounts.length) return playChoice(id, extra);
  toast('Minecraft startet', `${i.name}${extra.world ? ' · Welt ' + extra.worldName : extra.server ? ' · ' + extra.server : ''}`);
  try { await api('launch', { id, ...extra }); }
  catch (e) { fail('Start fehlgeschlagen', e); }
}
window.play = play;
function instCtx(e, id) {
  const i = instById(id); if (!i) return;
  const run = S.running.has(id);
  ctxMenu(e, [[run ? 'stop' : 'play', run ? 'Beenden' : 'Spielen', () => play(id)], ['rocket', 'Im Minecraft Launcher öffnen', () => playOfficial(id)], ['plus', 'Inhalte hinzufügen', () => go('discover', { type: i.loader === 'vanilla' ? 'resourcepack' : 'mod', target: id })],
    ['eye', 'Anzeigen', () => go('inst', { id })], ...(i.modpackProject ? [['compass', 'Modpack-Seite', () => go('project', { id: i.modpackProject })]] : []), ['settings', 'Einstellungen', () => instSettings(id)], '-',
    ['folder', 'Ordner öffnen', () => api('folder.open', { id, what: '' })], ['dup', 'Duplizieren', () => duplicateInst(id)], ['upload', 'Als Modpack exportieren', () => exportInst(id)], '-',
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
  const total = S.instances.reduce((s, i) => s + (i.playSeconds || 0), 0), mods = S.instances.reduce((s, i) => s + (i.mods || 0), 0);
  const who = acc?.name || (S.cloud?.loggedIn ? S.cloud.name : '') || S.user || '';
  const greet = (() => { const h = new Date().getHours(); return h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend'; })();
  const hcard = last ? `<div class="hcard glass">${instIcon(last)}<div class="tx"><small>Weiterspielen</small><b class="ell">${esc(last.name)}</b><small>${esc(instSub(last))} · ${esc(ago(last.lastPlayed))}</small></div>
      <button class="btn lg ${S.running.has(last.id) ? 'stop' : 'play glow'}" onclick="play('${jsq(last.id)}')">${ico(S.running.has(last.id) ? 'stop' : 'play')}${S.running.has(last.id) ? 'Beenden' : 'Spielen'}</button></div>`
    : `<div class="hcard glass"><span class="iic">${blockSvg('grass')}</span><div class="tx"><small>Los geht's</small><b>Erste Instanz</b><small>Version wählen, fertig</small></div><button class="btn lg play glow" onclick="newInstance()">${ico('plus')}Erstellen</button></div>`;
  const top = `<div class="hwel"><div><div class="kicker">${acc ? 'Angemeldet als ' + esc(acc.name) : 'OrbitLauncher'}</div><h1>${greet}${who ? ', <span class="grad">' + esc(who) + '</span>' : ''}</h1></div>
    <div class="hstats">${[[S.instances.length, 'Instanzen', 'library'], [Math.round(total / 3600), 'Stunden gespielt', 'clock'], [mods, 'Mods installiert', 'puzzle']].map(([n, l, ic]) => `<div class="hs">${ico(ic)}<b data-count="${n}">0</b><span>${l}</span></div>`).join('')}${acc ? '' : `<button class="btn p" onclick="login()">${ico('user')}Anmelden</button>`}</div></div>`;
  if (soft && el.querySelector('.hgrid')) { el.querySelector('.hwel').outerHTML = top; el.querySelector('.hcard').outerHTML = hcard; countUp(el); homeRecent(); return; }
  el.innerHTML = `${top}
    <div class="spot" id="spot"><div class="sp-slides" id="spSlides"><div class="sp-slide on"><div class="sp-bg">${bannerSvg(false, 340)}</div></div></div>
      <div class="sp-ui"><div class="sp-txt" id="spTxt"><div class="kicker">Spotlight</div><h2>Lädt Modpacks…</h2></div><div class="sp-dots" id="spDots"></div></div>${hcard}</div>
    <div class="hgrid"><div>
      <div id="hWorlds"></div><div id="hRecent"></div>
      <div class="sec"><h2>Beliebte Modpacks</h2><span class="sp"></span><button class="lnk" onclick="go('discover',{type:'modpack'})">Alle ansehen${ico('right')}</button></div><div class="prow" id="hPacks">${'<div class="skel" style="height:230px"></div>'.repeat(4)}</div>
      <div class="sec"><h2>Mods, die alle haben</h2><span class="sp"></span><button class="lnk" onclick="go('discover',{type:'mod'})">Alle ansehen${ico('right')}</button></div><div class="prow" id="hMods">${'<div class="skel" style="height:230px"></div>'.repeat(4)}</div>
      <div class="sec"><h2>Shader für bessere Optik</h2><span class="sp"></span><button class="lnk" onclick="go('discover',{type:'shader'})">Alle ansehen${ico('right')}</button></div><div class="prow" id="hShaders">${'<div class="skel" style="height:230px"></div>'.repeat(4)}</div>
    </div><div>
      ${ORBIT_ON ? '' : '<!--'}<button class="orbitcta tilt" onclick="newInstance('orbit')"><span class="oc-glow"></span><span class="iic">${blockSvg('orbit')}</span><span><b>Orbit Client</b><small>Eigener PvP-Client: Keystrokes, CPS, Zoom, Freelook, HUD-Editor und FPS-Boost in einer Instanz.</small></span>${ico('right')}</button>${ORBIT_ON ? '' : '-->'}
      <div class="sec"><h2>Minecraft-News</h2></div><div class="newsl" id="hNews">${'<div class="skel" style="height:190px"></div>'.repeat(2)}</div>
    </div></div>`;
  countUp(el);
  homeRecent();
  api('worlds.recent').then(w => {
    S.recentWorlds = w;
    if ($('#hWorlds')) $('#hWorlds').innerHTML = w?.length ? `<div class="sec"><h2>Zurück in die Welt</h2></div><div class="wgrid">${w.slice(0, 6).map(x => worldCard(x, x.id, true)).join('')}</div>` : '';
  }).catch(() => { });
  const tile = h => `<button class="ptile tilt" onclick="go('project',{id:'${jsq(h.project_id)}'})"><span class="gimg ${h.featured_gallery || h.gallery?.[0] ? '' : 'nocov'}" style="${h.featured_gallery || h.gallery?.[0] ? `background-image:url('${esc(h.featured_gallery || h.gallery[0])}')` : ''}">${h.featured_gallery || h.gallery?.[0] ? '' : coverFb(h)}${picHtml(h.icon_url)}</span>
    <span class="bd"><b>${esc(h.title)}</b><p>${esc(h.description)}</p><span class="row" style="gap:12px"><span class="stat">${ico('download')}<b>${num(h.downloads)}</b></span><span class="stat">${ico('heart')}<b>${num(h.follows)}</b></span></span></span></button>`;
  const fill = (id, path, f) => mr(path).then(r => { if ($(id)) { $(id).innerHTML = r.hits.map(tile).join(''); f?.(r.hits); } }).catch(() => { if ($(id)) $(id).innerHTML = '<div class="empty">Der Mod-Katalog ist gerade nicht erreichbar.</div>'; });
  const fac = t => encodeURIComponent(`[["project_type:${t}"]]`);
  fill('#hPacks', `/search?limit=12&index=follows&facets=${fac('modpack')}`, hits => spotlight(hits.filter(h => h.featured_gallery || h.gallery?.length).slice(0, 6)));
  fill('#hMods', `/search?limit=12&offset=${RND_OFF}&index=downloads&facets=${fac('mod')}`);
  fill('#hShaders', `/search?limit=12&index=follows&facets=${fac('shader')}`);
  (S.news ? Promise.resolve(S.news) : api('news')).then(n => {
    S.news = n;
    if ($('#hNews')) $('#hNews').innerHTML = (n || []).slice(0, 4).map(x => `<button class="nwi tilt" onclick="newsOpen('${jsq(x.id || '')}')">${x.image ? `<i style="background-image:url('${esc(x.image)}')"></i>` : ''}<div><b>${esc(x.title)}</b><small>${esc(dateDe(x.date))}</small><p>${esc(x.text || '')}</p></div></button>`).join('');
  }).catch(() => { if ($('#hNews')) $('#hNews').innerHTML = ''; });
};
function countUp(root) {
  root.querySelectorAll('[data-count]').forEach(e => {
    const n = +e.dataset.count, t0 = performance.now(), d = 900;
    const f = t => { const k = Math.min(1, (t - t0) / d), v = Math.round(n * (1 - Math.pow(1 - k, 3))); e.textContent = v.toLocaleString('de-DE'); if (k < 1) requestAnimationFrame(f); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) e.textContent = n.toLocaleString('de-DE'); else requestAnimationFrame(f);
  });
}
/* modpack spotlight: big gallery images, auto-rotating */
let spotT = 0;
function spotlight(list) {
  const sl = $('#spSlides'); if (!sl || !list.length) return;
  S.spot = { list, i: 0 };
  sl.innerHTML = list.map((h, i) => `<div class="sp-slide ${i === 0 ? 'on' : ''}"><div class="sp-bg" data-pid="${esc(h.project_id)}" style="background-image:url('${esc(h.featured_gallery || h.gallery[0])}')"></div></div>`).join('');
  $('#spDots').innerHTML = list.map((_, i) => `<button class="${i === 0 ? 'on' : ''}" data-i="${i}"><i></i></button>`).join('');
  $('#spDots').onclick = e => { const b = e.target.closest('[data-i]'); if (b) spotGo(+b.dataset.i); };
  $('#spot').onmouseenter = () => { S.spot.paused = true; };
  $('#spot').onmouseleave = () => { S.spot.paused = false; };
  spotGo(0); spotRun();
}
/* one clock drives both the progress bar and the slide change, so they never drift apart */
const SPOT_MS = 7000;
function spotRun() {
  cancelAnimationFrame(spotT);
  let last = performance.now();
  const tick = t => {
    if (S.page !== 'home' || !$('#spot') || !S.spot) return;
    const dt = Math.min(1000, t - last); last = t;
    if (!S.spot.paused && !document.hidden) S.spot.el += dt;
    const bar = $$('#spDots button')[S.spot.i]?.querySelector('i');
    if (bar) bar.style.width = Math.min(100, S.spot.el / SPOT_MS * 100) + '%';
    if (S.spot.el >= SPOT_MS) spotGo((S.spot.i + 1) % S.spot.list.length);
    spotT = requestAnimationFrame(tick);
  };
  spotT = requestAnimationFrame(tick);
}
function spotSharp(el) {
  if (!el || el.dataset.sharp) return; el.dataset.sharp = '1';
  mr('/project/' + el.dataset.pid).then(p => {
    const g = (p.gallery || []).find(x => x.featured) || (p.gallery || [])[0]; const url = g?.raw_url || g?.url;
    if (!url) return; const im = new Image(); im.onload = () => { el.style.backgroundImage = `url('${url}')`; }; im.src = url;
  }).catch(() => { });
}
function spotGo(i) {
  const h = S.spot.list[i]; S.spot.i = i;
  spotSharp($$('#spSlides .sp-bg')[i]);
  S.spot.el = 0;
  $$('#spDots button i').forEach(b => b.style.width = '0%');
  $$('#spSlides .sp-slide').forEach((s, k) => s.classList.toggle('on', k === i));
  $$('#spDots button').forEach((s, k) => s.classList.toggle('on', k === i));
  $('#spTxt').innerHTML = `<div class="sp-in"><div class="kicker">Modpack-Spotlight</div><div class="row" style="gap:14px;margin-top:8px">${picHtml(h.icon_url, 'pic sp-ic')}<div><h2>${esc(h.title)}</h2><span class="sp-by">von ${esc(h.author)}</span></div></div><p>${esc(h.description)}</p>
    <div class="row" style="gap:10px;margin-top:14px"><button class="btn p" onclick="installProject('${jsq(h.project_id)}',this)">${ico('download')}Installieren</button><button class="btn glassb" onclick="go('project',{id:'${jsq(h.project_id)}'})">Ansehen</button><span class="stat">${ico('download')}<b>${num(h.downloads)}</b></span></div></div>`;
}

/* 3D tilt + light on cards (cheap: one rAF per pointer move) */
let tiltRaf = 0, tiltEl = null;
document.addEventListener('pointermove', e => {
  const t = e.target.closest?.('.tilt,.icard');
  if (tiltEl && tiltEl !== t) { tiltEl.style.transform = ''; tiltEl.style.removeProperty('--lx'); tiltEl = null; }
  if (!t || tiltRaf || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  tiltRaf = requestAnimationFrame(() => {
    tiltRaf = 0; tiltEl = t;
    const r = t.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const k = t.classList.contains('pcard') ? 1.2 : 5;
    t.style.transform = `perspective(900px) rotateX(${(0.5 - y) * k}deg) rotateY(${(x - 0.5) * k}deg) translateY(-3px)`;
    t.style.setProperty('--lx', x * 100 + '%'); t.style.setProperty('--ly', y * 100 + '%');
  });
});
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

/* full patch notes inside the launcher (minecraft.net has no stable article links for these) */
async function newsOpen(id) {
  const x = (S.news || []).find(n => n.id === id) || {};
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button>${x.image ? `<div class="nwhead" style="background-image:url('${esc(x.image)}')"></div>` : ''}
    <div class="kicker">${esc(x.type === 'release' ? 'Release' : 'Snapshot')} · ${esc(dateDe(x.date))}</div><h2>${esc(x.title || 'Patch Notes')}</h2><div class="md nwbody" id="nwBody"><div class="spinner"></div></div>`, 'form wide news');
  try {
    const j = await (await fetch(`https://launchercontent.mojang.com/v2/javaPatchNotes/${encodeURIComponent(id)}.json`)).json();
    const b = $('#nwBody'); if (!b) return;
    b.innerHTML = sanitize((j.body || '').replace(/(src|href)="\//g, '$1="https://launchercontent.mojang.com/')); mdBind(b);
  } catch { const b = $('#nwBody'); if (b) b.innerHTML = `<p>${esc(x.text || 'Konnte die Patch Notes nicht laden.')}</p>`; }
}
window.newsOpen = newsOpen;

/* ======================= LIBRARY ======================= */
S.lib = { tab: 'all', q: '', sort: 'played', group: 'none' };
try { Object.assign(S.lib, JSON.parse(localStorage.getItem('orbit.lib') || '{}'), { q: '', group: 'none' }); } catch { }
if (!ORBIT_ON && S.lib.tab === 'orbit') S.lib.tab = 'all';
PAGES.library = el => {
  crumbs([['Bibliothek']]);
  const L = S.lib;
  el.innerHTML = `<div class="ph"><div><div class="kicker">Deine Instanzen</div><h1>Bibliothek</h1></div><div class="ph-r"><button class="btn" data-pop onclick="importMenu(event)">${ico('upload')}Importieren${ico('chevd')}</button><button class="btn p" onclick="newInstance()">${ico('plus')}Instanz erstellen</button></div></div>
    <div class="dgrid lgrid"><aside class="filters">${libStats()}</aside><div>
    <div class="lbar"><div class="seg" id="libTabs">${[['all', 'Alle'], ['modpack', 'Modpacks'], ['custom', 'Eigene'], ...(ORBIT_ON ? [['orbit', 'Orbit Client']] : [])].map(([k, n]) => `<button data-k="${k}" class="${L.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="srch">${ico('search')}<input class="in" id="libQ" placeholder="Instanzen durchsuchen…" value="${esc(L.q)}"></div><span class="sp"></span>
      <select class="sel" id="libSort">${[['played', 'Zuletzt gespielt'], ['name', 'Name'], ['created', 'Neueste zuerst'], ['time', 'Meiste Spielzeit'], ['version', 'Spielversion']].map(([k, n]) => `<option value="${k}" ${L.sort === k ? 'selected' : ''}>Sortieren: ${n}</option>`).join('')}</select></div>
    <div id="libGrid"></div></div></div>`;
  countUp(el);
  api('library.stats').then(st => { const v = [bytes(st.size), st.worlds, st.screenshots, st.shaders]; $$('#libMore b').forEach((b, k) => b.textContent = v[k] ?? '—'); }).catch(() => $$('#libMore b').forEach(b => b.textContent = '—'));
  const save = () => { try { localStorage.setItem('orbit.lib', JSON.stringify(L)); } catch { } renderLibGrid(); };
  $('#libTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; L.tab = b.dataset.k; $$('#libTabs button').forEach(x => x.classList.toggle('on', x === b)); save(); };
  $('#libQ').oninput = e => { L.q = e.target.value; renderLibGrid(); };
  $('#libSort').onchange = e => { L.sort = e.target.value; save(); };
  renderLibGrid();
};
function libStats() {
  const I = S.instances; if (!I.length) return '';
  const secs = I.reduce((t, i) => t + (i.playSeconds || 0), 0), mods = I.reduce((t, i) => t + (i.mods || 0), 0);
  const fav = [...I].sort((a, b) => (b.playSeconds || 0) - (a.playSeconds || 0))[0];
  const last = [...I].filter(i => i.lastPlayed).sort((a, b) => new Date(b.lastPlayed) - new Date(a.lastPlayed))[0];
  const packs = I.filter(i => i.kind === 'modpack').length, modded = I.filter(i => i.loader !== 'vanilla').length;
  const ld = {}; I.forEach(i => ld[i.loader] = (ld[i.loader] || 0) + 1);
  const mix = Object.entries(ld).sort((a, b) => b[1] - a[1]);
  const card = (ic, n, l, sub, click) => `<div class="lst ${click ? 'ck' : ''} ${typeof n === 'number' ? '' : 'txt'}" ${click ? `onclick="${click}"` : ''}>${ico(ic)}<div><b ${typeof n === 'number' ? `data-count="${n}"` : ''}>${typeof n === 'number' ? 0 : esc(n)}</b><span>${l}</span><small class="ell">${sub}</small></div></div>`;
  return `<div class="fbox lside"><div class="fh">${ico('activity')}Statistik</div><div class="lstats">
    ${card('library', I.length, 'Instanzen', `${packs} Modpack${packs === 1 ? '' : 's'} · ${modded} mit Mods`)}
    ${card('clock', Math.round(secs / 3600), 'Stunden gespielt', fav?.playSeconds ? 'Am meisten: ' + esc(fav.name) : 'Noch nichts gespielt', fav?.playSeconds ? `go('inst',{id:'${jsq(fav.id)}'})` : '')}
    ${card('puzzle', mods, 'Mods installiert', `Ø ${modded ? Math.round(mods / modded) : 0} pro Modded-Instanz`)}
    ${last ? card('play', last.name, 'Zuletzt gespielt', esc(ago(last.lastPlayed)) + ' · ' + esc(instSub(last)), `go('inst',{id:'${jsq(last.id)}'})`) : card('play', '—', 'Zuletzt gespielt', 'Starte eine Instanz')}
  </div></div>
  <div class="fbox lside"><div class="fh">${ico('layers')}Mod-Loader</div><div class="lmix"><div class="lmb">${mix.map(([k, n]) => `<i style="flex:${n};background:${LCOL[k] || '#888'}" title="${esc(LOADERS[k]?.[0] || k)}: ${n}"></i>`).join('')}</div>
    <div class="lml">${mix.map(([k, n]) => `<span><i style="background:${LCOL[k] || '#888'}"></i>${esc(LOADERS[k]?.[0] || k)}<b>${n}</b></span>`).join('')}</div></div></div>
  <div class="fbox lside"><div class="fh">${ico('hdd')}Speicher &amp; Inhalte</div><div class="lgrid2" id="libMore">${[['hdd', 'Belegt'], ['earth', 'Welten'], ['image', 'Screenshots'], ['sun', 'Shader']].map(([ic, l]) => `<div>${ico(ic)}<b>…</b><small>${l}</small></div>`).join('')}</div></div>
  ${(() => { const t = [...I].sort((a, b) => (b.playSeconds || 0) - (a.playSeconds || 0)).filter(i => i.playSeconds).slice(0, 3); return t.length ? `<div class="fbox lside"><div class="fh">${ico('star')}Meistgespielt</div><div class="ltop">${t.map((i, n) => `<button onclick="go('inst',{id:'${jsq(i.id)}'})"><em>${n + 1}</em>${instIcon(i)}<span class="ell"><b class="ell">${esc(i.name)}</b><small>${ptime(i.playSeconds)}</small></span></button>`).join('')}</div></div>` : ''; })()}`;
}
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
  const ghost = !q ? `<button class="icard ghost" onclick="newInstance()"><span class="gi">${ico('plus')}</span><b>Neue Instanz</b><small>Version wählen oder Modpack installieren</small></button>` : '';
  el.innerHTML = [...groups].map(([k, l], gi) => `<div class="ggrp">${k ? `<h3>${esc(k)}<i>${l.length}</i></h3>` : ''}<div class="igrid">${l.map(i => instCard(i)).join('')}${gi === groups.size - 1 ? ghost : ''}</div></div>`).join('');
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
  el.innerHTML = `<div id="iHead"></div><div class="dgrid istage"><aside class="filters" id="iSide"></aside><div id="iBody"></div></div>`;
  instHead(i);
  $('#iSide').onclick = e => {
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      if (tab.dataset.tab === S.itab) return;
      S.itab = tab.dataset.tab; S.hist[S.hi].a = { id: i.id, tab: S.itab }; instTabs(i); return;
    }
    const k = e.target.closest('[data-k]');
    if (!k || !S.content || k.dataset.k === S.content.type) return;
    S.content.type = k.dataset.k; S.content.page = 1;
    renderContent(i, i.loader === 'vanilla' ? CTYPES.slice(1) : CTYPES);
  };
  instTabs(i);
};
const hasOrbitMod = i => ORBIT_ON && i.kind === 'orbit' && i.loader === 'fabric' && (S.orbitSupported || ['26.3']).includes(i.mcVersion);
function instHead(i) {
  const run = S.running.has(i.id), el = $('#iHead'); if (!el) return;
  const loader = `${LOADERS[i.loader]?.[0] || i.loader}${i.loaderVersion ? ' ' + i.loaderVersion : ''}`;
  const cover = i.bannerUrl || '';
  el.innerHTML = `<div class="ihero"><div class="ih-bg ${cover ? 'cover' : ''}" id="iBanner" style="${cover ? `background-image:url('${esc(cover)}')` : (i.iconUrl ? `background-image:url('${esc(i.iconUrl)}')` : '')}">${cover || i.iconUrl ? '' : `<span>${blockSvg(i.icon)}</span>`}</div><div class="ihead">${instIcon(i)}<div class="tx"><div class="kicker">${KIND[i.kind] || 'Instanz'}${i.group ? ' · ' + esc(i.group) : ''}</div><h1>${esc(i.name)}</h1></div>
    <div class="acts"><button class="btn lg ${run ? 'stop' : 'play glow'}" onclick="play('${jsq(i.id)}')">${ico(run ? 'stop' : 'play')}${run ? 'Beenden' : 'Spielen'}</button>
      ${i.modpackProject ? `<button class="ib" title="Modpack-Seite" onclick="go('project',{id:'${jsq(i.modpackProject)}'})">${ico('compass')}</button>` : ''}
      <button class="ib" title="Ordner öffnen" onclick="api('folder.open',{id:'${jsq(i.id)}',what:''})">${ico('folder')}</button>
      <button class="ib" title="Einstellungen" onclick="instSettings('${jsq(i.id)}')">${ico('settings')}</button>
      <button class="ib nr" title="Mehr" onclick="instCtx(event,'${jsq(i.id)}')">${ico('more')}</button></div></div>
    <div class="istats"><div><small>Minecraft</small><b>${esc(i.mcVersion)}</b></div><div><small>Loader</small><b>${esc(loader)}</b></div><div><small>Spielzeit</small><b>${ptime(i.playSeconds)}</b></div><div><small>Zuletzt</small><b>${esc(ago(i.lastPlayed))}</b></div></div></div>`;
  instBanner(i);
  instBrand(i);
}
function instBrand(i) {
  if ((i.iconUrl && i.bannerUrl) || i._brand) return;
  i._brand = 1;
  api('instance.brand', { id: i.id }).then(r => {
    if (!r || S.page !== 'inst' || S.args.id !== i.id) return;
    if (r.iconUrl) i.iconUrl = r.iconUrl;
    if (r.bannerUrl) i.bannerUrl = r.bannerUrl;
    if (r.modpackProject) i.modpackProject = r.modpackProject;
    if (r.kind) i.kind = r.kind;
    if (r.iconUrl || r.bannerUrl || r.kind || r.modpackProject) { i._banner = 0; instHead(i); }
  }).catch(() => { });
}
function instBanner(i) {
  if (i.bannerUrl || i._banner || !i.modpackProject) return;
  i._banner = 1;
  loadProject(i.modpackProject).then(p => {
    const g = (p.gallery || []).find(x => x.featured) || p.gallery?.[0];
    const url = g?.url || g?.raw_url;
    if (!url) return;
    i.bannerUrl = url;
    const bg = $('#iBanner');
    if (bg && S.page === 'inst' && S.args.id === i.id) { bg.style.backgroundImage = `url("${String(url).replace(/["\\]/g, '')}")`; bg.classList.add('cover'); bg.replaceChildren(); }
    api('instance.update', { id: i.id, patch: { bannerUrl: url } }).catch(() => { });
  }).catch(() => { });
}
const sideRow = (on, attr, icon, label, count) => `<button class="fo ${on ? 'on' : ''}" ${attr}><span class="cb ${on ? 'on' : ''}"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>${ico(icon, 'i ci')}<span class="fx">${label}</span>${count !== '' && count != null ? `<em>${count}</em>` : ''}</button>`;
function instSide(i) {
  const el = $('#iSide'); if (!el) return;
  const areas = [['content', 'Inhalte', 'layers', S.content?.id === i.id ? S.content.all.length : (i.mods || '')], ['worlds', 'Welten', 'earth', ''], ['logs', 'Logs', 'terminal', '']];
  if (hasOrbitMod(i)) areas.push(['orbit', 'Orbit Client', 'orbit', '']);
  const types = i.loader === 'vanilla' ? CTYPES.slice(1) : CTYPES;
  const C = S.content?.id === i.id ? S.content : null;
  if (C?.type === 'all') C.type = types[0][0];
  const art = types.map(([t, n, ic]) => [t, n, ic, C ? C.all.filter(x => x.type === t).length : '']);
  el.innerHTML = `<div class="fbox"><div class="fh">${ico('layers')}Bereich</div><div class="fbody">${areas.map(([k, n, ic, c]) => sideRow(S.itab === k, `data-tab="${k}"`, ic, n, c)).join('')}</div></div>
    ${S.itab === 'content' ? `<div class="fbox"><div class="fh">${ico('puzzle')}Art</div><div class="fbody" id="cTypes">${art.map(([k, n, ic, c]) => sideRow((C?.type || types[0][0]) === k, `data-k="${k}"`, ic, n, c)).join('')}</div></div>` : ''}`;
}
function instTabs(i) {
  instSide(i);
  ({ content: instContent, worlds: instWorlds, logs: instLogs, orbit: instOrbit })[S.itab](i);
}

/* ---------- content ---------- */
const PAGE = 24;
async function instContent(i) {
  const body = $('#iBody');
  const types = i.loader === 'vanilla' ? CTYPES.slice(1) : CTYPES;
  const C = S.content?.id === i.id ? S.content : (S.content = { id: i.id, all: [], type: types[0][0], q: '', page: 1, sel: new Set(), updates: null, loaded: false });
  if (C.type === 'all') C.type = types[0][0];
  if (!C.page) C.page = 1;
  body.innerHTML = `<div class="rbar"><span class="cb" id="cAll" title="Sichtbare auswählen"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span><div class="srch">${ico('search')}<input class="in" id="cQ" placeholder="Inhalte durchsuchen…" value="${esc(C.q)}"></div>
    <button class="btn sm" id="cUpd" onclick="checkUpdates()">${ico('refresh')}Updates</button>
    <button class="btn sm" onclick="addFile()">${ico('file')}Aus Datei</button>
    <button class="btn sm p" onclick="go('discover',{type:'${i.loader === 'vanilla' ? 'resourcepack' : 'mod'}',target:'${jsq(i.id)}'})">${ico('plus')}Inhalte hinzufügen</button></div>
    ${i.manualDownloads?.length ? `<div class="note w" style="margin:0 0 12px"><b>${i.manualDownloads.length} Datei(en) musst du selbst laden</b>, weil die Autoren nur Downloads über ihre eigene Website erlauben. Leg sie danach in den passenden Ordner.<div class="row" style="flex-wrap:wrap;gap:6px;margin-top:8px">${i.manualDownloads.map(m => { const [n, u] = m.split('|'); return `<button class="fchip" onclick="openUrl('${jsq(u)}')">${ico('ext')}${esc(n)}</button>`; }).join('')}</div></div>` : ''}
    <div id="cSel"></div><div id="cList">${C.loaded ? '' : '<div class="spinner"></div>'}</div>`;
  const draw = () => renderContent(i, types);
  const load = () => Promise.all(types.map(([t]) => api('instance.content', { id: i.id, type: t }).then(l => l.map(x => ({ ...x, type: t }))).catch(() => [])));
  $('#cQ').oninput = e => { C.q = e.target.value; C.page = 1; draw(); };
  if (C.loaded) draw();
  try {
    const res = await load();
    if (S.content !== C) return;
    C.all = res.flat(); C.loaded = true;
    if (S.page === 'inst' && S.args.id === i.id && S.itab === 'content') { draw(); const tb = $('#iSide [data-tab=content] em'); if (tb) tb.textContent = C.all.length; }
    const seen = () => { if (C.updates == null && C.all.some(x => x.projectId)) checkUpdates(true); };
    const unresolved = C.all.some(x => !x.projectId && x.source !== 'local');
    if (unresolved) api('content.resolve', { id: i.id }).then(async r => {
      if (!r?.changed || S.content !== C || S.page !== 'inst' || S.args.id !== i.id) return seen();
      const again = await load();
      if (S.content !== C) return;
      C.all = again.flat();
      draw();
      seen();
    }).catch(seen);
    else seen();
  } catch (e) { fail('Inhalte', e); }
}
function renderContent(i, types) {
  const C = S.content, el = $('#cList'); if (!el) return;
  const counts = Object.fromEntries(types.map(([t]) => [t, C.all.filter(x => x.type === t).length]));
  const updIds = new Set((C.updates || []).map(u => u.projectId));
  const typeBox = $('#cTypes');
  if (C.type === 'all') C.type = types[0][0];
  const typeRows = types.map(([t, n, ic]) => [t, n, ic, counts[t]]);
  if (updIds.size) typeRows.push(['updates', 'Updates', 'arrowup', updIds.size]);
  if (typeBox) typeBox.innerHTML = typeRows.map(([t, n, ic, c]) => sideRow(C.type === t, `data-k="${t}"`, ic, n, c)).join('');
  const q = C.q.trim().toLowerCase();
  const list = C.all.filter(x => (C.type === 'updates' ? updIds.has(x.projectId) : x.type === C.type) && (!q || (contentName(x) + ' ' + plain(x.file)).toLowerCase().includes(q)))
    .sort((a, b) => (a.dependency - b.dependency) || contentName(a).localeCompare(contentName(b), 'de'));
  const upd = new Map((C.updates || []).map(u => [u.projectId, u]));
  if (!C.all.length) {
    el.innerHTML = `<div class="lempty"><span class="iic">${ico('puzzle')}</span><h2>Noch keine Inhalte</h2><p>Füg Mods, Ressourcenpakete oder Shader aus dem Katalog hinzu. Abhängigkeiten werden automatisch mitinstalliert.</p>
      <button class="btn p" onclick="go('discover',{type:'${i.loader === 'vanilla' ? 'resourcepack' : 'mod'}',target:'${jsq(i.id)}'})">${ico('compass')}Inhalte entdecken</button></div>`;
    $('#cSel').innerHTML = ''; const box = $('#cAll'); if (box) box.style.visibility = 'hidden'; return;
  }
  const key = x => x.type + '|' + x.file;
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  if (C.page > pages) C.page = pages;
  if (C.page < 1) C.page = 1;
  const start = (C.page - 1) * PAGE;
  const view = list.slice(start, start + PAGE);
  const allSel = view.length && view.every(x => C.sel.has(key(x)));
  const allBox = $('#cAll');
  if (allBox) {
    allBox.style.visibility = view.length ? '' : 'hidden';
    allBox.classList.toggle('on', !!allSel);
    allBox.onclick = () => { const on = view.every(x => C.sel.has(key(x))); if (on) view.forEach(x => C.sel.delete(key(x))); else view.forEach(x => C.sel.add(key(x))); renderContent(i, types); };
  }
  const tile = x => {
    const u = x.projectId && upd.get(x.projectId), k = key(x), sel = C.sel.has(k);
    const sub = [x.dependency ? 'Abhängigkeit' : '', x.version || (x.projectId ? '' : 'Eigene Datei')].filter(Boolean).join(' · ');
    return `<article class="ctile ${x.on ? '' : 'off'} ${sel ? 'sel' : ''} ${x.projectId ? 'link' : ''}" data-k="${esc(k)}" title="${esc(plain(x.file))}"><div class="pv">${picHtml(x.icon, 'pic', CTYPES.find(c => c[0] === x.type)?.[2] || 'puzzle')}<span class="cb ${sel ? 'on' : ''}" data-s><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span></div>
      <div class="tx"><b>${esc(contentName(x))}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
      <div class="ac">${u ? `<button class="upill" data-u title="Neue Version: ${esc(u.to)}">${ico('arrowup')}Update</button>` : ''}<button class="ib sm ghost more" data-m title="Mehr">${ico('more')}</button><div class="tg sm ${x.on ? 'on' : ''}" data-tg></div></div></article>`;
  };
  const sections = (C.type === 'all' || C.type === 'updates' ? types : types.filter(t => t[0] === C.type)).map(([t, n]) => ({ t, n, total: list.filter(x => x.type === t).length, items: view.filter(x => x.type === t) })).filter(g => g.items.length);
  const pager = pages > 1 ? `<nav class="cpager"><button class="ib sm" data-pg="prev" ${C.page <= 1 ? 'disabled' : ''}>${ico('left')}</button><span>Seite ${C.page} von ${pages}</span><button class="ib sm" data-pg="next" ${C.page >= pages ? 'disabled' : ''}>${ico('right')}</button></nav>` : '';
  el.innerHTML = sections.length ? `<div class="cgroups">${sections.map(g => `<section class="cgrp">${C.type === 'all' ? `<h3>${esc(g.n)}<i>${g.total}</i></h3>` : ''}<div class="cgrid">${g.items.map(tile).join('')}</div></section>`).join('')}</div>${pager}` : '<div class="empty">Nichts gefunden.</div>';
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
    const pg = e.target.closest('[data-pg]');
    if (pg && !pg.disabled) { C.page += pg.dataset.pg === 'next' ? 1 : -1; return renderContent(i, types); }
    const row = e.target.closest('.ctile[data-k]'); if (!row) return;
    const x = C.all.find(y => key(y) === row.dataset.k); if (!x) return;
    if (e.target.closest('[data-s]')) {
      C.sel.has(row.dataset.k) ? C.sel.delete(row.dataset.k) : C.sel.add(row.dataset.k);
      e.target.closest('[data-s]').classList.toggle('on');
      row.classList.toggle('sel', C.sel.has(row.dataset.k));
      if (allBox) allBox.classList.toggle('on', view.length && view.every(x => C.sel.has(key(x))));
      return selBar();
    }
    if (e.target.closest('[data-p]')) return go('project', { id: x.projectId });
    if (e.target.closest('[data-tg]')) {
      const on = !x.on; x.on = on; row.classList.toggle('off', !on); e.target.closest('[data-tg]').classList.toggle('on', on);
      try { await api('content.toggle', { id: i.id, type: x.type, file: x.file, on }); } catch (er) { fail('Fehler', er); }
      return;
    }
    if (e.target.closest('[data-rm]')) {
      if (!await confirmBox('Entfernen?', `„${contentName(x)}“ wird aus der Instanz gelöscht.`, 'Entfernen', true)) return;
      try { await api('content.remove', { id: i.id, type: x.type, file: x.file }); C.all = C.all.filter(y => y !== x); renderContent(i, types); } catch (er) { fail('Fehler', er); }
      return;
    }
    if (e.target.closest('[data-u]')) {
      const hit = upd.get(x.projectId); if (!hit) return;
      if (!await confirmBox(`„${contentName(x)}“ wirklich aktualisieren?`, `Neue Version: ${hit.to}`, 'Aktualisieren')) return;
      return setContentVersion(i, x, hit.versionId);
    }
    if (e.target.closest('[data-ver]')) return pickVersion(i, x);
    if (e.target.closest('[data-m]')) {
      const hit = upd.get(x.projectId);
      return ctxMenu(e, [
        ...(x.projectId ? [['eye', 'Projekt ansehen', () => go('project', { id: x.projectId })], ['layers', 'Version wählen', () => pickVersion(i, x)]] : []),
        ...(hit ? [['arrowup', 'Auf ' + hit.to + ' aktualisieren', () => setContentVersion(i, x, hit.versionId)]] : []),
        [x.on ? 'x' : 'check', x.on ? 'Deaktivieren' : 'Aktivieren', async () => { x.on = !x.on; try { await api('content.toggle', { id: i.id, type: x.type, file: x.file, on: x.on }); } catch (er) { fail('Fehler', er); } renderContent(i, types); }],
        '-', ['trash', 'Entfernen', async () => { if (!await confirmBox('Entfernen?', `„${contentName(x)}“ wird aus der Instanz gelöscht.`, 'Entfernen', true)) return; try { await api('content.remove', { id: i.id, type: x.type, file: x.file }); C.all = C.all.filter(y => y !== x); renderContent(i, types); } catch (er) { fail('Fehler', er); } }, true],
      ]);
    }
    // a click on the card itself opens the project page
    if (x.projectId && !e.target.closest('button,.tg,.cb')) return go('project', { id: x.projectId });
  };
}
const CH_DE = { release: 'Release', beta: 'Beta', alpha: 'Alpha' };
async function checkUpdates(silent) {
  const i = instById(S.args.id), C = S.content; if (!i || !C || C.checking) return;
  C.checking = true;
  const b = $('#cUpd');
  if (b) { b.disabled = true; b.innerHTML = ico('refresh', 'i spin') + 'Prüfe…'; }
  try {
    C.updates = await api('content.updates', { id: i.id }) || [];
    const n = C.updates.length;
    if (b) {
      b.disabled = false;
      if (n) { b.className = 'btn sm p'; b.innerHTML = ico('download') + `Alle aktualisieren (${n})`; b.onclick = updateAll; }
      else { b.className = 'btn sm'; b.innerHTML = ico('check') + 'Alles aktuell'; b.onclick = () => checkUpdates(false); }
    }
    if (S.page === 'inst' && S.args.id === i.id && S.itab === 'content') renderContent(i, i.loader === 'vanilla' ? CTYPES.slice(1) : CTYPES);
  } catch (e) {
    if (b) { b.disabled = false; b.className = 'btn sm'; b.innerHTML = ico('refresh') + 'Updates'; b.onclick = () => checkUpdates(false); }
    if (!silent) fail('Updates', e);
  } finally { C.checking = false; }
}
window.checkUpdates = checkUpdates;
async function updateAll() {
  const i = instById(S.args.id), C = S.content; if (!i || !C?.updates?.length) return;
  if (!await confirmBox(`Alle ${C.updates.length} wirklich aktualisieren?`, 'Jede Datei wird auf die neueste passende Version gesetzt.', 'Aktualisieren')) return;
  try { const r = await api('content.updateAll', { id: i.id }); toast('Aktualisiert', `${r.count} Datei${r.count === 1 ? '' : 'en'} in ${i.name}`); S.content.updates = []; S.content.loaded = false; instContent(i); }
  catch (e) { fail('Update fehlgeschlagen', e); }
}
async function setContentVersion(i, x, versionId) {
  try {
    await api('content.setVersion', { id: i.id, projectId: x.projectId, versionId });
    toast('Version gewechselt', contentName(x));
    const C = S.content;
    if (C) { C.updates = (C.updates || []).filter(u => u.projectId !== x.projectId); C.loaded = false; }
    instContent(i);
  } catch (e) { fail('Version', e); }
}
async function pickVersion(i, x) {
  const u = (S.content?.updates || []).find(v => v.projectId === x.projectId);
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button><div class="kicker">Versionen</div><h1>${esc(contentName(x))}</h1><p class="sub" style="margin:6px 0 0;max-width:none;text-align:left">Installiert ist ${esc(x.version || 'diese Datei')}. Neuere und ältere Versionen für ${esc(i.mcVersion)}.</p><div id="vPick"><div class="spinner"></div></div>`, 'form');
  try {
    const list = await api('content.versions', { id: i.id, projectId: x.projectId });
    const box = $('#vPick'); if (!box) return;
    if (!list?.length) { box.innerHTML = '<div class="empty">Keine passende Version für diese Instanz.</div>'; return; }
    box.innerHTML = `<div class="vlist">${list.map(v => `<div class="vrow ${v.current ? 'on' : ''}"><div class="tx"><b>${esc(v.number || v.name)}</b><small>${esc(CH_DE[v.channel] || 'Release')} · ${esc(dateDe(v.date))}</small></div>${v.current ? '<span class="chip">Installiert</span>' : `<button class="btn sm ${u && u.versionId === v.id ? 'p' : ''}" data-vid="${esc(v.id)}" data-num="${esc(v.number || v.name)}">${u && u.versionId === v.id ? 'Aktualisieren' : 'Installieren'}</button>`}</div>`).join('')}</div>`;
    box.onclick = async e => {
      const b = e.target.closest('[data-vid]'); if (!b || b.disabled) return;
      const num = b.dataset.num || 'diese Version';
      if (!await confirmBox(`„${contentName(x)}“ wirklich auf ${num} setzen?`, 'Die aktuelle Datei wird ersetzt.', b.textContent.trim() === 'Aktualisieren' ? 'Aktualisieren' : 'Installieren')) return;
      b.disabled = true; closeModal(); setContentVersion(i, x, b.dataset.vid);
    };
  } catch (e) { fail('Versionen', e); closeModal(); }
}
async function addFile() {
  const i = instById(S.args.id), C = S.content; if (!i) return;
  const t = C.type === 'all' ? (i.loader === 'vanilla' ? 'resourcepack' : 'mod') : C.type;
  try { const r = await api('content.addFile', { id: i.id, type: t }); if (r?.count) { toast('Hinzugefügt', `${r.count} Datei${r.count > 1 ? 'en' : ''}`); C.loaded = false; instContent(i); } }
  catch (e) { fail('Hinzufügen fehlgeschlagen', e); }
}
window.addFile = addFile;

/* ---------- worlds, servers (live status), backups ---------- */
async function instWorlds(i) {
  const body = $('#iBody');
  body.innerHTML = '<div class="spinner"></div>';
  let r = { worlds: [], servers: [] }, bk = [];
  try { [r, bk] = await Promise.all([api('instance.worlds', { id: i.id }), api('backup.list', { id: i.id }).catch(() => [])]); } catch (e) { fail('Welten', e); }
  if (S.itab !== 'worlds') return;
  const quick = supportsQuickPlay(i.mcVersion);
  body.innerHTML = `${quick ? '' : `<div class="note" style="margin:0 0 14px">Direkt in eine Welt oder auf einen Server springen geht ab Minecraft 1.20. Bei ${esc(i.mcVersion)} startet das Spiel normal.</div>`}
    <div class="sec" style="margin-top:0"><h2>Welten</h2><span class="muted">${r.worlds.length}</span><span class="sp"></span><button class="btn sm" onclick="api('folder.open',{id:'${jsq(i.id)}',what:'saves'})">${ico('folder')}Ordner</button></div>
    <div class="wlist">${r.worlds.length ? r.worlds.map(w => `<div class="wcard">${w.icon ? `<span class="pic" style="background-image:url('${esc(w.icon)}')"></span>` : `<span class="pic">${ico('earth')}</span>`}<div class="tx"><b>${esc(w.name)}</b><small>${esc(w.mode || 'Welt')} · ${esc(ago(w.lastPlayed))} · ${esc(w.folder)}</small></div>
      <button class="btn sm" title="Backup als Zip" onclick="mkBackup('${jsq(i.id)}','${jsq(w.folder)}',this)">${ico('shield')}Backup</button>
      <button class="ib" title="Ordner" onclick="api('world.open',{id:'${jsq(i.id)}',folder:'${jsq(w.folder)}'})">${ico('folder')}</button><button class="ib d" title="Löschen (Papierkorb)" onclick="delWorld('${jsq(i.id)}','${jsq(w.folder)}','${jsq(w.name)}')">${ico('trash')}</button>
      <button class="btn sm play" onclick="play('${jsq(i.id)}',${quick ? `{world:'${jsq(w.folder)}',worldName:'${jsq(w.name)}'}` : '{}'})">${ico('play')}Spielen</button></div>`).join('') : '<div class="empty">Noch keine Welten. Starte das Spiel und erstell eine.</div>'}</div>
    <div class="sec"><h2>Server</h2><span class="muted">${r.servers.length}</span><span class="sp"></span>${r.servers.length ? `<button class="btn sm" onclick="pingAll()">${ico('refresh')}Aktualisieren</button>` : ''}</div>
    <div class="wlist" id="srvList">${r.servers.length ? r.servers.map((s, k) => `<div class="wcard srv" data-ip="${esc(s.ip)}">${s.icon ? `<span class="pic" style="background-image:url('${esc(s.icon)}')"></span>` : `<span class="pic">${ico('server')}</span>`}<div class="tx"><b>${esc(s.name)} <span class="sst"><i class="dot"></i><em>prüfe…</em></span></b><small class="motd">${esc(s.ip)}</small></div>
      <span class="spl"></span><button class="btn sm play" onclick="play('${jsq(i.id)}',{server:'${jsq(s.ip)}'})">${ico('play')}Beitreten</button></div>`).join('') : '<div class="empty">Keine Server gespeichert. Server, die du im Spiel hinzufügst, erscheinen hier mit Live-Status.</div>'}</div>
    <div class="sec"><h2>Backups</h2><span class="muted">${bk.length}</span><span class="sp"></span><button class="btn sm" onclick="api('backup.folder',{id:'${jsq(i.id)}'})">${ico('folder')}Ordner</button></div>
    <div class="wlist">${bk.length ? bk.map(b => `<div class="wcard"><span class="pic">${ico('shield')}</span><div class="tx"><b>${esc(b.world)}</b><small>${esc(new Date(b.date).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }))} · ${bytes(b.size)}</small></div>
      <button class="ib d" title="Backup löschen" onclick="delBackup('${jsq(i.id)}','${jsq(b.file)}')">${ico('trash')}</button><button class="btn sm" onclick="restoreBackup('${jsq(i.id)}','${jsq(b.file)}')">${ico('rotate')}Wiederherstellen</button></div>`).join('') : '<div class="empty">Noch keine Backups. Ein Klick auf „Backup“ bei einer Welt sichert sie als Zip.</div>'}</div>`;
  pingAll();
}
function pingAll() {
  $$('#srvList .srv').forEach(async el => {
    const st = el.querySelector('.sst'); st.innerHTML = '<i class="dot"></i><em>prüfe…</em>';
    let r; try { r = await api('server.ping', { address: el.dataset.ip }); } catch { r = { online: false }; }
    if (!el.isConnected) return;
    st.innerHTML = r.online ? `<i class="dot on"></i><em>${r.players.toLocaleString('de-DE')} / ${r.max.toLocaleString('de-DE')} online</em>` : '<i class="dot off"></i><em>offline</em>';
    if (r.online) {
      el.querySelector('.motd').textContent = r.motd || el.dataset.ip;
      el.querySelector('.spl').innerHTML = `<span class="ping ${r.ping < 80 ? 'g' : r.ping < 160 ? 'w' : 'r'}"><i></i><i></i><i></i><i></i>${r.ping} ms</span>`;
      if (r.icon && !el.querySelector('.pic').style.backgroundImage) { el.querySelector('.pic').innerHTML = ''; el.querySelector('.pic').style.backgroundImage = `url('${r.icon}')`; }
    }
  });
}
window.pingAll = pingAll;
window.mkBackup = async (id, folder, btn) => {
  btn.disabled = true; btn.innerHTML = ico('refresh', 'i spin') + 'Sichert…';
  try { const b = await api('backup.create', { id, folder }); toast('Backup erstellt', `${b.world} · ${bytes(b.size)}`); instWorlds(instById(id)); }
  catch (e) { btn.disabled = false; btn.innerHTML = ico('shield') + 'Backup'; fail('Backup fehlgeschlagen', e); }
};
window.delBackup = async (id, file) => { if (!await confirmBox('Backup löschen?', file, 'Löschen', true)) return; try { await api('backup.delete', { id, file }); instWorlds(instById(id)); } catch (e) { fail('Backup', e); } };
window.restoreBackup = async (id, file) => {
  if (!await confirmBox('Backup wiederherstellen?', 'Es wird als neue Welt neben die bestehenden gelegt. Nichts wird überschrieben.', 'Wiederherstellen')) return;
  try { const r = await api('backup.restore', { id, file }); toast('Wiederhergestellt', r.world); instWorlds(instById(id)); } catch (e) { fail('Wiederherstellen fehlgeschlagen', e); }
};
window.delWorld = async (id, folder, name) => {
  if (!await confirmBox('Welt löschen?', `„${name}“ wird in den Papierkorb verschoben.`, 'Löschen', true)) return;
  try { await api('world.delete', { id, folder }); toast('Welt gelöscht', name); instWorlds(instById(id)); } catch (e) { fail('Löschen fehlgeschlagen', e); }
};

/* ---------- export / import ---------- */
function exportInst(id) {
  const i = instById(id); if (!i) return;
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button><div class="kicker">Teilen</div><h1>Als Modpack exportieren</h1>
    <p class="sub" style="margin:6px 0 0;max-width:none;text-align:left">Erstellt eine .mrpack-Datei, die viele Launcher öffnen können. Mods aus dem Katalog werden verlinkt, alles andere kommt mit in die Datei.</p>
    <label class="fl">Version</label><input class="in" id="exVer" value="1.0.0">
    <div class="fsw" style="padding:14px 0 0"><span>Welten mitnehmen</span><div class="tg sm" id="exW" onclick="this.classList.toggle('on')"></div></div>
    <div class="act" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">Abbrechen</button><button class="btn p" id="exGo">${ico('upload')}Exportieren</button></div>`, 'form');
  $('#exGo').onclick = async () => {
    const version = $('#exVer').value.trim() || '1.0.0', worlds = $('#exW').classList.contains('on'); closeModal();
    try { const r = await api('instance.export', { id, version, worlds }); if (r) toast('Exportiert', r.path); } catch (e) { fail('Export fehlgeschlagen', e); }
  };
}
window.exportInst = exportInst;
function importMenu(e) {
  ctxMenu(e, [['file', 'Modpack-Datei (.mrpack / .zip)', importPack], ['dup', 'Aus anderem Launcher übernehmen', importLaunchers]]);
}
window.importMenu = importMenu;
async function importLaunchers() {
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button><div class="kicker">Import</div><h1>Aus anderen Launchern</h1><p class="sub" style="margin:6px 0 0;max-width:none;text-align:left">Prism Launcher, MultiMC, PolyMC und weitere Launcher. Welten, Mods und Einstellungen werden kopiert, das Original bleibt unverändert.</p><div class="ipick" id="imList"><div class="spinner"></div></div>`, 'form');
  let list = [];
  try { list = await api('import.scan'); } catch (e) { fail('Suche fehlgeschlagen', e); }
  if (!$('#imList')) return;
  $('#imList').innerHTML = list.length ? list.map(f => `<div class="ir"><span class="iic">${ico('box')}</span><div class="tx"><b>${esc(f.name)}</b><small>${esc(f.launcher)} · ${esc(LOADERS[f.loader]?.[0] || f.loader)} ${esc(f.mc)}</small></div><button class="btn sm p" data-i="${f.i}">${ico('download')}Übernehmen</button></div>`).join('')
    : '<div class="empty">Keine Instanzen aus anderen Launchern gefunden.</div>';
  $('#imList').onclick = async e => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    b.disabled = true; b.innerHTML = ico('refresh', 'i spin') + 'Kopiere…';
    try { const inst = await api('import.run', { i: +b.dataset.i }); b.className = 'btn sm ok'; b.innerHTML = ico('check') + 'Übernommen'; toast('Importiert', inst.name); refreshInstances(); }
    catch (er) { b.disabled = false; b.innerHTML = ico('download') + 'Übernehmen'; fail('Import fehlgeschlagen', er); }
  };
}

/* ======================= SCREENSHOTS ======================= */
PAGES.shots = async el => {
  crumbs([['Screenshots']]);
  el.innerHTML = `<div class="ph"><div><div class="kicker">Alle Instanzen</div><h1>Screenshots</h1><p class="pd">Alles, was du im Spiel mit F2 aufgenommen hast.</p></div><div class="ph-r"><button class="btn" id="shSelBtn">${ico('check')}Auswählen</button><select class="sel" id="shF"><option value="">Alle Instanzen</option></select></div></div>
    <div id="shBar"></div><div class="sgal" id="sgal"><div class="spinner"></div></div>`;
  let list = []; try { list = await api('screenshots.list'); } catch { }
  S.shots = list;
  const sel = new Set(); let selMode = false, last = -1;
  const ids = [...new Set(list.map(x => x.id))];
  $('#shF').innerHTML += ids.map(id => `<option value="${esc(id)}">${esc(instById(id)?.name || id)}</option>`).join('');
  const visible = () => { const f = $('#shF').value; return list.map((x, i) => [x, i]).filter(([x]) => !f || x.id === f).map(([, i]) => i); };
  const bar = () => {
    const n = sel.size, vis = visible(), all = vis.length && vis.every(i => sel.has(i));
    $('#shSelBtn').classList.toggle('on', selMode);
    $('#shSelBtn').innerHTML = selMode ? `${ico('x')}Fertig` : `${ico('check')}Auswählen`;
    $('#shBar').innerHTML = selMode ? `<div class="selbar shbar"><b>${n ? n + ' ausgewählt' : 'Klick auf Bilder, um sie auszuwählen'}</b><span class="muted" style="font-size:11.5px">Umschalt = Bereich</span><span class="sp"></span>
      <button class="btn sm" data-b="all">${ico(all ? 'x' : 'check')}${all ? 'Keine' : 'Alle'}</button>
      <button class="btn sm" data-b="open" ${n ? '' : 'disabled'}>${ico('folder')}Im Ordner zeigen</button>
      <button class="btn sm d" data-b="del" ${n ? '' : 'disabled'}>${ico('trash')}Löschen${n ? ' (' + n + ')' : ''}</button></div>` : '';
    $$('#sgal .shot').forEach(t => { const on = sel.has(+t.dataset.i); t.classList.toggle('sel', on); t.querySelector('.cb')?.classList.toggle('on', on); });
    $('#sgal').classList.toggle('selecting', selMode);
  };
  const draw = () => {
    const vis = visible();
    $('#sgal').innerHTML = vis.length ? vis.map(i => { const x = list[i]; return `<button class="shot tilt" data-i="${i}"><span class="cb" data-s><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span><i style="background-image:url('${esc(x.url)}')"></i><span class="cap"><b>${esc(instById(x.id)?.name || x.version)}</b><small>${esc(new Date(x.date).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }))}</small></span></button>`; }).join('')
      : `<div class="lempty" style="grid-column:1/-1"><span class="iic">${ico('image')}</span><h2>Noch keine Screenshots</h2><p>Drück im Spiel F2. Deine Screenshots aus allen Instanzen landen hier.</p></div>`;
    bar();
  };
  const toggle = (i, range) => {
    if (range && last >= 0) { const vis = visible(), a = vis.indexOf(last), b = vis.indexOf(i); if (a >= 0 && b >= 0) { vis.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(k => sel.add(k)); last = i; return bar(); } }
    sel.has(i) ? sel.delete(i) : sel.add(i); last = i; bar();
  };
  $('#shF').onchange = () => { sel.clear(); last = -1; draw(); };
  $('#shSelBtn').onclick = () => { selMode = !selMode; if (!selMode) sel.clear(); bar(); };
  $('#shBar').onclick = async e => {
    const b = e.target.closest('[data-b]'); if (!b) return;
    const vis = visible();
    if (b.dataset.b === 'all') { if (vis.every(i => sel.has(i))) sel.clear(); else vis.forEach(i => sel.add(i)); return bar(); }
    const items = [...sel].map(i => list[i]);
    if (b.dataset.b === 'open') { const x = items[0]; return api('screenshots.open', { id: x.id, file: x.file }); }
    if (b.dataset.b === 'del') {
      if (!await confirmBox(`${items.length} Screenshot${items.length > 1 ? 's' : ''} löschen?`, 'Die Bilder werden von der Festplatte gelöscht.', 'Löschen', true)) return;
      let ok = 0; for (const x of items) { try { await api('screenshots.delete', { id: x.id, file: x.file }); ok++; } catch { } }
      toast('Gelöscht', `${ok} Screenshot${ok === 1 ? '' : 's'}`);
      go('shots', {}, false);
    }
  };
  draw();
  $('#sgal').onclick = e => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    const i = +b.dataset.i;
    if (e.target.closest('[data-s]') || e.ctrlKey || e.metaKey || e.shiftKey) { if (!selMode) selMode = true; return toggle(i, e.shiftKey); }
    if (selMode) return toggle(i, e.shiftKey);
    const x = S.shots[i];
    modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button><img class="shotbig" src="${esc(x.url)}" alt="">
      <div class="act" style="justify-content:space-between"><span class="muted" style="font-size:12px">${esc(x.file)} · ${esc(instById(x.id)?.name || '')}</span>
      <span class="row"><button class="btn" onclick="api('screenshots.open',{id:'${jsq(x.id)}',file:'${jsq(x.file)}'})">${ico('folder')}Im Ordner zeigen</button><button class="btn d" onclick="api('screenshots.delete',{id:'${jsq(x.id)}',file:'${jsq(x.file)}'}).then(()=>{closeModal();go('shots',{},false)})">${ico('trash')}Löschen</button></span></div>`, 'form wide');
  };
  el._esc = e => { if (e.key === 'Escape' && S.page === 'shots' && selMode && !$('#modal').classList.contains('show')) { selMode = false; sel.clear(); bar(); } };
  document.removeEventListener('keydown', S.shotEsc || (() => { })); S.shotEsc = el._esc; document.addEventListener('keydown', S.shotEsc);
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
const ICONS = Object.keys(BLOCKS);
const LDESC = { vanilla: 'Original-Minecraft', fabric: 'Schnell, die meisten Mods', quilt: 'Fabric-kompatibel', forge: 'Klassisch, große Modpacks', neoforge: 'Moderner Forge-Nachfolger' };
// performance mods offered when creating a modded instance (Modrinth project ids)
const PERF = { fabric: [['AANobbMI', 'Sodium'], ['gvQqBUqZ', 'Lithium'], ['uXXizFIs', 'FerriteCore'], ['mOgUt4GM', 'Mod Menu']], quilt: [['AANobbMI', 'Sodium'], ['gvQqBUqZ', 'Lithium'], ['uXXizFIs', 'FerriteCore'], ['mOgUt4GM', 'Mod Menu']], neoforge: [['AANobbMI', 'Sodium'], ['gvQqBUqZ', 'Lithium'], ['uXXizFIs', 'FerriteCore']], forge: [['uXXizFIs', 'FerriteCore']] };
function msShell(title, iconHtml, tabs, cur) {
  return `<button class="ib x" onclick="closeModal()">${ico('x')}</button><div class="mside"><h3>${iconHtml}<span class="ell">${esc(title)}</span></h3>${tabs.map(([k, n, ic]) => `<button data-mt="${k}" class="${k === cur ? 'on' : ''}">${ico(ic)}${n}</button>`).join('')}</div><div class="mmain" id="mMain"></div>`;
}
/* ---------- icon picker (blocks, random, own image) ---------- */
function iconPickHtml(icon, iconUrl, open) {
  return `<div class="ipick">
    <div class="ip-row"><span class="ip-cur">${iconUrl ? `<img src="${esc(iconUrl)}" alt="">` : blockSvg(icon)}</span>
      <div class="ip-quick">${ICONS.slice(0, 9).map(k => `<button class="${!iconUrl && k === icon ? 'on' : ''}" data-ic="${k}" title="${esc(BLOCK_NAMES[k] || k)}">${blockSvg(k)}</button>`).join('')}</div></div>
    <div class="ip-acts"><button class="btn sm" data-ipa="all">${ico('grid')}${open ? 'Weniger' : `Alle ${ICONS.length} Blöcke`}</button><button class="btn sm" data-ipa="rnd">${ico('rotate')}Zufall</button><button class="btn sm" data-ipa="up">${ico('upload')}Eigenes Bild</button>${iconUrl ? `<button class="btn sm ghost" data-ipa="clr">${ico('x')}Bild entfernen</button>` : ''}</div>
    ${open ? `<div class="ip-all">${ICONS.map(k => `<button class="${!iconUrl && k === icon ? 'on' : ''}" data-ic="${k}" title="${esc(BLOCK_NAMES[k] || k)}">${blockSvg(k)}<small>${esc(BLOCK_NAMES[k] || k)}</small></button>`).join('')}</div>` : ''}
  </div>`;
}
// image → 128px square PNG data URL (kept small, stored with the instance)
function imageToIcon(file) {
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onerror = rej;
    rd.onload = () => { const im = new Image(); im.onerror = rej; im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const s = Math.min(im.width, im.height); x.imageSmoothingEnabled = s > 128; x.drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, 128, 128); res(c.toDataURL('image/png')); }; im.src = rd.result; };
    rd.readAsDataURL(file);
  });
}
function iconPickBind(root, st, onChange) {
  const redraw = () => { root.innerHTML = iconPickHtml(st.icon, st.iconUrl, st.open); };
  redraw();
  root.onclick = async e => {
    const b = e.target.closest('[data-ic]');
    if (b) { st.icon = b.dataset.ic; st.iconUrl = null; redraw(); return onChange(st); }
    const a = e.target.closest('[data-ipa]')?.dataset.ipa; if (!a) return;
    if (a === 'all') { st.open = !st.open; return redraw(); }
    if (a === 'rnd') { let k; do k = ICONS[Math.floor(Math.random() * ICONS.length)]; while (k === st.icon && ICONS.length > 1); st.icon = k; st.iconUrl = null; redraw(); root.querySelector('.ip-cur')?.classList.add('pop'); return onChange(st); }
    if (a === 'clr') { st.iconUrl = null; redraw(); return onChange(st); }
    if (a === 'up') {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp,image/gif';
      inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; try { st.iconUrl = await imageToIcon(f); redraw(); onChange(st); } catch { toast('Bild konnte nicht geladen werden'); } };
      inp.click();
    }
  };
}
/* ---------- new instance ---------- */
async function newInstance(tab = 'custom', pre = {}) {
  if (tab === 'orbit' && !ORBIT_ON) tab = 'custom';
  const N = S.newInst = { tab, name: pre.name || '', icon: pre.icon || ICONS[Math.floor(Math.random() * 12)], iconUrl: null, open: false, loader: pre.loader || 'fabric', mc: pre.mc || '', lv: '', vf: 'release', vq: '', games: {}, group: '', ram: 0, perf: true, discover: false, adv: false, orbitVer: null, packs: new Set((S.settings.orbitPacks || 'perf,shaders,qol').split(',').filter(Boolean)), then: pre.then };
  const tabs = [['custom', 'Eigene Instanz', 'cube'], ['file', 'Importieren', 'upload'], ...(ORBIT_ON ? [['orbit', 'Orbit Client', 'orbit']] : [])];
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button><div class="mside niside"><div class="niprev" id="niPrev"></div>${tabs.map(([k, n, ic]) => `<button data-mt="${k}" class="${k === tab ? 'on' : ''}">${ico(ic)}${n}</button>`).join('')}</div><div class="mmain" id="mMain"></div>`, 'ms ni');
  $('.mside').onclick = e => { const b = e.target.closest('[data-mt]'); if (!b) return; N.tab = b.dataset.mt; $$('.mside [data-mt]').forEach(x => x.classList.toggle('on', x === b)); niRender(); };
  niPrev();
  try { await ensureVersions(); } catch (e) { fail('Versionen', e); }
  if (!N.mc) N.mc = S.latest.release;
  niRender();
}
window.newInstance = newInstance;
function niPrev() {
  const N = S.newInst, el = $('#niPrev'); if (!el) return;
  el.innerHTML = `<div class="np-glow" style="--lc:${LCOL[N.loader]}"></div><span class="np-ic">${N.iconUrl ? `<img src="${esc(N.iconUrl)}" alt="">` : blockSvg(N.icon)}</span>
    <b class="ell">${esc(N.name.trim() || niDefName())}</b><small>${esc(LOADERS[N.loader][0])} · ${esc(N.mc || '…')}</small>
    <div class="np-chips">${loaderChip(N.loader)}${N.group ? `<span class="chip m">${esc(N.group)}</span>` : ''}${N.perf && PERF[N.loader] ? `<span class="chip m">${ico('zap')}Performance</span>` : ''}</div>`;
}
async function niGames(loader) {
  const N = S.newInst;
  const want = v => N.vf === 'release' ? v.type === 'release' : N.vf === 'snapshot' ? v.type === 'snapshot' : v.type === 'old_beta' || v.type === 'old_alpha';
  if (loader === 'vanilla') return S.versions.filter(want).map(v => v.id);
  if (!N.games[loader]) { try { N.games[loader] = await api('loader.games', { loader }); } catch { N.games[loader] = []; } }
  const type = new Map(S.versions.map(v => [v.id, v.type]));
  return N.games[loader].filter(v => N.vf === 'release' ? type.get(v) === 'release' : N.vf === 'snapshot' ? type.get(v) !== 'release' : false);
}
async function niRender() {
  const N = S.newInst, m = $('#mMain'); if (!m) return;
  m.onclick = null;
  if (N.tab === 'file') {
    m.innerHTML = `<h2>Importieren</h2><p class="sub">Modpacks (.mrpack oder .zip) oder Instanzen aus anderen Launchern werden als neue Instanz angelegt. Alle Dateien kommen direkt von ihren Quellen und werden per Hash geprüft.</p>
      <div class="nitiles">
      <button class="mtile" onclick="closeModal();importPack()"><span class="iic">${ico('upload')}</span><span><b>Modpack-Datei</b><small>.mrpack oder .zip auswählen</small></span></button>
      <button class="mtile" onclick="closeModal();importLaunchers()"><span class="iic">${ico('dup')}</span><span><b>Aus anderem Launcher</b><small>Prism, MultiMC, PolyMC und weitere</small></span></button>
      <button class="mtile" onclick="closeModal();go('discover',{type:'modpack'})"><span class="iic">${ico('compass')}</span><span><b>Modpack aus dem Katalog</b><small>Tausende Modpacks durchsuchen</small></span></button></div>`;
    return;
  }
  if (N.tab === 'orbit') return niOrbit(m);
  const games = await niGames(N.loader);
  if (!games.includes(N.mc)) N.mc = games[0] || N.mc;
  const q = N.vq.trim().toLowerCase(), shown = games.filter(v => !q || v.toLowerCase().includes(q));
  const latest = games[0];
  m.innerHTML = `<h2>Eigene Instanz</h2><p class="sub">Version und Mod-Loader wählen. Alles Nötige wird im Hintergrund geladen, du kannst sofort weitermachen.</p>
    <div class="vrow2"><div><label class="fl">Name</label><input class="in" id="niName" placeholder="${esc(niDefName())}" value="${esc(N.name)}"></div>
      <div><label class="fl">Gruppe <span class="muted">(optional)</span></label><input class="in" id="niGroup" list="niGroups" placeholder="z. B. Survival" value="${esc(N.group)}"><datalist id="niGroups">${[...new Set(S.instances.map(x => x.group).filter(Boolean))].map(g => `<option>${esc(g)}</option>`).join('')}</datalist></div></div>
    <label class="fl">Symbol</label><div id="niIcon"></div>
    <label class="fl">Mod-Loader</label><div class="ldcards" id="niLd">${Object.entries(LOADERS).map(([k, [n]]) => `<button class="${k === N.loader ? 'on' : ''}" data-ld="${k}" style="--lc:${LCOL[k]}">${ldIcon(k)}<b>${n}</b><small>${LDESC[k]}</small></button>`).join('')}</div>
    <div class="vhead"><label class="fl">Spielversion</label><span class="sp"></span>
      <div class="seg sm" id="niVf">${[['release', 'Releases'], ['snapshot', 'Snapshots'], ...(N.loader === 'vanilla' ? [['old', 'Uralt']] : [])].map(([k, n]) => `<button data-vf="${k}" class="${N.vf === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="srch sm">${ico('search')}<input class="in" id="niVq" placeholder="Suchen…" value="${esc(N.vq)}"></div></div>
    <div class="vlist" id="niVl">${shown.length ? shown.slice(0, 120).map(v => `<button data-mc="${esc(v)}" class="${v === N.mc ? 'on' : ''}">${esc(v)}${v === latest && !q ? '<i>Neu</i>' : ''}</button>`).join('') : '<div class="muted" style="padding:10px">Keine passende Version.</div>'}</div>
    ${PERF[N.loader] ? `<div class="srow"><div><b>${ico('zap')}Performance-Mods dazu</b><p>${PERF[N.loader].map(p => p[1]).join(', ')}. Mehr FPS, weniger RAM. Nur was zur Version passt.</p></div><div class="tg sm ${N.perf ? 'on' : ''}" id="niPerf"></div></div>` : ''}
    <div class="srow"><div><b>${ico('compass')}Danach Mods aussuchen</b><p>Öffnet Entdecken direkt mit der neuen Instanz als Ziel.</p></div><div class="tg sm ${N.discover ? 'on' : ''}" id="niDisc"></div></div>
    <button class="lnk niadv" id="niAdv">${ico(N.adv ? 'chevd' : 'right')}Erweitert</button>
    <div class="${N.adv ? '' : 'hidden'}" id="niAdvBox">
      <div class="vrow2"><div><label class="fl">Loader-Version</label><select class="sel wide" id="niLv" style="height:42px" ${N.loader === 'vanilla' ? 'disabled' : ''}><option value="">${N.loader === 'vanilla' ? '—' : 'Empfohlen'}</option></select></div>
      <div><label class="fl">Arbeitsspeicher</label><div class="seg sm" id="niRam">${[[0, 'Auto'], [2048, '2 GB'], [4096, '4 GB'], [6144, '6 GB'], [8192, '8 GB']].map(([v, n]) => `<button data-ram="${v}" class="${N.ram === v ? 'on' : ''}">${n}</button>`).join('')}</div></div></div></div>
    <div class="mfoot"><button class="btn" onclick="closeModal()">Abbrechen</button><button class="btn p" id="niGo">${ico('plus')}Instanz erstellen</button></div>`;
  iconPickBind($('#niIcon'), N, () => niPrev());
  $('#niName').oninput = e => { N.name = e.target.value; niPrev(); };
  $('#niGroup').oninput = e => { N.group = e.target.value; niPrev(); };
  $('#niLd').onclick = e => { const b = e.target.closest('[data-ld]'); if (!b) return; N.loader = b.dataset.ld; N.lv = ''; if (N.loader !== 'vanilla' && N.vf === 'old') N.vf = 'release'; niPrev(); niRender(); };
  $('#niVf').onclick = e => { const b = e.target.closest('[data-vf]'); if (!b) return; N.vf = b.dataset.vf; niRender(); };
  let t = 0; $('#niVq').oninput = e => { N.vq = e.target.value; clearTimeout(t); t = setTimeout(async () => { await niRender(); const i = $('#niVq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 200); };
  $('#niVl').onclick = e => { const b = e.target.closest('[data-mc]'); if (!b) return; N.mc = b.dataset.mc; N.lv = ''; $$('#niVl button').forEach(x => x.classList.toggle('on', x === b)); $('#niName').placeholder = niDefName(); niPrev(); niLoaderVersions(); };
  $('#niPerf') && ($('#niPerf').onclick = e => { N.perf = !N.perf; e.target.classList.toggle('on', N.perf); niPrev(); });
  $('#niDisc').onclick = e => { N.discover = !N.discover; e.target.classList.toggle('on', N.discover); };
  $('#niAdv').onclick = () => { N.adv = !N.adv; $('#niAdvBox').classList.toggle('hidden', !N.adv); $('#niAdv').innerHTML = ico(N.adv ? 'chevd' : 'right') + 'Erweitert'; };
  $('#niRam').onclick = e => { const b = e.target.closest('[data-ram]'); if (!b) return; N.ram = +b.dataset.ram; $$('#niRam button').forEach(x => x.classList.toggle('on', x === b)); };
  $('#niLv').onchange = e => N.lv = e.target.value;
  $('#niGo').onclick = niCreate;
  niPrev(); niLoaderVersions();
}
function niOrbit(m) {
  const N = S.newInst, sup = S.orbitInfo?.supported || ['26.3'];
  N.orbitVer = N.orbitVer || sup[0];
  m.innerHTML = `<h2>Orbit Client</h2><p class="sub">Eigener Client mit HUD-Modulen und Performance-Paketen.</p>
    <label class="fl">Version</label><div class="seg">${sup.map(v => `<button class="${v === N.orbitVer ? 'on' : ''}" data-ov="${esc(v)}">Minecraft ${esc(v)}</button>`).join('')}</div>
    <div class="mfoot"><button class="btn" onclick="closeModal()">Abbrechen</button><button class="btn p" id="niGo">${ico('plus')}Orbit Client einrichten</button></div>`;
  m.onclick = e => { const v = e.target.closest('[data-ov]'); if (v) { N.orbitVer = v.dataset.ov; niRender(); } };
  $('#niGo').onclick = async () => {
    const b = $('#niGo'); b.disabled = true;
    try { const r = await api('orbit.create', { mc: N.orbitVer, packs: [...N.packs], ramMb: 3072 }); closeModal(); await refreshInstances(); go('inst', { id: r.id }); }
    catch (e) { b.disabled = false; fail('Einrichten fehlgeschlagen', e); }
  };
}
const niDefName = () => { const N = S.newInst; return `${N.loader === 'vanilla' ? 'Minecraft' : LOADERS[N.loader][0]} ${N.mc}`; };
async function niLoaderVersions() {
  const N = S.newInst, sel = $('#niLv'); if (!sel || N.loader === 'vanilla') return;
  sel.innerHTML = '<option value="">Lädt…</option>';
  try {
    const l = await api('loader.versions', { loader: N.loader, mc: N.mc });
    if (S.newInst !== N || !$('#niLv')) return;
    sel.innerHTML = `<option value="">Empfohlen${l.find(x => x.recommended) ? ' (' + esc(l.find(x => x.recommended).version) + ')' : l[0] ? ' (' + esc(l.find(x => x.stable)?.version || l[0].version) + ')' : ''}</option>` + l.slice(0, 60).map(x => `<option value="${esc(x.version)}" ${x.version === N.lv ? 'selected' : ''}>${esc(x.version)}${x.stable ? '' : ' (Beta)'}</option>`).join('');
  } catch { sel.innerHTML = '<option value="">Empfohlen</option>'; }
}
async function niCreate() {
  const N = S.newInst, b = $('#niGo');
  b.disabled = true; b.innerHTML = ico('refresh', 'i spin') + 'Erstelle…';
  try {
    const inst = await api('instance.create', { name: N.name.trim() || niDefName(), mc: N.mc, loader: N.loader, loaderVersion: N.lv || null, icon: N.icon, iconUrl: N.iconUrl, ramMb: N.ram, group: N.group.trim() || null });
    closeModal(); toast('Instanz erstellt', `${inst.name} · Dateien werden im Hintergrund geladen`);
    await refreshInstances();
    if (N.perf && PERF[N.loader]) {
      (async () => {
        let ok = 0;
        for (const [id] of PERF[N.loader]) { try { await api('mr.install', { id: inst.id, project: id, type: 'mod', version: null }); ok++; } catch { } }
        if (ok) { toast('Performance-Mods installiert', `${ok} Mods in ${inst.name}`); refreshInstances(); }
      })();
    }
    if (N.then) N.then(inst); else if (N.discover && N.loader !== 'vanilla') go('discover', { type: 'mod', target: inst.id }); else go('inst', { id: inst.id });
  } catch (e) { b.disabled = false; b.innerHTML = ico('plus') + 'Instanz erstellen'; fail('Erstellen fehlgeschlagen', e); }
}

/* ======================= INSTANCE SETTINGS ======================= */
const ISTABS = [['general', 'Allgemein', 'info'], ['install', 'Installation', 'cube'], ['java', 'Java & Speicher', 'coffee'], ['window', 'Fenster & Start', 'monitor'], ['hooks', 'Befehle', 'terminal']];
async function instSettings(id, tab = 'general') {
  const i = instById(id); if (!i) return;
  const E = S.iset = { id, tab, games: {} };
  modal(msShell(i.name, instIcon(i), ISTABS, tab), 'ms');
  $('.mside').insertAdjacentHTML('beforeend', `<div class="ms-foot"><button class="lnk" onclick="api('folder.open',{id:'${jsq(i.id)}',what:''})">${ico('folder')}Ordner öffnen</button></div>`);
  $('.mside').onclick = e => { const b = e.target.closest('[data-mt]'); if (!b) return; E.tab = b.dataset.mt; $$('.mside [data-mt]').forEach(x => x.classList.toggle('on', x === b)); isRender(); };
  S.modalClose = () => refreshInstances();
  isRender();
}
window.instSettings = instSettings;
const isPatch = async patch => { try { await api('instance.update', { id: S.iset.id, patch }); Object.assign(instById(S.iset.id), patch); } catch (e) { fail('Speichern fehlgeschlagen', e); } };
const isDeb = (() => { let t = 0; return f => { clearTimeout(t); t = setTimeout(f, 400); }; })();
const isTg = (id, on) => `<div class="tg sm ${on ? 'on' : ''}" id="${id}"></div>`;
const isOpt = (k, title, desc, ctl) => `<div class="srow"><div><b>${title}</b><p>${desc}</p></div>${ctl}</div>`;
async function isRender() {
  const E = S.iset, i = instById(E.id), m = $('#mMain'); if (!i || !m) return;
  m.onclick = null;
  if (E.tab === 'general') {
    const groups = [...new Set(S.instances.map(x => x.group).filter(Boolean))];
    m.innerHTML = `<h2>Allgemein</h2>
      <div class="isov">${instIcon(i)}<div class="tx"><b class="ell">${esc(i.name)}</b><small>${esc(instSub(i))} · ${i.kind === 'custom' ? 'Eigene Instanz' : KIND[i.kind]} · erstellt ${esc(ago(i.created).replace(/^V/, 'v'))}</small></div></div>
      <div class="isst" id="isSt">${[['hdd', 'Größe'], ['puzzle', 'Mods'], ['image', 'Ressourcen'], ['sun', 'Shader'], ['earth', 'Welten'], ['clock', 'Spielzeit']].map(([ic, l]) => `<div>${ico(ic)}<b>…</b><small>${l}</small></div>`).join('')}</div>
      <div class="vrow2"><div><label class="fl">Name</label><input class="in" id="isName" value="${esc(i.name)}"></div>
      <div><label class="fl">Gruppe</label><input class="in" id="isGroup" list="isGroups" placeholder="z. B. PvP, Survival" value="${esc(i.group || '')}"><datalist id="isGroups">${groups.map(g => `<option>${esc(g)}</option>`).join('')}</datalist></div></div>
      <label class="fl">Symbol</label><div id="isIcon"></div>
      <label class="fl">Notizen</label><textarea class="in ta" id="isNotes" rows="3" placeholder="Server-IPs, Seeds, To-dos …">${esc(i.notes || '')}</textarea>
      <div class="sec"><h2>Aktionen</h2></div>
      <div class="isact">
        <button data-a="folder">${ico('folder')}<b>Ordner öffnen</b><small>Dateien der Instanz</small></button>
        <button data-a="shortcut">${ico('ext')}<b>Desktop-Verknüpfung</b><small>Startet direkt ins Spiel</small></button>
        <button data-a="export">${ico('upload')}<b>Als Modpack exportieren</b><small>.mrpack zum Teilen</small></button>
        <button data-a="dup">${ico('dup')}<b>Duplizieren</b><small>Kopie mit Mods und Welten</small></button>
        <button data-a="logs">${ico('list')}<b>Logs &amp; Abstürze</b><small>Letzte Spielprotokolle</small></button>
        <button data-a="del" class="d">${ico('trash')}<b>Löschen</b><small>Mit allen Welten, endgültig</small></button>
      </div>`;
    api('instance.stats', { id: i.id }).then(st => {
      const v = [bytes(st.size), st.mods, st.resourcepacks, st.shaders, st.worlds, ptime(i.playSeconds)];
      $$('#isSt b').forEach((b, k) => b.textContent = v[k] ?? '—');
    }).catch(() => $$('#isSt b').forEach(b => b.textContent = '—'));
    $('#isName').oninput = e => isDeb(() => { const v = e.target.value.trim(); if (v) { isPatch({ name: v }); $('.mside h3 span.ell').textContent = v; $('.isov b').textContent = v; } });
    $('#isGroup').oninput = e => isDeb(() => isPatch({ group: e.target.value.trim() || null }));
    $('#isNotes').oninput = e => isDeb(() => isPatch({ notes: e.target.value.trim() || null }));
    iconPickBind($('#isIcon'), { icon: i.icon, iconUrl: i.iconUrl, open: false }, st => { isPatch({ icon: st.icon, iconUrl: st.iconUrl }); const h = instIcon({ icon: st.icon, iconUrl: st.iconUrl }); $('.mside h3 .iic')?.replaceWith(document.createRange().createContextualFragment(h)); $('.isov>.iic')?.replaceWith(document.createRange().createContextualFragment(h)); });
    $('.isact').onclick = async e => {
      const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
      if (a === 'folder') return api('folder.open', { id: i.id, what: '' });
      if (a === 'shortcut') { try { await api('instance.shortcut', { id: i.id }); toast('Verknüpfung erstellt', 'Liegt auf deinem Desktop'); } catch (e) { fail('Verknüpfung', e); } return; }
      closeModal();
      if (a === 'export') exportInst(i.id);
      if (a === 'dup') duplicateInst(i.id);
      if (a === 'logs') go('inst', { id: i.id, tab: 'logs' });
      if (a === 'del') deleteInst(i.id);
    };
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
      <div class="isov sm"><span class="iic">${ico('cube')}</span><div class="tx"><small>Aktuell installiert</small><b>Minecraft ${esc(i.mcVersion)} · ${esc(LOADERS[i.loader]?.[0] || i.loader)}${i.loaderVersion ? ' ' + esc(i.loaderVersion) : ''}</b></div></div>
      ${locked ? `<div class="note w">Diese Instanz ist ${i.kind === 'modpack' ? 'ein Modpack' : 'der Orbit Client'}. Version und Loader zu ändern kann sie kaputt machen.</div>` : ''}
      <label class="fl">Mod-Loader</label><div class="ldsel" id="isLd">${Object.entries(LOADERS).map(([k, [n]]) => `<button class="${k === E.loader ? 'on' : ''}" data-ld="${k}">${ldIcon(k)}${n}</button>`).join('')}</div>
      <div class="vrow2"><div><label class="fl">Spielversion</label><select class="sel wide" id="isMc" style="height:42px">${games.map(v => `<option ${v === E.mc ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
      <div><label class="fl">Loader-Version</label><select class="sel wide" id="isLv" style="height:42px" ${E.loader === 'vanilla' ? 'disabled' : ''}><option value="">${E.loader === 'vanilla' ? '—' : 'Empfohlen'}</option></select></div></div>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn p" id="isApply">${ico('check')}Übernehmen</button></div>
      <div class="sec"><h2>Modpack</h2></div>
      ${i.modpackProject ? isOpt('', 'Verknüpft mit einem Modpack', 'Updates und die Modpack-Seite kommen von diesem Projekt.', `<span class="row" style="gap:6px"><button class="btn sm" onclick="closeModal();go('project',{id:'${jsq(i.modpackProject)}'})">${ico('compass')}Seite öffnen</button><button class="btn sm" id="isUnlink">${ico('link')}Lösen</button></span>`)
        : isOpt('', 'Nicht verknüpft', 'Eigene Instanz. Wir suchen beim Öffnen automatisch nach einem Modpack mit genau diesem Namen.', '')}
      <div class="sec"><h2>Wartung</h2></div>
      ${isOpt('', 'Dateien prüfen &amp; reparieren', 'Lädt fehlende oder kaputte Spieldateien, Bibliotheken und Java neu.', `<button class="btn sm" id="isRepair">${ico('refresh')}Reparieren</button>`)}
      ${isOpt('', 'Mods auf Updates prüfen', 'Zeigt verfügbare Updates in der Mod-Liste der Instanz.', `<button class="btn sm" id="isUpd">${ico('download')}Prüfen</button>`)}`;
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
    $('#isUnlink') && ($('#isUnlink').onclick = async () => { await isPatch({ modpackProject: null }); toast('Verknüpfung gelöst'); isRender(); });
    $('#isRepair').onclick = async () => { closeModal(); toast('Prüfe Dateien', i.name); try { await api('instance.repair', { id: i.id }); toast('Alles in Ordnung', i.name); } catch (e) { fail('Reparieren fehlgeschlagen', e); } };
    $('#isUpd').onclick = () => { closeModal(); go('inst', { id: i.id, tab: 'content' }); };
    return;
  }
  if (E.tab === 'java') {
    const ram = i.ramMb || 0, def = S.settings.ramMb || 4096;
    const PRESETS = [['', 'Standard'], ['-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1', 'Große Modpacks (G1 optimiert)'], ['-XX:+UseZGC -XX:+ZGenerational', 'ZGC (Java 21+, viel RAM)'], ['-XX:+UseShenandoahGC', 'Shenandoah']];
    m.innerHTML = `<h2>Java &amp; Speicher</h2><p class="sub">Leer lassen = Standard aus den globalen Einstellungen. Java wird pro Version automatisch passend geladen.</p>
      <label class="fl">Arbeitsspeicher</label><div class="fsw" style="padding:0 0 8px"><span>Eigenen Wert nutzen</span>${isTg('isRamOn', ram)}</div>
      <div class="ramrow ${ram ? '' : 'dim'}" id="isRamRow"><input type="range" min="1024" max="${Math.max(16384, def)}" step="256" value="${ram || def}" id="isRam"><input class="in" id="isRamN" value="${ram || def} MB" readonly></div>
      <div class="row" style="gap:6px;margin-top:8px">${[2048, 4096, 6144, 8192, 12288].map(v => `<button class="fchip" data-ram="${v}">${v / 1024} GB</button>`).join('')}</div>
      <label class="fl">Java-Pfad</label><div class="inline"><input class="in" id="isJava" placeholder="Automatisch (empfohlen)" value="${esc(i.javaPath || '')}"><button class="btn" onclick="pickJava('isJava')">${ico('folder')}Durchsuchen</button></div>
      <label class="fl">JVM-Argumente</label><input class="in mono" id="isJvm" placeholder="${esc(S.settings.jvmArgs || 'Mojangs Standard (G1GC)')}" value="${esc(i.jvmArgs || '')}">
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${PRESETS.map(([v, n]) => `<button class="fchip" data-jvm="${esc(v)}">${n}</button>`).join('')}</div>
      <label class="fl">Umgebungsvariablen</label><textarea class="in ta mono" id="isEnv" rows="3" placeholder="NAME=wert (eine pro Zeile)">${esc(i.envVars || '')}</textarea>`;
    const r = $('#isRam'); setRange(r);
    const setRam = v => { r.value = v; setRange(r); $('#isRamN').value = r.value + ' MB'; };
    r.oninput = () => { setRam(r.value); if ($('#isRamOn').classList.contains('on')) isDeb(() => isPatch({ ramMb: +r.value })); };
    $('#isRamOn').onclick = e => { const on = !e.target.classList.contains('on'); e.target.classList.toggle('on', on); $('#isRamRow').classList.toggle('dim', !on); isPatch({ ramMb: on ? +r.value : 0 }); };
    m.onclick = e => {
      const rb = e.target.closest('[data-ram]'); if (rb) { setRam(rb.dataset.ram); $('#isRamOn').classList.add('on'); $('#isRamRow').classList.remove('dim'); isPatch({ ramMb: +rb.dataset.ram }); }
      const jb = e.target.closest('[data-jvm]'); if (jb) { $('#isJvm').value = jb.dataset.jvm; isPatch({ jvmArgs: jb.dataset.jvm || null }); toast('JVM-Argumente gesetzt', jb.textContent); }
    };
    $('#isJava').onchange = e => isPatch({ javaPath: e.target.value.trim() || null });
    $('#isJvm').oninput = e => isDeb(() => isPatch({ jvmArgs: e.target.value.trim() || null }));
    $('#isEnv').oninput = e => isDeb(() => isPatch({ envVars: e.target.value.trim() || null }));
    return;
  }
  if (E.tab === 'hooks') {
    m.innerHTML = `<h2>Befehle</h2><p class="sub">Eigene Befehle rund um den Spielstart. Sie laufen im Ordner der Instanz. Verfügbar sind <code>%INST_DIR%</code>, <code>%INST_NAME%</code>, <code>%INST_MC_VERSION%</code> und <code>%INST_LOADER%</code>.</p>
      <label class="fl">Vor dem Start</label><input class="in mono" id="isPre" placeholder="z. B. backup.bat (der Start wartet darauf)" value="${esc(i.preLaunch || '')}">
      <label class="fl">Wrapper</label><input class="in mono" id="isWrap" placeholder="Programm, über das Java gestartet wird" value="${esc(i.wrapper || '')}">
      <label class="fl">Nach dem Beenden</label><input class="in mono" id="isPost" placeholder="z. B. Ordner aufräumen oder Musik weiter abspielen" value="${esc(i.postExit || '')}">
      <div class="note" style="margin-top:16px">${ico('alert')}Befehle laufen mit deinen Rechten. Trag hier nur ein, was du selbst verstehst.</div>`;
    $('#isPre').oninput = e => isDeb(() => isPatch({ preLaunch: e.target.value.trim() || null }));
    $('#isWrap').oninput = e => isDeb(() => isPatch({ wrapper: e.target.value.trim() || null }));
    $('#isPost').oninput = e => isDeb(() => isPatch({ postExit: e.target.value.trim() || null }));
    return;
  }
  const onl = i.onLaunch || '';
  m.innerHTML = `<h2>Fenster &amp; Start</h2><p class="sub">Wie das Spiel startet. 0 = Standard aus den Einstellungen.</p>
    ${isOpt('', 'Vollbild', 'Startet Minecraft direkt im Vollbild.', isTg('isFs', i.fullscreen))}
    <div class="${i.fullscreen ? 'dim' : ''}" id="isWin"><div class="vrow2"><div><label class="fl">Breite</label><input class="in" id="isW" type="number" min="0" value="${i.width || 0}"></div><div><label class="fl">Höhe</label><input class="in" id="isH" type="number" min="0" value="${i.height || 0}"></div></div>
    <div class="row" style="margin-top:10px;gap:6px">${[[0, 0, 'Standard'], [1280, 720, '1280×720'], [1600, 900, '1600×900'], [1920, 1080, '1920×1080'], [2560, 1440, '2560×1440']].map(([w, h, n]) => `<button class="fchip" data-wh="${w},${h}">${n}</button>`).join('')}</div></div>
    <label class="fl">Server automatisch betreten</label><div class="inline"><input class="in" id="isJoin" placeholder="z. B. play.hypixel.net" value="${esc(i.autoJoin || '')}"><button class="btn" id="isPing">${ico('activity')}Testen</button></div>
    <small class="muted" id="isPingR" style="display:block;margin-top:6px;font-size:11.5px">Nach dem Start wirst du direkt verbunden.</small>
    <label class="fl">Launcher beim Spielstart</label><div class="seg" id="isOnl">${[['', 'Wie global'], ['keep', 'Offen lassen'], ['minimize', 'Minimieren'], ['close', 'Ausblenden']].map(([k, n]) => `<button data-o="${k}" class="${k === onl ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  const save = () => isPatch({ width: +$('#isW').value || 0, height: +$('#isH').value || 0 });
  $('#isW').onchange = save; $('#isH').onchange = save;
  m.querySelectorAll('[data-wh]').forEach(b => b.onclick = () => { const [w, h] = b.dataset.wh.split(','); $('#isW').value = w; $('#isH').value = h; save(); });
  $('#isFs').onclick = e => { const on = !e.target.classList.contains('on'); e.target.classList.toggle('on', on); $('#isWin').classList.toggle('dim', on); isPatch({ fullscreen: on }); };
  $('#isJoin').oninput = e => isDeb(() => isPatch({ autoJoin: e.target.value.trim() || null }));
  $('#isPing').onclick = async () => {
    const a = $('#isJoin').value.trim(), o = $('#isPingR'); if (!a) return;
    o.textContent = 'Prüfe…';
    let r; try { r = await api('server.ping', { address: a }); } catch { r = { online: false }; }
    o.innerHTML = r.online ? `<span style="color:#4ade80">● Online</span> · ${num(r.players)}/${num(r.max)} Spieler · ${r.ping} ms` : '<span style="color:#f87171">● Nicht erreichbar</span>';
  };
  $('#isOnl').onclick = e => { const b = e.target.closest('[data-o]'); if (!b) return; $$('#isOnl button').forEach(x => x.classList.toggle('on', x === b)); isPatch({ onLaunch: b.dataset.o || null }); };
}
window.pickJava = async target => { try { const r = await api('java.pick'); if (r?.path) { const el = $('#' + target); el.value = r.path; el.dispatchEvent(new Event('change')); } } catch (e) { fail('Java', e); } };
function setRange(el) { const p = (el.value - el.min) / (el.max - el.min) * 100; el.style.setProperty('--p', p + '%'); }

/* ======================= DISCOVER (two catalogs) ======================= */
const PTYPES = [['modpack', 'Modpacks', 'box'], ['mod', 'Mods', 'puzzle'], ['resourcepack', 'Ressourcenpakete', 'image'], ['shader', 'Shader', 'sun']];
const SORTS = [['relevance', 'Relevanz'], ['downloads', 'Downloads'], ['follows', 'Beliebt'], ['newest', 'Neueste'], ['updated', 'Zuletzt aktualisiert']];
const PLOADERS = { mod: ['fabric', 'forge', 'neoforge', 'quilt'], modpack: ['fabric', 'forge', 'neoforge', 'quilt'], shader: ['iris', 'optifine', 'canvas', 'vanilla'], resourcepack: [] };
const CAT_DE = { adventure: 'Abenteuer', cursed: 'Verflucht', decoration: 'Deko', economy: 'Wirtschaft', equipment: 'Ausrüstung', food: 'Essen', 'game-mechanics': 'Spielmechanik', library: 'Bibliothek', magic: 'Magie', management: 'Verwaltung', minigame: 'Minispiel', mobs: 'Mobs', optimization: 'Optimierung', social: 'Sozial', storage: 'Lager', technology: 'Technik', transportation: 'Transport', utility: 'Werkzeug', worldgen: 'Weltgenerierung', challenging: 'Herausfordernd', combat: 'Kampf', 'kitchen-sink': 'Alles drin', lightweight: 'Leichtgewicht', multiplayer: 'Multiplayer', quests: 'Quests', vanilla: 'Vanilla', realistic: 'Realistisch', simplistic: 'Schlicht', themed: 'Thematisch', tweaks: 'Tweaks', 'vanilla-like': 'Vanilla-ähnlich', cartoon: 'Cartoon', fantasy: 'Fantasy', 'semi-realistic': 'Halb-realistisch', atmosphere: 'Atmosphäre', bloom: 'Bloom', shadows: 'Schatten', pbr: 'PBR', reflections: 'Spiegelungen', 'colored-lighting': 'Farbiges Licht', 'path-tracing': 'Path Tracing', potato: 'Kartoffel-PC', low: 'Schwacher PC', medium: 'Mittlerer PC', high: 'Starker PC', screenshot: 'Screenshot', foliage: 'Pflanzen', gui: 'GUI', fonts: 'Schriften', audio: 'Audio', blocks: 'Blöcke', items: 'Items', entities: 'Entities', environment: 'Umgebung', models: 'Modelle', locale: 'Sprache', 'core-shaders': 'Core-Shader' };
const HEAD_DE = { categories: 'Kategorien', features: 'Funktionen', resolutions: 'Auflösung', 'performance impact': 'Leistungsbedarf' };
const catName = c => CAT_DE[c] || cap(c).replace(/-/g, ' ');
const SRC = { mr: ['Standard', '#1BD96A'], cf: ['Erweitert', '#F16436'] };
const srcChip = s => `<span class="chip src ${s}"><i></i>${SRC[s][0]}</span>`;

/* ---------- extended catalog (official Core API through the host) ---------- */
const CF_CLASS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552 };
const CF_TYPE = { 6: 'mod', 4471: 'modpack', 12: 'resourcepack', 6552: 'shader' };
const CF_LOADER = { 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' }, CF_LT = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const CF_SORT = { relevance: 1, follows: 2, updated: 3, downloads: 6, newest: 11 };
const cfCache = new Map();
function cf(path, cache = true) {
  if (cache && cfCache.has(path)) return cfCache.get(path);
  const p = api('cf.get', { path });
  if (cache) { cfCache.set(path, p); p.catch(() => cfCache.delete(path)); }
  return p;
}
const isCf = id => String(id).startsWith('cf:');
const cfNum = id => +String(id).slice(3);
const cfLoaders = m => [...new Set((m.latestFilesIndexes || []).map(f => CF_LOADER[f.modLoader]).filter(Boolean))];
const cfVersions = m => [...new Set((m.latestFilesIndexes || []).map(f => f.gameVersion).filter(v => /^\d/.test(v)))];
function cfHit(m) {
  return { src: 'cf', project_id: 'cf:' + m.id, title: m.name, author: m.authors?.[0]?.name || '', description: m.summary, icon_url: m.logo?.thumbnailUrl, downloads: m.downloadCount, follows: m.thumbsUpCount || 0,
    date_modified: m.dateModified, categories: cfLoaders(m), display_categories: (m.categories || []).map(c => c.name), featured_gallery: m.screenshots?.[0]?.thumbnailUrl || m.screenshots?.[0]?.url, cfcats: true };
}
function cfProject(m, desc) {
  return { id: 'cf:' + m.id, src: 'cf', slug: m.slug, title: m.name, description: m.summary, body: desc || '', icon_url: m.logo?.thumbnailUrl, downloads: m.downloadCount, followers: m.thumbsUpCount || 0,
    updated: m.dateModified, published: m.dateCreated, categories: (m.categories || []).map(c => c.name), cfcats: true, project_type: CF_TYPE[m.classId] || 'mod',
    gallery: (m.screenshots || []).map((g, i) => ({ url: g.thumbnailUrl || g.url, raw_url: g.url, title: g.title, description: g.description, featured: i === 0, ordering: i })),
    game_versions: cfVersions(m), loaders: cfLoaders(m), issues_url: m.links?.issuesUrl, source_url: m.links?.sourceUrl, wiki_url: m.links?.wikiUrl, website: m.links?.websiteUrl,
    license: null, members: (m.authors || []).map(a => ({ user: { username: a.name, avatar_url: null }, role: 'Autor' })), allow: m.allowModDistribution !== false };
}
function cfVersion(f) {
  const gv = f.gameVersions || [];
  return { id: String(f.id), name: f.displayName, version_number: f.fileName, version_type: ({ 1: 'release', 2: 'beta', 3: 'alpha' })[f.releaseType] || 'release', downloads: f.downloadCount,
    game_versions: gv.filter(v => /^\d/.test(v)), loaders: gv.map(v => v.toLowerCase()).filter(v => LOADERS[v] && v !== 'vanilla'), date_published: f.fileDate, cf: true, dl: !!f.downloadUrl,
    files: [{ filename: f.fileName, size: f.fileLength, primary: true }], dependencies: (f.dependencies || []).filter(d => d.relationType === 3).map(() => ({ dependency_type: 'required' })) };
}

const D = S.disc = { src: 'mr', type: 'mod', q: '', sort: 'relevance', page: 0, per: 20, vers: new Set(), loaders: new Set(), cats: new Set(), env: new Set(), open: false, compat: true, target: null, vq: '', snaps: false, closed: new Set(), view: 'list' };
try { const v = JSON.parse(localStorage.getItem('orbit.disc') || '{}'); if (v.view) D.view = v.view; if (v.src) D.src = v.src; } catch { }
const discSave = () => { try { localStorage.setItem('orbit.disc', JSON.stringify({ view: D.view, src: D.src })); } catch { } };
PAGES.discover = async (el, a) => {
  const tgt = a.target ? instById(a.target) : null;
  if (a.type && a.type !== D.type) { D.type = a.type; D.cats.clear(); D.loaders.clear(); D.page = 0; }
  if ((a.target || null) !== D.target) { D.target = a.target || null; D.page = 0; D.compat = true; }
  if (tgt && D.type === 'modpack') D.type = tgt.loader === 'vanilla' ? 'resourcepack' : 'mod';
  crumbs(tgt ? [['Bibliothek', "go('library')"], [tgt.name, `go('inst',{id:'${jsq(tgt.id)}'})`], ['Inhalte hinzufügen']] : [['Entdecken']]);
  const types = PTYPES.filter(t => !tgt || (t[0] !== 'modpack' && (tgt.loader !== 'vanilla' || t[0] !== 'mod')));
  el.innerHTML = `<div class="ph"><div><div class="kicker">Mod-Katalog</div><h1>Entdecken</h1></div></div>
    ${tgt ? `<div class="tgtbar">${instIcon(tgt)}<div class="tx"><b>Installieren in „${esc(tgt.name)}“</b><small>${esc(instSub(tgt))} · nur passende Inhalte werden angezeigt</small></div><button class="btn sm" onclick="go('inst',{id:'${jsq(tgt.id)}'})">${ico('left')}Zur Instanz</button><button class="ib sm ghost" title="Ohne Ziel" onclick="go('discover',{type:'${D.type}'})">${ico('x')}</button></div>` : ''}
    <div class="dtypes" id="dTypes">${types.map(([k, n, ic]) => `<button data-k="${k}" class="${k === D.type ? 'on' : ''}">${ico(ic)}${n}</button>`).join('')}</div>
    <div class="dgrid"><div class="filters" id="dFil"></div><div>
      <div class="rbar"><div class="srch">${ico('search')}<input class="in" id="dQ" placeholder="${esc(PTYPES.find(t => t[0] === D.type)[1])} durchsuchen…" value="${esc(D.q)}"></div>
        <select class="sel" id="dSort">${SORTS.map(([k, n]) => `<option value="${k}" ${k === D.sort ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <div class="seg vsw" id="dView"><button data-v="list" class="${D.view === 'list' ? 'on' : ''}" title="Liste">${ico('list')}</button><button data-v="grid" class="${D.view === 'grid' ? 'on' : ''}" title="Kacheln">${ico('grid')}</button></div></div>
      <div class="rinfo" id="dInfo"></div><div class="rlist ${D.view}" id="dList"></div><div class="pager" id="dPager"></div></div></div>`;
  // switching the type only reloads filters and results, the page stays
  $('#dTypes').onclick = e => {
    const b = e.target.closest('[data-k]'); if (!b || b.dataset.k === D.type) return;
    D.type = b.dataset.k; D.cats.clear(); D.loaders.clear(); D.page = 0;
    $$('#dTypes button').forEach(x => x.classList.toggle('on', x === b));
    $('#dQ').placeholder = PTYPES.find(t => t[0] === D.type)[1] + ' durchsuchen…';
    const h = S.hist[S.hi]; if (h && h.p === 'discover') h.a = { ...h.a, type: D.type }; S.args = { ...S.args, type: D.type };
    discFilters(); discSearch();
  };
  $('#dView').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; D.view = b.dataset.v; discSave(); $$('#dView button').forEach(x => x.classList.toggle('on', x === b)); $('#dList').className = 'rlist ' + D.view; };
  let t = 0;
  $('#dQ').oninput = e => { clearTimeout(t); t = setTimeout(() => { D.q = e.target.value; D.page = 0; discSearch(); }, 300); };
  $('#dSort').onchange = e => { D.sort = e.target.value; D.page = 0; discSearch(); };
  ensureVersions().catch(() => { }).then(() => discFilters());
  discFilters(); discSearch();
};
async function cfReady() { if (S.cfReady === undefined) { try { S.cfReady = (await api('cf.status')).ready; } catch { S.cfReady = false; } } return S.cfReady; }
async function discFilters() {
  const el = $('#dFil'); if (!el) return;
  const tgt = D.target ? instById(D.target) : null;
  let cats = []; const heads = {};
  try { cats = (await mr('/tag/category')).filter(c => c.project_type === D.type); } catch { }
  cats.forEach(c => (heads[c.header] = heads[c.header] || []).push({ name: c.name, label: catName(c.name), icon: c.icon ? c.icon.replace('<svg', '<svg width="15" height="15"') : '' }));
  if (!$('#dFil')) return;
  const box = (k, title, body) => `<div class="fbox ${D.closed.has(k) ? 'closed' : ''}" data-box="${k}"><button class="fh">${esc(title)}${ico('chevd')}</button><div class="fbody">${body}</div></div>`;
  const opt = (kind, v, label, on, icon = '') => `<button class="fo ${on ? 'on' : ''}" data-f="${kind}" data-v="${esc(v)}"><span class="cb ${on ? 'on' : ''}"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>${icon ? `<span class="ci">${icon}</span>` : ''}${esc(label)}</button>`;
  let html = '';
  if (tgt) html += `<div class="fbox"><div class="fsw"><span>Nur passend zu ${esc(tgt.mcVersion)}${D.type === 'mod' ? ' · ' + esc(LOADERS[tgt.loader]?.[0] || '') : ''}</span><div class="tg sm ${D.compat ? 'on' : ''}" id="dCompat"></div></div></div>`;
  if (!tgt || !D.compat) {
    const rel = S.versions.filter(v => v.type === 'release' || (D.snaps && v.type === 'snapshot')).map(v => v.id), vq = D.vq.trim();
    html += box('ver', 'Spielversion', `<input class="in" id="dVq" placeholder="Version suchen…" value="${esc(D.vq)}">${[...D.vers].filter(v => !rel.includes(v)).concat(rel).filter(v => !vq || v.includes(vq)).slice(0, 120).map(v => opt('ver', v, v, D.vers.has(v))).join('')}<div class="fsw"><span>Snapshots</span><div class="tg sm ${D.snaps ? 'on' : ''}" id="dSnap"></div></div>`);
    if (PLOADERS[D.type].length) html += box('ld', D.type === 'shader' ? 'Shader-Loader' : 'Loader', PLOADERS[D.type].map(l => opt('ld', l, LOADERS[l]?.[0] || cap(l), D.loaders.has(l))).join(''));
  }
  Object.entries(heads).forEach(([h, list]) => { if (list.length) html += box('h:' + h, HEAD_DE[h] || cap(h), list.sort((a, b) => a.label.localeCompare(b.label, 'de')).map(c => opt('cat', c.name, c.label, D.cats.has(c.name), c.icon)).join('')); });
  if (D.type !== 'resourcepack' && D.type !== 'shader') html += box('env', 'Umgebung', opt('env', 'client', 'Client', D.env.has('client')) + opt('env', 'server', 'Server', D.env.has('server')));
  html += `<div class="fbox"><div class="fsw"><span>Nur Open Source</span><div class="tg sm ${D.open ? 'on' : ''}" id="dOpen"></div></div></div>`;
  el.innerHTML = html;
  el.onclick = e => {
    const fh = e.target.closest('.fh'); if (fh) { const b = fh.parentElement, k = b.dataset.box; b.classList.toggle('closed'); b.classList.contains('closed') ? D.closed.add(k) : D.closed.delete(k); return; }
    const o = e.target.closest('[data-f]');
    if (o) { const set = { ver: D.vers, ld: D.loaders, cat: D.cats, env: D.env }[o.dataset.f], v = o.dataset.v; set.has(v) ? set.delete(v) : set.add(v); o.classList.toggle('on', set.has(v)); o.querySelector('.cb').classList.toggle('on', set.has(v)); D.page = 0; discSearch(); return; }
    if (e.target.id === 'dCompat') { D.compat = !D.compat; D.page = 0; discFilters(); discSearch(); }
    if (e.target.id === 'dOpen') { D.open = !D.open; e.target.classList.toggle('on'); D.page = 0; discSearch(); }
    if (e.target.id === 'dSnap') { D.snaps = !D.snaps; discFilters(); }
  };
  const vq = $('#dVq'); if (vq) vq.oninput = e => { D.vq = e.target.value; const pos = e.target.selectionStart; discFilters().then(() => { const n = $('#dVq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); };
}
/* both catalogs are searched together; categories are matched to the second catalog by name */
const CF_CAT_WORDS = { adventure: ['adventure', 'exploration'], technology: ['tech'], magic: ['magic'], storage: ['storage'], optimization: ['performance', 'lightweight', 'small'], utility: ['utility', 'qol'], worldgen: ['world gen', 'biomes', 'dimensions', 'structures'], mobs: ['mobs'], food: ['food', 'farming'], equipment: ['armor', 'weapons'], library: ['library', 'api'], decoration: ['cosmetic', 'decoration'], transportation: ['transport'], management: ['map and information'], minigame: ['mini'], quests: ['quest'], 'kitchen-sink': ['kitchen'], multiplayer: ['multiplayer'], combat: ['combat', 'pvp'], challenging: ['hardcore'], lightweight: ['small', 'light'], 'game-mechanics': ['mechanics'], economy: ['economy'], social: ['social'], themed: ['themed'], realistic: ['realistic'], simplistic: ['simplistic'], 'vanilla-like': ['vanilla'] };
async function cfCatIds() {
  if (!D.cats.size) return [];
  let cats = []; try { cats = (await cf(`/categories?gameId=432&classId=${CF_CLASS[D.type]}`)).data.filter(c => !c.isClass); } catch { return null; }
  const ids = new Set();
  for (const c of D.cats) {
    const words = CF_CAT_WORDS[c] || [c.replace(/-/g, ' ')];
    const hit = cats.filter(k => words.some(w => k.name.toLowerCase().includes(w)));
    if (!hit.length) return null;            // can't match this filter there → only the first catalog
    hit.forEach(k => ids.add(k.id));
  }
  return [...ids].slice(0, 10);
}
async function cfSearchPath(per, page) {
  const tgt = D.target ? instById(D.target) : null, lock = tgt && D.compat;
  if (D.env.size || D.open) return null;      // filters the second catalog doesn't have
  const ids = await cfCatIds(); if (ids === null) return null;
  let q = `/mods/search?gameId=432&classId=${CF_CLASS[D.type]}&sortField=${CF_SORT[D.sort]}&sortOrder=desc&index=${page * per}&pageSize=${per}`;
  if (D.q.trim()) q += '&searchFilter=' + encodeURIComponent(D.q.trim());
  const ver = lock ? tgt.mcVersion : [...D.vers][0]; if (ver) q += '&gameVersion=' + encodeURIComponent(ver);
  const lds = (lock ? (D.type === 'mod' && CF_LT[tgt.loader] ? [tgt.loader] : []) : [...D.loaders]).filter(l => CF_LT[l]);
  if (lds.length === 1) q += '&modLoaderType=' + CF_LT[lds[0]]; else if (lds.length) q += '&modLoaderTypes=' + encodeURIComponent(JSON.stringify(lds.map(l => CF_LT[l])));
  if (ids.length) q += '&categoryIds=' + encodeURIComponent(JSON.stringify(ids));
  return q;
}
function mrSearchPath(per, page) {
  const tgt = D.target ? instById(D.target) : null, lock = tgt && D.compat;
  const f = [[`project_type:${D.type}`]];
  if (lock) { f.push([`versions:${tgt.mcVersion}`]); if (D.type === 'mod') f.push(tgt.loader === 'quilt' ? ['categories:quilt', 'categories:fabric'] : [`categories:${tgt.loader}`]); }
  else { if (D.vers.size) f.push([...D.vers].map(v => `versions:${v}`)); if (D.loaders.size) f.push([...D.loaders].map(l => `categories:${l}`)); }
  D.cats.forEach(c => f.push([`categories:${c}`]));
  if (D.env.has('client')) f.push(['client_side:required', 'client_side:optional']);
  if (D.env.has('server')) f.push(['server_side:required', 'server_side:optional']);
  if (D.open) f.push(['open_source:true']);
  return `/search?limit=${per}&offset=${page * per}&index=${D.sort}${D.q.trim() ? '&query=' + encodeURIComponent(D.q.trim()) : ''}&facets=${encodeURIComponent(JSON.stringify(f))}`;
}
const normTitle = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function mergeHits(a, b) {
  const q = normTitle(D.q);
  let out;
  if (D.sort === 'downloads') out = [...a, ...b].sort((x, y) => (y.downloads || 0) - (x.downloads || 0));
  else if (D.sort === 'newest' || D.sort === 'updated') out = [...a, ...b].sort((x, y) => new Date(y.date_modified || 0) - new Date(x.date_modified || 0));
  else { out = []; for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]); } }
  if (q && D.sort === 'relevance') out.sort((x, y) => (normTitle(y.title) === q) - (normTitle(x.title) === q));
  // the same project on both: keep the bigger one
  const seen = new Map();
  for (const h of out) { const k = normTitle(h.title); const o = seen.get(k); if (!o || (h.downloads || 0) > (o.downloads || 0)) seen.set(k, h); }
  return out.filter(h => seen.get(normTitle(h.title)) === h);
}
let dSeq = 0;
async function discSearch() {
  const list = $('#dList'); if (!list) return;
  const seq = ++dSeq, half = Math.round(D.per / 2);
  list.innerHTML = `<div class="skel"></div>`.repeat(D.view === 'grid' ? 6 : 5);
  const useCf = await cfReady();
  const cfPath = useCf ? await cfSearchPath(half, D.page) : null;
  const [m, c] = await Promise.allSettled([mr(mrSearchPath(cfPath ? half : D.per, D.page)), cfPath ? cf(cfPath) : Promise.reject(new Error('aus'))]);
  if (seq !== dSeq || !$('#dList')) return;
  if (m.status === 'rejected' && c.status === 'rejected') { list.innerHTML = `<div class="empty">Der Katalog ist gerade nicht erreichbar: ${esc(m.reason?.message || '')}</div>`; return; }
  const mh = m.status === 'fulfilled' ? m.value.hits.map(h => ({ ...h, src: 'mr' })) : [];
  const ch = c.status === 'fulfilled' ? c.value.data.map(cfHit) : [];
  const mt = m.status === 'fulfilled' ? m.value.total_hits : 0, ct = c.status === 'fulfilled' ? Math.min(c.value.pagination.totalCount, 10000) : 0;
  const hits = mergeHits(mh, ch), total = mt + ct, per = cfPath && c.status === 'fulfilled' ? half : D.per;
  const chips = [...D.vers].map(v => ['ver', v, v]).concat([...D.loaders].map(l => ['ld', l, LOADERS[l]?.[0] || cap(l)]), [...D.cats].map(c2 => ['cat', c2, catName(c2)]), [...D.env].map(e => ['env', e, cap(e)]));
  $('#dInfo').innerHTML = `<span><b style="color:var(--text)">${total.toLocaleString('de-DE')}</b> Ergebnisse</span>${chips.map(([k, v, n]) => `<button class="fchip on" data-rm="${k}" data-v="${esc(v)}">${esc(n)}${ico('x')}</button>`).join('')}${chips.length ? '<button class="fchip" data-clr>Alle Filter entfernen</button>' : ''}`;
  $('#dInfo').onclick = e => {
    if (e.target.closest('[data-clr]')) { D.vers.clear(); D.loaders.clear(); D.cats.clear(); D.env.clear(); }
    const b = e.target.closest('[data-rm]'); if (b) ({ ver: D.vers, ld: D.loaders, cat: D.cats, env: D.env })[b.dataset.rm].delete(b.dataset.v);
    if (b || e.target.closest('[data-clr]')) { D.page = 0; discFilters(); discSearch(); }
  };
  list.innerHTML = hits.length ? hits.map(pcard).join('') : `<div class="lempty"><span class="iic">${ico('search')}</span><h2>Nichts gefunden</h2><p>Versuch einen anderen Suchbegriff oder weniger Filter.</p></div>`;
  const pages = Math.min(500, Math.ceil(Math.max(mt, ct) / per)), cur = D.page;
  const nums = [...new Set([0, cur - 1, cur, cur + 1, pages - 1])].filter(n => n >= 0 && n < pages).sort((a, b) => a - b);
  $('#dPager').innerHTML = pages > 1 ? `<button ${cur ? '' : 'disabled'} data-pg="${cur - 1}">${ico('left')}</button>${nums.map((n, i) => (i && n - nums[i - 1] > 1 ? '<span>…</span>' : '') + `<button class="${n === cur ? 'on' : ''}" data-pg="${n}">${n + 1}</button>`).join('')}<button ${cur < pages - 1 ? '' : 'disabled'} data-pg="${cur + 1}">${ico('right')}</button>` : '';
  $('#dPager').onclick = e => { const b = e.target.closest('[data-pg]'); if (!b) return; D.page = +b.dataset.pg; discSearch(); $('#p-discover').scrollTop = 0; };
}
window.saveCfKey = async () => {
  const k = $('#cfKeyIn')?.value.trim(); if (!k) return;
  await setS('curseForgeKey', k); S.cfReady = undefined;
  if (await cfReady()) { toast('Katalog verbunden'); go(S.page, S.args, false); } else fail('Katalog', 'Schlüssel wird nicht angenommen');
};
const isInstalled = (inst, pid) => inst && (inst.content || []).some(c => c.projectId === pid);
function pcard(h) {
  const tgt = D.target ? instById(D.target) : null, inst = isInstalled(tgt, h.project_id);
  const lds = (h.categories || []).filter(c => LOADERS[c] || ['iris', 'optifine', 'canvas'].includes(c));
  const cats = (h.display_categories || h.categories || []).filter(c => !lds.includes(c)).slice(0, 3);
  const cover = h.featured_gallery || h.gallery?.[0];
  return `<div class="pcard tilt" onclick="go('project',{id:'${jsq(h.project_id)}'${D.target ? `,target:'${jsq(D.target)}'` : ''}})">
    <span class="pcov ${cover ? '' : 'nocov'}" style="${cover ? `background-image:url('${esc(cover)}')` : ''}">${cover ? '' : coverFb(h)}</span>${picHtml(h.icon_url)}
    <div class="tx"><h3>${esc(h.title)}<small>von ${esc(h.author)}</small></h3><p>${esc(h.description)}</p>
      <div class="tags">${cats.map(c => `<span class="chip m">${ico('tag')}${esc(h.cfcats ? c : catName(c))}</span>`).join('')}${lds.map(l => LOADERS[l] ? loaderChip(l) : `<span class="chip m">${esc(cap(l))}</span>`).join('')}</div></div>
    <div class="rs"><div class="stats"><span class="stat">${ico('download')}<b>${num(h.downloads)}</b></span><span class="stat">${ico(h.src === 'cf' ? 'star' : 'heart')}<b>${num(h.follows)}</b></span><span class="stat">${ico('refresh')}${esc(ago(h.date_modified))}</span></div>
      ${inst ? `<button class="btn sm ok" title="Installiert">${ico('check')}Installiert</button>` : `<button class="btn sm p" title="Installieren" onclick="event.stopPropagation();installProject('${jsq(h.project_id)}',this)">${ico('download')}Installieren</button>`}</div></div>`;
}

/* ---------- install flow ---------- */
const typeOfInst = t => t === 'shader' ? 'shader' : t === 'resourcepack' ? 'resourcepack' : 'mod';
function compatible(inst, p) {
  if (!inst) return false;
  if (p.game_versions?.length && !p.game_versions.includes(inst.mcVersion)) return false;
  if (p.project_type === 'mod') { const l = p.loaders || []; if (!(l.includes(inst.loader) || (inst.loader === 'quilt' && l.includes('fabric')))) return false; }
  return true;
}
async function loadProject(id) {
  if (isCf(id)) { const [m, d] = await Promise.all([cf(`/mods/${cfNum(id)}`), cf(`/mods/${cfNum(id)}/description`).catch(() => ({ data: '' }))]); return cfProject(m.data, d.data); }
  return { ...(await mr('/project/' + id)), src: 'mr' };
}
async function installProject(pid, btn, versionId) {
  let p;
  try { p = await loadProject(pid); } catch (e) { return fail('Katalog', e); }
  if (p.project_type === 'modpack') return installModpack(p, versionId, btn);
  const tgt = D.target && S.page !== 'home' ? instById(D.target) : null;
  if (tgt && !(S.page === 'project' && !S.args.target)) return installInto(tgt, p, versionId, btn);
  pickInstance(p, versionId);
}
window.installProject = installProject;
async function installInto(inst, p, versionId, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = ico('refresh', 'i spin') + 'Installiere…'; }
  try {
    const r = p.src === 'cf' ? await api('cf.install', { id: inst.id, project: cfNum(p.id), file: versionId ? +versionId : 0 })
      : await api('mr.install', { id: inst.id, project: p.id, type: typeOfInst(p.project_type), version: versionId || null });
    toast('Installiert', `${r.installed.join(', ')} → ${inst.name}${r.skipped.length ? ' · übersprungen: ' + r.skipped.join(', ') : ''}`);
    if (btn) { btn.className = btn.className.replace(' p', '') + ' ok'; btn.disabled = false; btn.innerHTML = ico('check') + 'Installiert'; }
    if (S.content?.id === inst.id) S.content.loaded = false;
    await refreshInstances();
    return true;
  } catch (e) { if (btn) { btn.disabled = false; btn.innerHTML = ico('download') + 'Installieren'; } fail('Installation fehlgeschlagen', e); return false; }
}
async function installModpack(p, versionId, btn) {
  if (!await confirmBox('Modpack installieren?', `„${p.title}“ wird als neue Instanz angelegt. Alle Dateien kommen direkt von der Quelle des Modpacks.`, 'Installieren')) return;
  if (btn) { btn.disabled = true; btn.innerHTML = ico('refresh', 'i spin') + 'Installiere…'; }
  try {
    const inst = p.src === 'cf' ? await api('cf.modpack', { project: cfNum(p.id), file: versionId ? +versionId : 0 }) : await api('mr.modpack', { project: p.id, version: versionId || null });
    toast('Modpack bereit', inst.name); await refreshInstances(); go('inst', { id: inst.id });
  } catch (e) { fail('Modpack fehlgeschlagen', e); if (btn) { btn.disabled = false; btn.innerHTML = ico('download') + 'Installieren'; } }
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
  try { p = await loadProject(a.id); } catch (e) { el.innerHTML = e.message === 'NO_CF_KEY' ? '<div id="pNoKey"></div>' : `<div class="empty">Projekt nicht gefunden: ${esc(e.message)}</div>`; if ($('#pNoKey')) cfNoKey($('#pNoKey')); return; }
  if (S.args.id !== a.id) return;
  S.proj = { p, tab: a.tab || 'desc', versions: null, members: p.members || null, vf: { ld: '', mc: '', ch: '' } };
  const tname = PTYPES.find(t => t[0] === p.project_type)?.[1] || 'Projekte';
  crumbs(tgt ? [[tgt.name, `go('inst',{id:'${jsq(tgt.id)}'})`], ['Hinzufügen', `go('discover',{type:'${p.project_type}',target:'${jsq(tgt.id)}'})`], [p.title]] : [['Entdecken', "go('discover')"], [tname, `go('discover',{type:'${p.project_type}'})`], [p.title]]);
  const inst = isInstalled(tgt, p.id), cover = p.gallery?.find(g => g.featured)?.raw_url || p.gallery?.[0]?.raw_url || p.gallery?.[0]?.url;
  const web = p.src === 'cf' ? p.website : `https://modrinth.com/${p.project_type}/${p.slug}`;
  el.innerHTML = `<div class="phero">${cover ? `<div class="ph-bg" style="background-image:url('${esc(cover)}')"></div>` : '<div class="ph-bg none"></div>'}
    <div class="phead">${picHtml(p.icon_url)}<div class="tx"><div class="kicker">${esc(tname)}</div><h1>${esc(p.title)}</h1><p class="d">${esc(p.description)}</p>
      <div class="meta"><span class="stat">${ico('download')}<b>${num(p.downloads)}</b> Downloads</span><span class="stat">${ico(p.src === 'cf' ? 'star' : 'heart')}<b>${num(p.followers)}</b> ${p.src === 'cf' ? 'Daumen hoch' : 'Follower'}</span><span class="stat">${ico('refresh')}Aktualisiert ${esc(ago(p.updated).replace('Vor', 'vor'))}</span>
        ${(p.categories || []).slice(0, 4).map(c => `<span class="chip m">${esc(p.cfcats ? c : catName(c))}</span>`).join('')}</div></div>
    <div class="acts">${inst ? `<button class="btn lg ok">${ico('check')}Installiert</button>` : `<button class="btn lg p glow" id="pInst">${ico('download')}${tgt ? 'In ' + esc(tgt.name) : 'Installieren'}</button>`}
</div></div></div>
    ${p.src === 'cf' && !p.allow ? '<div class="note w" style="margin-top:14px">Der Autor erlaubt Downloads nur über seine eigene Website. OrbitLauncher öffnet dann die Download-Seite, statt die Datei selbst zu laden.</div>' : ''}
    <div class="itabs" id="pTabs" style="margin-top:18px"></div>
    <div class="pgrid"><div id="pBody"></div><div class="pside" id="pSide"></div></div>`;
  if ($('#pInst')) $('#pInst').onclick = () => installProject(p.id, $('#pInst'));
  $('#pTabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { S.proj.tab = b.dataset.t; S.hist[S.hi].a = { ...a, tab: b.dataset.t }; projTabs(); } };
  projTabs(); projSide();
  const vp = p.src === 'cf' ? cf(`/mods/${cfNum(p.id)}/files?pageSize=50`).then(r => r.data.map(cfVersion)) : mr(`/project/${p.id}/version`);
  vp.then(v => { if (S.proj?.p !== p) return; S.proj.versions = v; projTabs(true); projSide(); }).catch(() => { });
  if (p.src === 'mr') mr(`/project/${p.id}/members`).then(m => { if (S.proj?.p !== p) return; S.proj.members = m; projSide(); }).catch(() => { });
};
function projTabs(soft) {
  const P = S.proj, p = P.p;
  const t = [['desc', 'Beschreibung', 'book'], ['versions', 'Versionen', 'layers', P.versions?.length], ['gallery', 'Galerie', 'image', p.gallery?.length]].filter(x => x[0] !== 'gallery' || p.gallery?.length);
  $('#pTabs').innerHTML = t.map(([k, n, ic, c]) => `<button data-t="${k}" class="${P.tab === k ? 'on' : ''}">${ico(ic)}${n}${c ? `<span class="c">${c}</span>` : ''}</button>`).join('');
  if (soft && P.tab !== 'versions') return;
  const b = $('#pBody');
  if (P.tab === 'desc') { b.innerHTML = `<div class="md pdesc" id="pMd">${mdRender(p.body || p.description || '')}</div>`; mdStructure($('#pMd')); mdBind($('#pMd')); }
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
    ${list.slice(0, 150).map(v => `<div class="vr2" data-v="${esc(v.id)}"><span class="vtype ${v.version_type}">${v.version_type[0].toUpperCase()}</span><div><b>${esc(v.name || v.version_number)}</b><small>${esc(v.version_number)}</small></div>
      <div class="chips">${v.loaders.slice(0, 3).map(l => LOADERS[l] ? loaderChip(l) : `<span class="chip m">${esc(cap(l))}</span>`).join('')}<span class="chip m">${esc(summarizeVersions(v.game_versions))}</span></div>
      <span class="stat">${num(v.downloads)}</span><span class="stat">${esc(dateDe(v.date_published))}</span></div>`).join('') || '<div class="vr2"><span></span><span class="muted">Keine Version passt zu den Filtern.</span></div>'}</div>`;
  $('#vfLd').onchange = e => { f.ld = e.target.value; projVersions(); };
  $('#vfMc').onchange = e => { f.mc = e.target.value; projVersions(); };
  $('#vfCh').onchange = e => { f.ch = e.target.value; projVersions(); };
  b.querySelector('.vt').onclick = e => { const r = e.target.closest('[data-v]'); if (r) versionDetail(V.find(v => v.id === r.dataset.v)); };
}
window.projVersions = projVersions;
async function versionDetail(v) {
  const p = S.proj.p;
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button><div class="kicker">${esc(cap(v.version_type))} · ${esc(dateDe(v.date_published))}</div><h1>${esc(v.name || v.version_number)}</h1>
    <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px">${v.loaders.map(l => LOADERS[l] ? loaderChip(l) : `<span class="chip m">${esc(cap(l))}</span>`).join('')}<span class="chip m">${esc(summarizeVersions(v.game_versions))}</span><span class="chip m">${ico('download')}${num(v.downloads)}</span>${v.dependencies?.filter(d => d.dependency_type === 'required').length ? `<span class="chip a">${v.dependencies.filter(d => d.dependency_type === 'required').length} Abhängigkeit(en)</span>` : ''}</div>
    <div class="vdet"><label class="fl">Änderungen</label><div class="md" id="vdMd">${v.cf ? '<div class="spinner"></div>' : v.changelog ? mdRender(v.changelog) : '<p class="muted">Kein Changelog.</p>'}</div>
    <div class="files">${v.files.map(fl => `<div class="fr">${ico('file')}<span class="ell" style="flex:1">${esc(fl.filename)}</span><span class="muted">${bytes(fl.size)}</span>${fl.primary ? '<span class="chip a">Haupt</span>' : ''}</div>`).join('')}</div></div>
    <div class="act" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">Schließen</button><button class="btn p" id="vdInst">${ico('download')}Diese Version installieren</button></div>`, 'form');
  mdBind($('#vdMd'));
  $('#vdInst').onclick = () => { closeModal(); installProject(p.id, null, v.id); };
  if (v.cf) { try { const c = await cf(`/mods/${cfNum(p.id)}/files/${v.id}/changelog`); if ($('#vdMd')) $('#vdMd').innerHTML = mdRender(c.data || '<p class="muted">Kein Changelog.</p>'); } catch { if ($('#vdMd')) $('#vdMd').innerHTML = '<p class="muted">Kein Changelog.</p>'; } }
}
function projSide() {
  const P = S.proj, p = P.p, el = $('#pSide'); if (!el) return;
  const env = s => ({ required: 'Benötigt', optional: 'Optional', unsupported: 'Nein' })[s] || '—';
  const links = [[p.issues_url, 'Fehler melden', 'bug'], [p.source_url, 'Quellcode', 'code'], [p.wiki_url, 'Wiki', 'book'], [p.discord_url, 'Discord', 'chat']].concat((p.donation_urls || []).map(d => [d.url, 'Unterstützen (' + d.platform + ')', 'heart'])).filter(l => l[0]);
  el.innerHTML = `<div class="pbox"><h4>Kompatibilität</h4><div class="kv"><span>Minecraft</span><b>${esc(summarizeVersions(p.game_versions || []))}</b></div>
      ${p.loaders?.length ? `<div class="kv"><span>Plattformen</span><b></b></div><div class="chips">${p.loaders.map(l => LOADERS[l] ? loaderChip(l) : `<span class="chip m">${esc(cap(l))}</span>`).join('')}</div>` : ''}
      ${p.src === 'mr' && p.project_type !== 'resourcepack' && p.project_type !== 'shader' ? `<div class="kv" style="margin-top:6px"><span>Client</span><b>${env(p.client_side)}</b></div><div class="kv"><span>Server</span><b>${env(p.server_side)}</b></div>` : ''}</div>
    ${links.length ? `<div class="pbox"><h4>Links</h4>${links.map(([u, n, ic]) => `<button class="ln" onclick="openUrl('${jsq(u)}')">${ico(ic)}${esc(n)}</button>`).join('')}</div>` : ''}
    ${P.members ? `<div class="pbox"><h4>Ersteller</h4>${P.members.slice(0, 8).map(m => `<div class="mem">${picHtml(m.user.avatar_url, 'pic', 'user')}<div><b>${esc(m.user.username)}</b><small>${esc(m.role)}</small></div></div>`).join('')}</div>` : ''}
    <div class="pbox"><h4>Details</h4>${p.src === 'mr' ? `<div class="kv"><span>Lizenz</span><b>${esc(p.license?.id === 'LicenseRef-All-Rights-Reserved' ? 'Alle Rechte vorbehalten' : p.license?.id || '—')}</b></div>` : ''}<div class="kv"><span>Veröffentlicht</span><b>${esc(dateDe(p.published))}</b></div><div class="kv"><span>Aktualisiert</span><b>${esc(dateDe(p.updated))}</b></div>${P.versions ? `<div class="kv"><span>Versionen</span><b>${P.versions.length}</b></div>` : ''}</div>`;
}

/* ---------- markdown + HTML (project bodies mix both) → sanitized ---------- */
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
  // reference-style links: [text][1] … [1]: https://…
  const refs = {};
  src = String(src).replace(/\r/g, '').replace(/^ {0,3}\[([^\]\n]+)\]:\s*<?(\S+?)>?(?:\s+["'(].*["')])?\s*$/gm, (_, k, u) => { refs[k.toLowerCase()] = u; return ''; });
  if (Object.keys(refs).length) src = src.replace(/(!?)\[((?:[^\[\]\n]|\[[^\]\n]*\])*)\]\[([^\]\n]*)\]/g, (m, bang, t, k) => { const u = refs[(k || t).toLowerCase()]; return u ? `${bang}[${t}](${u})` : m; });
  const lines = src.split('\n'), out = [];
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
/** Gives a rendered project description structure: button rows, centered media, feature cards per section. */
function mdStructure(root) {
  if (!root) return;
  const blank = n => (n.nodeType === 3 && !n.textContent.trim()) || n.nodeName === 'BR';
  const isImgLink = k => (k.nodeName === 'A' && k.querySelector('img') && !k.textContent.trim()) || k.nodeName === 'IMG' || k.nodeName === 'PICTURE';
  root.querySelectorAll('p, center, div[align]').forEach(p => {
    const kids = [...p.childNodes].filter(n => !blank(n));
    if (!kids.length || !kids.every(isImgLink)) return;
    if (kids.length >= 2) { p.classList.add('mdbadges'); return; }
    p.classList.add('mdfig');
    if (/youtube\.com|youtu\.be/.test(kids[0].getAttribute?.('href') || '')) p.classList.add('mdvid');
  });
  const lead = [...root.children].find(k => k.tagName === 'P' && !k.className && k.textContent.trim().length > 30);
  if (lead && ![...root.children].slice(0, [...root.children].indexOf(lead)).some(k => /^H\d$/.test(k.tagName))) lead.classList.add('mdlead');
  const secs = []; let cur = null;
  for (const k of [...root.children]) {
    if (/^H[23]$/.test(k.tagName)) { cur = document.createElement('section'); cur.className = 'mdsec ' + k.tagName.toLowerCase(); k.before(cur); cur.append(k); secs.push(cur); }
    else if (k.tagName === 'H1' || k.tagName === 'HR') cur = null;
    else if (cur) cur.append(k);
  }
  // short neighbouring sub-sections become a grid of cards
  let run = [];
  const small = x => x.classList.contains('h3') && x.textContent.length < 1100 && !x.querySelector('table,pre,.mdfig img');
  const flush = () => { if (run.length >= 2) { const g = document.createElement('div'); g.className = 'mdcards'; run[0].before(g); run.forEach(x => g.append(x)); } run = []; };
  for (const x of secs) {
    if (small(x) && run.length && run[run.length - 1].nextElementSibling === x) run.push(x);
    else { flush(); if (small(x)) run = [x]; }
  }
  flush();
  // FAQ-style blockquotes: **Q**: … → question / answer
  root.querySelectorAll('blockquote').forEach(b => { if (/^\s*Q\s*:/i.test(b.textContent)) b.classList.add('mdqa'); });
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
  const face = (fw, fh, fu, fv, tr, ssx, ssy) => `<div class="f" style="width:${fw * U}px;height:${fh * U}px;margin:${-fh * U / 2}px 0 0 ${-fw * U / 2}px;background-image:${tex.url === '@var' ? 'var(--skt)' : `url('${tex.url}')`};background-size:${64 * U}px ${tex.h * U}px;background-position:${-fu * U}px ${-fv * U}px;transform:translate3d(${ox}px,${oy}px,${oz}px) ${tr} scale(${ssx},${ssy})"${tex.url === '@var' ? ` data-u="${fu}" data-v="${fv}" data-w="${fw}" data-h="${fh}"` : ''}></div>`;
  return face(w, h, u + d, v + d, `translateZ(${Dp / 2}px)`, sx, sy)
    + face(w, h, u + 2 * d + w, v + d, `rotateY(180deg) translateZ(${Dp / 2}px)`, sx, sy)
    + face(d, h, u, v + d, `rotateY(-90deg) translateZ(${W / 2}px)`, sz, sy)
    + face(d, h, u + d + w, v + d, `rotateY(90deg) translateZ(${W / 2}px)`, sz, sy)
    + face(w, d, u + d, v, `rotateX(90deg) translateZ(${H / 2}px)`, sx, sz)
    + face(w, d, u + d + w, v, `rotateX(-90deg) translateZ(${H / 2}px)`, sx, sz);
}
function skinModel(url, slim, U = 8, legacy = false, cape = null) {
  const tex = { url: esc(url), h: legacy ? 32 : 64 }, aw = slim ? 3 : 4, ax = 4 + aw / 2;
  const part = (cls, px, py, inner) => `<div class="pt ${cls}" style="transform:translate3d(${px * U}px,${py * U}px,0)">${inner}</div>`;
  // part pivots: head at neck, arms at shoulders, legs at hips (y down, model center = 0)
  const head = cuboid(8, 8, 8, 0, 0, U, tex, 0, -4 * U, 0) + `<div class="ov">${cuboid(8, 8, 8, 32, 0, U, tex, 0, -4 * U, 0, 1)}</div>`;
  const body = cuboid(8, 12, 4, 16, 16, U, tex, 0, 6 * U, 0) + (legacy ? '' : `<div class="ov">${cuboid(8, 12, 4, 16, 32, U, tex, 0, 6 * U, 0, .5)}</div>`);
  const rArm = cuboid(aw, 12, 4, 40, 16, U, tex, 0, 4 * U, 0) + (legacy ? '' : `<div class="ov">${cuboid(aw, 12, 4, 40, 32, U, tex, 0, 4 * U, 0, .5)}</div>`);
  const lArm = legacy ? cuboid(aw, 12, 4, 40, 16, U, tex, 0, 4 * U, 0) : cuboid(aw, 12, 4, 32, 48, U, tex, 0, 4 * U, 0) + `<div class="ov">${cuboid(aw, 12, 4, 48, 48, U, tex, 0, 4 * U, 0, .5)}</div>`;
  const rLeg = cuboid(4, 12, 4, 0, 16, U, tex, 0, 6 * U, 0) + (legacy ? '' : `<div class="ov">${cuboid(4, 12, 4, 0, 32, U, tex, 0, 6 * U, 0, .5)}</div>`);
  const lLeg = legacy ? cuboid(4, 12, 4, 0, 16, U, tex, 0, 6 * U, 0) : cuboid(4, 12, 4, 16, 48, U, tex, 0, 6 * U, 0) + `<div class="ov">${cuboid(4, 12, 4, 0, 48, U, tex, 0, 6 * U, 0, .5)}</div>`;
  const cp = cape ? `<div class="pt cp" style="transform:translate3d(0,${-8 * U}px,${-2.6 * U}px) rotateX(-12deg) rotateY(180deg)">${cuboid(10, 16, 1, 0, 0, U, { url: esc(cape), h: 32 }, 0, 8 * U, 0)}</div>` : '';
  return `<div class="mcm">${cp}${part('hd', 0, -8, head)}${part('bd', 0, -8, body)}${part('ra', -ax, -6, rArm)}${part('la', ax, -6, lArm)}${part('rl', -2, 4, rLeg)}${part('ll', 2, 4, lLeg)}</div>`;
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
  S.skTab = S.skTab || 'lib';
  el.innerHTML = `<div class="ph"><div>${acc ? `<div class="kicker">${esc(acc.name)}</div>` : ''}<h1>Skins</h1></div>
    <div class="ph-r"><div class="seg sktabs" id="skTabs">${[['lib', 'Meine Skins', 'library'], ['editor', 'Editor', 'edit'], ['col', 'Sammlung', 'grid']].map(([k, n, ic]) => `<button data-k="${k}" class="${S.skTab === k ? 'on' : ''}">${ico(ic)}${n}</button>`).join('')}</div></div></div><div id="skBody"></div>`;
  $('#skTabs').onclick = e => { const b = e.target.closest('[data-k]'); if (!b || b.dataset.k === S.skTab) return; S.skTab = b.dataset.k; go('skins', {}, false); };
  if (S.skTab === 'editor') return skEditorPage($('#skBody'));
  if (S.skTab === 'col') { if (!S.skins) S.skins = { lib: await api('skins.list').catch(() => []), prof: null }; return skCollectionPage($('#skBody')); }
  $('#skBody').innerHTML = `
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
  const capeOn = S.skins.capePrev !== undefined ? S.skins.capePrev : S.skins.prof?.capes?.find(c => c.state === 'ACTIVE')?.url;
  st.innerHTML = '<span class="floor"></span>' + skinModel(s.url, s.variant === 'slim', 9, h === 32, capeOn ? capeOn.replace('http://', 'https://') : null);
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
    ${K.prof && !K.prof.error ? `<div class="sec" style="margin-top:0"><h2>Umhänge</h2><span class="muted">${capes.length}</span></div>
    ${capes.length ? `<div class="capes" id="skCapes"><button class="capeb ${capes.some(c => c.state === 'ACTIVE') ? '' : 'on'}" data-cape=""><i class="none"></i><span>Keiner</span></button>${capes.map(c => `<button class="capeb ${c.state === 'ACTIVE' ? 'on' : ''}" data-cape="${esc(c.id)}" data-curl="${esc(c.url.replace('http://', 'https://'))}" title="Drüberfahren für Vorschau"><i style="background-image:url('${esc(c.url.replace('http://', 'https://'))}')"></i><span class="ell">${esc(c.alias || 'Umhang')}</span>${c.state === 'ACTIVE' ? '<em>Aktiv</em>' : ''}</button>`).join('')}</div>` : `<div class="capenone">${ico('shield')}<div><b>Noch keine Umhänge</b><p>Sobald dein Konto einen hat, kannst du ihn hier wählen.</p></div></div>`}` : ''}
    <div class="sec" ${K.prof && !K.prof.error ? '' : 'style="margin-top:0"'}><h2>Deine Skins</h2><span class="muted">${K.lib.length}</span></div>
    <div class="sklib" id="skLib"><button class="skc add" id="skAdd"><span>${ico('plus')}<b>Skin hinzufügen</b><small>PNG, 64×64</small></span></button>
      ${active ? card('__cur', 'Aktueller Skin', active.url.replace('http://', 'https://'), active.variant === 'SLIM' ? 'slim' : 'classic', '<span class="badge">AKTIV</span>') : ''}
      ${K.lib.map(x => card(x.id, x.name, x.url, x.variant, `<span class="act"><button class="ib sm" data-edit="${esc(x.id)}" title="Im Editor öffnen">${ico('palette')}</button><button class="ib sm" data-ren="${esc(x.id)}" title="Umbenennen">${ico('edit')}</button><button class="ib sm d" data-del="${esc(x.id)}" title="Löschen">${ico('trash')}</button></span>`)).join('')}
      ${!K.lib.length && !active ? card('__def', 'Orbit (Vorlage)', demoSkin(0), 'classic') : ''}</div>`;
  $('#skLib').onclick = async e => {
    if (e.target.closest('#skAdd')) { try { const x = await api('skins.add', { variant: 'classic' }); if (x) { K.lib.unshift(x); K.sel = x.id; skinSide(); skinShow(); } } catch (er) { fail('Skin', er); } return; }
    const del = e.target.closest('[data-del]'); if (del) { e.stopPropagation(); if (!await confirmBox('Skin löschen?', 'Er wird aus deiner Bibliothek entfernt.', 'Löschen', true)) return; await api('skins.remove', { id: del.dataset.del }); K.lib = K.lib.filter(x => x.id !== del.dataset.del); if (K.sel === del.dataset.del) K.sel = null; skinSide(); skinShow(); return; }
    const ed = e.target.closest('[data-edit]'); if (ed) { e.stopPropagation(); const x = K.lib.find(y => y.id === ed.dataset.edit); await seLoad(x.url, x.name, x.variant, x.id); SE.loaded = true; S.skTab = 'editor'; return go('skins', {}, false); }
    const ren = e.target.closest('[data-ren]'); if (ren) { e.stopPropagation(); const x = K.lib.find(y => y.id === ren.dataset.ren); const n = await promptBox('Umbenennen', 'Name', x.name); if (n) { x.name = n; api('skins.update', { id: x.id, name: n }); skinSide(); skinShow(); } return; }
    const c = e.target.closest('[data-sk]'); if (c) { K.sel = c.dataset.sk; $$('#skLib .skc').forEach(x => x.classList.toggle('on', x === c)); skinShow(); }
  };
  if ($('#skCapes')) {
    const cs = $('#skCapes');
    cs.onmouseover = e => { const b = e.target.closest('[data-cape]'); if (!b || K.capePrev === (b.dataset.curl || null)) return; K.capePrev = b.dataset.curl || null; skinShow(); };
    cs.onmouseleave = () => { delete K.capePrev; skinShow(); };
  }
  if ($('#skCapes')) $('#skCapes').onclick = async e => {
    const b = e.target.closest('[data-cape]'); if (!b) return; delete K.capePrev;
    try { const prof = await api('skin.cape', { id: b.dataset.cape || null }); if (prof?.capes) K.prof = prof; else K.prof.capes.forEach(c => c.state = c.id === b.dataset.cape ? 'ACTIVE' : 'INACTIVE'); toast('Umhang geändert'); skinSide(); }
    catch (er) { fail('Umhang', er); }
  };
}
/* ======================= SKIN EDITOR + COLLECTION (original generator, no third-party skins) ======================= */
const SKP = { // [u, v, w, h, d] of every part, base layer and overlay layer
  head: [[0, 0, 8, 8, 8], [32, 0, 8, 8, 8]], body: [[16, 16, 8, 12, 4], [16, 32, 8, 12, 4]],
  rarm: [[40, 16, 4, 12, 4], [40, 32, 4, 12, 4]], larm: [[32, 48, 4, 12, 4], [48, 48, 4, 12, 4]],
  rleg: [[0, 16, 4, 12, 4], [0, 32, 4, 12, 4]], lleg: [[16, 48, 4, 12, 4], [0, 48, 4, 12, 4]],
};
const SKPN = { head: 'Kopf', body: 'Körper', rarm: 'Rechter Arm', larm: 'Linker Arm', rleg: 'Rechtes Bein', lleg: 'Linkes Bein' };
const hex2 = h => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
const rgbHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const shade = (h, f) => { const [r, g, b] = hex2(h); return f >= 0 ? rgbHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f) : rgbHex(r * (1 + f), g * (1 + f), b * (1 + f)); };
// small painter on a 64x64 canvas
function skPainter(cv) {
  const x = cv.getContext('2d', { willReadFrequently: true });
  const P = {
    x, fill(u, v, w, h, c) { x.fillStyle = c; x.fillRect(u, v, w, h); },
    clear(u, v, w, h) { x.clearRect(u, v, w, h); },
    box([u, v, w, h, d], c) { P.fill(u + d, v, w, d, c); P.fill(u + d + w, v, w, d, shade(c, -.15)); P.fill(u, v + d, d, h, shade(c, -.08)); P.fill(u + d, v + d, w, h, c); P.fill(u + d + w, v + d, d, h, shade(c, -.08)); P.fill(u + 2 * d + w, v + d, w, h, shade(c, -.12)); },
    // horizontal band around a limb/body (rows y0..y1 of the side faces)
    band([u, v, w, h, d], y0, y1, c) { P.fill(u, v + d + y0, 2 * (d + w), y1 - y0, c); },
    front([u, v, w, h, d], fx, fy, fw, fh, c) { P.fill(u + d + fx, v + d + fy, fw, fh, c); },
    back([u, v, w, h, d], fx, fy, fw, fh, c) { P.fill(u + 2 * d + w + fx, v + d + fy, fw, fh, c); },
    top([u, v, w, h, d], c) { P.fill(u + d, v, w, d, c); },
    shadeFaces() {
      const im = x.getImageData(0, 0, 64, 64), d = im.data;
      for (const L of [0, 1]) for (const k in SKP) {
        const [u, v, w, h, dp] = SKP[k][L];
        const faces = [[u + dp, v, w, dp, 'top'], [u + dp + w, v, w, dp, 'bot'], [u, v + dp, dp, h, 's'], [u + dp, v + dp, w, h, 's'], [u + dp + w, v + dp, dp, h, 's'], [u + 2 * dp + w, v + dp, w, h, 's']];
        for (const [fx, fy, fw, fh, t] of faces) for (let yy = fy; yy < fy + fh; yy++) for (let xx = fx; xx < fx + fw; xx++) {
          const i = (yy * 64 + xx) * 4; if (!d[i + 3]) continue;
          let f = t === 'top' ? 1.07 : t === 'bot' ? .86 : 1.05 - .15 * ((yy - fy) / Math.max(1, fh - 1));
          if (xx === fx || xx === fx + fw - 1 || (t === 's' && yy === fy + fh - 1)) f *= .9;
          d[i] = Math.min(255, d[i] * f); d[i + 1] = Math.min(255, d[i + 1] * f); d[i + 2] = Math.min(255, d[i + 2] * f);
        }
      }
      x.putImageData(im, 0, 0);
    },
    noise(rnd, amt = .07) {
      const im = x.getImageData(0, 0, 64, 64), d = im.data;
      for (let i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; const f = 1 + (rnd() - .5) * 2 * amt; d[i] *= f; d[i + 1] *= f; d[i + 2] *= f; }
      x.putImageData(im, 0, 0);
    },
  };
  return P;
}
const SKIN_TONES = ['#F3D2B3', '#E8B894', '#D49A73', '#B97A55', '#8D5A3F', '#5E3B28', '#F6DCC6', '#C68863'];
const HAIR = ['#2B1D14', '#4A2F1E', '#7A4B26', '#B07A3C', '#E3C16F', '#F2E2B0', '#111114', '#8A2E1E', '#C9C9CF', '#6B5BD6', '#2DD4A0', '#FF5C8A'];
const CLOTH = ['#E5484D', '#3D9BFF', '#2DD4A0', '#F5B53D', '#8B7BFF', '#FF7A3D', '#1F2937', '#F1F1F4', '#14B8A6', '#E040FB', '#84CC16', '#6B7280', '#7C2D12', '#0EA5E9'];
const THEMES_SK = [
  ['casual', 'Alltag'], ['hoodie', 'Hoodie'], ['suit', 'Anzug'], ['knight', 'Ritter'], ['ninja', 'Ninja'], ['astro', 'Astronaut'], ['wizard', 'Zauberer'],
  ['pirate', 'Pirat'], ['gamer', 'Gamer'], ['chef', 'Koch'], ['zombie', 'Untot'], ['robot', 'Roboter'], ['sport', 'Sport'], ['farmer', 'Farmer'],
  ['samurai', 'Samurai'], ['viking', 'Wikinger'], ['cyber', 'Cyberpunk'], ['demon', 'Dämon'], ['angel', 'Engel'], ['bones', 'Knochen'], ['fox', 'Fuchs-Hoodie'], ['frog', 'Frosch-Hoodie'],
];
function skFace(P, s, eye, rnd, o = {}) {
  const H = SKP.head[0];
  P.box(H, s);
  if (!o.noEyes) { P.front(H, 1, 4, 2, 1, '#fff'); P.front(H, 5, 4, 2, 1, '#fff'); P.front(H, o.lookL ? 1 : 2, 4, 1, 1, eye); P.front(H, o.lookL ? 5 : 6, 4, 1, 1, eye); }
  P.front(H, 3, 6, 2, 1, shade(s, -.25)); // nose shadow / mouth
  if (rnd() > .5) P.front(H, 2, 7, 4, 1, shade(s, -.18));
}
function skHair(P, c, style) {
  const H = SKP.head[0];
  if (style === 'bald') return;
  P.top(H, c); P.band(H, 0, style === 'long' ? 3 : 2, c); P.back(H, 0, 0, 8, style === 'short' ? 4 : 8, c);
  P.front(H, 0, 2, 1, style === 'long' ? 6 : 2, c); P.front(H, 7, 2, 1, style === 'long' ? 6 : 2, c);
  if (style === 'fringe') P.front(H, 0, 2, 5, 1, c);
  if (style === 'long') { P.fill(0, 8 + 2, 8, 6, c); P.fill(16, 8 + 2, 8, 6, c); }
}
function genSkin(seed, theme) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const P = skPainter(cv), rnd = seedRand('sk' + seed + theme), pick = a => a[Math.floor(rnd() * a.length)];
  let s = pick(SKIN_TONES), hair = pick(HAIR), c1 = pick(CLOTH), c2 = pick(CLOTH), pants = pick(['#1E3A8A', '#273449', '#3F3F46', '#1F2937', '#57534E', '#0F172A', c2]), shoe = pick(['#18181B', '#F4F4F5', '#78350F', '#3F3F46']);
  const eye = pick(['#3D7BFF', '#2E8B57', '#6B4226', '#1A1A1A', '#8B7BFF']);
  if (theme === 'zombie') { s = pick(['#5E9E5A', '#6FAF62', '#4F8A57']); }
  if (theme === 'robot') s = pick(['#9CA3AF', '#B8BEC8', '#6B7280']);
  skFace(P, s, theme === 'robot' ? '#FF3B4E' : theme === 'zombie' ? '#111' : eye, rnd);
  ['body', 'rarm', 'larm', 'rleg', 'lleg'].forEach(k => P.box(SKP[k][0], k.endsWith('leg') ? pants : c1));
  const B = SKP.body[0], RA = SKP.rarm[0], LA = SKP.larm[0], RL = SKP.rleg[0], LL = SKP.lleg[0];
  const sleeves = (n, col = s) => { P.band(RA, n, 12, col); P.band(LA, n, 12, col); };
  const shoes = (col = shoe, n = 2) => { P.band(RL, 12 - n, 12, col); P.band(LL, 12 - n, 12, col); };
  const O = k => SKP[k][1];
  switch (theme) {
    case 'casual': sleeves(4); shoes(); skHair(P, hair, pick(['short', 'fringe', 'long', 'short'])); P.front(B, 2, 3, 4, 3, shade(c1, .35)); P.band(B, 11, 12, '#3F2A14'); break;
    case 'hoodie': sleeves(10); shoes(); skHair(P, hair, 'fringe'); P.front(B, 1, 7, 6, 3, shade(c1, -.18)); P.front(B, 3, 0, 1, 4, '#ddd'); P.front(B, 4, 0, 1, 4, '#ddd');
      P.box(O('head'), 'rgba(0,0,0,0)'); P.top(O('head'), c1); P.band(O('head'), 0, 3, c1); P.back(O('head'), 0, 0, 8, 8, c1); break;
    case 'suit': { const k = pick(['#18181B', '#1E293B', '#3F3F46']); ['body', 'rarm', 'larm', 'rleg', 'lleg'].forEach(x => P.box(SKP[x][0], k)); sleeves(11); shoes('#0a0a0a'); skHair(P, hair, 'short');
      P.front(B, 2, 0, 4, 12, '#F4F4F5'); P.front(B, 3, 0, 2, 9, pick(['#B91C1C', '#1D4ED8', '#111', '#047857'])); P.front(B, 1, 0, 1, 6, shade(k, .1)); P.front(B, 6, 0, 1, 6, shade(k, .1)); break; }
    case 'knight': { const m = pick(['#A1A1AA', '#C0C4CC', '#8A8F98']); ['body', 'rarm', 'larm', 'rleg', 'lleg'].forEach(x => P.box(SKP[x][0], m)); P.front(B, 2, 2, 4, 5, pick(['#B91C1C', '#1D4ED8', '#F5B53D'])); P.band(B, 8, 9, shade(m, -.35));
      P.box(O('head'), shade(m, .05)); P.front(O('head'), 1, 3, 6, 1, '#111'); P.front(O('head'), 3, 4, 2, 3, '#111'); P.top(O('head'), shade(m, .2)); break; }
    case 'ninja': { const k = pick(['#111114', '#1E1B4B', '#1F2937']); ['body', 'rarm', 'larm', 'rleg', 'lleg'].forEach(x => P.box(SKP[x][0], k)); P.band(B, 6, 7, pick(['#DC2626', '#F5B53D', '#7C3AED']));
      P.box(O('head'), k); P.clear(32 + 8 + 1, 8 + 3, 6, 2); break; }
    case 'astro': ['body', 'rarm', 'larm', 'rleg', 'lleg'].forEach(x => P.box(SKP[x][0], '#E5E7EB')); P.front(B, 1, 1, 6, 4, '#9CA3AF'); P.front(B, 2, 2, 1, 1, '#EF4444'); P.front(B, 4, 2, 1, 1, '#22C55E'); P.band(B, 11, 12, '#6B7280'); shoes('#6B7280', 3);
      P.box(O('head'), '#E5E7EB'); P.front(O('head'), 1, 2, 6, 5, pick(['#38BDF8', '#F59E0B', '#8B7BFF'])); P.front(O('head'), 2, 3, 2, 1, '#fff'); break;
    case 'wizard': { const r = pick(['#4C1D95', '#1E3A8A', '#7F1D1D', '#14532D']); ['body', 'rarm', 'larm', 'rleg', 'lleg'].forEach(x => P.box(SKP[x][0], r)); P.band(B, 5, 6, '#F5B53D'); skHair(P, '#E5E7EB', 'long');
      P.front(SKP.head[0], 1, 6, 6, 2, '#E5E7EB'); P.front(B, 2, 0, 4, 4, '#E5E7EB'); P.top(O('head'), r); P.band(O('head'), 0, 2, r); break; }
    case 'pirate': for (let i = 0; i < 12; i += 2) P.band(B, i, i + 1, '#F4F4F5'); sleeves(6); shoes('#3F2A14', 3); P.band(SKP.head[0], 0, 2, '#B91C1C'); P.top(SKP.head[0], '#B91C1C'); P.front(SKP.head[0], 1, 3, 3, 2, '#111'); P.front(SKP.head[0], 0, 3, 8, 1, '#111'); skHair(P, hair, 'bald'); break;
    case 'gamer': { const n = pick(['#22D3EE', '#A3E635', '#F472B6', '#FF7A3D']); sleeves(10); shoes('#F4F4F5'); skHair(P, hair, 'fringe'); P.front(B, 2, 3, 4, 1, n); P.front(B, 3, 2, 2, 3, n);
      P.box(O('head'), 'rgba(0,0,0,0)'); P.top(O('head'), '#18181B'); P.fill(32, 8 + 2, 8, 3, '#18181B'); P.fill(48, 8 + 2, 8, 3, '#18181B'); P.fill(32 + 2, 8 + 3, 3, 3, n); P.fill(48 + 3, 8 + 3, 3, 3, n); break; }
    case 'chef': ['body', 'rarm', 'larm'].forEach(x => P.box(SKP[x][0], '#F8FAFC')); sleeves(7); P.front(B, 3, 1, 1, 1, '#111'); P.front(B, 3, 4, 1, 1, '#111'); P.front(B, 3, 7, 1, 1, '#111'); P.box(RL, '#1F2937'); P.box(LL, '#1F2937'); shoes();
      P.top(O('head'), '#fff'); P.band(O('head'), 0, 3, '#fff'); P.front(SKP.head[0], 2, 6, 4, 1, hair); break;
    case 'zombie': sleeves(5); P.front(B, 5, 7, 3, 5, shade(c1, -.35)); P.band(RL, 9, 12, s); skHair(P, shade(hair, -.3), 'short'); P.front(SKP.head[0], 2, 7, 4, 1, '#3B0D0D'); break;
    case 'robot': ['body', 'rarm', 'larm', 'rleg', 'lleg'].forEach(x => P.box(SKP[x][0], shade(s, -.1))); P.front(B, 2, 3, 4, 4, '#111827'); P.front(B, 3, 4, 2, 2, pick(['#22D3EE', '#EF4444', '#A3E635'])); P.top(SKP.head[0], shade(s, -.3)); P.front(SKP.head[0], 0, 6, 8, 1, '#111827');
      for (let i = 0; i < 12; i += 4) { P.band(RA, i, i + 1, shade(s, -.4)); P.band(LA, i, i + 1, shade(s, -.4)); } break;
    case 'sport': { sleeves(3); P.front(B, 3, 3, 2, 4, '#fff'); P.back(B, 3, 3, 2, 4, '#fff'); P.box(RL, '#F4F4F5'); P.box(LL, '#F4F4F5'); P.band(RL, 0, 4, c2); P.band(LL, 0, 4, c2); P.band(RL, 4, 10, s); P.band(LL, 4, 10, s); shoes(pick(['#F4F4F5', '#EF4444', '#111'])); skHair(P, hair, pick(['short', 'bald', 'fringe'])); break; }
    case 'samurai': { const r = pick(['#B91C1C', '#1E3A8A', '#111114', '#4C1D95']); ['body', 'rarm', 'larm'].forEach(x => P.box(SKP[x][0], r)); P.box(RL, '#18181B'); P.box(LL, '#18181B'); sleeves(8); shoes('#3F2A14');
      P.front(B, 0, 0, 3, 12, shade(r, -.3)); P.front(B, 5, 0, 3, 12, shade(r, -.3)); P.band(B, 6, 8, '#F5B53D'); skHair(P, '#111114', 'short'); P.top(SKP.head[0], '#111114'); P.fill(8 + 3, 0, 2, 3, '#111114');
      P.top(O('head'), shade(r, -.4)); P.band(O('head'), 0, 1, shade(r, -.4)); break; }
    case 'viking': { const f = pick(['#7C2D12', '#57534E', '#365314', '#1E3A8A']); ['body', 'rarm', 'larm'].forEach(x => P.box(SKP[x][0], f)); P.box(RL, '#3F2A14'); P.box(LL, '#3F2A14'); sleeves(7); shoes('#57534E', 3); P.band(B, 8, 9, '#3F2A14'); P.front(B, 3, 8, 2, 1, '#F5B53D');
      const hc = pick(['#E3C16F', '#B45309', '#8A2E1E', '#F2E2B0']); skHair(P, hc, 'long'); P.front(SKP.head[0], 1, 5, 6, 3, hc); P.front(SKP.head[0], 3, 6, 2, 1, shade(s, -.3));
      P.top(O('head'), '#9CA3AF'); P.band(O('head'), 0, 2, '#9CA3AF'); P.fill(32, 8, 2, 3, '#F4F4F5'); P.fill(48 + 6, 8, 2, 3, '#F4F4F5'); break; }
    case 'cyber': { const n = pick(['#22D3EE', '#F472B6', '#A3E635', '#FACC15', '#A78BFA']); ['body', 'rarm', 'larm', 'rleg', 'lleg'].forEach(x => P.box(SKP[x][0], '#0F0F14')); P.front(B, 0, 0, 1, 12, n); P.front(B, 7, 0, 1, 12, n); P.band(B, 9, 10, n);
      P.band(RA, 6, 7, n); P.band(LA, 6, 7, n); P.band(RL, 5, 6, n); P.band(LL, 5, 6, n); skHair(P, n, 'fringe'); P.box(O('head'), 'rgba(0,0,0,0)'); P.front(O('head'), 0, 3, 8, 2, '#111'); P.front(O('head'), 1, 3, 6, 1, n); break; }
    case 'demon': { s = pick(['#7F1D1D', '#991B1B', '#3B0764']); skFace(P, s, '#FDE047', rnd); ['body', 'rarm', 'larm'].forEach(x => P.box(SKP[x][0], s)); P.box(RL, '#18181B'); P.box(LL, '#18181B'); shoes('#0a0a0a');
      P.front(B, 1, 2, 6, 3, shade(s, -.3)); P.top(SKP.head[0], '#111'); P.fill(32 + 8, 0, 2, 2, '#E5E7EB'); P.fill(32 + 14, 0, 2, 2, '#E5E7EB'); P.top(O('head'), 'rgba(0,0,0,0)'); P.fill(40, 0, 1, 3, '#E5E7EB'); P.fill(47, 0, 1, 3, '#E5E7EB'); break; }
    case 'angel': ['body', 'rarm', 'larm', 'rleg', 'lleg'].forEach(x => P.box(SKP[x][0], '#F8FAFC')); sleeves(9); P.band(B, 5, 6, '#FDE68A'); skHair(P, pick(['#F2E2B0', '#E3C16F', '#F4F4F5']), 'long'); shoes('#E5E7EB');
      P.top(O('head'), 'rgba(0,0,0,0)'); P.fill(40 + 1, 0, 6, 1, '#FDE047'); P.fill(40, 1, 1, 6, '#FDE047'); P.fill(47, 1, 1, 6, '#FDE047'); P.fill(41, 7, 6, 1, '#FDE047'); break;
    case 'bones': { const b = pick(['#E7E5E4', '#D6D3D1', '#A8A29E']); skFace(P, b, '#111', rnd, {}); ['body', 'rarm', 'larm', 'rleg', 'lleg'].forEach(x => P.box(SKP[x][0], '#1C1917'));
      for (const k of ['rarm', 'larm', 'rleg', 'lleg']) P.front(SKP[k][0], 1, 0, 2, 12, b); for (let i = 1; i < 11; i += 2) P.front(B, 1, i, 6, 1, b); P.front(B, 3, 0, 2, 12, b);
      P.front(SKP.head[0], 1, 3, 2, 2, '#111'); P.front(SKP.head[0], 5, 3, 2, 2, '#111'); P.front(SKP.head[0], 2, 6, 4, 1, '#111'); break; }
    case 'fox': case 'frog': { const fur = theme === 'fox' ? pick(['#EA580C', '#F97316', '#C2410C']) : pick(['#65A30D', '#4D7C0F', '#84CC16']), bel = theme === 'fox' ? '#FFF7ED' : '#ECFCCB';
      ['body', 'rarm', 'larm'].forEach(x => P.box(SKP[x][0], fur)); P.front(B, 2, 2, 4, 8, bel); sleeves(10); P.box(RL, pick(['#1F2937', '#273449'])); P.box(LL, pick(['#1F2937', '#273449'])); shoes(); skHair(P, hair, 'fringe');
      P.box(O('head'), 'rgba(0,0,0,0)'); P.top(O('head'), fur); P.band(O('head'), 0, 2, fur); P.back(O('head'), 0, 0, 8, 8, fur);
      if (theme === 'fox') { P.fill(40, 0, 2, 2, '#111'); P.fill(46, 0, 2, 2, '#111'); P.front(O('head'), 0, 0, 2, 1, '#111'); P.front(O('head'), 6, 0, 2, 1, '#111'); }
      else { P.front(O('head'), 1, 0, 2, 2, '#F4F4F5'); P.front(O('head'), 5, 0, 2, 2, '#F4F4F5'); P.front(O('head'), 2, 1, 1, 1, '#111'); P.front(O('head'), 5, 1, 1, 1, '#111'); }
      break; }
    case 'farmer': sleeves(5); P.box(SKP.body[0], '#E5E7EB'); P.front(B, 1, 3, 6, 9, '#2563EB'); P.front(B, 1, 0, 1, 3, '#2563EB'); P.front(B, 6, 0, 1, 3, '#2563EB'); P.box(RL, '#2563EB'); P.box(LL, '#2563EB'); shoes('#78350F'); skHair(P, hair, 'short');
      P.top(O('head'), '#E3C16F'); P.band(O('head'), 0, 2, '#E3C16F'); P.band(O('head'), 2, 3, '#B45309'); break;
  }
  P.noise(rnd, .05); P.shadeFaces();
  return cv.toDataURL('image/png');
}
// flat front picture of a skin (for fast thumbnails)
const skThumbCache = {};
function skThumb(url) {
  if (skThumbCache[url]) return Promise.resolve(skThumbCache[url]);
  return new Promise(res => {
    const im = new Image(); im.onload = () => {
      const c = document.createElement('canvas'); c.width = 16 * 6; c.height = 32 * 6; const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
      const legacy = im.naturalHeight === 32, d = (sx, sy, w, h, dx, dy) => x.drawImage(im, sx, sy, w, h, dx * 6, dy * 6, w * 6, h * 6);
      d(8, 8, 8, 8, 4, 0); d(20, 20, 8, 12, 4, 8); d(44, 20, 4, 12, 0, 8); d(4, 20, 4, 12, 4, 20);
      if (legacy) { d(44, 20, 4, 12, 12, 8); d(4, 20, 4, 12, 8, 20); } else { d(36, 52, 4, 12, 12, 8); d(20, 52, 4, 12, 8, 20); d(20, 36, 8, 12, 4, 8); d(44, 36, 4, 12, 0, 8); d(52, 52, 4, 12, 12, 8); d(4, 36, 4, 12, 4, 20); d(4, 52, 4, 12, 8, 20); }
      d(40, 8, 8, 8, 4, 0);
      res(skThumbCache[url] = c.toDataURL());
    }; im.onerror = () => res(''); im.src = url;
  });
}
let SKCOL = null;
function skCollection() { return []; }
function skCollectionOld() {
  if (SKCOL) return SKCOL;
  SKCOL = [];
  THEMES_SK.forEach(([k, n]) => { for (let i = 0; i < 12; i++) SKCOL.push({ id: `${k}-${i}`, theme: k, name: `${n} ${i + 1}`, variant: (k === 'wizard' || i % 4 === 3) && k !== 'knight' ? 'slim' : 'classic', seed: i }); });
  return SKCOL;
}
const skColUrl = s => s.url || (s.url = genSkin(s.seed, s.theme));

/* ---------- Orbit Originals: hand-designed skins (pixel art in code, our own designs) ---------- */
function origPainter() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const P = skPainter(cv), x = P.x;
  // face rects of a part: f=front, b=back, r=right side, l=left side, t=top, u=bottom
  const F = (part, L = 0) => { const [u, v, w, h, d] = SKP[part][L]; return { t: [u + d, v, w, d], u: [u + d + w, v, w, d], r: [u, v + d, d, h], f: [u + d, v + d, w, h], l: [u + d + w, v + d, d, h], b: [u + 2 * d + w, v + d, w, h] }; };
  const at = (part, face, fx, fy, w, h, c, L = 0) => { const r = F(part, L)[face]; x.fillStyle = c; x.fillRect(r[0] + fx, r[1] + fy, w, h); };
  const sides = ['f', 'r', 'l', 'b'];
  // vertical gradient over the side faces of a part between rows y0..y1
  const grad = (part, c1, c2, y0 = 0, y1, L = 0) => { const fc = F(part, L); for (const s of sides) { const [u, v, w, h] = fc[s]; const e = y1 ?? h; for (let y = y0; y < e; y++) { x.fillStyle = mix(c1, c2, (y - y0) / Math.max(1, e - y0 - 1)); x.fillRect(u, v + y, w, 1); } } };
  const top = (part, c, L = 0) => { const [u, v, w, d] = F(part, L).t; x.fillStyle = c; x.fillRect(u, v, w, d); };
  const bottom = (part, c, L = 0) => { const [u, v, w, d] = F(part, L).u; x.fillStyle = c; x.fillRect(u, v, w, d); };
  const solid = (part, c, L = 0) => { grad(part, c, c, 0, undefined, L); top(part, shade(c, .08), L); bottom(part, shade(c, -.2), L); };
  const row = (part, y, c, L = 0, h = 1) => { const fc = F(part, L); for (const s of sides) { const [u, v, w] = fc[s]; x.fillStyle = c; x.fillRect(u, v + y, w, h); } };
  const dots = (part, face, n, c, seed, L = 0) => { const r = seedRand(seed), [u, v, w, h] = F(part, L)[face]; x.fillStyle = c; for (let i = 0; i < n; i++) x.fillRect(u + Math.floor(r() * w), v + Math.floor(r() * h), 1, 1); };
  return { cv, P, x, F, at, grad, top, bottom, solid, row, dots };
}
const mix = (a, b, t) => { const A = hex2(a), B = hex2(b); return rgbHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); };
function origFace(o, skin, eyes, opts = {}) {
  const { solid, at } = o;
  solid('head', skin);
  const eyeW = opts.eyeWhite ?? '#F4F4F5';
  at('head', 'f', 1, 4, 2, 1, eyeW); at('head', 'f', 5, 4, 2, 1, eyeW);
  at('head', 'f', 2, 4, 1, 1, eyes); at('head', 'f', 5, 4, 1, 1, eyes);
  at('head', 'f', 3, 5, 2, 1, shade(skin, -.12));
  at('head', 'f', 2, 6, 4, 1, shade(skin, -.28)); at('head', 'f', 3, 6, 2, 1, shade(skin, -.4));
  if (opts.brows) { at('head', 'f', 1, 3, 2, 1, opts.brows); at('head', 'f', 5, 3, 2, 1, opts.brows); }
}
function origHair(o, c, style = 'short') {
  const { top, at } = o, d = shade(c, -.25);
  top('head', c);
  for (const s of ['r', 'l', 'b']) at('head', s, 0, 0, 8, style === 'long' ? 8 : 3, c);
  at('head', 'f', 0, 0, 8, 2, c); at('head', 'f', 0, 2, 1, style === 'long' ? 6 : 2, c); at('head', 'f', 7, 2, 1, style === 'long' ? 6 : 2, c);
  at('head', 'f', 0, 2, 3, 1, c); at('head', 'f', 1, 0, 1, 2, d); at('head', 'f', 5, 0, 1, 2, d);
  for (const s of ['r', 'l']) at('head', s, 1, 3, 1, 2, d);
}
const ORIGINALS = [
  ['astro', 'Orbit Astronaut', 'classic', o => {
    origFace(o, '#E8B894', '#3D7BFF'); origHair(o, '#4A2F1E');
    for (const p of ['body', 'rarm', 'larm', 'rleg', 'lleg']) o.grad(p, '#F4F4F6', '#C9CBD3');
    o.row('body', 0, '#FF7A3D'); o.at('body', 'f', 1, 2, 6, 4, '#2A2D36'); o.at('body', 'f', 2, 3, 1, 1, '#FF7A3D'); o.at('body', 'f', 4, 3, 1, 1, '#4ADE80'); o.at('body', 'f', 5, 4, 1, 1, '#38BDF8'); o.at('body', 'f', 2, 5, 4, 1, '#3F4350');
    o.row('body', 8, '#3F4350', 0, 1); o.at('body', 'f', 3, 8, 2, 1, '#FF7A3D');
    o.at('body', 'b', 1, 1, 6, 9, '#A6A9B4'); o.at('body', 'b', 2, 2, 4, 3, '#FF7A3D'); o.at('body', 'b', 2, 7, 4, 2, '#7C7F8A');
    for (const a of ['rarm', 'larm']) { o.row(a, 4, '#FF7A3D'); o.row(a, 10, '#7C7F8A', 0, 2); }
    for (const l of ['rleg', 'lleg']) { o.row(l, 5, '#C9CBD3'); o.row(l, 9, '#FF7A3D'); o.row(l, 10, '#3F4350', 0, 2); }
    // helmet on the overlay: glass visor with reflection
    o.solid('head', '#E9EAEE', 1); o.at('head', 'f', 1, 1, 6, 6, '#1B2A4A', 1); o.at('head', 'f', 1, 1, 6, 6, 'rgba(56,189,248,.55)', 1); o.at('head', 'f', 2, 2, 2, 1, '#FFFFFF', 1); o.at('head', 'f', 2, 3, 1, 1, '#BFE9FF', 1);
    o.at('head', 't', 3, 3, 2, 2, '#FF7A3D', 1);
  }],
  ['neon', 'Neon Runner', 'classic', o => {
    origFace(o, '#C68863', '#22D3EE', { eyeWhite: '#0B0B10' }); origHair(o, '#0F0F14');
    for (const p of ['body', 'rarm', 'larm']) o.grad(p, '#1A1A22', '#0C0C10');
    for (const p of ['rleg', 'lleg']) o.grad(p, '#22222B', '#121218');
    o.at('body', 'f', 0, 0, 1, 12, '#22D3EE'); o.at('body', 'f', 7, 0, 1, 12, '#F472B6'); o.at('body', 'f', 3, 2, 2, 5, '#22D3EE'); o.at('body', 'f', 2, 3, 4, 1, '#22D3EE');
    o.at('body', 'b', 3, 1, 2, 10, '#F472B6');
    for (const a of ['rarm', 'larm']) { o.row(a, 3, '#22D3EE'); o.row(a, 11, '#C68863'); }
    for (const l of ['rleg', 'lleg']) { o.row(l, 6, '#F472B6'); o.row(l, 10, '#F4F4F5', 0, 2); o.at(l, 'f', 0, 11, 4, 1, '#22D3EE'); }
    // hood + mask
    o.top('head', '#15151C', 1); for (const s of ['r', 'l', 'b']) o.at('head', s, 0, 0, 8, 8, '#15151C', 1); o.at('head', 'f', 0, 0, 8, 2, '#15151C', 1); o.at('head', 'f', 0, 2, 1, 6, '#15151C', 1); o.at('head', 'f', 7, 2, 1, 6, '#15151C', 1);
    o.at('head', 'f', 1, 5, 6, 3, '#0B0B10', 1); o.at('head', 'f', 1, 5, 6, 1, '#22D3EE', 1);
  }],
  ['ember', 'Ember Knight', 'classic', o => {
    origFace(o, '#2A2A30', '#FF7A3D', { eyeWhite: '#2A2A30' });
    for (const p of ['body', 'rarm', 'larm', 'rleg', 'lleg']) o.grad(p, '#4A4A54', '#26262C');
    for (const p of ['body', 'rarm', 'larm', 'rleg', 'lleg']) { o.dots(p, 'f', 5, '#FF7A3D', p + 'e'); o.dots(p, 'r', 2, '#FFB067', p + 'r'); o.dots(p, 'l', 2, '#FFB067', p + 'l'); }
    o.at('body', 'f', 3, 1, 2, 7, '#FF7A3D'); o.at('body', 'f', 2, 3, 4, 1, '#FFB067'); o.row('body', 9, '#7A3A12'); o.at('body', 'f', 3, 9, 2, 1, '#FFD447');
    for (const a of ['rarm', 'larm']) { o.row(a, 0, '#5A5A66', 0, 3); o.row(a, 11, '#1C1C22'); }
    for (const l of ['rleg', 'lleg']) o.row(l, 4, '#5A5A66', 0, 2);
    o.solid('head', '#55555F', 1); o.at('head', 'f', 1, 4, 6, 1, '#120E0C', 1); o.at('head', 'f', 2, 4, 1, 1, '#FF7A3D', 1); o.at('head', 'f', 5, 4, 1, 1, '#FF7A3D', 1); o.at('head', 'f', 3, 5, 2, 3, '#3A3A42', 1); o.at('head', 't', 3, 0, 2, 8, '#FF7A3D', 1);
  }],
  ['frost', 'Frost Mage', 'slim', o => {
    origFace(o, '#F3D2B3', '#7DD3FC', { brows: '#E0F2FE' }); origHair(o, '#E0F2FE', 'long');
    for (const p of ['body', 'rarm', 'larm', 'rleg', 'lleg']) o.grad(p, '#3B82F6', '#1E3A8A');
    o.at('body', 'f', 3, 0, 2, 12, '#E0F2FE'); o.row('body', 6, '#93C5FD'); o.at('body', 'f', 3, 6, 2, 1, '#F0F9FF');
    for (const a of ['rarm', 'larm']) { o.row(a, 9, '#E0F2FE', 0, 1); o.row(a, 10, '#F3D2B3', 0, 2); }
    for (const l of ['rleg', 'lleg']) { o.dots(l, 'f', 4, '#BFDBFE', l); o.row(l, 11, '#E0F2FE'); }
    o.top('head', '#1E40AF', 1); for (const s of ['r', 'l', 'b']) o.at('head', s, 0, 0, 8, 6, '#1E40AF', 1); o.at('head', 'f', 0, 0, 8, 1, '#1E40AF', 1); o.at('head', 't', 3, 3, 2, 2, '#E0F2FE', 1); o.at('head', 'f', 3, 0, 2, 1, '#BAE6FD', 1);
  }],
  ['ranger', 'Waldläufer', 'classic', o => {
    origFace(o, '#D49A73', '#2E8B57', { brows: '#4A2F1E' }); origHair(o, '#7A4B26');
    for (const p of ['body', 'rarm', 'larm']) o.grad(p, '#3F6B35', '#24401F');
    for (const p of ['rleg', 'lleg']) o.grad(p, '#6B4F2F', '#4A3520');
    o.row('body', 7, '#5A3A1E', 0, 2); o.at('body', 'f', 3, 7, 2, 2, '#C9A13A'); for (let i = 0; i < 9; i++) o.at('body', 'f', i < 8 ? i : 7, i, 1, 1, '#7A5A34');
    o.at('body', 'b', 2, 0, 3, 9, '#7A5A34'); o.at('body', 'b', 2, 0, 3, 1, '#E7E5E4');
    for (const a of ['rarm', 'larm']) { o.row(a, 8, '#5A3A1E', 0, 4); }
    for (const l of ['rleg', 'lleg']) o.row(l, 9, '#3A2A1A', 0, 3);
    o.top('head', '#2F5228', 1); for (const s of ['r', 'l', 'b']) o.at('head', s, 0, 0, 8, 7, '#2F5228', 1); o.at('head', 'f', 0, 0, 8, 2, '#2F5228', 1); o.at('head', 'f', 0, 2, 1, 5, '#2F5228', 1); o.at('head', 'f', 7, 2, 1, 5, '#2F5228', 1);
  }],
  ['ronin', 'Ronin', 'classic', o => {
    origFace(o, '#E8B894', '#1A1A1A', { brows: '#111' }); origHair(o, '#111114'); o.at('head', 't', 3, 0, 2, 3, '#111114');
    for (const p of ['body', 'rarm', 'larm']) o.grad(p, '#B91C1C', '#7F1D1D');
    for (const p of ['rleg', 'lleg']) o.grad(p, '#1F1F24', '#0E0E12');
    o.at('body', 'f', 2, 0, 4, 2, '#E8B894'); o.at('body', 'f', 1, 0, 1, 6, '#111114'); o.at('body', 'f', 6, 0, 1, 6, '#111114'); o.row('body', 7, '#111114', 0, 2); o.at('body', 'f', 2, 7, 1, 2, '#F5B53D');
    for (const a of ['rarm', 'larm']) { o.row(a, 7, '#E8B894', 0, 5); o.row(a, 7, '#111114'); }
    // straw hat
    o.top('head', '#D9B56A', 1); for (const s of ['f', 'r', 'l', 'b']) o.at('head', s, 0, 0, 8, 2, '#C9A35A', 1); o.at('head', 't', 2, 2, 4, 4, '#E7C77F', 1);
  }],
  ['street', 'Street Hoodie', 'classic', o => {
    origFace(o, '#F3D2B3', '#6B4226', { brows: '#7A4B26' }); origHair(o, '#B07A3C');
    for (const p of ['body', 'rarm', 'larm']) o.grad(p, '#FF8A4C', '#E5602A');
    for (const p of ['rleg', 'lleg']) o.grad(p, '#3B5B8F', '#24395E');
    o.at('body', 'f', 1, 7, 6, 3, '#D8561F'); o.at('body', 'f', 3, 0, 1, 4, '#F4F4F5'); o.at('body', 'f', 4, 0, 1, 3, '#F4F4F5');
    o.at('body', 'f', 2, 3, 4, 3, '#1A1A22'); o.at('body', 'f', 3, 4, 2, 1, '#FF8A4C');
    for (const a of ['rarm', 'larm']) o.row(a, 11, '#E5602A');
    for (const l of ['rleg', 'lleg']) { o.row(l, 10, '#F4F4F5', 0, 2); o.at(l, 'f', 0, 10, 4, 1, '#FF7A3D'); o.dots(l, 'f', 3, '#4A6FA8', l); }
    // headphones
    o.top('head', 'rgba(0,0,0,0)', 1); o.at('head', 't', 0, 3, 8, 2, '#1A1A22', 1); o.at('head', 'r', 2, 1, 4, 5, '#1A1A22', 1); o.at('head', 'l', 2, 1, 4, 5, '#1A1A22', 1); o.at('head', 'r', 3, 2, 2, 3, '#FF7A3D', 1); o.at('head', 'l', 3, 2, 2, 3, '#FF7A3D', 1);
  }],
  ['void', 'Void Walker', 'slim', o => {
    origFace(o, '#2E1A47', '#E879F9', { eyeWhite: '#C026D3' });
    for (const p of ['body', 'rarm', 'larm', 'rleg', 'lleg']) { o.grad(p, '#3B1D63', '#0E0718'); o.dots(p, 'f', 4, '#F5D0FE', p + 'v'); o.dots(p, 'b', 3, '#F5D0FE', p + 'w'); o.dots(p, 'r', 1, '#E879F9', p); }
    o.top('head', '#1A0E2E'); o.at('body', 'f', 3, 3, 2, 2, '#E879F9'); o.at('body', 'f', 2, 4, 4, 1, 'rgba(232,121,249,.6)'); o.at('body', 'f', 3, 2, 2, 4, 'rgba(232,121,249,.45)');
    o.top('head', '#12091F', 1); for (const s of ['r', 'l', 'b']) o.at('head', s, 0, 0, 8, 8, '#12091F', 1); o.at('head', 'f', 0, 0, 8, 1, '#12091F', 1); o.at('head', 'f', 0, 1, 1, 7, '#12091F', 1); o.at('head', 'f', 7, 1, 1, 7, '#12091F', 1);
  }],
  ['pirate', 'Kapitän', 'classic', o => {
    origFace(o, '#D49A73', '#1A1A1A', { brows: '#2B1D14' }); origHair(o, '#2B1D14'); o.at('head', 'f', 1, 4, 3, 1, '#111'); o.at('head', 'f', 0, 3, 8, 1, '#111'); o.at('head', 'f', 2, 6, 4, 2, '#2B1D14');
    for (const p of ['body', 'rarm', 'larm']) o.grad(p, '#7F1D1D', '#4C1010');
    for (const p of ['rleg', 'lleg']) o.grad(p, '#E7E0D0', '#BDB4A0');
    o.at('body', 'f', 3, 0, 2, 12, '#F4EFE3'); o.at('body', 'f', 2, 1, 1, 1, '#F5B53D'); o.at('body', 'f', 2, 4, 1, 1, '#F5B53D'); o.at('body', 'f', 5, 1, 1, 1, '#F5B53D'); o.at('body', 'f', 5, 4, 1, 1, '#F5B53D'); o.row('body', 8, '#2B1D14'); o.at('body', 'f', 3, 8, 2, 1, '#F5B53D');
    for (const a of ['rarm', 'larm']) { o.row(a, 9, '#F5B53D'); o.row(a, 10, '#F4EFE3', 0, 2); }
    for (const l of ['rleg', 'lleg']) o.row(l, 7, '#2B1D14', 0, 5);
    o.top('head', '#18181B', 1); for (const s of ['f', 'r', 'l', 'b']) o.at('head', s, 0, 0, 8, 2, '#18181B', 1); o.at('head', 'f', 3, 0, 2, 2, '#F4F4F5', 1);
  }],
  ['fox', 'Polarfuchs', 'slim', o => {
    origFace(o, '#F3D2B3', '#3D7BFF'); origHair(o, '#E3C16F');
    for (const p of ['body', 'rarm', 'larm']) o.grad(p, '#F8FAFC', '#D9DEE7');
    for (const p of ['rleg', 'lleg']) o.grad(p, '#94A3B8', '#64748B');
    o.at('body', 'f', 2, 2, 4, 6, '#E2E8F0'); o.at('body', 'f', 3, 0, 1, 4, '#94A3B8'); o.at('body', 'f', 4, 0, 1, 3, '#94A3B8');
    for (const a of ['rarm', 'larm']) o.row(a, 11, '#CBD5E1');
    for (const l of ['rleg', 'lleg']) o.row(l, 10, '#F4F4F5', 0, 2);
    o.top('head', '#F8FAFC', 1); for (const s of ['r', 'l', 'b']) o.at('head', s, 0, 0, 8, 8, '#F1F5F9', 1); o.at('head', 'f', 0, 0, 8, 2, '#F8FAFC', 1);
    o.at('head', 'f', 0, 0, 2, 1, '#94A3B8', 1); o.at('head', 'f', 6, 0, 2, 1, '#94A3B8', 1); o.at('head', 't', 0, 0, 2, 2, '#94A3B8', 1); o.at('head', 't', 6, 0, 2, 2, '#94A3B8', 1);
  }],
  ['golem', 'Lava-Golem', 'classic', o => {
    origFace(o, '#57534E', '#FDE047', { eyeWhite: '#F97316' });
    for (const p of ['head', 'body', 'rarm', 'larm', 'rleg', 'lleg']) { if (p !== 'head') o.grad(p, '#6B6560', '#3F3B37'); for (const s of ['f', 'r', 'l', 'b']) o.dots(p, s, p === 'body' ? 6 : 3, '#F97316', p + s); o.dots(p, 'f', 2, '#FDE047', p + 'y'); }
    o.at('body', 'f', 2, 2, 4, 4, '#F97316'); o.at('body', 'f', 3, 3, 2, 2, '#FDE047');
    o.at('head', 'f', 2, 6, 4, 1, '#F97316');
  }],
  ['gold', 'Goldener Held', 'classic', o => {
    origFace(o, '#E8B894', '#1D4ED8', { brows: '#B07A3C' }); origHair(o, '#E3C16F');
    for (const p of ['body', 'rarm', 'larm', 'rleg', 'lleg']) o.grad(p, '#FFE38A', '#C9961F');
    o.at('body', 'f', 2, 1, 4, 5, '#1D4ED8'); o.at('body', 'f', 3, 2, 2, 3, '#FFE38A'); o.row('body', 8, '#7A5A12'); o.at('body', 'f', 3, 8, 2, 1, '#EF4444');
    o.at('body', 'b', 0, 0, 8, 12, '#1D4ED8'); o.at('body', 'b', 0, 11, 8, 1, '#1E3A8A');
    for (const a of ['rarm', 'larm']) { o.row(a, 0, '#FFF2B8', 0, 1); o.row(a, 9, '#1D4ED8', 0, 3); }
    for (const l of ['rleg', 'lleg']) o.row(l, 9, '#1D4ED8', 0, 3);
    o.top('head', 'rgba(0,0,0,0)', 1); o.at('head', 'f', 1, 0, 6, 1, '#FFD447', 1); o.at('head', 'f', 1, 0, 1, 1, '#FFF2B8', 1); o.at('head', 'f', 3, 0, 1, 1, '#EF4444', 1);
  }],
];
const origCache = {};
function origSkin(id) {
  if (origCache[id]) return origCache[id];
  const d = ORIGINALS.find(x => x[0] === id), o = origPainter();
  d[3](o); o.P.shadeFaces();
  return origCache[id] = o.cv.toDataURL('image/png');
}

/* ---------- editor state ---------- */
const SE = { tool: 'pen', color: '#FF7A3D', size: 1, mirror: false, layer: 'base', recent: [], undo: [], redo: [], view: '3d', grid: true, hide: {}, variant: 'classic', name: 'Mein Skin', id: null, dirty: false };
function seCanvas() {
  if (!SE.cv) { SE.cv = document.createElement('canvas'); SE.cv.width = SE.cv.height = 64; SE.P = skPainter(SE.cv); }
  return SE.cv;
}
async function seLoad(url, name, variant, id) {
  seCanvas();
  const im = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = url; });
  const x = SE.P.x; x.clearRect(0, 0, 64, 64);
  if (im) {
    if (im.naturalHeight === 32) { x.drawImage(im, 0, 0); x.save(); x.translate(64, 0); x.scale(-1, 1); x.restore(); x.drawImage(im, 0, 16, 16, 16, 16, 48, 16, 16); x.drawImage(im, 40, 16, 16, 16, 32, 48, 16, 16); }
    else x.drawImage(im, 0, 0);
  }
  SE.name = name || 'Mein Skin'; SE.variant = variant || 'classic'; SE.id = id || null; SE.undo = []; SE.redo = []; SE.dirty = false;
  SE.orig = x.getImageData(0, 0, 64, 64);
}
const seUrl = () => SE.cv.toDataURL('image/png');
function seReset() {
  if (!SE.orig || !SE.dirty) return;
  const before = SE.P.x.getImageData(0, 0, 64, 64);
  SE.undo.push(before); SE.redo = [];
  SE.P.x.putImageData(SE.orig, 0, 0); SE.dirty = false; seRefresh(); seDirtyUI();
  toast('Skin zurückgesetzt', 'Auf den Stand beim Laden', true, ['Rückgängig', () => { SE.P.x.putImageData(before, 0, 0); SE.undo.pop(); SE.dirty = true; seRefresh(); seDirtyUI(); }]);
}
function seDirtyUI() { $$('#seReset, [data-q=reset]').forEach(b => { b.disabled = !SE.dirty; b.classList.toggle('dis', !SE.dirty); }); }
function sePush() { SE.undo.push(SE.P.x.getImageData(0, 0, 64, 64)); if (SE.undo.length > 80) SE.undo.shift(); SE.redo = []; SE.dirty = true; seDirtyUI(); }
function seUndo(redo) {
  const from = redo ? SE.redo : SE.undo, to = redo ? SE.undo : SE.redo; if (!from.length) return;
  to.push(SE.P.x.getImageData(0, 0, 64, 64)); SE.P.x.putImageData(from.pop(), 0, 0); seRefresh();
}
// which part / face a texture pixel belongs to, to mirror strokes between left and right limbs
function seMirrorPx(u, v) {
  const pairs = [['rarm', 'larm'], ['rleg', 'lleg']];
  for (const L of [0, 1]) for (const [a, b] of pairs) for (const [src, dst] of [[a, b], [b, a]]) {
    const [su, sv, w, h, d] = SKP[src][L], [du, dv] = SKP[dst][L];
    if (u >= su && u < su + 2 * (d + w) && v >= sv && v < sv + d + h) {
      const lu = u - su, lv = v - sv;
      // mirror across the limb: swap right/left side faces and flip x on front/back
      let mu = lu;
      if (lv >= d) { if (lu < d) mu = d + w + (d - 1 - lu); else if (lu < d + w) mu = d + (w - 1 - (lu - d)); else if (lu < 2 * d + w) mu = d - 1 - (lu - d - w); else mu = 2 * d + w + (w - 1 - (lu - 2 * d - w)); }
      else if (lu >= d && lu < d + 2 * w) mu = lu < d + w ? d + (w - 1 - (lu - d)) : d + w + (w - 1 - (lu - d - w));
      return [du + mu, dv + lv];
    }
  }
  // head / body: mirror within the part
  for (const L of [0, 1]) for (const k of ['head', 'body']) {
    const [su, sv, w, h, d] = SKP[k][L];
    if (u >= su && u < su + 2 * (d + w) && v >= sv && v < sv + d + h) {
      const lu = u - su, lv = v - sv;
      let mu = lu;
      if (lv >= d) { if (lu < d) mu = d + w + (d - 1 - lu); else if (lu < d + w) mu = d + (w - 1 - (lu - d)); else if (lu < 2 * d + w) mu = d - 1 - (lu - d - w); else mu = 2 * d + w + (w - 1 - (lu - 2 * d - w)); }
      else if (lu >= d && lu < d + 2 * w) mu = lu < d + w ? d + (w - 1 - (lu - d)) : d + w + (w - 1 - (lu - d - w));
      return [su + mu, sv + lv];
    }
  }
  return null;
}
function sePixel(u, v, erase) {
  const x = SE.P.x, put = (a, b) => {
    if (a < 0 || b < 0 || a > 63 || b > 63) return;
    if (erase) x.clearRect(a, b, 1, 1);
    else if (SE.tool === 'shade' || SE.tool === 'light') {
      const p = x.getImageData(a, b, 1, 1).data; if (!p[3]) return;
      const f = SE.tool === 'shade' ? -.1 : .1; x.fillStyle = shade(rgbHex(p[0], p[1], p[2]), f); x.fillRect(a, b, 1, 1);
    } else if (SE.tool === 'noise') { x.fillStyle = shade(SE.color, (Math.random() - .5) * .25); x.fillRect(a, b, 1, 1); }
    else { x.fillStyle = SE.color; x.fillRect(a, b, 1, 1); }
  };
  for (let i = 0; i < SE.size; i++) for (let j = 0; j < SE.size; j++) {
    put(u + i, v + j);
    if (SE.mirror) { const m = seMirrorPx(u + i, v + j); if (m) put(m[0], m[1]); }
  }
}
function seFill(u, v) {
  const x = SE.P.x, im = x.getImageData(0, 0, 64, 64), d = im.data, at = (a, b) => (b * 64 + a) * 4;
  const t = d.slice(at(u, v), at(u, v) + 4), [r, g, b] = hex2(SE.color);
  // fill stays inside the clicked face so it never bleeds into other body parts
  const reg = seRegion(u, v);
  if (t[0] === r && t[1] === g && t[2] === b && t[3] === 255) return;
  const st = [[u, v]], seen = new Set();
  while (st.length) {
    const [a, c] = st.pop(), k = c * 64 + a; if (seen.has(k)) continue; seen.add(k);
    if (a < reg[0] || c < reg[1] || a >= reg[0] + reg[2] || c >= reg[1] + reg[3]) continue;
    const i = at(a, c); if (Math.abs(d[i] - t[0]) + Math.abs(d[i + 1] - t[1]) + Math.abs(d[i + 2] - t[2]) + Math.abs(d[i + 3] - t[3]) > 24) continue;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    st.push([a + 1, c], [a - 1, c], [a, c + 1], [a, c - 1]);
  }
  x.putImageData(im, 0, 0);
}
// rectangle of the face that contains a texture pixel
function seRegion(u, v) {
  for (const L of [0, 1]) for (const k in SKP) {
    const [su, sv, w, h, d] = SKP[k][L];
    const faces = [[su + d, sv, w, d], [su + d + w, sv, w, d], [su, sv + d, d, h], [su + d, sv + d, w, h], [su + d + w, sv + d, d, h], [su + 2 * d + w, sv + d, w, h]];
    for (const f of faces) if (u >= f[0] && u < f[0] + f[2] && v >= f[1] && v < f[1] + f[3]) return f;
  }
  return [0, 0, 64, 64];
}
function seApplyAt(u, v, e) {
  u = Math.floor(u); v = Math.floor(v);
  if (SE.tool === 'pick') { const p = SE.P.x.getImageData(u, v, 1, 1).data; if (p[3]) { seColor(rgbHex(p[0], p[1], p[2])); SE.tool = SE.lastTool || 'pen'; seTools(); } return; }
  if (SE.tool === 'fill') { seFill(u, v); if (SE.mirror) { const m = seMirrorPx(u, v); if (m) seFill(m[0], m[1]); } }
  else sePixel(u, v, SE.tool === 'erase' || e?.button === 2);
  seRefresh();
}
let seRaf = 0;
function seRefresh() {
  cancelAnimationFrame(seRaf);
  seRaf = requestAnimationFrame(() => {
    const url = seUrl(), m = $('#seStage .mcm'); if (m) m.style.setProperty('--skt', `url('${url}')`);
    seDraw2d();
  });
}
function seColor(c) {
  SE.color = c; SE.recent = [c, ...SE.recent.filter(x => x !== c)].slice(0, 12);
  if ($('#seCol')) { $('#seCol').value = c; $('#seHex').value = c.toUpperCase(); $('#seSw').style.background = c; $('#seRecent').innerHTML = SE.recent.map(x => `<button style="background:${x}" data-c="${x}"></button>`).join(''); }
}
/* ---------- 3D model that paints ---------- */
function seModel() {
  const U = 12, slim = SE.variant === 'slim';
  return skinModel('@var', slim, U, false).replace('class="mcm"', `class="mcm edit" style="--skt:url('${seUrl()}')"`);
}
function seStage() {
  const st = $('#seStage'); if (!st) return;
  st.innerHTML = '<span class="floor"></span>' + seModel();
  st.classList.toggle('noov', SE.layer === 'base');
  Object.entries(SE.hide).forEach(([k, v]) => st.querySelector('.mcm .' + ({ head: 'hd', body: 'bd', rarm: 'ra', larm: 'la', rleg: 'rl', lleg: 'll' })[k])?.classList.toggle('hid', v));
  seView();
}
function seView() { const m = $('#seStage .mcm'); if (m) m.style.transform = `rotateX(${SE.tilt ?? -10}deg) rotateY(${SE.rot ?? -28}deg)`; }
function seFaceUV(el, e) {
  const fu = +el.dataset.u, fv = +el.dataset.v, fw = +el.dataset.w, fh = +el.dataset.h;
  const r = el.getBoundingClientRect(), ox = e.offsetX, oy = e.offsetY, W = el.offsetWidth, H = el.offsetHeight;
  if (!W || !H) return null;
  return [fu + Math.min(fw - 1, Math.max(0, Math.floor(ox / W * fw))), fv + Math.min(fh - 1, Math.max(0, Math.floor(oy / H * fh)))];
}
/* ---------- 2D texture view ---------- */
function seDraw2d() {
  const c = $('#se2d'); if (!c) return;
  const x = c.getContext('2d'), S2 = c.width / 64; x.imageSmoothingEnabled = false;
  x.clearRect(0, 0, c.width, c.height);
  for (let i = 0; i < 64; i += 2) for (let j = 0; j < 64; j += 2) { x.fillStyle = (i + j) % 4 ? '#1a1a1f' : '#141418'; x.fillRect(i * S2, j * S2, 2 * S2, 2 * S2); }
  // used areas slightly lighter so you see where to paint
  for (const L of [0, 1]) for (const k in SKP) { const [u, v, w, h, d] = SKP[k][L]; x.fillStyle = L ? 'rgba(139,123,255,.06)' : 'rgba(255,255,255,.05)'; x.fillRect((u + d) * S2, v * S2, 2 * w * S2, d * S2); x.fillRect(u * S2, (v + d) * S2, 2 * (d + w) * S2, h * S2); }
  x.drawImage(SE.cv, 0, 0, c.width, c.height);
  if (SE.grid) { x.strokeStyle = 'rgba(255,255,255,.06)'; x.lineWidth = 1; x.beginPath(); for (let i = 0; i <= 64; i++) { x.moveTo(i * S2 + .5, 0); x.lineTo(i * S2 + .5, c.height); x.moveTo(0, i * S2 + .5); x.lineTo(c.width, i * S2 + .5); } x.stroke(); }
  x.strokeStyle = 'rgba(255,255,255,.28)'; x.lineWidth = 1;
  for (const L of [0, 1]) for (const k in SKP) { const [u, v, w, h, d] = SKP[k][L]; x.strokeRect((u + d) * S2 + .5, v * S2 + .5, 2 * w * S2, d * S2); x.strokeRect(u * S2 + .5, (v + d) * S2 + .5, 2 * (d + w) * S2, h * S2); }
  if (SE.hover) { x.strokeStyle = '#fff'; x.lineWidth = 2; x.strokeRect(SE.hover[0] * S2 + 1, SE.hover[1] * S2 + 1, SE.size * S2 - 2, SE.size * S2 - 2); }
}
/* ---------- editor page ---------- */
const SETOOLS = [['pen', 'edit', 'Stift', 'B'], ['erase', 'x', 'Radierer', 'E'], ['fill', 'box', 'Füllen', 'G'], ['pick', 'target', 'Pipette', 'I'], ['shade', 'minus', 'Abdunkeln', 'D'], ['light', 'sun', 'Aufhellen', 'L'], ['noise', 'sparkle', 'Struktur-Pinsel', 'N']];
const SEPAL = ['#F3D2B3', '#E8B894', '#D49A73', '#B97A55', '#8D5A3F', '#5E3B28', '#2B1D14', '#7A4B26', '#E3C16F', '#111114', '#F4F4F5', '#9CA3AF', '#E5484D', '#FF7A3D', '#F5B53D', '#84CC16', '#2DD4A0', '#14B8A6', '#3D9BFF', '#1E3A8A', '#8B7BFF', '#E040FB', '#FF5C8A', '#7C2D12'];
function seTools() { $$('#seTools [data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === SE.tool)); const st = $('#seStage'); if (st) st.dataset.tool = SE.tool; const c = $('#se2d'); if (c) c.dataset.tool = SE.tool; }
async function skEditorPage(body) {
  seCanvas();
  if (!SE.loaded) {
    SE.loaded = true;
    await skcDefaults(true);
    const st = (S.skDefaults || []).find(x => x.name === 'Steve') || S.skDefaults?.[0];
    if (st) await seLoad(st.url, 'Mein Skin', 'classic');
    else { await seLoad('', 'Mein Skin', 'classic'); Object.keys(SKP).forEach(k => SE.P.box(SKP[k][0], '#9CA3AF')); SE.orig = SE.P.x.getImageData(0, 0, 64, 64); }
  }
  body.innerHTML = `<div class="sed">
    <div class="se-tools" id="seTools">${SETOOLS.map(([k, ic, n, key]) => `<button data-t="${k}" data-tip="${n}" data-key="${key}">${ico(ic)}</button>`).join('')}
      <hr><button data-sz="1" data-tip="Pinsel 1 Pixel" class="sz">1</button><button data-sz="2" data-tip="Pinsel 2×2 Pixel" class="sz">2</button><button data-sz="3" data-tip="Pinsel 3×3 Pixel" class="sz">3</button>
      <hr><button id="seMir" data-tip="Spiegeln: beide Seiten gleichzeitig" data-key="M">${ico('dup')}</button><button id="seUndo" data-tip="Rückgängig" data-key="Strg+Z">${ico('back')}</button><button id="seRedo" data-tip="Wiederholen" data-key="Strg+Y"><span style="display:grid;transform:scaleX(-1)">${ico('back')}</span></button>
      <button id="seReset" data-tip="Zurücksetzen (nur wenn etwas geändert wurde)">${ico('refresh')}</button></div>
    <div class="se-main">
      <div class="se-top"><div class="seg sm" id="seViewSw"><button data-vw="3d">3D malen</button><button data-vw="2d">Textur</button><button data-vw="split">Beides</button></div>
        <div class="seg sm" id="seLayer"><button data-l="base">Basis</button><button data-l="over">Überzug</button></div>
        <span class="sp"></span><div class="seg sm" id="seVar"><button data-v="classic">Klassisch</button><button data-v="slim">Schlank</button></div></div>
      <div class="se-canvas" id="seCv">
        <div class="se-3d"><div class="stage3 sestage" id="seStage"></div>
          <div class="se-orbit"><button data-rv="0">Vorne</button><button data-rv="180">Hinten</button><button data-rv="-90">Links</button><button data-rv="90">Rechts</button></div>
          <div class="se-parts" id="seParts">${Object.entries(SKPN).map(([k, n]) => `<button data-p="${k}" class="on" title="${n} ein/aus">${n}</button>`).join('')}</div></div>
        <div class="se-2d"><canvas id="se2d" width="512" height="512"></canvas></div>
      </div>
      <div class="se-hint">${ico('info')}<span>Linke Maustaste malt, rechte radiert. Ziehen neben dem Modell, mit <b>Leertaste</b> oder mittlerer Maustaste dreht es. Mausrad zoomt.</span></div>
    </div>
    <div class="se-side">
      <div class="fbox"><div class="fh">${ico('palette')}Farbe</div><div class="se-color"><label class="se-sw" id="seSw" style="background:${SE.color}"><input type="color" id="seCol" value="${SE.color}"></label><input class="in" id="seHex" value="${SE.color.toUpperCase()}" maxlength="7"></div>
        <div class="se-pal" id="sePal">${SEPAL.map(c => `<button style="background:${c}" data-c="${c}"></button>`).join('')}</div>
        <div class="se-sub">Zuletzt</div><div class="se-pal small" id="seRecent"></div></div>
      <div class="fbox"><div class="fh">${ico('sparkle')}Schnellstart</div><div class="se-quick">
        <button data-q="rnd">${ico('rotate')}Zufälliger Standard-Skin</button><button data-q="blank">${ico('square')}Leere Vorlage</button><button data-q="skin">${ico('user')}Nur Haut</button>
        <button data-q="m2l">${ico('dup')}Rechts → Links kopieren</button><button data-q="reset">${ico('refresh')}Zurücksetzen</button><button data-q="clrov">${ico('layers')}Überzug leeren</button><button data-q="open">${ico('upload')}PNG öffnen</button></div></div>
      <div class="fbox"><div class="fh">${ico('check')}Speichern</div><div style="padding:0 6px 6px">
        <input class="in" id="seName" value="${esc(SE.name)}" placeholder="Name">
        <div class="se-save"><button class="btn" id="seLib">${ico('library')}In Bibliothek</button><button class="btn" id="seExp">${ico('download')}PNG</button></div>
        ${S.accounts.length ? `<button class="btn p" id="seApply" style="width:100%;justify-content:center;margin-top:8px">${ico('check')}Als Skin übernehmen</button>` : `<p class="fine" style="margin-top:8px">Zum Übernehmen mit Microsoft anmelden.</p>`}</div></div>
    </div></div>`;
  seStage(); seColor(SE.color); seTools(); seLayout(); seDirtyUI();
  $$('#seTools .sz').forEach(b => b.classList.toggle('on', +b.dataset.sz === SE.size));
  $('#seMir').classList.toggle('on', SE.mirror);
  $('#seTools').onclick = e => {
    const t = e.target.closest('[data-t]'); if (t) { if (t.dataset.t === 'pick') SE.lastTool = SE.tool; SE.tool = t.dataset.t; seTools(); return; }
    const z = e.target.closest('[data-sz]'); if (z) { SE.size = +z.dataset.sz; $$('#seTools .sz').forEach(b => b.classList.toggle('on', b === z)); return; }
    if (e.target.closest('#seMir')) { SE.mirror = !SE.mirror; $('#seMir').classList.toggle('on', SE.mirror); toast(SE.mirror ? 'Spiegeln an' : 'Spiegeln aus'); }
    if (e.target.closest('#seUndo')) seUndo(false);
    if (e.target.closest('#seRedo')) seUndo(true);
    if (e.target.closest('#seReset')) seReset();
  };
  $('#seViewSw').onclick = e => { const b = e.target.closest('[data-vw]'); if (!b) return; SE.view = b.dataset.vw; seLayout(); };
  $('#seLayer').onclick = e => { const b = e.target.closest('[data-l]'); if (!b) return; SE.layer = b.dataset.l; seLayout(); $('#seStage').classList.toggle('noov', SE.layer === 'base'); };
  $('#seVar').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; SE.variant = b.dataset.v; seLayout(); seStage(); };
  $('#seParts').onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; SE.hide[b.dataset.p] = !SE.hide[b.dataset.p]; b.classList.toggle('on', !SE.hide[b.dataset.p]); seStage(); };
  $('#seCv').querySelector('.se-orbit').onclick = e => { const b = e.target.closest('[data-rv]'); if (!b) return; SE.rot = +b.dataset.rv; SE.tilt = -8; seView(); };
  $('#seCol').oninput = e => seColor(e.target.value);
  $('#seHex').onchange = e => { const v = e.target.value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) seColor((v[0] === '#' ? v : '#' + v).toLowerCase()); };
  const palClick = e => { const b = e.target.closest('[data-c]'); if (b) { seColor(b.dataset.c); if (SE.tool === 'erase' || SE.tool === 'pick') { SE.tool = 'pen'; seTools(); } } };
  $('#sePal').onclick = palClick; $('#seRecent').onclick = palClick;
  $('#seName').oninput = e => SE.name = e.target.value;
  $('.se-quick').onclick = async e => {
    const q = e.target.closest('[data-q]')?.dataset.q; if (!q) return;
    if (q === 'reset') return seReset();
    if (q === 'open') { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png'; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const url = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(f); }); sePush(); await seLoad(url, f.name.replace(/\.png$/i, ''), SE.variant); seStage(); seRefresh(); $('#seName').value = SE.name; }; inp.click(); return; }
    sePush();
    if (q === 'rnd') { await skcDefaults(true); const l = S.skDefaults || []; if (!l.length) return; const d = l[Math.floor(Math.random() * l.length)]; const im = new Image(); im.onload = () => { SE.P.x.clearRect(0, 0, 64, 64); SE.P.x.drawImage(im, 0, 0); seRefresh(); }; im.src = d.url; SE.variant = d.variant; seLayout(); seStage(); return; }
    if (q === 'blank') SE.P.x.clearRect(0, 0, 64, 64), Object.keys(SKP).forEach(k => SE.P.box(SKP[k][0], '#9CA3AF'));
    if (q === 'skin') { SE.P.x.clearRect(0, 0, 64, 64); Object.keys(SKP).forEach(k => SE.P.box(SKP[k][0], SE.color)); }
    if (q === 'clrov') Object.keys(SKP).forEach(k => { const [u, v, w, h, d] = SKP[k][1]; SE.P.clear(u, v, 2 * (d + w), d + h); });
    if (q === 'm2l') for (const L of [0, 1]) for (const [a, b] of [['rarm', 'larm'], ['rleg', 'lleg']]) { const [su, sv, w, h, d] = SKP[a][L]; for (let u = su; u < su + 2 * (d + w); u++) for (let v = sv; v < sv + d + h; v++) { const p = SE.P.x.getImageData(u, v, 1, 1).data, m = seMirrorPx(u, v); if (!m) continue; if (p[3]) { SE.P.x.fillStyle = `rgba(${p[0]},${p[1]},${p[2]},${p[3] / 255})`; SE.P.x.clearRect(m[0], m[1], 1, 1); SE.P.x.fillRect(m[0], m[1], 1, 1); } else SE.P.x.clearRect(m[0], m[1], 1, 1); } }
    seRefresh();
  };
  $('#seExp').onclick = () => { const a = document.createElement('a'); a.href = seUrl(); a.download = (SE.name || 'skin') + '.png'; a.click(); };
  const save = async () => {
    const r = await api('skins.save', { id: SE.id, data: seUrl(), name: SE.name || 'Mein Skin', variant: SE.variant });
    SE.id = r.id; SE.dirty = false;
    if (S.skins?.lib) { S.skins.lib = S.skins.lib.filter(x => x.id !== r.id); S.skins.lib.unshift(r); }
    return r;
  };
  $('#seLib').onclick = async () => { try { await save(); toast('Gespeichert', SE.name); } catch (e) { fail('Speichern', e); } };
  if ($('#seApply')) $('#seApply').onclick = async () => {
    const b = $('#seApply'); b.disabled = true; b.innerHTML = ico('refresh', 'i spin') + 'Wird übernommen…';
    try { const r = await save(); await api('skin.apply', { id: r.id, variant: SE.variant }); toast('Skin übernommen', 'Im Spiel nach dem nächsten Start sichtbar'); }
    catch (e) { fail('Skin', e); }
    b.disabled = false; b.innerHTML = ico('check') + 'Als Skin übernehmen';
  };
  seBindPaint();
}
function seLayout() {
  $$('#seViewSw button').forEach(b => b.classList.toggle('on', b.dataset.vw === SE.view));
  $$('#seLayer button').forEach(b => b.classList.toggle('on', b.dataset.l === SE.layer));
  $$('#seVar button').forEach(b => b.classList.toggle('on', b.dataset.v === SE.variant));
  const c = $('#seCv'); if (c) c.dataset.view = SE.view;
  seDraw2d();
}
function seBindPaint() {
  const st = $('#seStage'), c2 = $('#se2d');
  let painting = false, rotating = null, space = false;
  const keyd = e => {
    if (S.page !== 'skins' || S.skTab !== 'editor' || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    if (e.code === 'Space') { space = true; st?.classList.add('grab'); e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); seUndo(e.shiftKey); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); seUndo(true); }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = SETOOLS.find(x => x[3].toLowerCase() === e.key.toLowerCase()); if (t) { if (t[0] === 'pick') SE.lastTool = SE.tool; SE.tool = t[0]; seTools(); }
    if (e.key.toLowerCase() === 'm') $('#seMir')?.click();
    if (e.key === 'x') { /* swap */ }
  };
  const keyu = e => { if (e.code === 'Space') { space = false; st?.classList.remove('grab'); } };
  document.removeEventListener('keydown', SE.kd || (() => { })); document.removeEventListener('keyup', SE.ku || (() => { }));
  SE.kd = keyd; SE.ku = keyu; document.addEventListener('keydown', keyd); document.addEventListener('keyup', keyu);
  const hit3 = e => { const f = e.target.closest?.('.f[data-u]'); return f ? seFaceUV(f, e) : null; };
  st.oncontextmenu = e => e.preventDefault(); c2.oncontextmenu = e => e.preventDefault();
  st.onpointerdown = e => {
    if (space || e.button === 1 || !e.target.closest('.f[data-u]')) { rotating = { x: e.clientX, y: e.clientY, r: SE.rot ?? -28, t: SE.tilt ?? -10 }; st.setPointerCapture(e.pointerId); return; }
    const p = hit3(e); if (!p) return; sePush(); painting = e.button === 2 ? 'erase' : true; seApplyAt(p[0], p[1], e);
  };
  st.onpointermove = e => {
    if (rotating) { SE.rot = rotating.r + (e.clientX - rotating.x) * .5; SE.tilt = Math.max(-60, Math.min(60, rotating.t - (e.clientY - rotating.y) * .4)); seView(); return; }
    const p = hit3(e); SE.hover = p; if (painting && p && SE.tool !== 'fill' && SE.tool !== 'pick') seApplyAt(p[0], p[1], { button: painting === 'erase' ? 2 : 0 }); else if (SE.view !== '3d') seDraw2d();
  };
  st.onpointerup = st.onpointerleave = () => { painting = false; rotating = null; };
  st.onwheel = e => { e.preventDefault(); SE.zoom = Math.max(.6, Math.min(1.8, (SE.zoom || 1) - e.deltaY * .001)); st.style.setProperty('--z', SE.zoom); };
  const uv2 = e => { const r = c2.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * 64), Math.floor((e.clientY - r.top) / r.height * 64)]; };
  c2.onpointerdown = e => { sePush(); painting = e.button === 2 ? 'erase' : true; c2.setPointerCapture(e.pointerId); const [u, v] = uv2(e); seApplyAt(u, v, e); };
  c2.onpointermove = e => { const [u, v] = uv2(e); SE.hover = [u, v]; if (painting && SE.tool !== 'fill' && SE.tool !== 'pick') seApplyAt(u, v, { button: painting === 'erase' ? 2 : 0 }); else seDraw2d(); };
  c2.onpointerup = () => painting = false;
  c2.onpointerleave = () => { painting = false; SE.hover = null; seDraw2d(); };
}
/* ---------- collection page ---------- */
const SKC = { theme: '', q: '', sel: null, page: 1 };
async function skCollectionPage(body) {
  body.innerHTML = `<div class="skcol"><div class="skc-main">
      <div class="skc-find"><div class="srch">${ico('search')}<input class="in" id="skcQ" placeholder="Spielername oder Link zu einer Skin-PNG…"></div><button class="btn p" id="skcGo">${ico('download')}Laden</button></div>
      <div class="skc-grid" id="skcGrid"><div class="spinner"></div></div></div>
    <div class="skc-side" id="skcSide"></div></div>`;
  const find = async () => {
    const q = $('#skcQ').value.trim(); if (!q) return;
    const b = $('#skcGo'); b.disabled = true; b.innerHTML = ico('refresh', 'i spin') + 'Lädt…';
    try {
      const r = /^https:\/\//i.test(q) ? { name: decodeURIComponent(q.split('/').pop().replace(/\.png.*$/i, '')).slice(0, 32) || 'Skin', variant: 'classic', ...(await api('skins.link', { url: q })) } : await api('skins.player', { name: q });
      SKC.imp = { id: 'imp', theme: 'imp', name: r.name, variant: r.variant, url: r.data, cape: r.cape }; SKC.sel = 'imp'; skcSide();
    } catch (er) { fail('Laden', er); }
    b.disabled = false; b.innerHTML = ico('download') + 'Laden';
  };
  $('#skcGo').onclick = find; $('#skcQ').onkeydown = e => { if (e.key === 'Enter') find(); };
  await skcDefaults();
  skcGrid(); skcSide();
}
async function skcDefaults(quiet) {
  if (S.skDefaults?.length) return;
  try { S.skDefaults = (await api('skins.defaults')).map((d, i) => ({ id: 'std-' + i, theme: 'std', name: d.name, variant: d.variant, url: d.data })); }
  catch (e) { S.skDefaults = []; if (!quiet) fail('Standard-Skins', e); }
}
const skcOrig = () => SKC.orig || (SKC.orig = ORIGINALS.map(([id, name, variant]) => ({ id: 'o-' + id, theme: 'orig', name, variant, get url() { return origSkin(id); } })));
const skcAll = () => [...(SKC.imp ? [SKC.imp] : []), ...skcOrig(), ...(S.skDefaults || [])];
function skcList() { return skcAll().filter(s => s.theme !== 'imp'); }
async function skcGrid() {
  const g = $('#skcGrid'); if (!g) return;
  const l = skcList(), tile = s => `<button class="skt ${SKC.sel === s.id ? 'on' : ''}" data-id="${s.id}"><span class="skt-img"><img alt="" data-u="${s.id}"></span><b>${esc(s.name)}</b><small>${s.variant === 'slim' ? 'Schlank' : 'Klassisch'}</small></button>`;
  const og = l.filter(s => s.theme === 'orig'), st = l.filter(s => s.theme === 'std');
  g.innerHTML = `<div class="skc-h"><h2>${ico('sparkle')}Orbit Originals</h2><span>Von uns gestaltet</span></div>${og.map(tile).join('')}
    <div class="skc-h"><h2>${ico('cube')}Minecraft-Standard</h2><span>${st.length ? st.length + ' Skins' : 'Aus deiner Minecraft-Installation'}</span></div>${st.length ? st.map(tile).join('') : '<div class="empty" style="grid-column:1/-1">Die Standard-Skins werden beim ersten Öffnen aus Minecraft geladen.</div>'}`;
  g.onclick = e => { const b = e.target.closest('[data-id]'); if (!b) return; SKC.sel = b.dataset.id; $$('#skcGrid .skt').forEach(x => x.classList.toggle('on', x === b)); skcSide(); };
  // thumbnails are generated in small batches so the page stays smooth
  const imgs = [...g.querySelectorAll('img[data-u]')];
  for (let i = 0; i < imgs.length; i++) {
    const s = skcAll().find(x => x.id === imgs[i].dataset.u);
    imgs[i].src = await skThumb(skColUrl(s));
    if (i % 12 === 11) await new Promise(r => setTimeout(r, 0));
    if (!$('#skcGrid')) return;
  }
}
async function skcSide() {
  const el = $('#skcSide'); if (!el) return;
  const s = skcAll().find(x => x.id === SKC.sel) || skcList()[0]; if (!s) return;
  SKC.sel = s.id; $$('#skcGrid .skt').forEach(x => x.classList.toggle('on', x.dataset.id === s.id));
  const url = skColUrl(s);
  el.innerHTML = `<div class="skc-view"><div class="stage3" id="skcStage"><span class="floor"></span>${skinModel(url, s.variant === 'slim', 8, false, s.cape || null)}</div></div>
    <b class="skc-name">${esc(s.name)}</b><small class="muted">${esc(s.theme === 'std' ? 'Minecraft-Standard' : s.theme === 'orig' ? 'Orbit Original' : 'Geladen' + (s.cape ? ' · mit Umhang' : ''))} · ${s.variant === 'slim' ? 'Schlank' : 'Klassisch'}</small>
    <div class="col" style="gap:8px;margin-top:14px">
      ${S.accounts.length ? `<button class="btn p" id="skcApply" style="justify-content:center">${ico('check')}Übernehmen</button>` : ''}
      <button class="btn" id="skcEdit" style="justify-content:center">${ico('edit')}Im Editor bearbeiten</button>
      <button class="btn" id="skcSave" style="justify-content:center">${ico('library')}In Bibliothek</button></div>`;
  const m = $('#skcStage .mcm'); let r = -25; const spin = () => { if (!$('#skcStage') || SKC.sel !== s.id) return; r += .4; m.style.transform = `rotateX(-8deg) rotateY(${r}deg)`; requestAnimationFrame(spin); }; spin();
  const add = async () => { const e = await api('skins.add', { data: url, name: s.name, variant: s.variant }); if (S.skins?.lib) S.skins.lib.unshift(e); return e; };
  $('#skcSave').onclick = async () => { try { await add(); toast('In Bibliothek', s.name); } catch (e) { fail('Skin', e); } };
  $('#skcEdit').onclick = async () => { await seLoad(url, s.name, s.variant); SE.loaded = true; S.skTab = 'editor'; go('skins', {}, false); };
  if ($('#skcApply')) $('#skcApply').onclick = async () => { const b = $('#skcApply'); b.disabled = true; try { const e = await add(); await api('skin.apply', { id: e.id, variant: s.variant }); toast('Skin übernommen', s.name); } catch (er) { fail('Skin', er); } b.disabled = false; };
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
const STABS = [['cloud', 'Orbit-Konto', 'cloud', 'Cloud-Sync auf allen PCs'], ['account', 'Microsoft', 'user', 'Minecraft-Konten'], ['design', 'Design', 'palette', 'Farben und Verhalten'], ['java', 'Java', 'coffee', 'Laufzeiten pro Version'], ['defaults', 'Standard-Instanz', 'cube', 'Speicher, Fenster, JVM'], ['storage', 'Speicher & Daten', 'hdd', 'Ordner und Cache'], ['about', 'Über', 'info', 'Version und Lizenzen']];
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
    b.innerHTML = '<div class="dsg3">' + card('Hintergrund-Effekt', `<div class="fxpick" id="sFx">${[['snow', 'Schnee', 'Winterlich, sanft fallend'], ['embers', 'Funken', 'Glühende Funken in deiner Farbe'], ['stars', 'Sterne', 'Funkeln und Sternschnuppen'], ['aurora', 'Polarlicht', 'Wehende Nordlichter in deiner Farbe'], ['rain', 'Regen', 'Ruhiger, schräger Regen'], ['fireflies', 'Glühwürmchen', 'Leuchtende Punkte, die umherschwirren'], ['sakura', 'Kirschblüten', 'Fallende Blütenblätter'], ['off', 'Aus', 'Ruhiger Hintergrund']].map(([k, n, d]) => `<button class="${(st.fx || 'snow') === k ? 'on' : ''}" data-v="${k}"><span class="fxi ${k}"></span><b>${n}</b><small>${d}</small></button>`).join('')}</div><p class="fine">Pausiert automatisch, während Minecraft läuft.</p>`)
      + card('Akzentfarbe', `<div class="themes" id="sThemes" style="margin-top:12px">${Object.entries(THEMES).map(([k, [n, c1, c2]]) => `<div class="sw ${st.accent === k ? 'on' : ''}" data-th="${k}"><i style="background:linear-gradient(135deg,${c1},${c2})"></i>${n}</div>`).join('')}</div>`)
      + card('Darstellung', `<div class="modes" id="sMode">${MODES.map(([k, n, d]) => `<button class="${(st.mode || 'dark') === k ? 'on' : ''}" data-v="${k}"><span class="mprev ${k}"><i></i><i></i><i></i></span><b>${n}</b><small>${d}</small></button>`).join('')}</div>`)
      + '</div>'
      + `<div class="mt"></div>` + card('Verhalten', `<div class="srow"><div><b>Beim Spielstart</b><p>Was der Launcher macht, wenn Minecraft startet.</p></div><div class="seg" id="sOnL">${[['keep', 'Offen lassen'], ['minimize', 'Minimieren'], ['close', 'Schließen']].map(([k, n]) => `<button data-v="${k}" class="${st.onLaunch === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
        <div class="srow"><div><b>Mods automatisch aktualisieren</b><p>Vor jedem Start nach neuen Versionen suchen.</p></div>${tg('autoUpdateMods', st.autoUpdateMods)}</div>
        <div class="srow"><div><b>Snapshots anzeigen</b><p>Vorabversionen in Versionslisten.</p></div>${tg('showSnapshots', st.showSnapshots)}</div>
        <div class="srow"><div><b>Spielen über</b><p>Offizieller Launcher: Anmeldung dort, OrbitLauncher bereitet alles vor.</p></div><div class="seg" id="sPlay">${[['auto', 'Automatisch'], ['orbit', 'OrbitLauncher'], ['official', 'Minecraft Launcher']].map(([k, n]) => `<button data-v="${k}" class="${(st.playMode || 'auto') === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
        <div class="srow"><div><b>Discord-Status</b><p>Zeigt in Discord „Spielt …“ mit Instanz und Version.</p></div>${tg('discordRpc', st.discordRpc !== false)}</div>`);
    $('#sThemes').onclick = e => { const s = e.target.closest('[data-th]'); if (!s) return; applyTheme(s.dataset.th); setS('accent', s.dataset.th); $$('#sThemes .sw').forEach(x => x.classList.toggle('on', x === s)); S.heroSvg = null; };
    $('#sMode').onclick = e => { const x = e.target.closest('[data-v]'); if (!x) return; applyMode(x.dataset.v); setS('mode', x.dataset.v); $$('#sMode button').forEach(y => y.classList.toggle('on', y === x)); };
    $('#sFx').onclick = e => { const x = e.target.closest('[data-v]'); if (!x) return; setS('fx', x.dataset.v); fxSet(x.dataset.v); $$('#sFx button').forEach(y => y.classList.toggle('on', y === x)); };
    $('#sPlay').onclick = e => { const x = e.target.closest('[data-v]'); if (!x) return; setS('playMode', x.dataset.v); $$('#sPlay button').forEach(y => y.classList.toggle('on', y === x)); };
    $('#sOnL').onclick = e => { const x = e.target.closest('[data-v]'); if (!x) return; setS('onLaunch', x.dataset.v); $$('#sOnL button').forEach(y => y.classList.toggle('on', y === x)); };
  }
  if (S.stab === 'cloud') return cloudSettings(b, card);
  if (S.stab === 'sources') {
    let cfs = { ready: false }; try { cfs = await api('cf.status'); } catch { }
    if (S.stab !== 'sources') return;
    b.innerHTML = card('', `<div class="srcrow"><span class="srclogo mr"></span><div class="tx"><b>Standard-Katalog</b><p>Zehntausende Mods, Modpacks, Shader und Ressourcenpakete. Immer aktiv, kein Schlüssel nötig.</p></div><span class="chip g">Verbunden</span></div>`)
      + '<div class="mt"></div>' + card('', `<div class="srcrow"><span class="srclogo cf"></span><div class="tx"><b>Erweiterter Katalog</b><p>Noch mehr Mods und Modpacks. Braucht einen kostenlosen API-Schlüssel (Anmeldung mit Google oder Discord, keine Bankdaten).</p></div><span class="chip ${cfs.ready ? 'g' : 'w'}">${cfs.ready ? 'Verbunden' : 'Nicht verbunden'}</span></div>
        <div class="inline" style="margin-top:14px"><input class="in" id="cfKeyIn" type="password" placeholder="${cfs.own ? 'Eigener Schlüssel gespeichert' : cfs.ready ? 'Eingebauter Schlüssel aktiv' : 'API-Schlüssel einfügen'}" style="font-family:var(--mono);font-size:12px"><button class="btn p" onclick="saveCfKey().then(()=>setBody())">${ico('check')}Speichern</button><button class="btn" onclick="openUrl('https://console.curseforge.com/')">${ico('ext')}Schlüssel holen</button></div>
        <p class="fine">Mods, deren Autoren Downloads nur über ihre eigene Website erlauben, lädt OrbitLauncher nicht selbst. Du bekommst dann den Link zur Download-Seite.</p>`);
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
    b.innerHTML = card('', `<div class="row" style="gap:16px"><span class="iic" style="width:64px;height:64px;border-radius:18px">${blockSvg('orbit')}</span><div style="flex:1"><h2 style="font-size:22px">Orbit<span class="grad">Launcher</span></h2><p class="sub">Version ${esc(S.version)} · <span id="updTxt">${S.upd?.available ? 'Version ' + esc(S.upd.latest) + ' verfügbar' : S.upd ? 'Du hast die neueste Version' : 'Updates kommen von GitHub'}</span></p></div>
        ${S.upd?.available ? `<button class="btn p" onclick="updatePrompt(S.upd)">${ico('download')}Update ${esc(S.upd.latest)}</button>` : `<button class="btn" id="updCheck">${ico('refresh')}Nach Updates suchen</button>`}</div>
      <div class="srow" style="margin-top:10px"><div><b>Automatisch nach Updates suchen</b><p>Beim Start wird geprüft, ob es eine neue Version gibt.</p></div>${tg('autoUpdate', st.autoUpdate !== false)}</div>
      <div class="srow"><div><b>Updates automatisch installieren</b><p>Ohne Nachfrage laden und neu starten, aber nie während Minecraft läuft.</p></div>${tg('autoInstall', !!st.autoInstall)}</div>`)
      + '<div class="mt"></div>' + card('Quellen &amp; Lizenzen', `<div class="srow"><div><b>Minecraft</b><p>Spieldateien kommen direkt von Mojang. Minecraft ist eine Marke von Mojang AB. Nicht offiziell, nicht mit Mojang oder Microsoft verbunden.</p></div></div>
        <div class="srow"><div><b>Mods &amp; Modpacks</b><p>Kommen direkt von den Plattformen ihrer Autoren, jeweils unter deren Lizenz.</p></div></div>
        <div class="srow"><div><b>Mod-Loader</b><p>Fabric, Quilt, Forge und NeoForge über ihre offiziellen Meta-APIs und Installer.</p></div></div>
        <div class="srow"><div><b>Java</b><p>Mojang Java Runtime bzw. Eclipse Temurin (Adoptium).</p></div></div>
        <div class="srow"><div><b>Schriften &amp; Icons</b><p>Geist und Inter (SIL Open Font License), Icons im Stil von Lucide (ISC).</p></div></div>`);
    if ($('#updCheck')) $('#updCheck').onclick = async () => { $('#updCheck').disabled = true; $('#updCheck').innerHTML = ico('refresh', 'i spin') + 'Prüfe…'; await checkUpdate(true); setBody(); };
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



/* ======================= ORBIT ACCOUNT + CLOUD SYNC ======================= */
async function cloudStatus() { try { S.cloud = await api('cloud.status'); } catch { S.cloud = { loggedIn: false }; } cloudUI(); return S.cloud; }
function cloudUI(state) {
  const c = S.cloud || {}, p = $('#cloudPill');
  p.classList.toggle('hidden', !c.loggedIn);
  if (!c.loggedIn) return;
  const syncing = state === 'sync' || c.syncing;
  p.classList.toggle('busy', syncing); p.classList.toggle('err', state === 'error');
  $('#cloudTxt').textContent = syncing ? 'Synchronisiert…' : state === 'error' ? 'Sync-Fehler' : c.name;
  p.title = c.lastSync ? 'Orbit-Cloud · zuletzt ' + ago(c.lastSync).toLowerCase() : 'Orbit-Cloud';
}
function cloudEvent(d) {
  if (d.state === 'done') { S.cloud = { ...(S.cloud || {}), lastSync: d.at, syncing: false }; if (d.created) toast('Aus der Orbit-Cloud', `${d.created} Instanz${d.created > 1 ? 'en' : ''} von deinem Konto übernommen${d.restore ? ', Mods werden geladen' : ''}`); }
  if (d.state === 'restored') toast('Cloud-Instanzen bereit', `${d.ok} Inhalte geladen${d.failed?.length ? ' · nicht verfügbar: ' + d.failed.join(', ') : ''}`, !d.failed?.length);
  if (d.state === 'error' && S.cloud) S.cloud.lastError = d.error;
  cloudUI(d.state);
  if (S.page === 'settings' && S.stab === 'cloud' && d.state !== 'sync') setBody();
}
function orbitLogin(register = false, keep) {
  const name0 = keep?.name || '', pw0 = keep?.pw || '';
  const perks = [['library', 'Instanzen', 'Version, RAM, Configs und Spielzeit'], ['puzzle', 'Mod-Listen', 'Exakte Versionen, frisch aus dem Katalog'], ['sparkle', 'Skins und Design', 'Bibliothek, Akzentfarbe und HUD']];
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button>
    <aside class="auth-side">
      <span class="auth-mark">${blockSvg('orbit')}</span>
      <h2>Dein Spiel, auf jedem PC.</h2>
      <p>Ein Orbit-Konto hält Instanzen, Mods, Einstellungen und Skins zusammen. Anmelden, und auf dem nächsten PC ist alles wieder da.</p>
      <div class="auth-perks">${perks.map(([ic, t, s]) => `<div class="auth-perk"><span>${ico(ic)}</span><div><b>${t}</b><small>${s}</small></div></div>`).join('')}</div>
    </aside>
    <div class="auth-main">
      <div class="auth-sw"><button type="button" id="olIn" class="${register ? '' : 'on'}">Anmelden</button><button type="button" id="olUp" class="${register ? 'on' : ''}">Konto erstellen</button></div>
      <h1>${register ? 'Neues Konto' : 'Willkommen zurück'}</h1>
      <p class="auth-lead">${register ? 'Name und Passwort reichen. Danach gleicht Orbit deine Instanzen ab.' : 'Melde dich an. Deine Instanzen werden mit diesem PC abgeglichen.'}</p>
      <label class="fl" for="olName">Name</label>
      <div class="auth-field">${ico('user', 'lead')}<input class="in" id="olName" maxlength="20" value="${esc(name0)}" placeholder="z. B. Ky3ls" autocomplete="username" spellcheck="false"></div>
      <p class="auth-hint" id="olHint">3–20 Zeichen, Buchstaben, Zahlen und _</p>
      <label class="fl" for="olPw">Passwort</label>
      <div class="auth-field">${ico('lock', 'lead')}<input class="in" id="olPw" type="password" value="${esc(pw0)}" placeholder="${register ? 'Mindestens 8 Zeichen' : 'Dein Passwort'}" autocomplete="${register ? 'new-password' : 'current-password'}"><button type="button" class="auth-eye" id="olEye" title="Passwort zeigen">${ico('eye')}</button></div>
      ${register ? `<div class="pwbar" id="olBar" aria-hidden="true"><i></i><i></i><i></i><i></i></div><p class="auth-hint" id="olPwHint">Mindestens 8 Zeichen</p>
        <label class="fl" for="olPw2">Nochmal</label>
        <div class="auth-field">${ico('shield', 'lead')}<input class="in" id="olPw2" type="password" placeholder="Dasselbe Passwort" autocomplete="new-password"></div>
        <p class="fine">Keine E-Mail-Wiederherstellung. Merk dir das Passwort. Es verlässt deinen PC nur verschlüsselt.</p>` : '<p class="fine">Das Passwort bleibt verschlüsselt auf diesem PC.</p>'}
      <div class="g-err" id="olErr"></div>
      <button class="btn p lg auth-go" id="olGo">${ico(register ? 'plus' : 'user')}${register ? 'Konto erstellen' : 'Anmelden'}</button>
      ${register ? '' : `<button class="btn lg auth-alt" id="olPk">${ico('key')}Mit Passkey</button>`}
    </div>`, 'auth');
  const keepNow = () => ({ name: $('#olName').value, pw: $('#olPw').value });
  $('#olIn').onclick = () => { if (!register) return; orbitLogin(false, keepNow()); };
  $('#olUp').onclick = () => { if (register) return; orbitLogin(true, keepNow()); };
  $('#olEye').onclick = () => { const i = $('#olPw'); i.type = i.type === 'password' ? 'text' : 'password'; $('#olEye').classList.toggle('on', i.type === 'text'); };
  const paint = () => {
    const name = $('#olName').value.trim(), ok = /^[A-Za-z0-9_]{3,20}$/.test(name);
    $('#olHint').className = 'auth-hint' + (name && ok ? ' ok' : name ? ' bad' : '');
    if (!register) return;
    const pw = $('#olPw').value;
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s++;
    $$('#olBar i').forEach((el, n) => { el.className = n < s ? 's' + s : ''; });
    $('#olPwHint').textContent = ['Mindestens 8 Zeichen', 'Kurz', 'Okay', 'Stark', 'Sehr stark'][s];
  };
  $('#olName').oninput = paint;
  $('#olPw').oninput = paint;
  const go = async () => {
    const name = $('#olName').value.trim(), pw = $('#olPw').value;
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return $('#olErr').textContent = 'Name: 3–20 Zeichen, nur Buchstaben, Zahlen und _';
    if (register && pw.length < 8) return $('#olErr').textContent = 'Das Passwort braucht mindestens 8 Zeichen.';
    if (register && pw !== $('#olPw2').value) return $('#olErr').textContent = 'Die Passwörter sind nicht gleich.';
    const b = $('#olGo'); b.disabled = true; b.innerHTML = ico('refresh', 'i spin') + (register ? 'Erstelle…' : 'Melde an…');
    try {
      const r = await api('cloud.login', { name, password: pw, register });
      if (r.need === 'totp') return orbitFactor(r.ticket, r.name || name);
      orbitDone(r.name, register);
    }
    catch (e) { b.disabled = false; b.innerHTML = ico(register ? 'plus' : 'user') + (register ? 'Konto erstellen' : 'Anmelden'); $('#olErr').textContent = e.message; }
  };
  if (!register) $('#olPk').onclick = () => orbitPasskey($('#olName').value.trim());
  $('#olGo').onclick = go;
  $$('#mbox .in').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') go(); });
  paint();
  setTimeout(() => $(name0 ? '#olPw' : '#olName').focus(), 50);
}
window.orbitLogin = orbitLogin;
function orbitDone(name, created) {
  closeModal();
  toast(created ? 'Orbit-Konto erstellt' : 'Bei Orbit angemeldet', 'Hallo ' + name + ', deine Instanzen werden abgeglichen');
  cloudStatus().then(() => { cloudUI('sync'); if (S.page === 'settings') setBody(); });
}
function b64uToBuf(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bufToB64u(buf) {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pkFail(e) {
  if (!window.isSecureContext || !navigator.credentials?.create) return 'Passkeys gehen nur im Launcher, mit Windows Hello oder einem Sicherheitsschlüssel.';
  if (e?.name === 'NotAllowedError') return 'Der Passkey wurde nicht gespeichert. Entweder wurde das Windows-Fenster abgebrochen, oder Windows Hello ist auf diesem PC nicht eingerichtet (Windows-Einstellungen → Konten → Anmeldeoptionen: PIN oder Gesichtserkennung).';
  if (e?.name === 'InvalidStateError') return 'Auf diesem Gerät gibt es schon einen Passkey für dein Konto.';
  if (e?.name === 'SecurityError') return 'Windows hat den Passkey für diese App abgelehnt (' + (e.message || 'SecurityError') + ').';
  return e?.message || 'Passkey fehlgeschlagen.';
}
function orbitFactor(ticket, name) {
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button>
    <aside class="auth-side"><span class="auth-mark">${blockSvg('orbit')}</span><h2>Zweiter Schritt.</h2><p>Dein Konto ist mit einem Code geschützt. Den zeigt die Authenticator-App, oder du nimmst einen Wiederherstellungscode.</p></aside>
    <div class="auth-main"><h1>Code eingeben</h1><p class="auth-lead">${esc(name)}, das Passwort stimmt. Jetzt der Code.</p>
      <div id="olBox">${otpHtml('olOtp')}</div>
      <input class="in auth-code hidden" id="olRec" placeholder="XXXX-XXXX" maxlength="14" autocomplete="off">
      <div class="g-err" id="olErr"></div>
      <button class="btn p lg auth-go" id="olGo">${ico('shield')}Bestätigen</button>
      <button class="g-skip" id="olRecSw" style="margin-top:12px">Handy nicht da? Wiederherstellungscode benutzen</button></div>`, 'auth');
  let rec = false;
  const otp = otpBind('olOtp', () => go());
  $('#olRecSw').onclick = () => { rec = !rec; $('#olBox').classList.toggle('hidden', rec); $('#olRec').classList.toggle('hidden', !rec); $('#olRecSw').textContent = rec ? 'Doch lieber den Code aus der App' : 'Handy nicht da? Wiederherstellungscode benutzen'; (rec ? $('#olRec') : $('#olOtp input')).focus(); };
  const go = async () => {
    const code = rec ? $('#olRec').value.trim() : otp.value();
    if (!rec && code.length < 6) return $('#olErr').textContent = 'Der Code hat 6 Ziffern.';
    if (rec && code.replace(/[^A-Za-z0-9]/g, '').length < 8) return $('#olErr').textContent = 'Der Wiederherstellungscode hat 8 Zeichen.';
    const b = $('#olGo'); b.disabled = true; b.innerHTML = ico('refresh', 'i spin') + 'Prüfe…';
    try { const r = await api('cloud.totp', { ticket, code }); orbitDone(r.name || name, false); }
    catch (e) { b.disabled = false; b.innerHTML = ico('shield') + 'Bestätigen'; $('#olErr').textContent = e.message; if (!rec) otp.clear(); }
  };
  $('#olGo').onclick = go;
  $('#olRec').onkeydown = e => { if (e.key === 'Enter') go(); };
}
async function orbitPasskey(name) {
  const err = $('#olErr');
  if (HOST) {
    if (!name) { if (err) err.textContent = 'Gib zuerst deinen Orbit-Namen ein.'; return; }
    try { const r = await api('cloud.passkey.login.native', { name }); orbitDone(r.name, false); }
    catch (e) { if (err) err.textContent = e.message; else fail('Passkey', e); }
    return;
  }
  if (!window.isSecureContext || !navigator.credentials?.get) { if (err) err.textContent = pkFail(); return; }
  try {
    const o = await api('cloud.passkey.begin', { name: name || null });
    const cred = await navigator.credentials.get({ publicKey: { challenge: b64uToBuf(o.challenge), rpId: o.rpId, allowCredentials: (o.allowCredentials || []).map(c => ({ type: 'public-key', id: b64uToBuf(c.id) })), timeout: o.timeout, userVerification: 'preferred' } });
    const r = cred.response;
    const done = await api('cloud.passkey.finish', { id: cred.id, clientDataJSON: bufToB64u(r.clientDataJSON), authenticatorData: bufToB64u(r.authenticatorData), signature: bufToB64u(r.signature) });
    orbitDone(done.name, false);
  } catch (e) { if (err) err.textContent = pkFail(e); else fail('Passkey', e); }
}
async function cloudPasskeyAdd() {
  if (HOST) {
    let st = { available: false, hello: false }; try { st = await api('cloud.passkey.native'); } catch { }
    if (!st.available) return fail('Passkey', { message: 'Diese Windows-Version unterstützt keine Passkeys.' });
    if (!st.hello && !await confirmBox('Windows Hello fehlt', 'Auf diesem PC ist keine Windows-Hello-PIN oder Gesichtserkennung eingerichtet. Du kannst stattdessen einen Sicherheitsschlüssel (USB) oder dein Handy nehmen.', 'Fortfahren')) return;
    try { await api('cloud.passkey.add.native', {}); toast('Passkey gespeichert', 'Beim nächsten Mal reicht Windows Hello.'); if (S.page === 'settings') setBody(); }
    catch (e) { if (!/abgebrochen/.test(e.message)) fail('Passkey', e); else toast('Passkey nicht gespeichert', e.message, false); }
    return;
  }
  if (!window.isSecureContext || !navigator.credentials?.create) return fail('Passkey', { message: pkFail() });
  let hello = false;
  try { hello = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { }
  if (!hello && !await confirmBox('Windows Hello fehlt', 'Auf diesem PC ist keine Windows-Hello-PIN oder Gesichtserkennung eingerichtet. Richte sie in den Windows-Einstellungen unter Konten → Anmeldeoptionen ein, oder nimm einen Sicherheitsschlüssel (USB) bzw. dein Handy.', 'Trotzdem fortfahren')) return;
  try {
    const o = await api('cloud.passkey.add.begin');
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: b64uToBuf(o.challenge), rp: { name: 'Orbit', id: o.rpId },
      user: { id: b64uToBuf(o.user.id), name: o.user.name, displayName: o.user.displayName },
      pubKeyCredParams: o.pubKeyCredParams, timeout: o.timeout, attestation: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred', ...(hello ? { authenticatorAttachment: 'platform' } : {}) },
      excludeCredentials: (o.excludeCredentials || []).map(c => ({ type: 'public-key', id: b64uToBuf(c.id) })),
    } });
    await api('cloud.passkey.add.finish', { clientDataJSON: bufToB64u(cred.response.clientDataJSON), attestationObject: bufToB64u(cred.response.attestationObject), name: 'Dieser PC' });
    toast('Passkey gespeichert', 'Beim nächsten Mal kannst du dich damit anmelden.');
    if (S.page === 'settings') setBody();
  } catch (e) { fail('Passkey', { message: pkFail(e) }); }
}
window.cloudPasskeyAdd = cloudPasskeyAdd;
window.cloudPasskeyDel = async id => {
  if (!await confirmBox('Passkey entfernen?', 'Auf diesem Gerät kannst du dich damit nicht mehr anmelden.', 'Entfernen', true)) return;
  try { await api('cloud.passkey.remove', { id }); if (S.page === 'settings') setBody(); } catch (e) { fail('Passkey', e); }
};

/* ======================= QR CODE (own small encoder: byte mode, error level M, versions 1–10) ======================= */
function qrMatrix(text) {
  const data = [...new TextEncoder().encode(text)];
  const ECC = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26], BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  const rawModules = v => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
  const dataCap = v => Math.floor(rawModules(v) / 8) - ECC[v - 1] * BLOCKS[v - 1];
  let ver = 1;
  for (; ver <= 10; ver++) if (4 + (ver < 10 ? 8 : 16) + data.length * 8 <= dataCap(ver) * 8) break;
  if (ver > 10) throw new Error('QR zu lang');
  // bit stream
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(data.length, ver < 10 ? 8 : 16); data.forEach(b => put(b, 8));
  const capBits = dataCap(ver) * 8;
  put(0, Math.min(4, capBits - bits.length));
  put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xEC; bits.length < capBits; pad ^= 0xEC ^ 0x11) put(pad, 8);
  const cw = []; for (let i = 0; i < bits.length; i += 8) cw.push(bits.slice(i, i + 8).reduce((a, b) => a << 1 | b, 0));
  // Reed–Solomon over GF(256), poly 0x11D
  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; };
  const deg = ECC[ver - 1], div = new Array(deg).fill(0); div[deg - 1] = 1;
  for (let i = 0, root = 1; i < deg; i++) { for (let j = 0; j < deg; j++) { div[j] = mul(div[j], root); if (j + 1 < deg) div[j] ^= div[j + 1]; } root = mul(root, 2); }
  const rem = d => { const r = new Array(deg).fill(0); for (const b of d) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => r[i] ^= mul(c, f)); } return r; };
  const nb = BLOCKS[ver - 1], raw = Math.floor(rawModules(ver) / 8), nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = cw.slice(k, k + shortLen - deg + (i < nShort ? 0 : 1)); k += d.length;
    const e = rem(d); if (i < nShort) d.push(0); blocks.push(d.concat(e));
  }
  const all = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - deg || j >= nShort) all.push(b[i]); });
  // matrix
  const size = ver * 4 + 17, M = [...Array(size)].map(() => new Array(size).fill(false)), F = [...Array(size)].map(() => new Array(size).fill(false));
  const set = (x, y, dark) => { M[y][x] = dark; F[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4); } };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2, pos = [6];
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    pos.forEach((a, i) => pos.forEach((b, j) => { if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }));
  }
  const format = mask => {
    const d = (0 << 3) | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412, g = i => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, g(i));
    set(8, 7, g(6)); set(8, 8, g(7)); set(7, 8, g(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, g(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, g(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, g(i));
    set(8, size - 8, true);
  };
  format(0);
  if (ver >= 7) {
    let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
    const b = (ver << 12) | r;
    for (let i = 0; i < 18; i++) { const bit = ((b >>> i) & 1) === 1, a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, bit); set(c, a, bit); }
  }
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
      if (!F[y][x] && k < all.length * 8) { M[y][x] = ((all[k >>> 3] >>> (7 - (k & 7))) & 1) === 1; k++; }
    }
  }
  const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0, (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
  const apply = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!F[y][x] && MASKS[m](x, y)) M[y][x] = !M[y][x]; };
  const penalty = () => {
    let p = 0;
    for (let y = 0; y < size; y++) for (let run = 1, x = 1; x <= size; x++) { if (x < size && M[y][x] === M[y][x - 1]) run++; else { if (run >= 5) p += run - 2; run = 1; } }
    for (let x = 0; x < size; x++) for (let run = 1, y = 1; y <= size; y++) { if (y < size && M[y][x] === M[y - 1][x]) run++; else { if (run >= 5) p += run - 2; run = 1; } }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3; }
    let dark = 0; M.forEach(r => r.forEach(c => dark += c)); p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return p;
  };
  let best = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++) { apply(m); format(m); const p = penalty(); if (p < bestP) { bestP = p; best = m; } apply(m); }
  apply(best); format(best);
  return M;
}
function qrSvg(text, px = 6) {
  const M = qrMatrix(text), n = M.length, q = 3, s = (n + q * 2);
  let d = '';
  M.forEach((row, y) => row.forEach((c, x) => { if (c) d += `M${x + q} ${y + q}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s * px}" height="${s * px}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#111"/></svg>`;
}

/* ---------- 6-digit code boxes (auto-advance, paste, backspace) ---------- */
const otpHtml = id => `<div class="otp" id="${id}">${[0, 1, 2, 3, 4, 5].map(i => `<input inputmode="numeric" maxlength="1" autocomplete="${i ? 'off' : 'one-time-code'}" aria-label="Ziffer ${i + 1}">${i === 2 ? '<span class="otp-gap"></span>' : ''}`).join('')}</div>`;
function otpBind(id, done) {
  const box = $('#' + id), ins = [...box.querySelectorAll('input')];
  const val = () => ins.map(i => i.value).join('');
  const fill = s => { const d = s.replace(/\D/g, '').slice(0, 6); ins.forEach((i, k) => i.value = d[k] || ''); (ins[Math.min(d.length, 5)]).focus(); box.classList.toggle('full', d.length === 6); if (d.length === 6) done(d); };
  ins.forEach((inp, k) => {
    inp.oninput = () => {
      const v = inp.value.replace(/\D/g, '');
      if (v.length > 1) return fill(val().slice(0, k) + v);
      inp.value = v; box.classList.remove('bad');
      if (v && k < 5) ins[k + 1].focus();
      box.classList.toggle('full', val().length === 6);
      if (val().length === 6) done(val());
    };
    inp.onkeydown = e => {
      if (e.key === 'Backspace' && !inp.value && k > 0) { ins[k - 1].value = ''; ins[k - 1].focus(); e.preventDefault(); }
      if (e.key === 'ArrowLeft' && k > 0) ins[k - 1].focus();
      if (e.key === 'ArrowRight' && k < 5) ins[k + 1].focus();
    };
    inp.onpaste = e => { e.preventDefault(); fill((e.clipboardData || window.clipboardData).getData('text')); };
    inp.onfocus = () => inp.select();
  });
  setTimeout(() => ins[0].focus(), 60);
  return { value: val, clear: () => { ins.forEach(i => i.value = ''); box.classList.remove('full'); box.classList.add('bad'); ins[0].focus(); } };
}
const secretGroups = s => esc(s).replace(/(.{4})/g, '$1 ').trim();

/* ---------- two-factor setup: 1) scan, 2) confirm, 3) recovery codes ---------- */
function cloudTotpOn() {
  api('cloud.totp.start').then(s => {
    const uri = s.otpauth || `otpauth://totp/Orbit:${encodeURIComponent(S.cloud?.name || '')}?secret=${s.secret}&issuer=Orbit`;
    let qr = ''; try { qr = qrSvg(uri, 5); } catch { }
    modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button>
      <div class="tfa-head"><span class="tfa-ic">${ico('shield')}</span><div><div class="kicker">Orbit-Konto schützen</div><h1>Zwei-Faktor einrichten</h1></div></div>
      <div class="tfa-steps"><span class="on">1 · Scannen</span><i></i><span>2 · Codes sichern</span></div>
      <div class="tfa-body">
        <div class="tfa-qr">${qr || '<div class="muted">QR-Code nicht verfügbar</div>'}</div>
        <div class="tfa-side">
          <ol class="tfa-list">
            <li><b>Authenticator-App öffnen</b><span>z. B. Microsoft Authenticator, Google Authenticator, Authy oder 2FAS</span></li>
            <li><b>QR-Code scannen</b><span>Klappt das nicht, gib den Schlüssel von Hand ein:</span>
              <button class="tfa-secret" id="tfSec" title="Kopieren"><code>${secretGroups(s.secret)}</code>${ico('copy')}</button></li>
            <li><b>Code aus der App eingeben</b><span>Die App zeigt alle 30 Sekunden einen neuen.</span></li>
          </ol>
          ${otpHtml('tfOtp')}
          <div class="g-err" id="tfErr"></div>
        </div>
      </div>
      <div class="act" style="justify-content:space-between"><span class="muted" style="font-size:12px">Ab dann fragt Orbit beim Anmelden nach dem Code.</span><button class="btn p" id="tfGo" disabled>${ico('shield')}Aktivieren</button></div>`, 'form tfa');
    $('#tfSec').onclick = () => navigator.clipboard?.writeText(s.secret).then(() => toast('Schlüssel kopiert')).catch(() => { });
    let busy = false;
    const go = async code => {
      if (busy || !code || code.length !== 6) return; busy = true;
      const b = $('#tfGo'); b.disabled = true; b.innerHTML = ico('refresh', 'i spin') + 'Prüfe…'; $('#tfErr').textContent = '';
      try { const r = await api('cloud.totp.confirm', { code }); tfaCodes(r.recovery || []); }
      catch (e) { busy = false; b.innerHTML = ico('shield') + 'Aktivieren'; $('#tfErr').textContent = e.message === 'Code falsch.' ? 'Der Code stimmt nicht. Nimm den aktuellen aus der App.' : e.message; otp.clear(); }
    };
    const otp = otpBind('tfOtp', code => { $('#tfGo').disabled = false; go(code); });
    $('#tfGo').onclick = () => go(otp.value());
  }).catch(e => fail('Zwei-Faktor', e));
}
window.cloudTotpOn = cloudTotpOn;
function tfaCodes(codes) {
  const text = 'OrbitLauncher – Wiederherstellungscodes\nJeder Code gilt einmal.\n\n' + codes.join('\n') + '\n';
  modal(`<div class="tfa-head"><span class="tfa-ic ok">${ico('check')}</span><div><div class="kicker">Zwei-Faktor ist aktiv</div><h1>Wiederherstellungscodes</h1></div></div>
    <div class="tfa-steps"><span class="done">1 · Scannen</span><i class="on"></i><span class="on">2 · Codes sichern</span></div>
    <p class="tfa-p">Falls du dein Handy verlierst, kommst du mit einem dieser Codes trotzdem rein. Jeder gilt nur einmal. Orbit zeigt sie dir <b>kein zweites Mal</b>.</p>
    <div class="rec-grid">${codes.map((c, i) => `<code><i>${i + 1}</i>${esc(c)}</code>`).join('')}</div>
    <div class="row" style="gap:8px;margin-top:12px"><button class="btn sm" id="rcCopy">${ico('copy')}Kopieren</button><button class="btn sm" id="rcSave">${ico('download')}Als Datei speichern</button></div>
    <label class="tfa-check"><span class="cb" id="rcOk"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>Ich habe die Codes sicher aufbewahrt</label>
    <div class="act" style="justify-content:flex-end"><button class="btn p" id="rcDone" disabled>${ico('check')}Fertig</button></div>`, 'form tfa');
  S.modalClose = () => { if (S.page === 'settings') setBody(); };
  $('#rcCopy').onclick = () => navigator.clipboard?.writeText(text).then(() => toast('Codes kopiert')).catch(() => { });
  $('#rcSave').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'orbit-wiederherstellungscodes.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  $('.tfa-check').onclick = () => { const on = !$('#rcOk').classList.contains('on'); $('#rcOk').classList.toggle('on', on); $('#rcDone').disabled = !on; };
  $('#rcDone').onclick = () => { closeModal(); toast('Zwei-Faktor aktiv', 'Dein Orbit-Konto ist jetzt doppelt geschützt.'); };
}
window.cloudTotpOff = async () => {
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button><div class="tfa-head"><span class="tfa-ic warn">${ico('shield')}</span><div><div class="kicker">Orbit-Konto</div><h1>Zwei-Faktor ausschalten</h1></div></div>
    <p class="tfa-p">Bestätige mit deinem Passwort und dem aktuellen Code aus der App.</p>
    <label class="fl">Passwort</label><input class="in" id="tfPw" type="password" autocomplete="current-password">
    <label class="fl">Code aus der App</label>${otpHtml('tfOff')}
    <div class="g-err" id="tfErr"></div>
    <div class="act" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">Abbrechen</button><button class="btn d" id="tfGo">Ausschalten</button></div>`, 'form tfa');
  const otp = otpBind('tfOff', () => { });
  setTimeout(() => $('#tfPw').focus(), 80);
  $('#tfGo').onclick = async () => {
    try { await api('cloud.totp.disable', { password: $('#tfPw').value, code: otp.value() }); closeModal(); toast('Zwei-Faktor aus'); if (S.page === 'settings') setBody(); }
    catch (e) { $('#tfErr').textContent = e.message; otp.clear(); }
  };
};
async function cloudSyncNow(btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = ico('refresh', 'i spin') + 'Synchronisiert…'; }
  cloudUI('sync');
  try { const r = await api('cloud.sync'); if (!r.busy) toast('Synchronisiert', `${r.pushed} hochgeladen · ${r.pulled} übernommen`); }
  catch (e) { fail('Sync fehlgeschlagen', e); }
  await cloudStatus(); if (S.page === 'settings' && S.stab === 'cloud') setBody();
}
window.cloudSyncNow = cloudSyncNow;
async function cloudLogout() {
  if (!await confirmBox('Von Orbit abmelden?', 'Deine Instanzen bleiben auf diesem PC und in der Cloud. Es wird nur nicht mehr abgeglichen.', 'Abmelden')) return;
  await api('cloud.logout'); await cloudStatus(); if (S.page === 'settings') setBody();
}
window.cloudLogout = cloudLogout;
async function cloudSettings(b, card) {
  const c = await cloudStatus();
  if (S.stab !== 'cloud') return;
  if (!c.loggedIn) {
    b.innerHTML = card('', `<div class="cloudhero">
      <span class="ch-ic">${blockSvg('orbit')}</span>
      <div class="kicker">Orbit-Konto</div>
      <h2>Ein Konto für jeden PC</h2>
      <p>Instanzen, Mod-Listen, Optionen, Configs, Einstellungen und Skins liegen auf deinem Konto. Auf einem anderen PC anmelden, und alles kommt zurück. Mods werden dabei frisch aus dem Katalog geladen.</p>
      <div class="ch-grid">
        <div><b>Instanzen</b><span>Version, RAM, Spielzeit</span></div>
        <div><b>Mods</b><span>Exakte Versionen</span></div>
        <div><b>Design</b><span>Akzent, HUD, Skins</span></div>
      </div>
      <div class="row" style="justify-content:center;gap:10px"><button class="btn p lg" onclick="orbitLogin(true)">${ico('plus')}Konto erstellen</button><button class="btn lg" onclick="orbitLogin(false)">${ico('user')}Anmelden</button></div></div>`)
      + '<div class="mt"></div>' + card('Was wird gespeichert?', `<div class="srow"><div><b>Instanzen</b><p>Name, Symbol, Gruppe, Version, Mod-Loader, RAM, Fenster, Spielzeit, options.txt, Serverliste, Configs</p></div>${ico('check')}</div>
      <div class="srow"><div><b>Mods, Shader, Ressourcenpakete</b><p>Als Liste mit exakter Version. Beim Wiederherstellen werden sie frisch aus dem Katalog geladen.</p></div>${ico('check')}</div>
      <div class="srow"><div><b>Einstellungen, Orbit Client, Skins</b><p>Akzentfarbe, Standard-RAM, HUD-Layout, deine Skin-Bibliothek</p></div>${ico('check')}</div>
      <div class="srow"><div><b>Welten</b><p>Nicht automatisch (zu groß). Nutze Welt-Backups.</p></div>${ico('x')}</div>`);
    return;
  }
  let me = null; try { me = await api('cloud.me'); } catch { }
  if (S.stab !== 'cloud') return;
  b.innerHTML = card('', `<div class="srcrow"><span class="srclogo orb">${blockSvg('orbit')}</span><div class="tx"><b>${esc(c.name)}</b><p>Orbit-Konto · ${c.lastSync ? 'zuletzt synchronisiert ' + esc(ago(c.lastSync).toLowerCase()) : 'noch nicht synchronisiert'}${S.cloud.lastError ? ' · <span style="color:var(--bad)">' + esc(S.cloud.lastError) + '</span>' : ''}</p></div>
      <button class="btn p" onclick="cloudSyncNow(this)">${ico('refresh')}Jetzt synchronisieren</button></div>
      ${me ? `<div class="mt"></div><div class="bar"><i style="width:${Math.max(1, me.bytes / me.maxBytes * 100)}%"></i></div><p class="fine">${bytes(me.bytes)} von ${bytes(me.maxBytes)} Cloud-Speicher · ${me.items} Einträge</p>` : ''}`)
    + (me?.devices?.length ? '<div class="mt"></div>' + card('Angemeldete Geräte', me.devices.map(d => `<div class="srow"><div><b>${esc(d.device || 'Unbekannt')}</b><p>Zuletzt aktiv ${esc(ago(d.last).toLowerCase())}</p></div>${ico('monitor')}</div>`).join('')) : '')
    + '<div class="mt"></div>' + card('Schutz', `<div class="srow"><div><b>Zwei-Faktor</b><p>${me?.totp ? 'Aktiv. Nach dem Passwort kommt ein Code aus der App.' : 'Zusätzlich zum Passwort ein Code aus der Authenticator-App.'}</p></div><button class="btn sm" onclick="${me?.totp ? 'cloudTotpOff()' : 'cloudTotpOn()'}">${ico('shield')}${me?.totp ? 'Ausschalten' : 'Einschalten'}</button></div>
      ${(me?.passkeys || []).map(p => `<div class="srow"><div><b>${esc(p.name || 'Passkey')}</b><p>Hinzugefügt ${esc(ago(p.created).toLowerCase())}</p></div><button class="ib sm d" title="Entfernen" onclick="cloudPasskeyDel('${jsq(p.id)}')">${ico('trash')}</button></div>`).join('')}
      <div class="srow"><div><b>Passkey</b><p>Anmelden mit Windows Hello oder einem Sicherheitsschlüssel, ohne Passwort.</p></div><button class="btn sm" onclick="cloudPasskeyAdd()">${ico('key')}Hinzufügen</button></div>`)
    + '<div class="mt"></div>' + card('Konto', `<div class="srow"><div><b>Passwort ändern</b><p>Meldet alle anderen Geräte ab.</p></div><button class="btn sm" onclick="cloudPassword()">${ico('lock')}Ändern</button></div>
      <div class="srow"><div><b>Abmelden</b><p>Nur auf diesem PC.</p></div><button class="btn sm" onclick="cloudLogout()">${ico('logout')}Abmelden</button></div>
      <div class="srow"><div><b>Konto löschen</b><p>Löscht das Konto und alle Cloud-Daten. Instanzen auf deinen PCs bleiben.</p></div><button class="btn sm d" onclick="cloudDelete()">${ico('trash')}Löschen</button></div>`);
}
window.cloudPassword = async () => {
  modal(`<h1>Passwort ändern</h1><label class="fl">Altes Passwort</label><input class="in" id="cpOld" type="password"><label class="fl">Neues Passwort</label><input class="in" id="cpNew" type="password" placeholder="Mindestens 8 Zeichen"><div class="g-err" id="cpErr" style="text-align:left"></div><div class="act" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">Abbrechen</button><button class="btn p" id="cpGo">Ändern</button></div>`, 'form');
  $('#cpGo').onclick = async () => { if ($('#cpNew').value.length < 8) return $('#cpErr').textContent = 'Mindestens 8 Zeichen.'; try { await api('cloud.password', { old: $('#cpOld').value, password: $('#cpNew').value }); closeModal(); toast('Passwort geändert'); } catch (e) { $('#cpErr').textContent = e.message; } };
};
window.cloudDelete = async () => {
  const pw = await promptBox('Konto endgültig löschen?', 'Zur Bestätigung dein Passwort', '', 'Löschen');
  if (!pw) return;
  try { await api('cloud.delete', { password: pw }); toast('Orbit-Konto gelöscht'); await cloudStatus(); setBody(); } catch (e) { fail('Löschen fehlgeschlagen', e); }
};

/* ======================= PLAY VIA THE OFFICIAL MINECRAFT LAUNCHER ======================= */
async function playOfficial(id) {
  const i = instById(id); if (!i) return;
  toast('Wird vorbereitet', `${i.name} für den Minecraft Launcher`);
  try {
    const r = await api('launch.official', { id });
    modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button><div class="upd-hero"><span class="iic">${ico('rocket')}</span><div><div class="kicker">Offizieller Minecraft Launcher</div><h1>Fast geschafft</h1></div></div>
      <ol class="steps2"><li>${r.opened ? 'Der Minecraft Launcher öffnet sich gerade.' : 'Öffne den Minecraft Launcher.'}</li><li>Melde dich dort mit deinem Microsoft-Konto an (nur beim ersten Mal).</li><li>Wähle unten links das Profil <b>${esc(r.profile)}</b> und drück <b>Spielen</b>.</li></ol>
      ${r.found || r.opened ? '' : '<div class="note w">Der Minecraft Launcher wurde nicht gefunden. Du bekommst ihn kostenlos auf minecraft.net.</div>'}
      <p class="fine">Mods, Welten und Einstellungen bleiben in deiner OrbitLauncher-Instanz. Live-Konsole und Spielzeit gibt es in diesem Modus nicht.</p>
      <div class="act" style="justify-content:flex-end">${r.found || r.opened ? '' : `<button class="btn" onclick="openUrl('https://www.minecraft.net/de-de/download')">${ico('ext')}Launcher herunterladen</button>`}<button class="btn p" onclick="closeModal()">Alles klar</button></div>`, 'form');
  } catch (e) { fail('Vorbereiten fehlgeschlagen', e); }
}
window.playOfficial = playOfficial;
/* no Microsoft account in OrbitLauncher: let the player choose */
function playChoice(id, extra) {
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button><div class="kicker">Spielen</div><h1>Wie möchtest du starten?</h1>
    <div class="col" style="gap:10px;margin-top:16px">
      <button class="mtile" id="pcOff"><span class="iic">${ico('rocket')}</span><span style="flex:1"><b>Über den Minecraft Launcher</b><small>Anmeldung im offiziellen Launcher, OrbitLauncher bereitet alles vor</small></span>${ico('right')}</button>
      <button class="mtile" id="pcMs"><span class="iic">${ico('user')}</span><span style="flex:1"><b>Mit Microsoft in OrbitLauncher</b><small>Direkt starten, mit Live-Konsole und Spielzeit</small></span>${ico('right')}</button></div>
    <div class="fsw" style="padding:14px 0 0"><span>Auswahl merken</span><div class="tg sm" id="pcRem" onclick="this.classList.toggle('on')"></div></div>`, 'form');
  const rem = v => { if ($('#pcRem').classList.contains('on')) setS('playMode', v); };
  $('#pcOff').onclick = () => { rem('official'); closeModal(); playOfficial(id); };
  $('#pcMs').onclick = () => { rem('orbit'); closeModal(); S.afterLogin = () => play(id, extra); gate(true); };
}
window.playOfficialPick = () => { const i = S.instances[0]; if (i) playOfficial(i.id); else newInstance(); };

/* ======================= LAUNCHER UPDATES ======================= */
async function checkUpdate(manual) {
  let u;
  try { u = await api('update.check'); } catch (e) { if (manual) fail('Update-Prüfung fehlgeschlagen', e); return null; }
  S.upd = u;
  if (S.page === 'settings' && S.stab === 'about' && !manual) setBody();
  if (u.error) { if (manual) fail('Update-Prüfung fehlgeschlagen', u.error); return u; }
  if (!u.available) { $('#updPill').classList.add('hidden'); if (manual) toast('Alles aktuell', 'OrbitLauncher ' + u.current); return u; }
  $('#updPill').classList.remove('hidden'); $('#updPillTxt').textContent = 'Update ' + u.latest;
  if (manual) updatePrompt(u);
  else if (S.settings.autoInstall && !S.running.size) installUpdate(true);
  else { let seen = ''; try { seen = localStorage.getItem('orbit.updSeen') || ''; } catch { } if (seen !== u.latest) updatePrompt(u); }
  return u;
}
window.checkUpdate = checkUpdate;
function updatePrompt(u) {
  if (!u?.available) return;
  try { localStorage.setItem('orbit.updSeen', u.latest); } catch { }
  modal(`<button class="ib x" onclick="closeModal()">${ico('x')}</button><div class="upd-hero"><span class="iic">${blockSvg('orbit')}</span><div><div class="kicker">Neue Version</div><h1>OrbitLauncher ${esc(u.latest)}</h1><p class="sub" style="margin:4px 0 0">Du hast ${esc(u.current)}${u.date ? ' · erschienen am ' + esc(u.date) : ''}${u.size ? ' · ' + bytes(u.size) : ''}</p></div></div>
    ${u.notes?.length ? `<ul class="upd-notes">${u.notes.map(n => `<li>${ico('check')}<span>${esc(n)}</span></li>`).join('')}</ul>` : ''}
    <div class="upd-meter hidden" id="updMeter"><div class="bar"><i id="updBar" style="width:0"></i></div><small id="updProg"></small></div>
    ${S.running.size ? '<div class="note w" style="margin-top:12px">Minecraft läuft gerade. Das Update wird nach dem Spielen installiert.</div>' : ''}
    <div class="act" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">Später</button><button class="btn p" id="updBtn" onclick="installUpdate()" ${S.running.size ? 'disabled' : ''}>${ico('download')}<span>Jetzt aktualisieren</span></button></div>`, 'form');
}
window.updatePrompt = updatePrompt;
function updProgress(d) {
  if (!$('#updMeter')) return;
  $('#updMeter').classList.remove('hidden'); $('#updBar').style.width = d.pct + '%';
  $('#updProg').textContent = d.total ? `${bytes(d.done)} / ${bytes(d.total)} · ${d.pct}%` : '';
}
async function installUpdate(silent) {
  if (S.updating) return; S.updating = true;
  const b = $('#updBtn'); if (b) { b.disabled = true; b.querySelector('span').textContent = 'Lädt…'; }
  if (silent) toast('Update wird geladen', 'OrbitLauncher ' + S.upd.latest + ' startet gleich neu');
  try {
    await api('update.download');
    if ($('#updProg')) $('#updProg').textContent = 'Installiere, OrbitLauncher startet gleich neu…';
    await sleep(400); await api('update.install');
  } catch (e) { S.updating = false; if (b) { b.disabled = false; b.querySelector('span').textContent = 'Erneut versuchen'; } fail('Update fehlgeschlagen', e); }
}
window.installUpdate = installUpdate;


/* ======================= WINDOW RESIZE (WebView covers the frame, so the edges are HTML) ======================= */
$('#rz').addEventListener('mousedown', e => { const i = e.target.closest('[data-e]'); if (i && e.button === 0) { e.preventDefault(); api('win.resize', { edge: i.dataset.e }); } });

/* ======================= BACKGROUND EFFECTS (snow / embers / stars), cheap canvas, paused while playing ======================= */
/* Background effects, tuned to cost almost nothing:
   - glow particles are pre-rendered sprites (no gradients per frame)
   - ~24 fps, device pixel ratio 1, fewer particles
   - paused while the launcher is not focused, minimized or Minecraft runs */
const FX = { mode: 'snow', parts: [], raf: 0, last: 0, w: 0, h: 0, dpr: 1, acc: '255,122,61', spr: {}, on: true };
function fxSprite(key, size, draw) {
  const k = key + size + FX.acc; if (FX.spr[k]) return FX.spr[k];
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  return FX.spr[k] = c;
}
const fxGlow = (rgb, a, size) => fxSprite('g' + rgb + a, size, (x, s) => { const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); x.fillStyle = g; x.fillRect(0, 0, s, s); });
function fxSet(mode) {
  FX.mode = mode || 'snow';
  FX.acc = getComputedStyle(document.documentElement).getPropertyValue('--a-rgb').trim() || '255,122,61'; FX.spr = {};
  $('#fx').classList.toggle('hidden', FX.mode === 'off');
  fxInit(); fxLoop();
}
function fxInit() {
  const c = $('#fx'); FX.dpr = 1;
  FX.w = innerWidth; FX.h = innerHeight; c.width = FX.w; c.height = FX.h;
  const A = FX.w * FX.h;
  const n = { snow: A / 16000, embers: A / 30000, stars: A / 9000, rain: A / 11000, fireflies: A / 40000, sakura: A / 38000, aurora: A / 14000 }[FX.mode] | 0;
  FX.parts = Array.from({ length: Math.min(n, 220) }, () => fxNew(true));
  FX.au = null;
}
function fxNew(any) {
  const W = FX.w, H = FX.h, r = Math.random;
  if (FX.mode === 'snow') { const z = r(); return { x: r() * W, y: any ? r() * H : -10, z, s: 0.8 + z * 2.4, vy: 0.22 + z * 0.75, sw: r() * Math.PI * 2, sp: 0.004 + r() * 0.012, a: 0.25 + z * 0.6 }; }
  if (FX.mode === 'embers') { const z = r(); return { x: r() * W, y: any ? r() * H : H + 10, z, s: 0.8 + z * 2.2, vy: -(0.25 + z * 0.7), vx: (r() - 0.5) * 0.3, life: any ? r() * 400 : 0, max: 500 + r() * 700, sw: r() * 6 }; }
  if (FX.mode === 'rain') { const z = r(); return { x: r() * (W + 200), y: any ? r() * H : -30 - r() * 200, z, l: 7 + z * 12, vy: 3.2 + z * 3.4, a: 0.1 + z * 0.25 }; }
  if (FX.mode === 'fireflies') return { x: r() * W, y: r() * H, s: 1 + r() * 1.8, a: r() * 6.28, sp: 0.15 + r() * 0.3, t: r() * 6.28, tw: 0.02 + r() * 0.03 };
  if (FX.mode === 'sakura') { const z = r(); return { x: r() * W * 1.2 - W * 0.2, y: any ? r() * H : -20, z, s: 3 + z * 5, vy: 0.3 + z * 0.7, vx: 0.2 + r() * 0.45, rot: r() * 6.28, vr: (r() - 0.5) * 0.05, sw: r() * 6.28 }; }
  return { x: r() * W, y: r() * H, s: 0.4 + r() * 1.3, t: r() * 6.28, sp: 0.01 + r() * 0.03 };
}
let fxShoot = null, fxT = 0;
function fxDraw(dt) {
  const c = $('#fx'), x = c.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, FX.w, FX.h);
  const acc = FX.acc;
  if (FX.mode === 'snow') {
    const big = fxGlow('255,255,255', .9, 16);
    x.fillStyle = '#fff';
    for (const p of FX.parts) {
      p.sw += p.sp * dt; p.y += p.vy * dt; p.x += Math.sin(p.sw) * (0.25 + p.z * 0.4) * dt;
      if (p.y > FX.h + 10) Object.assign(p, fxNew(false));
      x.globalAlpha = p.a;
      if (p.z > 0.8) { const s = p.s * 3.6; x.drawImage(big, p.x - s / 2, p.y - s / 2, s, s); }
      else x.fillRect(p.x, p.y, p.s, p.s);
    }
  } else if (FX.mode === 'embers') {
    const spr = fxGlow(acc, .9, 24);
    for (const p of FX.parts) {
      p.life += dt; p.sw += 0.02 * dt; p.y += p.vy * dt; p.x += (p.vx + Math.sin(p.sw) * 0.25) * dt;
      if (p.y < -10 || p.life > p.max) Object.assign(p, fxNew(false));
      x.globalAlpha = Math.min(1, p.life / 60) * Math.max(0, 1 - p.life / p.max);
      const s = p.s * 8; x.drawImage(spr, p.x - s / 2, p.y - s / 2, s, s);
    }
  } else if (FX.mode === 'rain') {
    x.lineWidth = 1; x.strokeStyle = '#bcd4ff'; x.beginPath();
    x.globalAlpha = 0.28;
    for (const p of FX.parts) {
      p.y += p.vy * dt; p.x -= p.vy * 0.16 * dt;
      if (p.y > FX.h + 20) Object.assign(p, fxNew(false));
      x.moveTo(p.x, p.y); x.lineTo(p.x + p.l * 0.16, p.y - p.l);
    }
    x.stroke();
  } else if (FX.mode === 'fireflies') {
    const spr = fxSprite('ff' + acc, 32, (g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(255,240,150,.95)'); r.addColorStop(.25, `rgba(${acc},.4)`); r.addColorStop(1, `rgba(${acc},0)`); g.fillStyle = r; g.fillRect(0, 0, s, s); });
    for (const p of FX.parts) {
      p.a += (Math.random() - 0.5) * 0.12 * dt; p.x += Math.cos(p.a) * p.sp * dt; p.y += Math.sin(p.a) * p.sp * dt; p.t += p.tw * dt;
      if (p.x < -20) p.x = FX.w + 20; if (p.x > FX.w + 20) p.x = -20; if (p.y < -20) p.y = FX.h + 20; if (p.y > FX.h + 20) p.y = -20;
      x.globalAlpha = 0.25 + Math.max(0, Math.sin(p.t)) * 0.75;
      const s = p.s * 12; x.drawImage(spr, p.x - s / 2, p.y - s / 2, s, s);
    }
  } else if (FX.mode === 'sakura') {
    const pet = c2 => fxSprite('pt' + c2, 20, (g, s) => { g.fillStyle = c2; g.beginPath(); g.moveTo(s / 2, 1); g.bezierCurveTo(s - 1, 1, s - 1, s * .8, s / 2, s - 1); g.bezierCurveTo(1, s * .8, 1, 1, s / 2, 1); g.fill(); });
    const A = pet('#ffc4d8'), B = pet('#ff9fbf');
    for (const p of FX.parts) {
      p.sw += 0.02 * dt; p.y += p.vy * dt; p.x += (p.vx + Math.sin(p.sw) * 0.5) * dt; p.rot += p.vr * dt;
      if (p.y > FX.h + 20 || p.x > FX.w + 40) Object.assign(p, fxNew(false));
      x.globalAlpha = 0.55 + p.z * 0.35;
      x.setTransform(Math.cos(p.rot), Math.sin(p.rot), -Math.sin(p.rot) * (0.55 + Math.abs(Math.sin(p.sw)) * 0.45), Math.cos(p.rot) * (0.55 + Math.abs(Math.sin(p.sw)) * 0.45), p.x, p.y);
      const s = p.s * 2; x.drawImage(p.z > .5 ? A : B, -s / 2, -s / 2, s, s);
    }
    x.setTransform(1, 0, 0, 1, 0, 0);
  } else if (FX.mode === 'aurora') {
    fxT += 0.003 * dt;
    x.fillStyle = '#fff';
    for (const p of FX.parts) { p.t += p.sp * dt; x.globalAlpha = 0.15 + Math.abs(Math.sin(p.t)) * 0.45; x.fillRect(p.x, p.y, p.s, p.s); }
    // the lights are drawn small and scaled up (soft by nature, a fraction of the work)
    const q = 8, aw = Math.ceil(FX.w / q), ah = Math.ceil(FX.h / q);
    if (!FX.au) { FX.au = document.createElement('canvas'); FX.au.width = aw; FX.au.height = ah; }
    const a = FX.au.getContext('2d'); a.clearRect(0, 0, aw, ah); a.globalCompositeOperation = 'lighter';
    for (const [col, al, ph] of [[acc, 0.18, 0], ['80,255,190', 0.13, 2.1], ['140,120,255', 0.11, 4.2]]) {
      for (let i = 0; i < aw; i++) {
        const X = i * q, yy = (FX.h * 0.22 + Math.sin(X * 0.004 + fxT * 2 + ph) * 60 + Math.sin(X * 0.011 - fxT * 3 + ph) * 25) / q;
        const h = (140 + Math.sin(X * 0.007 + fxT * 4 + ph) * 70) / q;
        const g = a.createLinearGradient(0, yy - h, 0, yy + 4); g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(0.75, `rgba(${col},${al})`); g.addColorStop(1, `rgba(${col},0)`);
        a.fillStyle = g; a.fillRect(i, yy - h, 1, h + 4);
      }
    }
    x.globalAlpha = 1; x.imageSmoothingEnabled = true; x.drawImage(FX.au, 0, 0, FX.w, FX.h);
  } else if (FX.mode === 'stars') {
    x.fillStyle = '#fff';
    for (const p of FX.parts) { p.t += p.sp * dt; x.globalAlpha = 0.25 + Math.abs(Math.sin(p.t)) * 0.6; x.fillRect(p.x, p.y, p.s, p.s); }
    if (!fxShoot && Math.random() < 0.003 * dt) fxShoot = { x: Math.random() * FX.w * 0.7 + FX.w * 0.2, y: Math.random() * FX.h * 0.4, l: 0 };
    if (fxShoot) {
      const s = fxShoot; s.l += 1.4 * dt; const len = 120, px = s.x - s.l * 9, py = s.y + s.l * 4;
      const g = x.createLinearGradient(px, py, px + len, py - len * 0.45); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.globalAlpha = Math.max(0, 1 - s.l / 40); x.strokeStyle = g; x.lineWidth = 1.6; x.beginPath(); x.moveTo(px, py); x.lineTo(px + len, py - len * 0.45); x.stroke();
      if (s.l > 40) fxShoot = null;
    }
  }
  x.globalAlpha = 1;
  // the modpack spotlight stays in front: cut it out of the effect layer
  if (S.page === 'home') {
    const sp = document.getElementById('spot');
    if (sp) {
      const r = sp.getBoundingClientRect();
      if (r.bottom > 0 && r.top < FX.h) {
        x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'destination-out'; x.beginPath();
        if (x.roundRect) x.roundRect(r.left, r.top, r.width, r.height, 26); else x.rect(r.left, r.top, r.width, r.height);
        x.fill(); x.restore();
      }
    }
  }
}
function fxLoop() {
  cancelAnimationFrame(FX.raf); FX.raf = 0;
  const c = $('#fx');
  if (FX.mode === 'off') { c.getContext('2d').clearRect(0, 0, c.width, c.height); return; }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { fxDraw(0); return; }   // still image
  if (!FX.on) return;
  const step = t => {
    FX.raf = requestAnimationFrame(step);
    if (document.hidden || S.running.size || t - FX.last < 41) return;   // ~24 fps, nothing while Minecraft runs
    const dt = Math.min(3, (t - FX.last) / 16.7); FX.last = t;
    fxDraw(dt);
  };
  FX.raf = requestAnimationFrame(step);
}
// no animation at all while the launcher is in the background
window.addEventListener('blur', () => { FX.on = false; cancelAnimationFrame(FX.raf); FX.raf = 0; });
window.addEventListener('focus', () => { if (FX.on) return; FX.on = true; FX.last = performance.now(); fxLoop(); });

let fxRT = 0; window.addEventListener('resize', () => { clearTimeout(fxRT); fxRT = setTimeout(() => { fxInit(); if (matchMedia('(prefers-reduced-motion: reduce)').matches) fxDraw(0); }, 200); });


/* ======================= STYLED DROPDOWNS (every <select class="sel"> gets an own menu) ======================= */
function cselLabel(sel) { const o = sel.options[sel.selectedIndex]; return o ? o.textContent : ''; }
function cselSync(sel) {
  const b = sel._csel; if (!b) return;
  b.querySelector('span').textContent = cselLabel(sel) || '—';
  b.disabled = sel.disabled;
}
function cselOpen(sel) {
  const pop = $('#selpop'), b = sel._csel;
  if (!pop.classList.contains('hidden') && pop._for === sel) return cselClose();
  const opts = [...sel.options], many = opts.length > 12;
  pop._for = sel;
  pop.innerHTML = (many ? `<div class="csel-q"><input class="in" placeholder="Suchen…"></div>` : '') + `<div class="csel-list">${opts.map((o, i) => `<button data-i="${i}" class="${i === sel.selectedIndex ? 'on' : ''}" ${o.disabled ? 'disabled' : ''}>${esc(o.textContent)}${i === sel.selectedIndex ? ico('check') : ''}</button>`).join('')}</div>`;
  pop.classList.remove('hidden');
  const r = b.getBoundingClientRect(), w = Math.max(r.width, 180);
  pop.style.width = w + 'px';
  pop.style.left = Math.min(innerWidth - w - 10, r.left) + 'px';
  const h = pop.offsetHeight, below = innerHeight - r.bottom - 10;
  pop.style.top = (below >= Math.min(h, 220) ? r.bottom + 6 : Math.max(10, r.top - h - 6)) + 'px';
  pop.querySelector('.csel-list .on')?.scrollIntoView({ block: 'center' });
  b.classList.add('open');
  const q = pop.querySelector('.csel-q input');
  if (q) { setTimeout(() => q.focus(), 30); q.oninput = () => { const t = q.value.toLowerCase(); pop.querySelectorAll('.csel-list button').forEach(x => x.classList.toggle('hidden', !!t && !x.textContent.toLowerCase().includes(t))); }; }
  pop.onclick = e => {
    const o = e.target.closest('[data-i]'); if (!o) return;
    sel.selectedIndex = +o.dataset.i; cselSync(sel); cselClose();
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  };
}
function cselClose() { const pop = $('#selpop'); pop.classList.add('hidden'); pop._for?._csel?.classList.remove('open'); pop._for = null; }
function cselEnhance(root = document) {
  root.querySelectorAll('select.sel:not([data-csel])').forEach(sel => {
    sel.dataset.csel = '1';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'csel' + (sel.classList.contains('wide') ? ' wide' : '');
    if (sel.getAttribute('style')) b.setAttribute('style', sel.getAttribute('style'));
    b.innerHTML = `<span></span>${ico('chevd')}`;
    sel._csel = b; sel.classList.add('sel-native');
    sel.after(b); cselSync(sel);
    b.onclick = e => { e.stopPropagation(); cselOpen(sel); };
    new MutationObserver(() => cselSync(sel)).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    sel.addEventListener('change', () => cselSync(sel));
  });
}
new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches?.('select.sel')) cselEnhance(n.parentElement || document); else if (n.querySelector?.('select.sel')) cselEnhance(n); } })
  .observe(document.body, { childList: true, subtree: true });
document.addEventListener('mousedown', e => { if (!e.target.closest('#selpop') && !e.target.closest('.csel')) cselClose(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') cselClose(); });
window.addEventListener('resize', cselClose);
document.addEventListener('scroll', e => { if (!e.target.closest?.('#selpop')) cselClose(); }, true);
cselEnhance();

/* ======================= BOOT ======================= */
async function boot() {
  const t0 = performance.now();
  let init;
  try { init = await api('init'); } catch (e) { fail('Start fehlgeschlagen', e); init = { settings: {}, instances: [], accounts: [] }; }
  S.settings = init.settings || {}; S.instances = init.instances || []; S.accounts = init.accounts || []; S.active = init.active; S.version = init.version || S.version; S.root = init.root || '';
  (init.running || []).forEach(id => S.running.add(id));
  S.needAppId = !!init.needAppId;
  S.user = init.user || '';
  cloudStatus();
  applyTheme(S.settings.accent || 'ember'); applyMode(S.settings.mode);
  fxSet(S.settings.fx || 'snow');
  accountUI(); runUI();
  api('orbit.info').then(r => { S.orbitInfo = r; S.orbitSupported = r.supported; }).catch(() => { });
  ensureVersions().catch(() => { });
  const q = new URLSearchParams(location.search);
  const args = {}; ['id', 'tab', 'target', 'type', 'src'].forEach(k => { if (q.get(k)) args[k] = q.get(k); });
  go(q.get('page') || 'home', args);
  if (!S.accounts.length && (S.settings.firstRun || q.has('gate'))) { gate(true); if (S.settings.firstRun) setS('firstRun', false); }
  requestAnimationFrame(moveInd);
  if (S.settings.autoUpdate !== false) setTimeout(() => checkUpdate(false), 2000);
  api('app.args').then(r => { if (r?.launch && instById(r.launch)) { go('inst', { id: r.launch }); play(r.launch); } }).catch(() => { });
  if (!HOST && q.get('run')) setTimeout(() => (0, eval)(q.get('run')), 400);
  if (q.has('shot')) $('#splash').remove(); else setTimeout(() => $('#splash').classList.add('out'), Math.max(0, 700 - (performance.now() - t0)));
}

/* ======================= MOCK BACKEND (browser preview) ======================= */
const H = 3600e3, DAY = 86400e3, iso = ms => new Date(Date.now() - ms).toISOString();
const Mock = {
  cloud: /[?&]cloud=1/.test(location.search) ? 'Ky3ls' : null,
  settings: { accent: 'ember', ramMb: 4096, onLaunch: 'minimize', clientId: '', firstRun: false, orbitPacks: 'perf,shaders,qol' },
  accounts: [{ uuid: '4a6f9e2c1b7d4e8f9a0b1c2d3e4f5a6b', name: 'Ky3ls', skin: null }],
  instances: [
    { id: 'orbit-client-26-3', name: 'Orbit Client 26.3', mcVersion: '26.3', loader: 'fabric', loaderVersion: '0.20.1', kind: 'orbit', icon: 'orbit', ramMb: 3072, playSeconds: 46800, lastPlayed: iso(H), created: iso(DAY * 20), mods: 19, group: 'PvP', content: [] },
    { id: 'fabulously-optimized', name: 'Fabulously Optimized', mcVersion: '1.21.11', loader: 'fabric', loaderVersion: '0.18.4', kind: 'modpack', icon: 'box', iconUrl: null, modpackProject: 'fabulously-optimized', ramMb: 4096, playSeconds: 72000, lastPlayed: iso(DAY), created: iso(DAY * 30), mods: 49, content: [] },
    { id: 'survival-1-21-11', name: 'Survival mit Freunden', mcVersion: '1.21.11', loader: 'vanilla', kind: 'custom', icon: 'grass', ramMb: 0, playSeconds: 210000, lastPlayed: iso(DAY * 2), created: iso(DAY * 90), mods: 0, group: 'Survival', content: [] },
    { id: 'technik-abenteuer', name: 'Technik-Abenteuer', mcVersion: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.266', kind: 'custom', icon: 'ruby', ramMb: 8192, playSeconds: 92000, lastPlayed: iso(DAY * 5), created: iso(DAY * 60), mods: 214, group: 'Survival', content: [] },
    { id: 'pvp-1-8-9', name: 'PvP 1.8.9', mcVersion: '1.8.9', loader: 'vanilla', kind: 'custom', icon: 'diamond', ramMb: 2048, playSeconds: 12000, lastPlayed: iso(DAY * 12), created: iso(DAY * 120), mods: 0, group: 'PvP', content: [] },
    { id: 'beta-nostalgie', name: 'Beta-Nostalgie', mcVersion: 'b1.7.3', loader: 'vanilla', kind: 'custom', icon: 'sand', ramMb: 1024, playSeconds: 5400, lastPlayed: iso(DAY * 40), created: iso(DAY * 200), mods: 0, content: [] },
  ],
  mods: { 'orbit-client-26-3': ['fabric-api', 'modmenu', 'sodium', 'lithium', 'iris', 'ferrite-core', 'entityculling', 'immediatelyfast', 'dynamic-fps', 'appleskin', 'mouse-tweaks', 'no-chat-reports'], 'fabulously-optimized': ['sodium', 'lithium', 'iris', 'continuity', 'entityculling', 'ferrite-core', 'zoomify', 'modmenu', 'fabric-api', 'yacl', 'cloth-config', 'lambdynamiclights'], 'technik-abenteuer': ['create', 'jei', 'jade', 'sophisticated-backpacks', 'waystones', 'appleskin'] },
  versions: null,
  /* extended catalog preview: standard data reshaped into its API format (the real one needs an API key) */
  cfIds: {},
  cfId(pid) { let h = 0; for (const c of pid) h = (h * 31 + c.charCodeAt(0)) >>> 0; const id = 200000 + h % 800000; this.cfIds[id] = pid; return id; },
  cfMod(h) {
    const cls = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552 }[h.project_type] || 6, lt = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
    const vers = (h.versions || h.game_versions || []).slice(-6), lds = (h.categories || h.loaders || []).filter(c => lt[c]);
    return { id: this.cfId(h.project_id || h.id), name: h.title, slug: h.slug, summary: h.description, downloadCount: h.downloads, thumbsUpCount: Math.round((h.follows || h.followers || 0) / 3), classId: cls,
      logo: { thumbnailUrl: h.icon_url }, screenshots: (h.gallery || []).slice(0, 6).map(g => ({ url: g.url || g, thumbnailUrl: g.url || g, title: g.title })), authors: [{ name: h.author || 'Autor' }],
      categories: (h.display_categories || h.categories || []).filter(c => !lt[c]).slice(0, 3).map(c => ({ name: catName(c) })), dateModified: h.date_modified || h.updated, dateCreated: h.date_created || h.published,
      latestFilesIndexes: vers.flatMap(v => lds.map(l => ({ gameVersion: v, modLoader: lt[l] }))), links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/' + h.slug, issuesUrl: h.issues_url, sourceUrl: h.source_url }, allowModDistribution: true };
  },
  async cfGet(path) {
    const mrj = async p => (await fetch('https://api.modrinth.com/v2' + p)).json();
    const u = new URL('https://x' + path), q = u.searchParams;
    if (u.pathname === '/categories') { const t = { 6: 'mod', 4471: 'modpack', 12: 'resourcepack', 6552: 'shader' }[q.get('classId')]; return { data: (await mrj('/tag/category')).filter(c => c.project_type === t && c.header === 'categories').map((c, i) => ({ id: 1000 + i, name: catName(c.name), iconUrl: null })) }; }
    if (u.pathname === '/mods/search') {
      const t = { 6: 'mod', 4471: 'modpack', 12: 'resourcepack', 6552: 'shader' }[q.get('classId')], f = [[`project_type:${t}`]];
      if (q.get('gameVersion')) f.push([`versions:${q.get('gameVersion')}`]);
      const idx = { 1: 'relevance', 2: 'follows', 3: 'updated', 6: 'downloads', 11: 'newest' }[q.get('sortField')] || 'relevance';
      const r = await mrj(`/search?limit=${q.get('pageSize')}&offset=${q.get('index')}&index=${idx}&facets=${encodeURIComponent(JSON.stringify(f))}${q.get('searchFilter') ? '&query=' + encodeURIComponent(q.get('searchFilter')) : ''}`);
      return { data: r.hits.map(h => this.cfMod({ ...h, gallery: h.featured_gallery ? [h.featured_gallery] : h.gallery })), pagination: { totalCount: Math.round(r.total_hits * 1.4) } };
    }
    const m = /^\/mods\/(\d+)(\/description|\/files(?:\/(\w+)\/changelog)?)?$/.exec(u.pathname); if (!m) return { data: [] };
    const pid = this.cfIds[m[1]]; if (!pid) throw new Error('404');
    if (!m[2]) return { data: this.cfMod(await mrj('/project/' + pid)) };
    if (m[2] === '/description') return { data: (await mrj('/project/' + pid)).body };
    const vs = await mrj(`/project/${pid}/version`);
    if (m[3]) return { data: (vs.find(v => v.id === m[3]) || {}).changelog || '' };
    return { data: vs.slice(0, 50).map(v => ({ id: v.id, displayName: v.name, fileName: v.files[0]?.filename, releaseType: { release: 1, beta: 2, alpha: 3 }[v.version_type], fileDate: v.date_published, fileLength: v.files[0]?.size, downloadCount: v.downloads, downloadUrl: 'x', gameVersions: v.game_versions.concat(v.loaders.map(cap)), dependencies: [] })) };
  },
  async projs(slugs) {
    try { const r = await (await fetch('https://api.modrinth.com/v2/projects?ids=' + encodeURIComponent(JSON.stringify(slugs)))).json(); return r; } catch { return []; }
  },
  async call(cmd, a) {
    await sleep(50); const M = this;
    const inst = () => M.instances.find(x => x.id === a.id);
    switch (cmd) {
      case 'init': {
        if (/gate|noid/.test(location.search)) M.accounts = [];
        if (!M.fo) { M.fo = 1; try { const p = await (await fetch('https://api.modrinth.com/v2/project/fabulously-optimized')).json(); const g = (p.gallery || []).find(x => x.featured) || p.gallery?.[0]; M.instances[1].iconUrl = p.icon_url; M.instances[1].bannerUrl = g?.url || g?.raw_url; M.instances[1].modpackProject = p.id; } catch { } }
        if (/running/.test(location.search)) setTimeout(() => onEvent('state', { id: 'orbit-client-26-3', running: true }), 400);
        return { user: 'Ky3ls', needAppId: /noid/.test(location.search), version: '0.3.0', root: 'C:\\Users\\Ky3ls\\AppData\\Roaming\\OrbitLauncher', settings: M.settings, instances: M.instances, accounts: M.accounts, active: M.accounts[0]?.uuid, running: [] };
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
      case 'library.stats': await sleep(300); return { size: 14.2e9, worlds: 17, screenshots: 42, shaders: 6, resourcepacks: 11 };
      case 'instance.stats': await sleep(250); return { size: 1.6e9 + (inst().mods || 0) * 9e6, mods: inst().mods || 0, resourcepacks: 3, shaders: inst().loader === 'vanilla' ? 0 : 2, worlds: 4, screenshots: 12, updates: 0 };
      case 'instance.shortcut': return { path: 'C:\\Users\\Ky3ls\\Desktop\\' + inst().name + '.lnk' };
      case 'app.args': return { launch: null };
      case 'instance.repair': await sleep(800); return { ok: true };
      case 'content.resolve': return { changed: false };
      case 'instance.content': {
        const i = inst();
        if (a.type === 'mod') {
          const slugs = M.mods[a.id] || []; if (!slugs.length) return [];
          const ps = await M.projs(slugs);
          const rows = slugs.map((s, k) => { const p = ps.find(x => x.slug === s); return { title: p?.title || s, file: `${s}-${i.mcVersion}.jar`, version: p ? (p.versions?.length ? `${(k % 3) + 1}.${k + 2}.${k * 3 % 10}` : '1.0') : '1.0', size: (0.3 + (k * 0.37) % 3) * 1e6, on: k !== 7, dependency: ['fabric-api', 'yacl', 'cloth-config'].includes(s), projectId: a.id === 'technik-abenteuer' && k % 2 ? 'cf:' + (238000 + k) : p?.id, icon: p?.icon_url }; });
          if (i.kind === 'modpack') for (let n = rows.length; n < 30; n++) rows.push({ title: 'Mod ' + (n + 1), file: `mod-${n}.jar`, version: '1.0.' + n, size: 1e6 + n * 1000, on: true, projectId: 'mod-' + n, source: 'modrinth' });
          return rows;
        }
        if (a.type === 'shader' && i.loader === 'fabric') return i.kind === 'modpack'
          ? [{ title: 'Complementary Reimagined', file: 'ComplementaryReimagined_r5.6.zip', on: true, size: 4.1e6, version: 'r5.6', projectId: 'complementary-reimagined', source: 'modrinth' }, { title: '§6§lI Like Vanilla v1.4.zip', file: '§6§lI Like Vanilla v1.4.zip', on: true, size: 1.2e6, source: 'local' }]
          : [{ title: 'Complementary Reimagined', file: 'ComplementaryReimagined_r5.6.zip', on: true, size: 4.1e6, version: 'r5.6' }];
        if (a.type === 'resourcepack' && i.kind === 'modpack') return [{ title: "§6Bray's Bow and Arrows v1.2.4.zip", file: "§6Bray's Bow and Arrows v1.2.4.zip", on: true, size: 2.4e6, source: 'local' }, { title: '§3Fresh §bWeapons & Tools.zip', file: '§3Fresh §bWeapons & Tools.zip', on: true, size: 1.1e6, source: 'local' }, { title: 'Fresh Animations', file: 'FreshAnimations_v1.10.5.zip', on: true, size: 8.2e6, version: '1.10.5', projectId: 'fresh-animations', source: 'modrinth' }];
        if (a.type === 'resourcepack' && i.kind !== 'orbit') return [{ title: 'Fresh Animations', file: 'FreshAnimations_v1.10.zip', on: true, size: 2.2e6, version: '1.10' }];
        return [];
      }
      case 'content.updates': return [{ projectId: 'AANobbMI', title: 'Sodium', from: '0.8.14', to: '0.8.15', versionId: 'sodium-new' }, { projectId: 'mod-12', title: 'Mod 13', from: '1.0.12', to: '1.0.20', versionId: 'mod-12-new' }];
      case 'content.updateAll': await sleep(400); return { count: 1 };
      case 'content.versions': {
        const newest = a.projectId === 'AANobbMI' ? 'sodium-new' : a.projectId === 'mod-12' ? 'mod-12-new' : a.projectId + '-new';
        return [{ id: newest, number: '1.4.0', name: 'Neu', channel: 'release', date: iso(1), current: false }, { id: 'cur', number: '1.3.2', name: 'Aktuell', channel: 'release', date: iso(12), current: true }, { id: a.projectId + '-old', number: '1.2.0', name: 'Älter', channel: 'beta', date: iso(40), current: false }];
      }
      case 'content.setVersion': await sleep(250); return { count: 1 };
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
        return j.entries.slice(0, 6).map(e => ({ title: e.title, version: e.version, type: e.type, date: e.date, text: e.shortText, id: e.id, image: e.image ? 'https://launchercontent.mojang.com' + e.image.url : null }));
      } catch { return [{ title: 'Minecraft Java Edition 26.3', type: 'release', date: '2026-10-21', text: 'Das Herbst-Update ist da.' }]; }
      case 'cloud.status': return { loggedIn: !!M.cloud, name: M.cloud, lastSync: M.cloud ? iso(60e3 * 3) : null };
      case 'cloud.login': await sleep(400); if (a.password === 'zweit') return { need: 'totp', ticket: 't', name: a.name }; M.cloud = a.name; setTimeout(() => { onEvent('cloud', { state: 'sync' }); setTimeout(() => onEvent('cloud', { state: 'done', pushed: 6, pulled: 0, created: 0, at: iso(0) }), 900); }, 100); return { name: a.name };
      case 'cloud.totp': await sleep(300); if (a.code.replace(/\s/g, '') !== '123456') throw new Error('Code falsch.'); M.cloud = 'Ky3ls'; return { name: 'Ky3ls' };
      case 'cloud.totp.start': return { secret: 'ORBITLAUNCHERKEY234', otpauth: 'otpauth://totp/Orbit:Ky3ls?secret=ORBITLAUNCHERKEY234&issuer=Orbit' };
      case 'cloud.totp.confirm': if (a.code !== '123456') throw new Error('Code falsch.'); M.totpOn = true; return { recovery: ['K7NP-2QWM', 'H4RT-9LSD', 'B8CX-5VJA', 'M3QF-6YTE', 'P2WN-8KHC', 'D5LS-4RBG', 'Q9VM-3TXA', 'F6HJ-7NCE'] };
      case 'cloud.totp.disable': if (a.code !== '123456') throw new Error('Code falsch.'); M.totpOn = false; return {};
      case 'cloud.passkey.begin': return { challenge: 'aaaa', rpId: 'orbit.local', timeout: 60000, allowCredentials: [] };
      case 'cloud.passkey.finish': M.cloud = 'Ky3ls'; return { name: 'Ky3ls' };
      case 'cloud.passkey.add.begin': return { challenge: 'aaaa', rpId: 'orbit.local', timeout: 60000, user: { id: 'dQ', name: 'Ky3ls', displayName: 'Ky3ls' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }], excludeCredentials: [] };
      case 'cloud.passkey.add.finish': M.passkeys = [{ id: 'abc', name: 'Dieser PC', created: iso(0) }]; return { ok: true };
      case 'cloud.passkey.remove': M.passkeys = (M.passkeys || []).filter(p => p.id !== a.id); return {};
      case 'cloud.logout': M.cloud = null; return {};
      case 'cloud.sync': await sleep(900); return { pushed: 2, pulled: 1, created: 0, deleted: 0, restore: 0 };
      case 'cloud.me': return { name: M.cloud, created: iso(DAY * 3), items: 14, bytes: 412e3, maxBytes: 40e6, totp: !!M.totpOn, passkeys: M.passkeys || [], devices: [{ device: 'GAMING-PC', last: iso(60e3) }, { device: 'LAPTOP', last: iso(DAY * 2) }] };
      case 'launch.official': await sleep(800); return { profile: 'Orbit · ' + inst().name, opened: true, found: true };
      case 'update.check': return /upd/.test(location.search) ? { configured: true, current: '0.3.0', latest: '0.3.1', available: true, date: '15.11.2026', size: 73e6, notes: ['Automatische Updates direkt im Launcher', 'Update-Hinweis mit Änderungen und Fortschritt', 'Updates warten, bis Minecraft beendet ist'] } : { configured: true, current: '0.3.0', latest: '0.3.0', available: false };
      case 'update.download': for (let k = 0; k <= 100; k += 10) { onEvent('update', { pct: k, done: k * 73e4, total: 73e6 }); await sleep(80); } return { ok: true };
      case 'cf.status': return { ready: !/nocf/.test(location.search), own: false };
      case 'cf.get': return M.cfGet(a.path);
      case 'cf.install': await sleep(800); { const i = inst(); i.content = (i.content || []).concat([{ projectId: 'cf:' + a.project, type: 'mod', source: 'curseforge' }]); } return { installed: ['Projekt'], skipped: [] };
      case 'cf.modpack': await sleep(800); return M.instances[1];
      case 'server.ping': await sleep(300 + Math.random() * 500); return a.address.includes('hypixel') ? { online: true, players: 26183, max: 200000, motd: 'Hypixel Network [1.8/26.3]  SKYBLOCK GHOST VISITORS', version: 'Requires MC 1.8 / 1.21', ping: 42, icon: null } : { online: false, players: 0, max: 0, ping: -1 };
      case 'backup.list': return a.id === 'survival-1-21-11' ? [{ file: 'Neue Welt_2026-11-14_20-12-01.zip', world: 'Neue Welt', date: iso(DAY), size: 48e6 }, { file: 'Neue Welt_2026-11-10_18-40-55.zip', world: 'Neue Welt', date: iso(DAY * 5), size: 44e6 }] : [];
      case 'backup.create': await sleep(700); return { file: a.folder + '_x.zip', world: a.folder, date: iso(0), size: 51e6 };
      case 'backup.delete': case 'backup.restore': return { world: 'Neue Welt (Backup)' };
      case 'instance.export': await sleep(900); return { path: 'C:\\Users\\Ky3ls\\Desktop\\' + inst().name + '.mrpack' };
      case 'import.scan': await sleep(500); return [{ i: 0, launcher: 'Prism Launcher', name: 'Better MC 4', mc: '1.21.1', loader: 'fabric' }, { i: 1, launcher: 'Mod-Launcher', name: 'All the Mods 10', mc: '1.21.1', loader: 'neoforge' }];
      case 'import.run': await sleep(900); return M.instances[0];
      case 'screenshots.list': return ['survival-1-21-11', 'orbit-client-26-3', 'survival-1-21-11', 'technik-abenteuer', 'orbit-client-26-3', 'survival-1-21-11'].map((id, i) => ({ id, version: '', file: `2026-11-1${4 - (i >> 1)}_2${i}.14.0${i}.png`, url: 'data:image/svg+xml,' + encodeURIComponent(bannerSvg(i % 2 === 0, 675)), date: iso(i * DAY / 2) }));
      case 'mr.get': { const r = await fetch('https://api.modrinth.com/v2' + a.path); if (!r.ok) throw new Error('Katalog ' + r.status); return r.json(); }
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
      case 'skins.add': if (a.url || a.data) { const e = { id: 's' + Date.now(), name: a.name, variant: a.variant, url: a.data || a.url }; M.skins.unshift(e); return e; } return null;
      case 'skins.save': { const e = { id: a.id || 's' + Date.now(), name: a.name, variant: a.variant, url: a.data }; M.skins = (M.skins || []).filter(x => x.id !== e.id); M.skins.unshift(e); return e; }
      case 'skins.update': { const e = M.skins.find(x => x.id === a.id); if (a.name) e.name = a.name; if (a.variant) e.variant = a.variant; return {}; }
      case 'skins.remove': M.skins = M.skins.filter(x => x.id !== a.id); return {};
      case 'skin.profile': return M.prof || (M.prof = { id: M.accounts[0]?.uuid, name: 'Ky3ls', skins: [{ id: 'cur', state: 'ACTIVE', url: demoSkin(0), variant: 'CLASSIC' }], capes: [['c1', 'Migrator', '#3D9BFF', 'ACTIVE'], ['c2', 'Vanilla', '#2DD4A0', 'INACTIVE'], ['c3', 'Cherry Blossom', '#FF9FBF', 'INACTIVE']].map(([id, alias, col, state]) => { const c = document.createElement('canvas'); c.width = 64; c.height = 32; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 22, 17); x.fillStyle = shade(col, -.3); x.fillRect(1, 1, 10, 2); x.fillRect(3, 6, 6, 6); return { id, alias, state, url: c.toDataURL() }; }) });
      case 'skin.cape': M.prof.capes.forEach(c => c.state = c.id === a.id ? 'ACTIVE' : 'INACTIVE'); return M.prof;
      case 'skins.defaults': await sleep(400); return ['Steve', 'Alex', 'Ari', 'Efe', 'Kai', 'Makena', 'Noor', 'Sunny', 'Zuri'].flatMap((n, i) => [{ name: n, variant: 'classic', data: genSkin(i + 500, 'casual') }, { name: n, variant: 'slim', data: genSkin(i + 600, 'casual') }]);
      case 'skins.player': await sleep(400); return { name: a.name, variant: 'classic', data: genSkin(a.name.length * 7, 'gamer'), cape: null };
      case 'skins.link': throw new Error('Im Browser nicht verfügbar');
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
