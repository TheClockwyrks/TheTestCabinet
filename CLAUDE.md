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
| Contracts (the shapes more than one party reads or writes; core re-exports them)                                                    | [`components/core/overview.md`](apps/docs/src/content/docs/components/core/overview.md#the-contracts-crate)     | `crates/contracts/`          |
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
never be; the `seeded-contract` gate keeps it that way),
`packages/run-stats/` (`@clockwyrks/run-stats` — the framework-free scoring
rules, each mirroring a counterpart in `crates/core/src/review.rs`, plus the
set-level rollup that lets a figure frozen at one moment and the same figure
recomputed later be compared; `packages/ui`'s `ratings` module re-exports the
scoring half alongside its display metadata)
and `packages/browser-driver/` (the Playwright driver the
[validator](apps/docs/src/content/docs/components/core/validation.md) shells out
to).

## Workspace template

This repository is rendered from the k8s standard workspace template, a
[copier](https://copier.readthedocs.io) template.
[`.copier-answers.yml`](.copier-answers.yml) records the template's source, the
version the repository was last rendered against, and the six answers the
template asks. Every other value the template needs is derived from those by
the fleet's conventions, and a rendered file is this project's to edit: an
update is a three-way merge, which renders the recorded version again, carries
what this repository changed in a rendered file onto the new version's render,
and leaves a line both sides changed inline with conflict markers.

```sh
copier update --defaults --trust --conflict inline
```

The conventional values this project holds otherwise, as edits of the rendered
files, are the ones an update's conflict is usually about:

| Value | This project |
| --- | --- |
| Container registry | `testcabinet.azurecr.io`; the CI images are `ubuntu-the-test-cabinet-{rust,web}-cicd` |
| Resource group, cluster | `testcabinet-staging-westus2-rg`, `testcabinet-staging-westus2-aks` |
| Service connection | `tcab-deploy` |
| Deploy environment, namespace | `tcab-staging`, `tcab-staging` |
| Web dev server port | `1430` |
| Service image platform | `linux/arm64` |

`copier.yml` at the root is unrelated to it: it declares the repository kit,
the template this project renders its own repositories from (see
[Repositories](apps/docs/src/content/docs/development/repositories.md)).

See [The workspace template](apps/docs/src/content/docs/development/building.md#the-workspace-template).

## Repository layout, building & testing

The canonical repo layout and the build/format/lint/test commands for both the
Cargo and npm workspaces live in
[`development/building.md`](apps/docs/src/content/docs/development/building.md).
Running the services locally on one machine (the development mirror of a
deployment):
[`development/running.md`](apps/docs/src/content/docs/development/running.md).
The repositories the project is split into, the edges between them, and the
repository kit (`copier.yml`, `templates/repository/`, `scripts/repos/`) every
one is rendered from:
[`development/repositories.md`](apps/docs/src/content/docs/development/repositories.md).
Releasing the `tcab` binary and the static sites (gallery, docs, per-run builds):
[`development/releasing.md`](apps/docs/src/content/docs/development/releasing.md).
Deploying the always-on services (backend + workers) as remote staging/prod
environments, with runnable templates in [`deployments/`](deployments/):
[`deployment/`](apps/docs/src/content/docs/deployment/).
Telemetry/observability (opt-in OpenTelemetry, the local Grafana LGTM stack, and
prod config):
[`development/observability.md`](apps/docs/src/content/docs/development/observability.md).
Do not duplicate these commands here.

### Gates

Every check is a gate: a file under [`ci/gates/`](ci/README.md) whose stem is
its id. One command runs them all, and the runner runs any of them:

```sh
make gate
uv run --quiet --project ci gate list         # every gate and what it checks
uv run --quiet --project ci gate run <id>...  # run some of them
```

`.pre-commit-config.yaml` runs each gate as one hook, except the ones marked
"no hook", which are too slow for a commit and run in `make gate` and CI only.

```text
audio-packs              every version's [audio] packs resolve
build-context            Dockerfile COPY sources; containers/ Rust pins
ci-image-pins            every CI image reference reads ciImageTag
ci-tests                 pytest over ci/ and scripts/repos/
contract-drift           the generated contract is current (no hook)
cspell                   the prose's spelling, .cspell/project-words.txt
dependency-graph         the repositories against their edges, the patch
                         table and the package links
devcontainer-declaration the checkout is mounted where the container works
docs-build               the documentation site's build
docs-typecheck           the documentation site's astro check
format                   prettier; .prettierignore is its scope
frozen-paths             no change to a frozen test-case version
k8s-deploy-sets          the staging and prod deploy sets, pinned
k8s-manifests            the render of every overlay
markdownlint             the Markdown style (90 columns)
no-nul-bytes             a NUL byte in a file not declared binary
python-lint              ruff over ci/, scripts/repos/ and the repository kit
rust-clippy              cargo clippy, warnings denied
rust-doc                 cargo doc (private items too, via .cargo/config.toml)
rust-doctest             the doctests (no hook)
rust-fmt                 cargo fmt --check
rust-test                cargo nextest run, every crate but gg (no hook)
scripts-test             node --test over scripts/lib
seeded-contract          no evaluation vocabulary in the seeded packages
shell-tests              every *.test.sh under scripts/, scripts/ci/ and
                         scripts/repos/
site-build               the gallery build (no hook)
spec-prose               markdownlint and cspell over test-case prose
spec-vocabulary          no evaluation vocabulary in seeded specs
validators-typecheck     tsc over every validator project (no hook)
web-browser-test         apps/web's vitest, in real browser engines
web-build                apps/web's vite build
web-lint                 eslint over the TypeScript, ratcheted by eslint-suppressions.json
web-test                 apps/web's vitest, under jsdom
web-typecheck            apps/web's tsc -b
workspace-test           every npm workspace's vitest (no hook)
```

gg's unit tests are not part of `rust-test` (`crates/gg/Cargo.toml` sets
`test = false`); after a change under `crates/gg/`, run
`scripts/ci/gg-test.sh [k/N]`, which runs that suite. The upstream file checks
and `shellcheck` are hooks, not gates: `pre-commit run --all-files` runs them,
and their excludes keep the frozen test-case versions and test-case media out.
The [`coding`](.claude/skills/coding/SKILL.md) skill says which gates a change
runs before it is reported done.

Leave the machine's CPU at the load real work puts on it. Running a stress
tool, a busy loop or a deliberately oversubscribed parallel run to provoke a
flaky test is not allowed, for two reasons:

- A test is written to be deterministic, so the fix for a flaky one is to
  remove its dependence on timing or scheduling. Passing under load is a
  brittle and incorrect standard to hold a test to.
- The machine is shared with other projects' workspaces, and artificial load
  takes the CPU their real work needs.

The heavy cargo subcommands, `build`, `check`, `clippy`, `doc`, `test` and
`nextest`, take turns with the other workspaces on the machine through the
devcontainer's `cargo` wrapper. The wrapper is what `cargo` names on the
container's `PATH`, so an agent runs cargo as it would anywhere else and needs
to do nothing for it.

Given `--report-dir`, the runner keeps every gate's output in a file and
writes a summary of the run, which is how an agent is handed a failure
without the output itself reaching it.

### CI

`azure-pipelines.yml` runs the template's two gate jobs (`rust` and `web`, one
step per gate or upstream hook) on every push to `master`, `staging` and
`nightly`, batched, then the template's publish and deploy of the `staging`
overlay on `staging`. Both jobs run inside the CI images at the commit
[`ci/images/tags.yml`](ci/images/tags.yml) pins as `ciImageTag`, and end by
publishing the JUnit reports their test gates wrote as `test-results-<job>-<attempt>`.
A commit that changes a file an image is built from is followed by a second,
once the image pipeline's run on it has pushed the images, writing that commit
into `ciImageTag`; the change is complete when the pin follows it.
The project's own jobs and stages come from `.azure/project/`: gg's test
partitions, a `rust_build` job that links every target and seeds the template
`rust` job's target cache, the release binaries, the submodule pins, the image
builds, the GitHub mirror, and the `prod`, `gg_release` and `docs` stages. Tags
run the separate `azure-pipelines-release.yml`, whose first job requires the
main pipeline's check jobs at the tagged commit to have passed. See the
Continuous integration section of
[`development/building.md`](apps/docs/src/content/docs/development/building.md#continuous-integration).

### Devcontainer

Before the first start, copy the host's file to `.devcontainer/.env`
(`.env.macos` or `.env.podman`; see
[`.devcontainer/README.md`](.devcontainer/README.md#host-files)). The container
user is `dev`. The image carries everything a build needs, gg's eleven
program-language toolchains included, so the first image build is long and the
container's creation is short: `post-create.sh` initializes the `test-suites`
submodule, installs the git hook and runs `npm ci`, and nothing runs in the
background afterwards. cargo builds into
`target/` in the checkout, which `make clean` removes. See [`development/running.md`](apps/docs/src/content/docs/development/running.md#the-dev-container).

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

## Test suites

Test suites are the authored projects test cases are drawn from. The docs
site's [`test-suites/`](apps/docs/src/content/docs/test-suites/) section is
authoritative over their on-disk format: the layout, drafts, exported versions
and previews, plus a page per file format (the suite and version manifests,
specifications, validators, debug APIs, test case definitions, demonstrations,
assets, reference implementations, and the showcase). The suite model and its
rules live in `crates/contracts/src/test_suite/`, the catalog, lowering, previews
and validator runner in `crates/core/src/test_suite/`, the backend's suite ingest
and API in `crates/backend/`, and the console's Test Suites tab and detail pages
in `packages/ui/`.

Authored suites live in a separate test suites repository, included here as a
git submodule at [`test-suites/`](test-suites/), one folder per suite holding
its editable drafts and the immutable versions exported from them. The Test
Cabinet ingests only exported versions (and the previews beside them); it
never writes that tree. The authoring app, The Spec Cabinet, is developed
outside this branch.

## Working in this repo (skills)

The four template skills carry this project's own policies alongside the
template's, and are edited like any other file.

- Writing code: the [`coding`](.claude/skills/coding/SKILL.md) skill, which
  also holds documentation-first, the gates a change runs, the rule that a
  flaky test is a failing test, and gg's test suite.
- Writing documentation under `apps/docs/`: the
  [`documentation`](.claude/skills/documentation/SKILL.md) skill.
- Filing or editing an issue: the
  [`repo-tasks`](.claude/skills/repo-tasks/SKILL.md) skill, which describes
  the one-level board and has an issue cite the documentation rather than
  requirement identifiers; draining the queue:
  [`drain-issues-queue`](.claude/skills/drain-issues-queue/SKILL.md).
- Test cases: [`authoring-test-cases`](.claude/skills/authoring-test-cases/SKILL.md)
  and [`test-cases`](.claude/skills/test-cases/SKILL.md).
- gg: [`agent-prompts`](.claude/skills/agent-prompts/SKILL.md),
  [`gg-sdk-documentation`](.claude/skills/gg-sdk-documentation/SKILL.md),
  [`driving-gg-directly`](.claude/skills/driving-gg-directly/SKILL.md) and
  [`analyzing-run-costs`](.claude/skills/analyzing-run-costs/SKILL.md).
- Browser screenshots:
  [`playwright-26.04`](.claude/skills/playwright-26.04/SKILL.md).
- Updating this repository against its template, by hand or through a template
  update tool, or resolving the conflicts or taking the steps an update left:
  the [`template-migration`](.claude/skills/template-migration/SKILL.md)
  skill, which holds a guide per template version, stating what each brings
  and each step it leaves to take by hand.
- Configuring the repository for the fleet that manages it, or changing
  anything the fleet reads (the declarations folder at the root, the answers
  file, the devcontainer's compose file and its variables, `forwardPorts`, the
  pipeline's test results): the skill
  [`nyxsis`](.claude/skills/nyxsis/SKILL.md) <!-- cspell:disable-line -->
  first. It states each one's shape, its default and what is done with it.

## Issue board

[`tasks/`](tasks/) is the issue board: one file per issue at
`tasks/<area>/<issue>.md`, with completed ones moved into a `done/` folder
inside that area and ones waiting on user input into a `blocked/` folder beside
it. A finished issue is immutable (a hook refuses writes under `done/`): to
reopen the work, file a new issue. Nothing here is authoritative; when an issue
lands, its durable conclusions belong in `apps/docs/`.

## Definitions & assets

### [Test Cases](test-cases/)

Specification-based tests used to evaluate models. Test cases with runs recorded
against it on production have a `.frozen` marker file added to the folder.
Modifications to test cases with the marker file are refused by the
`frozen-paths` gate, at commit and in CI. See
[`development/frozen-versions.md`](apps/docs/src/content/docs/development/frozen-versions.md).

### [Cold Storage](cold-storage/)

An ordinary submodule holding every test-case version's captured baseline
validation media, at the version's own path under `cold-storage/`. Nothing
builds or tests against it, so it is optional. A recursive clone fetches it in
full (about 2 GB); a plain clone leaves it empty, and
`git submodule update --init --depth 1 cold-storage` fetches it later to capture
or review baselines. See
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
  the verification are load-bearing. Run them (see _Gates_ above), build
  adversarial verification
  into the workflow rather than trusting a single agent's report, and finish by
  telling the user **how to exercise the change** — the route, the command, the
  screen. Report honestly what was and was not verified.

## Changelog

App-level changelogs are located under [`changelogs/`](apps/docs/src/content/docs/changelogs/).
Do not write changelogs except when asked. Changelogs are expected to only be
written immediately prior to creating a release, not continuously over the
course of development.
