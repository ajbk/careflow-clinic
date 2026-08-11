# CareFlow Pre-pilot UAT — Local Administrator Runbook

This runbook is for one local, synthetic UAT host only. Bind the service to `127.0.0.1`; do not expose it to a network. Deployment, backup/restore, real-data use, real clinical use, and real financial use are explicitly disabled.

Give testers the [Thai Journey guide](guide-th.md) and [result checklist](checklist.md). The local UAT owner provisions exactly the two approved role accounts with the safe interactive command below. Do not record or share any sign-in material in Markdown, tickets, screenshots, terminal history, or logs.

## Prepare the isolated UAT database

From the repository's `careflow-pilot` directory, use a new local database path that is not an existing pilot database. Do not point any command at a real or prior UAT database. Complete the account-provisioning section **before** starting the host.

```bash
npm ci
npm test
npm run lint
npm run typecheck
npm run build
install -d -m 700 data/uat
CAREFLOW_DB_PATH="$PWD/data/uat/careflow-uat.sqlite" npm run db:migrate -- "$PWD/data/uat/careflow-uat.sqlite"
```

## Provision the only two UAT accounts before host startup

On the clean migrated UAT file above, run these two commands exactly once, in order. They create exactly `uat-assistant` with Assistant role and `uat-doctor` with Doctor role; no migration or application source contains either account or a password.

```bash
CAREFLOW_DB_PATH="$PWD/data/uat/careflow-uat.sqlite" npm run users -- create --username uat-assistant --display-name Assistant --role assistant
CAREFLOW_DB_PATH="$PWD/data/uat/careflow-uat.sqlite" npm run users -- create --username uat-doctor --display-name Doctor --role doctor
```

Each command prints the synthetic-only warning, requires an exact `SYNTHETIC-ONLY` acknowledgement, then asks for `New password` and `Confirm new password` using hidden terminal input. Use a local interactive TTY; do not place passwords in command arguments, environment variables, files, paste buffers, shell history, logs, tickets, screenshots, or this runbook. A successful invocation ends with `User account command completed`; a failure must be treated as provisioning failure, not retried with a different database. Do not create any other account or repeat either create command.

Now start the host using the same database path and loopback-only settings:

```bash
CAREFLOW_DB_PATH="$PWD/data/uat/careflow-uat.sqlite" CAREFLOW_HOST=127.0.0.1 CAREFLOW_PORT=3001 CAREFLOW_COOKIE_SECURE=false npm start
```

In another local terminal, verify only the loopback health endpoint:

```bash
curl -fsS http://127.0.0.1:3001/api/health
```

Record the exact database path in the checklist. Keep the same path for every planned restart and every Scenario; do not reset it or make a new database between Scenarios. Verify provisioning through two separate browser profiles: sign in once as `uat-assistant` and once as `uat-doctor`, accept the Pilot acknowledgement, then change each initial password in the displayed first-login flow. Confirm the Assistant lands in the Assistant workspace and the Doctor lands in the Doctor workspace. This verifies the expected role-correct sessions while keeping credentials out of every record. For Scenario 5, retain exactly one active `uat-doctor` browser session; the guide and expiry checkpoint enforce that invariant.

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

## Controlled Doctor session-expiry checkpoint

Use this only for Scenario 5 / `S-02`, only after no mandatory-stop event, and only on the exact local synthetic UAT file `data/uat/careflow-uat.sqlite`. It has no patient input and accepts no sign-in material. It targets only the sole active `uat-doctor` session by changing its `expires_at` timestamp to the past; it does not delete or revoke a session and does not touch the Assistant session.

Before running it:

1. The Doctor must be the named `uat-doctor`, have exactly one active browser session, and be paused on the existing synthetic Visit. Do not open another Doctor session. Keep the Assistant session available for `S-03`.
2. Stop the local host with `Ctrl-C` and confirm it is not listening with `lsof -nP -iTCP:3001 -sTCP:LISTEN`.
3. From the repository's `careflow-pilot` directory, run exactly:

   ```bash
   npm run expire:uat-doctor-session -- --database "$PWD/data/uat/careflow-uat.sqlite" --confirm EXPIRE-UAT-DOCTOR-SESSION
   ```

4. A successful command ends with `Doctor UAT session timestamp expired`. Restart the same host/path using the command in the planned restart checkpoint, then have the Doctor reload the same Consultation page.

Expected observable result: the server returns a true elapsed session, the browser goes to local sign-in, and after the approved local sign-in flow it returns to the original Consultation route once with `เซสชันหมดอายุ งานยังไม่ได้ถูกบันทึก`. The unsaved SOAP text is absent; the previously committed Intake/Allergy evidence remains.

The command fails closed without writing when the path is not the exact UAT filename, the host is running, the file is not the known synthetic CareFlow UAT database, or there are zero/multiple/other Doctor sessions. If it fails, mark `S-02` BLOCKED, preserve the files, and escalate. Do not choose a different database, remove locks, reset, delete, revoke, or retry around the guard.

## Lock recovery is read-only until directed otherwise

If the host reports an existing running lock, first check only whether the UAT host or UAT database is in use:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
lsof -nP "$PWD/data/uat/careflow-uat.sqlite"
```

Record the result. Do not delete a SQLite file, WAL, SHM, lock, or UAT directory. Do not use reset as lock recovery. Any destructive action requires separate explicit direction after the UAT result is preserved.

## End of UAT

If and only if the checklist has no mandatory-stop event, stop the local host normally and retain the local synthetic UAT result for review. The database is evidence for this local rehearsal only; it is not a production artifact, deployment input, or backup.
