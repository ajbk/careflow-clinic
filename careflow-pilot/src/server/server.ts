import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { runClinicHost } from "./lifecycle.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const database = openDatabase(config.databasePath);
  await runClinicHost({
    database,
    config,
    clock: () => new Date(),
    idFactory: randomUUID,
    buildApplication: (options) => buildApp({ ...options, serveStatic: true }),
  });
}

void main().catch(() => {
  process.stderr.write("CareFlow server failed to start\n");
  process.exitCode = 1;
});
