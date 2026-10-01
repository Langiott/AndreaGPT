/** Messaggio mostrato quando il browser non riesce a raggiungere il server. */
export const SERVER_UNREACHABLE = "Impossibile contattare AndreaGPT: il server non risponde. Controlla che sia avviato e riprova.";

/** Traduce gli errori tecnici del browser in un messaggio chiaro per l'utente. */
export function userErrorMessage(caught: unknown, fallback: string): string {
  // Chrome: "Failed to fetch", Firefox: "NetworkError ...", Safari: "Load failed".
  if (caught instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(caught.message)) return SERVER_UNREACHABLE;
  return caught instanceof Error ? caught.message : fallback;
}
