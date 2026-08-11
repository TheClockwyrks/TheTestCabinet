---
title: Building
---

This page covers the repository layout and how to build it locally. The Test
Cabinet is a fully independent, open-source benchmark; it depends only on public
crates.io and npm packages. For setting up a machine to actually *run* test cases
(container runtime, run-container image, credentials) see
[First Time Setup](/guides/setup/first-time-setup/); for running the services locally
see [Running](/development/running/); for cutting a release and deploying the
static sites see [Releasing](/development/releasing/); and for standing up the
services on real hosts see [Deployment](/deployment/overview/).

## Layout

The repository is both a Cargo workspace (Rust) and an npm workspace
(TypeScript).

### Rust (Cargo workspace)

- `crates/core` — `test-cabinet-core` (lib `test_cabinet_core`). The headless
  [core](/components/core/overview/) that owns all orchestration: resolving a
  test case version, seeding a run's repository, executing the run in a
  container, invoking the agent harness, collecting metrics, running validation,
  and writing the run record.
- `crates/cli` — `test-cabinet-cli` (binary `tcab`). The
  [command line interface](/components/cli/overview/) over the core so runs can
  be scripted and benchmark sweeps run in batch.
- `crates/dispatcher` — `test-cabinet-dispatcher` (binary `tcab-dispatcher`). The
  [dispatcher](/components/dispatcher/overview/), which claims queued runs from the
  backend and creates a per-run Kubernetes `Job`.
- `crates/driver` — `test-cabinet-driver` (binary `tcab-driver`). The
  [driver](/components/driver/overview/), the per-run executor that exposes the
  core's run functionality so a single run can be executed server-side.
- `crates/artifacts` — `test-cabinet-artifacts` (binary `tcab-artifacts`). The
  [artifact service](/components/artifacts/overview/), which retains and serves the
  trees a run produces.
- `crates/backend` — `test-cabinet-backend` (binary `tcab-backend`). The
  [backend](/components/backend/overview/), the private definition/run store and
  API. Its system of record is a SeaORM database — embedded SQLite by default, or
  PostgreSQL when `TCAB_BACKEND_DATABASE_URL` points at one.
- `crates/desktop` — `test-cabinet-desktop`. The
  [Tauri v2 desktop application](/components/tauri/overview/), the primary
  interactive way to configure, launch, and review runs locally.
- `crates/telemetry` — `test-cabinet-telemetry`. The shared
  [OpenTelemetry](/development/observability/) wiring every long-lived binary
  initializes at startup.

The `cli`, `dispatcher`, `driver`, `artifacts`, `backend`, and `desktop` crates all
depend on `test-cabinet-core` (and on `test-cabinet-telemetry` for instrumentation,
where they bind a socket or run a control loop). Shared
dependency versions are declared once in the root `Cargo.toml` under
`[workspace.dependencies]` and inherited by member crates with
`{ workspace = true }`.

### TypeScript (npm workspace)

- `packages/run-record` — `@test-cabinet/run-record`. Shared TypeScript types and
  JSON Schema for the [run record](/components/core/run-records/), the central
  data contract. Apps depend on this package for types.
- `packages/browser-driver` — `@test-cabinet/browser-driver`. A small Playwright
  driver script (`driver.mjs`) the [validator](/components/core/validation/)
  shells out to, used both to render reference mockups to screenshots and to
  drive and screenshot a produced implementation for a validation check.
- `packages/ui` — `@test-cabinet/ui`. The shared
  [UI library](/components/ui/overview/) that hosts the full routed gallery
  application plus the presentational primitives; the site, web console, and
  desktop UI are thin hosts over it.
- `apps/desktop` — `@test-cabinet/desktop`. The React + TypeScript + Vite UI that
  is loaded by the Tauri desktop app.
- `apps/site` — `@test-cabinet/site`. The React + TypeScript + Vite static
  [gallery site](/components/site/overview/) that displays published run records.
- `apps/web` — `@test-cabinet/web`. The browser
  [web console](/components/web/overview/) (React + TypeScript + Vite) that
  enqueues runs at the backend (drained into per-run driver Jobs).
- `apps/docs` — `@test-cabinet/docs`. This Astro Starlight documentation site.

## Building Rust

```sh
cargo build --workspace
```

Format and lint with the pinned toolchain (declared in `rust-toolchain.toml`):

```sh
cargo fmt --all
cargo clippy --workspace
```

### `gg` and its eleven toolchains

One crate in the workspace is not built by the Rust toolchain alone.
[`test-cabinet-gg`](/gg/overview/) drives a model in one of **eleven program languages**, and
what a model is told about each language's surface — every module, signature, argument, type
and type member — is a *signature catalogue* reflected out of that language's own SDK by that
language's own documentation tool. Those catalogues are **not committed**. `crates/gg/build.rs`
generates all eleven as a step of building the crate, into the build's `OUT_DIR`, and the arm
modules `include_str!` them from there. See
[the catalogue](/gg/program-languages/#the-catalogue) for why that is worth the cost: a
committed copy is a claim about source that is checked once and never again, and when it is
wrong what it costs is a model told about a function the guest does not export.

The cost is that **anything which compiles `crates/gg` wants eleven documentation toolchains
present** — which is `cargo build --workspace`, `cargo clippy --workspace`,
`cargo doc --workspace`, the two pre-commit hooks that run those, `npm run gen:contract`, and
`scripts/build-gg-static.sh`. Nothing else in the workspace depends on `test-cabinet-gg`, so a
package-scoped build (`-p test-cabinet-cli`, the release binaries, the desktop app) needs none
of this.

Install them once, before the first build:

```sh
scripts/ci/install-gg-toolchains.sh   # every arm's documentation tool, idempotent
npm ci                                # the pinned `tsc` two of the arms are reflected with
```

The devcontainer image runs that installer as its last build layer, so a container arrives with
all of it already there and re-runs the installer on create only to reconcile an image built
before a pin moved (about 0.2 s when it is current); every CI surface that builds or lints gg
runs it too. That is the whole argument for generating rather than committing: this
repository is developed in one environment on purpose, so a toolchain it requires is a
toolchain it installs, and committing an artifact so a developer can skip an install defeats
the point of the devcontainer and of the artifact at once. The installer covers `uv` (for
griffe), the `wasm32-unknown-unknown` standard library (for rustdoc), `purs`, a JDK, the Kotlin
compiler, the Swift toolchain, wasi-sdk, .NET, and YARD in the system Ruby.

The build fails **loudly** when one is missing, naming the arm and the fix, rather than
emitting an empty catalogue — a build that quietly hands a model no surface at all is the worst
outcome available here. If a build stops with a sentence about `node_modules`, run `npm ci`; if
it stops naming a toolchain, run the installer above.

To **read** a catalogue — which is how reflector bugs are found, since a dropped `@return`
paragraph or a truncated parameter description is invisible in the SDK and obvious in the
emitted JSON — run the same script the build runs:

```sh
scripts/gg-signatures.sh              # -> target/gg-signatures/<language>.signatures.json
scripts/gg-signatures.sh /tmp/sigs    # -> anywhere else you like
```

That script is the single list of gg's arms in the repository; `build.rs` calls it rather than
repeating it. Both destinations are gitignored, as is
`crates/gg/src/sandbox/guests/*.signatures.json`, where the catalogues used to be committed —
nothing writes there any more and nothing may commit one again.

### Portable (static) builds

The default build dynamically links against glibc and the generic FHS dynamic
loader (`/lib64/ld-linux-x86-64.so.2`), which is right for mainstream Linux such
as Ubuntu. Distributions that do not ship that loader — notably NixOS — cannot
run such a binary directly.

For those, build a fully static binary via the musl target. A static binary has
no dynamic linker, so it runs anywhere, including NixOS. This is opt-in and does
not change the default build. Three headless binaries can be built this way — the
`tcab` CLI, the `tcab-driver` run executor, and the `tcab-backend` store/API. (The
backend's SeaORM SQLite driver compiles SQLite from vendored C source with the
same musl toolchain, so it links statically too; its PostgreSQL driver is pure
Rust over rustls.) Prerequisites:

```sh
rustup target add x86_64-unknown-linux-musl
# plus a musl C toolchain on PATH (provides `musl-gcc`), because the `ring` TLS
# backend and bundled SQLite compile a little C. On Debian/Ubuntu:
# `apt-get install musl-tools`.
```

Then build with the aliases defined in `.cargo/config.toml`:

```sh
cargo build-portable
# -> target/x86_64-unknown-linux-musl/release/tcab          (statically linked)

cargo build-portable-driver
# -> target/x86_64-unknown-linux-musl/release/tcab-driver   (statically linked)

cargo build-portable-backend
# -> target/x86_64-unknown-linux-musl/release/tcab-backend  (statically linked)
```

The `tcab-driver` executor runs a single run server-side (under its `cli` runtime
it shells out to a host container runtime; see the
[driver configuration](/components/driver/overview/) for the environment it
expects). The static binary removes the glibc/loader dependency but **not** the
container runtime the driver orchestrates — the host still needs Podman or Docker
on `PATH`, plus the harness API key(s) for the harnesses you run.

The Tauri desktop shell is **not** portable to musl: its Linux backend links the
system WebKitGTK and GTK shared libraries, which have no musl-static build. To
run the desktop app on a non-FHS host such as NixOS, wrap the normal glibc build
with an FHS environment (`nix-ld`, `buildFHSEnv`/`steam-run`, or a Nix derivation
that provides `webkitgtk`) rather than building it statically.

A convenient workflow is to build the static binary in a mainstream-Linux
environment (for example a container) and copy the single binary to the host.

#### Building `gg` for the run container (and k3d)

For [`gg`](/gg/overview/), the Test Cabinet's own in-container coding harness, the
static build is not just a portability convenience — it is how gg runs at all. gg
executes **inside** the run container, and a run's image varies by test type: most
are glibc Debian bookworm, but the blender image is Ubuntu. A statically linked
musl `gg` has no libc/loader dependency, so the **one** binary runs across every
run-container image (a glibc `gg` built on a newer host fails with `GLIBC_… not
found` in an older image).

There are two ways to build it:

```sh
# Release/CI build (x86_64), matching the other `build-portable-*` aliases:
cargo build-portable-gg
# -> target/x86_64-unknown-linux-musl/release/gg   (statically linked)

# Arch-adaptive build for the HOST architecture — use this in the dev container
# (aarch64 on Apple Silicon) for a local k3d cluster. It picks the right musl
# target, wires up `musl-gcc`, and prints the built binary's path:
scripts/build-gg-static.sh            # -> …/<host-arch>-unknown-linux-musl/release/gg
scripts/build-gg-static.sh /out/gg    # …and also copies it to /out/gg
```

You rarely need to run these by hand for a cluster: the **driver image bakes gg in**
automatically. Its build stage runs `scripts/build-gg-static.sh` for the image's
platform and installs the result at `/usr/local/lib/tcab/gg`, with
`TCAB_GG_BINARY` pointed at it. So `make -C deployments/local local-up` (or just
`make -C deployments/local images`) produces a driver image carrying gg, and a
Kubernetes run installs gg **locally** — core (running in the driver pod) reads it
from there and copies it into each sandbox run pod — with no GitHub release and no
cluster network egress. Set `TCAB_GG_INSTALL=release` to pull a published release
instead (the default release asset is the `…-unknown-linux-musl` build). See
[`gg` installation & distribution](/gg/overview/#installation--distribution).

## Building TypeScript

Install all workspace dependencies from the repository root:

```sh
npm install
```

Build every TypeScript workspace (apps and packages):

```sh
npm run build
```

Other root scripts delegate to each workspace that defines them: `npm run dev`,
`npm run lint`, `npm run test`, and `npm run typecheck`.

Lint the authored **test-case specs** — the Markdown, and the spelling of the
prose, TOML, and HTML under `test-cases/**` a case ships to a model — with:

```sh
npm run lint:specs
```

It runs `markdownlint-cli2` and `cspell` over that tree. If `cspell` flags a
legitimate domain term, add it to `.cspell/project-words.txt` rather than
rewording good prose to dodge the dictionary. This is the linter the test-case
authoring and variant guides refer to under **Validate your work**.

## Generating the data contract

The run-record (and arena/job-API/backend) data contract has a single source of
truth: the Rust types that derive `ts_rs::TS` + `schemars::JsonSchema` behind
their `contract` feature (in `crates/core` and `crates/backend`).
The TypeScript bindings under `packages/run-record/src/` and the JSON Schemas
under `apps/docs/public/schema/` are **generated** from those types by
`crates/contract-codegen` — never hand-edited. After changing any contract type,
regenerate and commit:

```sh
npm run gen:contract
```

This runs the generator (`cargo run -p contract-codegen`) and formats the output
with Prettier. CI (`scripts/ci/contract-drift.sh`) regenerates and fails on any
diff, so a contract change that is not regenerated and committed turns the build
red — the Rust, TypeScript, and JSON Schema representations can never drift apart.

The same command also refreshes `crates/backend/src/gg_reference.json`, the
projection of gg's model-facing surface the console's Reference page is served
from, by running `gg reference`. That step **builds `test-cabinet-gg`**, so it
wants the toolchains described under
[`gg` and its eleven toolchains](#gg-and-its-eleven-toolchains) above; on a
machine without them this command fails in the build rather than in the
generator.

## Desktop app (Tauri)

The Tauri CLI drives the [desktop app](/components/tauri/overview/), building the
Rust shell (`crates/desktop`) and the `apps/desktop` UI together. It requires the
Rust toolchain and Node.js installed.

The desktop application is a headless-core-plus-graphical-shell design. The Rust
crate `crates/desktop` is the Tauri shell; it embeds and serves the web UI built
from `apps/desktop`. All orchestration logic lives in `test-cabinet-core`, not in
the UI, which is what makes batch runs and unattended sweeps possible. During
development the Tauri shell loads the Vite dev server for `apps/desktop`; for a
release build it loads the static assets produced by `apps/desktop`'s build.
