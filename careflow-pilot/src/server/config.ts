import { z } from "zod";
import { isAbsolute } from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  cookieSecure: boolean;
  sessionIdleMinutes: 15;
  sessionAbsoluteHours: 8;
  clientDistPath: string;
  cloud?: { publicOrigin: string; trustedProxies: string[]; environmentId: string; backupMaxAgeSeconds?: number };
}

export class ConfigurationError extends Error {
  constructor() {
    super("Invalid CareFlow configuration");
    this.name = "ConfigurationError";
  }
}

const nonEmptyPath = z.string().trim().min(1);
const runtimeEnvironmentSchema = z.object({
  CAREFLOW_PROFILE: z.enum(["local", "cloud"]).default("local"),
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

  const config: AppConfig = {
    host: result.data.CAREFLOW_HOST,
    port: result.data.CAREFLOW_PORT,
    databasePath: result.data.CAREFLOW_DB_PATH,
    cookieSecure: result.data.CAREFLOW_COOKIE_SECURE,
    sessionIdleMinutes: 15,
    sessionAbsoluteHours: 8,
    clientDistPath: result.data.CAREFLOW_CLIENT_DIST,
  };
  if (result.data.CAREFLOW_PROFILE === "cloud") {
    try {
      const publicOrigin = environment.CAREFLOW_PUBLIC_ORIGIN ?? "";
      const url = new URL(publicOrigin);
      const trustedProxies = (environment.CAREFLOW_TRUSTED_PROXIES ?? "").split(",");
      const environmentId = environment.CAREFLOW_ENVIRONMENT_ID ?? "";
      if (url.protocol !== "https:" || url.origin !== publicOrigin ||
          trustedProxies.some((peer) => peer !== "127.0.0.1" && peer !== "::1") ||
          !/^[a-z][a-z0-9-]{2,63}$/.test(environmentId) ||
          !isAbsolute(config.databasePath) || !config.cookieSecure) throw new ConfigurationError();
      config.cloud = { publicOrigin, trustedProxies: [...new Set(trustedProxies)], environmentId };
      if (environment.CAREFLOW_BACKUP_MAX_AGE_SECONDS !== undefined) {
        config.cloud.backupMaxAgeSeconds = z.coerce.number().int().min(60).max(604800).parse(environment.CAREFLOW_BACKUP_MAX_AGE_SECONDS);
      }
    } catch { throw new ConfigurationError(); }
  }
  return config;
}
