# CareFlow Rural Clinic

This repository contains two intentionally separate experiences:

- [`careflow-webapp/`](careflow-webapp/README.md) is the frozen visual/demo prototype. It is useful for design review and remains byte-for-byte unchanged while the pilot is built.
- [`careflow-pilot/`](careflow-pilot/README.md) is the runnable Local Pilot: a single-host Fastify + SQLite + React app with synthetic Patient Intake, shared Queue, append-only Allergy review, Doctor SOAP/diagnosis drafts, and immutable signed synthetic `ORDER` or `NO_MEDICATION` clinical decisions.

Start with the pilot README for the synthetic-only warning, Node 22 setup, migrations, accounts, production start, restart proof, guarded reset, and two-browser rehearsal. The product/design decisions are documented in [`docs/superpowers/specs/2026-08-03-careflow-pilot-design.md`](docs/superpowers/specs/2026-08-03-careflow-pilot-design.md) and the implementation sequencing in [`docs/superpowers/plans/2026-08-03-careflow-local-pilot-foundation.md`](docs/superpowers/plans/2026-08-03-careflow-local-pilot-foundation.md).

The clinical slice is synthetic-only. Inventory, preparation/dispense, finance/payment, Visit close, backup/restore, deployment, HTTPS/Caddy, analytics, and real Patient data are not enabled in this pilot milestone.
