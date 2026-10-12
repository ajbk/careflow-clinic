# CareFlow Rural Clinic

## Primary repository

[ajbk/careflow-clinic](https://github.com/ajbk/careflow-clinic) is the primary repository for CareFlow. Use this same repository for development and handoff on both macOS and Windows; local checkouts should point `origin` to it.

`main` contains merged work. Changes on a working branch are not part of `main` until they are merged. Keep local databases, patient data, passwords, and environment files out of Git.

## Continue on Windows

Start with the [Thai clinic Windows handoff](docs/handoff/clinic-windows-start-here-th.md) and its linked production-trial design. The handoff branch is `codex/uat-stability-fixes`, not `main`. This is a readiness/design handoff: real-patient use, deployment, and legacy-data import are not yet approved or implemented.

## Project contents

This repository contains two intentionally separate experiences:

- [`careflow-webapp/`](careflow-webapp/README.md) is the frozen visual/demo prototype. It is useful for design review and remains byte-for-byte unchanged while the pilot is built.
- [`careflow-pilot/`](careflow-pilot/README.md) is the runnable Local Pilot: a single-host Fastify + SQLite + React app with synthetic Patient Intake, shared Queue, append-only Allergy review, Doctor SOAP/diagnosis drafts, immutable signed synthetic `ORDER` or `NO_MEDICATION` decisions, inventory, medication preparation/release/handoff, Charge collection, Visit closure, and a Doctor-only OPD Card.

Start with the pilot README for the synthetic-only warning, Node 22 setup, migrations, accounts, production start, restart proof, guarded reset, and two-browser rehearsal. The product/design decisions are documented in [`docs/superpowers/specs/2026-08-03-careflow-pilot-design.md`](docs/superpowers/specs/2026-08-03-careflow-pilot-design.md) and the implementation sequencing in [`docs/superpowers/plans/2026-08-03-careflow-local-pilot-foundation.md`](docs/superpowers/plans/2026-08-03-careflow-local-pilot-foundation.md).

The complete workflow is available for synthetic-only rehearsal. The provider-independent cloud foundation adds a strict HTTPS proxy boundary, command recovery and synthetic backup/restore drills. A live provider, remote backup storage, deployment, analytics, bank integration, receipts/tax, and real Patient data remain gated. See the [cloud foundation runbook](docs/operations/cloud-foundation.md). See the [Thai UAT guide](docs/uat/careflow-pre-pilot/guide-th.md) and [stability handoff](docs/uat/careflow-pre-pilot/stability-handoff-th.md) before testing at a clinic.
