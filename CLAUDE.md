# CLAUDE.md

This file is a map, not a manual. It points to where authoritative information
lives so there is a single source of truth for each topic. When a pointer here
and a linked document disagree, the linked document wins and this file should be
corrected.

## Start here

- **What the project is:** [`README.md`](README.md).
- **The documentation site is the source of truth.** Authoritative, narrative
  docs live under [`apps/docs/src/content/docs/`](apps/docs/src/content/docs/)
  (Astro Starlight). Most questions about _how the system works_ or _how to do
  X_ are answered there. Prefer reading these over inferring from code.
- **System overview & how the pieces fit:**
  [`components/architecture.md`](apps/docs/src/content/docs/components/architecture.md).
- **Glossary:** [`terminology.md`](apps/docs/src/content/docs/terminology.md)
  (note the two meanings of "harness", and the two of "coverage").

## Component docs ↔ code

Every component has an overview (and often deeper pages) under
[`apps/docs/src/content/docs/components/`](apps/docs/src/content/docs/components/).
Read the doc first; the code location is where the implementation lives.

| Component                                                                                                                           | Authoritative doc                                                                                               | Code                         |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Core (headless orchestration; owns the data contracts)                                                                              | [`components/core/`](apps/docs/src/content/docs/components/core/)                                               | `crates/core/`               |
| CLI (`tcab`)                                                                                                                        | [`components/cli/overview.md`](apps/docs/src/content/docs/components/cli/overview.md)                           | `crates/cli/`                |
| Dispatcher (claims queued runs → one driver Job each)                                                                               | [`components/dispatcher/overview.md`](apps/docs/src/content/docs/components/dispatcher/overview.md)             | `crates/dispatcher/`         |
| Driver (per-run-Job executor; streams to the backend)                                                                               | [`components/driver/overview.md`](apps/docs/src/content/docs/components/driver/overview.md)                     | `crates/driver/`             |
| Artifacts (serves produced run trees off a volume)                                                                                  | [`components/artifacts/overview.md`](apps/docs/src/content/docs/components/artifacts/overview.md)               | `crates/artifacts/`          |
| Arena (runs adversarial matches/tournaments — CPU-bound wasm — off the backend)                                                     | [`components/arena/overview.md`](apps/docs/src/content/docs/components/arena/overview.md)                       | `crates/arena/`              |
| Web console                                                                                                                         | [`components/web/overview.md`](apps/docs/src/content/docs/components/web/overview.md)                           | `apps/web/`                  |
| Backend (private def/results server)                                                                                                | [`components/backend/`](apps/docs/src/content/docs/components/backend/)                                         | `crates/backend/`            |
| Site (public static gallery)                                                                                                        | [`components/site/overview.md`](apps/docs/src/content/docs/components/site/overview.md)                         | `apps/site/`                 |
| UI library (`@clockwyrks/ui`)                                                                                                       | [`components/ui/overview.md`](apps/docs/src/content/docs/components/ui/overview.md)                             | `packages/ui/`               |
| Voxel runtime (`@clockwyrks/voxel-runtime` — poses/renders a produced voxel rig; pure-core + three)                                 | [`components/voxel-runtime/overview.md`](apps/docs/src/content/docs/components/voxel-runtime/overview.md)       | `packages/voxel-runtime/`    |
| Particle runtime (`@clockwyrks/particle-runtime` — simulates/renders a produced particle `system.json`; pure-core + three + canvas) | [`components/particle-runtime/overview.md`](apps/docs/src/content/docs/components/particle-runtime/overview.md) | `packages/particle-runtime/` |
| Docs site                                                                                                                           | [`components/docs/overview.md`](apps/docs/src/content/docs/components/docs/overview.md)                         | `apps/docs/`                 |

Other shared packages: `packages/run-record/` (`@clockwyrks/run-record` —
TypeScript types + JSON Schema for the run record contract; see
[`components/core/run-records.md`](apps/docs/src/content/docs/components/core/run-records.md)),
`packages/asset-contract/` (`@clockwyrks/asset-contract` — the rig and F-curve
shapes a produced model is described by, generated alongside `run-record` from the
same Rust types but kept in its own package because the voxel and particle runtimes
depend on it and are vendored into a model's workspace, which `run-record` must
never be; `scripts/ci/seeded-contract-check.sh` is the gate),
`packages/run-stats/` (`@clockwyrks/run-stats` — the framework-free scoring
rules, each mirroring a counterpart in `crates/core/src/review.rs`, plus the
set-level rollup that lets a figure frozen at one moment and the same figure
recomputed later be compared; `packages/ui`'s `ratings` module re-exports the
scoring half alongside its display metadata)
and `packages/browser-driver/` (the Playwright driver the
[validator](apps/docs/src/content/docs/components/core/validation.md) shells out
to).

## Repository layout, building & testing

The canonical repo layout and the build/format/lint/test commands for both the
Cargo and npm workspaces live in
[`development/building.md`](apps/docs/src/content/docs/development/building.md).
Running the services locally on one machine (the development mirror of a
deployment):
[`development/running.md`](apps/docs/src/content/docs/development/running.md).
Releasing the `tcab` binary and the static sites (gallery, docs, per-run builds):
[`development/releasing.md`](apps/docs/src/content/docs/development/releasing.md).
Deploying the always-on services (backend + workers) as remote staging/prod
environments, with runnable templates in [`deployments/`](deployments/):
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
- All commits must use the Conventional Commits format and use imperative form
  for the subject.

## Issue board

[`tasks/`](tasks/) is the issue board — one file per issue, sorted into a
subfolder by area, with completed ones moved into a `done/` folder beside them.
Nothing here is authoritative; when an issue lands, its durable conclusions
belong in `apps/docs/`.

## Definitions & assets

### [Test Cases](test-cases/)

Specification-based tests used to evaluate models. Test cases with runs recorded
against it on production have a `.frozen` marker file added to the folder.
Modifications to test cases with the marker file are refused via a commit hook
and CI. See [`development/frozen-versions.md`](apps/docs/src/content/docs/development/frozen-versions.md).

### [Cold Storage](cold-storage/)

A submodule holding every test-case version's captured baseline validation
media, at the version's own path under `cold-storage/`. Nothing builds or tests
against it, so it is optional; fetch it with
`git submodule update --init --depth 1 cold-storage` to capture or review
baselines. See
[where baselines live](apps/docs/src/content/docs/components/core/validation.md#where-baselines-live).

### [Game Jams](game-jams/)

An alternate form of test case. These are intentionally open-ended and provide
models with a theme to build against rather than a spec.

### [Engines](engines/)

Authored frameworks that provide functionality to models. These are used to both
evaluate how well a model can work with existing code and to avoid
implementations being utterly broken because models fail to account for basic
implementation details.

Engines were introduced in v0.7.0. All non-experimental test cases must support
engines. Test cases should either support the 2D engines or the 3D engines, and
most should support the "none" engine. The "none" engine provides no extra
engine files and is critical for evaluating how well a model does when provided
zero assistance whatsoever.

## Subagents

Unrestricted use of subagents is allowed at all times.

## Workflows

Multi-agent workflows are **authorized standing**, in every session, without the
user asking for one. Do not ask permission first and do not wait to be prompted.
Reach for one whenever the work genuinely suits it; work inline only when it does
not. The bar is low — a task a single edit finishes does not need a workflow, but
most things larger than that do.

Two reasons to run one:

1. **A fresh context window per step.** A strictly sequential chain is a perfectly
   good workflow: each stage starts clean instead of inheriting the accumulated
   noise of the ones before it. _"These steps must happen in order"_ is therefore
   never a reason to skip the workflow and grind through inline — sequential and
   workflow-shaped are not in tension.
2. **Fan-out** — parallel investigation, broad sweeps, adversarial verification.

**Scope is not a reason to hesitate.** A workflow is the right tool for taking a
large, fully scoped piece of work end to end in one go. The work has to be done
either way, and it should be done _correctly_ rather than quickly — so prefer the
thorough decomposition over the one that finishes soonest, and do not trim scope
to make a single pass fit.

**Optimize for how the work gets reviewed.** The user validates by _exercising the
functionality_, not by reading the diff. Two consequences:

- **A large change with a small externally-visible surface is the ideal shape.**
  Do not split or shrink a change to make it easier to read.
- **Code review will not be the thing that catches a defect** — so the gates and
  the verification are load-bearing. Run them (see _Building, testing & the CI
  gates_ and _Verification & the live API key_), build adversarial verification
  into the workflow rather than trusting a single agent's report, and finish by
  telling the user **how to exercise the change** — the route, the command, the
  screen. Report honestly what was and was not verified.

## Changelog

App-level changelogs are located under [`changelogs/`](apps/docs/src/content/docs/changelogs/).
Do not write changelogs except when asked. Changelogs are expected to only be
written immediately prior to creating a release, not continuously over the
course of development.
