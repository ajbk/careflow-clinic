# CareFlow Pre-pilot UAT — Local Administrator Runbook

This runbook is for one local, synthetic UAT host only. Bind the service to `127.0.0.1`; do not expose it to a network. Deployment, backup/restore, real-data use, real clinical use, and real financial use are explicitly disabled.

Give testers the [Thai Journey guide](guide-th.md) and [result checklist](checklist.md). The local UAT owner prepares the two approved role sessions outside these documents; do not record or share any sign-in material in Markdown, tickets, screenshots, terminal history, or logs.

## Prepare the isolated UAT database

From the repository's `careflow-pilot` directory, use a new local database path that is not an existing pilot database. Do not point any command at a real or prior UAT database.

```bash
npm ci
npm test
npm run lint
npm run typecheck
npm run build
install -d -m 700 data/uat
CAREFLOW_DB_PATH="$PWD/data/uat/careflow-uat.sqlite" npm run db:migrate -- "$PWD/data/uat/careflow-uat.sqlite"
CAREFLOW_DB_PATH="$PWD/data/uat/careflow-uat.sqlite" CAREFLOW_HOST=127.0.0.1 CAREFLOW_PORT=3001 CAREFLOW_COOKIE_SECURE=false npm start
```

In another local terminal, verify only the loopback health endpoint:

```bash
curl -fsS http://127.0.0.1:3001/api/health
```

Record the exact database path in the checklist. Keep the same path for every planned restart so the restart evidence remains testable.

## Mandatory-stop handling

The following stop the **entire** UAT, not just one scenario: HTTP 500, cross-role clinical disclosure, negative stock, wrong Baht total, invalid Closure, or loss/change of committed evidence after restart.

When any occurs:

1. Stop the local host with `Ctrl-C` if it is running.
2. Preserve the UAT SQLite file and its WAL/SHM sidecars exactly as they are.
3. Mark the event `STOP` in the checklist, including time, synthetic HN, visible state, and the screen/route.
4. Do not retry, reset, repair data, deploy, create a backup, or resume another scenario.
5. Escalate for explicit direction.

## Planned restart checkpoint

Only use this for the planned restart steps in the guide and only when no mandatory-stop event occurred.

1. Stop the local host with `Ctrl-C`.
2. Confirm the host is not still listening:

   ```bash
   lsof -nP -iTCP:3001 -sTCP:LISTEN
   ```

3. Restart using the exact same local database path and loopback settings:

   ```bash
   cd careflow-pilot
   CAREFLOW_DB_PATH="$PWD/data/uat/careflow-uat.sqlite" CAREFLOW_HOST=127.0.0.1 CAREFLOW_PORT=3001 CAREFLOW_COOKIE_SECURE=false npm start
   ```

4. Verify `curl -fsS http://127.0.0.1:3001/api/health` succeeds.
5. Ask the tester to reload the existing browser windows and compare the visible Journey, Allergy, stock, Charge/collection, Closure, and Doctor OPD evidence with the checklist checkpoint. A mismatch is a mandatory stop.

## Lock recovery is read-only until directed otherwise

If the host reports an existing running lock, first check only whether the UAT host or UAT database is in use:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
lsof -nP "$PWD/data/uat/careflow-uat.sqlite"
```

Record the result. Do not delete a SQLite file, WAL, SHM, lock, or UAT directory. Do not use reset as lock recovery. Any destructive action requires separate explicit direction after the UAT result is preserved.

## End of UAT

If and only if the checklist has no mandatory-stop event, stop the local host normally and retain the local synthetic UAT result for review. The database is evidence for this local rehearsal only; it is not a production artifact, deployment input, or backup.
