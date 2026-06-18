# CLAUDE.md

This file is a **map**, not a manual. It points to where authoritative
information lives so there is a single source of truth for each topic. When a
pointer here and a linked document disagree, the linked document wins — and this
file should be corrected.

## Start here

- **What the project is:** [`README.md`](README.md).
- **The documentation site is the source of truth.** Authoritative, narrative
  docs live under [`apps/docs/src/content/docs/`](apps/docs/src/content/docs/)
  (Astro Starlight). Most questions about *how the system works* or *how to do
  X* are answered there. Prefer reading these over inferring from code.
- **System overview & how the pieces fit:**
  [`components/architecture.md`](apps/docs/src/content/docs/components/architecture.md).
- **Glossary:** [`terminology.md`](apps/docs/src/content/docs/terminology.md)
  (note the two meanings of "harness").

## Component docs ↔ code

Every component has an overview (and often deeper pages) under
[`apps/docs/src/content/docs/components/`](apps/docs/src/content/docs/components/).
Read the doc first; the code location is where the implementation lives.

| Component | Authoritative doc | Code |
| --- | --- | --- |
| Core (headless orchestration; owns the data contracts) | [`components/core/`](apps/docs/src/content/docs/components/core/) | `crates/core/` |
| CLI (`tcab`) | [`components/cli/overview.md`](apps/docs/src/content/docs/components/cli/overview.md) | `crates/cli/` |
| Worker (HTTP run server) | [`components/worker/overview.md`](apps/docs/src/content/docs/components/worker/overview.md) | `crates/worker/` |
| Tauri desktop app | [`components/tauri/overview.md`](apps/docs/src/content/docs/components/tauri/overview.md) | `crates/desktop/` (Rust shell) + `apps/desktop/` (React UI) |
| Web console | [`components/web/overview.md`](apps/docs/src/content/docs/components/web/overview.md) | `apps/web/` |
| Backend (private def/results server) | [`components/backend/`](apps/docs/src/content/docs/components/backend/) | `crates/backend/` |
| Site (public static gallery) | [`components/site/overview.md`](apps/docs/src/content/docs/components/site/overview.md) | `apps/site/` |
| UI library (`@test-cabinet/ui`) | [`components/ui/overview.md`](apps/docs/src/content/docs/components/ui/overview.md) | `packages/ui/` |
| Docs site | [`components/docs/overview.md`](apps/docs/src/content/docs/components/docs/overview.md) | `apps/docs/` |

**Naming gotcha:** the docs call the desktop app the **Tauri app** and the
browser runner/reporter the **web console**, but on disk the desktop crate is
`crates/desktop` and the desktop UI is `apps/desktop`. Don't go looking for a
`tauri` directory.

Other shared packages: `packages/run-record/` (`@test-cabinet/run-record` —
TypeScript types + JSON Schema for the run record contract; see
[`components/core/run-records.md`](apps/docs/src/content/docs/components/core/run-records.md))
and `packages/browser-driver/` (the Playwright driver the
[validator](apps/docs/src/content/docs/components/core/validation.md) shells out
to).

## Repository layout, building & testing

The canonical repo layout and the build/format/lint/test commands for both the
Cargo and npm workspaces live in
[`development/building.md`](apps/docs/src/content/docs/development/building.md).
Releasing and deployment:
[`development/releasing.md`](apps/docs/src/content/docs/development/releasing.md).
Do not duplicate these commands here.

## Doing things (guides & quickstarts)

Task-oriented walkthroughs:

- Quickstarts (short, copy-paste paths):
  [`quickstarts/`](apps/docs/src/content/docs/quickstarts/) — run a test case,
  author a test case, create a variant, publish a run, review a run.
- Longer guides:
  [`guides/`](apps/docs/src/content/docs/guides/) — including
  [first-time setup](apps/docs/src/content/docs/guides/first-time-setup.md) for a
  machine that will actually run test cases (container runtime, harness images,
  credentials).

## Working in this repo (skills)

When working on the tasks below, read the matching skill in
[`.claude/skills/`](.claude/skills/) first — these define the repo's policies and
authoring conventions:

- **Writing code:** [`coding`](.claude/skills/coding/SKILL.md).
- **Creating/revising a test case:**
  [`authoring-a-test-case`](.claude/skills/authoring-a-test-case/SKILL.md).
- **Adding a variant to an existing case:**
  [`adding-a-variant`](.claude/skills/adding-a-variant/SKILL.md).

## Definitions & assets

- **Test cases:** [`test-cases/`](test-cases/) — each case is versioned
  (e.g. `test-cases/pong/v1.0.0/`) with its `test-case.toml` manifest, specs,
  prompt, and reference mockups. The manifest format is documented at
  [`components/core/test-cases.md`](apps/docs/src/content/docs/components/core/test-cases.md).
- **Models:** [`models/`](models/) — one `<model>.toml` + `<model>.md` per
  model. Add with `scripts/add-model.mjs`.
- **Harness container images:** [`containers/`](containers/) — see
  [`containers/README.md`](containers/README.md) and
  [`components/core/harnesses.md`](apps/docs/src/content/docs/components/core/harnesses.md).

## Changelog

Released-version notes:
[`changelogs/`](apps/docs/src/content/docs/changelogs/).
