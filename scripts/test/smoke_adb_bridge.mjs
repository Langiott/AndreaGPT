import fs from 'node:fs';
const c = JSON.parse(fs.readFileSync('/workspace/runtime/adb-bridge.json'));
const url = 'http://host.docker.internal:17839/adb';
const bad = await fetch(url, { method: 'POST' });
if (bad.status !== 401) throw new Error('Bridge senza autenticazione');
const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ args: ['devices'] }), signal: AbortSignal.timeout(10000) });
console.log('Bridge Windows:', r.status, await r.text());
if (!r.ok) process.exit(1);
