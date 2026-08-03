import type { FastifyInstance } from "fastify";
import type { BuildAppOptions } from "./app.js";
import type { AppConfig } from "./config.js";
import type { DatabaseHandle } from "./db/client.js";
import { checkpointWal } from "./db/client.js";

export interface SignalSource {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface RunClinicHostOptions {
  database: DatabaseHandle;
  config: AppConfig;
  clock: () => Date;
  idFactory: () => string;
  buildApplication: (options: BuildAppOptions) => Promise<FastifyInstance>;
  signalSource?: SignalSource;
}

export async function runClinicHost(options: RunClinicHostOptions): Promise<void> {
  const signalSource = options.signalSource ?? process;
  let app: FastifyInstance | undefined;
  let terminationRequested = false;
  let shutdownPromise: Promise<void> | undefined;

  const detachSignalHandlers = (): void => {
    signalSource.off("SIGINT", onTerminationSignal);
    signalSource.off("SIGTERM", onTerminationSignal);
  };
  const shutdown = (): Promise<void> => {
    shutdownPromise ??= (async () => {
      try {
        await app?.close();
      } finally {
        try {
          checkpointWal(options.database);
        } finally {
          options.database.close();
          detachSignalHandlers();
        }
      }
    })();
    return shutdownPromise;
  };
  const onTerminationSignal = (): void => {
    terminationRequested = true;
    void shutdown();
  };

  signalSource.once("SIGINT", onTerminationSignal);
  signalSource.once("SIGTERM", onTerminationSignal);

  try {
    app = await options.buildApplication({
      db: options.database,
      config: options.config,
      clock: options.clock,
      idFactory: options.idFactory,
    });
    if (terminationRequested) {
      await app.close();
      return;
    }
    await app.listen({ host: options.config.host, port: options.config.port });
  } catch (error) {
    await shutdown();
    if (!terminationRequested) throw error;
  }
}
