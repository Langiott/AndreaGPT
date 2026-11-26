// Authenticated bridge: ADB stays on Windows (USB and LAN discovery).
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const configFile = path.join(root, 'runtime/adb-bridge.json');
const adb = process.env.ADB_PATH || path.join(root, 'runtime/platform-tools/adb.exe');
const run = promisify(execFile);
const token = randomBytes(32).toString('hex');
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const supplied = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401).end(); return; }
  if (req.method !== 'POST' || req.url !== '/adb' || req.headers.origin) { res.writeHead(404).end(); return; }
  try {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 16384) throw new Error('Richiesta troppo grande'); }
    const { args, timeout } = JSON.parse(body);
    if (!Array.isArray(args) || !args.every(a => typeof a === 'string' && !a.includes('\0'))) throw new Error('Argomenti non validi');
    const command = args[0] === '-s' ? args[2] : args[0];
    if (!['devices', 'mdns', 'pair', 'connect', 'shell', 'exec-out'].includes(command)) throw new Error('Comando non consentito');
    const { stdout } = await run(adb, args, { windowsHide: true, encoding: 'buffer', timeout: Math.min(Math.max(Number(timeout) || 20000, 1000), 180000), maxBuffer: 64 * 1024 * 1024 });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(stdout);
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(error.stderr || error.message));
  }
});
await run(adb, ['start-server'], { windowsHide: true, timeout: 20000 });
server.listen(17839, '0.0.0.0', async () => {
  await fs.mkdir(path.dirname(configFile), { recursive: true });
  await fs.writeFile(configFile, JSON.stringify({ token, port: 17839, pid: process.pid }));
  console.log('Bridge ADB Windows pronto sulla porta 17839.');
});
server.on('error', error => { console.error(error.message); process.exit(1); });
