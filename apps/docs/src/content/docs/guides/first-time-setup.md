---
title: First Time Setup
---

This guide takes a fresh checkout of The Test Cabinet to the point where you can
launch a run. Because `tcab` no longer executes runs locally — it
[enqueues](/components/cli/overview/) them at the backend, which runs them in the
cluster — what you set up is the **service stack** the run executes in (the
container runtime, run-container image, and headless browser are all
**cluster/driver** concerns now, wired up by the k3d stack), plus the toolchain
and the account credentials `tcab` itself needs.

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

## 2. A reachable backend (the service stack)

`tcab` no longer executes runs on your machine. It is a thin **enqueue + watch**
client: `tcab run` posts the run to the [backend](/components/backend/overview/)'s
queue, an in-cluster [dispatcher](/components/dispatcher/overview/) claims it, and
a per-run [driver](/components/driver/overview/) `Job` executes it inside an
isolated sandbox pod (so a model cannot reach the host or other runs; see
[Execution](/components/core/execution/)). So `tcab` needs **no host container
runtime** — what it needs is a reachable backend (`TCAB_BACKEND_URL`) whose queue
a dispatcher is draining, and an account.

For local development that means standing up the service stack on a **k3d**
cluster (which itself runs as containers, so **Docker** on `PATH` is required for
k3d, not for `tcab`). Bring it up and forward the backend, then point `tcab` at
it:

```sh
export ANTHROPIC_API_KEY=…                  # the harness key the cluster gives the run
make -C deployments/local local-up          # create cluster, build+load images, ingest
make -C deployments/local local-forward     # backend→:8787, auth→:8789, arena→:8791
export TCAB_BACKEND_URL=http://127.0.0.1:8787
```

See [Running](/development/running/) for the full reference on the k3d stack
(container-runtime caveats for the cluster on macOS/Windows live there too). The
harness provider key is supplied to the **cluster** (a Secret the driver mounts
into the run), not to `tcab` itself.

## 3. The run-container image

Every run executes inside a run-container image selected by the test case's
[test type](/testing/) and — for asset-generation — its
[`asset_kind`](/testing/asset-generation/manifests/): an
[end-to-end](/testing/end-to-end/) run uses the **base image**, a single-sprite
[asset-generation](/testing/asset-generation/overview/) run uses the **sprite
image** (the base plus the baked-in `draw` tool), and a sprite-sheet run uses the
**sprite-sheet image** (the base plus the baked-in `draw-sheet` tool). The
[agent harness](/components/core/harnesses/) you drive is installed into the
container at run time, so none is a per-harness image to build or pull. The
**driver** (not `tcab`) pulls the image it needs from a container registry (GHCR)
and pins the resolved digest in the run record; you do not have to build anything
on the host to make a first run. The cluster resolves the image from its own
configuration (`TCAB_CONTAINER_REGISTRY`, `TCAB_CONTAINER_TAG`, or a per-image
override — `TCAB_CONTAINER_IMAGE_BASE` / `TCAB_CONTAINER_IMAGE_SPRITE` /
`TCAB_CONTAINER_IMAGE_SPRITE_SHEET`) — see
[Execution](/components/core/execution/#containerization).

For local development the [k3d stack](/development/running/)'s `local-up` builds
these images from the `containers/` directory and loads them into the cluster, so
you do not build them by hand. (To build them directly — while changing them —
run `cd containers && DOCKER=podman ./build.sh`, which builds the base + sprite +
sprite-sheet images; see its `README.md`.)

The supported harness slugs are `claude`, `codex`, `cline`, `antigravity`,
`goose`, `kilo`, `opencode`, and `pi`. List them (against a local checkout) with:

```sh
tcab harnesses          # human-readable table; add --json for machine output
```

## 4. A headless browser

The [validator](/components/core/validation/) and the reference renderer use a
Playwright browser driver. This runs **inside the driver/run container** in the
cluster, not on your host — so a backend-driven run needs nothing installed
locally for it. You only need a host Chromium if you run the **local-only**
commands that render references directly (`tcab validate` / `catalog`); install
the pinned revision **through the pinning workspace** (a bare `npx playwright`
fetches a different version):

```sh
npm exec -w @test-cabinet/browser-driver -- playwright install chromium
```

The host driver script (`packages/browser-driver/driver.mjs`) is located relative
to the working directory; override with `TCAB_BROWSER_DRIVER`.

## 5. Credentials

The CLI keeps several kinds of credential separate and never conflates them (see
[CLI Authentication](/components/cli/overview/#authentication)):

- **Your account** — `tcab` authenticates the *mutating* calls (launching a run,
  plus review and publish) with a bearer token from the
  [auth service](/components/auth/overview/). Register and log in once:

  ```sh
  tcab register --username dev --display-name "Dev"   # or: tcab login --username dev
  ```

  The token is stored at `~/.config/tcab/credentials.json` (overridable with
  `$TCAB_CONFIG_DIR`).

- **The harness API key** — supplied to the **cluster**, not to `tcab`. The k3d
  stack reads the provider key from your environment (for example
  `ANTHROPIC_API_KEY` for `claude`, `OPENAI_API_KEY` for `codex`,
  `OPENROUTER_API_KEY` for the OpenRouter-backed harnesses) and creates a Secret
  the [driver](/components/driver/overview/) mounts into the run container; it is
  never written into the seeded repository. See
  [Set Up Authentication](/quickstarts/set-up-authentication/) (it also covers the
  subscription alternative).

## 6. Make a first run

With the [k3d stack](/development/running/) up and forwarded and
`TCAB_BACKEND_URL` set (see step 2), and logged in (step 5):

```sh
tcab run \
  --test-case carom --version v1.0.0 --variant base \
  --harness claude --model claude-opus-4-8
```

This enqueues the run on the backend's queue and prints the queued job id; the
in-cluster driver seeds a fresh repository with the selected variant's specs and
screenshots, hands the rendered prompt to the harness in a sandbox pod, then
builds and [load-checks](/components/core/validation/#load-check) the result and
runs the declared checks — `tcab` streams the live
[event stream](/components/core/events/) throughout and prints the produced
[run record](/components/core/run-records/)'s summary when it finishes. `--variant`
is required; `--max-runtime <hours>` overrides the case's default cap for this
invocation, and `--out-dir runs` (optional) also writes the fetched record JSON
locally.

## Next steps

- [Run a Test Case](/quickstarts/run-a-test-case/) — the quickstart, once setup
  is done.
- [Reviewing Test Run Results](/guides/reviewing-test-run-results/) — assess the
  run you just produced.
- [Authoring an End-to-End Test Case](/guides/authoring-an-end-to-end-test-case/)
  — write your own playable-game case (or
  [Authoring an Asset-Generation Test Case](/guides/authoring-an-asset-generation-test-case/)
  to draw a sprite).
