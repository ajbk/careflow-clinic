# CareFlow Local Pilot Foundation and Shared Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first usable Local Pilot milestone: a named Assistant and Doctor can sign in from separate isolated browser sessions against one Clinic Host process, share one SQLite-backed synthetic Patient/Visit queue, submit Intake, and advance a Visit from `WAITING` to `CONSULTING` without relying on browser storage. Secure physical LAN deployment is deliberately proved in the later Operations Hardening plan.

**Architecture:** Keep `careflow-webapp/` frozen as the deployed visual demo and create a sibling `careflow-pilot/` modular monolith. The pilot serves a React/Vite SPA and a Fastify API from one Node process; only the API writes the SQLite WAL database. Domain modules expose public services to the Fastify composition layer, while the browser consumes typed HTTP contracts through TanStack Query.

**Tech Stack:** Node.js `>=22.13.0`, TypeScript `5.9.3`, React `19.2.6`, Vite `8.0.13`, React Router `7.18.2`, TanStack Query `5.101.4`, Fastify `5.11.0`, SQLite via `better-sqlite3` `13.0.2`, Drizzle ORM `0.45.2` / Drizzle Kit `0.31.10`, Zod `4.4.3`, Argon2 `0.45.1`, Vitest `4.1.10`.

## Global Constraints

- `docs/superpowers/specs/2026-08-03-careflow-pilot-design.md` is the product authority; do not implement a behavior that contradicts it.
- `stitch_careflow_clinic_management_system/rural_health_commons/DESIGN.md` remains the visual authority; copy the existing CareFlow markup, CSS, tokens, responsive behavior, and Thai copy rather than redesigning them.
- `careflow-webapp/` remains buildable and unchanged in this milestone so the existing deployed demo stays available as a visual reference.
- `careflow-pilot/` accepts synthetic data only. Every page displays the permanent banner `PILOT — ข้อมูลสังเคราะห์เท่านั้น ห้ามกรอกข้อมูลผู้ป่วยจริง`.
- The server generates identity fields: `DEMO-<six digits>`, `ผู้ป่วยทดสอบ <six digits>`, and `000000<four digits>`; clients cannot submit real HN/name/phone values.
- One Clinic Host is the canonical writer. Browser `localStorage`, Cloudflare D1, and Worker state are never sources of truth.
- Every workflow/domain mutation requires `Idempotency-Key`; every domain update requires expected revisions; conflicts return a stable `409` response with no partial write. Authentication/session and offline maintenance commands use their explicitly tested lifecycle semantics instead of the clinical command envelope.
- All committed workflow/domain mutations write an append-only Audit Event with actor, role, action, entity, revision, and UTC timestamp. Session touches are not clinical Audit Events; account acknowledgement/configuration writes retain their own actor/timestamp evidence. Reset is the explicit offline exception that clears synthetic Audit data after the operator confirmation gate.
- Store timestamps in UTC and render all Thai UI dates in `Asia/Bangkok` with Buddhist Era years.
- Server errors never expose SQL, stack traces, password hashes, session tokens, or filesystem paths.
- Use TDD for every task: demonstrate RED, implement the minimum GREEN behavior, run the focused test, run the milestone regression suite, then commit.
- Do not add medication, inventory, finance, appointment, analytics, DDI, AI, FHIR, cloud sync, or real-patient behavior in this plan.

## Pilot Roadmap and This Plan's Boundary

The approved PRD spans independent subsystems, so it is deliberately split into five implementation plans:

1. **Foundation and Shared Intake — this plan:** Vite/Fastify/SQLite, accounts/sessions/RBAC, audit/idempotency/revisions, synthetic Patient registration/search, Intake, Queue, and `WAITING → CONSULTING`.
2. **Clinical Record and Medication Decision:** Patient Snapshot, versioned Allergy with Assistant/Doctor state rules, draft/signed Clinical Note, amendments, signed Medication Order versus signed `NO_MEDICATION`, and invalidation entry points.
3. **Medication and Inventory Safety:** Drug Master, lots, FEFO reservations, preparation, barcode/manual confirmation, Label versions, Doctor release/reject, atomic Dispense/stock-out, and the atomic artifact invalidation/reservation rollback consequences of Allergy or Order revisions.
4. **Finance, Close, and Documents:** Charge snapshots, waiver, Cash/PromptPay confirmation, Doctor close gate, OPD Card, and final label/print gates.
5. **Clinic Operations Hardening:** Caddy/TLS installation, Windows service packaging, encrypted off-device backup/restore, two-device rehearsal, accessibility/print matrix, and 10-Visit acceptance report.

Milestone 1 is DONE only when two independent authenticated sessions can share committed data and complete this path:

```text
Assistant login → search/create synthetic Patient → submit Intake → WAITING
Doctor login → see the same Queue entry → start consultation → CONSULTING
service restart → both sessions reload the same Patient, Intake, and Visit revision;
integration evidence verifies the same Patient/Visit Audit Event IDs
```

Clinical note authoring is intentionally disabled with Thai “coming in the next milestone” copy after the Doctor reaches `CONSULTING`; it must not write placeholder clinical data.

## Target File Structure

```text
careflow-pilot/
  package.json  package-lock.json  .gitignore  .node-version  .env.example
  index.html  vite.config.ts  tsup.config.ts  postcss.config.mjs
  eslint.config.mjs  playwright.config.ts
  vitest.client.config.ts  vitest.server.config.ts
  tsconfig.json  tsconfig.client.json  tsconfig.server.json  drizzle.config.ts
  public/og.png
  src/
    shared/contracts.ts            # Zod wire schemas + inferred DTOs/status/error codes
    client/
      main.tsx
      app/{router,providers}.tsx
      app/query-client.ts
      auth/{AuthProvider,AuthGate,LoginScreen,PilotRulesScreen,ChangePasswordScreen}.tsx
      lib/{api-client,api-error,idempotency,thai-date}.ts
      features/{patients,intake,dashboard,queue,visit}.ts
      components/careflow/{AppShell,PatientHeader,ScreenState,ui}.tsx
      screens/{OverviewScreen,IntakeScreen,QueueScreen,ConsultationScreen,PilotUnavailableScreen}.tsx
      styles/{globals,pilot}.css
    server/
      {app,server,config,errors,host-lock,static}.ts
      db/{client,schema}.ts
      auth/{hooks,routes}.ts
      modules/
        platform/{index,schema,audit,idempotency,revision,permissions,sessions}.ts
        patient/{index,schema,service,routes}.ts
        visit/{index,schema,service,routes}.ts
  scripts/
    migrate.ts
    users.ts
    reset-synthetic-data.ts
  drizzle/                           # Generated, committed SQL migrations
  tests/
    client/setup.ts
    client/{api-client,thai-date}.test.ts
    client/{router,auth,intake,queue}.test.tsx
    server/helpers/{database,app,auth}.ts
    server/{config,health,host-lock,platform,auth,users-cli,patient,visit,restart,reset-synthetic-data}.test.ts
    e2e/{pilot-shared-visit,responsive}.spec.ts
  README.md
.github/workflows/ci.yml
README.md
```

Module rules:

- `server/modules/<module>/index.ts` is the only public import path for another module.
- A module may import `platform/index.ts`; it may not import another module's private files.
- `server/app.ts` is the only place allowed to compose Patient and Visit services in one transaction.
- `shared/contracts.ts` contains wire contracts only and imports no server or browser module; all DTO types are inferred from exported Zod schemas.
- React components never import database or server modules.

Wire-schema rule: every shape shown below is implemented once as a strict exported Zod schema and its TypeScript name is `z.infer<typeof ...Schema>`, not a second handwritten interface. Task 2 adds Api Error, command-envelope, and Health schemas; Task 4 adds Login/Session/acknowledgement/password schemas; Task 5 adds Patient/create/search schemas; Task 6 adds Intake/Queue/Dashboard/Workspace/Start schemas. Fastify routes parse with these schemas and `ApiClient` decodes the same success schemas.

---

### Task 1: Scaffold the Pilot and Preserve the Visual Shell

**Files:**
- Create: `careflow-pilot/package.json`
- Create: `careflow-pilot/package-lock.json`
- Create: `careflow-pilot/.gitignore`
- Create: `careflow-pilot/.node-version`
- Create: `careflow-pilot/index.html`
- Create: `careflow-pilot/tsconfig.json`
- Create: `careflow-pilot/tsconfig.client.json`
- Create: `careflow-pilot/tsconfig.server.json`
- Create: `careflow-pilot/vite.config.ts`
- Create: `careflow-pilot/postcss.config.mjs`
- Create: `careflow-pilot/eslint.config.mjs`
- Create: `careflow-pilot/vitest.client.config.ts`
- Create: `careflow-pilot/vitest.server.config.ts`
- Create: `careflow-pilot/src/client/main.tsx`
- Create: `careflow-pilot/public/og.png`
- Create: `careflow-pilot/src/client/app/router.tsx`
- Create: `careflow-pilot/src/client/app/providers.tsx`
- Create: `careflow-pilot/src/client/components/careflow/AppShell.tsx`
- Create: `careflow-pilot/src/client/components/careflow/ui.tsx`
- Create: `careflow-pilot/src/client/screens/PilotUnavailableScreen.tsx`
- Create: `careflow-pilot/src/client/styles/globals.css`
- Create: `careflow-pilot/src/client/styles/pilot.css`
- Create: `careflow-pilot/tests/client/setup.ts`
- Create: `careflow-pilot/tests/client/router.test.tsx`
- Reference unchanged: `careflow-webapp/app/globals.css`
- Reference unchanged: `careflow-webapp/components/careflow/AppShell.tsx`
- Reference unchanged: `careflow-webapp/components/careflow/ui.tsx`

**Interfaces:**
- Produces: `appRoutes: RouteObject[]`, `createAppRouter(): ReturnType<typeof createBrowserRouter>`, `AppProviders({children}): ReactElement`, and framework-neutral CareFlow UI primitives.
- Consumes: no backend; all operational routes render an explicit unavailable state until their owning task connects them.

- [ ] **Step 1: Write the failing router smoke test**

```tsx
// tests/client/router.test.tsx
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { appRoutes } from "../../src/client/app/router";

describe("pilot router", () => {
  it("renders the Thai pilot shell without the prototype role switch", () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] });
    render(<RouterProvider router={router} />);
    expect(screen.getByText("CareFlow")).toBeInTheDocument();
    expect(screen.getAllByText(/PILOT — ข้อมูลสังเคราะห์เท่านั้น/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /เปลี่ยนเป็นแพทย์|เปลี่ยนเป็นผู้ช่วย/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the focused test and capture RED**

Run: `cd careflow-pilot && npm run test:client -- tests/client/router.test.tsx`

Expected: FAIL because `package.json` and `src/client/app/router.tsx` do not exist.

- [ ] **Step 3: Create the pinned package and TypeScript/Vite configs**

Use these production dependencies exactly:

```json
{
  "@fastify/cookie": "11.1.2",
  "@fastify/helmet": "13.1.0",
  "@fastify/rate-limit": "11.2.0",
  "@fastify/static": "10.1.2",
  "@fontsource/be-vietnam-pro": "5.3.0",
  "@fontsource/noto-sans-thai": "5.3.0",
  "@tanstack/react-query": "5.101.4",
  "argon2": "0.45.1",
  "better-sqlite3": "13.0.2",
  "drizzle-orm": "0.45.2",
  "fast-json-stable-stringify": "2.1.0",
  "fastify": "5.11.0",
  "lucide-react": "1.28.0",
  "react": "19.2.6",
  "react-dom": "19.2.6",
  "react-router-dom": "7.18.2",
  "zod": "4.4.3"
}
```

Use Node `>=22.13.0`. Task 1 has a client-only `dev`/`build`; Task 2 adds the server scripts once a real server entry exists. Pin the development packages listed in the plan header plus `@vitejs/plugin-react@6.0.5`, `@types/node@22.20.1`, `@types/react@19.2.18`, `@types/react-dom@19.2.4`, `@types/better-sqlite3@9.6.0`, `drizzle-kit@0.31.10`, `tsx@4.23.5`, `tsup@8.5.1`, `rimraf@6.1.3`, `concurrently@10.0.4`, `@testing-library/react@16.3.2`, `@testing-library/jest-dom@7.0.0`, `@testing-library/user-event@14.6.1`, `jsdom@30.0.1`, `msw@2.15.0`, `@playwright/test@1.62.1`, `@eslint/js@9.39.4`, `globals@17.9.0`, `eslint@9.39.4`, `typescript-eslint@8.65.0`, `eslint-plugin-react-hooks@7.1.1`, `eslint-plugin-react-refresh@0.5.3`, `tailwindcss@4.2.1`, `@tailwindcss/postcss@4.2.1`, and `postcss@8.5.25`. Tailwind stays at the frozen demo's exact `4.2.1` baseline to avoid an unrequested CSS engine change. Run `npm install` once to create the lockfile. Copy `careflow-webapp/public/og.png` unchanged.

```json
{
  "dev": "npm run dev:client",
  "dev:client": "vite --host 127.0.0.1 --port 5173",
  "clean": "rimraf dist",
  "build": "npm run clean && npm run build:client",
  "build:client": "vite build",
  "test": "npm run test:client",
  "test:client": "vitest run --config vitest.client.config.ts",
  "test:server": "vitest run --config vitest.server.config.ts",
  "typecheck": "tsc -p tsconfig.client.json --noEmit",
  "lint": "eslint ."
}
```

Lock Vite development to `127.0.0.1:5173`, proxy `/api` to `http://127.0.0.1:3001`, and write production assets to `dist/client`. This keeps browser requests same-origin in development without adding CORS. Import local weights `400/500/600/700` for both font families. `.gitignore` covers only generated Pilot paths such as `node_modules/`, `dist/`, `data/`, test artifacts, and environment files; it must not contain broad parent-directory patterns.

- [ ] **Step 4: Copy and adapt the visual shell**

Copy `globals.css` and `ui.tsx` without visual changes. Remove the Google Fonts URL import, keep Tailwind's import, and load the same font weights locally from the two `@fontsource` packages in `main.tsx`. Put only new banner/auth/async-state rules in `pilot.css`. Adapt `AppShell` by replacing `next/link`/`href` with React Router `Link`/`to`, removing `useCareFlow`, `navItemsForRole`, role/reset buttons, and the seeded global search across Patients/Appointments/Inventory. Use a static P0 navigation list until Task 7 filters it from the server session; omit Appointment, Analytics, and History links. Omit the context-bound `ToastRegion` in this scaffold (later toasts remain ephemeral), add a disabled account placeholder, and render the permanent synthetic-data banner. Create placeholder routes for `/`, `/intake`, `/queue`, `/consultations/:visitId`, `/dispensing/:visitId`, `/dispensing/:visitId/labels`, `/checkout/:visitId`, `/visits/:visitId/opd-card`, `/inventory`, and `/inventory/receive`.

```tsx
export function PilotUnavailableScreen({ title }: { title: string }) {
  return (
    <section className="care-card empty-state" aria-labelledby="pilot-unavailable-title">
      <h1 id="pilot-unavailable-title">{title}</h1>
      <p>ส่วนนี้ยังไม่เปิดใช้ใน Pilot milestone ปัจจุบัน</p>
    </section>
  );
}
```

- [ ] **Step 5: Run GREEN and visual-regression guardrails**

Run: `cd careflow-pilot && npm run test:client && npm run typecheck && npm run build`

Expected: router test PASS, TypeScript exits `0`, Vite creates `dist/client`, and `careflow-webapp/` has no diff.

- [ ] **Step 6: Commit the scaffold**

```bash
git add careflow-pilot
git commit -m "feat(pilot): scaffold local pilot shell"
```

---

### Task 2: Establish the API, Configuration, and SQLite Migration Boundary

**Files:**
- Create: `careflow-pilot/src/server/config.ts`
- Create: `careflow-pilot/src/server/errors.ts`
- Create: `careflow-pilot/src/server/db/client.ts`
- Create: `careflow-pilot/src/server/db/schema.ts`
- Create: `careflow-pilot/src/server/app.ts`
- Create: `careflow-pilot/src/server/server.ts`
- Create: `careflow-pilot/src/server/host-lock.ts`
- Create: `careflow-pilot/src/shared/contracts.ts`
- Create: `careflow-pilot/tsup.config.ts`
- Modify: `careflow-pilot/package.json`
- Create: `careflow-pilot/src/server/modules/platform/schema.ts`
- Create: `careflow-pilot/src/server/modules/platform/index.ts`
- Create: `careflow-pilot/drizzle.config.ts`
- Create: `careflow-pilot/scripts/migrate.ts`
- Create: `careflow-pilot/tests/server/helpers/database.ts`
- Create: `careflow-pilot/tests/server/config.test.ts`
- Create: `careflow-pilot/tests/server/health.test.ts`
- Create: `careflow-pilot/tests/server/host-lock.test.ts`
- Create: `careflow-pilot/.env.example`

**Interfaces:**
- Produces: `loadConfig(env): AppConfig`, `openDatabase(path): DatabaseHandle`, `buildApp(options): Promise<FastifyInstance>`.
- `DatabaseHandle` exposes `{ sqlite, db, close }`; callers never create an extra writer.
- `buildApp` consumes injected `db`, `config`, `clock`, and `idFactory` so tests do not use global time or random IDs.

- [ ] **Step 1: Write failing health and database-policy tests**

```ts
it("opens the canonical database with WAL, foreign keys, and busy timeout", () => {
  const handle = createTestDatabase();
  expect(handle.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
  expect(handle.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(handle.sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
  expect(handle.sqlite.pragma("synchronous", { simple: true })).toBe(2);
  handle.cleanup();
});

it("returns a non-secret health response", async () => {
  const harness = await createTestApp();
  const response = await harness.app.inject({ method: "GET", url: "/api/health" });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: "ok", database: "ready" });
  expect(response.body).not.toContain(harness.databasePath);
});
```

Also assert a new file receives `application_id/product_id/migration` identity, an existing foreign SQLite file is rejected byte-for-byte unchanged, one host-lock holder blocks a second writer, graceful release allows the next writer, and a stale lock is never auto-removed.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:server -- tests/server/config.test.ts tests/server/health.test.ts tests/server/host-lock.test.ts`

Expected: FAIL because `openDatabase` and `buildApp` are undefined.

- [ ] **Step 3: Define strict runtime configuration**

```ts
export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  cookieSecure: boolean;
  sessionIdleMinutes: 15;
  sessionAbsoluteHours: 8;
  clientDistPath: string;
}
```

`loadConfig` must validate `CAREFLOW_HOST`, `CAREFLOW_PORT`, `CAREFLOW_DB_PATH`, `CAREFLOW_COOKIE_SECURE`, and `CAREFLOW_CLIENT_DIST`. Defaults are `127.0.0.1`, `3001`, `./data/careflow.sqlite`, `false`, and `./dist/client`. This milestone accepts loopback hosts only (`127.0.0.1` or `::1`) and rejects `0.0.0.0`, LAN addresses, and hostnames; LAN exposure must wait for the Caddy/TLS hardening plan. Invalid hosts/ports, empty paths, or non-boolean secure values terminate startup with one configuration error that contains no secrets. Add config tests proving non-loopback plus `cookieSecure=false` cannot start and a temporary `.env` reaches `loadConfig` through a real Node entrypoint.

Use Node 22's native `--env-file-if-exists=.env` consistently: server dev uses `node --env-file-if-exists=.env --watch --import tsx src/server/server.ts`; production uses `node --env-file-if-exists=.env dist/server/server.js`; migrate/users/reset use the same flag plus `--import tsx`. Do not add a second dotenv loader. Direct environment variables retain Node's normal precedence over `.env`.

- [ ] **Step 4: Create the platform migration schema and DB lifecycle**

Define these tables with Drizzle and database constraints:

```text
clinic_config(
  id TEXT PRIMARY KEY CHECK(id='clinic'),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  timezone TEXT NOT NULL CHECK(timezone='Asia/Bangkok'),
  synthetic_only INTEGER NOT NULL CHECK(synthetic_only=1),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)
platform_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL)
clinic_counters(key TEXT PRIMARY KEY, value INTEGER NOT NULL CHECK(value >= 0))
staff_accounts(
  id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinic_config(id),
  username TEXT COLLATE NOCASE NOT NULL, display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('assistant','doctor')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL CHECK(must_change_password IN (0,1)),
  pilot_acknowledged_at TEXT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  last_password_changed_at TEXT NOT NULL, disabled_at TEXT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(clinic_id,username)
)
sessions(
  token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES staff_accounts(id),
  created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL
)
audit_events(
  id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinic_config(id),
  actor_id TEXT NULL REFERENCES staff_accounts(id),
  actor_role TEXT NOT NULL CHECK(actor_role IN ('assistant','doctor','system')),
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  entity_revision INTEGER NOT NULL CHECK(entity_revision >= 1),
  reason TEXT NULL, occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  CHECK((actor_role='system' AND actor_id IS NULL) OR
        (actor_role IN ('assistant','doctor') AND actor_id IS NOT NULL))
)
idempotency_records(
  clinic_id TEXT NOT NULL REFERENCES clinic_config(id),
  actor_id TEXT NOT NULL REFERENCES staff_accounts(id),
  key TEXT NOT NULL, request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL CHECK(response_status BETWEEN 100 AND 599),
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(actor_id,key)
)
```

Add SQLite triggers that abort `UPDATE` and `DELETE` on `audit_events`. Drizzle Kit does not model triggers or application identity, so append and review their exact SQL in the generated migration rather than assuming schema generation created them. Set `PRAGMA application_id=0x43464C57` (`CFLW`), insert `platform_metadata('product_id','careflow-pilot')`, and insert the one synthetic Clinic row with `id='clinic'`, name `คลินิกชนบท CareFlow Pilot`, timezone `Asia/Bangkok`, and `synthetic_only=1` idempotently. Its two timestamps come from one SQL `strftime('%Y-%m-%dT%H:%M:%fZ','now')` value selected once so they are equal, UTC, and non-null.

The safe-open branches are exact: a nonexistent/zero-byte target may be created, migrated, then identity-validated; an existing non-empty file is opened read-only first and must already have the CareFlow application ID, product ID, and known migration ancestry before any writable PRAGMA or migration occurs. A foreign/unknown file remains byte-for-byte unchanged. After validation, `openDatabase` creates only the explicit parent directory, applies `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=FULL`, `busy_timeout=5000`, runs committed forward migrations, and exposes one close method. Server integration tests use a unique temporary on-disk SQLite file, never `:memory:`.

- [ ] **Step 5: Implement the injected Fastify app and stable errors**

`buildApp` registers request IDs, Helmet, cookie parsing, JSON error mapping, and `/api/health`. At this point change `dev` to `concurrently -k -s first npm:dev:server npm:dev:client`; add `dev:server="node --env-file-if-exists=.env --watch --import tsx src/server/server.ts"`, `build:server="tsup"`, `start="node --env-file-if-exists=.env dist/server/server.js"`, `db:generate="drizzle-kit generate"`, and `db:migrate="node --env-file-if-exists=.env --import tsx scripts/migrate.ts"`; change `build`, `test`, and `typecheck` to run both client and server parts. Configure `tsup` with the server entry, ESM output, source maps, and dependencies/native modules external.

Before any writable open, set process umask `0077` on POSIX, resolve and validate the exact target (reject directory/symlink), create a missing dedicated data parent with mode `0700`, and fail closed if an existing POSIX parent grants group/other permissions. Resolve that parent with `realpath`, then derive both the canonical database path and adjacent `<database>.careflow-running` directory from it. Reject target/parent aliasing that cannot be canonicalized; two symlink spellings must never create two locks for one SQLite file. Create/verify database, WAL, SHM, and lock artifacts as `0600`/`0700` as applicable. `server.ts` and every offline writer CLI release the lock only after SQLite closes, including every controlled startup/migration failure path. A concurrent or stale lock fails closed and is never auto-deleted. Standalone migrate requires an absolute explicit database path and applies the same absent/zero-byte versus existing-identified branching before changing anything. `host-lock.test.ts` covers missing-parent bootstrap, POSIX modes, overly broad parent refusal, canonical alias/symlink refusal, one holder, second-writer refusal, controlled-failure release, graceful release, and stale-lock refusal. Windows tests skip POSIX mode bits; README requires a dedicated CareFlow OS account/data directory whose ACL permits only that account and Administrators, with installer enforcement deferred to Hardening. Use this error body everywhere and export its strict Zod schema/type from `shared/contracts.ts`:

```ts
export interface ApiErrorBody {
  error: {
    code: "VALIDATION_FAILED" | "AUTH_REQUIRED" | "PASSWORD_CHANGE_REQUIRED" |
      "PILOT_ACKNOWLEDGEMENT_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" |
      "INVALID_STATE" | "REVISION_CONFLICT" |
      "IDEMPOTENCY_CONFLICT" | "ACTIVE_VISIT_EXISTS" |
      "SYNTHETIC_ID_EXHAUSTED" | "RATE_LIMITED" |
      "INTERNAL_ERROR";
    messageTh: string;
    requestId: string;
    fieldErrors?: Record<string, string>;
    currentRevisions?: Record<string, number>;
  };
}
```

Unknown errors are logged server-side with the request ID and returned as `INTERNAL_ERROR` without `error.message`.

Map malformed JSON to `400 VALIDATION_FAILED`, Zod field/semantic validation to `422 VALIDATION_FAILED`, missing resources/routes to `404`, workflow/revision/idempotency or synthetic-ID exhaustion to stable `409` codes, login throttling to `429 RATE_LIMITED` with a bounded `Retry-After`, and unexpected failures to `500`. Configure logger redaction for `cookie`, passwords, session tokens, and command bodies; log only method, route pattern, status, request ID, actor ID after authentication, and duration.

- [ ] **Step 6: Generate migration and run GREEN**

Run:

```bash
cd careflow-pilot
npm run db:generate -- --name=platform
npm run test:server -- tests/server/config.test.ts tests/server/health.test.ts tests/server/host-lock.test.ts
npm run typecheck
```

Expected: a committed `drizzle/0000_*.sql`, both focused tests PASS, and typecheck exits `0`.

- [ ] **Step 7: Commit the boundary**

```bash
git add careflow-pilot
git commit -m "feat(platform): add Fastify SQLite foundation"
```

---

### Task 3: Implement Transaction, Revision, Idempotency, and Audit Primitives

**Files:**
- Create: `careflow-pilot/src/server/modules/platform/audit.ts`
- Create: `careflow-pilot/src/server/modules/platform/idempotency.ts`
- Create: `careflow-pilot/src/server/modules/platform/revision.ts`
- Create: `careflow-pilot/src/server/modules/platform/permissions.ts`
- Modify: `careflow-pilot/src/server/modules/platform/index.ts`
- Modify: `careflow-pilot/src/shared/contracts.ts`
- Create: `careflow-pilot/tests/server/platform.test.ts`

**Interfaces:**
- Produces: `Actor`, `Permission`, `requirePermission`, `assertExpectedRevision`, `appendAuditEvent`, and `executeIdempotent`.
- `executeIdempotent<T>` owns the transaction and passes the same transaction handle to the domain work and Audit writer.

```ts
export interface Actor { id: string; role: "assistant" | "doctor"; displayName: string }
export type AuditActor = Actor | { id: null; role: "system"; displayName: "maintenance-cli" };
export interface IdempotentEnvelope<T> { data: T; replayed: boolean }
export interface CommandWorkResult<T> { statusCode: number; data: T }
export interface CommandHttpResult<T> { statusCode: number; body: IdempotentEnvelope<T> }
declare const auditedTransactionBrand: unique symbol;
export type AuditedTransaction = AppTransaction & { readonly [auditedTransactionBrand]: true };
export interface CommandBody<TPayload, TRevisions extends Record<string, number>> {
  expectedRevisions: TRevisions;
  payload: TPayload;
}
export function executeIdempotent<T>(input: {
  db: AppDatabase;
  actor: Actor;
  key: string;
  operation: string;
  requestBody: CommandBody<unknown, Record<string, number>>;
  work: (tx: AuditedTransaction) => CommandWorkResult<T>;
}): CommandHttpResult<T>;
export function runAuditedTransaction<T>(input: {
  db: AppDatabase;
  actor: AuditActor;
  work: (tx: AuditedTransaction) => T;
}): T;
```

- [ ] **Step 1: Write failing invariant tests**

Cover these cases in one focused file:

- Role matrix: table-test Assistant/Doctor against `visit:start-consultation` and assert `false/true`.
- Same key, operation, and canonical body: invoke twice, assert the work spy ran once and both responses contain the same entity ID.
- Same key with a changed body or operation: assert `409 IDEMPOTENCY_CONFLICT`, no second work call, and unchanged row counts.
- Stale revision: assert `409 REVISION_CONFLICT`, the original revision/value, and no Audit Event.
- Injected work failure after a domain insert: assert both domain and Audit counts remain zero.
- Direct Audit `UPDATE` and `DELETE`: assert SQLite trigger constraint errors and unchanged row content.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:server -- tests/server/platform.test.ts`

Expected: FAIL on missing platform exports.

- [ ] **Step 3: Implement canonical idempotency and revision checks**

Hash `fast-json-stable-stringify({ operation, requestBody })` with SHA-256. Validate `Idempotency-Key` as 8–128 visible ASCII characters. Including the stable operation name makes reuse of one key against another endpoint a collision instead of replaying the wrong response. `expectedRevisions` is a map because later atomic commands will verify Visit, Note, Order, and artifact revisions together; do not replace it with one ambiguous integer. The transaction algorithm is fixed:

```text
BEGIN IMMEDIATE
  SELECT by actor_id + key
  existing + same hash      -> return stored status/data with replayed=true, no work
  existing + different hash -> throw IDEMPOTENCY_CONFLICT
  absent                     -> execute work with tx; insert response record
COMMIT
any error                    -> ROLLBACK
```

`assertExpectedRevision(actual, expected)` rejects non-integers and mismatches with `REVISION_CONFLICT`; successful updates use `WHERE id = ? AND revision = ?` and increment by exactly one. First execution stores the success envelope with `replayed=false`; replay preserves the original HTTP status and `data` exactly and changes only the response flag to `replayed=true`.

- [ ] **Step 4: Implement the single role-permission matrix and append-only audit writer**

```ts
// Defined in src/shared/contracts.ts; server permissions.ts imports this wire-safe union.
export type Permission =
  | "patient:read" | "patient:create-synthetic"
  | "visit:submit-intake" | "visit:read-queue"
  | "visit:start-consultation";

export const permissionsByRole = {
  assistant: ["patient:read", "patient:create-synthetic", "visit:submit-intake", "visit:read-queue"],
  doctor: ["patient:read", "patient:create-synthetic", "visit:submit-intake", "visit:read-queue", "visit:start-consultation"],
} as const;
```

`appendAuditEvent` accepts an `AuditActor` and only the branded transaction passed by `executeIdempotent` or `runAuditedTransaction`; `reason` is nullable only for actions whose contract does not require it. HTTP workflow code can construct only a named `Actor`; the `system` variant is confined to offline maintenance CLI modules. Account acknowledgement/password change use a named `runAuditedTransaction`; offline create/reset/disable first acquire the host lock, then use the system variant. Domain routes are forbidden from using the non-idempotent helper.

- [ ] **Step 5: Run GREEN and regression suite**

Run: `cd careflow-pilot && npm run test:server -- tests/server/platform.test.ts && npm test && npm run typecheck`

Expected: all platform and prior tests PASS.

- [ ] **Step 6: Commit platform invariants**

```bash
git add careflow-pilot
git commit -m "feat(platform): enforce mutation invariants"
```

---

### Task 4: Add Named Accounts, Cookie Sessions, and Server-Enforced RBAC

**Files:**
- Create: `careflow-pilot/src/server/modules/platform/sessions.ts`
- Create: `careflow-pilot/src/server/modules/platform/users-cli.ts`
- Create: `careflow-pilot/src/server/auth/hooks.ts`
- Create: `careflow-pilot/src/server/auth/routes.ts`
- Create: `careflow-pilot/scripts/users.ts`
- Modify: `careflow-pilot/package.json`
- Modify: `careflow-pilot/src/server/app.ts`
- Modify: `careflow-pilot/src/shared/contracts.ts`
- Create: `careflow-pilot/tests/server/helpers/auth.ts`
- Create: `careflow-pilot/tests/server/auth.test.ts`
- Create: `careflow-pilot/tests/server/users-cli.test.ts`

**Interfaces:**
- Produces: `authenticateRequest(request): Actor`, `requireActor(request, permission): Actor`, and auth endpoints.
- Cookie name: `careflow_session`; token is 32 random bytes encoded base64url; the database stores SHA-256 only.

**HTTP contracts:**

```text
POST /api/auth/login            {username,password} -> 200 {data: SessionDto}; Set-Cookie
GET  /api/auth/session          -> 200 {data: SessionDto} | 401 AUTH_REQUIRED
POST /api/auth/acknowledge-pilot {accepted:true} -> 204; record named tester acceptance once
POST /api/auth/change-password  {currentPassword,newPassword} -> 204; revoke all old sessions and issue a fresh current cookie
POST /api/auth/activity         -> 204; explicit real-user activity touch, no domain Audit
POST /api/auth/logout           -> 204; revoke current session; clear cookie
```

- [ ] **Step 1: Write failing authentication tests**

- Successful named-account Login: assert the cookie authenticates, the database token hash differs from the raw cookie, and neither appears in response JSON/log capture.
- Unknown username versus wrong password: assert identical `401 AUTH_REQUIRED` status/body shape.
- Unknown, disabled, and wrong-password branches: inject the Argon verifier and assert each performs exactly one real Argon2id verification before the same generic response.
- `mustChangePassword=true`: assert a protected route returns `403 PASSWORD_CHANGE_REQUIRED`, while Change Password succeeds.
- Missing Pilot acknowledgement: assert protected routes return `403 PILOT_ACKNOWLEDGEMENT_REQUIRED`; accepting records the injected UTC timestamp once and a repeat is a no-op.
- Injected clock at exactly 15 idle minutes and 8 absolute hours: assert session expiry and revocation; one second before each boundary remains valid.
- Queue/Dashboard reads every 5 seconds for 15 minutes: assert they never slide `last_seen_at` and the session still expires; a valid explicit Activity request before the boundary extends idle expiry but never absolute expiry.
- Assistant direct call to a test-harness-only Doctor-permission probe: assert `403 FORBIDDEN` independent of UI visibility; Task 6 repeats this against the real Start Consultation route.
- Disabled account and an account disabled after session issuance: assert Login and subsequent cookie use return the same generic `401` and every existing session is revoked.
- Six Login failures inside one minute: first five return generic `401`; the sixth returns stable `429 RATE_LIMITED` with no username enumeration.
- Change Password: assert every old cookie becomes invalid, the newly issued cookie works, and password hash/token values never appear in output.
- Users CLI against a live host lock or foreign SQLite file: assert non-zero exit and byte-for-byte/no-row change.
- Create/reset/disable CLI success: assert account row/revision/timestamps, session revocation where applicable, and immutable `actor_role=system` Audit evidence commit together.
- Logout: assert the server session row is revoked, `Set-Cookie` expires the cookie, and reuse returns `401`.

The Doctor-permission probe is registered only inside `createTestApp`; production `buildApp` never exposes a test route.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:server -- tests/server/auth.test.ts tests/server/users-cli.test.ts`

Expected: FAIL because auth routes and session service are absent.

- [ ] **Step 3: Implement account CLI and Argon2 password lifecycle**

Use `node:util.parseArgs` for explicit commands:

```text
npm run users -- create --username doctor --display-name "พญ. อริสรา" --role doctor
npm run users -- create --username assistant --display-name "คุณสุภาภรณ์" --role assistant
npm run users -- reset-password --username doctor
npm run users -- disable --username assistant
```

Add `users="node --env-file-if-exists=.env --import tsx scripts/users.ts"` to package scripts in the same RED/GREEN step.

`scripts/users.ts` is a thin TTY adapter around this injectable function so CI never hangs and passwords never become arguments:

```ts
export function runUsersCli(deps: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  promptSecret(label: string): Promise<string>;
  promptText(label: string): Promise<string>;
  stdout(line: string): void;
  stderr(line: string): void;
}): Promise<number>;
```

Production supplies hidden TTY input; tests inject deterministic prompts/output buffers. No implementation reads `process.argv`, `process.env`, stdin, or stdout outside the thin adapter.

Read passwords from an interactive hidden prompt, never a CLI argument or log. Accept 12–128 Unicode code points, reject the username and current password, and do not impose composition rules that reject Thai passphrases. Before `create`, display the synthetic-only rule and require the operator to type `SYNTHETIC-ONLY`; abort without a row on any other input. Hash with Argon2id. Commit one valid dummy Argon2id PHC hash generated with the same parameters as real accounts; Login verifies that hash when no account exists, and still verifies the stored hash before rejecting a disabled account, preventing the missing-user fast path. Never generate the dummy hash per request.

`create` and `reset-password` set `must_change_password=1`; reset-password and disable revoke every session for the account. Create/reset/disable increment or establish account revision/timestamps and append `account.created`, `account.password-reset`, or `account.disabled` as a system Audit Event; API acknowledgement/password change append named-actor account Audit Events. The CLI requires an explicit absolute `CAREFLOW_DB_PATH`, acquires the Task 2 maintenance lock, verifies CareFlow application/product/migration identity, and refuses an empty/relative/foreign database.

- [ ] **Step 4: Implement session cookies and route hooks**

Cookie properties are fixed: `HttpOnly`, `SameSite=Strict`, `Path=/`, no Domain, `Max-Age=28800`, and `Secure=config.cookieSecure`. Every authenticated request checks idle/absolute expiry but normal reads and polling never update `last_seen_at`. Only `/api/auth/activity`, forced-password/acknowledgement actions, and successful user-triggered domain commands may touch activity; the Activity route coalesces writes to at most once per minute. Rate-limit `/api/auth/login` to 5 attempts/minute per IP plus normalized username.

Pilot acknowledgement conditionally updates only a null acknowledgement timestamp, increments Account revision, and appends one named-actor account Audit Event in one audited transaction; repeats preserve the original timestamp/revision. Change Password verifies the current hash, updates hash/flags/timestamps/revision, revokes every prior session, appends account Audit, and inserts the one replacement session atomically before setting its cookie.

- [ ] **Step 5: Enforce password-change and permissions at the API boundary**

Only `/api/health`, `/api/auth/login`, `/api/auth/session`, `/api/auth/acknowledge-pilot`, `/api/auth/change-password`, `/api/auth/activity`, and `/api/auth/logout` bypass the operational gate. After Login, require named tester acknowledgement first, then password change, before any domain route. Every future `/api` mutation receives its Actor from the authenticated session; never accept actor ID or role from JSON.

- [ ] **Step 6: Run GREEN and security-focused regression**

Run: `cd careflow-pilot && npm run test:server -- tests/server/auth.test.ts tests/server/users-cli.test.ts tests/server/platform.test.ts && npm test && npm run typecheck`

Expected: all tests PASS; search test output for password/token strings and find none.

- [ ] **Step 7: Commit authentication**

```bash
git add careflow-pilot
git commit -m "feat(platform): add named account sessions"
```

---

### Task 5: Add the Server-Generated Synthetic Patient Registry

**Files:**
- Create: `careflow-pilot/src/server/modules/patient/schema.ts`
- Create: `careflow-pilot/src/server/modules/patient/service.ts`
- Create: `careflow-pilot/src/server/modules/patient/routes.ts`
- Create: `careflow-pilot/src/server/modules/patient/index.ts`
- Modify: `careflow-pilot/src/server/db/schema.ts`
- Modify: `careflow-pilot/src/server/app.ts`
- Modify: `careflow-pilot/src/shared/contracts.ts`
- Create: `careflow-pilot/tests/server/patient.test.ts`

**Interfaces:**

```ts
export interface PatientDto {
  id: string;
  hn: string;
  displayName: string;
  phone: string;
  birthDate: string;
  sex: "female" | "male" | "unknown";
  revision: number;
  createdAt: string;
}

export interface PatientService {
  createSyntheticPatient(tx: AppTransaction, actor: Actor): PatientDto;
  searchPatients(query: string): PatientDto[];
  getPatientById(id: string): PatientDto | null;
  getPatientsByIds(ids: readonly string[]): Map<string, PatientDto>;
  assertPatientRevision(tx: AppTransaction, id: string, expected: number): PatientDto;
}
```

**HTTP contracts:**

```text
POST /api/patients/synthetic
  Header: Idempotency-Key
  Body:   {expectedRevisions: {}, payload: {}}
  Result: 201 {data: PatientDto, replayed: false}
          201 {data: same PatientDto, replayed: true}

GET /api/patients/search?q=DEMO-000001
  Result: 200 {data: PatientDto[]}
```

Both endpoints require an authenticated account whose password has been changed. The create request schema is `.strict()` and accepts no identity, demographic, actor, role, Clinic, or counter fields.

Export `createSyntheticPatientBodySchema`, `patientSchema`, `patientCommandResponseSchema`, and `patientSearchResponseSchema`; derive all Patient wire types with `z.infer`. Server route parsing and client decoding import only those schemas.

- [ ] **Step 1: Write the failing registry and boundary tests**

```ts
it("generates the entire patient profile on the server", async () => {
  const response = await assistant.command("/api/patients/synthetic", {
    expectedRevisions: {},
    payload: {},
  });
  expect(response.statusCode).toBe(201);
  expect(response.json().data).toMatchObject({
    hn: "DEMO-000001",
    displayName: "ผู้ป่วยทดสอบ 000001",
    phone: "0000000001",
    revision: 1,
  });
});

```

Then add exact assertions for:

- Same idempotency key twice: Patient count `1`, identical ID, second `replayed=true`.
- Extra `hn`, `displayName`, `phone`, or arbitrary field: `422 VALIDATION_FAILED`, Patient/Audit counts `0`.
- Searches by each of HN, Thai name, and phone: one result with the created ID; wildcard input does not broaden the query.
- Anonymous request: `401`; authenticated Assistant and Doctor requests both succeed because both roles own this permission.
- Successful creation: one `patient.synthetic-created` Audit row with Assistant ID/role, Patient ID, and revision `1`.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:server -- tests/server/patient.test.ts`

Expected: FAIL because the Patient module and routes do not exist.

- [ ] **Step 3: Add the Patient schema and migration**

```text
patients(
  id PRIMARY KEY,
  clinic_id NOT NULL REFERENCES clinic_config(id),
  hn NOT NULL,
  display_name NOT NULL,
  phone NOT NULL,
  birth_date NOT NULL,
  sex NOT NULL CHECK sex IN ('female','male','unknown'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK revision >= 1,
  created_at NOT NULL,
  updated_at NOT NULL,
  UNIQUE(clinic_id,hn),
  CHECK(length(hn)=11 AND hn GLOB 'DEMO-[0-9][0-9][0-9][0-9][0-9][0-9]'),
  CHECK(display_name='ผู้ป่วยทดสอบ ' || substr(hn,6)),
  CHECK(length(phone)=10 AND phone GLOB '000000[0-9][0-9][0-9][0-9]'),
  CHECK(phone='000000' || substr(hn,-4)),
  CHECK(birth_date='1990-01-01' AND sex='unknown')
)
```

The Patient migration inserts `clinic_counters('synthetic_patient',0)` idempotently. Inside the same `BEGIN IMMEDIATE` transaction as Patient and Audit creation, allocate with `UPDATE clinic_counters SET value=value+1 WHERE key='synthetic_patient' AND value<999999 RETURNING value`; the first returned value is `1`, and no returned row maps to a stable exhaustion error without a write. Use the explicit synthetic demographic defaults `birth_date='1990-01-01'` and `sex='unknown'` so the browser never asks for real demographics. The four-digit phone suffix may cycle and is not a unique identifier. Add a direct-SQL test proving the database rejects arbitrary HN/name/phone/demographic values even if a future route validation regresses.

- [ ] **Step 4: Implement strict generation and bounded search**

Generation invariants are fixed:

```ts
const sixDigitCode = String(counter).padStart(6, "0");
const fourDigitSuffix = String(counter % 10_000).padStart(4, "0");
const hn = `DEMO-${sixDigitCode}`;
const displayName = `ผู้ป่วยทดสอบ ${sixDigitCode}`;
const phone = `000000${fourDigitSuffix}`;
```

Search trims the query, requires 2–80 Unicode characters, escapes SQL wildcard characters, searches only `hn`, `display_name`, and `phone` within the one Clinic, orders newest first, and caps results at 20. It never returns password, session, audit, or internal counter fields.

- [ ] **Step 5: Register routes through the module public boundary**

`patient/index.ts` exports the schema tables, service factory, route registration, and the public reader/revision methods above only. `getPatientsByIds` de-duplicates IDs and queries them in internal batches of at most 100, so an unusually long active Queue remains complete without an oversized SQLite `IN` clause; it returns no cross-Clinic rows. `server/app.ts` constructs the service once and passes the authenticated Actor to the command. Use operation name `patient.create-synthetic.v1` in `executeIdempotent` and audit action `patient.synthetic-created`.

- [ ] **Step 6: Generate migration and run GREEN**

Run:

```bash
cd careflow-pilot
npm run db:generate -- --name=patient
npm run test:server -- tests/server/patient.test.ts
npm test
npm run typecheck
```

Expected: Patient tests and all prior tests PASS; a second committed migration exists.

- [ ] **Step 7: Commit the registry**

```bash
git add careflow-pilot
git commit -m "feat(patient): add synthetic patient registry"
```

---

### Task 6: Add Atomic Intake, Shared Queue, and Start Consultation

**Files:**
- Create: `careflow-pilot/src/server/modules/visit/schema.ts`
- Create: `careflow-pilot/src/server/modules/visit/service.ts`
- Create: `careflow-pilot/src/server/modules/visit/routes.ts`
- Create: `careflow-pilot/src/server/modules/visit/index.ts`
- Modify: `careflow-pilot/src/server/db/schema.ts`
- Modify: `careflow-pilot/src/server/app.ts`
- Modify: `careflow-pilot/src/shared/contracts.ts`
- Create: `careflow-pilot/tests/server/visit.test.ts`

**Shared wire contracts:**

Export strict `intakePayloadSchema`, `submitIntakeBodySchema`, `queueItemSchema`, `queueResponseSchema`, `dashboardTodayResponseSchema`, `visitWorkspaceSchema`, `startConsultationBodySchema`, and their `z.infer` types. The interface-form snippets below specify their required shape; do not create parallel handwritten definitions.

```ts
export const visitStatuses = [
  "WAITING", "CONSULTING", "AWAITING_PREPARATION", "PREPARING",
  "AWAITING_RELEASE", "AWAITING_HANDOFF", "AWAITING_ORDER_REVISION",
  "AWAITING_CHARGE", "AWAITING_PAYMENT", "READY_TO_CLOSE", "CLOSED",
] as const;

export interface IntakePayload {
  patientId: string;
  chiefComplaint: string;
  vitals: {
    weightKg: number | null;
    heightCm: number | null;
    temperatureC: number | null;
    systolicMmhg: number | null;
    diastolicMmhg: number | null;
    heartRateBpm: number | null;
    spo2Percent: number | null;
  };
}

export interface QueueItemDto {
  visit: {
    id: string;
    status: "WAITING" | "CONSULTING";
    revision: number;
    arrivedAt: string;
    startedAt: string | null;
  };
  patient: Pick<PatientDto, "id" | "hn" | "displayName" | "birthDate" | "sex">;
  chiefComplaint: string;
  vitals: IntakePayload["vitals"];
  allowedActions: Array<"START_CONSULTATION">;
}

export interface VisitWorkspaceDto {
  visit: QueueItemDto["visit"];
  patient: PatientDto;
  intake: {
    id: string;
    chiefComplaint: string;
    vitals: IntakePayload["vitals"];
    recordedAt: string;
    recordedBy: { id: string; displayName: string };
  };
  allowedActions: Array<"START_CONSULTATION">;
}
```

`allowedActions` is server-derived UX guidance only; the command route still enforces permission and state.

**HTTP contracts:**

```text
POST /api/visits/intake
  Header: Idempotency-Key
  Body:   {expectedRevisions: {patient: number}, payload: IntakePayload}
  Result: 201 {data: QueueItemDto, replayed: false}

GET /api/queue
  Result: 200 {data: QueueItemDto[]}

GET /api/dashboard/today
  Result: 200 {data: {waiting: number, consulting: number, updatedAt: string}}

GET /api/visits/:visitId/workspace
  Result: 200 {data: VisitWorkspaceDto}

POST /api/visits/:visitId/start-consultation
  Header: Idempotency-Key
  Body:   {expectedRevisions: {visit: number}, payload: {}}
  Result: 200 {data: QueueItemDto, replayed: false|true}
```

- [ ] **Step 1: Write failing Visit transaction and state tests**

- Successful Intake: Visit/Observation/Audit counts `1/1/1`, status `WAITING`, revision `1`, and matching actor/time.
- Injected failure between Observation and Audit: all three counts remain `0`.
- Same Intake key/body twice: one Visit and identical response ID; changed body with same key returns `409`.
- Second active Visit for the same Patient: `409 ACTIVE_VISIT_EXISTS`; no extra Observation/Audit.
- Blank/oversized complaint and every out-of-range non-null vital: `422` with the correct field key and zero writes.
- Assistant and Doctor cookies querying Queue: identical Visit ID/revision/status, but Assistant `allowedActions=[]` and Doctor `allowedActions=["START_CONSULTATION"]`; after Start both arrays are empty.
- Assistant direct Start call: `403` and Visit remains `WAITING/1`.
- Doctor Start with exact revision: `CONSULTING/2`, `startedAt` set, one transition Audit.
- Stale revision or second Start: `409`, no third revision and no extra Audit.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:server -- tests/server/visit.test.ts`

Expected: FAIL because Visit services and tables are absent.

- [ ] **Step 3: Add Visit and Intake schemas with database guards**

```text
visits(
  id PRIMARY KEY,
  clinic_id NOT NULL FK,
  patient_id NOT NULL FK,
  status NOT NULL CHECK status IN (all visitStatuses),
  chief_complaint NOT NULL CHECK length(trim(chief_complaint)) BETWEEN 1 AND 500,
  revision INTEGER NOT NULL DEFAULT 1 CHECK revision >= 1,
  arrived_at NOT NULL, started_at NULL, closed_at NULL,
  created_by NOT NULL FK staff_accounts(id)
)

intake_observations(
  id PRIMARY KEY, visit_id NOT NULL UNIQUE FK,
  weight_kg REAL NULL CHECK(weight_kg IS NULL OR weight_kg BETWEEN 1 AND 350),
  height_cm REAL NULL CHECK(height_cm IS NULL OR height_cm BETWEEN 30 AND 250),
  temperature_c REAL NULL CHECK(temperature_c IS NULL OR temperature_c BETWEEN 30 AND 45),
  systolic_mmhg INTEGER NULL CHECK(systolic_mmhg IS NULL OR systolic_mmhg BETWEEN 50 AND 260),
  diastolic_mmhg INTEGER NULL CHECK(diastolic_mmhg IS NULL OR diastolic_mmhg BETWEEN 30 AND 180),
  heart_rate_bpm INTEGER NULL CHECK(heart_rate_bpm IS NULL OR heart_rate_bpm BETWEEN 20 AND 250),
  spo2_percent INTEGER NULL CHECK(spo2_percent IS NULL OR spo2_percent BETWEEN 50 AND 100),
  CHECK(systolic_mmhg IS NULL OR diastolic_mmhg IS NULL OR systolic_mmhg >= diastolic_mmhg),
  recorded_by NOT NULL FK staff_accounts(id), recorded_at NOT NULL
)
```

Add a partial unique index on `(clinic_id, patient_id)` where `status <> 'CLOSED'`. This database constraint is the final protection against double-click and concurrent active-Visit creation.

- [ ] **Step 4: Implement strict Intake validation and atomic creation**

Use `.strict()` Zod objects. `chiefComplaint` is trimmed and 1–500 characters. Nullable bounds are: weight `1–350`, height `30–250`, temperature `30–45`, systolic `50–260`, diastolic `30–180`, heart rate `20–250`, and SpO2 `50–100`. Reject systolic lower than diastolic. `server/app.ts` injects the Patient module's public reader into Visit composition; Visit never imports Patient private schema. One immediate transaction calls `assertPatientRevision`, creates Visit and Observation, writes Audit, and stores the idempotent response.

Map the partial unique-index violation to `409 ACTIVE_VISIT_EXISTS` rather than `500`. Use operation `visit.submit-intake.v1` and audit `visit.intake-submitted`.

- [ ] **Step 5: Implement server-authoritative reads and transition**

Queue ordering is `WAITING` before `CONSULTING`, then `arrived_at ASC`; it returns active Visits only. Derive `allowedActions` per authenticated Actor and current state—never persist it. Dashboard counts derive from the same Visit table using the injected clock and `Asia/Bangkok` day boundaries while storage remains UTC. Queue/workspace read Visit rows first, then use injected bounded `getPatientsByIds`/`getPatientById` to assemble DTOs in `app.ts`; they do not join a private Patient table. Workspace returns one Visit/Patient/Observation aggregate and `404 NOT_FOUND` for unknown IDs.

Start Consultation requires Doctor permission, `WAITING`, and an exact expected Visit revision. Update with `WHERE id=? AND status='WAITING' AND revision=?`, set `CONSULTING`, `started_at`, increment revision once, append `visit.consultation-started`, and store the response in the same transaction under operation `visit.start-consultation.v1`.

- [ ] **Step 6: Generate migration and run GREEN**

Run:

```bash
cd careflow-pilot
npm run db:generate -- --name=visit_intake
npm run test:server -- tests/server/visit.test.ts tests/server/patient.test.ts
npm test
npm run typecheck
```

Expected: domain tests and all prior tests PASS; Patient/Visit data comes only from SQLite.

- [ ] **Step 7: Commit the shared workflow API**

```bash
git add careflow-pilot
git commit -m "feat(visit): add shared intake queue workflow"
```

---

### Task 7: Connect the Browser HTTP, Session, and Error Boundaries

**Files:**
- Create: `careflow-pilot/src/client/lib/api-client.ts`
- Create: `careflow-pilot/src/client/lib/api-error.ts`
- Create: `careflow-pilot/src/client/lib/idempotency.ts`
- Create: `careflow-pilot/src/client/lib/thai-date.ts`
- Create: `careflow-pilot/src/client/app/query-client.ts`
- Modify: `careflow-pilot/src/client/app/providers.tsx`
- Modify: `careflow-pilot/src/client/app/router.tsx`
- Create: `careflow-pilot/src/client/auth/AuthProvider.tsx`
- Create: `careflow-pilot/src/client/auth/AuthGate.tsx`
- Create: `careflow-pilot/src/client/auth/LoginScreen.tsx`
- Create: `careflow-pilot/src/client/auth/PilotRulesScreen.tsx`
- Create: `careflow-pilot/src/client/auth/ChangePasswordScreen.tsx`
- Create: `careflow-pilot/src/client/components/careflow/ScreenState.tsx`
- Modify: `careflow-pilot/src/client/components/careflow/AppShell.tsx`
- Create: `careflow-pilot/tests/client/api-client.test.ts`
- Create: `careflow-pilot/tests/client/thai-date.test.ts`
- Create: `careflow-pilot/tests/client/auth.test.tsx`
- Modify: `careflow-pilot/tests/client/router.test.tsx`

**Client contracts:**

```ts
export interface CommandAttempt<TPayload, TRevisions extends Record<string, number>> {
  idempotencyKey: string;
  expectedRevisions: TRevisions;
  payload: TPayload;
}

export interface SessionDto {
  user: { id: string; username: string; displayName: string; role: "assistant" | "doctor" };
  clinic: { id: string; name: string };
  permissions: Permission[];
  pilotAcknowledgedAt: string | null;
  mustChangePassword: boolean;
  idleExpiresAt: string;
}

export class ApiClient {
  get<T>(path: string, schema: ZodType<T>, signal?: AbortSignal): Promise<T>;
  json<TBody, TResult>(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body: TBody,
    schema: ZodType<TResult>,
    signal?: AbortSignal,
  ): Promise<TResult>;
  void<TBody>(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body?: TBody,
    signal?: AbortSignal,
  ): Promise<void>;
  command<TPayload, TRevisions extends Record<string, number>, TResult>(
    path: string,
    attempt: CommandAttempt<TPayload, TRevisions>,
    schema: ZodType<TResult>,
    signal?: AbortSignal,
  ): Promise<TResult>;
}
```

- [ ] **Step 1: Write failing transport and retry tests**

- Every request calls `fetch` with `credentials: "include"` and same-origin relative paths.
- Login JSON and Change Password/Logout `204` calls use the same decoder/error/credential boundary, with no route-level raw `fetch`.
- A valid response is decoded by its Zod schema; a malformed success body rejects with `RESPONSE_CONTRACT_INVALID` and returns no data.
- `401`, `403`, `409`, `422`, and `429` retain status, code, Thai message, request ID, revision map, field errors, and bounded retry metadata in `ApiError`.
- Rejected `fetch` becomes `SERVER_UNAVAILABLE`; no success callback or cache write runs.
- A command places the UUID in `Idempotency-Key` and JSON contains exactly `expectedRevisions` plus `payload`.
- Calling the explicit retry function twice after a network failure records the same UUID in both requests.
- `formatThaiDateTime("2026-08-03T17:30:00.000Z")` renders 4 August 2569 in Bangkok/Buddhist time, and UTC instants on each side of Bangkok midnight render different local dates.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:client -- tests/client/api-client.test.ts`

Expected: FAIL because the API client does not exist.

- [ ] **Step 3: Implement the same-origin transport and immutable command attempts**

`createCommandAttempt(expectedRevisions, payload)` calls `crypto.randomUUID()` once. `ApiClient.command` sends `Idempotency-Key`, `Content-Type: application/json`, `credentials: "include"`, and JSON `{expectedRevisions,payload}`. `json` handles ordinary authenticated lifecycle JSON such as Login; `void` requires an empty `204` body for Change Password/Logout. All three share one internal request/error decoder, so screens never call raw `fetch`. Do not enable automatic mutation retries. A retry control retains the same `CommandAttempt` object until success, deliberate cancel, or changed form input. Centralize UI time formatting in `thai-date.ts` with `Intl.DateTimeFormat("th-TH-u-ca-buddhist", {timeZone: "Asia/Bangkok"})`; components never parse UTC strings into ad-hoc local formats.

`ApiError` exposes `status`, `code`, `messageTh`, `requestId`, `fieldErrors`, and `currentRevisions`. A thrown network error becomes client-only code `SERVER_UNAVAILABLE`; the UI must not imply that the write committed. Server `VALIDATION_FAILED` responses use HTTP `422`; malformed JSON uses `400` with the same stable code.

- [ ] **Step 4: Write failing AuthGate and session tests**

- Anonymous `/queue`: redirect to `/login?returnTo=%2Fqueue`; malicious absolute/protocol-relative `returnTo` falls back to `/`.
- Authenticated session without `pilotAcknowledgedAt`: only Pilot Rules/Logout render; named acceptance is recorded before continuing.
- Acknowledged session with `mustChangePassword=true`: only Change Password/Logout render; completing change returns to the safe target.
- Named Doctor/Assistant sessions: show display name and translated role, with no role-switch/reset button.
- Logout or global `401`: remove protected Query cache entries before rendering Login.
- Seed `localStorage` with fake token/role/Patient/Visit: assert none is read or rendered and no storage listener is registered.
- Advance fake time with five-second query polling only: assert no Activity request and Session expires; dispatch a trusted user-activity adapter event and assert one coalesced Activity request per minute.

- [ ] **Step 5: Run Auth RED and implement session lifecycle**

Run: `cd careflow-pilot && npm run test:client -- tests/client/auth.test.tsx`

Expected: FAIL on missing provider/screens.

Implement `AuthProvider` with the `session` query, Login, named Pilot Rules acknowledgement, forced Change Password, Activity, and Logout. A small injected activity adapter listens only to real keyboard/pointer/touch user events, coalesces to one request/minute, and is not called by query polling, focus refetch, timers, or render. Sanitize `returnTo` to a local path beginning with one `/`; never accept protocol-relative or absolute URLs. The server session and permission array drive account/role UI. `AuthGate` renders explicit loading, Thai authentication failure, permission-denied, and server-unavailable states.

- [ ] **Step 6: Wire router and QueryClient policies**

Add public `/login`, session-only `/pilot-rules`, and `/change-password`; all still render the permanent synthetic-data banner. Nest every P0 route under `AuthGate` and `AppShell`. Update Task 1's router smoke test to provide an authenticated/acknowledged MSW session, and add a separate anonymous redirect assertion so the original shell regression remains meaningful. Stable keys are:

```ts
export const queryKeys = {
  session: ["session"] as const,
  dashboard: ["dashboard"] as const,
  queue: ["queue"] as const,
  patientSearch: (q: string) => ["patients", q] as const,
  visit: (id: string) => ["visit", id] as const,
};
```

Queries retry at most once for network/`5xx`, never for `401/403/409/422`; mutations never retry automatically. A global `401` clears protected queries and returns to Login. Keep toasts and unsent drafts as ephemeral component state only.

- [ ] **Step 7: Run GREEN and commit the browser boundary**

Run:

```bash
cd careflow-pilot
npm run test:client -- tests/client/api-client.test.ts tests/client/thai-date.test.ts tests/client/auth.test.tsx
npm run typecheck
npm test
```

Expected: browser boundary and all prior tests PASS.

```bash
git add careflow-pilot
git commit -m "feat(pilot): connect session and API boundaries"
```

---

### Task 8: Connect the Existing Intake Design to Committed Patient and Visit Data

**Files:**
- Create: `careflow-pilot/src/client/components/careflow/PatientHeader.tsx`
- Create: `careflow-pilot/src/client/screens/IntakeScreen.tsx`
- Create: `careflow-pilot/src/client/features/patients.ts`
- Create: `careflow-pilot/src/client/features/intake.ts`
- Modify: `careflow-pilot/src/client/app/router.tsx`
- Modify: `careflow-pilot/src/client/styles/pilot.css`
- Create: `careflow-pilot/tests/client/intake.test.tsx`
- Reference unchanged: `careflow-webapp/components/careflow/PatientHeader.tsx`
- Reference unchanged: `careflow-webapp/components/careflow/screens/IntakeScreen.tsx`

**UI boundary:** Preserve the source screen's card hierarchy, typography, spacing, field styling, responsive layout, and Thai action copy. Replace `useCareFlow`, reducer dispatch, seeded demo patients, and client-supplied identity inputs with Patient search/generation and Intake API hooks.

- [ ] **Step 1: Write failing Intake journey tests with MSW**

- Existing Patient: search, select, enter Intake, assert request includes selected Patient revision, and navigate only after `201`.
- Generate Patient: assert request payload is `{}` and no identity/demographic input exists.
- Generation succeeds but Intake fails: selected Patient and all Intake fields remain; retry creates no second Patient.
- `422`: field and summary errors render, first invalid control receives focus, route and draft remain unchanged.
- `409 ACTIVE_VISIT_EXISTS`: no success toast; render a Queue link and keep draft.
- Network/`503`: “ยังบันทึกไม่ได้” renders; explicit retry sends the original idempotency key.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:client -- tests/client/intake.test.tsx`

Expected: FAIL because the connected Intake route does not exist.

- [ ] **Step 3: Implement debounced Patient search and generation**

Search only after 2 characters with a 250 ms debounce and cancellation through `AbortSignal`. Results show HN, synthetic name, and generated age/sex; no appointment or local demo array is searched. The “สร้างผู้ป่วยสังเคราะห์” action explains that identity and demographics are generated by the server, creates one immutable command attempt, then selects the committed response.

Do not expose name, HN, phone, birth date, or sex inputs. A network retry reuses the same patient-generation attempt. Selecting a different Patient deliberately discards that attempt after confirmation if an Intake draft exists.

- [ ] **Step 4: Implement the connected Intake form**

Populate the source design with chief complaint and seven nullable vital fields. Convert blank optional vitals to `null` before constructing the command; never convert blank to zero. Submit `expectedRevisions.patient` from the selected result. Disable the primary action during a request and navigate to `/queue` only after a committed `201` response.

On success invalidate `queue`, `dashboard`, and relevant Patient search keys. On `422`, map server `fieldErrors` to labels and focus the first invalid field. On `409`, preserve the draft and offer “โหลดคิวล่าสุด”. On network/`503`, show “ยังบันทึกไม่ได้” and the exact-attempt retry control.

- [ ] **Step 5: Verify keyboard, responsive, and no-local-authority behavior**

Test the form at DOM level for associated labels, error summaries, focus movement, and a single primary submit action. Confirm neither Patient nor Visit is written to `localStorage` or rendered as successful before MSW returns the server response.

- [ ] **Step 6: Run GREEN and commit Intake**

Run:

```bash
cd careflow-pilot
npm run test:client -- tests/client/intake.test.tsx tests/client/api-client.test.ts
npm run typecheck
npm run lint
npm test
```

Expected: all Intake and regression tests PASS with the original demo directory unchanged.

```bash
git add careflow-pilot
git commit -m "feat(pilot): connect synthetic patient intake"
```

---

### Task 9: Connect Overview, Queue, and the Read-Only Consultation Handoff

**Files:**
- Create: `careflow-pilot/src/client/screens/OverviewScreen.tsx`
- Create: `careflow-pilot/src/client/screens/QueueScreen.tsx`
- Create: `careflow-pilot/src/client/screens/ConsultationScreen.tsx`
- Create: `careflow-pilot/src/client/features/dashboard.ts`
- Create: `careflow-pilot/src/client/features/queue.ts`
- Create: `careflow-pilot/src/client/features/visit.ts`
- Modify: `careflow-pilot/src/client/app/router.tsx`
- Create: `careflow-pilot/tests/client/queue.test.tsx`
- Reference unchanged: `careflow-webapp/components/careflow/screens/OverviewScreen.tsx`
- Reference unchanged: `careflow-webapp/components/careflow/screens/QueueScreen.tsx`
- Reference unchanged: `careflow-webapp/components/careflow/screens/ConsultationScreen.tsx`

**Screen modes:**

```text
Overview: server waiting/consulting counts; later medication/finance cards visibly unavailable
Queue:     shared WAITING/CONSULTING rows ordered by server; no local workflow reducer
Doctor:    WAITING row exposes Start Consultation
Assistant: WAITING row exposes status only; direct API remains 403
Consult:   committed Patient + Intake snapshot; milestone-next clinical editor is disabled
```

- [ ] **Step 1: Write failing shared Queue and role-mode tests**

- Assistant and Doctor session fixtures render one API Queue row with identical Visit ID, revision, status, and Patient HN.
- Fake timers advance five seconds: visible Queue/Dashboard refetch once; hidden document does not; focus triggers a refetch.
- Start Consultation renders only when both Doctor permission and server `START_CONSULTATION` action are present.
- Clicking Start sends the Queue Visit revision and navigates only after `200 CONSULTING`.
- `409` renders a hard block; “โหลดข้อมูลล่าสุด” refetches before re-enabling any action.
- Consultation renders committed Patient/Intake fields and milestone-next copy with no writable SOAP/diagnosis/order control.
- Medication, payment, and stock cards show unavailable copy and never a synthetic numeric total.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:client -- tests/client/queue.test.tsx`

Expected: FAIL because the three connected screens are absent.

- [ ] **Step 3: Implement server-backed Overview and Queue reads**

Use TanStack Query keys from Task 7. Set `refetchInterval: 5000`, `refetchIntervalInBackground: false`, and `refetchOnWindowFocus: true` for Queue and Dashboard. Preserve the source cards/table/mobile layout, but remove seeded counts, appointment links, Analytics, role toggles, and any hard-coded Visit IDs.

Loading uses skeletons in the existing card shape; empty shows a direct Intake action; `403` shows permission denied; unavailable states retain the last explicitly marked stale data only if the query library has it and never claim a new write succeeded.

- [ ] **Step 4: Implement Doctor-only Start Consultation**

Construct one attempt with `expectedRevisions.visit` from the Queue row. Render the action only when both the server session has `visit:start-consultation` and the row contains `START_CONSULTATION`; this does not replace server authorization. On success invalidate Queue/Dashboard/Visit and navigate to `/consultations/:visitId`. On `REVISION_CONFLICT` or `INVALID_STATE`, do not retry the mutation; offer “โหลดข้อมูลล่าสุด”.

- [ ] **Step 5: Implement the milestone handoff Consultation screen**

Fetch `/api/visits/:visitId/workspace`, decode `visitWorkspaceSchema`, and render the nested committed Patient/Intake evidence, arrival/start times, status, and revision. Format every UTC timestamp through `thai-date.ts` (Bangkok time/Buddhist Era). Keep the source visual sections for Clinical Note but replace editable controls with:

```text
เริ่มตรวจแล้ว — การบันทึกและลงนาม Clinical Note จะเปิดใน Milestone ถัดไป
```

No placeholder note, diagnosis, medication decision, or dispatch is created. Assistant may read the committed snapshot but sees no Doctor action.

- [ ] **Step 6: Run GREEN, compare visuals, and commit**

Run:

```bash
cd careflow-pilot
npm run test:client -- tests/client/queue.test.tsx tests/client/intake.test.tsx
npm run typecheck
npm run lint
npm test
npm run build
git diff --exit-code -- ':(top)careflow-webapp'
```

Expected: connected screens PASS and the frozen demo has no diff.

```bash
git add careflow-pilot
git commit -m "feat(pilot): connect shared queue workflow"
```

---

### Task 10: Prove Restart Persistence, Two-Session Sharing, and a Runnable Build

**Files:**
- Create: `careflow-pilot/src/server/static.ts`
- Modify: `careflow-pilot/src/server/app.ts`
- Modify: `careflow-pilot/src/server/server.ts`
- Create: `careflow-pilot/scripts/reset-synthetic-data.ts`
- Create: `careflow-pilot/tests/server/restart.test.ts`
- Create: `careflow-pilot/tests/server/reset-synthetic-data.test.ts`
- Create: `careflow-pilot/playwright.config.ts`
- Create: `careflow-pilot/tests/e2e/pilot-shared-visit.spec.ts`
- Create: `careflow-pilot/tests/e2e/responsive.spec.ts`
- Create: `careflow-pilot/README.md`
- Create: `.github/workflows/ci.yml`
- Create: `README.md`
- Modify: `careflow-pilot/.env.example`
- Modify: `careflow-pilot/package.json`
- Modify: `careflow-pilot/src/server/modules/platform/index.ts`

- [ ] **Step 1: Write failing restart-persistence integration test**

```ts
it("reopens the same SQLite file with identical committed workflow evidence", async () => {
  const first = await createTestApp({ databasePath: temp.path });
  const created = await completeIntakeAndStart(first);
  await first.close();

  const second = await createTestApp({ databasePath: temp.path });
  const workspace = await second.requestWithCookie(created.doctorCookie,
    `/api/visits/${created.visit.id}/workspace`);
  const queue = await second.requestWithCookie(created.assistantCookie, "/api/queue");
  expect(workspace.json().data).toMatchObject({
    visit: { id: created.visit.id, revision: 2, status: "CONSULTING" },
    patient: { id: created.patient.id, hn: created.patient.hn },
    intake: {
      id: created.intake.id,
      chiefComplaint: created.intake.chiefComplaint,
      vitals: created.intake.vitals,
      recordedAt: created.intake.recordedAt,
    },
  });
  expect(queue.json().data).toContainEqual(
    expect.objectContaining({ visit: expect.objectContaining({ id: created.visit.id, revision: 2 }) }),
  );
  expect(await domainAuditIds(second, [created.patient.id, created.visit.id]))
    .toEqual(created.patientAndVisitAuditIds);
  await second.close();
});
```

The test uses a unique `mkdtemp` directory and real SQLite file; cleanup targets only that exact directory. It must reuse both pre-restart raw cookies and must not log in again, proving that workflow data and both session rows survive restart.

- [ ] **Step 2: Run RED, then make startup migration and shutdown deterministic**

Run: `cd careflow-pilot && npm run test:server -- tests/server/restart.test.ts`

Expected: initial FAIL on incomplete lifecycle. Implement startup migration before Fastify listens and graceful `SIGINT`/`SIGTERM`: stop accepting requests, close Fastify, checkpoint WAL with `wal_checkpoint(TRUNCATE)`, close the one database handle, release the host lock, then exit. Never delete or silently recreate an incompatible database.

The host-lock primitive from Task 2 remains held for the process lifetime. A crash may leave a stale lock; never auto-delete it—README recovery requires the operator to verify that no CareFlow process is running before removing that one explicit lock directory.

- [ ] **Step 3: Add same-origin production serving and deep-link fallback tests**

Register `@fastify/static` against `config.clientDistPath`. Known assets are served normally; every non-API unknown path returns `index.html`, including `/consultations/<id>`. Unknown `/api/**` always returns the JSON `404 NOT_FOUND` contract and never SPA HTML. `buildApp` accepts an optional injected assets directory; server tests create a tiny `index.html` in their unique temp directory, while non-static API tests disable static serving. This keeps `npm test` runnable on a fresh checkout before `npm run build`. Production startup fails clearly if the configured client build is missing. Add assertions to `health.test.ts`, then run:

```bash
cd careflow-pilot
npm run build
npm run test:server -- tests/server/health.test.ts tests/server/restart.test.ts
CAREFLOW_DB_PATH=./data/careflow.sqlite npm start
```

Expected: `/api/health`, `/`, and a direct SPA deep link return correctly from one Node process at `127.0.0.1:3001`. Stop the manual smoke server before continuing.

- [ ] **Step 4: Add a guarded synthetic reset CLI**

First write the reset safety tests and run:

```bash
cd careflow-pilot
npm run test:server -- tests/server/reset-synthetic-data.test.ts
```

Expected RED: reset module/script and guarded behavior do not exist.

The CLI requires both `--database /absolute/path/careflow.sqlite` and the exact token `--confirm RESET-SYNTHETIC-PILOT`. It verifies the `clinic_config.synthetic_only=1` marker created in Task 2, and rejects missing/relative paths, directories, symlinks, non-Pilot schemas, or any database not explicitly marked synthetic-only.

The operator must stop the service first. Refuse while the app-held host-lock directory exists, then acquire that maintenance lock and attempt `BEGIN EXCLUSIVE` with a short timeout. Before deletion, verify application/product/migration identity and compare the schema's application-owned tables to an exact allowlist; any later unknown domain table fails closed until its owning plan extends reset and tests. Enable `secure_delete=ON`; in foreign-key order drop the two Audit triggers, delete Sessions, Idempotency, Intake, Visit, Patient, and only `patient.*`/`visit.*` Audit rows, reset only the `synthetic_patient` counter, recreate the exact triggers, and commit. Preserve Clinic, Staff Account, and `account.*` Audit evidence.

After commit, run `wal_checkpoint(TRUNCATE)`, `VACUUM`, a second checkpoint, and verify zero target rows, restored triggers, `foreign_key_check` empty, and `freelist_count=0`; print success only after all pass. If physical cleanup fails after logical deletion, exit non-zero and explicitly require a rerun—never report false success. Tests in `reset-synthetic-data.test.ts` cover wrong confirmation/no change, live app lock/no change, unknown table/no change, normal reset/session revocation, domain Audit deletion with `account.*` Audit preservation, trigger restoration, WAL truncation/free-page cleanup, and rejection of every target outside the explicit database.

Add `reset:synthetic="node --env-file-if-exists=.env --import tsx scripts/reset-synthetic-data.ts"`, rerun the focused test, and require GREEN before continuing.

- [ ] **Step 5: Write the failing two-session browser journey**

Add `test:e2e="playwright test"` to package scripts before invoking the E2E command in Step 6.

`pilot-shared-visit.spec.ts` starts an injected Fastify app on a random loopback port against one temporary SQLite file and serves the production SPA. Seed test-only named Assistant and Doctor accounts with `mustChangePassword=false` and no acknowledgement; credentials remain inside the test fixture and are never production defaults. After Login, each named user must complete `/pilot-rules` once before any operational route, so the E2E journey proves the acceptance gate as well as the workflow.

Use two independent Playwright BrowserContexts:

```ts
const assistantContext = await browser.newContext();
const doctorContext = await browser.newContext();
const assistantPage = await assistantContext.newPage();
const doctorPage = await doctorContext.newPage();
```

The Assistant logs in, generates a Patient, submits Intake, and sees `WAITING`. The Doctor logs in separately, sees that exact HN/Visit ID after reload, starts Consultation, and sees `CONSULTING`. The Assistant refetches and sees the same status. Assert neither context contains Patient/Visit authority in `localStorage`.

- [ ] **Step 6: Run E2E RED, implement missing seams, then GREEN**

Run:

```bash
cd careflow-pilot
npx playwright install chromium
npm run build
npm run test:e2e -- tests/e2e/pilot-shared-visit.spec.ts
```

Expected: the first run exposes any real integration gaps; after the minimum fixes, the two-context journey PASSes with one Patient, one Visit, revisions `1 → 2`, and the expected Audit Events.

- [ ] **Step 7: Add responsive/browser guardrails without redesign**

At viewports `375 × 812`, `768 × 1024`, and `1440 × 900`, test Login, Intake, Queue, and Consultation for a visible synthetic banner, 48 px primary controls, no horizontal document overflow, keyboard-reachable primary action, and no role/reset control. Capture failure-only screenshots. Compare manually to `DESIGN.md` and the frozen demo before accepting any baseline CSS change.

- [ ] **Step 8: Add operator docs and CI**

`careflow-pilot/README.md` must provide copy/paste steps for Node 22, `npm ci`, `.env`, migration, interactive Doctor/Assistant creation, `npm run dev`, production build/start, restart verification, reset, and the first two-browser rehearsal. Document enforced POSIX `0700/0600` modes and the Windows expectation of a dedicated CareFlow account/data directory ACL limited to that account and Administrators. It begins with the synthetic-only warning and states that Clinical Note, medication, inventory, finance, backup, HTTPS/Caddy, and real Patient data are not enabled in this milestone.

The root README explains the two sibling products and links to the approved PRD and this plan. CI has:

```text
demo-ubuntu:  careflow-webapp npm ci → test → typecheck → lint → build
pilot-ubuntu: careflow-pilot npm ci → npx playwright install --with-deps chromium → lint → typecheck → test → build → Chromium E2E
pilot-windows: careflow-pilot npm ci → lint → typecheck → server tests → build
```

Use Node 22 and npm lockfile caching scoped to each package. Windows runs native Node/`better-sqlite3`, not WSL or Docker. Upload Playwright traces/screenshots only on failure.

- [ ] **Step 9: Run the complete local acceptance gate**

Run from repository root:

```bash
cd careflow-webapp
npm ci
npm test
npm run typecheck
npm run lint
npm run build

cd ../careflow-pilot
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e

cd ..
git diff --exit-code -- ':(top)careflow-webapp'
git status --short
```

Expected:

```text
existing demo: 56 tests PASS and no source diff
pilot: all client/server/E2E tests PASS; lint/typecheck/build exit 0
one production Node process serves API + SPA
restart test preserves Patient, Visit, Intake, revisions, and Audit IDs
two isolated browser sessions complete WAITING → CONSULTING
only intended PRD/plan/Pilot/README/CI files are staged
```

- [ ] **Step 10: Commit the completed milestone**

Inspect `git diff --cached --name-only` before committing; never stage `.DS_Store` or `stitch_careflow_clinic_management_system/`.

```bash
git add careflow-pilot .github/workflows/ci.yml README.md \
  docs/superpowers/specs/2026-08-03-careflow-pilot-design.md \
  docs/superpowers/plans/2026-08-03-careflow-local-pilot-foundation.md
git diff --cached --check
git commit -m "feat(pilot): deliver local shared intake milestone"
```

---

## Requirement-to-Test Traceability

| Milestone requirement | Primary evidence |
|---|---|
| Existing UI/CSS is preserved | Task 1 shell test, Task 9 frozen-demo diff, Task 10 viewport checks |
| Named Doctor and Assistant | `auth.test.ts`, two BrowserContexts |
| Session/RBAC enforced by API | Assistant direct-call `403`, cookie/session expiry tests |
| Synthetic identity only | strict Patient API tests; no browser identity inputs; permanent banner |
| One canonical SQLite writer | WAL/pragma tests, injected single handle, no client storage authority |
| Separate idempotent Patient generation and atomic Intake | Patient replay tests plus Visit replay/collision/rollback tests |
| Stale/wrong transition blocked | expected-revision and `WAITING` state tests |
| Shared Queue on two sessions | Playwright shared-Visit journey |
| Persistence after restart | real-file `restart.test.ts` with stable identifiers/revisions/audits |
| Honest unavailable behavior | API-client/network tests and preserved Intake draft |
| Safe synthetic reset | confirmation/marker/trigger-restoration reset tests |

## Milestone 1 Definition of Done

- [ ] All ten tasks were implemented in order with RED/GREEN evidence.
- [ ] `careflow-webapp/` still passes its original 56 tests and has no source diff.
- [ ] Assistant and Doctor use independent named cookie sessions; the role toggle is gone.
- [ ] Patient identity is generated only by the server and every page shows the Pilot warning.
- [ ] Patient generation commits one Patient/Audit pair; the subsequent Intake atomically commits Visit/Observation/Audit, and neither retry duplicates rows.
- [ ] Doctor advances only `WAITING → CONSULTING`; Assistant direct API access is denied.
- [ ] Queue data is shared across browser contexts and survives process/database reopen.
- [ ] Loading, empty, validation, permission, conflict, and unavailable states are covered.
- [ ] Lint, typecheck, unit/integration tests, production build, E2E, and both package regressions pass.
- [ ] Clinical writing and every deferred subsystem remain visibly unavailable, with no fake data writes.

## Deferred Plans

After this milestone is accepted, write and execute separate plans in this order:

1. Clinical Record and Medication Decision.
2. Medication and Inventory Safety.
3. Finance, Close, and Documents.
4. Clinic Operations Hardening, including Caddy/TLS, Windows service packaging, encrypted seven-day backups/restore drill, WAN-off two-device rehearsal, printing evidence, and the 10-Visit acceptance report.

Do not claim that the full Local Pilot or production readiness is complete at the end of this foundation milestone.
