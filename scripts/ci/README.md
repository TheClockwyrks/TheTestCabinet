# CI scripts

The scripts the Azure pipelines run. Azure Pipelines is the project's only CI: it
gates every commit on Linux and Windows, mirrors gated commits to GitHub, builds
every image into the Test Cabinet Azure Container Registry, deploys staging,
production and the docs site, and publishes `tcab` and gg on a release tag. The
GitHub repository is a mirror and runs nothing (see
[`.github/README.md`](../../.github/README.md)).

Every job delegates to a script here or to a gate under [`ci/gates/`](../../ci/gates/),
so a failing job reproduces locally by running the same command. The YAML names the
image a job runs in, its caches, the credentials a step runs under, and which
registry round trips are retried, and nothing else.

## Two kinds of script, two helpers

This directory is shared with the k8s standard workspace template this repository is
rendered from (`.copier-answers.yml` names its source, version and answers).

- **The template's scripts** are rendered by it and are never edited here: `lib.sh`,
  `ci-image.sh`, `npm-install.sh`, `free-disk.sh`, `build-image.sh` and `deploy.sh`,
  each with its `.test.sh`. They source the template's `lib.sh`, which provides
  `build_arg` (a pin read from `.devcontainer/docker-compose.yml`), `remediation`,
  `require_npm_install` and `aks_invoke`. A change to one is a change to the template.
- **The project's scripts** are everything else. They source
  [`tcab-lib.sh`](tcab-lib.sh), which resolves the repository root, changes into it,
  and provides `log`, the registry name (`CI_REGISTRY`), the architecture an image is
  published under (`ci_arch`), and the manifest reader and namespace check
  (`ci_manifest_index`, `ci_assert_namespaced`). A script that needs both sources
  both.

`fetch.sh` is the third sourced helper. It has no side effect at all, not even a
`cd`, because the toolchain installers that source it also run inside
`containers/gg-toolchains/Dockerfile` in a tree that is not a checkout. Its
`gg_fetch` is the one `curl` a large archive is fetched with: it resumes, retries,
verifies the length the server advertised, and keeps a partial file under
`~/.cache/tcab/downloads` for the next attempt.

## The main pipeline

`azure-pipelines.yml` is the template's. It triggers, batched, on pushes to `master`,
`staging` and `nightly`; a pull request runs it through the build validation policy
of its target branch. What the project runs beyond the template's work lives in the
files it includes from [`.azure/project/`](../../.azure/project/), which the template
rendered empty once and never renders over, and in the job and step templates under
[`.azure/tcab/`](../../.azure/tcab/) those files and the release pipeline share.

| Stage        | Owner    | Runs on                  | What it runs                                                                                                                                                                                                                                |
| ------------ | -------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gates`      | template | every run                | the template's `rust` and `web` jobs, one step per gate; then the project's jobs from `.azure/project/jobs.yml` (below)                                                                                                                     |
| `publish`    | template | `staging`, gates passed  | `the-test-cabinet-backend`, built from `deployments/images/backend.Dockerfile` (a retag of `tcab-backend:<commit>`) by `build-image.sh`, pushed as `<commit>` and `latest`                                                                  |
| `deploy`     | template | `staging`, after publish | environment `tcab-staging`: `.azure/project/deploy-steps.yml` before (`pre-deploy.sh`) and after (`settle-workloads.sh --after-failure`, on failure only) the template's `deploy.sh`, which runs `post-deploy.sh` once the backend is ready |
| `prod`       | project  | `master`, gates passed   | `publish_backend` (the template's `.azure/publish-image.yml`, the same retag), then `deploy_prod` (environment `tcab-prod`) running `deploy-environment.sh prod <commit>`                                                                   |
| `gg_release` | project  | `master`, gates passed   | `gg_publish`: `publish-gg.sh` uploads the `gg-<arch>` artifacts of the gates stage                                                                                                                                                          |
| `docs`       | project  | `master` and `staging`   | `deploy-docs.sh <branch>` to the branch's Cloudflare Pages project                                                                                                                                                                          |

### The gates stage

The template's two jobs run every gate the `extra_gates` answer and the template
name, one step each, as `uv run --quiet --project ci gate run <id>`;
[`ci/README.md`](../../ci/README.md) is the reference for the gates and the runner,
and a gate is wired in by answering it, never by a step here. Several project gates
are thin wrappers over a script in this directory:

| Gate              | Script it runs                                              |
| ----------------- | ----------------------------------------------------------- |
| `contract-drift`  | `contract-drift.sh` (Rust track: it needs cargo and Node)   |
| `seeded-contract` | `seeded-contract-check.sh`                                  |
| `spec-vocabulary` | `spec-vocabulary-check.mjs`                                 |
| `audio-packs`     | `audio-packs-check.mjs`                                     |
| `build-context`   | `build-context.sh`                                          |
| `k8s-deploy-sets` | `k8s-deploy-sets.sh`, over `deploy-environment.sh --render` |
| `ci-image-pins`   | `tcab-image-pin.sh --check`                                 |

`.azure/project/setup-steps.yml` adds, in the template's `rust` job, a second disk
reclaim (`free-disk-linux.sh`, which also removes `/usr/local/lib/android`), Node and
gg's toolchains (below) and a coloured cargo log; in its `web` job, the workspace
packages (`npm run build:packages`), Astro's telemetry off, and `SKIP` for the
upstream `end-of-file-fixer` step, which fails on files inside frozen test-case
versions that may never change. The `file-endings` gate runs the same pinned hook over
every tracked file outside them, fails when the project's pipeline files set any other
`SKIP`, and every run logs a warning naming the override until the template takes a
project exclude. `.azure/project/steps.yml` prunes the linked binaries
(`cargo-target-prune.sh`) before the `rust` job's build output is cached.

The project's jobs, from `.azure/project/jobs.yml`:

| Job                                        | Runs on                        | Runs in                           | Scripts                                                                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gg_tests_<k>_of_4` ×4                     | every run                      | Rust CI image, 120 min            | `gg-test-build.sh`, `gg-test.sh <k>/4`, `cargo-target-prune.sh`                                                                                                                                                                                 |
| `rust_build`                               | every run                      | Rust CI image, 150 min            | `rust-build.sh`, then `rust-build.sh --seed` when no seed is cached, `cargo-target-prune.sh`                                                                                                                                                    |
| `binary_linux`                             | every run                      | Rust CI image, 90 min             | `release-build.sh`, `release-test.sh`, `release-doctest.sh`, `binary-smoke.sh`, `cargo-target-prune.sh`                                                                                                                                         |
| `binary_windows`                           | every run                      | hosted `windows-2022`             | `install-nextest.sh`, then the same four and the prune, through Git Bash                                                                                                                                                                        |
| `submodule_pins`                           | every run                      | hosted `ubuntu-24.04`             | `submodule-pins.sh`, with the job token                                                                                                                                                                                                         |
| `gg_amd64`, `gg_arm64`                     | `master`, `staging`            | Rust CI image; arm64 pool         | `gg-dist.sh`, kept as the `gg-<arch>` artifact                                                                                                                                                                                                  |
| `checks`                                   | every run                      | agentless                         | none: it succeeds when every check job above and the template's `rust` and `web` did                                                                                                                                                            |
| `mirror`                                   | `master`, `staging`, `nightly` | hosted `ubuntu-24.04`             | `mirror.sh`, once `checks` passed and each gg build passed or was skipped                                                                                                                                                                       |
| `audiostore_<arch>`, `audiostore_manifest` | `master`, `staging`            | hosted amd64; arm64 pool          | `audio-store-image.sh`, then `manifest.sh`                                                                                                                                                                                                      |
| `runimages_<arch>`, `runimages_manifest`   | `master`, `staging`            | hosted amd64; arm64 pool, 360 min | `free-disk-linux.sh` on both architectures, `report-disk.sh` either side of `run-images.sh` with this run's gg, then `manifest.sh` over `containers/image-names.sh` and the gg toolchain builder                                                |
| `services_<arch>`, `services_manifest`     | `master`, `staging`            | hosted amd64; arm64 pool, 240 min | `free-disk-linux.sh` on amd64, `gg-prebuilt.sh` stages this run's `gg-<arch>`, then `service-images.sh`, which runs `service-image.sh` per service on one builder, `report-disk.sh` after it, then `manifest.sh` over the eight `tcab-*` images |

The **check jobs** are the template's `rust` and `web`, the gg test partitions,
`rust_build`, both binary jobs and `submodule_pins`. The image jobs wait on `checks`
and both gg builds. They sit in the gates stage on purpose: the template's publish
stage waits on that stage, so `tcab-backend:<commit>` (which `backend.Dockerfile`
retags) and every image the staging overlay pins exist before it runs. Every image
is built natively, amd64 on a hosted agent and arm64 on the organisation's pool
`pool-dev-linux-arm64-wus3-4c-eph-01`, pushed as `<image>:<commit>-<arch>`, and
fused by `manifest.sh` into the multi-arch `<image>:<commit>` a deployment pins.

The **backend and driver images bake this run's gg** rather than linking one of their
own. The services job of each architecture downloads the `gg-<arch>` artifact of the
matching `gg_<arch>` job and `gg-prebuilt.sh <artifact-dir> <out-dir>` stages it: it
checks that the binary runs on the agent and that the reference tarball unpacks, then
writes `gg` and `gg-reference/`. `service-image.sh` reads that directory from
`TCAB_PREBUILT_GG`, for `backend` and `driver` only, and passes it as
`--build-context gg-build=<dir>`, which
replaces the `gg-build` stage of `deployments/images/services.Dockerfile`. So the
driver bakes the binary the run images were self-checked against and the backend the
documents it projected, instead of a second, ungated link. The stage itself remains
for the offline local build (`make -C deployments/local images`), which no pipeline
job exercises any more. `gg-dist.sh` packs `gg-reference.tar.gz` on both
architectures for this, so `gg reference --out` is gated on each; the documents are
architecture-independent, and `gg_publish` copies the three objects it uploads by
name, taking the x86_64 tarball.

**One job builds the eight service images of an architecture.** `services_<arch>` waits
on `checks`, both gg builds and `audiostore_manifest` (the driver bakes the audio
store), and `service-images.sh` runs `service-image.sh` once per service, in the order
backend, auth, dispatcher, driver, artifacts, arena, publisher, web, on one
`docker-container` builder (`tcab-ci`). The `build` stage of
`deployments/images/services.Dockerfile` is one `cargo build --release` of all seven
Rust service binaries, so it compiles once and the six other Rust targets take it from
the builder's local cache; `web` has its own Dockerfile and goes last. A job per image
ran that compile in every one of the seven Rust jobs (twenty minutes on a hosted amd64
agent, ten on the arm64 pool, measured on staging run 10763), and the arm64 pool runs
one job at a time with a VM provision of about three minutes per job, so the eight
arm64 service jobs alone took 100 minutes of that run's four hours. A failing service
stops the job and is named; a re-run of the same commit takes every stage already in
the registry cache (`<image>:buildcache-<arch>`), the compiled `build` stage included.

The **run-image job** is the one that ran out of disk on both architectures, so it
runs `free-disk-linux.sh` on arm64 too (that pool hands every job a fresh VM, so
there is nothing to lose), and `run-images.sh` sets `RECLAIM=1`: `containers/build.sh`
removes each pushed image once nothing later in the build order is `FROM` it and
prunes the builder cache as it goes (`containers/README.md` says why a developer's
publish must not). `report-disk.sh` prints every filesystem a build can fill, the
container store and the agent work folder as well as `/`, before the build and, even
after a failed one, after it. The `-gg` variants share one `/opt/gg` layer in the
registry (see `containers/gg/Dockerfile`), so a run-image push uploads that tree once
per architecture and mounts it into the other twenty-six.

**Registry round trips retry.** A container job's CI image pull happens before its
first step, where no step retry reaches, and the registry's OAuth token exchange can
time out on its side. Every project container job therefore sets
`VSTSAGENT_DOCKER_ACTION_RETRIES`, the agent knob that gives each docker login, pull
and start three attempts. The template's `rust` and `web` jobs take no job variable
from the project, so the same variable is set, as a pipeline variable, on the main
pipeline's definition in Azure DevOps (`the-test-cabinet`). Every `Docker@2` registry
login and every `manifest.sh` fuse carries `retryCountOnTaskFailure: 2`; the builds
themselves never retry, so a failed build keeps its reason in the log.

### The Rust jobs and their caches

gg's unit tests are not in the template's `rust-test` gate. That gate runs the whole
workspace in one job capped at 60 minutes, and gg's suite alone takes longer, so
`crates/gg/Cargo.toml` sets `test = false` on gg's lib and bin, and `gg-test.sh`
runs the suite with `cargo nextest run -p test-cabinet-gg --lib`, whose `--lib`
overrides it. `make gate` therefore does not run gg's tests; a change under
`crates/gg/` runs `scripts/ci/gg-test.sh` too.

Every project job that compiles Rust in a container runs in the template's Rust CI
image at the tag `ci/images/tags.yml` pins. A jobs template cannot read that tag, so
`.azure/project/jobs.yml` names the image as the literal default of its `rustImage`
parameter: `tcab-image-pin.sh` writes it from `tags.yml`, and the `ci-image-pins`
gate fails while the two differ. After `ci-image.sh tag` moves the tag, run
`scripts/ci/tcab-image-pin.sh` and commit both files.

Those jobs take the template `rust` job's variables (`CARGO_HOME` under
`$(Pipeline.Workspace)/ci-cache`, `CARGO_INCREMENTAL` 0, `CARGO_PROFILE_DEV_DEBUG`
`line-tables-only`) and the same first steps, from `.azure/tcab/rust-job-steps.yml`,
so what they compile carries the fingerprints that job's would:

| Cache (key prefix)           | Path                                  | Saved by                                                              | Restored by                                                                 |
| ---------------------------- | ------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `cargo-home \| v1`           | `$(Pipeline.Workspace)/ci-cache`      | the template's `rust` job and every Rust container job                | the same                                                                    |
| `gg-toolchains \| v1`        | `$(Pipeline.Workspace)/gg-toolchains` | every job taking `.azure/tcab/gg-toolchains-steps.yml`                | the same, per flavor (Rust CI image or host)                                |
| `cargo-target \| v1`         | `target`                              | the template's `rust` job; `rust_build` with the `"tcab-seed"` suffix | the template's `rust` job, whose restore key matches the seed; `rust_build` |
| `cargo-target-gg \| v1`      | `target`                              | `gg_tests_<k>_of_4`                                                   | the same                                                                    |
| `cargo-target-release \| v1` | `target`                              | `binary_linux`                                                        | the same                                                                    |
| `cargo-target-gg-dist \| v1` | `target`                              | `gg_amd64`                                                            | the same                                                                    |

Cache@2 saves only after every step of a job succeeded. So a cold template `rust`
job that outlasts its 60 minutes would never warm itself; **the seed** is what warms
it. When no seed is cached for the current `Cargo.lock`, `rust_build` runs
`rust-build.sh --seed` after its own build: the template gates' exact clippy,
rustdoc and nextest-build commands, each run whether or not the one before it passed,
saved under a key the `rust` job's restore key matches. A failing seed is reported and
does not fail the job. Expect the first run after adoption, a `rust-toolchain.toml`
bump or a cache expiry to be slow, and the template's `rust` job to need a second run.

**gg's toolchains and Node** come from `gg-ci-toolchains.sh <cache-dir>`, the one
provisioner for every job that builds or tests Rust (its header has the detail). It
installs Node at the `NODE_VERSION` pin into the cache, links the install locations
under `$HOME` into it, and runs `install-gg-toolchains.sh` and
`install-gg-build-toolchains.sh`, which are idempotent against their pins, so a warm
cache costs seconds. The one download a warm cache cannot avoid is the
`wasm32-wasip1` standard library, which `install-rust-wasm.sh` adds to the image's
toolchain outside the cache. `--node-only` provisions Node alone, for
`binary_linux`, the audio store and the docs.

## The release pipeline

A `v*` tag runs [`azure-pipelines-release.yml`](../../azure-pipelines-release.yml),
which the project owns: the template's trigger names branches only. Its first job,
`gated`, runs `require-gated-commit.sh <commit> <tag>`, which finds a run of the
main pipeline at the tagged commit, on any branch, and waits until its check jobs have
all succeeded, reading each from the run's timeline. It exits 1 naming the check that
failed; a failed run is not queued again. When no run reached that commit, which the
batched trigger allows, it queues one on the tag ref, where every branch-conditional
job and later stage skips, so that run is the gates stage alone. The image jobs,
deploys and docs of the main run never gate a release. It gives up after 200
minutes.

Then, from the same job templates as the main pipeline: `binary_linux` and
`binary_windows`, publishing the smoke-tested `tcab-linux` and `tcab-windows`
artifacts; `gg_amd64` and `gg_arm64`, each running `gg-version-gate.sh`, which fails
a gg whose version is not the tag's; `gg_publish`; and `mirror`, which pushes the tag.

## Scripts

| Script                                                                                                | What it does                                                                                                                                                          | Test                                  |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `gg-ci-toolchains.sh <cache-dir> [--node-only]`                                                       | Node at the pin, `$HOME`'s install locations linked into the cache, gg's toolchains; `##vso` PATH lines for later steps                                               | `gg-ci-toolchains.test.sh`            |
| `tcab-image-pin.sh [--check]`                                                                         | write, or check, `.azure/project/jobs.yml`'s `rustImage` default from `ci/images/tags.yml`                                                                            | `tcab-image-pin.test.sh`              |
| `require-gated-commit.sh <commit> <source-ref>`                                                       | the release gate above, through the Azure DevOps REST API and the job token                                                                                           | `require-gated-commit.test.sh`        |
| `rust-build.sh [--seed]`                                                                              | `cargo build --workspace --all-targets`, the only check that links every target; `--seed` builds what the template's `rust` job compiles                              | `rust-build.test.sh`                  |
| `gg-test-build.sh`                                                                                    | `cargo nextest run --no-run -p test-cabinet-gg --lib`, what `gg-test.sh` runs                                                                                         | `gg-test-build.test.sh`               |
| `gg-test.sh [k/N]`                                                                                    | gg's suite, `cargo nextest run -p test-cabinet-gg --lib`, whole or one `hash:k/N` partition                                                                           | `gg-test.test.sh`                     |
| `cargo-target-prune.sh`                                                                               | remove what cargo linked from `target/`, so a saved build output holds the libraries and fits the agent's disk                                                        | `cargo-target-prune.test.sh`          |
| `free-disk-linux.sh`                                                                                  | remove the hosted image's unused SDKs, `/usr/local/lib/android` included, and its preloaded container images, best-effort; readings from `report-disk.sh` either side | `free-disk-linux.test.sh`             |
| `report-disk.sh [label]`                                                                              | print the room left on `/`, the container store and the agent work folder, and `docker system df`; always exits 0                                                     | `report-disk.test.sh`                 |
| `install-gg-toolchains.sh`                                                                            | every toolchain a gg run and gg's reflectors execute (about 1.9 GB), from the per-arm `install-*.sh`                                                                  | `install-gg-toolchains.test.sh`       |
| `install-gg-build-toolchains.sh`                                                                      | the full .NET SDK and wasi-sdk only the C# guest's link needs (about 1.4 GB)                                                                                          | `install-gg-build-toolchains.test.sh` |
| `install-gg-build-tools.sh`                                                                           | warm the package-manager-delivered tools gg's artifact builds resolve, so `cargo build` stays offline                                                                 | `install-gg-build-tools.test.sh`      |
| `install-nextest.sh`                                                                                  | cargo-nextest at `NEXTEST_VERSION`, for the Windows leg                                                                                                               | `install-nextest.test.sh`             |
| `release-build.sh`, `release-test.sh`, `release-doctest.sh`                                           | release build, nextest run and doctests of `test-cabinet-core` and `test-cabinet-cli`                                                                                 | each its `<name>.test.sh`             |
| `binary-smoke.sh`, `smoke-binary.sh`                                                                  | hand the release `tcab` to the smoke check, and the check itself (`--version`, `--help`, subcommands)                                                                 | each its `<name>.test.sh`             |
| `submodule-pins.sh`                                                                                   | every submodule pin is an ancestor of that submodule's `master`, fetched commits-only                                                                                 | `submodule-pins.test.sh`              |
| `gg-dist.sh <out-dir>`                                                                                | the static musl `gg-<target>` for this architecture, plus `gg-reference.tar.gz` on both                                                                               | `gg-dist.test.sh`                     |
| `gg-version-gate.sh <gg> <ref>`                                                                       | on a tag, `gg --version` must equal the tag without its `v`                                                                                                           | `gg-version-gate.test.sh`             |
| `publish-gg.sh <dist-dir> <ref>`                                                                      | re-run the version gate, upload gg's objects to `v<version>/` in the `gg-releases` container                                                                          | `publish-gg.test.sh`                  |
| `mirror.sh <key-file> <ref>`                                                                          | force-push the built branch with its tags, or the built tag, to the GitHub mirror                                                                                     | `mirror.test.sh`                      |
| `audio-store-image.sh <commit>`                                                                       | build and push `test-cabinet-audio-store:<commit>-<arch>`                                                                                                             | `audio-store-image.test.sh`           |
| `run-images.sh <gg> <commit>`                                                                         | every run-container image, self-checked with `gg selfcheck`, pushed per architecture, reclaiming disk as it goes (`RECLAIM=1`)                                        | `run-images.test.sh`                  |
| `gg-prebuilt.sh <artifact-dir> <out-dir>`                                                             | stage a `gg-<arch>` artifact as the `gg-build` build context the backend and driver bake, checking it first                                                           | `gg-prebuilt.test.sh`                 |
| `service-image.sh <service> <commit>`                                                                 | one service image, pushed per architecture; `TCAB_PREBUILT_GG` replaces the `gg-build` stage for `backend` and `driver`                                               | `service-image.test.sh`               |
| `service-images.sh <commit>`                                                                          | every service image of one architecture, on one builder: `service-image.sh` per service in a fixed order                                                              | `service-images.test.sh`              |
| `manifest.sh <commit> <image>...`                                                                     | fuse each image's two architecture tags into the multi-arch `<commit>` tag                                                                                            | `manifest.test.sh`                    |
| `deploy-environment.sh <staging\|prod> <commit>`                                                      | roll an environment's cluster to one commit's images and wait on every workload; `--render` prints the set                                                            | `deploy-environment.test.sh`          |
| `pre-deploy.sh`, `post-deploy.sh`, `settle-workloads.sh`, `pin-images.sh`, `retire-legacy-backend.sh` | the staging deploy's project steps around the template's `deploy.sh`; each header says what it does                                                                   | each has its `.test.sh`               |
| `deploy-docs.sh <branch>`                                                                             | build `apps/docs` and deploy it to `test-cabinet-docs` (`master`) or `test-cabinet-docs-staging` (`staging`)                                                          | `deploy-docs.test.sh`                 |

Every script in this directory has its table test beside it, `<name>.test.sh`, the
ones not listed above included: the per-arm installers (`install-java.sh`,
`install-kotlin.sh`, `install-purescript.sh`, `install-wasi-sdk.sh`,
`install-dotnet.sh`, `install-swift.sh`, `install-rust-wasm.sh`,
`install-wit-bindgen.sh`, `install-adapter.sh`, `install-uv.sh`), their shared
`fetch.sh`, `tcab-lib.sh`, and the gate scripts `build-context.sh`,
`contract-drift.sh` and `seeded-contract-check.sh`. The workspace template requires
it (its render check fails a script here without one), and a new script comes with
its test. The `shell-tests` gate runs every `scripts/*.test.sh` and
`scripts/ci/*.test.sh`, each hermetic: temporary directories, stubs of the tools the
script calls on `PATH`, no network, no registry and no cluster.

## Credentials

No job holds a stored credential of its own:

| Name                                                                                                                                                | Kind                                                      | Used by                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `the-test-cabinet-acr`                                                                                                                              | Docker Registry connection (workload identity), `AcrPush` | every container job's image pull, the image jobs' pushes, the CI images |
| `tcab-deploy`                                                                                                                                       | Azure Resource Manager connection (workload identity)     | the publish stage and `publish_backend` (`AcrPush`), both deploys       |
| `tcab-gg-publish`                                                                                                                                   | Azure Resource Manager connection (workload identity)     | `gg_publish` (Storage Blob Data Contributor on `testcabinetartifacts`)  |
| `github-mirror-key`                                                                                                                                 | secure file, a deploy key with write access to the mirror | `mirror`                                                                |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`                                                                                                     | secret pipeline variables                                 | `docs`                                                                  |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AUDIO_R2_BUCKET`, `CLOUDFLARE_AUDIO_R2_PRESIGN_ACCESS_KEY_ID`, `CLOUDFLARE_AUDIO_R2_PRESIGN_SECRET_ACCESS_KEY` | secret pipeline variables                                 | `audiostore_<arch>`                                                     |
| the job token (`System.AccessToken`)                                                                                                                | per run                                                   | `submodule_pins`; the release gate, which may view and queue main runs  |

`tcab-deploy` holds "Azure Kubernetes Service RBAC Admin" on each cluster's
application namespace and the custom "Test Cabinet AKS Command Invoke" role
(`deployments/azure/aks-command-invoke.role.json`) on each cluster, because the
clusters' API servers are private and every deploy runs `kubectl` through
`az aks command invoke`.
