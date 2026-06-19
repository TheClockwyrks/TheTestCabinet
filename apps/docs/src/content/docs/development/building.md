---
title: Building
---

This page covers the repository layout and how to build it locally. The Test
Cabinet is a fully independent, open-source benchmark; it depends only on public
crates.io and npm packages. For setting up a machine to actually *run* test cases
(container runtime, run-container image, credentials) see
[First Time Setup](/guides/first-time-setup/); for running the services locally
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
- `crates/worker` — `test-cabinet-worker` (binary `tcab-worker`). The
  [worker](/components/worker/overview/), an HTTP server that exposes the core's
  run functionality so runs can be driven on a remote host.
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

The `cli`, `worker`, `backend`, and `desktop` crates all depend on
`test-cabinet-core` (and on `test-cabinet-telemetry` for instrumentation). Shared
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
  drives runs against remote workers.
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
`tcab` CLI, the `tcab-worker` server, and the `tcab-backend` store/API. (The
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

cargo build-portable-worker
# -> target/x86_64-unknown-linux-musl/release/tcab-worker   (statically linked)

cargo build-portable-backend
# -> target/x86_64-unknown-linux-musl/release/tcab-backend  (statically linked)
```

The `tcab-worker` server lets you drive runs from the web UI against a worker
running on your own host (point the UI at its `TCAB_WORKER_BIND` address; see the
[worker configuration](/components/worker/overview/) for the environment it
expects). The static binary removes the glibc/loader dependency but **not** the
container runtime the worker orchestrates — the host still needs Podman or Docker
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
