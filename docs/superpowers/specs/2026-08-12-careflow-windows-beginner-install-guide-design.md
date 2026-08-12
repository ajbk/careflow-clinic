# CareFlow Windows Beginner Installation Guide Design

**Date:** 2026-08-12

**Status:** Approved direction; implementation pending user review of this written spec

**Audience:** A first-time Windows 11 UAT operator with limited Git, PowerShell, and Node.js experience

## Objective

Create a standalone Thai installation guide that takes a user from an unverified Windows 11 machine to a working loopback-only CareFlow synthetic UAT host. Completion means the operator can sign in successfully as both approved UAT roles using separate browser profiles.

The guide supplements rather than replaces the authoritative administrator runbook. It translates the validated Windows procedure into small, observable checkpoints without weakening its security or fail-closed behavior.

## Deliverables

1. `docs/uat/careflow-pre-pilot/windows-install-guide-th.md`
   - Primary, version-controlled source.
   - Easy to read directly on GitHub.
   - Links to the administrator runbook, UAT Journey guide, and checklist.
2. `output/pdf/careflow-windows-install-guide-th.pdf`
   - A4 offline/printable rendering of the same procedure.
   - Includes page numbers, section headers, legible PowerShell blocks, and visible warning/checkpoint boxes.

The Markdown and PDF must describe the same commands, expected outcomes, stop conditions, and final handoff.

## Scope

The guide covers:

1. Opening non-administrator PowerShell.
2. Checking Windows 11, 64-bit architecture, PowerShell, Node.js 22, Git, NTFS, and the intended local path.
3. Selecting a local NTFS folder outside OneDrive, network drives, WSL, symlinks, and junctions.
4. Cloning `https://github.com/ajbk/careflow-clinic.git` and confirming the expected `main` branch and repository state.
5. Installing dependencies with lifecycle scripts disabled and verifying the native runtime.
6. Running tests, lint, typecheck, and production build sequentially.
7. Creating a fresh `careflow-pilot\data\uat` directory with the exact protected ACL required by the administrator runbook.
8. Migrating the exact `careflow-uat.sqlite` database.
9. Creating only `uat-assistant` and `uat-doctor` through hidden interactive password prompts before host startup.
10. Starting CareFlow on `127.0.0.1:3001`, checking health, and completing the first sign-in flow in two separate browser profiles.

After the ten checkpoints, the guide explains how to stop the host safely and links to the separate five-scenario UAT guide.

The guide does not cover deployment, Windows services, network access, HTTPS, backups, restoration, upgrades, real patient data, real clinical use, or real financial use.

## Information Architecture

The document opens with a prominent synthetic-only and loopback-only warning, followed by a short vocabulary box explaining PowerShell, repository, clone, dependency, database migration, host, browser profile, and UAT.

The installation is divided into ten numbered checkpoints. Every checkpoint uses the same pattern:

1. **Goal** - what this checkpoint establishes.
2. **Action** - one exact command block or a short Windows UI action.
3. **Expected result** - the output or screen the operator must observe.
4. **If it does not match** - stop instructions that do not guess, weaken permissions, or delete evidence.
5. **Record** - the small piece of non-secret evidence to retain when relevant.

Long PowerShell sequences remain copyable as complete blocks. The guide explains where to paste each block and explicitly distinguishes normal PowerShell, the host PowerShell window, the health-check PowerShell window, and the two browser profiles.

## Safety and Privacy Rules

- Run under a dedicated non-administrator Windows account.
- Use a local NTFS checkout and database only.
- Bind only to `127.0.0.1`; never expose port 3001 to a network.
- Use synthetic data only.
- Never place passwords in command arguments, environment variables, files, screenshots, tickets, clipboard examples, or documentation.
- Create exactly the two approved UAT accounts and do not repeat successful creation commands.
- Treat native-runtime, ACL, migration, test, health, and first-login failures as `BLOCKED`; do not install compilers, relax ACLs, reset the database, or improvise a repair.
- Preserve the existing mandatory-stop rules and direct the operator to the administrator runbook for controlled recovery.

## PDF Presentation

The PDF uses A4 portrait pages with Thai-capable embedded fonts, generous margins, a clear title page, a compact contents section, numbered checkpoints, shaded callouts, and monospaced code blocks that wrap without clipping. Headers identify the guide as `SYNTHETIC UAT ONLY`; footers contain page numbers and the source revision.

The PDF will be rendered to PNG images and inspected page by page. Acceptance requires no clipped commands, overlapping text, missing Thai glyphs, broken page transitions, black glyph boxes, or unreadably small code.

## Verification and Acceptance

Before publication:

1. Compare every operational command with the current administrator runbook.
2. Confirm every required checkpoint, expected result, and stop condition is present in both outputs.
3. Scan both deliverables for credentials, placeholder text, real-data instructions, network exposure, and unsupported deployment language.
4. Check all Markdown links and run `git diff --check`.
5. Extract PDF text for completeness checks, render every page, and inspect the rendered images visually.
6. Confirm only intended documentation, PDF, and generation-support files are staged.

Success is a beginner-readable guide that remains operationally equivalent to the tested Windows runbook and ends with both UAT roles successfully signed in on the loopback host.

## Publishing

After final verification, commit the guide and PDF on `codex/windows-install-guide`, push the branch, and make the GitHub links available to the operator. Integration into `main` remains a separate reviewed GitHub step.
