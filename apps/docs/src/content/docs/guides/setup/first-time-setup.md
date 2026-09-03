---
title: First Time Setup
---

## Overview

A fresh checkout reaches its first run once three things are in place: the
toolchain builds, a backend with a dispatcher draining its queue is reachable,
and an account exists to launch under.

`tcab` is an enqueue-and-watch client. `tcab run` posts the run to the
[backend](/components/backend/overview/) queue, an in-cluster
[dispatcher](/components/dispatcher/overview/) claims it, and a per-run
[driver](/components/driver/overview/) Job executes it in an isolated sandbox
pod. The container runtime, run-container image, and headless browser a run needs
are therefore cluster concerns.

[Building](/development/building/) holds the authoritative build details. This
guide is the task-oriented path over it.

## The `tcab` command

Runs are driven by the `tcab` CLI (binary `tcab`, crate `test-cabinet-cli`).
There are two ways to invoke it:

- A released binary, `tcab run …`. Released binaries are published on GitHub for
  Linux (static musl, x86_64), Windows (x86_64), and macOS (Apple silicon).
- A source checkout, `cargo run -p test-cabinet-cli -- run …`. Everything after
  `--` is passed to `tcab`. Use this form while working in the repository.

Wherever a guide shows `tcab <args>`, the source-checkout equivalent is
`cargo run -p test-cabinet-cli -- <args>`.

## 1. Toolchain

The repository is both a Cargo (Rust) and an npm (TypeScript) workspace. Build
both once:

```sh
cargo build --workspace          # Rust: core, CLI, services, desktop shell
npm install                      # TypeScript: installs every workspace
```

The pinned Rust toolchain is declared in `rust-toolchain.toml`. Format and lint
with `cargo fmt --all` and `cargo clippy --workspace`.

On a distribution without the generic FHS dynamic loader (notably NixOS), build
the fully static `tcab` with `cargo build-portable`, an alias targeting
`x86_64-unknown-linux-musl`. See
[Portable (static) builds](/development/building/#portable-static-builds) for the
musl prerequisites.

## 2. A reachable backend

`tcab run` requires `TCAB_BACKEND_URL` pointing at a backend whose queue a
dispatcher is draining, and a logged-in account. For local development, stand
that stack up on a k3d cluster, which runs its nodes as containers and so needs a
container runtime on `PATH`:

```sh
export ANTHROPIC_API_KEY=…                  # the harness key the cluster gives the run
make -C deployments/local local-up          # create cluster, build+import images, ingest
make -C deployments/local local-forward     # hold the data-plane port-forwards open
export TCAB_BACKEND_URL=http://127.0.0.1:8787
```

`local-forward` exposes the backend on `:8787`, auth on `:8789`, artifacts on
`:8790`, the arena on `:8791`, and Grafana on `:3000`.

[Running the Local Service Stack](/guides/development/running-the-local-service-stack/)
covers that stack in full. The harness provider key is supplied to the cluster,
which mounts it into the run container; `tcab` itself never reads it.

## 3. Run-container images

Every run executes inside a run-container image selected by the test case's
[test type](/testing/overview/) and, for asset generation, its
[`asset_kind`](/testing/asset-generation/manifests/overview/). The
[harness](/components/core/harnesses/) is installed into that image at run time,
so there is no per-harness image.

The driver resolves and pulls the image from the registry and records the
resolved digest in the [run record](/components/core/run-records/). The cluster
resolves it from `TCAB_CONTAINER_REGISTRY`, `TCAB_CONTAINER_TAG`, or a per-image
`TCAB_CONTAINER_IMAGE_*` override; see
[Execution](/components/core/execution/#containerization). Nothing has to be
built on the host to make a first run.

`make -C deployments/local local-up` builds these images from `containers/` and
imports them into the local cluster. Rebuild them after changing tooling that is
baked into them:

```sh
make -C deployments/local run-images              # every run image
make -C deployments/local run-images-e2e          # one test type's images
make -C deployments/local run-image-voxel-animation   # a single image
```

The supported harness slugs are `claude`, `codex`, `cline`, `antigravity`,
`goose`, `kilo`, `opencode`, `pi`, and `gg`. List them with:

```sh
tcab harnesses          # human-readable table; add --json for machine output
```

### The audio store

A run whose case declares [audio packs](/testing/full-stack/manifests/#audio) is
staged with them when its container starts, read from a host audio store. In a
cluster the driver image carries the store. For a local `tcab run`, fetch it
once:

```sh
scripts/fetch-audio-store.sh
```

It pulls the published `test-cabinet-audio-store` image and extracts the tree,
so it needs no R2 credential. The default destination is
`~/.cache/tcab/audio-store`, and the script prints the `TCAB_AUDIO_STORE` export
that points `tcab` at it. End-to-end, adversarial, and performance cases declare
no packs and read no store.

## 4. A headless browser

The [validator](/components/core/validation/) and the reference renderer drive a
Playwright browser. For a backend-driven run this happens inside the cluster. A
host Chromium is required only for the local commands that render directly:
`tcab validate`, `tcab capture-baselines`, and `tcab publish-reference`. Install
the pinned revision through the pinning workspace:

```sh
npm exec -w @test-cabinet/browser-driver -- playwright install chromium
```

The host driver script (`packages/browser-driver/driver.mjs`) is located relative
to the working directory. `TCAB_BROWSER_DRIVER` overrides that path.

## 5. Credentials

The CLI keeps two kinds of credential separate (see
[CLI Authentication](/components/cli/overview/#authentication)):

- Your account. `tcab` authenticates every mutating call with a bearer token
  from the [auth service](/components/auth/overview/): launching a run,
  reviewing, and publishing. Register and log in once:

  ```sh
  tcab register --username dev --display-name "Dev"   # or: tcab login --username dev
  ```

  The token is stored at `~/.config/tcab/credentials.json`, relocatable with
  `TCAB_CONFIG_DIR`.

- The harness API key. Supplied to the cluster. The local stack reads the
  provider key from your environment or the repo-root `.env` and creates a Secret
  the driver mounts into the run container. The variable is `ANTHROPIC_API_KEY`
  for `claude`, `OPENAI_API_KEY` for `codex`, and `OPENROUTER_API_KEY` for the
  OpenRouter-backed harnesses. See
  [Set Up Authentication](/quickstarts/setup/set-up-authentication/) for the
  subscription alternative.

## 6. Make a first run

With the stack up and forwarded, `TCAB_BACKEND_URL` set, and an account logged
in:

```sh
tcab run \
  --test-case carom --version v1.0.0 --variant base \
  --harness claude --model claude-opus-4-8
```

This enqueues the run and prints the queued job id. The in-cluster driver seeds a
fresh repository with the selected variant's specs and screenshots, hands the
rendered prompt to the harness in a sandbox pod, then builds and
[load-checks](/components/core/validation/#load-check) the result and runs the
declared checks. `tcab` streams the live
[event stream](/components/core/events/) throughout and prints the produced run
record's summary when it finishes.

`--test-case`, `--version`, `--variant`, `--harness`, and `--model` are all
required. `--max-runtime <hours>` overrides the case's default cap for this
invocation. `--out-dir <dir>` also writes the fetched record to
`<dir>/<run-id>.json`.

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/) is the quickstart
  to follow once setup is done.
- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  assesses the run you just produced.
- [Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/)
  covers writing your own playable-game case.
