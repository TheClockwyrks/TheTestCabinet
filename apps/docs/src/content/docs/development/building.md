---
title: Building
---

This page is the authoritative source for the repository layout and for the
build, format, lint, and test commands of both workspaces. The Test Cabinet is
an independent, open-source benchmark and depends only on public crates.io and
npm packages.

The repository is rendered from the k8s standard workspace template, which
supplies the dev container, the gates and their runner, the pipeline's gate jobs
and its staging publish and deploy. `.copier-answers.yml` records the template's
source, its version and this project's answers; see
[The workspace template](#the-workspace-template).

## Toolchains

Everything is built inside the devcontainer under `.devcontainer/`, which
carries every toolchain below at a pinned version. A gate whose toolchain is
absent fails and names the command that installs it, so the container is what
makes a gate judge rather than complain.

| Toolchain | Pinned by |
| --- | --- |
| Rust, with `rustfmt` and `clippy` | `rust-toolchain.toml`, and `RUST_VERSION` in `.devcontainer/docker-compose.yml` |
| `cargo-nextest` | `NEXTEST_VERSION` in `.devcontainer/docker-compose.yml` |
| `mold`, the linker of a glibc build | `MOLD_VERSION` in `.devcontainer/docker-compose.yml` |
| Node and npm | `NODE_VERSION` in `.devcontainer/docker-compose.yml` |
| `cspell`, `markdownlint-cli2`, Prettier, ESLint | `package.json` and `package-lock.json` |
| Vite, Vitest, React and TypeScript | `apps/web/package.json` and `package-lock.json` |
| uv, which the gates run under, and pre-commit | `.devcontainer/tools/uv.sh` |
| `kubectl` | `.devcontainer/tools/kubectl.sh` |
| `k3d`, `kubelogin` | `.devcontainer/tools/k8s.sh` |

Setting up a machine that executes test cases (container runtime,
run-container image, credentials) is covered by
[First Time Setup](/guides/setup/first-time-setup/). Running the services on your
own machine is covered by [Running](/development/running/).

## Cloning

The repository lives on Azure Repos and is mirrored to GitHub, and a clone from
either host works the same way. Each submodule is a separate repository:
[`cold-storage`](#cold-storage) and `test-suites`, the
[test suites](/test-suites/overview/) checkout.

A plain clone downloads the superproject alone and leaves each submodule
directory empty. It builds and passes every gate, because nothing in the build,
the tests, or CI reads a submodule's contents. Fetch a submodule into it later
when a task needs one:

```sh
git clone <superproject-url>
git submodule update --init --depth 1 cold-storage
git submodule update --init test-suites
```

The devcontainer populates `test-suites/` when it creates a container, because
a local backend ingests its suites from that checkout. `.gitmodules` sets the
submodule's tracked branch to `master`, so `git submodule update --remote
test-suites` moves the checkout to that branch's tip.

A recursive clone also downloads every submodule at the commit the superproject
pins, which for `cold-storage` is about 2 GB of media. `--shallow-submodules`
fetches only each pinned commit rather than the submodule's history:

```sh
git clone --recurse-submodules --shallow-submodules <superproject-url>
```

### Submodule URLs

`.gitmodules` names every submodule by a URL relative to the superproject, such
as `../cold-storage`. Git resolves it against the remote the superproject was
cloned from. On Azure that is the sibling repository in the
`genyume/the-test-cabinet` project, and on GitHub it is `TheClockwyrks/<name>`.
A submodule repository therefore has the same name on both hosts, while the
superproject's name may differ.

### Mirrors and pins

Each submodule repository carries its own Azure pipeline,
`.azure-pipelines/mirror.yml`, whose one job pushes to the GitHub repository of
the same name. That job is the only writer of the mirror. cold-storage's pushes
`master` alone today.

A pin on superproject branch B must be on the submodule's branch B or on its
`master`. On `master` that is the submodule's `master` alone, and a submodule
with no branch B is held to its `master`. Push the submodule commit to one of
those branches first, then commit the moved pointer here.
`scripts/ci/submodule-pins.sh` checks this, and the pipeline's `submodule_pins`
job runs it on every push. It fails when a pinned commit is not an ancestor of
either branch on the host the superproject was cloned from.

The script decides B for itself. A pull request is checked against the branch
it merges into, because that is where its pins land, and any other pipeline run
against the branch it built. Off an agent, B is the branch checked out, and
`--branch <b>` names another. A tag or a detached HEAD is held to `master`.

The rule keeps a clone of the GitHub mirror able to fetch its submodules: a
superproject commit on branch B names only submodule commits the mirror's B or
`master` holds, provided each submodule's mirror pushes B. Until a submodule's
mirror job pushes `staging` and `nightly` as well as `master`, pin it to
`master` there. The check fetches commits without trees or blobs, so it
finishes in seconds, and `scripts/ci/submodule-pins.test.sh` is its offline
table test.

### Submodules in CI

No gate reads a submodule, so the template's gate jobs check out none, which
also keeps the baseline media out of every devcontainer start. Nothing in the
pipeline initializes submodules recursively. A job that needs a submodule's
files names it and runs `scripts/ci/submodules.sh init <path>...`, which
initializes exactly those submodules at their pinned commits, one commit deep,
without their own submodules. `submodules.sh list` prints what `init` would
initialize and touches nothing.

`submodules.sh init --build-context` also initializes every submodule the root
`.dockerignore` re-includes any part of, as `scripts/ci/build-context.sh
--submodules` prints them. The image jobs (`audiostore_<arch>`,
`runimages_<arch>`, `services_<arch>`) run it after their checkout. No submodule
is in the build context today, so it says so and does nothing. A path in a
submodule enters the context the way any path does, by a re-inclusion that
names it, and the `build-context` gate checks it against that submodule's
checkout. When the checkout has not initialized the submodule, the gate lists
the path as unverified rather than failing.

The project scopes the job's access token to the repositories a job names. So
a job that fetches a submodule also checks the submodule's repository out,
which puts the repository in the token's scope. `submodule_pins` does this for
every submodule: `.azure/project/jobs.yml` lists them in its `submodules`
parameter, with each one's path and repository, and the job checks each
repository out beside this one before it runs `scripts/ci/submodule-pins.sh`
with the token in `SYSTEM_ACCESSTOKEN`. `scripts/ci/submodules.sh check` holds
that list to `.gitmodules`, and `scripts/ci/submodules.test.sh` runs the check
against the repository, so the `shell-tests` gate fails on a submodule added to
one and not the other. An image job that comes to build from a context
admitting a submodule needs the same checkout of its repository.

## Layout

The repository is both a Cargo workspace (Rust) and an npm workspace
(TypeScript). Around them:

- `.copier-answers.yml`: the workspace template's source, the version the
  repository was last rendered against, and the answers it asks.
- `.azure/`: the pipeline templates. `.azure/publish-image.yml` is the
  template's; `.azure/project/*.yml` is the project's own pipeline work, which
  `azure-pipelines.yml` includes; `.azure/tcab/` holds the project's job and
  step templates, shared by `azure-pipelines.yml` and
  `azure-pipelines-release.yml`.
- `ci/`: the gates, one file per gate under `ci/gates/`, the `ci` uv project
  that runs them, and under `ci/images/` the CI images the gate jobs run in.
- `.devcontainer/`: the dev container, whose image bakes in every toolchain a
  build needs (see [Running](/development/running/#the-dev-container)).
- `.claude/`: the harness settings, its hooks and its skills.
- `scripts/`: the hook installer and devcontainer check, the project's
  scripts, and under `scripts/ci/` the scripts the pipelines run.
- `tasks/`: the issue board.

### Rust (Cargo workspace)

- `crates/contracts`: `test-cabinet-contracts` (lib `test_cabinet_contracts`).
  The [contract](/components/core/overview/#the-contracts-crate) shapes more than
  one party agrees on: the run record and its parts (events, validation summary,
  metrics, toolchain and code analysis), the review shapes, a resolved test case
  version, the test suite format and its rules, gg's configuration, telemetry and
  session record, the TCQ query shapes, the engine identity a run names, the
  ingest feed, and the layout of a run tree. Data and pure functions only; core
  re-exports every module at its old path. The test suite fixture the format's
  tests and the suite runtime's tests read is `crates/contracts/fixtures/test-suite/`,
  the TCQ conformance fixture the Rust and TypeScript evaluators both execute is
  `crates/contracts/fixtures/gg_query.conformance.json`, and the
  [scoring goldens](#the-scoring-goldens) both scoring implementations execute are
  `crates/contracts/fixtures/scoring/`.
- `crates/suites`: `test-cabinet-suites` (lib `test_cabinet_suites`). The
  [test-suite runtime](/components/core/overview/#the-suites-crate): the suite
  catalog and lowering, previews, a definition's prompt and the validator runners,
  with the engine catalog, the vitest runner, the browser driver and the content
  digests they share with the core. Core re-exports every module at its old path.
  The `test-support` feature exposes `test_browser` to another crate's tests.
- `crates/engines`: `test-cabinet-engines` (lib `test_cabinet_engines`). The
  built-in [engine](/components/core/engines/) manifests as data: `BUILT_IN`, every
  `engines/*/engine.toml` keyed by slug. Only its test depends on another crate
  (the contracts crate, for `BUILT_IN_SLUGS`); the core builds its
  default engine catalog over it.
- `crates/core`: `test-cabinet-core` (lib `test_cabinet_core`). The headless
  [core](/components/core/overview/) that owns all orchestration: resolving a
  test case version, seeding a run's repository, executing the run in a
  container, invoking the agent harness, collecting metrics, running validation,
  and writing the run record.
- `crates/cli`: `test-cabinet-cli` (binary `tcab`). The
  [command line interface](/components/cli/overview/) over the core.
- `crates/gg`: `test-cabinet-gg` (binary `gg`). The
  [in-container coding harness](/gg/overview/) this repository ships itself.
- `crates/dispatcher`: `test-cabinet-dispatcher` (binary `tcab-dispatcher`).
  The [dispatcher](/components/dispatcher/overview/), which claims queued runs
  from the backend and creates a per-run Kubernetes `Job`.
- `crates/driver`: `test-cabinet-driver` (binary `tcab-driver`). The
  [driver](/components/driver/overview/), the per-run executor that runs one run
  server-side.
- `crates/artifacts`: `test-cabinet-artifacts` (binary `tcab-artifacts`). The
  [artifact service](/components/artifacts/overview/), which retains and serves
  the trees a run produces.
- `crates/arena`: `test-cabinet-arena` (binary `tcab-arena`). The
  [arena service](/components/arena/overview/), which runs adversarial matches
  and tournaments off the backend.
- `crates/backend`: `test-cabinet-backend` (binary `tcab-backend`). The
  [backend](/components/backend/overview/), the private definition/run store and
  API. Its system of record is a SeaORM database: embedded SQLite by default, or
  PostgreSQL when `TCAB_BACKEND_DATABASE_URL` points at one.
- `crates/auth-service`: `test-cabinet-auth-service` (binary
  `tcab-auth-service`). The [auth service](/components/auth/overview/), which
  holds accounts and mints the bearer tokens the backend verifies.
- `crates/telemetry`: `test-cabinet-telemetry`. The shared
  [OpenTelemetry](/development/observability/) wiring every long-lived binary
  initializes at startup.
- `crates/contract-codegen` and `crates/api-codegen`: the two
  [generators](#generating-the-data-contract) of the committed TypeScript
  bindings and JSON Schemas, one for the data contract and one for the backend's
  API.

The remaining members are the asset-generation tools (`draw`, `voxel`, `mc`,
`sn`, `dc`, `paint`, `particle-*`, `sfx-*`, `music` and the libraries they
share), the adversarial and performance engines (`foray-*`, `lattice-*`), the
store's `entities`/`migration` crates, and the ten `gg-sandbox-artifacts` arm
crates. Shared dependency versions are declared once in the root `Cargo.toml`
under `[workspace.dependencies]` and inherited with `{ workspace = true }`.

### TypeScript (npm workspace)

- `packages/run-record`: `@clockwyrks/run-record`. Shared TypeScript types
  and JSON Schema for the [run record](/components/core/run-records/), the
  central data contract.
- `packages/asset-contract`: `@clockwyrks/asset-contract`. The rig and F-curve
  shapes a produced model is described by, generated in the same pass from the
  same Rust types. Its own package because it is the only slice of the contract
  that may be **seeded**: the voxel and particle runtimes depend on it and are
  vendored into a model's workspace, so whatever they depend on travels with
  them. `run-record` re-exports these types, so a console keeps importing them
  from there. The `seeded-contract` gate (`ci/gates/seeded-contract.py`, which
  runs `scripts/ci/seeded-contract-check.sh`) keeps the evaluation half out of
  a run.
- `packages/backend-api`: `@clockwyrks/backend-api`. The TypeScript types of the
  [backend's API](/components/backend/api/): its request and response shapes,
  the run queue, coverage plans and ladders, accounts, comparisons, the
  published snapshot documents, the saved gg configurations, agents, queries and
  dashboards, the persisted tournament, and the `Review` document. Generated
  from `crates/backend` and `crates/core`, and built on `run-record`, whose types
  it imports.
- `packages/run-stats`: `@clockwyrks/run-stats`. The framework-free rules for
  scoring a reviewed run, each mirroring a counterpart in
  `crates/core/src/review.rs`, plus the set-level rollup that keeps a figure
  frozen at one moment comparable with the same figure recomputed later. The
  [scoring goldens](#the-scoring-goldens) hold each mirror to its counterpart. It has
  no runtime dependencies and imports only types from `run-record` and
  `backend-api`, so it runs in
  a bundle, a build script, or a worker alike. `packages/ui`'s `ratings` module
  re-exports the scoring half alongside its display metadata.
- `packages/browser-driver`: `@clockwyrks/browser-driver`. The Playwright
  driver script the [validator](/components/core/validation/) shells out to,
  used to render reference mockups and to drive and screenshot a produced
  implementation.
- `packages/case-harness`: `@clockwyrks/case-harness`. The shared harness every
  engineless (`none`) validator project is built on: the browser lifecycle, the
  driven-frame loop, the injected draw-command recorder and audio probe, and the
  readings a check makes over them. It ships TypeScript source rather than a built
  `dist/`, because the validator stages it beside a case's own validator files,
  where nothing compiles. Its own suite lives in `test/` as `*.spec.ts` files, held
  outside the `files` the package publishes, so the harness's tests stay with the
  harness while a case's `validation/` tree carries only the suites its review
  items name.
- `packages/ui`: `@clockwyrks/ui`. The shared
  [UI library](/components/ui/overview/) hosting the routed gallery application
  and the presentational primitives; the site and web console are thin hosts
  over it.
- `packages/voxel-runtime` and `packages/particle-runtime`. The runtimes that
  pose and render a produced voxel rig and simulate a produced particle system.
- `packages/simple-2d`: `@clockwyrks/simple-2d`. The Simple 2D
  [engine](/components/core/engines/), providing the frame loop, input actions,
  audio, assets, and diagnostics a produced game builds on, plus the host
  interface a driver binds to. It is staged into the host package store and
  vendored into the run repository at seed time, and its package version is the
  engine version recorded on the run.
- `packages/structured-2d`: `@clockwyrks/structured-2d`. The Structured 2D
  [engine](/components/core/engines/), providing a gameplay framework of worlds,
  levels, game modes, actors, and controllers, with engine-owned rendering and
  collision, around a 2D game written in TypeScript. It is staged and vendored
  the same way as `packages/simple-2d`, and its package version is the engine
  version recorded on the run.
- `packages/gg-sandbox`: the TypeScript and JavaScript arm of gg's
  responses-as-code sandbox.
- `apps/site`: `@clockwyrks/site`. The static
  [gallery site](/components/site/overview/) that displays published run
  records.
- `apps/web`: `@clockwyrks/web`. The browser
  [web console](/components/web/overview/) that enqueues runs at the backend.
- `apps/docs`: `@the-test-cabinet/docs`. This Astro Starlight documentation
  site. The workspace template renders its `package.json`, which pins the
  site's dependencies; the pages are the project's.

### Cold storage

`cold-storage/` at the root is a git submodule holding the captured baseline
validation media, the bulk of the repository's bytes. Its tree mirrors this
one's, so a test-case version's baselines live at
`cold-storage/test-cases/<type>/<difficulty>/<slug>/<version>/validation-baseline/<engine>/<variant>/`
(see [where baselines live](/components/core/validation/#where-baselines-live)).
Fetch it only to capture or review baselines, or to ingest a catalog that serves
them.

### Reference implementations

A [reference implementation](/guides/devops/publishing-a-reference-implementation/)
under a case version's `references/` is its own npm project rather than a member
of the workspace, so it is installed from its own directory. An engine-backed one
resolves its engine from `packages/simple-2d` or `packages/structured-2d` through
a relative `file:` dependency that npm installs as a symlink, so the reference
builds and tests against the engine's current source.

That symlink points at the package directory, and what the reference imports is
the package's `dist/`, so the root workspace must be installed and built first:

```sh
npm ci && npm run build:packages   # at the repository root
npm ci                             # in the reference's own directory
```

A reference installed over an unbuilt engine installs cleanly and fails at
`npm run typecheck` instead, reporting
`TS2307: Cannot find module '@clockwyrks/<slug>'` ahead of the property errors
that the failed resolution produces.

## The workspace template

The template renders most of what surrounds the code: `.devcontainer/`, `ci/`,
`azure-pipelines.yml`, `azure-pipelines-ci-images.yml`, `.pre-commit-config.yaml`,
the lint and format configurations, `Makefile`, `rust-toolchain.toml`,
`.config/nextest.toml`, `.claude/settings.json` with its hooks and four skills,
`tasks/README.md`, and a few scripts. `.copier-answers.yml` records the
template's source, the version the repository was last rendered against, and
the six answers the template asks; every other value it derives from those by
the fleet's conventions.

A rendered file is this project's to edit. An update is a three-way merge: the
recorded version is rendered again, what this repository changed in a rendered
file since is carried onto the new version's render, and a line both sides
changed is left inline between conflict markers for a person to resolve.

```sh
copier update --defaults --trust --conflict inline
```

The values this project holds otherwise than the fleet's conventions, and so
the lines an update's conflicts are usually about, are the container registry
(`testcabinet.azurecr.io`, with the CI images
`ubuntu-the-test-cabinet-{rust,web}-cicd`), the resource group and cluster
(`testcabinet-staging-westus2-rg`, `testcabinet-staging-westus2-aks`), the
service connection (`tcab-deploy`), the deploy environment and namespace
(both `tcab-staging`), the web dev server's port (`1430`) and the platform the
service images are built for (`linux/arm64`). The other edits an update
carries are of the same kind: the project's gates and their wiring in
`.pre-commit-config.yaml` and `azure-pipelines.yml`, the CI image pin in
`ci/images/tags.yml`, the excludes on the upstream hooks, the devcontainer
image's gg layer and apt packages, the project's skills and hooks under
`.claude/`, and the project's pipeline work in `.azure/project/*.yml`, which
the template's pipeline includes.

`copier.yml` at the root is a second copier template, the repository kit this
project renders its own repositories from; see
[Repositories](/development/repositories/#the-kit).

## The gates

One command runs every check a commit runs, over the whole tree:

```sh
make gate
```

Every check is a gate: one file under `ci/gates/` whose stem is the gate's id,
run by the `gate` runner of the `ci` project. That id is what a commit hook, a
pipeline step and an issue all call the check by.

```sh
uv run --quiet --project ci gate list         # every gate and what it checks
uv run --quiet --project ci gate run <id>...  # run some of them
uv run --quiet --project ci gate run --all    # what make gate runs
```

Given `--report-dir`, the runner keeps every gate's output in a file under that
directory and writes `SUMMARY.md` beside it, which is how a workflow hands an
agent a failure without the output itself; `ci/README.md` describes the report.

The template's gates:

| Id | What it checks |
| --- | --- |
| `no-nul-bytes` | No NUL byte in a file `.gitattributes` does not declare binary |
| `devcontainer-declaration` | The checkout is mounted at the folder the container works in |
| `shell-tests` | Every `*.test.sh` under `scripts/`, `scripts/ci/` and `scripts/repos/` |
| `rust-fmt` | `cargo fmt --all -- --check` |
| `rust-clippy` | `cargo clippy --locked --workspace --all-targets -- -D warnings` |
| `rust-doc` | `cargo doc --locked --workspace --no-deps`, with private items (see below) |
| `rust-test` | `cargo nextest run --locked --workspace`, which skips gg's unit tests; no hook |
| `rust-doctest` | `cargo test --locked --workspace --doc`; no hook |
| `k8s-manifests` | The template's render of every overlay; see [Kubernetes](/deployment/kubernetes/overview/) |
| `web-lint` | `npm run lint`: ESLint over the TypeScript, ratcheted by `eslint-suppressions.json`; see [Linting](#linting) |
| `web-typecheck` | The web console's `tsc -b` |
| `web-test` | The web console's Vitest run, under jsdom |
| `web-browser-test` | The web console's Vitest run, in real browser engines |
| `web-build` | The web console's `vite build` |
| `markdownlint` | The Markdown style, from `.markdownlint-cli2.yaml`, at 90 columns |
| `cspell` | The prose's spelling, from `cspell.json` and `.cspell/project-words.txt` |
| `format` | Prettier, with `.prettierignore` as its scope (plus the k8s manifests and the case-harness fixture page) and the frozen versions left out |
| `docs-typecheck` | This site's `astro check` |
| `docs-build` | This site's build |
| `python-lint` | ruff over `ci/`, `scripts/repos/` and the repository kit's `templates/repository/` |
| `ci-tests` | pytest over `ci/` and `scripts/repos/`, the latter rendering the repository kit for each kind |

The project's own gates, wired the same way:

| Id | What it checks |
| --- | --- |
| `frozen-paths` | No change to a [frozen](/development/frozen-versions/) test-case version |
| `seeded-contract` | No evaluation vocabulary in the packages seeded into a model's workspace |
| `spec-vocabulary` | No evaluation vocabulary in a non-frozen version's seeded specs |
| `spec-prose` | markdownlint and cspell over the test-case, game-jam and group prose |
| `audio-packs` | Every version's `[audio] packs` resolves against the pack registry |
| `build-context` | Every project Dockerfile's `COPY` sources, and the `containers/` Rust pins |
| `k8s-deploy-sets` | The staging and prod deploy sets, pinned to a commit |
| `ci-image-pins` | The root pipelines name every CI image as `<repository>:${{ variables.ciImageTag }}` and include `ci/images/tags.yml`, `azure-pipelines.yml` passes the Rust one to `.azure/project/jobs.yml` as `rustImage`, and no file under `.azure/` names one |
| `dependency-graph` | The submodules, the patch table and the package links against the repositories' [edges](/development/repositories/#the-edges) |
| `scripts-test` | `node --test` over `scripts/lib` and `scripts/*.test.mjs` |
| `workspace-test` | Every npm workspace's Vitest run but the console's and this site's; no hook |
| `validators-typecheck` | `tsc` over every test case's validator projects; no hook |
| `site-build` | The gallery's build; no hook |
| `contract-drift` | The generated data contract is current; no hook |

`.pre-commit-config.yaml` runs each gate as one hook, triggered by the files it
judges, except the ones marked "no hook", which build the workspace packages or
the Rust workspace before they check anything and so run in `make gate` and the
pipeline only; `HOOKLESS` in `ci/tests/test_wiring.py` names them, and a gate
added without a hook fails there until it is either given one or named too slow
for a commit.

Every hook runs on each commit except `rust-clippy` and `rust-doc`, which compile
the whole workspace and so run on each push (`stages: [pre-push]`). A pre-push
hook judges the files that differ across the pushed range, so a change to any
Rust source in the push runs both. `scripts/setup-hooks.sh` installs both hook
types, and the dev container runs it when the container is created. Re-run it on
a clone set up before the pre-push hook existed, or the clippy and doc gates
never run locally. `git commit --no-verify` and `git push --no-verify` bypass the
respective stage.

The same file carries the checks the hook framework brings from its pinned
upstream repositories, the file checks of `pre-commit-hooks` and `shellcheck`;
they are hooks, not gates, so `make gate` does not run them and
`pre-commit run --all-files` does, and the pipeline gives each a step of its
own. Two of them, `check-added-large-files` and `end-of-file-fixer`, leave out
every test-case and game-jam version directory: a version ships what a playable
game needs, media and oracle output far over the size limit, and a
[frozen version](/development/frozen-versions/) may never change.

A reference implementation's scripts are model output, so each slug directory
that holds one carries a `.shellcheckrc` turning `shellcheck` off beneath it.

## Building Rust

```sh
cargo build --workspace
```

The toolchain is pinned to an exact patch release in `rust-toolchain.toml`, and
every checkout builds with that release. Format, lint, and test with:

```sh
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo doc --workspace --no-deps --document-private-items
cargo nextest run --workspace
cargo test --workspace --doc
```

Tests run under `cargo-nextest`, configured by `.config/nextest.toml`, which the
dev container and the Rust CI image both carry. nextest does not execute
doctests, so `cargo test --doc` runs those separately. `cargo doc` is what
checks intra-doc links, and `--document-private-items` is required for it to
reach crates whose public surface is small. The project's `.cargo/config.toml`
sets it as `build.rustdocflags`, so the `rust-doc` gate documents private items
too. Cargo reads that file for every run under the repository, the doctests and
gg's Rust signature reflection included (whose catalogue it leaves unchanged),
and an empty `RUSTDOCFLAGS` in the environment overrides it.

The gates run the same commands, and are the ones to run locally when
reproducing a CI failure:

```sh
uv run --quiet --project ci gate run rust-fmt rust-clippy rust-doc
uv run --quiet --project ci gate run rust-test rust-doctest contract-drift
scripts/ci/rust-build.sh      # cargo build, every crate and target
scripts/ci/gg-test-build.sh   # cargo build of gg's unit tests
scripts/ci/gg-test.sh [k/N]   # gg's unit tests, whole or one hash partition
```

gg's unit tests are the one part of the suite no gate runs; see
[Testing gg](#testing-gg).

### The scoring goldens

A run's score and rating are computed twice: by the core in Rust, where the backend
scores a stored review, and by `@clockwyrks/run-stats` in TypeScript, where the
consoles, the gallery and the public read edge score the same run. The goldens under
`crates/contracts/fixtures/scoring/` are the cases both must agree on, one file per
pair of functions that exists on both sides: `score_checklist`, the toolchain gate
(`gated`), the review aggregations (`aggregate`), the validator-decided domain ratings
(`validator_domain`), `merge_review_items`, the errata's `score_exclusions`, and the
automated-only score with the verdicts and the covered score it is built on
(`automated`). Each case gives its `name`, `why` it exists, the `input` and what to
`expect`.

`crates/core/src/review.goldens.test.rs` executes them in the `rust-test` gate and
`packages/run-stats/src/scoring.goldens.test.ts` in `workspace-test`, both reading the
files off the contracts crate, so a case added on either side runs on both, and each
fails when the directory holds a file it executes no test for. Each rejects a key it
does not know, since a misspelled key would otherwise fall back to its default and
assert less than it reads as asserting. The expectations are the Rust
output: a change to a scoring rule changes the goldens, and the other side then has
to follow. The writeup-based `review::score` has no golden, being a thin wrapper over
`score_checklist` with no TypeScript counterpart.

### Tests that read case versions

A Rust test that resolves a named case version reads a copy of it under its
crate's `testdata/definitions/`, laid out like the repository root
(`test-cases/<type>/<difficulty>/<slug>/<version>/`, `game-jams/`,
`test-case-groups/`). A copy holds the version's tracked files without its
`.frozen` marker, so the [frozen-paths](/development/frozen-versions/) gate
guards the original alone. The tests read no other tree, so they pass wherever
the catalog itself lives, and a missing copy fails the test that resolves it.
The format, prose and lint gates and the image build context leave the
copies out.

The tests that hold every committed version to a rule read the catalog itself:
`crates/core/tests/committed_catalog.rs`, the group membership check in
`crates/core/tests/manifests_are_valid.rs`, and the backend's
`every_stored_manifest_preserves_its_asset_shape`. They read it from
`TCAB_DEFINITIONS_ROOT`, the directory holding `test-cases/`, `game-jams/` and
`test-case-groups/`, which defaults to the repository root, and they fail where
it holds no catalog.

### Tests that need a browser

A few of the core's and the suites crate's tests run a real toolchain rather than a
stand-in for one: the
lockfile check's script under the host's `node`, and Playwright's Chromium
launched through the npm workspace, which is how a validator project runs under
Vitest's browser mode. A machine without that toolchain prints `skipped:` and
what is missing, and the test passes, so the rest of the suite still runs on a
laptop with no browser. `crates/suites/src/test_browser.rs` holds the helpers such
a test uses, which the suites crate's `test-support` feature exposes to the core's
tests, and `test_browser::tests::the_repository_workspace_launches_chromium` in the
suites crate checks the toolchain on its own.

Where the toolchain is meant to be present, a skip is a pass nobody earned.
`TCAB_REQUIRE_BROWSER=1` names such a place: with it set, a missing `node`, a
workspace without the packages a test names, or a Chromium that does not
launch fails the test instead. The `rust` gate job is such a place: it runs in
the [rust-browser CI image](#ci-images), which carries Node and Chromium, and
sets the variable, so these tests run in CI and a missing toolchain fails them.
To hold a local run to the same standard:

```sh
npm ci                                   # the workspace: Vitest, Playwright
scripts/ci/install-playwright-chromium.sh  # Chromium and its libraries (as root)
TCAB_REQUIRE_BROWSER=1 cargo nextest run -p test-cabinet-suites -p test-cabinet-core
```

The dev container already carries Chromium. A test finds the npm workspace from
its crate's `CARGO_MANIFEST_DIR`, as the nearest ancestor holding a
`package.json` and a `node_modules`, and stops at the repository's root, so a
checkout inside another repository never borrows that repository's install.

```sh
uv run --quiet --project ci gate run audio-packs
```

The `audio-packs` gate runs at commit and in CI. It requires an
[`[audio] packs`](/testing/full-stack/manifests/#audio) declaration on every
full-stack and game-jam version that is not frozen, resolves every declared ref
against `containers/sample-packs/` for name, version, kind, and published clips,
and prints the defaults each version's pack order resolves to. It reads the
committed manifests only, so it needs no credentials.

```sh
uv run --quiet --project ci gate run spec-vocabulary
```

The `spec-vocabulary` gate also runs at commit and in CI. It reads
every non-frozen version's `prompt.hbs` and `specs/**`, plus the shared prompt
preambles in `crates/core/src/prompt.rs`, and fails on any word that would tell a
model it is being evaluated or that this project exists; the list is in
[Keeping evaluation out of the seeded set](/guides/authoring/writing-case-specifications/#keeping-evaluation-out-of-the-seeded-set).
Hits in frozen versions are reported, not failed. It is dependency-free and
finishes in under a second.

### The Rust toolchain pin

`rust-toolchain.toml` is the template's, and pins the compiler to an exact patch
release, together with the `RUST_VERSION` build argument in
`.devcontainer/docker-compose.yml` and the CI images. A new compiler therefore
arrives with a template update. The images under `containers/` build with the
same compiler: each `FROM rust:<version>-bookworm` and each
`ARG RUST_VERSION=<version>` default there must equal the toolchain file's
`channel`, and the `build-context` gate, whose hook also fires on
`rust-toolchain.toml`, fails naming the file, the line and both versions until
they do.

Two things follow a bump without anything to do by hand:

- gg's Rust arm compiles a model's program against a set of `.rlib` files, a
  compiler-private format `rustc` refuses from any other release (E0514). The set
  is generated by `crates/gg-sandbox-artifacts/rust` into its `OUT_DIR`, and
  `rust-toolchain.toml` is in that crate's rerun set, so the next build re-cuts
  it with the new compiler.
- The toolchain file lists no `targets`. The wasm target gg's Rust arm compiles
  to is installed by `scripts/ci/install-rust-wasm.sh` instead, because a target
  named there is fetched on the first cargo invocation of every checkout,
  including the `containers/` builder images that cross-compile nothing.

### `gg` and its eleven toolchains

[`gg`](/gg/overview/) drives a model in one of eleven program languages, and
building `test-cabinet-gg` produces two things for each of them.

A signature catalogue is what a model is told an arm offers: every module,
signature, argument, type, and type member, reflected out of that language's own
SDK by that language's own documentation tool. `crates/gg/build.rs` generates all
eleven into the build's `OUT_DIR`, and the arm modules `include_str!` them from
there. A build of gg therefore describes the SDK sources in its own checkout. See
[Program languages](/gg/languages/overview/).

An arm's build artifacts are what a model's program is compiled and evaluated
against: a guest component, an SDK jar, a compiler, a library set. Each arm has a
crate under `crates/gg-sandbox-artifacts/` whose build script runs that arm's
`packages/gg-sandbox*/build.sh` into its own `OUT_DIR`, and `crates/gg` embeds
the result from there. Ten crates serve the eleven arms, because
`packages/gg-sandbox` serves TypeScript and JavaScript from one build. Separate
crates give each arm its own rerun set, so editing the Java SDK re-cuts the Java
jar alone, and cargo runs the independent arms concurrently.

Both are generated rather than committed. `crates/gg/src/sandbox/checkers/`
holds five files that are gg's own source: three hand-written Java compiler
drivers and the two JVM arms' pin declarations. A `.gitignore` allowlist names
exactly those five and ignores everything else in that directory.

Anything that compiles `crates/gg` needs those toolchains present. That is
`cargo build --workspace`, `cargo clippy --workspace`, `cargo doc --workspace`,
the pre-push clippy and doc hooks, `scripts/build-gg-static.sh`, and
`scripts/gg-reference.sh`. Nothing else in the workspace depends on
`test-cabinet-gg`, so a package-scoped build such as `-p test-cabinet-cli` and the
release binaries need none of it.

Install them once, before the first build:

```sh
scripts/ci/install-gg-toolchains.sh        # the eleven arms, ~1.9 GB, idempotent
scripts/ci/install-gg-build-toolchains.sh  # the C# guest's build tools, idempotent
npm ci                                     # the pinned tsc two arms reflect with
```

The two lists stay separate. The first is every toolchain that a gg run and gg's
reflectors execute; it is installed into the dev container's image by
`.devcontainer/languages/gg/install.sh`, in the pipeline by
`scripts/ci/gg-ci-toolchains.sh`, and in the run images. The second is a .NET SDK and an
unpruned wasi-sdk that exactly one arm's artifact build needs, since C#'s guest
is Mono's IL interpreter, relinked. It installs under its own prefix
`~/.local/share/tcab/gg-build/` so the eleven-arm list keeps its meaning and the
run images keep their size. With the second prefix populated,
`packages/gg-sandbox-csharp/build.sh` resolves both from it instead of fetching
its own copies.

The dev container's image carries both lists, about 3.4 GB under
`~/.local/share`, together with the apt packages gg's installers and the asset
tools need (`ruby`, `libicu-dev`, `ffmpeg`, `cmake`, `iproute2`, `lsof`,
`procps`) and `wrangler`. `.devcontainer/languages/gg/install.sh` runs the two
installers above in the image's last layer, against a slice of the repository
the Dockerfile stages for them, so a pin moving under `packages/` or an
installer changing rebuilds that layer and nothing above it. A container built
before a pin moved reconciles by running the two installers by hand; each
checks what is there against its pin and touches no network when they match.
The one prerequisite the image leaves to the checkout is the npm workspace,
which `post-create.sh` installs, because two catalogues are reflected with the
pinned `typescript` in it.

In CI, `scripts/ci/gg-ci-toolchains.sh` is the one provisioner for every job
that builds or tests Rust. It installs the pinned Node and both lists into a
directory the job caches, with the default install locations under `$HOME`
linked into it, so a warm cache downloads only the wasm32 standard library.

A missing toolchain fails the build with the arm named and the fix stated. A
failure naming `node_modules` is fixed by `npm ci`.

An interrupted install is safe to re-run, and it is cheap. Between them these
scripts fetch about 3 GB — the Swift toolchain alone is 1.05 GB — and every one of
those fetches goes through `gg_fetch` (`scripts/ci/fetch.sh`), which retries a
dropped connection and resumes rather than restarting. The partial archive is kept
under `~/.cache/tcab/downloads` (the same path the service-image build mounts a
cache over), so re-running the installer after a failure picks up where it stopped
instead of paying for the whole transfer again; each installer deletes its own
archive once the tree it feeds has verified itself. Nothing under an install prefix
is touched until every byte is on disk, so a fetch that fails leaves a toolchain a
machine already had rather than half of one.

To read an arm's build artifacts, or a catalogue, run the same scripts the build
runs:

```sh
scripts/gg-artifacts.sh               # -> target/gg-artifacts/, every arm
scripts/gg-signatures.sh              # -> target/gg-signatures/<language>.signatures.json
```

Both accept a destination argument and default to a gitignored directory under
`target/`. Both read `scripts/gg-arms.sh`, the only enumeration of gg's arms in
the repository, and `build.rs` calls `gg-signatures.sh` rather than repeating it.
A catalogue is also where reflector bugs surface, such as a dropped `@return`
paragraph or a truncated parameter description.

#### Testing `gg`

nextest runs each test in its own process, and most of gg's tests need a
compiled guest component. The test build keeps compiled components on disk in
`component-cache` under the crate's `OUT_DIR`, so a guest is compiled a handful
of times per build rather than once per test. An entry is keyed on the
component's bytes and wasmtime's compatibility hash, is stored only once its
bytes have been compiled twice, and is evicted least recently used past 4 GiB.
`cargo clean` removes it. Production builds have no such cache.

Test builds compile components on one thread, since nextest already runs one
test per core. The root manifest optimizes the Cranelift and wasmtime crates in
the dev profile, which is where that compile time goes.

Most of gg's tests compile a program in one of its language arms, so the suite
is the bulk of the workspace's test time, more than the template's one Rust gate
job can hold. `crates/gg/Cargo.toml` therefore sets `test = false` on gg's lib
and bin and `doctest = false` on the lib (gg has no compiled doctest), so the
`rust-test` gate and `make gate` skip the suite, while `rust-clippy` still lints
its `#[cfg(test)]` code. `scripts/ci/gg-test.sh` runs it with `--lib`, which
overrides `test = false`, whole with no argument or as one `k/N` hash partition
of it; the pipeline's `gg_tests_<k>_of_4` jobs run one partition each. Run it
after any change under `crates/gg/`:

```sh
scripts/ci/gg-test.sh        # the whole suite
scripts/ci/gg-test.sh 2/4    # one hash partition of it
```

### Portable (static) builds

The default build dynamically links against glibc and the generic FHS dynamic
loader (`/lib64/ld-linux-x86-64.so.2`), which suits mainstream Linux such as
Ubuntu. Distributions that ship no such loader, notably NixOS, need a fully
static binary built against the musl target instead. This is opt-in and leaves
the default build unchanged.

Prerequisites:

```sh
rustup target add x86_64-unknown-linux-musl
# plus a musl C toolchain on PATH (`musl-gcc`), for the little C that the `ring`
# TLS backend and the bundled SQLite compile. On Debian/Ubuntu: `musl-tools`.
```

The aliases are pinned to `x86_64-unknown-linux-musl`, so an aarch64 host
cross-compiles and needs an x86_64 musl cross toolchain on top of that. The dev
container installs the musl target for its own architecture, which is what
`scripts/build-gg-static.sh` builds against.

Then build with the aliases defined in `.cargo/config.toml`, each of which
writes to `target/x86_64-unknown-linux-musl/release/`:

| Alias                             | Binary            |
| --------------------------------- | ----------------- |
| `cargo build-portable`            | `tcab`            |
| `cargo build-portable-backend`    | `tcab-backend`    |
| `cargo build-portable-dispatcher` | `tcab-dispatcher` |
| `cargo build-portable-driver`     | `tcab-driver`     |
| `cargo build-portable-artifacts`  | `tcab-artifacts`  |
| `cargo build-portable-gg`         | `gg`              |

The backend links statically too: its SeaORM SQLite driver compiles SQLite from
vendored C source with the same musl toolchain, and its PostgreSQL driver is pure
Rust over rustls. Under its `cli` runtime the driver still shells out to a host
container runtime, so that host needs Podman or Docker on `PATH` and the harness
API keys for the harnesses it runs; see the
[driver configuration](/components/driver/overview/).

#### Building `gg` for the run container

gg executes inside the run container, and a run's image varies by test type:
most are glibc Debian bookworm, and the blender image is Ubuntu. The static musl
build is what lets one binary run across every run-container image.

```sh
# Release/CI build (x86_64), matching the other `build-portable-*` aliases:
cargo build-portable-gg

# Arch-adaptive build for the HOST architecture. Use this in the dev container
# (aarch64 on Apple Silicon) for a local k3d cluster. It picks the musl target,
# wires up `musl-gcc`, and prints the built binary's path:
scripts/build-gg-static.sh            # -> …/<host-arch>-unknown-linux-musl/release/gg
scripts/build-gg-static.sh /out/gg    # …and also copies it to /out/gg
```

The driver image bakes gg in from the same script, installing it at
`/usr/local/lib/tcab/gg` with `TCAB_GG_BINARY` pointed at it, so
`make -C deployments/local local-up` produces a driver image carrying gg and a
Kubernetes run installs gg locally. Set `TCAB_GG_INSTALL=release` to pull a
published release instead. See
[gg installation](/gg/overview/#installation--distribution).

## Building TypeScript

Install all workspace dependencies from the repository root, then build every
workspace that defines a build:

```sh
npm install
npm run build
```

The other root scripts delegate to each workspace that defines them:
`npm run dev`, `npm run test`, and `npm run typecheck`. `npm run lint` is ESLint
over the whole workspace from the root `eslint.config.js` (the `web-lint` gate);
see [Linting](#linting).

`npm run test` runs `vitest` in each workspace. Iterate on the gallery's own
suite with `npm run test -w @clockwyrks/ui`. On a clean checkout, build the
workspace runtime packages first with `npm run build:packages`, since the tests
import them from a built `dist/`.

### Linting

ESLint lints the hand-written TypeScript of four projects with type information:
`apps/web/src`, `packages/ui/src`, `apps/site/src` and `apps/lattice-designer/src`.
It also lints the build configurations beside them (each Vite configuration and
the plugins it loads) and the gallery's `apps/site/scripts/` without type
information. The `PROJECTS` list at the top of `eslint.config.js` names each
project with the `tsconfig.json` that owns it. Every file set is derived from
that list, so a new project is brought under the gate by adding one entry to it.

The gate has one tier. The configuration raises every rule a preset leaves at
`warn` to an error, and an `eslint-disable` comment that suppresses nothing is an
error too.

Most of that code was written before the gate covered it, so the gate is a
ratchet over it rather than a demand that it be clean.
`eslint-suppressions.json` at the repository root records, for each file, how
many errors of each rule the file had when it was recorded. It is ESLint's own
[bulk suppressions](https://eslint.org/docs/latest/use/suppressions) file, and
`npm run lint` reads it:

- A file whose count for a rule is at or under its record passes, and its
  recorded errors are not printed.
- A file whose count for a rule grows past its record fails, and ESLint prints
  every error of that rule in the file, since it cannot tell which one is new.
- A file the record does not name, or a rule it does not name for that file,
  fails on its first error. New code is held to the whole gate.
- An error ESLint cannot attribute to a rule is never recorded: a file that does
  not parse, or a file outside every project's `tsconfig.json`, fails as it is,
  and so does an `eslint-disable` comment that suppresses nothing.
- A count that shrinks passes. Record the shrink with `npm run lint:prune`,
  which lowers each count to what the code now has and drops what reached zero,
  so the shrink cannot be spent again.

| Command | What it does |
| --- | --- |
| `npm run lint` | The gate: ESLint, with the baseline applied |
| `npm run lint:prune` | Lowers the baseline to the current counts; never raises one |
| `npm run lint:baseline` | Rewrites the baseline from scratch to the current errors |
| `npm run lint -- --fix` | Applies ESLint's automatic fixes, then checks as the gate does |

`npm run lint:baseline` accepts every error the code has now, new ones included.
It is for widening the gate: adding a project to `PROJECTS`, or adopting a rule
set the existing code does not yet meet. A diff that raises a count in
`eslint-suppressions.json` is the visible record that it was run, and fixing the
new error is the usual answer instead. ESLint writes the file in its own
formatting, with no final newline, so `.prettierignore` leaves it out of the
`format` gate and the `end-of-file-fixer` hook leaves it alone.

A file moved or renamed loses its record, because the record is keyed by path.
Move its entry in `eslint-suppressions.json` to the new path with it, or run
`npm run lint:baseline` in the same change and check that the diff only moves
counts.

### Every page loads

`packages/ui/src/app/pages/routeSmoke.test.tsx` mounts the routed app at every
path in `routePatterns` and asserts that each one renders, meaning the page error
boundary caught nothing and the page put content on screen. It walks that table
against three hosts: a console with a stocked catalog, a console holding nothing,
and the read-only static gallery.

This suite covers whether a page loads at all; the per-page suites cover whether
it behaves correctly. Adding a route to `routePatterns` adds it to the walk.

The page error boundary in `packages/ui/src/app/components/PageErrorBoundary.tsx`
is the runtime counterpart. It wraps the routed body, so a page that throws is
contained to itself: the chrome and section nav stay, the panel names the
failure, and navigating to another page clears it.

### Validator projects

Type-check every test case's validators with:

```sh
npm run typecheck:validators
```

It runs `tsc --noEmit` over each `test-cases/**/<version>/validation/<engine>/`
project. Nothing else compiles them: a run stages a project into the produced
tree and vitest transpiles it without checking types, so this is the only gate on
a validator that fails to compile. It is the `validators-typecheck` gate, a step
of the `web` job.

A project resolves the build's `../src/*` against the case's reference
implementation and the shared harness's `./case-harness/*` against
`packages/case-harness/src`, through the `rootDirs` its config declares. See
[Writing Case Specifications and Prompts](/guides/authoring/writing-case-specifications/#validators-type-check-where-they-are-authored).

Lint the authored prose with:

```sh
npm run lint:specs
```

It runs the `spec-prose` gate: `markdownlint-cli2` over the Markdown in
`test-cases/**`, `game-jams/**` and `test-case-groups/**`, then `cspell`, from
`.cspell/specs.json`, over the Markdown, HTML, CSS, TOML, and Handlebars there
that a case or jam ships to a model. Add a legitimate domain term to
`.cspell/project-words.txt` when `cspell` flags it. This is the linter the
test-case authoring and variant guides refer to under "Validate your work". The
rest of the repository's Markdown, this site included, is the `markdownlint` and
`cspell` gates' (`npm run lint:docs`).

Check formatting over the whole checkout with:

```sh
npm run format:check  # check, the format gate
npm run format        # rewrite
```

It runs `prettier --check` over every file prettier has a parser for: the
packages, the front ends, and every test case's validators, seeded workspaces and
reference implementations. A formatting warning anywhere fails the check. Two
things are left out: what `.prettierignore` names (build trees, vendored copies,
the Handlebars templates prettier does not parse, and prose, which markdownlint
and cspell own), and the frozen test-case versions, which
`scripts/format-check.mjs` derives from their `.frozen` markers on each run.
`.prettierignore` comes from the project template, and two of its rules are
broader than this project: the Kubernetes manifests under `deployments/k8s/` and
the case-harness fixture page under `packages/case-harness/test/build/` are
still checked, in a pass that honours `.gitignore` alone. It is the `format`
gate.

## Generating the data contract

The run-record data contract and the backend API built on it have a single
source of truth: the Rust types that derive `ts_rs::TS` and
`schemars::JsonSchema` behind their `contract` feature, in `crates/contracts`,
`crates/core` and `crates/backend` (core's feature turns on the contracts
crate's). Two generators turn them into the committed TypeScript bindings and the
JSON Schemas under `apps/docs/public/schema/`:

- `crates/contract-codegen` writes the data contract from `crates/contracts`:
  `packages/run-record/src/` and `packages/asset-contract/src/` (two packages,
  because only the latter may be seeded into a run) and their schemas.
- `crates/api-codegen` writes the backend's API from `crates/backend` and
  `crates/core`: `packages/backend-api/src/` and its schemas. It reads the first
  generator's modules and documents without writing them, so a backend type that
  refers to a contract type imports it from `@clockwyrks/run-record` and
  references it at the contract document's URL. Nothing in the data contract
  refers back to the backend API.

Each generator owns its directories under `apps/docs/public/schema/`. The data
contract's are `core/` and `gg/`; the backend's are `backend-api/`, `coverage/`,
`jobs-api/` and `snapshot/`. Each generator resolves the workspace root from its
own crate, so each writes where its own workspace keeps its outputs. Five of the
backend's documents once sat in the contract's directories and moved to
`backend-api/`: `tournament.schema.json`, `gg-query-batch-request.schema.json`,
`gg-query-batch-response.schema.json`, `gg-saved-query.schema.json` and
`gg-dashboard.schema.json`. Their old URLs under `/schema/core/` and
`/schema/gg/` redirect to the new ones with a 301, from
`apps/docs/public/_redirects`, which the docs site's Cloudflare Pages project
reads. After changing any contract type, regenerate and commit:

```sh
npm run gen:contract
```

It runs both generators, mirrors gg's built-in system-prompt templates into
`packages/backend-api/src/gg-system-prompt.ts` (the backend API's package, not the
data contract's, because the data contract depends on nothing of gg's), formats
the output with Prettier, and compiles the two regenerated packages. The
`contract-drift` gate regenerates and fails on any diff, or on a generated file
that was never committed, so the Rust, TypeScript, and JSON Schema
representations stay in step.

`contract-codegen` compiles `test-cabinet-contracts` only, and `api-codegen`
compiles `test-cabinet-core` and `test-cabinet-backend`, so neither needs any of
gg's program-language toolchains.

## Projecting gg's reference

The console's gg Reference section is served by the backend from files gg
projects: the whole tool vocabulary, and every responses-as-code function and
type on each of the eleven arms, carrying the bytes a model's own documentation
lookup renders. The backend must not link `test-cabinet-gg`, so the projection
crosses that boundary as files:

```sh
scripts/gg-reference.sh            # -> target/gg-reference/
```

That writes `index.json` plus one `<language>.json` per program language. The
backend finds them there by default through `TCAB_GG_REFERENCE`, which resolves
under `TCAB_BACKEND_CHECKOUT` when unset. The backend image bakes the same files
at `/opt/gg-reference` and the driver image bakes the binary that projected them,
so a deployed console and the harness its runs execute come from one build of one
checkout. A backend with no documents serves everything else normally and answers
`503` on the two reference endpoints.

The pipeline builds that binary once, in the `gg_<arch>` jobs, and publishes it as a
per-architecture artifact together with the documents it projects. The backend and
driver image builds consume that artifact in place of the Dockerfile stage that
would link a second copy, which is what makes the run images' self-check, the
driver's baked harness and the console's reference one binary per commit. The
Dockerfile stage remains what an offline `make -C deployments/local images`
builds.

The script builds gg, so it needs the toolchains described under
[gg and its eleven toolchains](#gg-and-its-eleven-toolchains). Running the
projection itself needs none of them, because every arm's catalogue is compiled
into the binary.

## Checking gg's arms in a run image

Every language arm compiles inside the run container, against the toolchain tree
the `-gg` image variants carry, so the question a build cannot answer is whether
that tree works where it is copied to. `gg selfcheck` answers it: it drives every
arm's bootstrap program through the real preparation, guest and views in whatever
environment the binary is running in, and exits non-zero when any arm fails.

```sh
make -C deployments/local run-images-gg-selfcheck   # build gg, build the five, check them
```

That target builds the static binary with `scripts/build-gg-static.sh` and hands
it to `containers/build.sh --gg-selfcheck`, which drives the check inside each
image between building it and pushing it — installing the binary the way a run
does, with `docker cp` to `/tmp/gg` and an `exec` as the unprivileged run user.
Naming the images runs the same command by hand:

```sh
containers/build.sh --gg-selfcheck target/gg-selfcheck/gg \
  sprite-gg base-wasm-gg voxel-gg full-stack-3d-gg blender-gg
```

Five images answer for all twenty-seven variants, because each copies one builder
image's `/opt/gg` to one absolute path and so carries the same tree byte for byte,
and what differs is the environment it runs in: the image the lineage is rooted at
plus every package a run image installs on the way down. `build.sh` re-derives that
grouping from the Dockerfiles on every gated build. CI passes the same
`--gg-selfcheck` flag post-merge, before the images are published.

The tree being identical is a fact about the files, not about how the registry
stores them. Each variant carries its own layer for those bytes, so a host that
pulls two variants pulls the tree twice, and fifty-five images with twenty-seven
copies of a 2.2 GB tree do not fit on a build agent. So the CI build sets
`RECLAIM=1` alongside `PUSH=1`, and `containers/build.sh` then removes each image
from the local store once nothing later is `FROM` it and prunes the builder cache
as it advances. `RECLAIM` is deliberately a separate switch: the builder prune
takes every cache mount on the daemon, including ones belonging to other
Dockerfiles, so a publish from a development machine does not set it. A local
build sets neither and keeps everything, because there the images are what is
being produced.

### Reusing unchanged run images

The CI build is also content-addressed, so a commit that changes no run image
builds none. `scripts/ci/run-image-inputs.sh` prints a digest of every image's
inputs (its Dockerfile, the context paths it copies, its parents' digests), and
`containers/build.sh`, handed that table as `REUSE_INPUTS`, pushes each image it
builds under an `inputs-<digest>-<arch>` tag as well as the commit's, and gives
an image whose inputs tag is already in the registry the commit's tag with a
manifest write instead of a build. `containers/README.md` says what the digest
covers and how a build is forced when an unpinned upstream has to be refreshed.

`cargo run -p test-cabinet-gg -- selfcheck` asks the same question of this
machine's own toolchains, which is the form to run while working on an arm. See
[the self-check](/gg/languages/selfcheck/).

## Continuous integration

Azure Pipelines is the project's only CI. `azure-pipelines.yml` is the
template's: it gates a commit, and on `staging` publishes the backend image and
deploys the `staging` overlay. The project's own jobs and stages come from the
files under `.azure/project/`, which it includes. Every job delegates to a
script, so a failure reproduces locally by running the same script;
`scripts/ci/README.md` lists them. The YAML names the image a job runs inside,
its caches, the credentials a step runs under, and which registry round trips
are retried, and nothing else.

Pushes to `master`, `staging` and `nightly` trigger it, batched: pushes that
arrive while a run of the same branch is in flight get one run, for the newest
commit, so an intermediate commit is not gated, mirrored or deployed on its own.
Pull requests into `master` and `staging` run it through build validation
policies on those branches, because Azure Repos ignores a `pr:` block. Tags do
not trigger it; a `v*` tag runs the release pipeline instead (see
[The release pipeline](#the-release-pipeline)).

| Stage | Runs on | What it does |
| --- | --- | --- |
| `gates` | every run | The template's `rust` and `web` jobs, and the project's jobs below; on `master` and `staging` also the static gg builds and every image; the GitHub mirror on `master`, `staging` and `nightly` |
| `publish` | `staging` | The template's: builds `deployments/images/backend.Dockerfile` and pushes `the-test-cabinet-backend:<commit>` |
| `deploy` | `staging` | The template's: rolls the `staging` overlay onto the commit; see [Kubernetes](/deployment/kubernetes/overview/#deploying) |
| `prod` | `master` | The project's: the same backend publish, then `scripts/ci/deploy-environment.sh prod <commit>` |
| `gg_release` | `master` | The project's: uploads the static gg binaries; see [Releasing `gg`](/development/releasing/#releasing-gg) |
| `docs` | `master`, `staging` | The project's: deploys this site |

Every stage after `gates` depends on it, so a red job in the gates stage (a
gate, a project job, or a template job past its timeout) stops every image
job, the mirror, the publish and deploy, `prod`, `gg_release` and `docs`.

### The gate jobs

The template's two gate jobs run every gate, one step per gate, in the CI image
of their track: `rust` runs the Rust gates and `contract-drift`, and `web` runs
the rest, every project gate but `contract-drift` included. Each step runs
`uv run --quiet --project ci gate run <id>`, the command a commit hook and
`make gate` run it with, so a failing check is one red step named for it.
Each upstream hook runs as `pre-commit run <id> --all-files` in a step of its
own in the `web` job. The `web` job is capped at 60 minutes and `rust` at 120:
a warm `rust` job takes about 45 minutes and a cold one about 65, and a
pipeline cache is scoped to the branch that saved it, so a branch that has not
run in a week (`master` between releases) starts cold. The free tier's
60-minute cap on a Microsoft-hosted agent does not apply, because the
organisation's purchased parallel jobs lift it to 360.

The project adds steps to both through `.azure/project/setup-steps.yml` and
`.azure/project/steps.yml`:

- In `rust`: `scripts/ci/free-disk-linux.sh`, which reclaims what the
  template's own reclaim leaves; the gg toolchains, restored from the
  `gg-toolchains` cache and completed by `scripts/ci/gg-ci-toolchains.sh`, since
  the CI images carry no gg toolchains, with the npm workspace the browser
  tests run under; and, last,
  `scripts/ci/cargo-target-prune.sh`, which removes the executables cargo linked
  before the template saves its `target/` cache, so the cache holds the compiled
  libraries and fits beside the tree on the agent's disk.
- In `web`: `npm run build:packages`, since the front ends, the gallery and
  the validators import the workspace's packages from their built `dist/`, and
  a variable that disables Astro's telemetry, whose write outside the checkout
  fails the docs build.

Every gate that runs tests names `CI_GATE_ARTIFACTS: target/gate-artifacts/<id>`
on its step, which has it write its JUnit report there, and each job ends, after
the project's steps and whether the tests passed or failed, with
`scripts/ci/collect-test-results.sh` and a publish of what it collected as the
pipeline artifact `test-results-<job>-<attempt>`. `test-results-rust-1` holds
`rust-test`'s report; `test-results-web-1` holds `web-test`'s,
`web-browser-test`'s, `ci-tests`'s, `scripts-test`'s and `workspace-test`'s. The
browser tests' screenshots ride their own `web-browser-test-<attempt>`
artifact. `ci/README.md` describes the report directory and the metrics read
off it.

### The project's jobs

`.azure/project/jobs.yml` adds these jobs to the gates stage. Their bodies live
in `.azure/tcab/`, shared with the release pipeline. The amd64 jobs that
compile Rust run as container jobs in the template's Rust CI image, with the
template `rust` job's paths, variables and cargo cache, so they share its caches
and seed them. The rust-browser image the `rust` job is to move into is built
on that image, so the toolchain and its paths are the same in both and a
compile in one is a cache hit in the other. A template cannot read the pin itself (a
`${{ variables.* }}` inside an included jobs template expands to nothing), so
`azure-pipelines.yml` names the image with the expression its `rust` job names
its own with,
`testcabinet.azurecr.io/ubuntu-the-test-cabinet-rust-cicd:${{ variables.ciImageTag }}`,
and passes it to `jobs.yml` as its `rustImage` parameter; the release
pipeline, a root file itself, names it the same way. The `ci-image-pins` gate
fails on a root pipeline naming a CI image any other way, on the include
passing anything else, and on a file under `.azure/` naming an image at all.

| Job | Runs on | What it does |
| --- | --- | --- |
| `paths` | every run | `changed-paths.sh`: which of the check jobs below a pull request reaches; see [Which check jobs a pull request runs](#which-check-jobs-a-pull-request-runs) |
| `gg_tests_<k>_of_4` | every push; a pull request that reaches gg | gg's unit tests, one hash partition per job: `gg-test-build.sh`, then `gg-test.sh k/4` |
| `rust_build` | every push; a pull request that reaches the Rust workspace | `rust-build.sh`, the link of every target. When no seed exists for this `Cargo.lock`, it also runs the template gates' clippy, doc and test builds and saves `target/` under a key the template `rust` job restores |
| `binary_linux` | every push; a pull request that reaches the Rust workspace | The release build and tests of `tcab`, its doctests, and the binary smoke |
| `binary_windows` | every push; a pull request that reaches the Rust workspace | The same on `windows-2022` |
| `submodule_pins` | every push; a pull request that touches a submodule pin | `submodule-pins.sh`: every pin is on the submodule's branch of the same name or on its `master`; see [Mirrors and pins](#mirrors-and-pins) and [Submodules in CI](#submodules-in-ci) |
| `gg_amd64`, `gg_arm64` | `master`, `staging` | The static gg binary per architecture (`gg-dist.sh`) |
| `audiostore_<arch>`, `runimages_<arch>`, `services_<arch>` and their manifests | `master`, `staging` | Every image, built natively per architecture and fused by `manifest.sh`; the eight service images of an architecture on one builder, so their Rust compile happens once |
| `mirror` | `master`, `staging`, `nightly` | Pushes the branch to GitHub, after every check job; see [The GitHub mirror](#the-github-mirror) |

### Which check jobs a pull request runs

A push to `master`, `staging` or `nightly` runs every check job, so the mirror,
the images, a deployment and a release always follow a full run. A pull request
runs the template's `rust` and `web` jobs and, of the project's check jobs, the
ones its change reaches. The `paths` job decides which: it checks the merge
commit out two deep and runs `scripts/ci/changed-paths.sh`, which diffs the
merge commit against its first parent, the target branch, and sets one output
variable per group of jobs. Each conditional job depends on `paths` and runs
when its variable is `true`.

The script classifies by exclusion. A changed path reaches a group unless it is
one the group's jobs are known never to read, so a path the script has no rule
for runs everything. The `rust` group (`rust_build`, `binary_linux`,
`binary_windows`) leaves out the documentation site, the web app and gallery,
the issue board, the deployment manifests, the run-container definitions, the
gates' own sources under `ci/`, Markdown outside `crates/`, every shell test,
and the scripts only the image, deploy and release jobs run. The `gg` group
(the gg test partitions) leaves out those and the test cases and game jams,
which gg's suite never reads. The `submodules` group (`submodule_pins`) is the
one allowlist: `.gitmodules`, a submodule's pin, and the script itself. A change
under `.azure/`, to `ci/images/`, to `rust-toolchain.toml` or to
`changed-paths.sh` reaches every group.

A run other than a pull request, and a pull request whose checkout is not a
merge commit, sets every variable to `true`. The `checks` job accepts a skipped
check job only when `paths` itself succeeded, so a failed `paths` job fails the
run rather than waving it through.

`rust_build` exists because the template's `rust` job is one job with a
timeout, and a pipeline cache is saved only after every step of a job
succeeded: a cold `rust` job that times out never warms its own cache. Its
seed is what keeps a cold run well inside the `rust` job's 120 minutes; a run
that still times out, after a template update that moves the compiler, is
queued a second time, warm from this job's seed.

The image jobs sit in the gates stage on purpose: the template's publish stage
retags `tcab-backend:<commit>`, which they build, and the staging deploy pins
every image they push. `amd64` builds on Microsoft-hosted `ubuntu-24.04` agents
and `arm64` on the organisation's arm64 pool
`pool-dev-linux-arm64-wus3-4c-eph-01`. Each architecture pushes
`<image>:<sha>-<arch>` to `testcabinet.azurecr.io`, and `manifest.sh` fuses the
two into the multi-arch `<image>:<sha>` a deployment pins. The audio store is
built first, because the driver image bakes `test-cabinet-audio-store:<sha>`,
and the run images are pushed only after `gg selfcheck` passes inside each
`-gg` environment. The eight service images of an architecture are built by
one job on one builder (`service-images.sh`), because seven of them share one
`cargo build` of the service binaries; a separate job per image compiled it
seven times over. The 27 `-gg` run images share one `/opt/gg` layer, so the
registry stores it once and each push after the first mounts it.

### The GitHub mirror

The `mirror` job runs `scripts/ci/mirror.sh`, which pushes the branch with
every tag it contains, or the tag a release built, to the repository's GitHub
mirror over ssh, with the deploy key held in a secure file. It is the only
thing that pushes there, so the mirror holds gated commits only.

The target is the one the repository declares in `.nyxsis/mirrors.toml`, the
file the fleet that manages the repository reads its mirrors from, here
`https://github.com/TheClockwyrks/TheTestCabinet`. The job template,
`.azure/tcab/mirror-job.yml`, takes it as its `url` parameter, which
`.azure/project/jobs.yml` and the release pipeline pass, and the script refuses
a `url` the file does not declare, so the two cannot drift apart. The template's
`secureFile` parameter names the key, `github-mirror-key` by default; GitHub
refuses one deploy key on two repositories, so each mirror has a key of its
own. A pipeline that passes no `url` has no `mirror` job at all, so a pipeline
copied into another repository pushes nowhere, and asks for no key, until its
own target is written in. Run directly with neither a `url` nor a declared
mirror, the script says so and pushes nothing.

Before it pushes, the script reads the mirror's refs and refuses the push when:

- the target branch exists on the mirror and its head is not an ancestor of the
  commit being pushed, or is a commit the clone does not hold; or
- a tag it would push already names a different object on the mirror.

Either means the mirror holds history this repository does not, such as another
repository's history pushed by a copied pipeline, or a history rewritten under
it. The push itself is not forced, so a mirror that moved between the check and
the push is refused by GitHub too. When replacing the mirror's history is
meant, queue a run with the pipeline variable `mirrorAllowRewrite` set to
`true`, which skips the check and forces the push; locally, `--allow-rewrite`
or `MIRROR_ALLOW_REWRITE=true` does the same.

In the main pipeline the `mirror` job sits in the gates stage, which the
staging publish and deploy stages wait on, but the mirror is not an input to
either. Its push step therefore continues on error: a refused or failed push
ends the job with issues, the run shows the warning, and the stage still
succeeds, so a re-run of an older run, a branch rewritten here or a tag moved
after it was mirrored never holds back a deploy of a commit that passed every
check. The release pipeline's `mirror` job has nothing after it and fails
outright.

### The release pipeline

`azure-pipelines-release.yml` is the project's second pipeline, triggered by
`v*` tags and nothing else. Its first job, `gated`, runs
`scripts/ci/require-gated-commit.sh`: it looks for a run of the main pipeline at
the tagged commit, on any branch, and waits until that run's check jobs (`rust`,
`web`, the gg test partitions, `rust_build`, both binary jobs and
`submodule_pins`) have passed. The images, publish, deploy and docs results
never gate a release. When no run exists at that commit, it queues one on the
tag ref, where every branch-conditional job and every later stage skips, so that
run is the gates stage alone. Then it builds and publishes the `tcab` binaries
and gg, and mirrors the tag. See [Releasing](/development/releasing/).

### CI images

The template's gate jobs, and the project's Rust container jobs, run inside the
template's CI images:

| Image | Jobs |
| --- | --- |
| `testcabinet.azurecr.io/ubuntu-the-test-cabinet-rust-cicd` | `rust`, `gg_tests_<k>_of_4`, `rust_build`, `binary_linux`, `gg_amd64` |
| `testcabinet.azurecr.io/ubuntu-the-test-cabinet-rust-browser-cicd` | none yet; `rust`, once `ciImageTag` pins a run that built it |
| `testcabinet.azurecr.io/ubuntu-the-test-cabinet-web-cicd` | `web` |

`ci/images/README.md` describes each. The Rust image carries the pinned
toolchain, nextest, the musl target, and the apt packages the project's tools
need beyond a compile's, which `ci/images/rust.Dockerfile` installs (`cmake`,
`ffmpeg`, `libicu-dev`, `python3`, `ruby`, `zip`); gg's toolchains and Node
come from the `gg-toolchains` cache.

The rust-browser image is the project's own. It is the Rust image of the same
commit with Node and Playwright's Chromium on top
(`ci/images/rust-browser.Dockerfile`, which installs the browser with
`scripts/ci/install-playwright-chromium.sh`). The `rust` job runs in it with
`TCAB_REQUIRE_BROWSER=1`, so the Rust tests that drive a browser run there and
fail rather than skip when it is missing (see
[Tests that need a browser](#tests-that-need-a-browser)). The project's other
Rust jobs need no browser and stay on the Rust image.

The repository split plans an `android` track, which the template renders only
once the `tauri_desktop` and `tauri_android` answers are both true, and a
`base` track. Neither is here yet; `ci/images/README.md` says what each waits
on. The split keeps the commit tag: every repository's images are tagged by the
commit of the image run that built them.

`azure-pipelines-ci-images.yml` builds the images. It triggers on the files an
image is built from and on nothing else, and every run builds every track and
pushes each as `<repository>:<commit>`, the commit its run is on, from the
layer cache. The rust-browser job waits for the Rust one, since it builds on
the image that job pushed. `ci/images/tags.yml` holds one variable, `ciImageTag`, as a
variables template both pipelines include: the full commit whose image
pipeline run built the images every gates job pulls, so a commit's diff says
which images it ran in. The template renders the file with forty zeros, which
name no image, and the commit written over them is the project's own edit,
which a template update carries. A change to an image's files is therefore two
commits:

1. Push the change. The image pipeline's run on that commit pushes each track's
   image under the commit.
2. Once that run has finished, write the commit into `ciImageTag`, and push.
   That second commit's gates run in the new images.

Until the pin follows, the gates run in the images it names. The same loop is
the first one a branch runs after a template update that moves a pin, and the
one for taking an image whose base moved under a floating tag: queue the image
pipeline by hand on the branch's head and pin the commit it ran on. After each
of its runs the image pipeline purges the registry of every CI image tag that
`master`, `staging`, `nightly` and the checkout do not pin
(`scripts/ci/ci-image-purge.sh`).

A job pulls its CI image from the registry before its first step runs, so a
registry answer that times out would fail the job before it has checked
anything. Every project container job therefore sets
`VSTSAGENT_DOCKER_ACTION_RETRIES`, which makes the agent retry each Docker
login, pull and start, three attempts ten seconds apart. The template's `rust`
and `web` jobs take no job variable from the project, so the main pipeline's
definition in Azure DevOps (`the-test-cabinet`) sets the same variable, as a
pipeline variable, for them. Every registry login
and manifest fuse in the image jobs carries a step retry of its own. Only those
registry round trips are retried; a build runs once, so a failed one keeps its
reason in the log.

### Credentials

No job holds a stored credential. The pipelines authenticate through
workload-identity-federated service connections and a few secret pipeline
variables:

| Name | Kind | Used for |
| --- | --- | --- |
| `the-test-cabinet-acr` | Docker Registry connection | `AcrPush` and `AcrDelete` on `testcabinet.azurecr.io`: pulls the CI images, pushes them from the image pipeline and purges the stale ones, and pushes every image |
| `tcab-deploy` | Azure Resource Manager | The publish stage's registry sign-in (`AcrPush`), the registry purge after each deployment (`AcrDelete`) and the cluster deploys: the custom "Test Cabinet AKS Command Invoke" role on each cluster, "Azure Kubernetes Service RBAC Admin" on its application namespace |
| `tcab-gg-publish` | Azure Resource Manager | Storage Blob Data Contributor on `testcabinetartifacts` |
| `github-mirror-key` | Secure file | The GitHub mirror's write deploy key, one per mirror |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Secret pipeline variables | The docs deploy |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AUDIO_R2_BUCKET`, `CLOUDFLARE_AUDIO_R2_PRESIGN_ACCESS_KEY_ID`, `CLOUDFLARE_AUDIO_R2_PRESIGN_SECRET_ACCESS_KEY` | Secret pipeline variables | Staging the audio store out of the audio object store (read-only) |

The secret variables must be set on the pipeline before `master` or `staging`
builds can complete their images and deploy stages. The release pipeline needs
`the-test-cabinet-acr`, `tcab-gg-publish` and `github-mirror-key` authorized for
it, and its build identity allowed to view and queue runs of the main pipeline.

### Creating the pipelines

Each pipeline is created once, from the repository's default branch, and then
follows the YAML on whichever branch triggers it. The gates pipeline is
`the-test-cabinet` and the image pipeline `tcab-ci-images`; the release
pipeline is created beside them:

```sh
az pipelines create --org https://dev.azure.com/genyume -p the-test-cabinet \
  --name the-test-cabinet-release --repository the-test-cabinet \
  --repository-type tfsgit --branch master \
  --yml-path azure-pipelines-release.yml --skip-first-run
```

The release pipeline names the main pipeline by its name in its
`resources.pipelines` block (`the-test-cabinet`); a main pipeline registered
under another name needs that `source` changed to match.
