# CI scripts

The scripts the Azure pipelines run. Azure Pipelines is the project's only CI: it
gates every commit on Linux and Windows, mirrors gated commits to GitHub, builds
every image into the Test Cabinet Azure Container Registry, and deploys staging,
production and the docs site. The driver's image, the run-container images, the
audio store and `tcab` are microservice-driver's, built and released by that
repository's pipeline. gg is built, tested and released by its own repository's
pipeline; this one consumes the release the driver pins (`gg-release.sh`). The GitHub
repository is a mirror and runs nothing (see [`.github/README.md`](../../.github/README.md)).

Every job delegates to a script here or to a gate under [`ci/gates/`](../../ci/gates/),
so a failing job reproduces locally by running the same command. The YAML names the
image a job runs in, its caches, the credentials a step runs under, and which
registry round trips are retried, and nothing else.

## Two kinds of script, two helpers

This directory is shared with the k8s standard workspace template this repository is
rendered from (`.copier-answers.yml` names its source, version and answers).

- **The template's scripts** are rendered by it: `lib.sh`, `ci-image.sh`,
  `npm-install.sh`, `free-disk.sh`, `build-image.sh`, `collect-test-results.sh` and
  `deploy.sh`, each with its `.test.sh`. They source the template's `lib.sh`, which
  provides `build_arg` (a pin read from `.devcontainer/docker-compose.yml`),
  `remediation`, `require_npm_install` and `aks_invoke`. An edit to one here is
  carried through the three-way merge of the next `copier update`; a change every
  project wants belongs in the template.
- **The project's scripts** are everything else. They source
  [`tcab-lib.sh`](tcab-lib.sh), which resolves the repository root, changes into it,
  and provides `log`, the registry name (`CI_REGISTRY`), the architecture an image is
  published under (`ci_arch`), and the manifest reader and namespace check
  (`ci_manifest_index`, `ci_assert_namespaced`), and the resolver of a submodule's
  relative URL (`ci_resolve_url`). A script that needs both sources both.

`cargo-lock.sh` is the third sourced helper: `cargo_locked_args` and
`cargo_keeping_lock_order`, the lockfile rule under the superrepo's patch table
(`--locked` only where no patch table shapes the build), which `rust-build.sh`
sources.

## The main pipeline

`azure-pipelines.yml` is the template's. It triggers, batched, on pushes to `master`,
`staging` and `nightly`; a pull request runs it through the build validation policy
of its target branch. What the project runs beyond the template's work lives in the
files it includes from [`.azure/project/`](../../.azure/project/), which are the
project's own, and in the job and step templates under
[`.azure/tcab/`](../../.azure/tcab/) those files share.

| Stage     | Owner    | Runs on                  | What it runs                                                                                                                                                                                                                                                                                     |
| --------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gates`   | template | every run                | the template's `rust` and `web` jobs, one step per gate; then the project's jobs from `.azure/project/jobs.yml` (below)                                                                                                                                                                          |
| `publish` | template | `staging`, gates passed  | `the-test-cabinet-backend`, built from `deployments/images/backend.Dockerfile` (a retag of `tcab-backend:<commit>`) by `build-image.sh`, pushed as `<commit>` and `latest`                                                                                                                       |
| `deploy`  | template | `staging`, after publish | environment `tcab-staging`: `.azure/project/deploy-steps.yml` before (`pre-deploy.sh`) and after (`settle-workloads.sh --after-failure`, on failure only) the template's `deploy.sh`, which runs `deploy-preflight.sh` before it applies anything and `post-deploy.sh` once the backend is ready |
| `prod`    | project  | `master`, gates passed   | `publish_backend` (the template's `.azure/publish-image.yml`, the same retag), then `deploy_prod` (environment `tcab-prod`) running `deploy-environment.sh prod <commit>`                                                                                                                        |
| `docs`    | project  | `master` and `staging`   | `deploy-docs.sh <branch>` to the branch's Cloudflare Pages project                                                                                                                                                                                                                               |

### The gates stage

The template's two jobs run every gate, the template's and the project's, one step
each, as `uv run --quiet --project ci gate run <id>`;
[`ci/README.md`](../../ci/README.md) is the reference for the gates and the runner
and says how a gate is wired in. Several project gates are thin wrappers over a
script in this directory:

| Gate              | Script it runs                                              |
| ----------------- | ----------------------------------------------------------- |
| `build-context`   | `build-context.sh`                                          |
| `k8s-deploy-sets` | `k8s-deploy-sets.sh`, over `deploy-environment.sh --render` |

`.azure/project/setup-steps.yml` adds, in the template's `rust` job, a second disk
reclaim (`free-disk-linux.sh`, which also removes `/usr/local/lib/android`), Node and
the npm workspace (below) and a coloured cargo log; in its `web` job, the workspace
packages (`npm run build:packages`) and Astro's telemetry off.
`.azure/project/steps.yml` prunes the linked binaries (`cargo-target-prune.sh`)
before the `rust` job's build output is cached. Both jobs run the project's gates and
steps before the collection and publish of their test results, which every job
running a test gate ends with. The upstream hooks the `web` job runs over every file
exclude the test-case and game-jam version directories, since a frozen version is
immutable and some hold files those hooks would rewrite.

The project's jobs, from `.azure/project/jobs.yml`:

| Job                                    | Runs on                         | Runs in                           | Scripts                                                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paths`                                | every run                       | hosted `ubuntu-24.04`             | `changed-paths.sh`, over a two-deep checkout: which of the check jobs below a pull request reaches, as the `detect.rust` and `detect.submodules` outputs                                                                              |
| `rust_build`                           | every push; a PR reaching Rust  | Rust CI image, 150 min            | `rust-build.sh`, then `rust-build.sh --seed` when no seed is cached, `cargo-target-prune.sh`                                                                                                                                          |
| `submodule_pins`                       | every push; a PR touching a pin | hosted `ubuntu-24.04`             | `submodule-pins.sh`, with the job token and a checkout of each submodule's repository                                                                                                                                                 |
| `checks`                               | every run                       | agentless                         | none: it succeeds when `paths` and the template's `rust` and `web` did, and every check job above did or was skipped by `paths`                                                                                                       |
| `mirror`                               | `master`, `staging`, `nightly`  | hosted `ubuntu-24.04`             | `mirror.sh`, once `checks` passed; a failed push is a warning, not a failed stage                                                                                                                                                     |
| `services_<arch>`, `services_manifest` | `master`, `staging`             | hosted amd64; arm64 pool, 240 min | `submodules.sh init --build-context`, `free-disk-linux.sh` on amd64, then `service-images.sh`, which runs `service-image.sh` per service on one builder, `report-disk.sh` after it, then `manifest.sh` over the one `tcab-*` image    |

The **check jobs** are the template's `rust` and `web`,
`rust_build` and `submodule_pins`. A push runs them all; a pull
request runs the template's two and the project ones its change reaches, which
`paths` decides (`changed-paths.sh`, below). The image jobs wait on `checks`. They sit
in the gates stage on purpose: the template's publish
stage waits on that stage, so `tcab-backend:<commit>` (which `backend.Dockerfile`
retags) and every image the staging overlay pins exist before it runs. Every image
is built natively, amd64 on a hosted agent and arm64 on the organisation's pool
`pool-dev-linux-arm64-wus3-4c-eph-01`, pushed as `<image>:<commit>-<arch>`, and
fused by `manifest.sh` into the multi-arch `<image>:<commit>` a deployment pins.

The **backend image bakes the pinned gg release's documents** rather than building
gg. The `gg-release` stage of `deployments/images/services.Dockerfile` runs
`gg-release.sh fetch`, which reads the version the driver compiles in
(`microservice-driver/crates/driver/gg-release-version`), downloads the static
`gg-<target>` of the build's architecture and `gg-reference.tar.gz` from the
`gg-releases` container, refuses a binary whose `gg --version` is not that version
and a tarball without `gg-reference/index.json`, and writes `gg` and
`gg-reference/`. The backend bakes the documents at `/opt/gg-reference`
(`TCAB_GG_REFERENCE`). The stage's cache is keyed on the pin file and the two
scripts alone, so a bump of the pin is what fetches it again.

**One job builds the service images of an architecture.** `services_<arch>` waits
on `checks`, and `service-images.sh` runs `service-image.sh` once per service, in the
order backend (the one service today), on one
`docker-container` builder (`tcab-ci`). The `build` stage of
`deployments/images/services.Dockerfile` is one `cargo build --release` of every
Rust service binary, so it compiles once and any other Rust target takes it from
the builder's local cache. A job per image
ran that compile in every one of the Rust jobs (twenty minutes on a hosted amd64
agent, ten on the arm64 pool, measured on staging run 10763), and the arm64 pool runs
one job at a time with a VM provision of about three minutes per job, so the eight
arm64 service jobs alone took 100 minutes of that run's four hours. A failing service
stops the job and is named; a re-run of the same commit takes every stage already in
the registry cache (`<image>:buildcache-<arch>`), the compiled `build` stage included.

**Registry round trips retry.** A container job's CI image pull happens before its
first step, where no step retry reaches, and the registry's OAuth token exchange can
time out on its side. Every project container job therefore sets
`VSTSAGENT_DOCKER_ACTION_RETRIES`, the agent knob that gives each docker login, pull
and start three attempts. The template's `rust` and `web` jobs take no job variable
from the project, so the same variable is set, as a pipeline variable, on the main
pipeline's definition in Azure DevOps (`the-test-cabinet`). Every `Docker@2` registry
login and every `manifest.sh` fuse carries `retryCountOnTaskFailure: 2`; the builds
themselves never retry, so a failed build keeps its reason in the log.

**Registry retention.** The registry is on the Basic tier, which has no retention
policy, so two scripts delete what nothing will pull again. At the end of the
staging and prod deployments, on `succeededOrFailed()` and never failing the
deployment, `registry-purge.sh` (an AzureCLI@2 step under `tcab-deploy`, which
holds AcrDelete and the command-invoke role on both clusters) reads what the
`tcab-staging` and `tcab-prod` namespaces run through `az aks command invoke`
and keeps those commits, the commit just deployed (`--keep`) and the newest
commit in the registry; in every `tcab-*` and `test-cabinet-*` repository it
then deletes the other commit tags (`<sha>`, `<sha>-<arch>`), every
`inputs-<hex>-<arch>` manifest but the newest per architecture (the last build of
unchanged inputs stays reusable), and the untagged manifests older than an hour
that no remaining index names. `buildcache-*`, `latest` and any other tag are
always kept, and a cluster that cannot be read stops it with nothing deleted, as
does a token the registry issued without `delete` (the identity lacks AcrDelete,
or the role was assigned to its application id rather than its object id). After
the CI-images pipeline pushes, `ci-image-purge.sh` (from
`.azure/project/ci-image-steps.yml`, with the `the-test-cabinet-acr`
credential) deletes from the track's `ubuntu-the-test-cabinet-<track>-cicd`
repository every tag that `master`, `staging`, `nightly` and the checkout do not
pin as `ciImageTag` in `ci/images/tags.yml`, nor the `azure-pipelines.yml` of
those branches of a submodule repository (each `.gitmodules` entry with a
relative URL, read through the job's access token) names as
`ubuntu-the-test-cabinet-<track>-cicd:<commit>`, nor was pushed within the last
day (so the image of a run still in flight on another branch, and an image whose
pin has not landed yet, survive; each tag spared for its age is logged), and
from it and its `-cache` repository the untagged manifests older than an hour
that no kept or spared index names; a branch or a submodule repository it
cannot read stops it.

### The Rust jobs and their caches

Every project job that compiles Rust in a container runs in the template's Rust CI
image at the commit `ci/images/tags.yml` pins as `ciImageTag`. A template cannot
read that variable, so the root pipeline names the image,
`testcabinet.azurecr.io/ubuntu-the-test-cabinet-rust-cicd:${{ variables.ciImageTag }}`,
the expression the template's `rust` job uses: `azure-pipelines.yml` passes it to
`.azure/project/jobs.yml` as its `rustImage` parameter. The `ci-image-pins` gate
fails on the root pipeline naming a CI image
another way and on any file under `.azure/` naming one. Moving the pin is one edit of
`tags.yml` once the image pipeline's run on a commit has pushed every image. The
template's `rust` job itself runs in the Rust image for now. It is to move into the
project's rust-browser image, the Rust image with Node and Chromium on top, named with
the same expression, in the commit that pins `ciImageTag` to a run that built it.

Those jobs take the template `rust` job's variables (`CARGO_HOME` under
`$(Pipeline.Workspace)/ci-cache`, `CARGO_INCREMENTAL` 0, `CARGO_PROFILE_DEV_DEBUG`
`line-tables-only`) and the same first steps, from `.azure/tcab/rust-job-steps.yml`,
so what they compile carries the fingerprints that job's would:

| Cache (key prefix)   | Path                             | Saved by                                                              | Restored by                                                                 |
| -------------------- | -------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `cargo-home \| v1`   | `$(Pipeline.Workspace)/ci-cache` | the template's `rust` job and every Rust container job                | the same                                                                    |
| `cargo-target \| v1` | `target`                         | the template's `rust` job; `rust_build` with the `"tcab-seed"` suffix | the template's `rust` job, whose restore key matches the seed; `rust_build` |

Cache@2 saves only after every step of a job succeeded. So a cold template `rust`
job that outlasts its 120 minutes would never warm itself; **the seed** is what warms
it. When no seed is cached for the current `Cargo.lock`, `rust_build` runs
`rust-build.sh --seed` after its own build: the template gates' exact clippy,
rustdoc and nextest-build commands, each run whether or not the one before it passed,
saved under a key the `rust` job's restore key matches. A failing seed is reported and
does not fail the job. Expect the first run after adoption, a `rust-toolchain.toml`
bump or a cache expiry to be slow, and the template's `rust` job to need a second run.

**Node** comes from `provision-node.sh <dir>`, through
`.azure/tcab/node-steps.yml`, for every job that builds or tests Rust and the docs.
It installs Node at the `NODE_VERSION` pin of the dev container's compose file into
`<dir>/node` and puts it on PATH for the job's later steps; the steps' `npmInstall`
parameter adds `npm-install.sh`, which the Rust jobs take.

## Releases

A `v*` tag of this repository runs nothing: a version is released by a `v*` tag on
each repository (see `development/releasing.md`). `tcab` is microservice-driver's,
whose pipeline publishes the smoke-tested `tcab-linux` and `tcab-windows` artifacts on
its own tag; gg is released by its own repository.

## Scripts

| Script                                                                                                | What it does                                                                                                                                                                    | Test                                  |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `provision-node.sh <dir>`                                                                             | Node at the dev container's `NODE_VERSION` pin into `<dir>/node`, and the `##vso` PATH line for later steps                                                                     | `provision-node.test.sh`              |
| `changed-paths.sh [--reason <Build.Reason>] [--paths-from <file>]`                                    | which check-job groups a pull request reaches, from the merge commit's diff against its first parent, as `##vso` output variables; every group on any other run                 | `changed-paths.test.sh`               |
| `rust-build.sh [--seed]`                                                                              | `cargo build --workspace --all-targets`, the only check that links every target; `--seed` builds what the template's `rust` job compiles                                        | `rust-build.test.sh`                  |
| `cargo-target-prune.sh`                                                                               | remove what cargo linked from `target/`, so a saved build output holds the libraries and fits the agent's disk                                                                  | `cargo-target-prune.test.sh`          |
| `free-disk-linux.sh`                                                                                  | remove the hosted image's unused SDKs, `/usr/local/lib/android` included, and its preloaded container images, best-effort; readings from `report-disk.sh` either side           | `free-disk-linux.test.sh`             |
| `report-disk.sh [label]`                                                                              | print the room left on `/`, the container store and the agent work folder, and `docker system df`; always exits 0                                                               | `report-disk.test.sh`                 |
| `install-playwright-chromium.sh`                                                                      | Playwright's Chromium and its system libraries at the `PLAYWRIGHT_IMAGE` tag, started once, for a machine outside the devcontainer; run as root                                 | `install-playwright-chromium.test.sh` |
| `submodule-pins.sh [--branch <b>]`                                                                    | every submodule pin is an ancestor of that submodule's branch of the same name, or of its `master`, fetched commits-only                                                        | `submodule-pins.test.sh`              |
| `submodules.sh init\|list [--build-context] [<path>...]`                                              | initialize only the named submodules, and those the root `.dockerignore` admits, one deep and never recursively                                                                 | `submodules.test.sh`                  |
| `mirror.sh [--url <mirror>] [--allow-rewrite] <key-file> <ref>`                                       | push the built branch with its tags, or the tag, to the declared mirror, refusing a non-ancestor head                                                                           | `mirror.test.sh`                      |
| `gg-release.sh version\|toolchains-image\|fetch <out-dir>`                                            | the gg release the driver pins: its version, the toolchain image the `-gg` variants copy, or the binary and reference documents, checked                                        | `gg-release.test.sh`                  |
| `service-image.sh <service> <commit>`                                                                 | one service image, pushed per architecture                                                                                                                                      | `service-image.test.sh`               |
| `service-images.sh <commit>`                                                                          | every service image of one architecture, on one builder: `service-image.sh` per service in a fixed order                                                                        | `service-images.test.sh`              |
| `registry-purge.sh [--dry-run] [--keep <sha>]... [--keep-count <n>] [--no-cluster]`                   | delete the `tcab-*` and `test-cabinet-*` images no environment runs, after each deployment; the policy is under _Registry retention_                                            | `registry-purge.test.sh`              |
| `ci-image-purge.sh [--dry-run] <rust\|rust-browser\|web>`                                             | delete the track's CI images no live branch pins in `ci/images/tags.yml` or a submodule repository's pipeline, after the CI-images pipeline pushes                              | `ci-image-purge.test.sh`              |
| `manifest.sh <commit> <image>...`                                                                     | fuse each image's two architecture tags into the multi-arch `<commit>` tag                                                                                                      | `manifest.test.sh`                    |
| `deploy-environment.sh <staging\|prod> <commit>`                                                      | roll an environment's cluster to one commit's images and wait on every workload; `--render` prints the set                                                                      | `deploy-environment.test.sh`          |
| `pre-deploy.sh`, `post-deploy.sh`, `settle-workloads.sh`, `pin-images.sh`, `retire-legacy-backend.sh` | the staging deploy's project steps around the template's `deploy.sh`; each header says what it does                                                                             | each has its `.test.sh`               |
| `deploy-preflight.sh <commit>`                                                                        | the hook the template's `deploy.sh` runs before it applies anything: the catalog preflight of the namespace's environment                                                       | `deploy-preflight.test.sh`            |
| `catalog-ingest.sh <preflight\|verify> <staging\|prod>`                                               | a deployment's two catalog checks: the branch tip and its cold-storage pin can be fetched (before the apply); the ingest sidecar ingested (after the rollout)                   | `catalog-ingest.test.sh`              |
| the `ingest` sidecar in `deployments/k8s/overlays/<env>/patch-backend-ingest.yaml`                    | records the startup run's outcome for `verify`; a failed refresh ingests nothing, a failed test suites update alone still ingests; its refresh endpoint                         | `catalog-ingest-sidecar.test.sh`      |
| `deploy-docs.sh <branch>`                                                                             | build `apps/docs` and deploy it to `test-cabinet-docs` (`master`) or `test-cabinet-docs-staging` (`staging`)                                                                    | `deploy-docs.test.sh`                 |

`catalog-fixture.sh` is the local catalog mirror the catalog tests run their real git
commands against.

Every script in this directory has its table test beside it, `<name>.test.sh`, the
ones not listed above included: `tcab-lib.sh`, `cargo-lock.sh` and the gate script
`build-context.sh`. The workspace template requires it (its render check fails a
script here without one), and a new script comes with its test. gg's toolchain
installers and their tests are the `gg` repository's. The `shell-tests` gate runs
every `scripts/*.test.sh` and `scripts/ci/*.test.sh`, and the gg checkout's
`scripts/ci/gg-image-toolchains.test.sh`, each hermetic: temporary
directories, stubs of the tools the script calls on `PATH`, no network, no
registry and no cluster.

## Credentials

No job holds a stored credential of its own:

| Name                                            | Kind                                                                             | Used by                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `the-test-cabinet-acr`                          | Docker Registry connection (workload identity), `AcrPush` and `AcrDelete`        | every container job's image pull, the image jobs' pushes, the CI images and their purge                       |
| `tcab-deploy`                                   | Azure Resource Manager connection (workload identity), `AcrPush` and `AcrDelete` | the publish stage and `publish_backend`, both deploys and the registry purge after each                       |
| `tcab-gg-publish`                               | Azure Resource Manager connection (workload identity)                            | none since gg's release moved to its own repository (Storage Blob Data Contributor on `testcabinetartifacts`) |
| `github-mirror-key`                             | secure file, a deploy key with write access to the mirror                        | `mirror`                                                                                                      |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | secret pipeline variables                                                        | `docs`                                                                                                        |
| the job token (`System.AccessToken`)            | per run                                                                          | `submodule_pins`                                                                                              |

`tcab-deploy` holds "Azure Kubernetes Service RBAC Admin" on each cluster's
application namespace and the custom "Test Cabinet AKS Command Invoke" role
(`deployments/azure/aks-command-invoke.role.json`) on each cluster, because the
clusters' API servers are private and every deploy runs `kubectl` through
`az aks command invoke`.
