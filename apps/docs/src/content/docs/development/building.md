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

Setting up a machine that executes test cases (container runtime,
run-container image, credentials) is covered by
[First Time Setup](/guides/setup/first-time-setup/). Running the services on your
own machine is covered by [Running](/development/running/).

## Cloning

The repository lives on Azure Repos and is mirrored to GitHub, and a clone from
either host works the same way. Each submodule is a separate repository, such as
[`cold-storage`](#cold-storage).

A plain clone downloads the superproject alone and leaves each submodule
directory empty. It builds and passes every gate, because nothing in the build,
the tests, or CI reads a submodule's contents. Fetch a submodule into it later
when a task needs one:

```sh
git clone <superproject-url>
git submodule update --init --depth 1 cold-storage
```

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
`.azure-pipelines/mirror.yml`, whose one job force-pushes `master` to the GitHub
repository of the same name. That job is the only writer of the mirror.

A submodule commit may be pinned once it is on that submodule's `master`. Push
the submodule commit to `master` first, then commit the moved pointer here.
`scripts/ci/submodule-pins.sh` checks this, and the pipeline's `submodule_pins`
job runs it on every push: it fails when a pinned commit is not an ancestor of
the submodule's `master` on the host the superproject was cloned from. A
superproject commit that reaches the GitHub mirror therefore names only
submodule commits the mirror already holds. The check
fetches commits without trees or blobs, so it finishes in seconds, and
`scripts/ci/submodule-pins.test.sh` is its offline table test.

### Submodules in CI

No gate reads a submodule, so the template's gate jobs check out none, which
also keeps the baseline media out of every devcontainer start. The one job that
reads `cold-storage` is
`submodule_pins`. It checks this repository out without submodules and adds an
inline checkout of `cold-storage`, which is what puts that repository in the
scope of the job's access token, then runs `scripts/ci/submodule-pins.sh` with
the token in `SYSTEM_ACCESSTOKEN`.

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
- `packages/run-stats`: `@clockwyrks/run-stats`. The framework-free rules for
  scoring a reviewed run, each mirroring a counterpart in
  `crates/core/src/review.rs`, plus the set-level rollup that keeps a figure
  frozen at one moment comparable with the same figure recomputed later. It has
  no runtime dependencies and imports only types from `run-record`, so it runs in
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
| `shell-tests` | Every `*.test.sh` under `scripts/` and `scripts/ci/` |
| `rust-fmt` | `cargo fmt --all -- --check` |
| `rust-clippy` | `cargo clippy --locked --workspace --all-targets -- -D warnings` |
| `rust-doc` | `cargo doc --locked --workspace --no-deps`, with private items (see below) |
| `rust-test` | `cargo nextest run --locked --workspace`, which skips gg's unit tests; no hook |
| `rust-doctest` | `cargo test --locked --workspace --doc`; no hook |
| `k8s-manifests` | The template's render of every overlay; see [Kubernetes](/deployment/kubernetes/overview/) |
| `web-lint` | `npm run lint`: ESLint over the TypeScript |
| `web-typecheck` | The web console's `tsc -b` |
| `web-test` | The web console's Vitest run, under jsdom |
| `web-browser-test` | The web console's Vitest run, in real browser engines |
| `web-build` | The web console's `vite build` |
| `markdownlint` | The Markdown style, from `.markdownlint-cli2.yaml`, at 90 columns |
| `cspell` | The prose's spelling, from `cspell.json` and `.cspell/project-words.txt` |
| `format` | Prettier, with `.prettierignore` as its scope (plus the k8s manifests and the case-harness fixture page) and the frozen versions left out |
| `docs-typecheck` | This site's `astro check` |
| `docs-build` | This site's build |
| `python-lint` | ruff over `ci/` |
| `ci-tests` | pytest over `ci/` |

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
| `scripts-test` | `node --test` over `scripts/lib` |
| `workspace-test` | Every npm workspace's Vitest run but the console's and this site's; no hook |
| `validators-typecheck` | `tsc` over every test case's validator projects; no hook |
| `site-build` | The gallery's build; no hook |
| `contract-drift` | The generated data contract is current; no hook |

`.pre-commit-config.yaml` runs each gate on every commit as one hook, triggered
by the files it judges, except the ones marked "no hook", which build the
workspace packages or the Rust workspace before they check anything and so run
in `make gate` and the pipeline only; `HOOKLESS` in `ci/tests/test_wiring.py`
names them, and a gate added without a hook fails there until it is either
given one or named too slow for a commit. `scripts/setup-hooks.sh` installs the
hook, and the dev container runs it when the container is created.

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
`scripts/build-gg-static.sh`, and
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
over the whole workspace from the root `eslint.config.js` (the `web-lint` gate).

`npm run test` runs `vitest` in each workspace. Iterate on the gallery's own
suite with `npm run test -w @clockwyrks/ui`. On a clean checkout, build the
workspace runtime packages first with `npm run build:packages`, since the tests
import them from a built `dist/`.

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

The run-record (and arena, job-API, backend) data contract has a single source of
truth: the Rust types that derive `ts_rs::TS` and `schemars::JsonSchema` behind
their `contract` feature, in `crates/core` and `crates/backend`. The TypeScript
bindings under `packages/run-record/src/` and `packages/asset-contract/src/` —
one generator, two packages, because only the latter may be seeded into a run —
and the JSON Schemas under `apps/docs/public/schema/` are generated from those
types by `crates/contract-codegen`. After changing any contract type, regenerate
and commit:

```sh
npm run gen:contract
```

It runs the generator, formats the output with Prettier, mirrors gg's built-in
system-prompt templates into the TypeScript contract, and compiles the
regenerated package. The `contract-drift` gate regenerates and fails on any
diff, so the Rust, TypeScript, and JSON Schema representations stay in step.

It compiles `test-cabinet-core` and `test-cabinet-backend` only, so it needs none
of gg's program-language toolchains.

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
gate, a project job, or a template job past its 60 minutes) stops every image
job, the mirror, the publish and deploy, `prod`, `gg_release` and `docs`.

### The gate jobs

The template's two gate jobs run every gate, one step per gate, in the CI image
of their track: `rust` runs the Rust gates and `contract-drift`, and `web` runs
the rest, every project gate but `contract-drift` included. Each step runs
`uv run --quiet --project ci gate run <id>`, the command a commit hook and
`make gate` run it with, so a failing check is one red step named for it.
Each upstream hook runs as `pre-commit run <id> --all-files` in a step of its
own in the `web` job. Each job is capped at 60 minutes.

The project adds steps to both through `.azure/project/setup-steps.yml` and
`.azure/project/steps.yml`:

- In `rust`: `scripts/ci/free-disk-linux.sh`, which reclaims what the
  template's own reclaim leaves; the gg toolchains, restored from the
  `gg-toolchains` cache and completed by `scripts/ci/gg-ci-toolchains.sh`, since
  the Rust CI image carries no Node and no gg toolchains; and, last,
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
and seed them. A template cannot read the pin itself (a `${{ variables.* }}`
inside an included jobs template expands to nothing), so `azure-pipelines.yml`
names the image the way its `rust` job does,
`testcabinet.azurecr.io/ubuntu-the-test-cabinet-rust-cicd:${{ variables.ciImageTag }}`,
and passes it to `jobs.yml` as its `rustImage` parameter; the release
pipeline, a root file itself, names it the same way. The `ci-image-pins` gate
fails on a root pipeline naming a CI image any other way, on the include
passing anything else, and on a file under `.azure/` naming an image at all.

| Job | Runs on | What it does |
| --- | --- | --- |
| `gg_tests_<k>_of_4` | every run | gg's unit tests, one hash partition per job: `gg-test-build.sh`, then `gg-test.sh k/4` |
| `rust_build` | every run | `rust-build.sh`, the link of every target. When no seed exists for this `Cargo.lock`, it also runs the template gates' clippy, doc and test builds and saves `target/` under a key the template `rust` job restores |
| `binary_linux` | every run | The release build and tests of `tcab`, its doctests, and the binary smoke |
| `binary_windows` | every run | The same on `windows-2022` |
| `submodule_pins` | every run | `submodule-pins.sh`; see [Submodules in CI](#submodules-in-ci) |
| `gg_amd64`, `gg_arm64` | `master`, `staging` | The static gg binary per architecture (`gg-dist.sh`) |
| `audiostore_<arch>`, `runimages_<arch>`, `services_<arch>` and their manifests | `master`, `staging` | Every image, built natively per architecture and fused by `manifest.sh`; the eight service images of an architecture on one builder, so their Rust compile happens once |
| `mirror` | `master`, `staging`, `nightly` | Force-pushes the branch to GitHub, after every check job |

`rust_build` exists because the template's `rust` job is one job capped at 60
minutes, and a pipeline cache is saved only after every step of a job
succeeded: a cold `rust` job that times out never warms its own cache. The
first run after a template update that moves the compiler, or after the cache
expires, may still time out once; queue a second run.

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

The `mirror` job force-pushes the branch with its tags to
`github.com/TheClockwyrks/TheTestCabinet`, with the deploy key held in the
secure file `github-mirror-key`. It is the only thing that pushes there, so the
mirror holds gated commits only.

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
| `testcabinet.azurecr.io/ubuntu-the-test-cabinet-web-cicd` | `web` |

`ci/images/README.md` describes each. The Rust image carries the pinned
toolchain, nextest, the musl target, and the apt packages the project's tools
need beyond a compile's, which `ci/images/rust.Dockerfile` installs (`cmake`,
`ffmpeg`, `libicu-dev`, `python3`, `ruby`, `zip`); gg's toolchains and Node
come from the `gg-toolchains` cache.

`azure-pipelines-ci-images.yml` builds the images. It triggers on the files an
image is built from and on nothing else, and every run builds both tracks and
pushes each as `<repository>:<commit>`, the commit its run is on, from the
layer cache. `ci/images/tags.yml` holds one variable, `ciImageTag`, as a
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
| `github-mirror-key` | Secure file | The GitHub mirror's write deploy key |
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
