import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/client.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const database = openDatabase(config.databasePath);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await app?.close();
    } finally {
      database.close();
    }
  };

  try {
    app = await buildApp({
      db: database,
      config,
      clock: () => new Date(),
      idFactory: randomUUID,
    });
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await shutdown();
    throw error;
  }
}

void main().catch(() => {
  process.stderr.write("CareFlow server failed to start\n");
  process.exitCode = 1;
});
