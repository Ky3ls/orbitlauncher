// API test against a running dev server: node server/test.mjs [base]
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const base = process.argv[2] || 'http://127.0.0.1:8787';
const TN = 'T_' + Math.random().toString(36).slice(2, 10);
const ph = (name, pw) => crypto.pbkdf2Sync(pw, 'orbitlauncher:' + name.toLowerCase(), 150000, 32, 'sha256').toString('hex');
const call = async (m, p, b, tok) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json()]; };

let [s, r] = await call('POST', '/v1/register', { name: 'x', ph: ph('x', 'pw') }); assert.equal(s, 400);
[s, r] = await call('POST', '/v1/register', { name: TN, ph: ph(TN, 'geheim123'), device: 'PC-A' }); assert.equal(s, 200); const tA = r.token;
[s] = await call('POST', '/v1/register', { name: TN.toLowerCase(), ph: ph(TN.toLowerCase(), 'x') }); assert.equal(s, 409, 'name case-insensitive unique');
[s] = await call('POST', '/v1/login', { name: TN, ph: ph(TN, 'falsch') }); assert.equal(s, 401);
[s, r] = await call('POST', '/v1/login', { name: TN.toLowerCase(), ph: ph(TN, 'geheim123'), device: 'PC-B' }); assert.equal(s, 200); const tB = r.token;
[s] = await call('GET', '/v1/sync'); assert.equal(s, 401);
[s, r] = await call('PUT', '/v1/sync', { k: 'inst:abc', v: '{"name":"A"}', updated: 1000 }, tA); assert.equal(s, 200);
[s, r] = await call('PUT', '/v1/sync', { k: 'inst:abc', v: '{"name":"old"}', updated: 500 }, tB); assert.equal(s, 409, 'stale write rejected');
[s, r] = await call('GET', '/v1/sync', null, tB); assert.deepEqual(r.items.map(i => i.k), ['inst:abc']);
[s, r] = await call('POST', '/v1/sync/get', { keys: ['inst:abc', 'nope'] }, tB); assert.equal(r.items[0].v, '{"name":"A"}');
[s] = await call('PUT', '/v1/sync', { k: '../x', v: '1' }, tA); assert.equal(s, 400);
[s, r] = await call('GET', '/v1/me', null, tA); assert.equal(r.name, TN); assert.equal(r.devices.length, 2);
[s] = await call('POST', '/v1/password', { old: ph(TN, 'geheim123'), ph: ph(TN, 'neu12345') }, tA); assert.equal(s, 200);
[s] = await call('GET', '/v1/sync', null, tB); assert.equal(s, 401, 'other sessions logged out after password change');
[s] = await call('POST', '/v1/logout', null, tA); assert.equal(s, 200);
[s] = await call('GET', '/v1/sync', null, tA); assert.equal(s, 401);
for (let i = 0; i < 10; i++) await call('POST', '/v1/login', { name: TN, ph: ph(TN, 'nope') });
[s] = await call('POST', '/v1/login', { name: TN, ph: ph(TN, 'neu12345') }); assert.equal(s, 429, 'rate limit');
console.log('API OK');
