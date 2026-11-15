// OrbitLauncher cloud API (Cloudflare Worker + D1).
// Orbit accounts (name + password) and per-account storage of launcher data (instances, mod lists, settings),
// so the same instances appear on every PC. Passwords never reach the server in clear text: the app sends
// PBKDF2(password, "orbitlauncher:" + name, 150000) and the server hashes that again with a random salt.

const MAX_VALUE = 1_000_000, MAX_KEYS = 600, MAX_BYTES = 40_000_000, SESSION_DAYS = 180;

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const err = (msg, status = 400) => json({ error: msg }, status);
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();
const now = () => Date.now();

async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function pbkdf2(secret, salt, iter = 1000) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: iter }, key, 256));
}
function randomToken() { const b = new Uint8Array(32); crypto.getRandomValues(b); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function safeEq(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

const NAME_RE = /^[A-Za-z0-9_]{3,20}$/, PH_RE = /^[0-9a-f]{64}$/, KEY_RE = /^[a-z]+(:[A-Za-z0-9_-]{1,64})?$/;

/** Simple limiter: max n hits per window for a key. */
async function limited(env, key, max, windowMs) {
  const t = now(), row = await env.DB.prepare('SELECT n, t FROM attempts WHERE key = ?').bind(key).first();
  if (!row || t - row.t > windowMs) { await env.DB.prepare('INSERT OR REPLACE INTO attempts (key, n, t) VALUES (?, 1, ?)').bind(key, t).run(); return false; }
  if (row.n >= max) return true;
  await env.DB.prepare('UPDATE attempts SET n = n + 1 WHERE key = ?').bind(key).run();
  return false;
}

async function newSession(env, uid, device) {
  const tok = randomToken(), t = now();
  await env.DB.prepare('INSERT INTO sessions (tok, uid, device, created, last) VALUES (?, ?, ?, ?, ?)').bind(await sha256(tok), uid, String(device || '').slice(0, 60), t, t).run();
  return tok;
}

async function auth(req, env) {
  const h = req.headers.get('authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  const tk = await sha256(h.slice(7));
  const s = await env.DB.prepare('SELECT s.uid, s.last, u.name, u.created FROM sessions s JOIN users u ON u.id = s.uid WHERE s.tok = ?').bind(tk).first();
  if (!s) return null;
  if (now() - s.last > SESSION_DAYS * 864e5) { await env.DB.prepare('DELETE FROM sessions WHERE tok = ?').bind(tk).run(); return null; }
  if (now() - s.last > 3600e3) await env.DB.prepare('UPDATE sessions SET last = ? WHERE tok = ?').bind(now(), tk).run();
  return { uid: s.uid, name: s.name, created: s.created, tok: tk };
}

async function body(req) { try { return await req.json(); } catch { return {}; } }

export default {
  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname, m = req.method;
    const ip = req.headers.get('cf-connecting-ip') || 'local';
    try {
      if (p === '/' || p === '/v1') return json({ name: 'orbitlauncher-api', ok: true });

      if (p === '/v1/register' && m === 'POST') {
        const b = await body(req);
        if (!NAME_RE.test(b.name || '')) return err('Name: 3–20 Zeichen, nur Buchstaben, Zahlen und _');
        if (!PH_RE.test(b.ph || '')) return err('Ungültige Anfrage');
        if (await limited(env, 'reg:' + ip, 5, 3600e3)) return err('Zu viele neue Konten. Bitte später nochmal.', 429);
        if (await env.DB.prepare('SELECT id FROM users WHERE name = ?').bind(b.name).first()) return err('Dieser Name ist schon vergeben.', 409);
        const salt = randomToken().slice(0, 22);
        const r = await env.DB.prepare('INSERT INTO users (name, pw, salt, created) VALUES (?, ?, ?, ?)').bind(b.name, await pbkdf2(b.ph, salt), salt, now()).run();
        const u = await env.DB.prepare('SELECT id, name FROM users WHERE name = ?').bind(b.name).first();
        return json({ token: await newSession(env, u.id, b.device), name: u.name });
      }

      if (p === '/v1/login' && m === 'POST') {
        const b = await body(req);
        if (!NAME_RE.test(b.name || '') || !PH_RE.test(b.ph || '')) return err('Name oder Passwort falsch.', 401);
        if (await limited(env, 'login:' + b.name.toLowerCase(), 10, 900e3) || await limited(env, 'loginip:' + ip, 30, 900e3)) return err('Zu viele Versuche. Warte 15 Minuten.', 429);
        const u = await env.DB.prepare('SELECT id, name, pw, salt FROM users WHERE name = ?').bind(b.name).first();
        if (!u || !safeEq(await pbkdf2(b.ph, u.salt), u.pw)) return err('Name oder Passwort falsch.', 401);
        return json({ token: await newSession(env, u.id, b.device), name: u.name });
      }

      const me = await auth(req, env);
      if (!me) return err('Nicht angemeldet', 401);

      if (p === '/v1/me' && m === 'GET') {
        const st = await env.DB.prepare('SELECT COUNT(*) c, COALESCE(SUM(size),0) s FROM items WHERE uid = ?').bind(me.uid).first();
        const dev = await env.DB.prepare('SELECT device, last FROM sessions WHERE uid = ? ORDER BY last DESC LIMIT 10').bind(me.uid).all();
        return json({ name: me.name, created: me.created, items: st.c, bytes: st.s, maxBytes: MAX_BYTES, devices: dev.results });
      }
      if (p === '/v1/logout' && m === 'POST') { await env.DB.prepare('DELETE FROM sessions WHERE tok = ?').bind(me.tok).run(); return json({ ok: true }); }

      if (p === '/v1/password' && m === 'POST') {
        const b = await body(req);
        if (!PH_RE.test(b.old || '') || !PH_RE.test(b.ph || '')) return err('Ungültige Anfrage');
        const u = await env.DB.prepare('SELECT pw, salt FROM users WHERE id = ?').bind(me.uid).first();
        if (!safeEq(await pbkdf2(b.old, u.salt), u.pw)) return err('Altes Passwort falsch.', 401);
        const salt = randomToken().slice(0, 22);
        await env.DB.prepare('UPDATE users SET pw = ?, salt = ? WHERE id = ?').bind(await pbkdf2(b.ph, salt), salt, me.uid).run();
        await env.DB.prepare('DELETE FROM sessions WHERE uid = ? AND tok != ?').bind(me.uid, me.tok).run();
        return json({ ok: true });
      }

      if (p === '/v1/account' && m === 'DELETE') {
        const b = await body(req);
        const u = await env.DB.prepare('SELECT pw, salt FROM users WHERE id = ?').bind(me.uid).first();
        if (!PH_RE.test(b.ph || '') || !safeEq(await pbkdf2(b.ph, u.salt), u.pw)) return err('Passwort falsch.', 401);
        await env.DB.prepare('DELETE FROM items WHERE uid = ?').bind(me.uid).run();
        await env.DB.prepare('DELETE FROM sessions WHERE uid = ?').bind(me.uid).run();
        await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(me.uid).run();
        return json({ ok: true });
      }

      if (p === '/v1/sync' && m === 'GET') {
        const r = await env.DB.prepare('SELECT k, updated, size FROM items WHERE uid = ? ORDER BY k').bind(me.uid).all();
        return json({ items: r.results });
      }
      if (p === '/v1/sync/get' && m === 'POST') {
        const b = await body(req), keys = (Array.isArray(b.keys) ? b.keys : []).filter(k => typeof k === 'string' && KEY_RE.test(k)).slice(0, 50);
        const out = [];
        for (const k of keys) { const r = await env.DB.prepare('SELECT k, v, updated FROM items WHERE uid = ? AND k = ?').bind(me.uid, k).first(); if (r) out.push(r); }
        return json({ items: out });
      }
      if (p === '/v1/sync' && m === 'PUT') {
        const b = await body(req);
        if (typeof b.k !== 'string' || !KEY_RE.test(b.k) || typeof b.v !== 'string') return err('Ungültige Daten');
        if (b.v.length > MAX_VALUE) return err('Zu groß', 413);
        const updated = Number.isFinite(b.updated) ? Math.min(b.updated, now() + 60e3) : now();
        const cur = await env.DB.prepare('SELECT updated, size FROM items WHERE uid = ? AND k = ?').bind(me.uid, b.k).first();
        if (cur && cur.updated > updated) return json({ ok: false, stale: true, updated: cur.updated }, 409);
        const st = await env.DB.prepare('SELECT COUNT(*) c, COALESCE(SUM(size),0) s FROM items WHERE uid = ?').bind(me.uid).first();
        if (!cur && st.c >= MAX_KEYS) return err('Zu viele Einträge', 413);
        if (st.s - (cur?.size || 0) + b.v.length > MAX_BYTES) return err('Cloud-Speicher voll', 413);
        await env.DB.prepare('INSERT OR REPLACE INTO items (uid, k, v, updated, size) VALUES (?, ?, ?, ?, ?)').bind(me.uid, b.k, b.v, updated, b.v.length).run();
        return json({ ok: true, updated });
      }
      if (p === '/v1/sync' && m === 'DELETE') {
        const k = url.searchParams.get('k') || '';
        if (!KEY_RE.test(k)) return err('Ungültiger Schlüssel');
        await env.DB.prepare('DELETE FROM items WHERE uid = ? AND k = ?').bind(me.uid, k).run();
        return json({ ok: true });
      }
      return err('Nicht gefunden', 404);
    } catch (e) {
      return err('Serverfehler', 500);
    }
  },
};
