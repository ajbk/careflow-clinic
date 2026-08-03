const safeStartupMessages = new Set([
  "Invalid CareFlow configuration",
  "CareFlow client assets directory is missing",
  "CareFlow client entrypoint is missing",
  "CareFlow database parent must have private permissions",
  "CareFlow database target must not be a symbolic link",
  "CareFlow database target must be a file",
  "CareFlow database parent must be a directory",
  "CareFlow database parent could not be canonicalized",
  "CareFlow database target must not have filesystem aliases",
  "CareFlow synthetic maintenance is running",
  "CareFlow Clinic Host is already running or has a stale lock",
  "Existing database is not a CareFlow Pilot database",
  "Refusing unsafe SQLite artifact",
]);

/** Development serves the SPA through Vite; production serves the built client. */
export function shouldServeStatic(args: readonly string[] = process.argv): boolean {
  return !args.includes("--no-static");
}

/** Keep filesystem, migration, and driver details out of the process stderr contract. */
export function startupErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return safeStartupMessages.has(message) ? message : "unknown startup error";
}
