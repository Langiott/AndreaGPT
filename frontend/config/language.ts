/** Shared output-language policy for the UI and the local model gateway. */
export const ITALIAN_TECHNICAL_LANGUAGE_RULES = [
  "LINGUA DI OUTPUT: scrivi la prosa e le spiegazioni in italiano.",
  "Mantieni invariati i technical terms e gli elementi tecnici: nomi di modelli, libraries, frameworks, programming languages, API, endpoints, commands, file paths, error messages, acronyms, identifiers e code snippets.",
  "Non tradurre questi elementi e non inventarne di nuovi; traduci soltanto la spiegazione naturale.",
  "Non usare caratteri o frasi in cinese, giapponese o coreano, salvo testo citato, codice o richiesta esplicita dell'utente.",
  "Se un termine tecnico non ha una traduzione certa, mantienilo nella forma originale.",
].join(" ");
