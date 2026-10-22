# CI images

Three container images, one per pipeline track, holding what the checks in
[`azure-pipelines.yml`](../../azure-pipelines.yml) execute and nothing else.
[`scripts/ci/ci-image.sh`](../../scripts/ci/ci-image.sh) builds and pushes them,
and [`azure-pipelines-ci-images.yml`](../../azure-pipelines-ci-images.yml) is
the pipeline of its own that runs it.

| Image | Track |
| --- | --- |
| `testcabinet.azurecr.io/ubuntu-the-test-cabinet-rust-cicd` | The project's Rust jobs |
| `testcabinet.azurecr.io/ubuntu-the-test-cabinet-rust-browser-cicd` | The `rust` job, once [`tags.yml`](tags.yml) pins a commit that built it |
| `testcabinet.azurecr.io/ubuntu-the-test-cabinet-web-cicd` | The `web` job |

The Rust and web images are the template's. The rust-browser image is this
project's: the Rust image with the browser engines on top, so that the Rust tests
that drive a browser run in the `rust` job rather than skip.

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

Each image is built `FROM` the toolchain image (the rust-browser image by way
of the Rust image it is built on) the template publishes, the one
the devcontainer is built on, which `TOOLCHAIN_IMAGE` in the
`x-devcontainer-build-args` anchor of
[`.devcontainer/docker-compose.yml`](../../.devcontainer/docker-compose.yml)
names by full reference. Every compiler, tool and system library a gate
reaches for is that image's, at the same version and the same path as in a
developer's container. No image installs anything but the Rust image's
project step: the packages and the musl target this project's Rust track
needs beyond the toolchain, listed below. See
[What the image carries](../../.devcontainer/README.md#what-the-image-carries).
The pull is anonymous: the published images' registry admits anonymous pulls,
so the build reads no credential for it.

Each image is a root build that takes `USER root` back from the toolchain
image's account and sets no entrypoint. Azure runs a container job's steps as
uid 1001, a user it adds to the container, whatever the image's default user
is, while `HOME` stays `/root`, where uv's, pre-commit's and npm's caches all
resolve. Each image therefore ends by widening `/root` to every user with
`chmod -R a+rwX`: the uid is Azure's to choose and the images hold nothing
secret. Without it a step's first cache write is a permission error.

The toolchain sits under the account's home, `/home/dev`, which each image
opens to every user to enter and read. Only the directories of the cargo and
rustup homes are made writable, by a `find -type d` whose layer records no file
beneath them, so a step can still add a component without the image copying
the toolchain into a layer of its own. Each image states a complete `PATH`,
because a pipeline step reads no rc file.

### Rust

- The Rust toolchain, `rustfmt` and `clippy`, which `rust-fmt`, `rust-clippy`
  and `rust-doc` run and whose own test harness `rust-doctest` runs, and
  `cargo-nextest`, which `rust-test` invokes. `clippy` is added in the image's
  own layer, so the lint gate downloads nothing.
- `mold`, which every gate that compiles links with: the toolchain image names
  `cc-mold` as the linker of the two glibc targets, and this image inherits it.
  See [Linker](../../.devcontainer/README.md#linker).
- The system packages a compile needs, among them the C compiler a link is
  driven through, `pkg-config`, and `git`, which every gate asks for the
  workspace root before it does anything else.
- This architecture's musl target and `musl-tools`, whose `musl-gcc` links a
  static build against it, so a static build compiles here as it does in the
  devcontainer. The target is added by the devcontainer's
  `.devcontainer/languages/rust/targets.sh`, the one file of the checkout an
  image copies.
- The project's own packages, which the checks on this track reach for and a
  compile does not: `ruby`, which gg's Ruby arm reflects its signature
  catalogue with when gg's `crates/gg` builds; `libicu-dev`, which the .NET runtime
  behind gg's C# arm loads; `cmake`, for the crates whose build scripts compile
  native code; and `ffmpeg`, for the scripts the Rust jobs run.
  `ci/images/rust.Dockerfile` lists them, with `musl-tools`, in a step of
  the project's own; the devcontainer's own list is
  `.devcontainer/system/packages.sh`.
- `uv` and `pre-commit`, because every gate is invoked as
  `uv run --quiet --project ci gate run <id>`.

`RUSTUP_HOME` and `CARGO_HOME` name the toolchain's directories, and
`~/.cargo/bin` comes first on the image's `PATH`. That is a contract the
pipeline depends on: a job that caches the crate registry repoints `CARGO_HOME`
at its cache directory, and the toolchain stays where `RUSTUP_HOME` and the
`PATH` find it.

### Rust browser

[`rust-browser.Dockerfile`](rust-browser.Dockerfile) starts `FROM` the Rust
image of the same commit, so everything above holds in it unchanged, and adds
the browser engines, copied from the playwright image `PLAYWRIGHT_IMAGE` names,
as the devcontainer and the web image copy them, into
`/home/dev/.cache/ms-playwright`, which `PLAYWRIGHT_BROWSERS_PATH` names. Node
and npm, and the system libraries the engines link against, are the toolchain
image's already. `ci-image-pins` holds the workspace's `playwright` package
to that image's tag, so the workspace's Playwright finds the build copied here.

The `rust` job runs in it with `TCAB_REQUIRE_BROWSER=1`, which turns a Rust test
that would skip for want of Node, the npm workspace or Chromium into a failure
(`contracts/crates/suites/src/test_browser.rs`). The job's npm
workspace comes from its setup steps, as before. The project's other Rust jobs
stay on the Rust image.

The image pipeline builds this image after the Rust one, in a job that depends
on it, and `scripts/ci/ci-image.sh build rust-browser` passes the Rust image's
reference at the run's commit as the `RUST_CI_IMAGE` build argument. Its
Dockerfile gives that argument an empty default, so a build without it fails
rather than pulling some other base.

### Web

- Chromium, Firefox and WebKit, copied from the playwright image the
  devcontainer copies, with the system libraries they link against, which
  `console.testcabinet.ai`'s `web-browser-test` drives in that repository's
  pipeline.
- Node and npm, which `workspace-test`, `docs-typecheck`, `docs-build`,
  `markdownlint`, `cspell` and `format` all reach through the npm workspace.
- `kubectl`, for `k8s-manifests`, which renders the overlays under
  [`deployments/`](../../deployments/) through kubectl's built-in kustomize.
  Nothing in CI stands a cluster up.
- `python3`, because `shell-tests` runs every `*.test.sh` under `scripts/` and
  one of them drives a Python script with the interpreter on the `PATH`.
- `uv` and `pre-commit`, as on the Rust track.

The browser engines are in the account's Playwright cache,
`/home/dev/.cache/ms-playwright`, where the devcontainer holds them, and
`PLAYWRIGHT_BROWSERS_PATH` names that directory, because `HOME` here is
root's. `console.testcabinet.ai`'s `ci/gates/web-browser-test.py` asks
Playwright for `executablePath()`, which reads the same variable.

`markdownlint-cli2` and Prettier are not installed globally. Their gates run
`npm run` scripts, which are the workspace's locked copies.

## Version pins

Every version an image holds is the published images', which the template's
version decides: the anchor in
[`.devcontainer/docker-compose.yml`](../../.devcontainer/docker-compose.yml)
names each published image with the tag of what it is built from, and moving
the project to a new template version moves those references. Each tool's
version is the published image's that holds it, the toolchain image's for Rust,
Node, uv and the rest, and the playwright image's for the toolchain
it holds. [`build-args.sh`](build-args.sh) reads the `ARG` lines of an image's
Dockerfile, returns the anchor's literal value for each, and fails naming the
offender when a declared `ARG` has no entry behind it.

```sh
ci/images/build-args.sh rust   # NAME=VALUE per line, sorted
ci/images/build-args.sh rust-browser
ci/images/build-args.sh web
```

`scripts/ci/ci-image.sh` passes that output to the build as `--build-arg`. A
moved reference is a change to the compose file, which the image pipeline
triggers on, so it builds every image under the commit that moved it; an image
that does not read the entry, such as for `CLAUDE_CODE_VERSION`, is rebuilt
from its layer cache and comes out unchanged. The gates take the new images
once [`tags.yml`](tags.yml) pins that commit.

## What the build can see

Each Dockerfile has a `<name>.Dockerfile.dockerignore` beside it, and each one
excludes the whole context, `*`: what an image holds comes from the published
images it names. The Rust image's re-includes the one file it copies,
`.devcontainer/languages/rust/targets.sh`, and the others re-include nothing.
The context a builder is sent is then that file or nothing, so nothing else a
commit touches is uploaded or busts a layer.

BuildKit reads the file named after the Dockerfile in preference to the root
[`.dockerignore`](../../.dockerignore), which is written for the images under
`deployments/images/` and re-includes the Rust and web workspaces those builds
read.

## When an image input changes

An image is tagged with the commit its image pipeline run is on,
`$(Build.SourceVersion)`: `scripts/ci/ci-image.sh build <track>` builds the
image and pushes it as `<repository>:<commit>`, and computes nothing. That
pipeline triggers on the files an image is built from, listed once in its
path filter: `.devcontainer/docker-compose.yml`, whose anchor names the
published images, `.devcontainer/languages/rust/targets.sh`, which the Rust
image copies, each image's Dockerfile and its `.dockerignore` file,
`build-args.sh` and `scripts/ci/ci-image.sh`. A commit changing one of them is
a commit the images are built for. `latest` is never pushed
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
then pin that commit. A template update that moves the published images'
references changes the compose file, so it runs the same loop.

The pin is a line a developer writes, reviewed with the change it follows,
rather than something a pipeline writes or resolves. A pipeline committing it
would need write rights on every branch and a policy bypass on the protected
one, and would land a commit nobody reviewed on a developer's branch. A
reference resolved at run time from the newest image run would test a branch
that changes a Dockerfile in the old image until it merged, and the diff would
no longer name the image a commit ran in.

## Tracks still to come

The repository split plans more tracks than these three. None is here yet, and
each waits on the step that brings it:

- **`android`.** The template renders an Android image track only where both
  its `tauri_desktop` and `tauri_android` answers are true, and this
  repository answers `tauri_desktop: false`, with no Tauri app to build. The
  track arrives with those answers, when the superrepo sets them and copier
  renders the track's Dockerfile, its `.dockerignore` and the pipeline's job; a
  hand-written track now would build an image no job pulls, and would collide
  with that render.
- **`base`.** No template version ships a base track (v0.34.0, the latest, has
  `rust`, `web` and the conditional `android`), so it is a project track like
  `rust-browser`, added when the first image that builds on it does.
- **`spec-cabinet`.** Built on `rust-browser` for the Spec Cabinet's sandbox
  toolchains, it lives on the branch that carries the Spec Cabinet.

The tag stays the commit an image run is on, as described above, in the split
too: each repository's images are tagged by the commit of the image run that
built them. That is the template's scheme, written into the files it renders
(`scripts/ci/ci-image.sh`, `tags.yml`, the image pipeline) and into the
repository kit's pins (`scripts/repos/render.py` reads `ciImageTag` as a
commit). A digest of each track's inputs was considered and not taken.

## Architecture

All of these are `linux/amd64` only, built natively on the hosted agents, which
are amd64. There is no QEMU and no `binfmt` here. The devcontainer stays
multi-architecture because the published images it is built on are published
for amd64 and arm64 under one tag, and a runtime pulls the one for the machine
it runs on.
