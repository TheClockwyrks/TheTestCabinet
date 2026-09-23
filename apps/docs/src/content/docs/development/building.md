---
title: Building
---

This page is the authoritative source for the repository layout and for the
build, format, lint, and test commands of both workspaces. The Test Cabinet is
an independent, open-source benchmark and depends only on public crates.io and
npm packages.

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
`scripts/ci/submodule-pins.sh` gates every superproject commit on this: it fails
when a pinned commit is not an ancestor of the submodule's `master` on the host
the superproject was cloned from. A superproject commit that reaches the GitHub
mirror therefore names only submodule commits the mirror already holds. The gate
fetches commits without trees or blobs, so it finishes in seconds, and
`scripts/ci/submodule-pins.test.sh` is its offline table test.

### Submodules in CI

A pipeline job that sets `submodules: true` on its checkout fetches each
submodule over HTTPS with the job's access token, because the URL is relative.
The project scopes that token to the repositories a pipeline references, so the
job names each submodule repository in a `uses:` statement. Jobs that read no
submodule leave `submodules` off. The pin gate is one of them: it reads the
token from `SYSTEM_ACCESSTOKEN` and still references the submodule repositories.

## Layout

The repository is both a Cargo workspace (Rust) and an npm workspace
(TypeScript).

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
- `crates/desktop`: `test-cabinet-desktop`. The
  [Tauri v2 desktop application](/components/tauri/overview/).
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
  from there. `scripts/ci/seeded-contract-check.sh` is the gate that keeps the
  evaluation half out of a run.
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
  and the presentational primitives; the site, web console, and desktop UI are
  thin hosts over it.
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
- `apps/desktop`: `@clockwyrks/desktop`. The React + Vite UI the Tauri
  desktop app loads.
- `apps/site`: `@clockwyrks/site`. The static
  [gallery site](/components/site/overview/) that displays published run
  records.
- `apps/web`: `@clockwyrks/web`. The browser
  [web console](/components/web/overview/) that enqueues runs at the backend.
- `apps/docs`: `@clockwyrks/docs`. This Astro Starlight documentation site.

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

## Building Rust

```sh
cargo build --workspace
```

The toolchain is pinned to an exact patch release in `rust-toolchain.toml`, and
every checkout builds with that release. Format, lint, and test with:

```sh
cargo fmt --all
cargo clippy --workspace --exclude test-cabinet-desktop --all-targets -- -D warnings
cargo doc --workspace --exclude test-cabinet-desktop --no-deps --document-private-items
cargo nextest run --workspace --exclude test-cabinet-desktop
cargo test --workspace --exclude test-cabinet-desktop --doc
```

Only the Tauri desktop shell is excluded, so per-change CI runners need none of
the desktop app's GUI system libraries.

Tests run under `cargo-nextest`, configured by `.config/nextest.toml`; install
it with `scripts/ci/install-nextest.sh`. nextest does not execute doctests, so
`cargo test --doc` runs those separately. `cargo doc` is what checks intra-doc
links, and `--document-private-items` is required for it to reach crates whose
public surface is small.

CI runs the same commands through three scripts, which are the ones to run
locally when reproducing a CI failure:

```sh
scripts/ci/rust-lint.sh       # fmt --check, clippy, doc
scripts/ci/rust-test.sh       # build, nextest run, test --doc
scripts/ci/specs-lint.sh      # markdownlint + cspell over the authored prose
```

`scripts/setup-hooks.sh` installs the pre-commit hooks, which run the formatting
gates, the [frozen-version](/development/frozen-versions/) check, the audio-pack
lint, and the seeded-spec vocabulary check on each commit. Clippy, rustdoc, and
both test suites take too long for a commit or push hook; run them locally
through the scripts above, and CI runs them on every change.

```sh
node scripts/ci/audio-packs-check.mjs
```

The audio-pack lint runs on both the commit hook and CI. It requires an
[`[audio] packs`](/testing/full-stack/manifests/#audio) declaration on every
full-stack and game-jam version that is not frozen, resolves every declared ref
against `containers/sample-packs/` for name, version, kind, and published clips,
and prints the defaults each version's pack order resolves to. It reads the
committed manifests only, so it needs no credentials.

```sh
scripts/ci/spec-vocabulary-check.sh
```

The seeded-spec vocabulary gate also runs on both the commit hook and CI. It reads
every non-frozen version's `prompt.hbs` and `specs/**`, plus the shared prompt
preambles in `crates/core/src/prompt.rs`, and fails on any word that would tell a
model it is being evaluated or that this project exists; the list is in
[Keeping evaluation out of the seeded set](/guides/authoring/writing-case-specifications/#keeping-evaluation-out-of-the-seeded-set).
Hits in frozen versions are reported, not failed. It is dependency-free and
finishes in under a second.

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
`test-cabinet-gg`, so a package-scoped build such as `-p test-cabinet-cli`, the
release binaries, or the desktop app needs none of it.

Install them once, before the first build:

```sh
scripts/ci/install-gg-toolchains.sh        # the eleven arms, ~1.9 GB, idempotent
scripts/ci/install-gg-build-toolchains.sh  # the C# guest's build tools, idempotent
npm ci                                     # the pinned tsc two arms reflect with
```

The two lists stay separate. The first is every toolchain that a gg run and gg's
reflectors execute; it is installed by the devcontainer image, the Azure
pipeline, and the run images. The second is a .NET SDK and an
unpruned wasi-sdk that exactly one arm's artifact build needs, since C#'s guest
is Mono's IL interpreter, relinked. It installs under its own prefix
`~/.local/share/tcab/gg-build/` so the eleven-arm list keeps its meaning and the
run images keep their size. With the second prefix populated,
`packages/gg-sandbox-csharp/build.sh` resolves both from it instead of fetching
its own copies.

The devcontainer image runs the installer as its last build layer and re-runs it
on create, which reconciles an image built before a pin moved. A missing
toolchain fails the build with the arm named and the fix stated. A failure naming
`node_modules` is fixed by `npm ci`.

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

The Tauri desktop shell links the system WebKitGTK and GTK shared libraries,
which have no musl-static build, so it is built against glibc. To run it on a
non-FHS host, wrap the glibc build in an FHS environment (`nix-ld`,
`buildFHSEnv`/`steam-run`, or a derivation providing `webkitgtk`).

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
`npm run dev`, `npm run lint`, `npm run test`, and `npm run typecheck`.
`npm run lint` also runs `lint:specs` and `lint:format` after the per-workspace
linters.

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
a validator that fails to compile. Both CI systems run it, through
`scripts/ci/validators-typecheck.sh`.

A project resolves the build's `../src/*` against the case's reference
implementation and the shared harness's `./case-harness/*` against
`packages/case-harness/src`, through the `rootDirs` its config declares. See
[Writing Case Specifications and Prompts](/guides/authoring/writing-case-specifications/#validators-type-check-where-they-are-authored).

Lint the authored prose with:

```sh
npm run lint:specs
```

It runs `markdownlint-cli2` over the Markdown in `test-cases/**`,
`game-jams/**`, and `apps/docs/src/content/docs/**`, then `cspell` over the
Markdown, HTML, CSS, TOML, and Handlebars under `test-cases/**` and
`game-jams/**` that a case or jam ships to a model. Add a legitimate domain term to
`.cspell/project-words.txt` when `cspell` flags it. This is the linter the
test-case authoring and variant guides refer to under "Validate your work".

Check formatting over the whole checkout with:

```sh
npm run lint:format   # check
npm run format        # rewrite
```

It runs `prettier --check` over every file in the repository: the packages, the
front ends, the documentation, and every test case's specs, validators, seeded
workspaces and reference implementations. A formatting warning anywhere fails
the check. Two things are left out: what `.prettierignore` names (build trees,
vendored copies, and the Handlebars templates prettier does not parse), and the
frozen test-case versions, which `scripts/format-check.mjs` derives from their
`.frozen` markers on each run. Azure DevOps runs it through
`scripts/ci/format-check.sh`.

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
regenerated package. `scripts/ci/contract-drift.sh` regenerates and fails on any
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
under `TCAB_BACKEND_CHECKOUT` when unset. The service images bake the same files
at `/opt/gg-reference` out of the build stage that produces the `gg` binary the
driver image ships, so a deployed console and the harness its runs execute come
from one build of one checkout. A backend with no documents serves everything
else normally and answers `503` on the two reference endpoints.

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

Five images answer for all twenty-seven variants, because `/opt/gg` is byte-identical
across them and what differs is the environment it runs in — the image the lineage
is rooted at plus every package a run image installs on the way down. `build.sh`
re-derives that grouping from the Dockerfiles on every gated build. CI passes the
same `--gg-selfcheck` flag post-merge, before the images are published.

`cargo run -p test-cabinet-gg -- selfcheck` asks the same question of this
machine's own toolchains, which is the form to run while working on an arm. See
[the self-check](/gg/languages/selfcheck/).

## Continuous integration

`azure-pipelines.yml` is the project's only CI. It gates a commit, mirrors it to
GitHub, builds its images, releases it, and deploys it. Every job delegates to a script under
`scripts/ci/`, so a failure reproduces locally by running the same script; the
scripts are listed in `scripts/ci/README.md`. Pushes to `master`, `staging`,
`nightly`, and `v*` tags trigger it. Pull requests into `master` and `staging`
run it through build validation policies on those branches, because Azure Repos
ignores a `pr:` block. A run for any other branch runs the gates only.

| Stage    | Runs on                   | What it does                                                                                                                              |
| -------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `gates`  | every run                 | Every check below, plus the static gg builds on `master`, `staging`, and tags, then the GitHub mirror                                     |
| `images` | `master`, `staging`, tags | On `master` and `staging`, every service and run-container image into `testcabinet.azurecr.io`; on `master` and tags, gg's release upload |
| `deploy` | `master`, `staging`       | Rolls the matching cluster to the commit's images and deploys the docs site                                                               |

The gates are `rust`, `binary` (Linux and Windows), `web`, `webtest`, `specs`,
`format`, `validators`, `frozen`, `audiopacks`, `specvocabulary`,
`buildcontext`, `contract`, `manifests`, which renders every kustomization and
checks the deploy set with `scripts/ci/k8s-manifests.sh`, and `submodulepins`,
which fails when a submodule pin is absent from that submodule's `master`
(`scripts/ci/submodule-pins.sh`). On `master`,
`staging`, and tags, `gg_amd64` and `gg_arm64` build the static gg binaries
natively, and on a tag build the step "gg version matches the tag" fails when
`gg --version` differs from the tag with its `v` stripped, naming `crates/gg` and
`crates/core` as the crates to bump. On a tag, `binary` also publishes the
`tcab` it smoke-tested as the run's `tcab-linux` and `tcab-windows` artifacts;
see [Releasing `tcab`](/development/releasing/#releasing-tcab).

The `mirror` job runs after every gate on `master`, `staging`, `nightly`, and
`v*` tags. It force-pushes the branch with its tags, or the tag, to
`github.com/TheClockwyrks/TheTestCabinet` with the deploy key held in the secure
file `github-mirror-key`. It is the only thing that pushes there, so the mirror
holds gated commits only.

The `images` stage builds every image natively per architecture: `amd64` on
Microsoft-hosted `ubuntu-24.04` agents and `arm64` on the organisation's arm64
pool `pool-dev-linux-arm64-wus3-4c-eph-01`. Each is pushed as
`<image>:<sha>-<arch>` and fused into the multi-arch `<image>:<sha>`; `:latest`
is never pushed. The audio store is built first, because the driver image bakes
`test-cabinet-audio-store:<sha>`. The run images are pushed only after
`gg selfcheck` passes inside each `-gg` environment. The `gg_publish` job is
described in [Releasing `gg`](/development/releasing/#releasing-gg), and the
deploy in [Kubernetes](/deployment/kubernetes/overview/#deploying).

No job holds a stored credential. The pipeline authenticates through
workload-identity-federated service connections and a few secret pipeline
variables:

| Name                                                                                                                                                | Kind                       | Used for                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tcab-acr`                                                                                                                                          | Docker Registry connection | `AcrPush` on `testcabinet.azurecr.io`                                                                                                                      |
| `tcab-deploy`                                                                                                                                       | Azure Resource Manager     | The cluster deploys: the custom "Test Cabinet AKS Command Invoke" role on each cluster, "Azure Kubernetes Service RBAC Admin" on its application namespace |
| `tcab-gg-publish`                                                                                                                                   | Azure Resource Manager     | Storage Blob Data Contributor on `testcabinetartifacts`                                                                                                    |
| `github-mirror-key`                                                                                                                                 | Secure file                | The GitHub mirror's write deploy key                                                                                                                       |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`                                                                                                     | Secret pipeline variables  | The docs deploy                                                                                                                                            |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AUDIO_R2_BUCKET`, `CLOUDFLARE_AUDIO_R2_PRESIGN_ACCESS_KEY_ID`, `CLOUDFLARE_AUDIO_R2_PRESIGN_SECRET_ACCESS_KEY` | Secret pipeline variables  | Staging the audio store out of the audio object store (read-only)                                                                                          |

The secret variables must be set on the pipeline before `master` or `staging`
builds can complete their images and deploy stages.

## Desktop app (Tauri)

The Tauri CLI drives the [desktop app](/components/tauri/overview/), building the
Rust shell (`crates/desktop`) and the `apps/desktop` UI together. It requires the
Rust toolchain and Node.js.

The desktop application is a headless core plus a graphical shell. `crates/desktop`
is the Tauri shell and serves the web UI built from `apps/desktop`; all
orchestration logic lives in `test-cabinet-core`, which is what makes batch runs
and unattended sweeps possible. During development the shell loads the Vite dev
server for `apps/desktop`; a release build loads the static assets that app's
build produces.

`crates/desktop/tauri.conf.json` bundles `test-cases/` as a resource so the app
can stage an offline checkout, and it names the directory rather than a set of
files. Every path beneath it therefore has to resolve for the shell to compile,
including the untracked `node_modules/` of any reference implementation installed
there. A reference installed against an engine dependency that has since moved
keeps a symlink to the old location, and `cargo build -p test-cabinet-desktop`
fails with `resource path ... doesn't exist` naming that symlink. Running
`npm install` in the reference's own directory relinks it against the current
dependency and clears the failure.
