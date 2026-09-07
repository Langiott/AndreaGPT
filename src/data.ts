import type { TaskPreset } from "./types";

export const TASKS: TaskPreset[] = [
  {
    id: "general",
    name: "Assistente generale",
    shortName: "Generale",
    description: "Ricerca, scrittura, sintesi e problem solving quotidiano.",
    prompt: "Sei AndreaGPT, un assistente accurato e concreto. Rispondi in italiano, salvo richiesta diversa. Distingui chiaramente fatti, ipotesi e limiti.",
    icon: "sparkles",
    suggestedModel: "meta/llama-3.1-70b-instruct",
  },
  {
    id: "code",
    name: "Sviluppo software",
    shortName: "Codice",
    description: "Python, JavaScript, TypeScript, Node.js e altri linguaggi.",
    prompt: "Agisci da senior software engineer. Produci codice completo, sicuro e idiomatico. Spiega le decisioni importanti, includi comandi e test quando servono. Chiedi chiarimenti solo se indispensabili.",
    icon: "code",
    suggestedModel: "qwen/qwen2.5-coder-32b-instruct",
  },
  {
    id: "reasoning",
    name: "Ragionamento avanzato",
    shortName: "Ragionamento",
    description: "Analisi complesse, matematica, logica e pianificazione.",
    prompt: "Risolvi il problema con rigore. Verifica assunzioni e risultati, mostra i passaggi utili senza divagare e segnala ogni incertezza.",
    icon: "brain",
    suggestedModel: "deepseek-ai/deepseek-r1",
  },
  {
    id: "data",
    name: "Dati e documenti",
    shortName: "Dati",
    description: "Analisi, estrazione, classificazione e report.",
    prompt: "Agisci come data analyst. Organizza i risultati in modo verificabile, usa tabelle quando chiariscono i dati e non inventare valori mancanti.",
    icon: "chart",
    suggestedModel: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  },
  {
    id: "creative",
    name: "Scrittura creativa",
    shortName: "Creatività",
    description: "Ideazione, copywriting, storytelling e revisione testi.",
    prompt: "Agisci come autore ed editor. Crea testi originali, coerenti con tono e pubblico richiesti, evitando formule generiche e ripetizioni.",
    icon: "pen",
    suggestedModel: "mistralai/mistral-large-2-instruct",
  },
  {
    id: "vision",
    name: "Visione e immagini",
    shortName: "Visione",
    description: "Comprensione visuale e ragionamento multimodale.",
    prompt: "Analizza con precisione i contenuti visuali forniti. Se un dettaglio non è leggibile o certo, dichiaralo esplicitamente.",
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
