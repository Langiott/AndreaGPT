import fs from 'node:fs/promises';
import path from 'node:path';

export async function bridgeConfig() {
  const file = process.env.ADB_BRIDGE_CONFIG;
  if (!file) return undefined;
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as { token: string; port: number }; }
  catch { throw new Error('Collegamento Windows non avviato. Esegui Avvia-AndreaGPT.bat sul PC.'); }
}

export async function bridgeAdb(args: string[], timeout = 20000): Promise<Buffer | undefined> {
  const config = await bridgeConfig();
  if (!config) return undefined;
  const pull = args[0] === '-s' && args[2] === 'pull';
  const actual = pull ? ['-s', args[1], 'exec-out', `cat '${args[3].replace(/'/g, "'\\''")}'`] : args;
  let response: Response;
  try {
    response = await fetch(`http://${process.env.ADB_BRIDGE_HOST || 'host.docker.internal'}:${config.port}/adb`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: actual, timeout }), signal: AbortSignal.timeout(timeout + 3000),
    });
  } catch { throw new Error('Bridge Windows non raggiungibile. Riavvia AndreaGPT dal collegamento sul PC.'); }
  if (!response.ok) throw new Error((await response.text()).slice(0, 1500));
  const data = Buffer.from(await response.arrayBuffer());
  if (pull) { await fs.mkdir(path.dirname(args[4]), { recursive: true }); await fs.writeFile(args[4], data); return Buffer.from('OK'); }
  return data;
}
