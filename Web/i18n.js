/* OrbitLauncher language system.
   The interface is written in German; for every other language each visible text is looked up in that
   language's dictionary (Web/lang/<code>.js) as soon as it appears on screen: plain texts, texts with numbers or
   names inside ("{0} Einstellungen · {1} Tasten"), tooltips and placeholders. Texts that are not in the
   dictionary stay as they are, so nothing ever disappears. */
(() => {
  const LANGS = { de: ['Deutsch', 'de-DE'], en: ['English', 'en-GB'] };
  let lang = 'de';
  try { lang = localStorage.getItem('orbit.lang') || ''; } catch { }
  try { const q = new URLSearchParams(location.search).get('lang'); if (q) lang = q; } catch { }
  if (!LANGS[lang]) lang = (navigator.language || 'de').toLowerCase().startsWith('de') ? 'de' : 'en';

  const D = window.ORBIT_LANG || {};
  let exact = new Map(), tpls = [], ready = false;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function load() {
    const d = D[lang]; exact = new Map(); tpls = [];
    if (!d) return;
    for (const [k, v] of Object.entries(d.exact || {})) exact.set(norm(k), v);
    for (const [k, v] of Object.entries(d.tpl || {})) {
      const parts = k.split(/\{(\d+)\}/); let src = '^', order = [];
      for (let i = 0; i < parts.length; i++) { if (i % 2) { src += '(.*?)'; order.push(+parts[i]); } else src += esc(parts[i]); }
      tpls.push([new RegExp(src + '$'), v, order, parts.filter((_, i) => !(i % 2)).join('').length]);
    }
    tpls.sort((a, b) => b[3] - a[3]);   // the most specific template first
    ready = true;
  }
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const cache = new Map();

  /** Translates one piece of text (already trimmed). Returns null when nothing is known. */
  function word(t) {
    if (!t) return null;
    const e = exact.get(t); if (e != null) return e;
    for (const [re, v, order] of tpls) {
      const m = re.exec(t); if (!m) continue;
      return v.replace(/\{(\d+)\}/g, (_, n) => { const g = m[order.indexOf(+n) + 1] ?? ''; return word(g.trim()) ?? g; });
    }
    return null;
  }
  /** Whole text node: exact, template, then the parts around separators and known beginnings. */
  function tr(text) {
    const t = norm(text); if (!t || !/[A-Za-zÄÖÜäöüß]/.test(t)) return null;
    if (cache.has(t)) return cache.get(t);
    let r = word(t);
    // "Guten Abend," / "Version 1.2 ·": translate without the punctuation at the end
    if (r == null) { const m = /^(.*?)([\s,:;.!?·…–-]+)$/.exec(t); if (m && m[1]) { const w = word(m[1]) ?? lead(m[1]); if (w != null) r = w + m[2]; } }
    if (r == null) {
      const bits = t.split(/( · | – | — |: |, )/);
      if (bits.length > 1) {
        let any = false;
        r = bits.map((b, i) => { if (i % 2) return b; const w = word(b) ?? lead(b); if (w != null) { any = true; return w; } return b; }).join('');
        if (!any) r = null;
      } else r = lead(t);
    }
    if (cache.size > 6000) cache.clear();
    cache.set(t, r);
    return r;
  }
  // "Getragen bis 03.09.2026": a known beginning followed by a value
  function lead(t) {
    for (let i = t.lastIndexOf(' '); i > 2; i = t.lastIndexOf(' ', i - 1)) {
      const w = exact.get(t.slice(0, i));
      if (w != null) return w + t.slice(i);
    }
    for (let i = t.indexOf(' '); i > 0 && i < t.length - 3; i = t.indexOf(' ', i + 1)) {
      const w = exact.get(t.slice(i + 1));
      if (w != null && /^[\d.,:%+×\-\s]+$/.test(t.slice(0, i))) return t.slice(0, i + 1) + w;
    }
    return null;
  }

  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
  const done = new WeakMap();
  function node(n) {
    const v = n.nodeValue; if (!v || done.get(n) === v) return;
    for (let p = n.parentElement; p; p = p.parentElement) { if (SKIP.has(p.tagName) || p.classList?.contains('notr') || p.classList?.contains('logv')) return; if (p === document.body) break; }
    const r = tr(v);
    if (r != null && r !== norm(v)) {
      const lead = v.match(/^\s*/)[0], tail = v.match(/\s*$/)[0];
      const nv = lead + r + tail; done.set(n, nv); n.nodeValue = nv;
    } else done.set(n, v);
  }
  const ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip'];
  function attrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute?.(a); if (!v) continue;
      const key = '_tr_' + a; if (el[key] === v) continue;
      const r = tr(v); const nv = r ?? v; el[key] = nv; if (nv !== v) el.setAttribute(a, nv);
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return node(root);
    if (root.nodeType !== 1 || SKIP.has(root.tagName) || root.classList?.contains('notr')) return;
    attrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) node(n); else attrs(n); }
  }
  let obs = null;
  function start() {
    if (lang === 'de' || obs) return;
    load();
    document.documentElement.lang = lang;
    walk(document.body);
    if (document.title) { const r = tr(document.title); if (r) document.title = r; }
    obs = new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'characterData') node(m.target);
        else if (m.type === 'attributes') attrs(m.target);
        else for (const n of m.addedNodes) walk(n);
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  window.I18N = {
    get lang() { return lang; },
    get locale() { return LANGS[lang][1]; },
    langs: LANGS,
    /** Translate a string in code (for things that never reach the page, e.g. window titles). */
    t: s => (lang === 'de' ? s : (tr(s) ?? s)),
    /** Switches the language; the page reloads so every text is rebuilt. */
    set(l, reload = true) {
      if (!LANGS[l] || l === lang) return false;
      try { localStorage.setItem('orbit.lang', l); } catch { }
      if (reload) location.reload(); else lang = l;
      return true;
    },
    start,
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
