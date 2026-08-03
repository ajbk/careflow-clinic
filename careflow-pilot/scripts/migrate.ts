import { isAbsolute } from "node:path";
import { openDatabase } from "../src/server/db/client.js";

const databasePath = process.argv[2];

if (!databasePath || !isAbsolute(databasePath)) {
  process.stderr.write("Migration requires an explicit absolute database path\n");
  process.exitCode = 1;
} else {
  let database: ReturnType<typeof openDatabase> | undefined;
  try {
    database = openDatabase(databasePath);
    process.stdout.write("CareFlow database migration complete\n");
  } catch {
    process.stderr.write("CareFlow database migration failed\n");
    process.exitCode = 1;
  } finally {
    database?.close();
  }
}
