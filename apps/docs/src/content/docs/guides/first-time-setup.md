---
title: First Time Setup
---

This guide takes a fresh checkout of The Test Cabinet to the point where you can
launch a run. It covers the toolchain, the container runtime, the run-container
image, the headless browser, and credentials — the four things a
[run](/components/cli/overview/) needs that the repository alone does not provide.

The project is in early development, so setup assumes some familiarity with Rust,
Node, and containers. [Building](/development/building/) holds the authoritative
build details; this guide is the task-oriented version that sits on top of it.

## The `tcab` command

Runs are driven by the `tcab` CLI (binary `tcab`, crate `test-cabinet-cli`).
There are two ways to invoke it, and the rest of these guides use the first:

- **A released binary** — `tcab run …`. Released binaries are published on
  GitHub (Linux static-musl, Windows, macOS).
- **From a source checkout** — `cargo run -p test-cabinet-cli -- run …`.
  Everything after `--` is passed to `tcab`. This is the form to use while
  working in the repository.

Wherever a guide shows `tcab <args>`, the source-checkout equivalent is
`cargo run -p test-cabinet-cli -- <args>`.

## 1. Toolchain

The repository is both a Cargo (Rust) and an npm (TypeScript) workspace. Build
both once:

```sh
cargo build --workspace          # Rust: core, CLI, desktop shell
npm install                      # TypeScript: installs every workspace
```

The pinned Rust toolchain is declared in `rust-toolchain.toml`. Format and lint
with `cargo fmt --all` and `cargo clippy --workspace`.

If you are on a distribution without the generic FHS dynamic loader (notably
NixOS), build the fully static `tcab` instead with `cargo build-portable` (an
alias that targets `x86_64-unknown-linux-musl`); see
[Portable build](/development/building/#portable-static-builds) for the musl
prerequisites.

## 2. A container runtime

Every run executes inside an isolated container so a model cannot reach the host
filesystem or other runs' outputs (see [Execution](/components/core/execution/)).
You need **Podman** (preferred) or **Docker** on `PATH`. The runtime is
auto-detected; override it with `TCAB_CONTAINER_RUNTIME=<binary>`.

Runs always execute Linux containers, so platform expectations differ:

- **Linux** — rootless Podman runs containers directly on the host. `tcab` adds
  `--userns=keep-id` so the mounted repository stays writable by the run user.
- **macOS** — Podman runs containers inside its managed Linux VM
  (`podman machine init && podman machine start`). On Apple Silicon the machine is
  `arm64`, so the base image builds and runs `arm64` by default.
- **Windows** — Podman runs on its WSL2 backend, so **WSL must be installed**
  (`wsl --install`) before `podman machine init`.

Where a run stages its inputs — the seeded repository, collected artifacts, and
capture scratch — is resolved as `--work-dir`, then `TCAB_WORK_DIR`, then
`~/.tcab`. The seeded repository is **copied** into a runtime-managed volume
inside the container rather than bind-mounted from the host, so this directory
only needs to be readable by the runtime CLI; it does not have to be a path the
container runtime can mount. (Copying is also what keeps Windows working: a bind
mount of a home-directory path resolves to the Windows partition the WSL2 VM
exposes under `/mnt/<drive>`, which carries no Linux ownership, so the
container's unprivileged run user cannot write the working tree.)

## 3. The run-container image

Every run executes inside a **single shared base image**; the
[agent harness](/components/core/harnesses/) you drive is installed into that
container at run time, so there is no per-harness image to build or pull. By
default a runner **pulls the base image from a container registry** (GHCR) the
first time it is needed and pins the resolved digest in the run record; you do
not have to build anything to make a first run. Each runner resolves the image
from its own environment configuration (`TCAB_CONTAINER_REGISTRY`,
`TCAB_CONTAINER_TAG`, or a full `TCAB_CONTAINER_IMAGE` override) — see
[Execution](/components/core/execution/#containerization).

To build the image locally instead — for offline development or while changing
it — set `TCAB_CONTAINER_REGISTRY=` (empty) so the runner uses the locally-tagged
build, and build from the `containers/` directory (see its `README.md`):

```sh
cd containers && DOCKER=podman ./build.sh   # builds the base image
```

The supported harness slugs are `claude`, `codex`, `cline`, `antigravity`,
`goose`, `kilo`, `opencode`, and `pi`. Confirm which harnesses are ready to run
(a harness is ready once its API key is exported):

```sh
tcab harnesses          # human-readable table; add --json for machine output
```

## 4. A headless browser

The [validator](/components/core/validation/) and the reference renderer shell
out to a Playwright browser driver. Install the Chromium revision the driver
expects **through the pinning workspace** — a bare `npx playwright` fetches a
different version:

```sh
npm exec -w @test-cabinet/browser-driver -- playwright install chromium
```

The driver (`packages/browser-driver/driver.mjs`) is located relative to the
working directory; override with `TCAB_BROWSER_DRIVER`. A `run` will not start
unless every one of the selected variant's reference mockups renders, since those
screenshots are both the seeded visual targets and the validation baselines — a
render failure aborts the run before a harness session is spent. (The `seed`,
`validate`, and `catalog` commands degrade per-view instead of aborting.)

## 5. Credentials

The harness needs an API key for its model provider. The CLI keeps the several
kinds of credential separate and never conflates them (see
[CLI Authentication](/components/cli/overview/#authentication)); for a basic run
you only need the harness key.

Each harness reads a specific variable — `ANTHROPIC_API_KEY` for `claude`,
`OPENAI_API_KEY` for `codex`, `OPENROUTER_API_KEY` for the OpenRouter-backed
harnesses. The CLI loads a `.env.runner` from the working directory (or any
parent) on startup; copy `.env.runner.example` to `.env.runner` and fill in the
keys (a legacy `.env` is still read as a fallback). Variables already
exported in the shell take precedence over the file. The key is passed into the
run container as a secret and is **never** written into the seeded repository.

## 6. Make a first run

Run from the repository root so the `test-cases/` catalog and the browser driver
resolve (override the catalog location with `TCAB_TEST_CASES_DIR`):

```sh
tcab run \
  --test-case pong --version v1.0.0 --variant base \
  --harness claude --model claude-opus-4-8 \
  --out-dir runs
```

This renders the references, seeds a fresh repository with the selected variant's
specs and screenshots, renders the prompt and hands it to the harness in a
container while printing the live [event stream](/components/core/events/), then
builds and [load-checks](/components/core/validation/#load-check) the result,
runs the declared checks, and writes `runs/<id>/run-record.json` alongside a copy
of the implementation. `--variant` is required; `--max-runtime <seconds>`
overrides the case's default cap for this invocation.

## Next steps

- [Run a Test Case](/quickstarts/run-a-test-case/) — the quickstart, once setup
  is done.
- [Reviewing Test Run Results](/guides/reviewing-test-run-results/) — assess the
  run you just produced.
- [Authoring a Test Case](/guides/authoring-a-test-case/) — write your own case.
