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

The gates pipeline builds none of them. Each job names its image at the commit
[`tags.yml`](tags.yml) pins and lets Azure pull it, through the
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
  Nothing in CI stands a cluster up, so `k3d` and `kubelogin` are absent.
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

`scripts/ci/ci-image.sh` passes that output to the build as `--build-arg`. A
pin bump is a change to the compose file, which the image pipeline triggers
on, so it builds every image under the commit that bumped it; an image that
does not consume the pin, such as for `CLAUDE_CODE_VERSION` or
`LAZYGIT_VERSION`, is rebuilt from its layer cache and comes out unchanged. The
gates take the new images once [`tags.yml`](tags.yml) pins that commit.

The rest are pinned in the install scripts themselves, under
[`.devcontainer/`](../../.devcontainer/README.md): uv, pre-commit, rustup
and kubectl each name their version where they install it. The image pipeline
triggers on those scripts too, so a bump in one builds the images under the
commit that bumped it, like any change below. Each Dockerfile says why
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

An image is tagged with the commit its image pipeline run is on,
`$(Build.SourceVersion)`: `scripts/ci/ci-image.sh build <track>` builds the
image and pushes it as `<repository>:<commit>`, and computes nothing. That
pipeline triggers on the files an image is built from, listed once in its
path filter together with `.devcontainer/docker-compose.yml`, so a commit
changing one of them is a commit the images are built for. A file added to an
image's `COPY` or `ARG` lines is added to that list. `latest` is never pushed
to an image repository.

The pin is [`tags.yml`](tags.yml), a variables template `azure-pipelines.yml`
includes, holding one variable, `ciImageTag`: the full commit whose image
pipeline run built the images every gates job pulls. Each job names its image
as `<repository>:${{ variables.ciImageTag }}` through a
compile-time expression, so a commit's diff says which images it ran in. The
template renders the file once, with forty zeros, which name no image, and
never over it, so the pin a project writes is the project's own edit and the
pipeline stays the file the template renders.
[`ci/tests/test_wiring.py`](../tests/test_wiring.py) holds the file to that one
variable and a full commit id, and every job to naming its image by it.

The consequence is a loop of two commits:

1. Commit the change to an image's files and push it. The image pipeline's run
   on that commit pushes each track's image under the commit, a few minutes
   for a change a layer cache mostly covers.
2. Once that run has finished, write the commit into `tags.yml` as
   `ciImageTag`, commit and push. That second commit's gates run in the new
   images.

Until the second commit lands, the gates run in the images the pin names, so a
change to an image's files is complete when the pin follows it. The same loop
is the first one a workspace runs: queue the image pipeline on any commit,
then pin that commit. It is also how the images take what no file pins, such as
a new image behind the `ubuntu:26.04` tag: queue a run by hand on the branch's
head and pin the commit it ran on.

The pin is a line a developer writes, reviewed with the change it follows,
rather than something a pipeline writes or resolves. A pipeline committing it
would need write rights on every branch and a policy bypass on the protected
one, and would land a commit nobody reviewed on a developer's branch. A
reference resolved at run time from the newest image run would test a branch
that changes a Dockerfile in the old image until it merged, and the diff would
no longer name the image a commit ran in.

## Architecture

All of these are `linux/amd64` only, built natively on the hosted agents, which
are amd64. There is no QEMU and no `binfmt` here. The devcontainer stays
multi-architecture by being built on the machine that runs it, and every install
script these images share with it resolves the architecture out of the image it
is running in.
