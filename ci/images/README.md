# CI images

Two container images, one per pipeline track, holding what the checks in
[`azure-pipelines.yml`](../../azure-pipelines.yml) execute and nothing else.
[`scripts/ci/ci-image.sh`](../../scripts/ci/ci-image.sh) builds and pushes them,
and [`azure-pipelines-ci-images.yml`](../../azure-pipelines-ci-images.yml) is
the pipeline of its own that runs it.

| Image | Track |
| --- | --- |
| `testcabinet.azurecr.io/ubuntu-the-test-cabinet-rust-cicd` | The `rust` job |
| `testcabinet.azurecr.io/ubuntu-the-test-cabinet-web-cicd` | The `web` job |

The gates pipeline builds none of them. Each job names its image at the tag
[`tags.yml`](tags.yml) holds for its track and lets Azure pull it, through the
`the-test-cabinet-acr` service connection, before the job starts.
Nothing in that pipeline logs in to a registry or starts a container of its
own, which is why those jobs need no docker CLI and these images carry none.

## Why these are not the devcontainer

The devcontainer is a place to work. It carries two coding agents, the Azure
CLI, `gh`, `k3d`, `kubelogin`, `lazygit`, a Docker client and a shell configured
for a person, none of which a gate under [`ci/gates/`](../gates/) invokes.
Building that image on a hosted agent, or saving it as an archive and loading it
again, costs more on every run of every track than the checks it carries.

Splitting it buys a second thing. The Rust track needs no Node and no browser
engines; the web track needs no compiler. Neither image carries the other's
half.

## What each image holds

All of them are `ubuntu:26.04`, built as root, with no `USER` line and no
entrypoint. Azure runs a container job's steps as uid 1001, a user it adds to
the container, whatever the image's default user is, while `HOME` stays
`/root`, where uv's, pre-commit's and npm's caches all resolve. Each image
therefore ends by widening `/root` to every user with `chmod -R a+rwX`: the uid
is Azure's to choose and the images hold nothing secret. Without it a step's
first cache write is a permission error.

### Rust

- The Rust toolchain, `rustfmt` and `clippy`, which `rust-fmt`, `rust-clippy`
  and `rust-doc` run and whose own test harness `rust-doctest` runs, and
  `cargo-nextest`, which `rust-test` invokes.
- The apt packages a compile needs: `build-essential` for the linker,
  `pkg-config`, and `git`, which every gate asks for the workspace root before
  it does anything else.
- This architecture's musl target and `musl-tools`, whose `musl-gcc` links a
  static build against it, so a static build compiles here as it does in the
  devcontainer.
- `uv` and `pre-commit`, because every gate is invoked as
  `uv run --quiet --project ci gate run <id>`.

The toolchain lives at `/usr/local/rustup` and `/usr/local/cargo`, and
`/usr/local/cargo/bin` is on the image's `PATH`. That is a contract the pipeline
depends on: a job that caches the crate registry repoints `CARGO_HOME` at its
cache directory, and a toolchain underneath `CARGO_HOME` would disappear on the
first run.

The image carries no Node. Nothing on this track builds a bundle.

### Web

- Chromium, Firefox and WebKit with their system libraries, which
  `web-browser-test` drives.
- Node and npm, which `web-lint`, `web-typecheck`, `web-test`, `web-build`,
  `docs-typecheck`, `docs-build`, `markdownlint`, `cspell` and `format` all
  reach through the npm workspace.
- `kubectl`, for `k8s-manifests`, which renders the overlays under
  [`deployments/`](../../deployments/) through kubectl's built-in kustomize.
  Nothing in CI stands a cluster up, so `k3d`, `kubelogin` and `helm` are
  absent.
- `python3`, because `shell-tests` runs every `*.test.sh` under `scripts/` and
  one of them drives a Python script with the interpreter on the `PATH`.
- `uv` and `pre-commit`, as on the Rust track, plus the environments
  pre-commit builds for the remote hook repositories.

The browser engines are at `/opt/ms-playwright` rather than in a user's cache,
which is where `PLAYWRIGHT_BROWSERS_PATH` puts them and what Playwright's own
images do. [`ci/gates/web-browser-test.py`](../gates/web-browser-test.py) asks
Playwright for `executablePath()`, which reads the same variable.

`markdownlint-cli2` and Prettier are not installed globally. Their gates run
`npm run` scripts, which are the workspace's locked copies.

## Version pins

Most versions an image installs are decided in one place: the
`x-devcontainer-build-args` anchor in
[`.devcontainer/docker-compose.yml`](../../.devcontainer/docker-compose.yml).
[`build-args.sh`](build-args.sh) reads the `ARG` lines of an image's Dockerfile,
returns the anchor's literal value for each, and fails naming the offender when
a declared `ARG` has no pin behind it.

```sh
ci/images/build-args.sh rust   # NAME=VALUE per line, sorted
ci/images/build-args.sh web
```

`scripts/ci/ci-image.sh` passes that output to the build as `--build-arg` and
folds it into the image's tag. A bump of a pin an image consumes therefore
rebuilds it, and a bump of a pin it does not consume, such as
`CLAUDE_CODE_VERSION` or `LAZYGIT_VERSION`, leaves its tag alone.

The rest are pinned in the install scripts themselves, under
[`.devcontainer/`](../../.devcontainer/README.md): uv, pre-commit, rustup,
cargo-binstall and kubectl each name their version where they install it. Those
scripts are inputs of the images that run them, so a bump in one moves that
image's tag through the other half of the digest below. Each Dockerfile says why
the scripts it runs are safe to run as root with no container user, and what had
to change in one that was not.

## What the build can see

Each Dockerfile has a `<name>.Dockerfile.dockerignore` beside it, and each one
is an allowlist of that image's `COPY` sources. The context a builder is sent
is then the handful of scripts the image installs rather than the whole
checkout, so nothing else a commit touches is uploaded or busts a layer.

They are not tidiness. The root [`.dockerignore`](../../.dockerignore) is
itself an allowlist, written for the images under `deployments/images/`: it
ignores everything and re-includes the Rust and web workspaces those builds
read. A CI image reads none of that, so under that allowlist every one of its
`COPY` lines would fail with the source not found. BuildKit reads the file
named after the Dockerfile in preference to the root one, which is what these
files are.

## When an image input changes

The tag is content-addressed: `v1-<12 hex>` over `git ls-files -s` of that
image's inputs plus its extracted pins. Identical inputs always produce the same
tag, so nothing is ever pushed twice to one tag and `latest` is never used.
`scripts/ci/ci-image.sh inputs rust` lists what an image hashes.

The tags are written in [`tags.yml`](tags.yml), a variables template
`azure-pipelines.yml` includes, which names each job's image by its track's
`<track>ImageTag` through a compile-time expression. `scripts/ci/ci-image.sh
tag`, given no track, writes every track's tag into that file, and nothing else
writes it: the template renders it once, with the placeholder
`v1-000000000000`, and never over it, so the pipeline stays the file the
template renders. [`ci/tests/test_wiring.py`](../tests/test_wiring.py) holds
the pinned tags to what this checkout hashes to. A pin therefore cannot drift:
touching an image input fails the `ci-tests` gate, and its message names the
command that writes the new tag. The placeholder is reported by that test as a
skip until the first real tags are written.

The consequence is an ordering. A commit that changes an image input pins a tag
the registry does not hold yet, so its gates jobs fail at job initialization
until the image pipeline has pushed it. That pipeline triggers on the same
paths on every branch and runs in parallel. The loop is:

1. Run `scripts/ci/ci-image.sh tag`, which writes every track's tag into
   `tags.yml`, and commit it. The check above fails if this is forgotten.
2. Push the branch. The image pipeline triggers on the same paths and starts
   building.
3. Wait for it, a few minutes. A gates run queued alongside it fails at job
   initialization until the image is in the registry.
4. Re-queue the gates run.

Because the tag is content-addressed, the image is built once on the branch that
introduced the change, and the merge to master finds it already pushed and skips
the build.

`v1` is the escape hatch for what the files do not pin, the `ubuntu:26.04` tag
and the apt package sets. It is written once, as `IMAGE_SCHEMA` in
`scripts/ci/ci-image.sh`, and bumping it retires every tag at once.

## Architecture

All of these are `linux/amd64` only, built natively on the hosted agents, which
are amd64. There is no QEMU and no `binfmt` here. The devcontainer stays
multi-architecture by being built on the machine that runs it, and every install
script these images share with it resolves the architecture out of the image it
is running in.
