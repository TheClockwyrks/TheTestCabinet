---
title: First Time Setup
---

## Overview

A fresh checkout reaches its first run once two things are in place: the
toolchain builds, and a backend with a dispatcher draining its queue is
reachable.

A run is launched from the [console](/components/web/overview/), which posts
it to the [backend](/components/backend/overview/) queue; an in-cluster
[dispatcher](/components/dispatcher/overview/) claims it, and a per-run
[driver](/components/driver/overview/) Job executes it in an isolated sandbox
pod. The container runtime, run-container image, and headless browser a run needs
are therefore cluster concerns.

[Building](/development/building/) holds the authoritative build details. This
guide is the task-oriented path over it.

## The `tcab` command

The `tcab` CLI, the second binary of the `microservice-driver` repository's
`test-cabinet-driver` crate, inspects a run's inputs, validates and publishes
references, and ingests the catalog; see the [CLI](/components/cli/overview/).
There are two ways to invoke it:

- A released binary, `tcab …`. A tag of `microservice-driver` publishes the
  smoke-tested `tcab-linux` (static musl, `x86_64`) and `tcab-windows`
  artifacts; every other platform, macOS included, builds `tcab` from source
  with `cargo build --release -p test-cabinet-driver --bin tcab` (see
  [Releasing `tcab`](/development/releasing/#releasing-tcab)).
- A source checkout, `cargo run -p test-cabinet-driver --bin tcab -- …`.
  Everything after `--` is passed to `tcab`. Use this form while working in the
  repository.

Wherever a guide shows `tcab <args>`, the source-checkout equivalent is
`cargo run -p test-cabinet-driver --bin tcab -- <args>`.

## 1. Toolchain

Work inside the dev container, which carries the pinned toolchains. Before its
first start, copy your host's file to `.devcontainer/.env` (`.env.macos` on a
Mac, `.env.podman` on a Linux Podman host, none on an Ubuntu Docker host; see
[The dev container](/development/running/#the-dev-container)). The image
bakes in gg's program-language toolchains, so its first build takes a while. On
creation `post-create.sh` installs the git hooks, initializes `contracts` and
`test-suites`, runs `npm ci` and links the checked-out repositories' packages,
and nothing builds in the background.

The superrepo holds every repository as a submodule, and each is both a Cargo
(Rust) and an npm (TypeScript) workspace where its kind carries one. Build the
repository you work in from its own checkout, and link the TypeScript packages
once so a consumer builds against its sibling checkouts (see
[Building Rust](/development/building/#building-rust) and
[Building TypeScript](/development/building/#building-typescript)):

```sh
cargo build --workspace          # in microservice-driver/: the driver and tcab
npm ci && npm run build          # in engines/, and in each npm workspace you need
scripts/repos/link-packages.sh   # at the superrepo root
```

The pinned Rust toolchain is declared in `rust-toolchain.toml`. Every check is a
gate, and `make gate` runs them all; see [The gates](/development/building/#the-gates).

On a distribution without the generic FHS dynamic loader (notably NixOS), build
the fully static `tcab` with `cargo build-portable`, an alias targeting
`x86_64-unknown-linux-musl`. See
[Portable (static) builds](/development/building/#portable-static-builds) for the
musl prerequisites.

## 2. A reachable backend

A run needs a console whose backend queue a dispatcher is draining. For local
development, stand that stack up on a k3d cluster, which runs its nodes as
containers and so needs a container runtime on `PATH`:

```sh
export ANTHROPIC_API_KEY=…                  # the harness key the cluster gives the run
make -C deployments/local local-up          # create cluster, build+import images, ingest
make -C deployments/local local-forward     # hold the data-plane port-forwards open
export TCAB_BACKEND_URL=http://127.0.0.1:8787
```

`local-forward` exposes the backend on `:8787`, artifacts on `:8790`, the arena
on `:8791`, repos on `:8792`, and Grafana on `:3000`. The local stack runs with
no edge in front of it, so `tcab` presents no Access credential to it; a
deployed environment is reached through its origin instead, see
[Sign In](/quickstarts/setup/sign-in/).

[Running the Local Service Stack](/guides/development/running-the-local-service-stack/)
covers that stack in full. The harness provider key is supplied to the cluster,
which mounts it into the run container; `tcab` itself never reads it.

## 3. Run-container images

Every run executes inside a run-container image selected by the test case's
[test type](/testing/overview/), by its
[`asset_kind`](/testing/asset-generation/manifests/overview/) for asset
generation, and by its
[`asset_dimension`](/testing/full-stack/manifests/#asset_dimension) for full
stack. The
[harness](/components/driver/harnesses/) is installed into that image at run
time, so there is no per-harness image.

The driver resolves and pulls the image from the registry and records the
resolved digest in the [run record](/components/contracts/run-records/). The
cluster resolves it from `TCAB_CONTAINER_REGISTRY`, `TCAB_CONTAINER_TAG`, or a
per-image `TCAB_CONTAINER_IMAGE_*` override; see
[Execution](/components/driver/execution/#containerization). Nothing has to be
built on the host to make a first run.

`make -C deployments/local local-up` builds these images from
`microservice-driver/containers/` and imports them into the local cluster.
Rebuild them after changing tooling that is baked into them:

```sh
make -C deployments/local run-images              # every run image
make -C deployments/local run-images-e2e          # one test type's images
make -C deployments/local run-image-voxel-animation   # a single image
```

The supported harness slugs are `claude`, `codex`, `cline`, `antigravity`,
`goose`, `kilo`, `opencode`, `pi`, and `gg`. The console's harness
configuration view lists them with their readiness.

### The audio store

A run whose case declares [audio packs](/testing/full-stack/manifests/#audio) is
staged with them when its container starts, read from a host audio store. In a
cluster the driver image carries the store. For a host-side `tcab validate`,
fetch it once:

```sh
az acr login --name testcabinet
TCAB_CONTAINER_TAG=<master commit> scripts/fetch-audio-store.sh
```

It pulls that commit's `test-cabinet-audio-store` image from the Test Cabinet
ACR and extracts the tree, so it needs no R2 credential. The default destination is
`~/.cache/tcab/audio-store`, and the script prints the `TCAB_AUDIO_STORE` export
that points `tcab` at it. End-to-end, adversarial, and performance cases declare
no packs and read no store.

If you have just published a pack, the image is behind you: pass `--stage` to
build the store straight out of the audio object store instead, which needs
`node` and the read-scoped `CLOUDFLARE_AUDIO_R2_PRESIGN` credentials. The script
falls back to that source on its own when the pull fails.

## 4. A headless browser

The [validator](/components/driver/validation/) and the reference renderer drive
a Playwright browser. For a backend-driven run this happens inside the cluster.
A host Chromium is required only for the local commands that render directly:
`tcab validate`, `tcab capture-baselines`, and `tcab publish-reference`. Install
the pinned revision through the pinning workspace:

```sh
npm exec -w @clockwyrks/browser-driver -- playwright install chromium
```

The host driver script (`packages/browser-driver/driver.mjs` of the `contracts`
repository, `contracts/packages/browser-driver/driver.mjs` in a superrepo
checkout) is located relative to the working directory. `TCAB_BROWSER_DRIVER`
overrides that path.

## 5. Credentials

The CLI keeps two kinds of credential separate (see
[CLI Authentication](/components/cli/overview/#authentication)):

- Your identity. A deployed environment sits behind Cloudflare Access, and
  `tcab` presents an Access credential on every request to it: a user token
  from `cloudflared access login`, or a service token for automation. The
  local stack has no edge and needs neither. See
  [Sign In](/quickstarts/setup/sign-in/).

- The harness API key. Supplied to the cluster. The local stack reads the
  provider key from your environment or the repo-root `.env` and creates a Secret
  the driver mounts into the run container. The variable is `ANTHROPIC_API_KEY`
  for `claude`, `OPENAI_API_KEY` for `codex`, and `OPENROUTER_API_KEY` for the
  OpenRouter-backed harnesses. See
  [Set Up Authentication](/quickstarts/setup/set-up-authentication/) for the
  subscription alternative.

## 6. Make a first run

A run is launched from the console. With the stack up and forwarded, start the
console from source and open <http://127.0.0.1:1430>; against a deployment,
open its origin and sign in:

```sh
npm run dev   # in console.testcabinet.ai/
```

Open the `carom` case, pick `v1.0.0` and the `base` variant, choose the `claude`
harness and a model, and start the run. The console shows the queued job. The
in-cluster driver seeds a fresh repository with the selected variant's specs and
screenshots, hands the rendered prompt to the harness in a sandbox pod, then
builds and [load-checks](/components/driver/validation/#load-check) the result
and runs the declared checks. The console streams the live
[event stream](/components/driver/events/) throughout and shows the produced
run record's summary when it finishes.

`tcab` inspects the inputs a run is given without launching one: `tcab seed`
leaves the seeded repository on disk, `tcab prompt` prints the rendered prompt,
and `tcab validate` runs the case's validation over a produced tree, each
naming the case by `--test-case`, `--version` and `--variant`.

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/) is the quickstart
  to follow once setup is done.
- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  assesses the run you just produced.
- [Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/)
  covers writing your own playable-game case.
