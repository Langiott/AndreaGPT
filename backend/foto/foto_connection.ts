export interface Collegamento { ip: string; porta: number }
type Adb = (args: string[], timeout?: number) => Promise<string>;

export function serviziFoto(output: string, ip: string) {
  return output.split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^(\S+)\s+_adb-tls-connect\._tcp\.?\s+(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
    if (!match || match[2] !== ip || Number(match[3]) < 1 || Number(match[3]) > 65535) return [];
    return [{ nome: match[1], ip: match[2], porta: Number(match[3]) }];
  });
}

/** Recupera solo il telefono configurato, anche se Android cambia la porta TLS. */
export async function recuperaFoto(conf: Collegamento, adb: Adb, ritenta: boolean) {
  const endpoint = `${conf.ip}:${conf.porta}`;
  const dispositivi = async () => (await adb(["devices"]).catch(() => ""))
    .split(/\r?\n/).map(line => line.trim().split(/\s+/))
    .filter(parts => parts[1] === "device").map(parts => parts[0]);
  let lista = await dispositivi();
  if (lista.includes(endpoint)) return { seriale: endpoint, conf };
  // ADB può collegare automaticamente usando il nome del servizio invece di IP:porta.
  const servizi = serviziFoto(await adb(["mdns", "services"], 5_000).catch(() => ""), conf.ip);
  for (const servizio of servizi) {
    const nome = lista.find(seriale => seriale === servizio.nome || seriale === `${servizio.nome}._adb-tls-connect._tcp` || seriale === `${servizio.nome}._adb-tls-connect._tcp.`);
    if (nome) return { seriale: nome, conf: { ip: servizio.ip, porta: servizio.porta } };
  }
  if (!ritenta) return undefined;
  const candidati = [...new Set([...servizi.map(item => `${item.ip}:${item.porta}`), endpoint])];
  for (const candidato of candidati) {
    await adb(["connect", candidato], 8_000).catch(() => "");
    lista = await dispositivi();
    if (lista.includes(candidato)) return { seriale: candidato, conf: { ip: conf.ip, porta: Number(candidato.split(":")[1]) } };
  }
  return undefined;
}
