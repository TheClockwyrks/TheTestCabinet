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
- `packages/browser-driver` — `@test-cabinet/browser-driver`. A small Playwright
  driver script (`driver.mjs`) the validator shells out to, used both to render
  reference mockups to screenshots and to drive and screenshot a produced
  implementation for a validation check.
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

#### Portable (static) `tcab` build

The default build dynamically links against glibc and the generic FHS dynamic
loader (`/lib64/ld-linux-x86-64.so.2`), which is right for mainstream Linux such
as Ubuntu. Distributions that do not ship that loader — notably NixOS — cannot
run such a binary directly.

For those, build a fully static `tcab` via the musl target. A static binary has
no dynamic linker, so it runs anywhere, including NixOS. This is opt-in and does
not change the default build.

Prerequisites:

```sh
rustup target add x86_64-unknown-linux-musl
# plus a musl C toolchain on PATH (provides `musl-gcc`), because the `ring` TLS
# backend compiles a little C. On Debian/Ubuntu: `apt-get install musl-tools`.
```

Then:

```sh
cargo build-portable   # alias in .cargo/config.toml
# -> target/x86_64-unknown-linux-musl/release/tcab  (statically linked)
```

Only the `tcab` CLI is built this way; the Tauri desktop shell is not portable to
musl. A convenient workflow is to build the static binary in a mainstream-Linux
environment (for example a container) and copy the single binary to the host.

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

## Running a test case

A run is driven by the `tcab` CLI over a container runtime. Prerequisites:

1. **A container runtime** — Podman (preferred) or Docker on `PATH`. The runtime
   is auto-detected; override it with `TCAB_CONTAINER_RUNTIME=<binary>`.
2. **The harness images** — build the run-container images once (see
   `containers/README.md`):

   ```sh
   cd containers && DOCKER=podman ./build.sh claude   # base + the claude image
   ```

3. **An API key** for the chosen harness, exported into the environment. Each
   harness reads a specific variable — for example `ANTHROPIC_API_KEY` for
   `claude`, `OPENAI_API_KEY` for `codex`, and `OPENROUTER_API_KEY` for the
   OpenRouter-backed harnesses. The key is passed into the run container as a
   secret and is never written into the seeded repository.
4. **A headless browser**, for rendering reference screenshots (seeded as visual
   targets) and running validation checks. Install the Playwright browser once
   from the repository root with `npx playwright install chromium`; the validator
   locates `packages/browser-driver/driver.mjs` relative to the working directory
   (override with `TCAB_BROWSER_DRIVER`). This is optional — without it, runs
   still complete, but no reference images are seeded and checks record as not
   reached. Where Playwright cannot find its own bundled browser — notably on
   NixOS, whose `playwright-driver.browsers` layout differs from what Playwright
   probes — point `TCAB_CHROMIUM_EXECUTABLE` at a real Chromium binary (for
   example `${pkgs.chromium}/bin/chromium`) and the driver launches that instead.

Then launch a run from the repository root (so the `test-cases/` catalog and the
browser driver are found; override the catalog location with
`TCAB_TEST_CASES_DIR`):

```sh
cargo run -p test-cabinet-cli -- run \
  --test-case pong --version v1.0.0 \
  --harness claude --model anthropic/claude-opus-4 \
  --out-dir runs
```

This renders the reference mockups to screenshots, seeds a fresh repository (with
the specification and those screenshots), runs the harness in a container,
collects the produced implementation, builds and load-checks it, runs the
declared validation checks, and writes `runs/<id>/run-record.json` alongside a
copy of the implementation. Check harness availability without starting a run (a
cost-free `--version` probe) with:

```sh
cargo run -p test-cabinet-cli -- harnesses
```
