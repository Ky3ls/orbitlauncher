# OrbitLauncher Cloud API

Cloudflare Worker + D1 for Orbit accounts and cloud sync (instances, mod lists, settings, skins).

- `worker.js` – the API, `schema.sql` – D1 tables, `wrangler.toml` – deployment
- Passwords: the app sends PBKDF2-SHA256(password, "orbitlauncher:" + lowercase name, 150000); the worker stores PBKDF2 of that with a random salt. Session tokens are stored as SHA-256 only.
- Local test: `node server/dev.mjs 8787` and `node server/test.mjs`

Deploy: create D1 database `orbitlauncher`, run `schema.sql`, put the id into `wrangler.toml`, `wrangler deploy`.
