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
- `packages/run-stats` — `@test-cabinet/run-stats`. The framework-free rules for
  scoring a reviewed run (each mirroring a counterpart in
  `crates/core/src/review.rs`) and for rolling a set of runs up into figures. It
  has no runtime dependencies and imports only *types* from `run-record`, so it
  runs in a bundle, a build script, or a worker alike. Its rollup is what makes a
  figure frozen at one moment and the same figure recomputed later comparable,
  rather than two implementations that drift. `packages/ui`'s `ratings` module
  re-exports the scoring half alongside the display metadata (labels, emoji) it
  keeps.
- `packages/share-links` — `@test-cabinet/share-links`. The framework-free
  short-link contract: how a run id becomes the short code in a `tcab.ai` link and
  back, the `share-index.json` the gallery build publishes, and the preview meta
  tags a shared link unfurls into. Shared because three things must agree about a
  link — the gallery build that mints the codes, the gallery that tags its own run
  pages, and the resolver on the short domain.
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
- `apps/edge` — `@test-cabinet/edge`. The Cloudflare Worker behind the `tcab.ai`
  short domain, which resolves a run's short code to its page on the gallery and
  answers a crawler with the run's preview card. Deployed with `wrangler`; see
  [Releasing](/development/releasing/).
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
