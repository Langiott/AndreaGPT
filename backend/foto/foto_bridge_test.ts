import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bridgeAdb } from './foto_bridge';

test('bridge: autenticazione, file binari e diagnostica degli errori', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'foto-bridge-test-'));
  const oldConfig = process.env.ADB_BRIDGE_CONFIG;
  const oldHost = process.env.ADB_BRIDGE_HOST;
  const binary = Buffer.from([0, 255, 128, 10, 13, 42]);
  let seen: string[] = [];
  const server = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-secret');
    let body = ''; for await (const chunk of req) body += chunk;
    seen = JSON.parse(body).args;
    if (seen[0] === 'connect') res.writeHead(502).end('Connection refused');
    else res.end(binary);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const file = path.join(dir, 'config.json');
    await fs.writeFile(file, JSON.stringify({ token: 'test-secret', port: address.port }));
    process.env.ADB_BRIDGE_CONFIG = file; process.env.ADB_BRIDGE_HOST = '127.0.0.1';
    const target = path.join(dir, 'photo.jpg');
    await bridgeAdb(['-s', 'phone', 'pull', "/sdcard/Pictures/it's me.jpg", target]);
    assert.deepEqual(await fs.readFile(target), binary);
    assert.deepEqual(seen, ['-s', 'phone', 'exec-out', "cat '/sdcard/Pictures/it'\\''s me.jpg'"]);
    await assert.rejects(bridgeAdb(['connect', '127.0.0.1:1']), /Connection refused/);
  } finally {
    if (oldConfig === undefined) delete process.env.ADB_BRIDGE_CONFIG; else process.env.ADB_BRIDGE_CONFIG = oldConfig;
    if (oldHost === undefined) delete process.env.ADB_BRIDGE_HOST; else process.env.ADB_BRIDGE_HOST = oldHost;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
