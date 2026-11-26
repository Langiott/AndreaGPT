import type { Role } from "../../backend/office/office_schema";
import artwork from "../../img/Squadra Agenti per Dashboard UI.webp";

const agents = [
  { id: "secretary", name: "Segretario", character: "Morty", description: "Interpreta e smista le richieste", crop: [0, 168], face: [82, 142] },
  { id: "director", name: "Amministratore", character: "Ambra", description: "Supervisiona la squadra e segue coda ed esiti", crop: [160, 202], face: [264, 74] },
  { id: "executor", name: "Esecutore", character: "Rick", description: "Esegue ricerche e operazioni", crop: [357, 181], face: [439, 95] },
  { id: "keeper", name: "Magazziniere", character: "Fry", description: "Legge e aggiorna gli archivi", crop: [538, 182], face: [614, 114] },
] satisfies { id: Role; name: string; character: string; description: string; crop: [number, number]; face: [number, number] }[];

export const officeAgents = agents.map(agent => ({
  ...agent,
  portrait: {
    aspectRatio: `${agent.crop[1]} / 330`,
    backgroundImage: `url("${artwork}")`,
    backgroundSize: "auto 145.455%",
    backgroundPosition: `${100 * agent.crop[0] / (720 - agent.crop[1])}% top`,
  },
  avatar: {
    backgroundImage: `url("${artwork}")`,
    backgroundSize: `${720 / 140 * 100}% auto`,
    backgroundPosition: `${100 * (agent.face[0] - 70) / (720 - 140)}% ${100 * (agent.face[1] - 70) / (480 - 140)}%`,
  },
}));
