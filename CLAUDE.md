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
Read the doc first; the code column names the repository the implementation
lives in, checked out as a submodule at this repository's root.

| Component | Authoritative doc | Code |
| --- | --- | --- |
| Contracts (the hub: every wire and file shape, the suites runtime, telemetry, redaction, the backend client, both generators) | [`components/contracts/`](apps/docs/src/content/docs/components/contracts/) | `contracts/` |
| Engines (the authored engines, the voxel, particle and lattice playback runtimes, foray and lattice with the match runner) | [`components/engines/`](apps/docs/src/content/docs/components/engines/) | `engines/` |
| gg (the first-party coding harness, its SDKs, program-language toolchains and sandbox packages, released as binaries, reference documents and a toolchains image; its pages are the docs tree's `gg/` entry, which points into the checkout) | [`gg/overview.md`](apps/docs/src/content/docs/gg/overview.md) | `gg/` |
| Driver (the run engine: execution, harnesses, orchestrators, events, validation, showcases; one Job per run, uploading to artifacts and repos) | [`components/driver/overview.md`](apps/docs/src/content/docs/components/driver/overview.md) | `microservice-driver/` |
| CLI (`tcab`: validate, analyze, capture-baselines, seed, prompt, ingest, publish-reference, publish-asset-reference; the driver's second binary) | [`components/cli/overview.md`](apps/docs/src/content/docs/components/cli/overview.md) | `microservice-driver/` |
| Dispatcher (claims queued runs → one driver Job each; admits publish Jobs) | [`components/dispatcher/overview.md`](apps/docs/src/content/docs/components/dispatcher/overview.md) | `microservice-dispatcher/` |
| Backend (definitions and results; review and publish orchestration; writes the public dataset through the artifacts service) | [`components/backend/`](apps/docs/src/content/docs/components/backend/) | `microservice-backend/` |
| Artifacts (the write-through store of run trees over the private Blob container and the public R2 bucket) | [`components/artifacts/overview.md`](apps/docs/src/content/docs/components/artifacts/overview.md) | `microservice-artifacts/` |
| Repos (run implementations as git bundles; the public GitHub push) | [`components/repos/overview.md`](apps/docs/src/content/docs/components/repos/overview.md) | `microservice-repos/` |
| Publisher (the per-publish Job: the Pages deploy and the repos publish) | [`components/backend/results.md#publish`](apps/docs/src/content/docs/components/backend/results.md#publish) | `microservice-publisher/` |
| Arena (adversarial matches and tournaments, CPU-bound wasm, off the backend) | [`components/arena/overview.md`](apps/docs/src/content/docs/components/arena/overview.md) | `microservice-arena/` |
| Identity and the edge (Cloudflare Access over a Cloudflare Tunnel; one origin per environment) | [`components/auth/overview.md`](apps/docs/src/content/docs/components/auth/overview.md), [`deployment/kubernetes/edge.md`](apps/docs/src/content/docs/deployment/kubernetes/edge.md) | `deployments/k8s/components/edge/` |
| Console (`console.testcabinet.ai`; the operator GUI) | [`components/web/overview.md`](apps/docs/src/content/docs/components/web/overview.md) | `console.testcabinet.ai/` |
| Operator client (`client-tauri`: the Tauri shell for Windows, Linux, macOS and Android that loads the console) | [`components/client/overview.md`](apps/docs/src/content/docs/components/client/overview.md) | `client-tauri/` |
| Site (the public gallery on Pages, the `tcab.ai` share-link Worker and the preview-tag Worker) | [`components/site/overview.md`](apps/docs/src/content/docs/components/site/overview.md) | `testcabinet.ai/` |
| gg's public site (`gg.rocks` on Pages, presenting gg's documentation pages at the gg version it pins) | [`development/releasing.md#static-site-topology`](apps/docs/src/content/docs/development/releasing.md#static-site-topology) | `gg.rocks/` |
| UI library (`ui-common`: `@clockwyrks/ui` and `@clockwyrks/run-stats`) | [`components/ui/overview.md`](apps/docs/src/content/docs/components/ui/overview.md) | `ui-common/` |
| Voxel runtime (`@clockwyrks/voxel-runtime` — poses/renders a produced voxel rig; pure-core + three) | [`components/voxel-runtime/overview.md`](apps/docs/src/content/docs/components/voxel-runtime/overview.md) | `engines/` |
| Particle runtime (`@clockwyrks/particle-runtime` — simulates/renders a produced particle `system.json`; pure-core + three + canvas) | [`components/particle-runtime/overview.md`](apps/docs/src/content/docs/components/particle-runtime/overview.md) | `engines/` |
| Docs site | [`components/docs/overview.md`](apps/docs/src/content/docs/components/docs/overview.md) | `apps/docs/` |

Where each responsibility lives, the edges between the repositories and how a
dependency is named:
[Repositories](apps/docs/src/content/docs/development/repositories.md#where-each-responsibility-lives).
Every repository but `client-tauri`, `console.testcabinet.ai`,
`contracts`, `engines`, `gg`, `gg.rocks`, `microservice-arena`,
`microservice-artifacts`,
`microservice-dispatcher`, `microservice-driver`, `microservice-publisher`,
`microservice-repos`,
`tool-audio-core`, `tool-dc`, `tool-mc`, `tool-model-core`, `tool-music`,
`tool-paint`, `tool-particle`,
`tool-sfx-sample`, `tool-sfx-synth`, `tool-sn`, `tool-sprite`, `tool-voxel`,
`test-suites`, `testcabinet.ai`, `the-spec-cabinet`,
`ui-common` and `cold-storage` is still a directory of this tree
today (`crates/`, `apps/`, `packages/`), so until it is extracted its code is
found there.

The shared packages: `@clockwyrks/run-record` (the run record contract; see
[`components/contracts/run-records.md`](apps/docs/src/content/docs/components/contracts/run-records.md)),
`@clockwyrks/asset-contract` (the rig and F-curve shapes a produced model is
described by, kept apart from `run-record` because the voxel and particle
runtimes depend on it and are vendored into a model's workspace, which
`run-record` must never be) and `@clockwyrks/backend-api` (the backend API's
types) are generated in `contracts`. `@clockwyrks/run-stats` lives in
`ui-common` beside `@clockwyrks/ui`: the framework-free scoring rules, each
mirroring a counterpart in `microservice-backend`'s review module and held to
it by the goldens in `contracts/fixtures/`, plus the set-level rollup that lets
a figure frozen at one moment and the same figure recomputed later be compared.
The Playwright driver the
[validator](apps/docs/src/content/docs/components/driver/validation.md) shells
out to is the suites crate's.

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

`.pre-commit-config.yaml` runs each gate as one hook, triggered by the files it
judges. The superrepo's gates are the template's over its tree plus the
project's over the set:

```text
ci-image-pins            every CI image reference reads ciImageTag, and
                         Playwright's pins agree
ci-tests                 pytest over ci/ and scripts/repos/
cspell                   the prose's spelling, .cspell/project-words.txt
dependency-graph         the repositories against their edges, the patch
                         table, the package links and every lock
devcontainer-declaration the checkout is mounted where the container works
docs-build               the documentation site's build
docs-typecheck           the documentation site's astro check
format                   prettier; .prettierignore is its scope
k8s-deploy-sets          the staging and prod deploy sets, pinned
k8s-manifests            the render of every overlay
markdownlint             the Markdown style (90 columns)
no-nul-bytes             a NUL byte in a file not declared binary
python-lint              ruff over ci/, scripts/repos/ and the repository kit
scripts-test             node --test over scripts/lib
shell-tests              every *.test.sh under scripts/, scripts/ci/ and
                         scripts/repos/
```

The gates over code live with the code. Every repository carries the same
runner, rendered by the kit, and its own gates run from its checkout with the
same command: a Rust workspace's `rust-*` gates, an npm workspace's
`typescript` gate, `build-context` in a kind that builds an image, and the
gates a repository adds (`contract-drift` in `contracts`, `seeded-contract` in
`engines`, `web-lint` in `ui-common`, `web-lint` and `web-browser-test` in
`console.testcabinet.ai`, `web-lint` in `testcabinet.ai`, `fixture-suite-drift`
and `scripts-test` in `the-spec-cabinet`, `frozen-paths`,
`spec-prose`, `spec-vocabulary`, `audio-packs` and `validators-typecheck` in
`test-suites`).
gg's suite runs in the `gg` repository.

```sh
cd microservice-driver && make gate
```

The upstream file checks and `shellcheck` are hooks, not gates:
`pre-commit run --all-files` runs them. The
[`coding`](.claude/skills/coding/SKILL.md) skill says which gates a change runs
before it is reported done.

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

Every repository has a pipeline of its own, rendered by the kit, which gates
it, publishes what it releases and mirrors it. The superrepo's
`azure-pipelines.yml` runs the template's gate jobs (one step per gate or
upstream hook) on every push to `master`, `staging` and `nightly`, batched,
then the template's deploy of the `staging` overlay on `staging`; the project's
own jobs and stages come from `.azure/project/`: the submodule pins, the GitHub
mirror, the image builds, and the `prod` and `docs` stages. The gate jobs of
every pipeline run inside the CI images at the commit
[`ci/images/tags.yml`](ci/images/tags.yml) pins as `ciImageTag`, and end by
publishing the JUnit reports their test gates wrote as
`test-results-<job>-<attempt>`. A commit that changes a file an image is built
from is followed by a second, once the image pipeline's run on it has pushed
the images, writing that commit into `ciImageTag`; the change is complete when
the pin follows it. A deploy pins each service image at the commit the
superrepo's submodule pointer for that repository names, which that
repository's pipeline pushed as `<name>:<commit>`. A tag of the superrepo runs
nothing: a version is released by a `v*` tag on each repository. See the
Continuous integration section of
[`development/building.md`](apps/docs/src/content/docs/development/building.md#continuous-integration)
and [`development/releasing.md`](apps/docs/src/content/docs/development/releasing.md).

### Devcontainer

Before the first start, copy the host's file to `.devcontainer/.env`
(`.env.macos` or `.env.podman`; see
[`.devcontainer/README.md`](.devcontainer/README.md#host-files)). The container
user is `dev`. The image carries everything a build needs, gg's eleven
program-language toolchains included, so the first image build is long and the
container's creation is short: `post-create.sh` initializes the submodules a
build needs, installs the git hook and runs `npm ci`, and nothing runs in the
background afterwards. A repository's cargo builds into `target/` in its
checkout, which `make clean` removes. See [`development/running.md`](apps/docs/src/content/docs/development/running.md#the-dev-container).

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
rules live in `contracts/crates/contracts/src/test_suite/`, the catalog, lowering,
previews and validator runner in `contracts/crates/suites/src/test_suite/`, the
backend's suite ingest and API in `microservice-backend`, and the console's Test
Suites tab and detail pages in `ui-common`.

Authored suites live in a separate test suites repository, included here as a
git submodule at [`test-suites/`](test-suites/), one folder per suite holding
its editable drafts and the immutable versions exported from them. The Test
Cabinet ingests only exported versions (and the previews beside them); it
never writes that tree. The authoring app, The Spec Cabinet, is the
`the-spec-cabinet` repository.

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
- gg: [`agent-prompts`](gg/.claude/skills/agent-prompts/SKILL.md) and
  [`gg-sdk-documentation`](gg/.claude/skills/gg-sdk-documentation/SKILL.md),
  which live in the `gg` checkout,
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

Open issues are filed through the Nyxsis issues server, which writes one file
per issue under [`.nyxsis/issues/`](.nyxsis/issues/) in a zone
[`.nyxsis/zones.toml`](.nyxsis/zones.toml) registers; an issue's prose follows
the [`repo-tasks`](.claude/skills/repo-tasks/SKILL.md) policies and cites the
documentation page the code is aligned with. [`tasks/`](tasks/) holds the
finished issues of the former file board, under each area's `done/` folder; a
finished issue is immutable (a hook refuses writes under `done/`), and work it
describes that needs reopening is filed anew. Nothing on either board is
authoritative; when an issue lands, its durable conclusions belong in
`apps/docs/`.

## Definitions & assets

### [Test cases and game jams](test-suites/)

Test cases, game jams and test case groups are the content of the
`test-suites` repository, checked out as the `test-suites` submodule, which
this repository never writes. Test cases are specification-based tests used to
evaluate models. A test case version with runs recorded against it on
production carries a `.frozen` marker file, and a change to it is refused by
`frozen-paths`, that repository's gate, at commit and in CI. See
[`development/frozen-versions.md`](apps/docs/src/content/docs/development/frozen-versions.md).
Game jams are an alternate form of test case: intentionally open-ended, they
provide models with a theme to build against rather than a spec. The lattice
factory designer, the dev-only tool a performance scenario is laid out with, is
`tools/lattice-designer` in that repository; see
[the factory designer](apps/docs/src/content/docs/testing/performance/lattice/architecture.md#the-factory-designer).

### [Cold Storage](cold-storage/)

An ordinary submodule holding every test-case version's captured baseline
validation media, at the version's own path under `cold-storage/`. Nothing
builds or tests against it, so it is optional. A recursive clone fetches it in
full (about 2 GB); a plain clone leaves it empty, and
`git submodule update --init --depth 1 cold-storage` fetches it later to capture
or review baselines. See
[where baselines live](apps/docs/src/content/docs/components/driver/validation.md#where-baselines-live).

### [Engines](engines/)

Authored frameworks that provide functionality to models, held in the
`engines` repository. These are used to both evaluate how well a model can work
with existing code and to avoid implementations being utterly broken because
models fail to account for basic implementation details.

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
