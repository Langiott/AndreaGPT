import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { accessDigest } from "./private_access";

const code = randomBytes(24).toString("base64url");
const toolsRoot = path.resolve(process.env.TOOLS_ROOT || path.join(process.cwd(), "data/tools"));
const file = path.join(toolsRoot, "andreagpt-access.sha256");
const rotate = process.argv.includes("--rotate");
const nextFile = rotate ? file + "." + randomBytes(12).toString("hex") : file;
mkdirSync(toolsRoot, { recursive: true });
try {
  writeFileSync(nextFile, accessDigest(code).toString("hex") + "\n", { flag: "wx", mode: 0o600 });
  if (rotate) renameSync(nextFile, file);
  process.stdout.write(`\nCodice AndreaGPT (salvalo ora nel tuo gestore password)\n\n${code}\n\n`);
} catch (error) {
  if (rotate || (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  process.stdout.write("Un codice di accesso esiste gia. Il codice in uso resta valido.\n");
} finally {
  if (rotate) rmSync(nextFile, { force: true });
}
