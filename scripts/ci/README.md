# CI scripts

Shared scripts invoked by both CI systems:

- **Azure DevOps** (`azure-pipelines.yml`) is the primary CI and the one CI/CD
  pipeline: it gates every commit, mirrors gated commits to GitHub, builds every
  image into the Test Cabinet Azure Container Registry, publishes gg, and
  deploys staging, production and the docs site. It runs every check, on both
  the Linux and Windows platforms. If a check can run without a macOS agent, it
  runs here — a release must never be the first thing to fail.
- **GitHub Actions** (`.github/workflows/`) runs the critical subset so a green
  GitHub run still means the components actually build and pass. It
  also owns **macOS** validation, since Azure has no macOS agents — but because
  macOS runners are costly and only needed at release time, that check runs
  **on demand** in the separate `binary-macos.yml` workflow (manual trigger or
  release-invoked) rather than on every change. GitHub additionally owns the
  **release pipeline** (`release.yml` / `release-promote.yml`), since public
  releases cannot be cut from the private Azure repository.

Keeping the real commands here — rather than inline in each pipeline's YAML —
means both systems run exactly the same checks. The pipeline YAML is responsible
only for provisioning toolchains (Rust, Node), caching, and the credentials a
step runs under; the scripts own the actual validation, builds and deploys.

Each script resolves the repository root from its own location (via `lib.sh`)
and can be run from anywhere, including locally:

```sh
./scripts/ci/rust-test.sh
```

## The Azure pipeline

`azure-pipelines.yml` triggers on pushes to `master`, `staging`, `nightly` and
`v*` tags. Pull requests into `master` and `staging` run it through build
validation policies on those branches (Azure Repos ignores a `pr:` block), and
any other branch runs the gates only. It has three stages, each after the one
before it has passed:

| Stage    | Runs on                   | Jobs                                                                                                                                                                                                                                                                                                                                                          |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gates`  | every run                 | `rust`, `binary`, `web`, `webtest`, `specs`, `format`, `validators`, `frozen`, `audiopacks`, `specvocabulary`, `buildcontext`, `contract`, `manifests` (`k8s-manifests.sh`); on `master`, `staging` and tags `gg_amd64`/`gg_arm64` (`gg-dist.sh`, plus `gg-version-gate.sh` on a tag); then `mirror` (`mirror.sh`) on `master`, `staging`, `nightly` and tags |
| `images` | `master`, `staging`, tags | on `master` and `staging`: the audio store (`audio-store-image.sh`), every run-container image (`run-images.sh`) and every service image (`service-image.sh`), per architecture, then fused by `manifest.sh`; on `master` and tags: `gg_publish` (`publish-gg.sh`)                                                                                            |
| `deploy` | `master`, `staging`       | `deploy_staging` (environment `tcab-staging`, on `staging`) or `deploy_prod` (environment `tcab-prod`, on `master`) running `deploy.sh`, and `docs` running `deploy-docs.sh`                                                                                                                                                                                  |

Every image is built natively: `amd64` on Microsoft-hosted `ubuntu-24.04` agents
and `arm64` on the organisation's arm64 pool
`pool-dev-linux-arm64-wus3-4c-eph-01`. Each architecture pushes
`<image>:<sha>-<arch>` to `testcabinet.azurecr.io`, and `manifest.sh` fuses the
two into the multi-arch `<image>:<sha>` a deployment pins. `:latest` is never
pushed.

No job holds a stored credential. Registry pushes go through the Docker Registry
service connection `tcab-acr` (workload identity federation, `AcrPush`); the
deploys through the Azure Resource Manager connection `tcab-deploy` (workload
identity federation, the custom "Test Cabinet AKS Command Invoke" role on each
cluster and "Azure Kubernetes Service RBAC Admin" on its application namespace);
the gg upload through `tcab-gg-publish` (workload identity federation, Storage
Blob Data Contributor on `testcabinetartifacts`); the mirror push through the
deploy key in the secure file `github-mirror-key`. The docs deploy needs the
secret pipeline variables `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`,
and the audio store needs `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AUDIO_R2_BUCKET`,
`CLOUDFLARE_AUDIO_R2_PRESIGN_ACCESS_KEY_ID` and
`CLOUDFLARE_AUDIO_R2_PRESIGN_SECRET_ACCESS_KEY`; all of them must be set on the
pipeline. Checkouts leave submodules off.

## Scripts

| Script                           | Checks                                                                                                                                                                                                                                                                                                                                                                                                         | Critical |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `rust-lint.sh`                   | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo doc --document-private-items`                                                                                                                                                                                                                                                                                                                          | no       |
| `install-nextest.sh`             | Install cargo-nextest pinned to `NEXTEST_VERSION`                                                                                                                                                                                                                                                                                                                                                              | —        |
| `install-gg-toolchains.sh`       | Install every toolchain a gg **run** and gg's reflectors execute                                                                                                                                                                                                                                                                                                                                               | —        |
| `install-gg-build-toolchains.sh` | Install the full .NET + wasi-sdk only the C# guest's **link** needs                                                                                                                                                                                                                                                                                                                                            | —        |
| `rust-test.sh`                   | `cargo build` + `cargo nextest run` + doctests (headless crates)                                                                                                                                                                                                                                                                                                                                               | yes      |
| `binary-smoke.sh`                | release-build, `cargo nextest run --release` + doctests, run binary                                                                                                                                                                                                                                                                                                                                            | yes      |
| `smoke-binary.sh`                | run a built binary (`--version`/`--help`/commands)                                                                                                                                                                                                                                                                                                                                                             | yes      |
| `web-build.sh`                   | `npm ci`, type-check + `vite build` of the front ends                                                                                                                                                                                                                                                                                                                                                          | yes      |
| `web-test.sh`                    | `npm ci`, build the workspace runtime packages, `vitest run` across every workspace, `node --test` over `scripts/lib`                                                                                                                                                                                                                                                                                          | yes      |
| `desktop-build.sh`               | `npm ci`, build the workspace runtime packages, type-check + `vite build` of the desktop UI, then clippy/rustdoc/build/test `crates/desktop`                                                                                                                                                                                                                                                                   | yes      |
| `specs-lint.sh`                  | markdownlint + cspell over `test-cases/**`                                                                                                                                                                                                                                                                                                                                                                     | no       |
| `format-check.sh`                | `prettier --check` over the whole checkout, frozen versions and `.prettierignore` aside                                                                                                                                                                                                                                                                                                                        | no       |
| `contract-drift.sh`              | regenerate TS bindings, JSON Schemas and gg's prompt templates, fail on diff                                                                                                                                                                                                                                                                                                                                   | yes      |
| `frozen-check.sh`                | `.frozen` test-case versions match their recorded digests                                                                                                                                                                                                                                                                                                                                                      | yes      |
| `submodule-pins.sh`              | every pinned submodule commit is an ancestor of that submodule's `master`, fetched commits-only from the host the superproject was cloned from; `submodule-pins.test.sh` is its offline table test                                                                                                                                                                                                             | yes      |
| `spec-vocabulary-check.sh`       | every non-frozen version's `prompt.hbs` and `specs/**`, plus the shared preambles in `crates/core/src/prompt.rs`, name nothing about evaluation or this project; frozen hits are reported, not failed                                                                                                                                                                                                          | yes      |
| `validators-typecheck.sh`        | `npm ci`, `tsc --noEmit` over every case's `validation/<engine>/` project                                                                                                                                                                                                                                                                                                                                      | yes      |
| `k8s-manifests.sh`               | every kustomization under `deployments/k8s/overlays/` and `deployments/k8s/cluster/` renders; each deploy set is namespaced, in its environment's namespace, and names every image at the ACR and the commit; the `azure-*` overlays name no registry; the `cluster/azure-*` bootstraps hold cluster-scoped objects only                                                                                       | yes      |
| `build-context.sh`               | every Dockerfile `COPY` source — and every gg guest package, every tree the workspace bakes in with `include_str!`, and every package `stage-tcab-packages.mjs` bakes into the host package store — survives every `.dockerignore` allowlist that can apply to it; no allowlist re-includes a wildcard family (which makes BuildKit walk the whole tree), and the families they enumerate instead are complete | yes      |
| `mirror.sh`                      | force-push the built branch with its tags, or the built tag, to the GitHub mirror                                                                                                                                                                                                                                                                                                                              | —        |
| `gg-dist.sh`                     | build the static musl `gg-<target>` for this architecture, plus `gg-reference.tar.gz` on `x86_64`                                                                                                                                                                                                                                                                                                              | —        |
| `gg-version-gate.sh`             | on a tag build, `gg --version` equals the tag with its `v` stripped; names `crates/gg` and `crates/core` to bump when it does not                                                                                                                                                                                                                                                                              | yes      |
| `publish-gg.sh`                  | re-run the version gate, upload gg's binaries and reference tarball to `v<version>/` in the `gg-releases` blob container, read each back anonymously                                                                                                                                                                                                                                                           | —        |
| `audio-store-image.sh`           | build and push `test-cabinet-audio-store:<sha>-<arch>`                                                                                                                                                                                                                                                                                                                                                         | —        |
| `run-images.sh`                  | build every run-container image with `--gg-selfcheck`, push `test-cabinet-<name>:<sha>-<arch>`, and fail unless each `-gg` representative's self-check ran                                                                                                                                                                                                                                                     | —        |
| `service-image.sh`               | build and push one service image as `<image>:<sha>-<arch>`, with a registry layer cache                                                                                                                                                                                                                                                                                                                        | —        |
| `manifest.sh`                    | fuse each image's `<sha>-amd64` and `<sha>-arm64` into the multi-arch `<sha>`                                                                                                                                                                                                                                                                                                                                  | —        |
| `deploy.sh`                      | roll an environment's cluster to one sha's images, wait for every rollout, undo and fail on one that is not ready; `--render` prints the set without a cluster                                                                                                                                                                                                                                                 | —        |
| `deploy-docs.sh`                 | build `apps/docs` and deploy it with `wrangler` to `test-cabinet-docs` (`master`) or `test-cabinet-docs-staging` (`staging`)                                                                                                                                                                                                                                                                                   | —        |

"Critical" scripts are the ones that catch a genuinely broken change (a crate or
front end failing to build or test), so they run on both CI systems. The lint
scripts run on Azure DevOps only.

`spec-vocabulary-check.sh` is the spec counterpart of the seeded-contract check
that runs after `contract-drift.sh`: that one covers the packages a run vendors,
this one covers what a model is guaranteed to read. It walks every
`test-cases/**/vX.Y.Z/` and `game-jams/**/vX.Y.Z/`, reads `prompt.hbs` and
everything under `specs/`, adds the shared preambles `crates/core/src/prompt.rs`
prepends, and fails on any word that has no reading except this project — its
name, `tcab`, "benchmark", "test case", "evaluation", "run record", a review
surface, the case manifest, a link to the repository or the gallery. A game's own
"score", "evaluate" and "harness" are left alone, and `tcab-blend` (a runner on the
model's PATH) is exempt. Frozen versions cannot be edited, so their hits are
counted on one summary line rather than failed. It is dependency-free node and
finishes in a fraction of a second, which is why it also runs on the commit hook.

`build-context.sh` is the only gate that can see a broken container build without
building one. `.dockerignore` is an **allowlist** (`*`, then explicit `!`
re-inclusions), so a `Dockerfile` that `COPY`s a path nobody re-included fails at
build time with `failed to compute cache key: "/path": not found` — and the image
builds run only on `master`/`staging`, after the gates, long after the commit
that broke them. This script reads every tracked Dockerfile against every
allowlist that can apply to it, applying Docker's own matching rules, and fails on any
context source that is missing or excluded. "Every allowlist that can apply" is not
pedantry: `.devcontainer/ubuntu.dockerfile` carries a sibling
`ubuntu.dockerfile.dockerignore`, BuildKit and Buildah disagree about when to reach for
such a file, and a source admitted by one and not the other builds for whoever added it
and fails for the next person on the other runtime. It has teeth: it reproduces all
three defects that have actually landed this way (the Blender image's authoring
helpers; the gg toolchain builder's Java installer, which broke the `-gg` variant of
every language, not just Java's; and the devcontainer's `.devcontainer/` sources, which
the root allowlist did not admit until a `podman-compose` rebuild found out), and it
self-tests its matcher before it trusts a verdict.

It also checks something no `COPY` names. The driver image's gg stage copies the
whole context and then **compiles** the gg guest packages — `crates/gg/build.rs`
reflects eleven signature catalogues out of them and the crates under
`crates/gg-sandbox-artifacts/` run each arm's `build.sh` — so a
`packages/gg-sandbox*` tree the allowlist forgets is invisible to the `COPY` half
above and to every other gate here. It surfaces minutes into an image build as a
compiler saying "no such file or directory", blamed on the arm rather than on the
context. That is the third defect of this shape to land (`packages/gg-sandbox-jvm`,
the crossing the java and kotlin arms both compile, split out of the java arm), so
the script now asserts every one of those directories survives the root allowlist.

The same blind spot has a second shape, and it is the one that took `make local-up`
down: `crates/core` **bakes** three directories into every service binary with
`include_str!` paths that climb out of `crates/` — the built-in orchestrators, the
harness manifests and the engine manifests. When engines landed, `!/engines` was not
added beside `!/orchestrators` and `!/harnesses`, and the build died minutes in on
``error: couldn't read `crates/core/src/../../../engines/none/engine.toml` `` — in all
six service images at once, since every one of them compiles `test-cabinet-core`. So the
script now resolves every literal `include_str!`/`include_bytes!` path in a compiled Rust
source against the file that writes it and asserts it survives the root allowlist. Reading
it out of the source rather than from a hand-kept list is the point: the next tree baked
into a binary is covered the day it is written. (`*.test.rs` sources are skipped — they
compile only under `cfg(test)`, and no image build runs tests — and
`concat!(env!("OUT_DIR"), …)` includes carry no literal path to check.)

`install-nextest.sh` is a provisioning helper rather than a validation check
(hence no "Critical" mark): the Rust test scripts run the suite with
[cargo-nextest](https://nexte.st) (the repo's runner, configured in
`.config/nextest.toml`), which the devcontainer already ships but bare CI agents
do not, so every job that runs tests installs it first — pinned to
`NEXTEST_VERSION` so CI matches the devcontainer. It is cross-platform (Linux,
Windows, macOS) because `binary-smoke.sh` runs on all three. nextest does not
execute doctests, so the test scripts additionally run `cargo test --doc`.

`install-gg-toolchains.sh` is the other provisioning helper, and it is a
prerequisite rather than a convenience. gg drives a model in one of eleven
program languages, and what a model is _told_ each one's sandbox offers is a
**signature catalogue** reflected out of that arm's own SDK by that arm's own
documentation tool (`tsc`, griffe, YARD, `purs`, javadoc, the Kotlin front end,
rustdoc, `swiftc -emit-symbol-graph`, `clang++ -ast-dump=json`, Roslyn).
`crates/gg/build.rs` does that reflection **as a step of building the crate** —
nothing is committed — so a machine without those toolchains cannot compile
`test-cabinet-gg`, which means it cannot run `rust-test.sh`, `rust-lint.sh`, or
anything else scoped `--workspace`. This script composes the per-arm installers
into one pinned list that every such surface calls: the devcontainer's
`postCreateCommand`, the CI scripts here, the release workflow's `gg` job, and
the driver image's gg build stage. It is idempotent (a second call is a no-op in
about a second) and costs ~1.9 GB installed. The two prerequisites it will not
install itself are the Ruby interpreter (a distribution package, and so part of
the machine) and the npm workspaces (`npm ci`, which two of the eleven arms
reflect through the pinned `typescript`); it checks for both and says so.

`install-gg-build-toolchains.sh` is its sibling and the second list, and the
split is what keeps the first list's meaning. Building gg no longer only
_reflects_ each arm — it **runs every arm's artifact build**, because what a
model's program is compiled and evaluated against (the guest components, the
compiled library sets, the SDK jars) stopped being committed for the same reason
the catalogues did: each arm has a crate under `crates/gg-sandbox-artifacts/`
whose build script runs that arm's `build.sh` into a cargo `OUT_DIR`. Ten of the
eleven arms build with toolchains that are already on the first list. The
eleventh, C#, does not: relinking Mono's IL interpreter needs a **whole** .NET
SDK and an **unpruned** wasi-sdk, ~1.4 GB that no gg run and no reflector ever
touches, so they go in a prefix of their own rather than widening the run list
and every run image with it.

Every surface that compiles `test-cabinet-gg` therefore calls **both** —
`rust-test.sh`, the release workflow's `gg` job, the driver image's gg build
stage and the devcontainer's gg layer. (`contract-drift.sh` is deliberately not
on that list any more: it stopped building gg when the backend's committed
`gg_reference.json` was retired, so it needs neither installer — see its
header.) Skipping the second one
does not break the build, which is exactly why the call is explicit everywhere:
`packages/gg-sandbox-csharp/build.sh` falls back to fetching both into that
package's own `.build/`, so what a missing prefix buys is a silent ~1.4 GB
download in the middle of somebody's first `cargo build`.

`web-test.sh` is the TypeScript counterpart of `rust-test.sh`, and is separate
from `web-build.sh` for two reasons. A failing assertion should report as a failing
test rather than as a failing build; and the two need different things, so they
run in parallel — the tests need only the small workspace runtime packages built
(`npm run build:packages`), never the app bundles.

It also runs the repository scripts' own `node:test` suites, through the root
`test:scripts`. `scripts/` is not an npm workspace, so `npm run test --workspaces`
cannot reach it: a suite there would otherwise be executed by no gate. The suites are
hermetic — no network, no ffmpeg, no object store — so they cost this job under a
second and need nothing the job does not already have.

`desktop-build.sh` covers the Tauri desktop app —
both its React UI (`apps/desktop`) and its Rust shell (`crates/desktop`). It exists
because the app used to be validated nowhere but the Release workflow, which is
the last possible place to find a break: a release fanned out to three platforms
and all three failed in the UI's `tsc -b`, on code no earlier gate had ever
compiled. It is also the only script that lints and tests `test-cabinet-desktop`,
the one crate the Rust scripts exclude, so between them the Cargo workspace is
covered with no holes. Its runner is the only one that needs the Linux GUI system
libraries, which it installs from the devcontainer's curated list
(`.devcontainer/languages/rust/tauri.sh`) rather than a second copy of it. It does
**not** produce the platform installers or their k3d/kubectl sidecars: that is
release-time packaging and stays in `release.yml`.

`binary-smoke.sh` is the release gate that keeps a flat-out-broken binary from
ever being published: it builds `tcab` in the shipped release profile, runs the
suite in that profile, and then hands the produced binary to `smoke-binary.sh`,
with no container runtime or API keys required. It runs per platform — Azure on
Linux and Windows continuously, GitHub on macOS on demand (the `binary-macos.yml`
workflow) — so each target's binary is proven to build and start before a release.

`smoke-binary.sh` is the single definition of that smoke check: given a path, it
runs the binary's `--version`/`--help` and confirms its subcommands are wired up.
The release pipeline (`release.yml`) calls it on **each platform's shipped
artifact**, so the exact check that guards CI also guards a release — a green
Azure run is never the only thing between a broken binary and users. It takes a
binary path rather than resolving the repo root, so it does not use `lib.sh`.

`lib.sh` is a sourced helper (not a standalone script): it resolves the repo root
and provides the `log` helper, the registry name (`CI_REGISTRY`), the
architecture an image is published under (`ci_arch`), and the manifest reader
and namespace check (`ci_manifest_index`, `ci_assert_namespaced`) that
`deploy.sh` and `k8s-manifests.sh` share.

`fetch.sh` is the other sourced helper, and it has no side effect at all — not
even a `cd` — because the six toolchain installers that source it are also run
from inside `containers/gg-toolchains/Dockerfile`, which copies each of them into
a `/tmp/gg-<arm>` tree that is not a checkout. Its `gg_fetch` is the one `curl` a
large archive is fetched with: it resumes (`-C -`), retries, verifies the finished
file against the length the server advertised, and keeps the partial file when it
gives up, staged under `gg_fetch_dir` — `~/.cache/tcab/downloads`, which the
service-image build already mounts a BuildKit cache over. That last part is what a
1.05 GB Swift toolchain on a 1.5 MB/s link needs: a dropped connection costs the
remainder of the transfer rather than all of it, and it costs the _next_ run
nothing at all.

### Delivery scripts

`mirror.sh <key-file> <ref>` pushes a gated commit to
`github.com/TheClockwyrks/TheTestCabinet`. A branch is force-pushed with every
tag it contains, and a tag on its own. It is the only thing that pushes there, so
the mirror follows Azure exactly and holds gated commits only. The job checks out
with full history and tags, because GitHub refuses a push from a shallow clone.

`service-image.sh <service> <sha>`, `run-images.sh <gg-binary> <sha>` and
`audio-store-image.sh <sha>` build for the machine's own architecture and push
`<image>:<sha>-<arch>`; `manifest.sh <sha> <image>...` fuses the two
architectures into `<image>:<sha>` once both have pushed, so `<sha>` never names
a single-architecture image. The audio store is built first because the driver
image bakes `test-cabinet-audio-store:<sha>`. `run-images.sh` builds through
`containers/build.sh --gg-selfcheck` with the gg the gates built, and requires
each `-gg` representative's `gg selfcheck ok:` line by name, so a dropped flag
fails the job rather than publishing unchecked images.

`deploy.sh <staging|prod> <sha>` rolls `testcabinet-<env>-westus2-aks`. It
writes a throwaway kustomization beside `deployments/k8s/overlays/azure-<env>`
that sets every service image to `testcabinet.azurecr.io/<image>:<sha>` and the
dispatcher's `TCAB_DRIVER_IMAGE`, `TCAB_PUBLISHER_IMAGE`,
`TCAB_CONTAINER_REGISTRY` and `TCAB_CONTAINER_TAG`, renders it with `kubectl
kustomize` into one manifest file, and refuses a file holding anything outside
`tcab-<env>`. The clusters' API servers are private, so it then runs
`kubectl apply -f` and each `rollout status` (600 seconds per `Deployment` and
`StatefulSet`) inside the cluster through `az aks command invoke`, uploading the
file with the apply. A rollout that is not ready is described, its logs printed,
and undone the same way, and the script fails. The caller needs the custom
"Test Cabinet AKS Command Invoke" role
(`deployments/azure/aks-command-invoke.role.json`) on the cluster and "Azure
Kubernetes Service RBAC Admin" on the namespace. Run by hand it rolls to any sha
in the registry, which is how an earlier commit is put back.
`k8s-manifests.sh` gates on `deploy.sh --render`, the same bytes the deploy
applies, so a cluster-scoped object or a stray image reference fails the commit
that adds it rather than the deploy.

`gg-dist.sh <out-dir>` builds gg's release objects on each architecture, and
`gg-version-gate.sh <gg> <ref>` fails a tag build whose gg reports another
version. `publish-gg.sh <dist-dir> <ref>` runs that gate again, then uploads
`gg-x86_64-unknown-linux-musl`, `gg-aarch64-unknown-linux-musl` and
`gg-reference.tar.gz` to `v<version>/` in the `gg-releases` container of
`testcabinetartifacts`, the layout `core::gg_exec::release_asset_url` downloads
from.

`deploy-docs.sh <branch>` builds the docs site and deploys it to the Cloudflare
Pages project for `master` or `staging`, with `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` from the pipeline's secret variables.

## Scope

These cover **every component the project ships**. On the Rust side that is the
whole Cargo workspace — the `tcab` CLI (`crates/cli`), the `tcab-backend`
(`crates/backend`) server, the run-topology services (`tcab-dispatcher`,
`tcab-driver`, `tcab-artifacts`), the `crates/core`/`crates/telemetry` libraries
they share, and the Tauri desktop shell (`crates/desktop`). On the TypeScript side
it is the front ends built by `web-build.sh` — the gallery (`apps/site`), the
operator web console (`apps/web`), and these docs (`apps/docs`) — plus the desktop
UI (`apps/desktop`) built by `desktop-build.sh`, all on top of
`packages/run-record` and the source-consumed `packages/ui`; plus, through
`web-test.sh`, every workspace's unit suite.

The desktop app is split across two scripts rather than folded into the rest, for
one reason: its Linux build needs GUI system libraries nothing else does. So the
Rust scripts pass `--workspace --exclude test-cabinet-desktop` rather than a bare
`--workspace` — the one excluded crate is the only one with that dependency — and
`desktop-build.sh` picks it up on a runner that installs them. Excluded from the
common runners, not from CI.

### The one gap: macOS

Nothing a CI agent can build is left for a release to discover. The single
exception is **macOS**, which Azure has no agents for: the macOS `tcab` binary is
checked on demand by GitHub's `binary-macos.yml`, and the macOS desktop app is
first built when `release.yml` bundles it. Every other platform and component is
validated on every change.
