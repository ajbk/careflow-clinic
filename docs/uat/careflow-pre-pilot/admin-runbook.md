# CareFlow Pre-pilot UAT — Administrator Runbook

Use this runbook only for the local, synthetic pre-pilot UAT. Keep the service bound to this computer at `127.0.0.1:3001`; do not expose it to a network or use it for real patient, clinical, or financial data.

## Local setup

Run the following in a local terminal from the repository root. The database path is deliberately separate from the existing pilot database.

```bash
cd careflow-pilot
npm ci
npm test
npm run lint
npm run typecheck
npm run build
install -d -m 700 data/uat
CAREFLOW_DB_PATH="$PWD/data/uat/careflow-uat.sqlite" npm run db:migrate -- "$PWD/data/uat/careflow-uat.sqlite"
CAREFLOW_DB_PATH="$PWD/data/uat/careflow-uat.sqlite" npm run users -- create --username uat-assistant --display-name "ผู้ช่วย UAT" --role assistant
CAREFLOW_DB_PATH="$PWD/data/uat/careflow-uat.sqlite" npm run users -- create --username uat-doctor --display-name "แพทย์ UAT" --role doctor
CAREFLOW_DB_PATH="$PWD/data/uat/careflow-uat.sqlite" CAREFLOW_HOST=127.0.0.1 CAREFLOW_PORT=3001 CAREFLOW_COOKIE_SECURE=false npm start
curl -fsS http://127.0.0.1:3001/api/health
```

The host command stays open in the foreground. Once it is listening, keep that terminal open and run the health command in a second local terminal.

Each account-creation command is interactive. Type `SYNTHETIC-ONLY` when prompted, then enter the password twice locally. The password must be 12–128 characters. Do not put a password in this runbook, a shell history, a ticket, or chat.

## Normal shutdown, restart, and health check

`Ctrl-C` in the foreground host terminal is the normal shutdown procedure. For a planned restart or after an interrupted UAT session, use this order:

1. Stop the local host with `Ctrl-C`.
2. Confirm port `3001` is free before starting anything again. For example, `lsof -nP -iTCP:3001 -sTCP:LISTEN` must show no listener for the stopped CareFlow host.
3. Restart with the same UAT database path and loopback-only settings:

   ```bash
   cd careflow-pilot
   CAREFLOW_DB_PATH="$PWD/data/uat/careflow-uat.sqlite" CAREFLOW_HOST=127.0.0.1 CAREFLOW_PORT=3001 CAREFLOW_COOKIE_SECURE=false npm start
   ```

4. In a second local terminal, check the health endpoint:

   ```bash
   curl -fsS http://127.0.0.1:3001/api/health
   ```

5. Only after the health check succeeds, ask the tester to reload their browser windows and continue the checklist from the recorded checkpoint.

## Lock recovery and preservation

If the host reports `.careflow-running`, do not assume it is stale. First verify that no CareFlow process is still running and that port `3001` has no listener. Record that verification before classifying the exact UAT lock directory as stale.

Never delete the UAT SQLite file, its WAL or SHM sidecars, or the old database during lock recovery. Do not use reset or deletion as a lock-recovery shortcut. Any reset or deletion requires a separate explicit user instruction after UAT results have been recorded. If a verified stale `.careflow-running` directory still needs intervention, stop and obtain that instruction before touching it.

## Handoff to the tester

After the health check, give the tester these three documents:

- [Thai tester guide](guide-th.md)
- [Result checklist](checklist.md)
- This administrator runbook

Keep the UAT database path unchanged for the entire run so the restart evidence and tester results remain together.
