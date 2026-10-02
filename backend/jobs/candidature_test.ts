import assert from "node:assert/strict";
import test from "node:test";
import { chiaveOfferta, coseno, emailDaAnnuncio, followUpDovuto, normalizzaOfferte, tokenValido, workflowInvio, workflowRaccolta, type Offerta } from "./candidature";

test("stessa offerta da fonti diverse entra una volta", () => {
  const offerte = normalizzaOfferte([
    { title: "Backend Developer", company: "Acme", url: "https://a.it/1?utm=x", source: "Adzuna" },
    { title: "Backend  developer", company: "ACME", url: "https://b.it/2", source: "Remotive" },
    { title: "", url: "https://c.it" },
    { title: "Senza link", url: "javascript:alert(1)" },
  ]);
  assert.equal(offerte.length, 1);
  assert.equal(offerte[0].source, "Adzuna");
  assert.equal(chiaveOfferta("Backend Developer", "Acme", "x"), offerte[0].id);
});

test("HTML ripulito ed email estratta, scartando i noreply", () => {
  const [offerta] = normalizzaOfferte([{ title: "Dev", company: "X", url: "https://x.it", description: "<p>Scrivi a noreply@x.it oppure&nbsp;<b>HR@X.it</b></p>" }]);
  assert.equal(offerta.description, "Scrivi a noreply@x.it oppure HR@X.it");
  assert.equal(offerta.email, "hr@x.it");
  assert.equal(emailDaAnnuncio("nessun contatto"), undefined);
});

test("coseno e token", () => {
  assert.equal(coseno([1, 0], [1, 0]), 1);
  assert.equal(coseno([1, 0], [0, 1]), 0);
  assert.equal(coseno([0, 0], [1, 1]), 0);
  assert.ok(tokenValido("abc", "abc"));
  assert.ok(!tokenValido("abc", "abd"));
  assert.ok(!tokenValido("abc", ["abc"]));
});

test("follow-up dopo 7 giorni, una volta sola", () => {
  const now = Date.parse("2026-10-10T00:00:00Z");
  const base = { status: "inviata", sentAt: "2026-10-02T00:00:00Z" } as Offerta;
  assert.ok(followUpDovuto(base, now));
  assert.ok(!followUpDovuto({ ...base, sentAt: "2026-10-05T00:00:00Z" }, now));
  assert.ok(!followUpDovuto({ ...base, followUpAt: "2026-10-09T00:00:00Z" }, now));
  assert.ok(!followUpDovuto({ ...base, status: "risposta" }, now));
});

test("workflow n8n collegati e con il token", () => {
  const raccolta = workflowRaccolta({ andreaUrl: "http://andreagpt:3000", token: "t0k", webhook: "andreagpt-abc", pagine: 3, cron: "30 7 * * *" });
  for (const [from, { main }] of Object.entries(raccolta.connections)) {
    assert.ok(raccolta.nodes.some(node => node.name === from));
    for (const link of main.flat()) assert.ok(raccolta.nodes.some(node => node.name === link.node));
  }
  assert.match(JSON.stringify(raccolta), /X-Candidature-Token.*t0k/);
  assert.match(raccolta.nodes.find(node => node.name === "Scarica offerte")!.parameters.jsCode as string, /remotive/);
  const invio = workflowInvio({ webhook: "andreagpt-abc", from: "io@x.it", credential: { id: "1", name: "smtp" } });
  assert.equal(invio.nodes[0].parameters.path, "andreagpt-abc-invio");
  assert.deepEqual(invio.nodes[2].credentials, { smtp: { id: "1", name: "smtp" } });
});
