# Development

This document explains the workspace layout and how to build it. The Test
Cabinet is a fully independent, open-source benchmark; it depends only on public
crates.io and npm packages.

## Layout

The repository is both a Cargo workspace (Rust) and an npm workspace
(TypeScript).

### Rust (Cargo workspace)

- `crates/core` — `test-cabinet-core` (lib `test_cabinet_core`). The headless
  core that owns all orchestration: resolving a test case version, seeding a
  run's repository, executing the run in a container, invoking the agent
  harness, collecting metrics, running validation, and writing the run record.
- `crates/cli` — `test-cabinet-cli` (binary `tcab`). A command line interface
  over the core so runs can be scripted and benchmark sweeps run in batch.
- `crates/desktop` — `test-cabinet-desktop`. The Tauri v2 desktop application,
  the primary interactive way to configure, launch, and review runs locally.

`cli` and `desktop` both depend on `test-cabinet-core`. Shared dependency
versions are declared once in the root `Cargo.toml` under
`[workspace.dependencies]` and inherited by member crates with
`{ workspace = true }`.

### TypeScript (npm workspace)

- `packages/run-record` — `@test-cabinet/run-record`. Shared TypeScript types and
  JSON Schema for the run record, the central data contract. Apps depend on this
  package for types.
- `apps/desktop` — `@test-cabinet/desktop`. The React + TypeScript + Vite UI that
  is loaded by the Tauri desktop app.
- `apps/site` — `@test-cabinet/site`. The React + TypeScript + Vite static
  gallery site that displays published run records.

## How the Tauri app and UI relate

The desktop application is a headless-core-plus-graphical-shell design. The Rust
crate `crates/desktop` is the Tauri shell; it embeds and serves the web UI built
from `apps/desktop`. All orchestration logic lives in `test-cabinet-core`, not in
the UI, which is what makes batch runs and unattended sweeps possible. During
development the Tauri shell loads the Vite dev server for `apps/desktop`; for a
release build it loads the static assets produced by `apps/desktop`'s build.

## Building

### Rust

```sh
cargo build --workspace
```

Format and lint with the pinned toolchain (see `rust-toolchain.toml`):

```sh
cargo fmt --all
cargo clippy --workspace
```

### TypeScript

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

### Desktop app (Tauri)

The Tauri CLI drives the desktop app, building the Rust shell and the
`apps/desktop` UI together. Requires the Rust toolchain and Node.js installed.
