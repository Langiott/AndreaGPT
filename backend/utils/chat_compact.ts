export interface CompactChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Esporta una chat come nota Markdown senza chiamare un modello. */
export function formatCompactChat(messages: CompactChatMessage[], createdAt = new Date()): string {
  const sections = messages.map((message, index) => {
    const label = message.role === "user" ? "Utente" : "Assistente";
    const content = message.content.replace(/\r\n?/g, "\n");
    return `## ${label} ${index + 1}\n\n${content}`;
  });
  const timestamp = createdAt.toLocaleString("it-IT");
  return `# Nota chat\n\n> Esportata il ${timestamp}. Contenuto originale conservato nell'ordine della conversazione.\n\n${sections.join("\n\n")}\n`;
}
