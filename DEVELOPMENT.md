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

#### Releasing the `tcab` binary

Public releases are cut on **GitHub** (the Azure DevOps repository is private to
the org), driven by two manual workflows. The process is deliberately two-phase
so binaries are tested before they reach users:

1. Run the **Release** workflow (`release.yml`, `workflow_dispatch`) with the
   version tag (for example `v0.1.0`). It builds `tcab` for Linux (static musl),
   Windows, and macOS; smoke-tests each binary on its own platform with
   `scripts/ci/smoke-binary.sh`; and publishes the archives — with a
   `SHA256SUMS` — to a GitHub **prerelease** at that tag. Re-running for the same
   tag refreshes its assets.
2. Download the prerelease binaries and exercise them.
3. Once satisfied, run the **Release (promote)** workflow (`release-promote.yml`)
   with the same tag to flip the prerelease into the latest full release. It does
   **not** rebuild, so the exact binaries you tested are the ones published.

The per-platform smoke check is the same `scripts/ci/smoke-binary.sh` the CI
binary job runs, so binaries are validated both continuously (Azure, on Linux and
Windows) and again on the shipped artifacts (the Release workflow, on every
platform).

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
   is auto-detected; override it with `TCAB_CONTAINER_RUNTIME=<binary>`. Runs
   always execute Linux containers, so the platform expectations are:
   - **Linux** — rootless Podman runs containers directly on the host. `tcab`
     adds `--userns=keep-id` so the mounted repository stays writable by the run
     user.
   - **macOS** — Podman runs containers inside its managed Linux VM
     (`podman machine init && podman machine start`). The `keep-id` mapping is
     not used (the host user has no meaning inside the VM). The VM shares your
     home directory by default but **not** the OS temp directory, so `tcab`
     stages a run's mountable inputs under `~/.tcab` rather than `$TMPDIR`
     (see below).
   - **Windows** — Podman runs on its WSL2 backend, so **WSL must be installed**
     (`wsl --install`) before `podman machine init`. `tcab` is detected as
     `podman.exe`, the `keep-id` mapping is skipped, and the staged repository's
     Windows path (for example `C:\Users\you\.tcab\...`) is rewritten to its WSL
     mount form (`/mnt/c/Users/you/.tcab/...`) when it is bind-mounted.

   On Apple Silicon, `podman machine` is `arm64`, so harness images build and run
   `arm64` by default; build/run with `--platform linux/amd64` (emulated) only if
   a harness CLI ships no `arm64` build.

   Where a run stages its mountable inputs (the seeded repository, collected
   artifacts, and capture scratch) is resolved as `--work-dir`, then
   `TCAB_WORK_DIR`, then `~/.tcab`. It must be a path the runtime can mount; on
   macOS and Windows that rules out the OS temp directory, which is why the
   default is home-based rather than under `$TMPDIR`.
2. **The harness images** — build the run-container images once (see
   `containers/README.md`):

   ```sh
   cd containers && DOCKER=podman ./build.sh claude   # base + the claude image
   ```

3. **An API key** for the chosen harness, either exported into the environment
   or placed in a `.env` file. Each harness reads a specific variable — for
   example `ANTHROPIC_API_KEY` for `claude`, `OPENAI_API_KEY` for `codex`, and
   `OPENROUTER_API_KEY` for the OpenRouter-backed harnesses. The `tcab` CLI
   loads a `.env` from the working directory (or any parent) on startup; copy
   `.env.example` to `.env` and fill in the keys. Variables already exported in
   the shell take precedence over the file. The key is passed into the run
   container as a secret and is never written into the seeded repository.
4. **A headless browser**, for rendering reference screenshots (seeded as visual
   targets) and running validation checks. Install the Playwright browser once
   from the repository root with
   `npm exec -w @test-cabinet/browser-driver -- playwright install chromium`
   (running it through the workspace that pins Playwright installs the Chromium
   revision the driver expects; a bare `npx playwright` is not hoisted to the root
   and would fetch a different version); the validator
   locates `packages/browser-driver/driver.mjs` relative to the working directory
   (override with `TCAB_BROWSER_DRIVER`). A `run` will not start unless every one
   of the selected variant's reference mockups renders, since those screenshots
   are both the seeded visual targets and the validation baselines; a render
   failure aborts the run before a harness session is spent. (The `seed`,
   `validate`, and `catalog` commands still degrade per-view rather than abort.)
   The driver resolves the `playwright` package from a walkable `node_modules`
   (an `npm install`) or, failing that, from `NODE_PATH` — so a Nix-provided
   `playwright`/`playwright-driver` works without an npm install, since ESM's bare
   `import` ignores `NODE_PATH` but the driver resolves through CommonJS, which
   honors it. Where Playwright cannot find its own bundled browser — notably on
   NixOS, whose `playwright-driver.browsers` layout differs from what Playwright
   probes — point `TCAB_CHROMIUM_EXECUTABLE` at a real Chromium binary (for
   example `${pkgs.chromium}/bin/chromium`) and the driver launches that instead.

Then launch a run from the repository root (so the `test-cases/` catalog and the
browser driver are found; override the catalog location with
`TCAB_TEST_CASES_DIR`):

```sh
cargo run -p test-cabinet-cli -- run \
  --test-case pong --version v1.0.0 --variant base \
  --harness claude --model anthropic/claude-opus-4 \
  --out-dir runs
```

A run targets exactly one variant of the case, selected with `--variant` (it is
required). This renders the reference mockups to screenshots, seeds a fresh
repository (with the selected variant's specs and those screenshots), renders the
prompt from the version's `prompt.hbs` and hands it to the harness in a container,
collects the produced implementation, builds and load-checks it, runs the
declared validation checks, and writes `runs/<id>/run-record.json` (which records
the variant) alongside a copy of the implementation. The prompt is rendered and
handed to the harness, not seeded into the repository; inspect the exact prompt
a run would send with:

```sh
cargo run -p test-cabinet-cli -- prompt \
  --test-case pong --version v1.0.0 --variant base
```

Check harness availability without starting a run (a cost-free `--version` probe)
with:

```sh
cargo run -p test-cabinet-cli -- harnesses
```

## Publishing runs

A finished run under `runs/<id>/` is local until it is published. Publishing is
an explicit, idempotent, batch-capable operation exposed as `tcab publish` that
releases a run's outputs to public hosting and adds it to the gallery dataset.
The sections below describe the canonical deployment; the benchmark itself does
not require these specific hosts, but this is the configuration the project
publishes to.

### Reviewing a run before publishing

Every published run must carry a hand-written
[review](./apps/docs/src/content/docs/results.md#reviews): a writeup and a rating, authored after
playing the build. Write it as `runs/<id>/writeup.md`, beside the run's
`run-record.json`, with the rating in YAML frontmatter:

```markdown
---
rating: great
---

Movement and collision feel right. The pause menu doesn't restore keyboard
focus, but it doesn't block play.
```

The rating must be one of `flawless`, `great`, `scuffed`, or `broken` (see
[Results](./apps/docs/src/content/docs/results.md#reviews) for what each tier means), and the body must
not be empty. Preview exactly how the review will appear by running the run
locally (see below) before publishing — the rating badge and writeup show on the
run's page just as they will once live.

`tcab publish` refuses to publish a run whose `writeup.md` is missing or whose
frontmatter has no valid rating, and a missing review in a batch stops the whole
batch before anything is released. (`--dry-run` lists each run's rating so you
can confirm the batch is reviewed before publishing for real.)

### Previewing unpublished runs locally

You can view and play produced-but-unpublished runs in the gallery before
publishing anything. With the dev server running:

```sh
npm run dev -w @test-cabinet/site
```

a dev-only Vite plugin (`apps/site/vite-plugin-local-runs.ts`) scans `runs/` and
serves each run's `run-record.json` to the gallery, marked **Unpublished**.
Where a run's implementation has been built (its `dist/`, `build/`, or `out/`
directory exists, e.g. from validation), the run's detail page embeds and plays
that local build directly — no hosting required. A run's `writeup.md` (with its
rating) is served too, so a review previews exactly as it will once published.
Records that predate the current run-record schema are skipped (and logged).
Point the plugin at a different directory with `TTC_RUNS_DIR=/path/to/runs`.

This is strictly a dev convenience: the plugin is `apply: "serve"` only, so
`vite build` still emits a fully static, backend-free bundle, and these on-disk
runs are never published as a side effect — only `tcab publish` does that. Until
real runs are published, the gallery falls back to design-preview samples
(`apps/site/src/data/sampleRuns.ts`); any local run replaces them.

A publish releases three things:

- **Source** — each run's collected implementation is pushed to its own public
  repository under the `TheClockwyrks` GitHub organization, named
  `tcab-<test-case>-<harness>-<model>-<short-id>` (sanitized to `[a-z0-9-]`). The
  readable slug keeps the organization browsable and filterable by harness and
  model; the short run-id suffix keeps each name unique.
- **Playable build** — the implementation is built and served from that
  repository's GitHub Pages at `https://<slug>.testcabinet.ai/`, a per-run
  subdomain of the project domain. Serving each build at its own subdomain root
  lets it build with a normal absolute base and keeps every implementation fully
  self-contained.
- **Gallery** — the run record, with its source and build links filled in, is
  appended to the site dataset under `apps/site/data/`, and the gallery at
  `https://testcabinet.ai/` is rebuilt and deployed from it. The run's
  [review](./apps/docs/src/content/docs/results.md#reviews) is published alongside the record, written
  to `apps/site/src/data/writeups/<id>.md` (carrying its rating in frontmatter)
  and committed with the dataset.

`tcab publish` shells out to the GitHub CLI (`gh`) to create and push
repositories and to configure Pages, so `gh` must be installed and authenticated
on the host that runs a publish — a token with `repo` and `workflow` scopes, via
`gh auth login` or `GH_TOKEN`. In this devcontainer, install `gh` by running
`.devcontainer/tools/gh.sh`; it is not part of the base image, so re-run it after
a container rebuild.

### DNS and GitHub configuration (one-time)

- Point the apex `testcabinet.ai` at GitHub Pages and have the gallery repository
  claim it, so the site is served from the apex.
- Add a wildcard `*.testcabinet.ai` record pointing at GitHub Pages so every
  per-run build subdomain resolves without a per-run DNS change.
- Verify `testcabinet.ai` as an organization domain so the organization owns
  `*.testcabinet.ai` and stale build subdomains cannot be taken over.

### Docs site (Cloudflare Pages, one-time)

The developer docs (`apps/docs`) deploy to Cloudflare Pages at
`docs.testcabinet.ai`, separately from the gallery. They are their own site
because GitHub Pages allows only one custom domain per repository, and the
gallery already claims the apex. The deploy is driven by
`.github/workflows/deploy-docs.yml`.

- In the Cloudflare dashboard, create a Pages project named `test-cabinet-docs`
  (this must match `--project-name` in the deploy workflow). Use a
  *Direct Upload* project — the build runs in GitHub Actions, not on Cloudflare —
  and set its production branch to `master`.
- Add `docs.testcabinet.ai` as a custom domain on that Pages project.
- Carve the docs subdomain out of the existing wildcard. Because
  `*.testcabinet.ai` points at GitHub Pages, add an explicit
  `docs.testcabinet.ai` CNAME pointing at the Pages project
  (`test-cabinet-docs.pages.dev`). A specific record takes precedence over the
  wildcard, so only `docs` is redirected to Cloudflare while every per-run build
  subdomain still resolves to GitHub Pages.
- Create a Cloudflare API token with the *Cloudflare Pages: Edit* permission and
  note the account ID. Add both to the repository as the GitHub Actions secrets
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
