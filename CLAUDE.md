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
| Dispatcher (claims queued runs → one driver Job each) | [`components/dispatcher/overview.md`](apps/docs/src/content/docs/components/dispatcher/overview.md) | `crates/dispatcher/` |
| Driver (per-run-Job executor; streams to the backend) | [`components/driver/overview.md`](apps/docs/src/content/docs/components/driver/overview.md) | `crates/driver/` |
| Artifacts (serves produced run trees off a volume) | [`components/artifacts/overview.md`](apps/docs/src/content/docs/components/artifacts/overview.md) | `crates/artifacts/` |
| Arena (runs adversarial matches/tournaments — CPU-bound wasm — off the backend) | [`components/arena/overview.md`](apps/docs/src/content/docs/components/arena/overview.md) | `crates/arena/` |
| Tauri desktop app | [`components/tauri/overview.md`](apps/docs/src/content/docs/components/tauri/overview.md) | `crates/desktop/` (Rust shell) + `apps/desktop/` (React UI) |
| Web console | [`components/web/overview.md`](apps/docs/src/content/docs/components/web/overview.md) | `apps/web/` |
| Backend (private def/results server) | [`components/backend/`](apps/docs/src/content/docs/components/backend/) | `crates/backend/` |
| Site (public gallery) | [`components/site/`](apps/docs/src/content/docs/components/site/) | `apps/site/` |
| UI library (`@test-cabinet/ui`) | [`components/ui/overview.md`](apps/docs/src/content/docs/components/ui/overview.md) | `packages/ui/` |
| Voxel runtime (`@test-cabinet/voxel-runtime` — poses/renders a produced voxel rig; pure-core + three) | [`components/voxel-runtime/overview.md`](apps/docs/src/content/docs/components/voxel-runtime/overview.md) | `packages/voxel-runtime/` |
| Particle runtime (`@test-cabinet/particle-runtime` — simulates/renders a produced particle `system.json`; pure-core + three + canvas) | [`components/particle-runtime/overview.md`](apps/docs/src/content/docs/components/particle-runtime/overview.md) | `packages/particle-runtime/` |
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

**Adversarial (Foray) crates:** the [adversarial](apps/docs/src/content/docs/testing/adversarial/)
test type's engine and host live in their own crates under `crates/`, documented
in the case's
[architecture doc](apps/docs/src/content/docs/testing/adversarial/foray/architecture.md):
`foray-core/` (the authoritative rules engine; compiles natively *and* to
`wasm32-unknown-unknown` for browser replay playback), `foray-host/` (the reusable
`wasmtime` host — the per-tick controller loop + fuel/memory sandbox — reused by
both the CLI and `core`'s `AdversarialValidator`), `foray-cli/` (the `foray`
binary), `foray-controller-sdk/` (the controller-authoring SDK), and the three
`foray-ref-*/` baseline controllers.

## Repository layout, building & testing

The canonical repo layout and the build/format/lint/test commands for both the
Cargo and npm workspaces live in
[`development/building.md`](apps/docs/src/content/docs/development/building.md).
Running the services locally on one machine (the development mirror of a
deployment):
[`development/running.md`](apps/docs/src/content/docs/development/running.md).
Releasing the `tcab` binary and the static sites (docs, per-run builds):
[`development/releasing.md`](apps/docs/src/content/docs/development/releasing.md).
Deploying the always-on **services** (backend + workers) as **remote**
staging/prod environments — with runnable templates in
[`deployments/`](deployments/):
[`deployment/`](apps/docs/src/content/docs/deployment/).
Telemetry/observability (opt-in OpenTelemetry, the local Grafana LGTM stack, and
prod config):
[`development/observability.md`](apps/docs/src/content/docs/development/observability.md).
Do not duplicate these commands here.

## Doing things (guides & quickstarts)

Task-oriented walkthroughs:

- Quickstarts (short, copy-paste paths):
  [`quickstarts/`](apps/docs/src/content/docs/quickstarts/) — run a test case,
  author a test case, create a variant, publish a run, review a run.
- Longer guides:
  [`guides/`](apps/docs/src/content/docs/guides/) — including
  [first-time setup](apps/docs/src/content/docs/guides/setup/first-time-setup.md) for a
  machine that will actually run test cases (container runtime, run-container
  image, credentials).

## Working in this repo (skills)

- **Writing code:** read the [`coding`](.claude/skills/coding/SKILL.md) skill
  first — it defines the repo's code policies.
- **Authoring or revising a test case, or adding a variant:** the procedures now
  live in the documentation site (so they serve developers browsing the Starlight
  site *and* agents), not in per-task skills. Read the
  [`authoring-test-cases`](.claude/skills/authoring-test-cases/SKILL.md) skill,
  which points to the right
  [quickstart](apps/docs/src/content/docs/quickstarts/) and
  [user guide](apps/docs/src/content/docs/guides/) for the test type and
  [`asset_kind`](apps/docs/src/content/docs/testing/asset-generation/manifests/overview.md)
  you are working on. The [`testing/`](apps/docs/src/content/docs/testing/) pages
  remain authoritative for what each manifest field means.

## Definitions & assets

- **Test cases:** [`test-cases/`](test-cases/) — organized by two grouping
  levels, the test **type** and **difficulty**, then the case slug and version
  (e.g. `test-cases/end-to-end/easy/carom/v1.0.0/`) with its `test-case.toml`
  manifest, specs, prompt, and reference mockups. The grouping directories are
  organizational only; a case's identity, type, and difficulty come from its
  manifest. **A version directory that has runs recorded against it is frozen**
  (a `.frozen` marker; a commit hook and CI reject any change to it) — to revise
  a case, add a new version, never edit one that has been run. See
  [`development/frozen-versions.md`](apps/docs/src/content/docs/development/frozen-versions.md).
  The test types and their manifest formats are
  documented under
  [`testing/`](apps/docs/src/content/docs/testing/) — today's cases are the
  [end-to-end](apps/docs/src/content/docs/testing/end-to-end/) type, whose
  manifest format is at
  [`testing/end-to-end/manifests.md`](apps/docs/src/content/docs/testing/end-to-end/manifests.md).
- **Game jams:** [`game-jams/`](game-jams/) — a sibling top-level folder (laid out
  `game-jams/<slug>/<version>/`, no type/difficulty grouping) holding
  [game-jam](apps/docs/src/content/docs/testing/game-jam/overview.md) cases:
  full-stack-style builds given only a **theme** (no spec, no reference mockups) and
  reviewed on a **graded** category scale (💩→💎) rather than pass/fail. A jam is
  **not** a test case: it is authored through its own `game-jam.toml`
  ([manifest format](apps/docs/src/content/docs/testing/game-jam/manifests.md)), which
  has **no `difficulty`** (a jam is unclassified) and **no `variants`** (a jam is one
  theme), and it runs in its **own** image (`test-cabinet-game-jam`, Rust+wasm+`date`,
  overridable via `TCAB_CONTAINER_IMAGE_GAME_JAM`). Discovery folds this folder into
  the same catalog as `test-cases/`, and they surface on the console's
  **Other → Game Jams** section, not the Test Cases page.
- **Models:** the model catalog is **owned by the backend** (SeaORM `model` /
  `model_alias` / `model_price` tables), served at `GET /models`, and baked into
  the public R2 snapshot as `models.json`. There is no `models/` directory. Any
  model with a recorded run appears automatically (derived); curated models
  (display name, aliases, provider, svgl logo, description, OpenRouter slug) are
  edited **in the app** (web console / desktop Models section, requires sign-in) —
  no `tcab catalog`, `scripts/add-model.mjs`, or recompile. The steps are in
  [`quickstarts/add-or-update-a-model.md`](apps/docs/src/content/docs/quickstarts/devops/add-or-update-a-model.md)
  (and the fuller
  [`guides/adding-or-updating-a-model.md`](apps/docs/src/content/docs/guides/devops/adding-or-updating-a-model.md)).
- **Harnesses:** [`harnesses/`](harnesses/) — one `harness.toml` per harness
  (`harnesses/<slug>/`) declaring its name, CLI binary, and the command that
  installs the CLI into the run container at run time. See
  [`harnesses/README.md`](harnesses/README.md) and
  [`components/core/harnesses.md`](apps/docs/src/content/docs/components/core/harnesses.md).
- **Orchestrators:** [`orchestrators/`](orchestrators/) — one `orchestrator.toml`
  + a runner script per built-in (`orchestrators/<slug>/`), the data-driven,
  externally-extensible strategy that decides how a run's harness sessions are
  conducted (today just the single-session `one-shot`; a multi-session strategy
  can be supplied externally). See
  [`orchestrators/README.md`](orchestrators/README.md) and the contract doc
  [`components/core/orchestrators.md`](apps/docs/src/content/docs/components/core/orchestrators.md).
- **Run-container image:** [`containers/`](containers/) — the single shared base
  image every run executes in (harnesses install into it at run time). See
  [`containers/README.md`](containers/README.md).
  
## Subagents

Unrestricted use of subagents is allowed at all times.

## Workflows

Multi-agent workflows are **authorized standing**, in every session, without the
user asking for one. Do not ask permission first and do not wait to be prompted.
Reach for one whenever the work genuinely suits it; work inline only when it does
not. The bar is low — a task a single edit finishes does not need a workflow, but
most things larger than that do.

**Two reasons to run one, and parallelism is only the second.**

1. **A fresh context window per step.** A strictly sequential chain is a perfectly
   good workflow: each stage starts clean instead of inheriting the accumulated
   noise of the ones before it. *"These steps must happen in order"* is therefore
   never a reason to skip the workflow and grind through inline — sequential and
   workflow-shaped are not in tension.
2. **Fan-out** — parallel investigation, broad sweeps, adversarial verification.

**Scope is not a reason to hesitate.** A workflow is the right tool for taking a
large, fully scoped piece of work end to end in one go. The work has to be done
either way, and it should be done *correctly* rather than quickly — so prefer the
thorough decomposition over the one that finishes soonest, and do not trim scope
to make a single pass fit.

**Optimize for how the work gets reviewed.** The user validates by *exercising the
functionality*, not by reading the diff. Two consequences:

- **A large change with a small externally-visible surface is the ideal shape.**
  Do not split or shrink a change to make it easier to read.
- **Code review will not be the thing that catches a defect** — so the gates and
  the verification are load-bearing. Run them (see *Building, testing & the CI
  gates* and *Verification & the live API key*), build adversarial verification
  into the workflow rather than trusting a single agent's report, and finish by
  telling the user **how to exercise the change** — the route, the command, the
  screen. Report honestly what was and was not verified.

## Changelog

Released-version notes:
[`changelogs/`](apps/docs/src/content/docs/changelogs/).
