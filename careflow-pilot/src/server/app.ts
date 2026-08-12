import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { ApiErrorBody } from "../shared/contracts.js";
import type { AppConfig } from "./config.js";
import type { DatabaseHandle } from "./db/client.js";
import { ApiError, errorMessages } from "./errors.js";
import { registerAuthHooks } from "./auth/hooks.js";
import {
  registerAuthRoutes,
  type PasswordHasher,
  type PasswordVerifier,
} from "./auth/routes.js";
import { createSessionService } from "./modules/platform/index.js";
import { createPatientService, registerPatientRoutes, type IntakeWriteStage } from "./modules/patient/index.js";
import { createVisitService, registerVisitRoutes } from "./modules/visit/index.js";
import { createMedicationService, registerMedicationRoutes } from "./modules/medication/index.js";
import { createInventoryService, registerInventoryRoutes } from "./modules/inventory/index.js";
import { createFulfillmentService, registerFulfillmentRoutes } from "./modules/fulfillment/index.js";
import {
  createFinanceService,
  deriveChargeQuote,
  registerFinanceRoutes,
} from "./modules/finance/index.js";
import { createNoteService } from "./modules/note/index.js";
import { createClinicalWorkflow } from "./workflows/clinical.js";
import { registerClinicalRoutes } from "./workflows/clinical-routes.js";
import { createVisitCompletionWorkflow, type VisitCloseWriteStage } from "./workflows/visit-completion.js";
import { registerVisitCompletionRoutes } from "./workflows/visit-completion-routes.js";
import { createJourneyService } from "./workflows/journey.js";
import { registerJourneyRoutes } from "./workflows/journey-routes.js";
import { isApiPath, registerClientAssets } from "./static.js";

export interface BuildAppOptions {
  db: DatabaseHandle;
  config: AppConfig;
  clock: () => Date;
  idFactory: () => string;
  passwordVerifier?: PasswordVerifier;
  passwordHasher?: PasswordHasher;
  sessionTokenFactory?: () => string;
  /** Enable production SPA asset serving. Tests keep this disabled by default. */
  serveStatic?: boolean;
  /** Override the configured client dist root for an injectable test fixture. */
  clientAssetsRoot?: string;
  /** Test-only seam used to prove a close transaction rolls back as one unit. */
  beforeVisitCloseTransition?: () => void;
  /** Test-only failure injection at each close transaction write boundary. */
  visitCloseFailureInjector?: (stage: VisitCloseWriteStage) => void;
  /** Test-only failure injection at each atomic Intake write boundary. */
  intakeFailureInjector?: (stage: IntakeWriteStage) => void;
}

function zodFieldErrors(error: ZodError): Record<string, string> {
  return Object.fromEntries(
    error.issues.map((issue) => [issue.path.join(".") || "request", issue.message]),
  );
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => options.idFactory(),
    logger: {
      level: process.env.NODE_ENV === "test" ? "silent" : "info",
      redact: {
        paths: [
          "req.headers.cookie",
          "request.headers.cookie",
          "password",
          "passwordHash",
          "sessionToken",
          "token",
          "command",
          "req.body.password",
          "req.body.passwordHash",
          "req.body.sessionToken",
          "req.body.token",
          "req.body.command",
          "body.password",
          "body.passwordHash",
          "body.sessionToken",
          "body.token",
          "body.command",
        ],
        censor: "[REDACTED]",
      },
    },
  });

  await app.register(helmet);
  await app.register(cookie);

  const clientAssets = options.serveStatic
    ? await registerClientAssets(app, {
        root: options.clientAssetsRoot ?? options.config.clientDistPath,
      })
    : undefined;

  const sessionService = createSessionService({
    database: options.db,
    idleMinutes: options.config.sessionIdleMinutes,
    absoluteHours: options.config.sessionAbsoluteHours,
    tokenFactory: options.sessionTokenFactory,
  });
  registerAuthHooks({ app, sessions: sessionService, clock: options.clock });
  registerAuthRoutes({
    app,
    database: options.db,
    config: options.config,
    clock: options.clock,
    idFactory: options.idFactory,
    sessionService,
    passwordVerifier: options.passwordVerifier,
    passwordHasher: options.passwordHasher,
  });
  const patientService = createPatientService({ database: options.db, clock: options.clock });
  const visitService = createVisitService({
    database: options.db,
    patients: patientService,
    clock: options.clock,
    intakeFailureInjector: options.intakeFailureInjector,
  });
  const medicationService = createMedicationService({ database: options.db, clock: options.clock });
  const inventoryService = createInventoryService({
    database: options.db,
    medicationService,
    clock: options.clock,
    idFactory: options.idFactory,
  });
  const fulfillmentService = createFulfillmentService({ database: options.db, inventory: inventoryService, clock: options.clock, idFactory: options.idFactory });
  const financeService = createFinanceService({
    database: options.db,
    pricing: { deriveChargeQuote },
    clock: options.clock,
    idFactory: options.idFactory,
  });
  const noteService = createNoteService({ database: options.db, clock: options.clock });
  const clinicalWorkflow = createClinicalWorkflow({
    patients: patientService,
    visits: visitService,
    notes: noteService,
    medications: medicationService,
    inventory: inventoryService,
    fulfillment: fulfillmentService,
    clock: options.clock,
  });
  const visitCompletion = createVisitCompletionWorkflow({
    database: options.db,
    visits: visitService,
    finance: financeService,
    notes: noteService,
    medications: medicationService,
    fulfillment: fulfillmentService,
    clock: options.clock,
    idFactory: options.idFactory,
    beforeVisitCloseTransition: options.beforeVisitCloseTransition,
    failureInjector: options.visitCloseFailureInjector,
  });

  const journeyService = createJourneyService({
    visits: visitService,
    patients: patientService,
    clinical: clinicalWorkflow,
    medications: medicationService,
    fulfillment: fulfillmentService,
    inventory: inventoryService,
    finance: financeService,
    completion: visitCompletion,
    clock: options.clock,
  });

  // Build every service first so read-only Journey composition receives only public module interfaces;
  // then register the independently-authenticated route boundaries.
  registerPatientRoutes({ app, database: options.db, patients: patientService });
  registerVisitRoutes({ app, database: options.db, visits: visitService, journey: journeyService });
  registerMedicationRoutes({ app, medications: medicationService });
  registerInventoryRoutes({ app, database: options.db, inventory: inventoryService });
  registerFulfillmentRoutes({ app, database: options.db, fulfillment: fulfillmentService, clock: options.clock });
  registerFinanceRoutes({ app, database: options.db, finance: financeService });
  registerClinicalRoutes({ app, database: options.db, clinical: clinicalWorkflow });
  registerVisitCompletionRoutes({
    app,
    database: options.db,
    completion: visitCompletion,
    failureInjector: options.visitCloseFailureInjector,
  });
  registerJourneyRoutes({ app, journey: journeyService });

  const requestStartedAt = new WeakMap<object, number>();
  app.addHook("onRequest", async (request) => {
    requestStartedAt.set(request, options.clock().getTime());
  });
  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestStartedAt.get(request) ?? options.clock().getTime();
    const actorId = (request as typeof request & { actor?: { id: string } }).actor?.id;
    app.log.info({
      method: request.method,
      route: request.routeOptions.url,
      status: reply.statusCode,
      requestId: request.id,
      ...(actorId ? { actorId } : {}),
      durationMs: Math.max(0, options.clock().getTime() - startedAt),
    });
  });

  app.get("/api/health", async () => {
    options.db.sqlite.prepare("SELECT 1").get();
    return { status: "ok", database: "ready" };
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (
      clientAssets &&
      !isApiPath(request) &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return clientAssets.sendIndex(reply);
    }
    const body: ApiErrorBody = {
      error: {
        code: "NOT_FOUND",
        messageTh: errorMessages.notFound,
        requestId: request.id,
      },
    };
    return reply.code(404).send(body);
  });

  app.setErrorHandler(async (error, request, reply) => {
    let apiError: ApiError;
    if (error instanceof ApiError) {
      apiError = error;
    } else if (error instanceof ZodError) {
      apiError = new ApiError({
        code: "VALIDATION_FAILED",
        statusCode: 422,
        messageTh: errorMessages.validation,
        fieldErrors: zodFieldErrors(error),
      });
    } else if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "FST_ERR_CTP_INVALID_JSON_BODY"
    ) {
      apiError = new ApiError({
        code: "VALIDATION_FAILED",
        statusCode: 400,
        messageTh: errorMessages.malformedJson,
      });
    } else {
      request.log.error({ requestId: request.id }, "Unhandled request error");
      apiError = new ApiError({
        code: "INTERNAL_ERROR",
        statusCode: 500,
        messageTh: errorMessages.internal,
      });
    }

    if (apiError.retryAfterSeconds !== undefined) {
      reply.header("Retry-After", String(Math.min(300, Math.max(1, apiError.retryAfterSeconds))));
    }
    const body: ApiErrorBody = {
      error: {
        code: apiError.code,
        messageTh: apiError.message,
        requestId: request.id,
        ...(apiError.fieldErrors ? { fieldErrors: apiError.fieldErrors } : {}),
        ...(apiError.currentRevisions ? { currentRevisions: apiError.currentRevisions } : {}),
      },
    };
    return reply.code(apiError.statusCode).send(body);
  });

  return app;
}
