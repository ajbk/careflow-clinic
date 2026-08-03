import { z } from "zod";

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  cookieSecure: boolean;
  sessionIdleMinutes: 15;
  sessionAbsoluteHours: 8;
  clientDistPath: string;
}

export class ConfigurationError extends Error {
  constructor() {
    super("Invalid CareFlow configuration");
    this.name = "ConfigurationError";
  }
}

const nonEmptyPath = z.string().trim().min(1);
const runtimeEnvironmentSchema = z.object({
  CAREFLOW_HOST: z.enum(["127.0.0.1", "::1"]).default("127.0.0.1"),
  CAREFLOW_PORT: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(65_535))
    .default(3001),
  CAREFLOW_DB_PATH: nonEmptyPath.default("./data/careflow.sqlite"),
  CAREFLOW_COOKIE_SECURE: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(false),
  CAREFLOW_CLIENT_DIST: nonEmptyPath.default("./dist/client"),
});

export function loadConfig(environment: NodeJS.ProcessEnv | Record<string, string | undefined>): AppConfig {
  const result = runtimeEnvironmentSchema.safeParse(environment);
  if (!result.success) throw new ConfigurationError();

  return {
    host: result.data.CAREFLOW_HOST,
    port: result.data.CAREFLOW_PORT,
    databasePath: result.data.CAREFLOW_DB_PATH,
    cookieSecure: result.data.CAREFLOW_COOKIE_SECURE,
    sessionIdleMinutes: 15,
    sessionAbsoluteHours: 8,
    clientDistPath: result.data.CAREFLOW_CLIENT_DIST,
  };
}
