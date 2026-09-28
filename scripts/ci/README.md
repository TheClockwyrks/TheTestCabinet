# CI scripts

The scripts the Azure pipelines run. Azure Pipelines is the project's only CI: it
gates every commit on Linux and Windows, mirrors gated commits to GitHub, builds
every image into the Test Cabinet Azure Container Registry, deploys staging,
production and the docs site, and publishes `tcab` and gg on a release tag. The
GitHub repository is a mirror and runs nothing (see
[`.github/README.md`](../../.github/README.md)).

Every job delegates to a script here or to a gate under [`ci/gates/`](../../ci/gates/),
so a failing job reproduces locally by running the same command. The YAML names the
image a job runs in, its caches and the credentials a step runs under, and nothing
else.

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

| Job                                                 | Runs on                        | Runs in                           | Scripts                                                                                                              |
| --------------------------------------------------- | ------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `gg_tests_<k>_of_4` ×4                              | every run                      | Rust CI image, 120 min            | `gg-test-build.sh`, `gg-test.sh <k>/4`, `cargo-target-prune.sh`                                                      |
| `rust_build`                                        | every run                      | Rust CI image, 150 min            | `rust-build.sh`, then `rust-build.sh --seed` when no seed is cached, `cargo-target-prune.sh`                         |
| `binary_linux`                                      | every run                      | Rust CI image, 90 min             | `release-build.sh`, `release-test.sh`, `release-doctest.sh`, `binary-smoke.sh`, `cargo-target-prune.sh`              |
| `binary_windows`                                    | every run                      | hosted `windows-2022`             | `install-nextest.sh`, then the same four and the prune, through Git Bash                                             |
| `submodule_pins`                                    | every run                      | hosted `ubuntu-24.04`             | `submodule-pins.sh`, with the job token                                                                              |
| `gg_amd64`, `gg_arm64`                              | `master`, `staging`            | Rust CI image; arm64 pool         | `gg-dist.sh`, kept as the `gg-<arch>` artifact                                                                       |
| `checks`                                            | every run                      | agentless                         | none: it succeeds when every check job above and the template's `rust` and `web` did                                 |
| `mirror`                                            | `master`, `staging`, `nightly` | hosted `ubuntu-24.04`             | `mirror.sh`, once `checks` passed and each gg build passed or was skipped                                            |
| `audiostore_<arch>`, `audiostore_manifest`          | `master`, `staging`            | hosted amd64; arm64 pool          | `audio-store-image.sh`, then `manifest.sh`                                                                           |
| `runimages_<arch>`, `runimages_manifest`            | `master`, `staging`            | hosted amd64; arm64 pool, 360 min | `run-images.sh` with this run's gg, then `manifest.sh` over `containers/image-names.sh` and the gg toolchain builder |
| `service_<service>_<arch>` ×16, `services_manifest` | `master`, `staging`            | hosted amd64; arm64 pool, 240 min | `service-image.sh`, then `manifest.sh` over the eight `tcab-*` images                                                |

The **check jobs** are the template's `rust` and `web`, the gg test partitions,
`rust_build`, both binary jobs and `submodule_pins`. The image jobs wait on `checks`
and both gg builds. They sit in the gates stage on purpose: the template's publish
stage waits on that stage, so `tcab-backend:<commit>` (which `backend.Dockerfile`
retags) and every image the staging overlay pins exist before it runs. Every image
is built natively, amd64 on a hosted agent and arm64 on the organisation's pool
`pool-dev-linux-arm64-wus3-4c-eph-01`, pushed as `<image>:<commit>-<arch>`, and
fused by `manifest.sh` into the multi-arch `<image>:<commit>` a deployment pins.

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

| Script                                                                                                | What it does                                                                                                                             | Test                           |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `gg-ci-toolchains.sh <cache-dir> [--node-only]`                                                       | Node at the pin, `$HOME`'s install locations linked into the cache, gg's toolchains; `##vso` PATH lines for later steps                  | `gg-ci-toolchains.test.sh`     |
| `tcab-image-pin.sh [--check]`                                                                         | write, or check, `.azure/project/jobs.yml`'s `rustImage` default from `ci/images/tags.yml`                                               | `tcab-image-pin.test.sh`       |
| `require-gated-commit.sh <commit> <source-ref>`                                                       | the release gate above, through the Azure DevOps REST API and the job token                                                              | `require-gated-commit.test.sh` |
| `rust-build.sh [--seed]`                                                                              | `cargo build --workspace --all-targets`, the only check that links every target; `--seed` builds what the template's `rust` job compiles | —                              |
| `gg-test-build.sh`                                                                                    | `cargo nextest run --no-run -p test-cabinet-gg --lib`, what `gg-test.sh` runs                                                            | —                              |
| `gg-test.sh [k/N]`                                                                                    | gg's suite, `cargo nextest run -p test-cabinet-gg --lib`, whole or one `hash:k/N` partition                                              | —                              |
| `cargo-target-prune.sh`                                                                               | remove what cargo linked from `target/`, so a saved build output holds the libraries and fits the agent's disk                           | —                              |
| `free-disk-linux.sh`                                                                                  | remove the hosted image's unused SDKs, `/usr/local/lib/android` included, and its preloaded container images                             | —                              |
| `install-gg-toolchains.sh`                                                                            | every toolchain a gg run and gg's reflectors execute (about 1.9 GB), from the per-arm `install-*.sh`                                     | —                              |
| `install-gg-build-toolchains.sh`                                                                      | the full .NET SDK and wasi-sdk only the C# guest's link needs (about 1.4 GB)                                                             | —                              |
| `install-gg-build-tools.sh`                                                                           | warm the package-manager-delivered tools gg's artifact builds resolve, so `cargo build` stays offline                                    | —                              |
| `install-nextest.sh`                                                                                  | cargo-nextest at `NEXTEST_VERSION`, for the Windows leg                                                                                  | —                              |
| `release-build.sh`, `release-test.sh`, `release-doctest.sh`                                           | release build, nextest run and doctests of `test-cabinet-core` and `test-cabinet-cli`                                                    | —                              |
| `binary-smoke.sh`, `smoke-binary.sh`                                                                  | hand the release `tcab` to the smoke check, and the check itself (`--version`, `--help`, subcommands)                                    | —                              |
| `submodule-pins.sh`                                                                                   | every submodule pin is an ancestor of that submodule's `master`, fetched commits-only                                                    | `submodule-pins.test.sh`       |
| `gg-dist.sh <out-dir>`                                                                                | the static musl `gg-<target>` for this architecture, plus `gg-reference.tar.gz` on x86_64                                                | —                              |
| `gg-version-gate.sh <gg> <ref>`                                                                       | on a tag, `gg --version` must equal the tag without its `v`                                                                              | —                              |
| `publish-gg.sh <dist-dir> <ref>`                                                                      | re-run the version gate, upload gg's objects to `v<version>/` in the `gg-releases` container                                             | —                              |
| `mirror.sh <key-file> <ref>`                                                                          | force-push the built branch with its tags, or the built tag, to the GitHub mirror                                                        | —                              |
| `audio-store-image.sh <commit>`                                                                       | build and push `test-cabinet-audio-store:<commit>-<arch>`                                                                                | —                              |
| `run-images.sh <gg> <commit>`                                                                         | every run-container image, self-checked with `gg selfcheck`, pushed per architecture                                                     | —                              |
| `service-image.sh <service> <commit>`                                                                 | one service image, pushed per architecture                                                                                               | —                              |
| `manifest.sh <commit> <image>...`                                                                     | fuse each image's two architecture tags into the multi-arch `<commit>` tag                                                               | —                              |
| `deploy-environment.sh <staging\|prod> <commit>`                                                      | roll an environment's cluster to one commit's images and wait on every workload; `--render` prints the set                               | via `k8s-deploy-sets.test.sh`  |
| `pre-deploy.sh`, `post-deploy.sh`, `settle-workloads.sh`, `pin-images.sh`, `retire-legacy-backend.sh` | the staging deploy's project steps around the template's `deploy.sh`; each header says what it does                                      | each has its `.test.sh`        |
| `deploy-docs.sh <branch>`                                                                             | build `apps/docs` and deploy it to `test-cabinet-docs` (`master`) or `test-cabinet-docs-staging` (`staging`)                             | —                              |

The `shell-tests` gate runs every `scripts/*.test.sh` and `scripts/ci/*.test.sh`,
each hermetic: temporary directories, stubs of the tools the script calls on `PATH`,
no network, no registry and no cluster. The template's scripts come with theirs. Of
the project's older scripts above, the ones marked "—" have none yet.

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
