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

- `packages/run-record`: `@test-cabinet/run-record`. Shared TypeScript types
  and JSON Schema for the [run record](/components/core/run-records/), the
  central data contract.
- `packages/run-stats`: `@test-cabinet/run-stats`. The framework-free rules for
  scoring a reviewed run, each mirroring a counterpart in
  `crates/core/src/review.rs`, plus the set-level rollup that keeps a figure
  frozen at one moment comparable with the same figure recomputed later. It has
  no runtime dependencies and imports only types from `run-record`, so it runs in
  a bundle, a build script, or a worker alike. `packages/ui`'s `ratings` module
  re-exports the scoring half alongside its display metadata.
- `packages/browser-driver`: `@test-cabinet/browser-driver`. The Playwright
  driver script the [validator](/components/core/validation/) shells out to,
  used to render reference mockups and to drive and screenshot a produced
  implementation.
- `packages/ui`: `@test-cabinet/ui`. The shared
  [UI library](/components/ui/overview/) hosting the routed gallery application
  and the presentational primitives; the site, web console, and desktop UI are
  thin hosts over it.
- `packages/voxel-runtime` and `packages/particle-runtime`. The runtimes that
  pose and render a produced voxel rig and simulate a produced particle system.
- `packages/gg-sandbox`: the TypeScript and JavaScript arm of gg's
  responses-as-code sandbox.
- `apps/desktop`: `@test-cabinet/desktop`. The React + Vite UI the Tauri
  desktop app loads.
- `apps/site`: `@test-cabinet/site`. The static
  [gallery site](/components/site/overview/) that displays published run
  records.
- `apps/web`: `@test-cabinet/web`. The browser
  [web console](/components/web/overview/) that enqueues runs at the backend.
- `apps/docs`: `@test-cabinet/docs`. This Astro Starlight documentation site.

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
the desktop app's GUI system libraries. The desktop app is built and bundled for
every platform by the [release](/development/releasing/) workflow.

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

`scripts/setup-hooks.sh` installs the pre-commit hooks, which run the formatting,
clippy, and doc gates, the front-end test suite, and the
[frozen-version](/development/frozen-versions/) check on each commit. The
front-end suite is a commit gate because it completes in seconds; the Rust test
suite runs in CI.

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
the pre-commit clippy and doc hooks, `scripts/build-gg-static.sh`, and
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
reflectors execute; it is installed by the devcontainer image, both CI systems,
the release workflow, and the run images. The second is a .NET SDK and an
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

Then build with the aliases defined in `.cargo/config.toml`, each of which
writes to `target/x86_64-unknown-linux-musl/release/`:

| Alias | Binary |
| --- | --- |
| `cargo build-portable` | `tcab` |
| `cargo build-portable-backend` | `tcab-backend` |
| `cargo build-portable-dispatcher` | `tcab-dispatcher` |
| `cargo build-portable-driver` | `tcab-driver` |
| `cargo build-portable-artifacts` | `tcab-artifacts` |
| `cargo build-portable-gg` | `gg` |

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
`npm run lint` also runs `lint:specs` after the per-workspace linters.

`npm run test` runs `vitest` in each workspace and is one of the pre-commit
gates. Iterate on the gallery's own suite with `npm run test -w
@test-cabinet/ui`. On a clean checkout, build the workspace runtime packages
first with `npm run build:packages`, since the tests import them from a built
`dist/`.

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

## Generating the data contract

The run-record (and arena, job-API, backend) data contract has a single source of
truth: the Rust types that derive `ts_rs::TS` and `schemars::JsonSchema` behind
their `contract` feature, in `crates/core` and `crates/backend`. The TypeScript
bindings under `packages/run-record/src/` and the JSON Schemas under
`apps/docs/public/schema/` are generated from those types by
`crates/contract-codegen`. After changing any contract type, regenerate and
commit:

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
