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

## Fix follow-up

- Draft edits now invalidate the main Intake attempt and clear the explicit retry control, so a corrected form creates a new payload/key while an untouched retry replays the original attempt.
- Generating a different synthetic Patient clears stale Intake attempts and validation state, including when the prior draft was empty.
- Patient search/selection is locked during synthetic generation and Intake submission to prevent late responses from overwriting an intentional selection.
- Focused Intake coverage now includes these attempt-boundary and pending-mutation races (10/10 focused tests).
