import { useEffect, useState } from 'react';
type Device = { seriale: string; tipo: string };
type Qr = { image?: string; status: string; error?: string };
async function request<T>(url: string, body?: object): Promise<T> {
  const r = await fetch(`/api/foto/${url}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Collegamento non disponibile');
  return data;
}
export function FotoCollegamento({ onFatto }: { onFatto: () => Promise<void> }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [qr, setQr] = useState<Qr>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (qr?.status !== 'attesa') return;
    let active = true;
    const timer = setInterval(() => {
      void request<Qr>('qr').then(async state => {
        if (!active) return;
        setQr(state);
        if (state.status === 'associato') { const list = await request<Device[]>('dispositivi'); if (active) { setDevices(list); setChecked(true); } }
      }).catch(e => { if (active) { setError(e.message); setQr(undefined); } });
    }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [qr?.status]);
  async function act(task: () => Promise<void>) { setBusy(true); setError(''); try { await task(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  return <div style={{ marginBottom: 16 }}>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <button type="button" disabled={busy} onClick={() => void act(async () => { setDevices(await request<Device[]>('dispositivi')); setChecked(true); })}>Collega USB / cerca telefoni</button>
      <button type="button" disabled={busy || qr?.status === 'attesa'} onClick={() => void act(async () => setQr(await request<Qr>('qr', {})))}>Associa con QR</button>
    </div>
    <p>USB: collega il cavo, attiva Debug USB e autorizza questo PC sul telefono. Wi-Fi: PC e telefono devono potersi raggiungere sulla rete.</p>
    {qr && <div>
      {qr.status === 'attesa' && <><img src={qr.image} width={280} height={280} alt="QR per associare il telefono" /><p>Sul telefono: Debug wireless → Accoppia dispositivo con codice QR. Scansiona entro 2 minuti.</p></>}
      {qr.status === 'associato' && <p>Associazione riuscita. Seleziona il telefono qui sotto; se non compare, premi «cerca telefoni».</p>}
      {qr.status === 'scaduto' && <p>QR scaduto. Generane uno nuovo. Se il telefono resta in attesa, verifica la rete Wi-Fi e il rilevamento dei dispositivi sul PC.</p>}
      {qr.status === 'errore' && <p role="alert">{qr.error}</p>}
      <button type="button" onClick={() => void act(async () => { await request('qr/annulla', {}); setQr(undefined); })}>Chiudi QR</button>
    </div>}
    {devices.map(d => <div key={d.seriale}><span>{d.seriale} — {d.tipo === 'unauthorized' ? 'Conferma l’autorizzazione sul telefono' : d.tipo}</span>{d.tipo === 'device' && <button type="button" disabled={busy} onClick={() => void act(async () => { await request('dispositivo', { seriale: d.seriale }); await onFatto(); })}>Usa questo telefono</button>}</div>)}
    {checked && !devices.length && <p>Nessun telefono rilevato. Per USB verifica il cavo dati e l’autorizzazione sul telefono; per Wi-Fi usa il QR.</p>}
    {error && <p className="cand-error" role="alert">{error}</p>}
  </div>;
}
