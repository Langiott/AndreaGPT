import { createBrain } from "./brain";

const brain = createBrain();
const [action, value] = process.argv.slice(2);
try {
  if (action === "index") console.log(JSON.stringify(await brain.indexBrain(), null, 2));
  else if (action === "status") console.log(JSON.stringify(await brain.getBrainStatus(), null, 2));
  else if (action === "import" && value) console.log(JSON.stringify(await brain.importBrainRepository(value), null, 2));
  else if (action === "search" && value) console.log(JSON.stringify((await brain.searchBrain(value)).map(({ citation, score }) => ({ citation, score })), null, 2));
  else throw new Error('Uso: npm run brain -- index|status|import "https://github.com/owner/repo"|search "domanda"');
} catch (error) {
  console.error(error instanceof Error ? error.message : "Operazione fallita");
  process.exitCode = 1;
}
