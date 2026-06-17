---
title: Building
---

This page covers the repository layout and how to build it locally. The Test
Cabinet is a fully independent, open-source benchmark; it depends only on public
crates.io and npm packages. For setting up a machine to actually *run* test cases
(container runtime, harness images, credentials) see
[First Time Setup](/guides/first-time-setup/); for cutting a release and
deploying the sites see [Releasing & Deployment](/development/releasing/).

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
- `crates/desktop` — `test-cabinet-desktop`. The
  [Tauri v2 desktop application](/components/tauri/overview/), the primary
  interactive way to configure, launch, and review runs locally.

`cli` and `desktop` both depend on `test-cabinet-core`. Shared dependency
versions are declared once in the root `Cargo.toml` under
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
- `apps/desktop` — `@test-cabinet/desktop`. The React + TypeScript + Vite UI that
  is loaded by the Tauri desktop app.
- `apps/site` — `@test-cabinet/site`. The React + TypeScript + Vite static
  [gallery site](/components/site/overview/) that displays published run records.
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

### Portable (static) `tcab` build

The default build dynamically links against glibc and the generic FHS dynamic
loader (`/lib64/ld-linux-x86-64.so.2`), which is right for mainstream Linux such
as Ubuntu. Distributions that do not ship that loader — notably NixOS — cannot
run such a binary directly.

For those, build a fully static `tcab` via the musl target. A static binary has
no dynamic linker, so it runs anywhere, including NixOS. This is opt-in and does
not change the default build. Prerequisites:

```sh
rustup target add x86_64-unknown-linux-musl
# plus a musl C toolchain on PATH (provides `musl-gcc`), because the `ring` TLS
# backend compiles a little C. On Debian/Ubuntu: `apt-get install musl-tools`.
```

Then build with the alias defined in `.cargo/config.toml`:

```sh
cargo build-portable
# -> target/x86_64-unknown-linux-musl/release/tcab  (statically linked)
```

Only the `tcab` CLI is built this way; the Tauri desktop shell is not portable to
musl. A convenient workflow is to build the static binary in a mainstream-Linux
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
