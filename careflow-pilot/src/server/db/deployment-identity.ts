import { lstatSync, readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { z } from "zod";

export const deploymentRecordSchema = z.strictObject({
  version: z.literal(1), environmentId: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  databaseId: z.string().uuid(), generation: z.string().min(1).max(80),
});
export function readDeploymentRecord(path: string) {
  const stat = lstatSync(`${path}.deployment.json`);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) throw new Error("Unsafe deployment record");
  return deploymentRecordSchema.parse(JSON.parse(readFileSync(`${path}.deployment.json`, "utf8")));
}
export function assertDeploymentIdentity(path: string, sqlite: Database.Database, environmentId: string): void {
  const record = readDeploymentRecord(path);
  const get = (key: string) => sqlite.prepare("SELECT value FROM platform_metadata WHERE key = ?").pluck().get(key);
  if (record.environmentId !== environmentId || get("environment_id") !== environmentId ||
      record.databaseId !== get("database_id") || record.generation !== get("recovery_generation") ||
      sqlite.prepare("SELECT synthetic_only FROM clinic_config WHERE id = 'clinic'").pluck().get() !== 1) {
    throw new Error("Deployment identity or recovery generation mismatch");
  }
}
