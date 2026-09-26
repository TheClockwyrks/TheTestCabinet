# CI images

The images the gate tracks of `azure-pipelines.yml` run inside, one per track:

| Image                                                  | Track | Jobs                                                      | Holds                                                                                                                                               |
| ------------------------------------------------------ | ----- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `testcabinet.azurecr.io/ubuntu-test-cabinet-rust-cicd` | Rust  | `rust`, `rustlint`, `rustdoc`, `binary_linux`, `gg_amd64` | The pinned Rust toolchain with rustfmt, clippy and cargo-nextest; Node; gg's eleven program-language toolchains and the C# guest's build toolchains |
| `testcabinet.azurecr.io/ubuntu-test-cabinet-web-cicd`  | Web   | `web`, `checks`                                           | Node, Playwright's Chromium with its system libraries, kubectl                                                                                      |

`scripts/ci/ci-image.sh` builds and pushes them, and `azure-pipelines-ci-images.yml`
is the pipeline that runs it. A gates run builds neither: it names a tag of each
in its `resources.containers` block and lets Azure pull it through the `tcab-acr`
service connection before the job starts. The images are `linux/amd64` only,
built natively on the hosted agents; the `gg_arm64` job runs on the organisation's
arm64 pool and installs its toolchains per run.

## Why these are not the devcontainer

The devcontainer is a place to work. It carries coding agents, the Azure CLI,
gh, k3d, kubelogin, lazygit, a Docker client and a shell configured for a person,
and it is built for that person's uid. No gate runs any of that, and pulling it
on every run of every track would cost more than the checks. Splitting by track
also keeps the web image free of compilers and gg's gigabytes of toolchains, and
the Rust image free of a browser.

Both images install from the same scripts and the same pins the devcontainer
installs from, so a gate passes in the pipeline exactly when it passes in a
terminal.

## What each image holds

Both are `ubuntu:26.04`, root throughout, with no entrypoint. Azure starts a
container job's steps as a user it adds to the container with the agent's own
uid, and hands it a checkout that user owns, so nothing here needs `sudo` and the
images carry none.

The Rust image pins `HOME=/root` and opens `/root` to every user. gg's toolchains
install under `$HOME`, three of the eleven arms can install nowhere else, and the
reflectors in `crates/gg/build.rs` look there first, so the step user has to see
the same `HOME` the build did. `RUSTUP_HOME` and `CARGO_HOME` are stated
explicitly for the same reason. The web image leaves `HOME` unset, so the step
user's own home takes npm's and Playwright's caches; everything it installs lives
under `/usr/local` and `/opt`, and `PLAYWRIGHT_BROWSERS_PATH` names the browser
directory for both the install and the tests.

## Version pins

The versions the images consume come from the `x-devcontainer-build-args` anchor
in `.devcontainer/docker-compose.yml`, read by `ci/images/build-args.sh`
(`ci/images/build-args.sh rust|web` prints them). `ci-image.sh` passes them as
`--build-arg` and folds them into the tag, so bumping a consumed pin rebuilds the
image and bumping an unconsumed one (`LAZYGIT_VERSION`) leaves it alone. gg's own
pins live in `packages/gg-sandbox-*/<lang>-version.sh` and are read by the
installers; those files are image inputs, so a bump moves the tag through the
file-hash half of the digest. kubectl's pin is written in `web.Dockerfile` and
kept equal to `.devcontainer/tools/k8s.sh`.

## What the build can see

Each Dockerfile has a `<name>.Dockerfile.dockerignore` beside it, an allowlist of
exactly the files its `COPY`s read. BuildKit reads the ignore file named after the
Dockerfile in preference to the root `.dockerignore`, so the Rust image's build
context is the ~230 kB slice gg's installers are pinned by and the web image's
context is empty. A re-inclusion in those files names a path and never a
wildcard, and `scripts/ci/build-context.sh` fails when a tracked file in one of
the families the Rust allowlist enumerates is missing from it.

## When an image input changes

The tag is content-addressed: `v1-<12 hex>` over `git ls-files -s` of that
image's inputs (`ci-image.sh inputs <track>`) plus its extracted pins. Nothing is
ever pushed twice to one tag and `latest` is never used. `azure-pipelines.yml`
writes the full reference literally, and the `checks` job fails when the pinned
tag is not the one the checkout's inputs digest to.

The order to do things in:

1. Stage the change, then paste the reference `scripts/ci/ci-image.sh reference`
   prints for the track into the `resources.containers` block of
   `azure-pipelines.yml`.
2. Push the branch. The image pipeline triggers and builds the new tag. A gates
   run queued alongside it fails at job initialization until the image exists,
   because the agent cannot pull what has not been pushed.
3. Once the image pipeline is green, re-queue the gates run.

The image is built once, on the branch that introduced the change; the merge
finds it already pushed and builds nothing. `IMAGE_SCHEMA` in `ci-image.sh` (the
`v1`) is the escape hatch for what the files do not pin, the `ubuntu:26.04` tag
and the apt package sets: bumping it retires every tag.

The image pipeline is a second pipeline definition naming
`azure-pipelines-ci-images.yml`; the Building page of the documentation site has
the command that creates it.
