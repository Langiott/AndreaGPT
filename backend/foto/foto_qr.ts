import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
type Adb = (args: string[], timeout?: number) => Promise<string>;
export function createFotoQr(adb: Adb) {
  let session: { id: string; password: string; image: string; expires: number; status: string; error?: string; ip?: string } | undefined;
  let busy = false;
  const timer = setInterval(() => { void poll(); }, 2000);
  timer.unref();
  async function poll() {
    const current = session;
    if (!current || current.status !== 'attesa' || busy) return;
    if (Date.now() > current.expires) { current.status = 'scaduto'; return; }
    busy = true;
    try {
      const services = await adb(['mdns', 'services'], 5000);
      const match = services.split(/\r?\n/).map(l => l.trim().split(/\s+/)).find(p => p[0] === current.id && p[1]?.replace(/\.$/, '') === '_adb-tls-pairing._tcp');
      if (!match || session !== current) return;
      const result = await adb(['pair', match[2], current.password], 30000);
      if (!/Successfully paired/i.test(result)) throw new Error(result);
      current.ip = match[2].split(':')[0];
      const discovered = await adb(['mdns', 'services'], 5000);
      const connection = discovered.split(/\r?\n/).map(l => l.trim().split(/\s+/)).find(p => p[1]?.replace(/\.$/, '') === '_adb-tls-connect._tcp' && p[2]?.startsWith(`${current.ip}:`));
      if (connection) await adb(['connect', connection[2]], 10000);
      current.status = 'associato';
    } catch (error) { current.status = 'errore'; current.error = error instanceof Error ? error.message : String(error); }
    finally { busy = false; }
  }
  return {
    async start() {
      if (busy) throw new Error('Associazione in corso: attendi il risultato.');
      await adb(['mdns', 'check'], 5000);
      const id = `studio-${randomBytes(8).toString('hex')}`;
      const password = randomBytes(16).toString('hex');
      session = { id, password, image: await QRCode.toDataURL(`WIFI:T:ADB;S:${id};P:${password};;`, { width: 280, margin: 4 }), expires: Date.now() + 120000, status: 'attesa' };
      return this.state();
    },
    state() { if (session && session.status === 'attesa' && Date.now() > session.expires) session.status = 'scaduto'; return session ? { image: session.image, expires: session.expires, status: session.status, error: session.error, ip: session.ip } : { status: 'inattivo' }; },
    cancel() { session = undefined; },
    close() { clearInterval(timer); session = undefined; },
  };
}
