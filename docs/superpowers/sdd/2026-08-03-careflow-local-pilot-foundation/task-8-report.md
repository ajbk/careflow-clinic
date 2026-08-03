# Task 8 implementation report — connected synthetic Patient Intake

## Delivered

- Connected `/intake` to the existing CareFlow shell and frozen visual hierarchy without modifying `careflow-webapp/**`.
- Added server-authoritative Patient search with a 250 ms debounce, minimum two-character query, React Query cancellation via `AbortSignal`, and result rendering for HN, synthetic name, generated age, and sex.
- Added synthetic Patient generation with a strict empty `{}` command payload and one immutable idempotency attempt per generation retry.
- Added the connected Intake form with chief complaint and seven nullable vital fields. Empty optional fields become `null`, never `0`.
- Added immutable Intake command attempts containing the selected Patient revision. Retries reuse the same idempotency key and preserve the selected Patient/draft.
- Added 422 field mapping and first-invalid focus, `ACTIVE_VISIT_EXISTS` Queue recovery, unavailable/503 messaging with explicit retry, and post-commit query invalidation/navigation.
- Added focused MSW journey coverage for existing Patient selection, synthetic generation, retry/idempotency, validation focus, active Visit recovery, deferred commit, and no browser-storage authority.

## Verification

- `npm run test:client -- tests/client/intake.test.tsx` — 6/6
- `npm run test:client` — 27/27
- `npm test` — 129/129
- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm run build` — pass
- `git diff --exit-code -- careflow-webapp` — pass

