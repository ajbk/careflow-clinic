import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { openDatabase } from "../db/client.js";
import { deploymentRecordSchema } from "../db/deployment-identity.js";
import { currentGeneration } from "../modules/platform/operations.js";

export function writeDeploymentRecord(path: string, record: ReturnType<typeof deploymentRecordSchema.parse>): void {
  const validated = deploymentRecordSchema.parse(record);
  const fd = openSync(`${path}.deployment.json`, "wx", 0o600);
  try { writeFileSync(fd, `${JSON.stringify(validated)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  if (process.platform !== "win32") { const dir = openSync(dirname(path), "r"); try { fsyncSync(dir); } finally { closeSync(dir); } }
}

/** Explicit synthetic initialization only. Cloud startup never takes this path. */
export function initializeCloudDatabase(path: string, environmentId: string): void {
  if (!isAbsolute(path) || !/^[a-z][a-z0-9-]{2,63}$/.test(environmentId) ||
      [path, `${path}-wal`, `${path}-shm`, `${path}.deployment.json`].some(existsSync)) throw new Error("Initialization requires a new absolute database target and environment identity");
  const database = openDatabase(path);
  try {
    const databaseId = randomUUID();
    database.sqlite.transaction(() => {
      database.sqlite.prepare("INSERT INTO platform_metadata (key, value) VALUES ('environment_id', ?), ('database_id', ?)").run(environmentId, databaseId);
    }).immediate();
    writeDeploymentRecord(path, { version: 1, environmentId, databaseId, generation: currentGeneration(database) });
  } finally { database.close(); }
}
