// OrbitLauncher cloud API (Cloudflare Worker + D1, files in R2).
// Orbit accounts (name + password) and per-account storage of launcher data (instances, mod lists, settings),
// so the same instances appear on every PC. Passwords never reach the server in clear text: the app sends
// PBKDF2(password, "orbitlauncher:" + name, 150000) and the server hashes that again with a random salt.

const MAX_VALUE = 1_000_000, MAX_KEYS = 600, MAX_BYTES = 40_000_000, SESSION_DAYS = 180;
// files (configs, own mods, packs) live in R2: big per account, one upload at most 95 MB (Worker request limit)
const MAX_FILE_BYTES = 2_000_000_000, MAX_FILE = 95_000_000, MAX_FILES = 2000;
const FILE_RE = /^[A-Za-z0-9_.-]{1,100}$/;

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
const RP_ID = 'orbit.local';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

let migrated = false;
async function ready(env) {
  if (migrated) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, uid INTEGER NOT NULL, kind TEXT NOT NULL, exp INTEGER NOT NULL)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, uid INTEGER NOT NULL, cose TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, name TEXT, created INTEGER NOT NULL)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS passkeys_uid ON passkeys(uid)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS files (uid INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (uid, name))').run();
  for (const sql of ['ALTER TABLE users ADD COLUMN totp TEXT', 'ALTER TABLE users ADD COLUMN totp_on INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE users ADD COLUMN totp_step INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE users ADD COLUMN recovery TEXT']) {
    try { await env.DB.prepare(sql).run(); } catch { /* column already there */ }
  }
  migrated = true;
}

const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function b64ud(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function randB64(n = 32) { const b = new Uint8Array(n); crypto.getRandomValues(b); return b64u(b); }
function base32(bytes) { let bits = 0, v = 0, s = ''; for (const x of bytes) { v = (v << 8) | x; bits += 8; while (bits >= 5) { bits -= 5; s += B32[(v >> bits) & 31]; } } if (bits) s += B32[(v << (5 - bits)) & 31]; return s; }
function base32d(s) {
  let bits = 0, v = 0; const out = [];
  for (const c of s.toUpperCase().replace(/=+$/, '')) { const i = B32.indexOf(c); if (i < 0) continue; v = (v << 5) | i; bits += 5; if (bits >= 8) { bits -= 8; out.push((v >> bits) & 255); } }
  return new Uint8Array(out);
}
async function hotp(secret, counter) {
  const key = await crypto.subtle.importKey('raw', base32d(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const buf = new Uint8Array(8); new DataView(buf.buffer).setUint32(4, counter);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const o = sig[sig.length - 1] & 15;
  const n = ((sig[o] & 127) << 24) | (sig[o + 1] << 16) | (sig[o + 2] << 8) | sig[o + 3];
  return String(n % 1000000).padStart(6, '0');
}
async function totpMatch(secret, code, last) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return 0;
  const t = Math.floor(now() / 30000);
  for (const d of [-1, 0, 1]) { const step = t + d; if (step <= last) continue; if (safeEq(await hotp(secret, step), c)) return step; }
  return 0;
}
function recoveryNorm(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
async function takeRecovery(env, u, code) {
  const n = recoveryNorm(code);
  if (n.length < 8) return false;
  const hashes = JSON.parse(u.recovery || '[]');
  const h = await sha256(n);
  const i = hashes.indexOf(h);
  if (i < 0) return false;
  hashes.splice(i, 1);
  await env.DB.prepare('UPDATE users SET recovery = ? WHERE id = ?').bind(JSON.stringify(hashes), u.id).run();
  return true;
}
async function freshCodes(env, uid) {
  const plain = [], hashes = [];
  for (let i = 0; i < 8; i++) {
    const raw = randB64(6).replace(/[^A-Za-z0-9]/g, 'A').slice(0, 8).toUpperCase();
    const code = raw.slice(0, 4) + '-' + raw.slice(4);
    plain.push(code); hashes.push(await sha256(recoveryNorm(code)));
  }
  await env.DB.prepare('UPDATE users SET recovery = ? WHERE id = ?').bind(JSON.stringify(hashes), uid).run();
  return plain;
}
async function putChallenge(env, id, uid, kind) {
  await env.DB.prepare('DELETE FROM challenges WHERE exp < ?').bind(now()).run();
  await env.DB.prepare('INSERT OR REPLACE INTO challenges (id, uid, kind, exp) VALUES (?, ?, ?, ?)').bind(await sha256(id), uid, kind, now() + 300e3).run();
}
async function takeChallenge(env, id, kind) {
  const hid = await sha256(id);
  const row = await env.DB.prepare('SELECT uid, kind, exp FROM challenges WHERE id = ?').bind(hid).first();
  if (!row || row.kind !== kind || row.exp < now()) return null;
  await env.DB.prepare('DELETE FROM challenges WHERE id = ?').bind(hid).run();
  return row;
}

function cbor(buf, st = { i: 0 }) {
  const b = buf[st.i++], maj = b >> 5, info = b & 31;
  const len = () => {
    if (info < 24) return info;
    if (info === 24) return buf[st.i++];
    if (info === 25) { const n = (buf[st.i] << 8) | buf[st.i + 1]; st.i += 2; return n; }
    if (info === 26) { const n = (buf[st.i] * 2 ** 24) + (buf[st.i + 1] << 16) + (buf[st.i + 2] << 8) + buf[st.i + 3]; st.i += 4; return n; }
    throw new Error('Passkey ungültig');
  };
  if (maj === 0) return len();
  if (maj === 1) return -1 - len();
  if (maj === 2 || maj === 3) { const n = len(), s = buf.slice(st.i, st.i + n); st.i += n; return maj === 2 ? s : new TextDecoder().decode(s); }
  if (maj === 4) { const n = len(), a = []; for (let k = 0; k < n; k++) a.push(cbor(buf, st)); return a; }
  if (maj === 5) { const n = len(), m = new Map(); for (let k = 0; k < n; k++) m.set(cbor(buf, st), cbor(buf, st)); return m; }
  throw new Error('Passkey ungültig');
}
function authInfo(ad) {
  if (ad.length < 37) throw new Error('Passkey ungültig');
  const sign = (ad[33] << 24) | (ad[34] << 16) | (ad[35] << 8) | ad[36];
  let credId = null, cose = null, off = 37;
  if (ad[32] & 0x40) {
    off += 16;
    const cl = (ad[off] << 8) | ad[off + 1]; off += 2;
    credId = b64u(ad.slice(off, off + cl)); off += cl;
    cose = ad.slice(off);
  }
  return { rp: ad.slice(0, 32), flags: ad[32], sign, credId, cose };
}
async function rpOk(rp) {
  const want = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(RP_ID)));
  if (rp.length !== want.length) return false;
  let r = 0; for (let i = 0; i < rp.length; i++) r |= rp[i] ^ want[i];
  return r === 0;
}
function clientData(raw, type) {
  let j; try { j = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new Error('Passkey ungültig'); }
  if (j.type !== type || j.origin !== 'https://' + RP_ID || typeof j.challenge !== 'string') throw new Error('Passkey ungültig');
  return j;
}
function derToRaw(sig) {
  if (sig.length === 64) return sig;
  let i = 0;
  if (sig[i++] !== 0x30) throw new Error('Passkey ungültig');
  i += sig[i] & 0x80 ? 1 + (sig[i] & 0x7f) : 1;
  const part = () => {
    if (sig[i++] !== 0x02) throw new Error('Passkey ungültig');
    const n = sig[i++]; let v = sig.slice(i, i + n); i += n;
    if (v.length && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error('Passkey ungültig');
    const o = new Uint8Array(32); o.set(v, 32 - v.length); return o;
  };
  const out = new Uint8Array(64); out.set(part()); out.set(part(), 32); return out;
}
async function importCose(raw) {
  const m = cbor(raw);
  const kty = m.get(1), alg = m.get(3);
  if (kty === 2) {
    const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u(m.get(-2)), y: b64u(m.get(-3)) }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return { key, alg: -7, verify: { name: 'ECDSA', hash: 'SHA-256' } };
  }
  if (kty === 3 && alg === -257) {
    const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: b64u(m.get(-1)), e: b64u(m.get(-2)), alg: 'RS256' }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return { key, alg: -257, verify: { name: 'RSASSA-PKCS1-v1_5' } };
  }
  throw new Error('Dieser Passkey wird nicht unterstützt.');
}
async function checkSig(coseRaw, algHint, authData, clientRaw, sig) {
  const imp = await importCose(coseRaw);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientRaw));
  const data = new Uint8Array(authData.length + hash.length);
  data.set(authData); data.set(hash, authData.length);
  const signature = imp.alg === -7 ? derToRaw(sig) : sig;
  if (!await crypto.subtle.verify(imp.verify, imp.key, signature, data)) throw new Error('Passkey ungültig');
  return imp.alg || algHint;
}

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
      await ready(env);
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
        const u = await env.DB.prepare('SELECT id, name, pw, salt, totp_on FROM users WHERE name = ?').bind(b.name).first();
        if (!u || !safeEq(await pbkdf2(b.ph, u.salt), u.pw)) return err('Name oder Passwort falsch.', 401);
        if (u.totp_on) { const ticket = randB64(); await putChallenge(env, ticket, u.id, 'totp'); return json({ need: 'totp', ticket, name: u.name }); }
        return json({ token: await newSession(env, u.id, b.device), name: u.name });
      }

      if (p === '/v1/login/totp' && m === 'POST') {
        const b = await body(req);
        const ch = await takeChallenge(env, b.ticket || '', 'totp');
        if (!ch) return err('Der Code ist abgelaufen. Melde dich neu an.', 401);
        if (await limited(env, 'totp:' + ch.uid, 8, 900e3)) return err('Zu viele Versuche. Warte 15 Minuten.', 429);
        const u = await env.DB.prepare('SELECT id, name, totp, totp_on, totp_step, recovery FROM users WHERE id = ?').bind(ch.uid).first();
        if (!u?.totp_on) return err('Zwei-Faktor ist nicht aktiv.', 401);
        const step = await totpMatch(u.totp, b.code, u.totp_step || 0);
        if (step) await env.DB.prepare('UPDATE users SET totp_step = ? WHERE id = ?').bind(step, u.id).run();
        else if (!await takeRecovery(env, u, b.code)) return err('Code falsch.', 401);
        return json({ token: await newSession(env, u.id, b.device), name: u.name });
      }

      if (p === '/v1/passkey/begin' && m === 'POST') {
        const b = await body(req);
        const challenge = randB64();
        let uid = 0, allow = [];
        if (b.name) {
          if (!NAME_RE.test(b.name)) return err('Name oder Passwort falsch.', 401);
          const u = await env.DB.prepare('SELECT id FROM users WHERE name = ?').bind(b.name).first();
          if (u) { uid = u.id; const keys = await env.DB.prepare('SELECT id FROM passkeys WHERE uid = ?').bind(uid).all(); allow = keys.results.map(k => ({ type: 'public-key', id: k.id })); }
        }
        await putChallenge(env, challenge, uid, 'pk-login');
        return json({ challenge, rpId: RP_ID, timeout: 60000, userVerification: 'preferred', allowCredentials: allow });
      }
      if (p === '/v1/passkey/finish' && m === 'POST') {
        const b = await body(req);
        let client, auth;
        try { client = clientData(b64ud(b.clientDataJSON), 'webauthn.get'); auth = b64ud(b.authenticatorData); }
        catch (e) { return err(e.message || 'Passkey ungültig', 401); }
        const ch = await takeChallenge(env, client.challenge, 'pk-login');
        if (!ch) return err('Passkey abgelaufen. Versuch es nochmal.', 401);
        const info = authInfo(auth);
        if (!(info.flags & 1) || !await rpOk(info.rp)) return err('Passkey ungültig', 401);
        const key = await env.DB.prepare('SELECT uid, cose, alg, sign_count FROM passkeys WHERE id = ?').bind(b.id).first();
        if (!key || (ch.uid && key.uid !== ch.uid)) return err('Dieser Passkey gehört zu keinem Orbit-Konto.', 401);
        if (info.sign && info.sign <= key.sign_count) return err('Dieser Passkey wurde schon benutzt.', 401);
        try { await checkSig(b64ud(key.cose), key.alg, auth, b64ud(b.clientDataJSON), b64ud(b.signature)); }
        catch (e) { return err(e.message || 'Passkey ungültig', 401); }
        await env.DB.prepare('UPDATE passkeys SET sign_count = ? WHERE id = ?').bind(Math.max(key.sign_count, info.sign), b.id).run();
        const u = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(key.uid).first();
        return json({ token: await newSession(env, key.uid, b.device), name: u.name });
      }

      const me = await auth(req, env);
      if (!me) return err('Nicht angemeldet', 401);

      if (p === '/v1/me' && m === 'GET') {
        const st = await env.DB.prepare('SELECT COUNT(*) c, COALESCE(SUM(size),0) s FROM items WHERE uid = ?').bind(me.uid).first();
        const dev = await env.DB.prepare('SELECT device, last FROM sessions WHERE uid = ? ORDER BY last DESC LIMIT 10').bind(me.uid).all();
        const u = await env.DB.prepare('SELECT totp_on FROM users WHERE id = ?').bind(me.uid).first();
        const keys = await env.DB.prepare('SELECT id, name, created FROM passkeys WHERE uid = ? ORDER BY created DESC').bind(me.uid).all();
        const fs = await env.DB.prepare('SELECT COUNT(*) c, COALESCE(SUM(size),0) s FROM files WHERE uid = ?').bind(me.uid).first();
        return json({ name: me.name, created: me.created, items: st.c, bytes: st.s, maxBytes: MAX_BYTES, files: fs.c, fileBytes: fs.s, maxFileBytes: env.FILES ? MAX_FILE_BYTES : 0, devices: dev.results, totp: !!u?.totp_on, passkeys: keys.results });
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
        if (env.FILES) {
          const fl = await env.DB.prepare('SELECT name FROM files WHERE uid = ?').bind(me.uid).all();
          for (const f of fl.results) await env.FILES.delete(`${me.uid}/${f.name}`);
        }
        await env.DB.prepare('DELETE FROM files WHERE uid = ?').bind(me.uid).run();
        await env.DB.prepare('DELETE FROM sessions WHERE uid = ?').bind(me.uid).run();
        await env.DB.prepare('DELETE FROM passkeys WHERE uid = ?').bind(me.uid).run();
        await env.DB.prepare('DELETE FROM challenges WHERE uid = ?').bind(me.uid).run();
        await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(me.uid).run();
        return json({ ok: true });
      }

      if (p === '/v1/totp/start' && m === 'POST') {
        const u = await env.DB.prepare('SELECT totp_on FROM users WHERE id = ?').bind(me.uid).first();
        if (u?.totp_on) return err('Zwei-Faktor ist schon aktiv.');
        const raw = new Uint8Array(20); crypto.getRandomValues(raw);
        const secret = base32(raw);
        await env.DB.prepare('UPDATE users SET totp = ?, totp_on = 0 WHERE id = ?').bind(secret, me.uid).run();
        const label = encodeURIComponent('Orbit:' + me.name);
        return json({ secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=Orbit&algorithm=SHA1&digits=6&period=30` });
      }
      if (p === '/v1/totp/confirm' && m === 'POST') {
        const b = await body(req);
        const u = await env.DB.prepare('SELECT totp, totp_on, totp_step FROM users WHERE id = ?').bind(me.uid).first();
        if (!u?.totp || u.totp_on) return err('Zwei-Faktor ist nicht vorbereitet.');
        const step = await totpMatch(u.totp, b.code, u.totp_step || 0);
        if (!step) return err('Code falsch.', 401);
        await env.DB.prepare('UPDATE users SET totp_on = 1, totp_step = ? WHERE id = ?').bind(step, me.uid).run();
        return json({ recovery: await freshCodes(env, me.uid) });
      }
      if (p === '/v1/totp' && m === 'DELETE') {
        const b = await body(req);
        const u = await env.DB.prepare('SELECT pw, salt, totp, totp_on, totp_step FROM users WHERE id = ?').bind(me.uid).first();
        if (!PH_RE.test(b.ph || '') || !safeEq(await pbkdf2(b.ph, u.salt), u.pw)) return err('Passwort falsch.', 401);
        if (!u.totp_on || !await totpMatch(u.totp, b.code, u.totp_step || 0)) return err('Code falsch.', 401);
        await env.DB.prepare('UPDATE users SET totp = NULL, totp_on = 0, totp_step = 0, recovery = NULL WHERE id = ?').bind(me.uid).run();
        return json({ ok: true });
      }

      if (p === '/v1/passkey/add/begin' && m === 'POST') {
        const challenge = randB64();
        await putChallenge(env, challenge, me.uid, 'pk-reg');
        const have = await env.DB.prepare('SELECT id FROM passkeys WHERE uid = ?').bind(me.uid).all();
        return json({
          challenge, rpId: RP_ID, timeout: 60000,
          user: { id: b64u(enc.encode(String(me.uid))), name: me.name, displayName: me.name },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          excludeCredentials: have.results.map(k => ({ type: 'public-key', id: k.id })),
        });
      }
      if (p === '/v1/passkey/add/finish' && m === 'POST') {
        const b = await body(req);
        let client, ad;
        try {
          client = clientData(b64ud(b.clientDataJSON), 'webauthn.create');
          const obj = cbor(b64ud(b.attestationObject));
          ad = obj.get('authData');
          if (!(ad instanceof Uint8Array)) throw new Error('Passkey ungültig');
        } catch (e) { return err(e.message || 'Passkey ungültig', 400); }
        const ch = await takeChallenge(env, client.challenge, 'pk-reg');
        if (!ch || ch.uid !== me.uid) return err('Passkey abgelaufen. Versuch es nochmal.', 401);
        const info = authInfo(ad);
        if (!(info.flags & 1) || !info.credId || !info.cose || !await rpOk(info.rp)) return err('Passkey ungültig', 400);
        let alg; try { alg = (await importCose(info.cose)).alg; } catch (e) { return err(e.message, 400); }
        const name = String(b.name || 'Passkey').slice(0, 40);
        await env.DB.prepare('INSERT INTO passkeys (id, uid, cose, alg, sign_count, name, created) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(info.credId, me.uid, b64u(info.cose), alg, info.sign, name, now()).run();
        return json({ ok: true, id: info.credId, name });
      }
      if (p === '/v1/passkey' && m === 'DELETE') {
        const id = url.searchParams.get('id') || '';
        await env.DB.prepare('DELETE FROM passkeys WHERE uid = ? AND id = ?').bind(me.uid, id).run();
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
      // ---- files (R2)
      if (p === '/v1/files' && m === 'GET') {
        const r = await env.DB.prepare('SELECT name, size, updated FROM files WHERE uid = ? ORDER BY name').bind(me.uid).all();
        return json({ files: r.results, max: env.FILES ? MAX_FILE_BYTES : 0, maxFile: MAX_FILE });
      }
      if (p.startsWith('/v1/files/')) {
        if (!env.FILES) return err('Dateispeicher nicht eingerichtet', 501);
        const name = decodeURIComponent(p.slice(10));
        if (!FILE_RE.test(name)) return err('Ungültiger Dateiname');
        const key = `${me.uid}/${name}`;
        if (m === 'GET') {
          const o = await env.FILES.get(key);
          if (!o) return err('Nicht gefunden', 404);
          return new Response(o.body, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(o.size), 'cache-control': 'no-store' } });
        }
        if (m === 'PUT') {
          const len = +(req.headers.get('content-length') || 0);
          if (!len) return err('Länge fehlt', 411);
          if (len > MAX_FILE) return err('Zu groß', 413);
          const cur = await env.DB.prepare('SELECT size FROM files WHERE uid = ? AND name = ?').bind(me.uid, name).first();
          const st = await env.DB.prepare('SELECT COUNT(*) c, COALESCE(SUM(size),0) s FROM files WHERE uid = ?').bind(me.uid).first();
          if (!cur && st.c >= MAX_FILES) return err('Zu viele Dateien', 413);
          if (st.s - (cur?.size || 0) + len > MAX_FILE_BYTES) return err('Cloud-Speicher voll', 413);
          const o = await env.FILES.put(key, req.body);
          await env.DB.prepare('INSERT OR REPLACE INTO files (uid, name, size, updated) VALUES (?, ?, ?, ?)').bind(me.uid, name, o.size, now()).run();
          return json({ ok: true, size: o.size });
        }
        if (m === 'DELETE') {
          await env.FILES.delete(key);
          await env.DB.prepare('DELETE FROM files WHERE uid = ? AND name = ?').bind(me.uid, name).run();
          return json({ ok: true });
        }
      }
      return err('Nicht gefunden', 404);
    } catch (e) {
      return err('Serverfehler', 500);
    }
  },
};
