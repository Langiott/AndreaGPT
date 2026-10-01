/**
 * Controlla e normalizza l'indirizzo di Ollama.
 * Accetta solo un servizio locale senza credenziali o percorsi extra.
 */
/** Valida l'indirizzo locale usato per parlare con Ollama. */
export function localOllamaUrl(input: string): string {
  const url = new URL(input);
  const hosts = ["localhost", "127.0.0.1", "[::1]"];
  if (process.env.OLLAMA_DOCKER_HOST === "1") hosts.push("host.docker.internal");
  if (!hosts.includes(url.hostname) || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Ollama richiede un URL locale senza credenziali o percorsi.");
  }
  return url.origin;
}
