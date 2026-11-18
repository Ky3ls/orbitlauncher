// Local dev server for the OrbitLauncher cloud API: runs worker.js with a SQLite-backed fake D1.
// node server/dev.mjs [port] [db-file]
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const worker = (await import(path.join(dir, 'worker.js'))).default;
const db = new DatabaseSync(process.argv[3] || ':memory:');
db.exec(fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8'));
const DB = {
  prepare(sql) {
    let args = [];
    const st = {
      bind(...a) { args = a; return st; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    };
    return st;
  },
};
// fake R2: objects in memory
const blobs = new Map();
const FILES = {
  async put(k, body) { const b = Buffer.from(await new Response(body).arrayBuffer()); blobs.set(k, b); return { size: b.length }; },
  async get(k) { const b = blobs.get(k); return b ? { body: b, size: b.length } : null; },
  async delete(k) { blobs.delete(k); },
};
// a first admin code for local tests (on Cloudflare it is created once by hand)
db.exec("CREATE TABLE IF NOT EXISTS access_codes (code TEXT PRIMARY KEY, note TEXT, max_devices INTEGER NOT NULL DEFAULT 2, admin INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)");
db.prepare('INSERT OR IGNORE INTO access_codes (code, note, max_devices, admin, created) VALUES (?, ?, 2, 1, ?)').run(process.env.DEV_ADMIN || 'TEST-TEST-TEST', 'Admin', Date.now());
const port = +(process.argv[2] || 8787);
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, duplex: 'half' }), { DB, FILES: process.env.NO_R2 ? undefined : FILES });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log('orbitlauncher-api dev on :' + port));
