import type { TaskPreset } from "./types";

const cleanTone = " Usa un tono pulito: niente parolacce, volgarita o frasi in inglese inserite per colore, salvo richiesta esplicita dell'utente.";

export const TASKS: TaskPreset[] = [
  {
    id: "general",
    name: "Assistente generale",
    shortName: "Generale",
    description: "Ricerca, scrittura, sintesi e problem solving quotidiano.",
    prompt: `Sei AndreaGPT, un assistente accurato e concreto. Rispondi in italiano, salvo richiesta diversa. Distingui chiaramente fatti, ipotesi e limiti.${cleanTone}`,
    icon: "sparkles",
    suggestedModel: "meta/llama-3.1-70b-instruct",
  },
  {
    id: "code",
    name: "Sviluppo software",
    shortName: "Codice",
    description: "Python, JavaScript, TypeScript, Node.js e altri linguaggi.",
    prompt: `Agisci da senior software engineer. Produci codice completo, sicuro e idiomatico. Spiega le decisioni importanti, includi comandi e test quando servono. Chiedi chiarimenti solo se indispensabili.${cleanTone}`,
    icon: "code",
    suggestedModel: "qwen/qwen2.5-coder-32b-instruct",
  },
  {
    id: "reasoning",
    name: "Ragionamento avanzato",
    shortName: "Ragionamento",
    description: "Analisi complesse, matematica, logica e pianificazione.",
    prompt: `Risolvi il problema con rigore. Verifica assunzioni e risultati, mostra i passaggi utili senza divagare e segnala ogni incertezza.${cleanTone}`,
    icon: "brain",
    suggestedModel: "deepseek-ai/deepseek-r1",
  },
  {
    id: "data",
    name: "Dati e documenti",
    shortName: "Dati",
    description: "Analisi, estrazione, classificazione e report.",
    prompt: `Agisci come data analyst. Organizza i risultati in modo verificabile, usa tabelle quando chiariscono i dati e non inventare valori mancanti.${cleanTone}`,
    icon: "chart",
    suggestedModel: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  },
  {
    id: "creative",
    name: "Scrittura creativa",
    shortName: "Creatività",
    description: "Ideazione, copywriting, storytelling e revisione testi.",
    prompt: `Agisci come autore ed editor. Crea testi originali, coerenti con tono e pubblico richiesti, evitando formule generiche e ripetizioni.${cleanTone}`,
    icon: "pen",
    suggestedModel: "mistralai/mistral-large-2-instruct",
  },
  {
    id: "vision",
    name: "Visione e immagini",
    shortName: "Visione",
    description: "Comprensione visuale e ragionamento multimodale.",
    prompt: `Analizza con precisione i contenuti visuali forniti. Se un dettaglio non e leggibile o certo, dichiaralo esplicitamente.${cleanTone}`,
    icon: "eye",
    suggestedModel: "meta/llama-3.2-90b-vision-instruct",
  },
];

export const QUICK_PROMPTS = [
  { label: "Crea una API Python", text: "Crea una API REST in Python con FastAPI, validazione, gestione errori e test." },
  { label: "Spiega codice TypeScript", text: "Spiegami questo codice TypeScript e suggerisci come migliorarlo:\n\n" },
  { label: "Progetta un'app Node", text: "Progetta l'architettura di un'applicazione Node.js pronta per la produzione." },
  { label: "Analizza un problema", text: "Analizza questo problema, individua le cause possibili e proponi una soluzione verificabile:\n\n" },
];

export interface MascotQuote { text: string; author: string }

export const QUOTE_INTERVAL_MS = 5 * 60_000;

export const MASCOT_QUOTES: MascotQuote[] = [
  { text: "La fantasia è più importante della conoscenza.", author: "Albert Einstein" },
  { text: "Se ho visto più lontano, è perché stavo sulle spalle di giganti.", author: "Isaac Newton" },
  { text: "Eppur si muove.", author: "Galileo Galilei" },
  { text: "Niente nella vita va temuto, dev'essere solo compreso.", author: "Marie Curie" },
  { text: "Il genio è per l'1% ispirazione e per il 99% traspirazione.", author: "Thomas Edison" },
  { text: "Datemi un punto d'appoggio e solleverò il mondo.", author: "Archimede" },
  { text: "Tutto è numero.", author: "Pitagora" },
  { text: "La semplicità è l'ultima sofisticazione.", author: "Leonardo da Vinci" },
  { text: "Chi poco pensa, molto erra.", author: "Leonardo da Vinci" },
  { text: "Ricordatevi di guardare le stelle e non i vostri piedi.", author: "Stephen Hawking" },
  { text: "Il corpo faccia quello che vuole. Io non sono il corpo: io sono la mente.", author: "Rita Levi-Montalcini" },
  { text: "Un uomo che osa sprecare anche solo un'ora del suo tempo non ha scoperto il valore della vita.", author: "Charles Darwin" },
  { text: "Se pensi di aver capito la meccanica quantistica, non hai capito la meccanica quantistica.", author: "Richard Feynman" },
  { text: "Fatti non foste a viver come bruti, ma per seguir virtute e canoscenza.", author: "Dante Alighieri" },
  { text: "L'amor che move il sole e l'altre stelle.", author: "Dante Alighieri" },
  { text: "Il naufragar m'è dolce in questo mare.", author: "Giacomo Leopardi" },
  { text: "C'è qualcosa di nuovo oggi nel sole, anzi d'antico.", author: "Giovanni Pascoli" },
  { text: "Il più bello dei mari è quello che non abbiamo ancora attraversato.", author: "Nazim Hikmet" },
  { text: "Potranno tagliare tutti i fiori, ma non fermeranno mai la primavera.", author: "Pablo Neruda" },
  { text: "Per viaggiare lontano, non c'è miglior nave di un libro.", author: "Emily Dickinson" },
  { text: "I vostri figli non sono i vostri figli.", author: "Khalil Gibran" },
  { text: "Bisognerebbe tentare di essere felici, non fosse altro per dare l'esempio.", author: "Jacques Prévert" },
  { text: "L'essenziale è invisibile agli occhi.", author: "Antoine de Saint-Exupéry" },
  { text: "Essere o non essere, questo è il problema.", author: "William Shakespeare" },
  { text: "Qualunque cosa tu possa fare o sognare di fare, incominciala.", author: "Johann Wolfgang von Goethe" },
];
