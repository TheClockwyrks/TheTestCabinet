---
title: Repositories
description: "The repositories of The Test Cabinet, the edges between them, how the superrepo joins their checkouts, and the kit every repository is rendered from."
---

The Test Cabinet is a set of repositories, and this one, `the-test-cabinet`, is
the superrepo that holds each of them as a submodule at its root. The superrepo
holds the documentation site, the issue board, the repository kit and the gates
over the whole set, and no code of the product's own. Every repository lives in
the `the-test-cabinet` project of the `genyume` Azure DevOps organization under
its plain name, and is mirrored to GitHub under `TheClockwyrks` by the same
name; the superrepo's mirror is `TheTestCabinet`.

A repository is named by its category where several repositories of a type
exist (`microservice-*`, `tool-*`). A library carries no prefix, a site is named
by its hostname, and the hub is `contracts`.

## The dependency rule

The set is a hub and its spokes, with `contracts` as the hub. A library
repository may be depended on; an application, site, shell, tool-binary or
content repository is never depended on. Every shape two repositories exchange,
and everything that keeps repositories in step, lives in `contracts`. The
backend's API package, `@clockwyrks/backend-api`, is generated there, so the
console takes it from the hub and no application depends on another.

## The kinds

The kind decides a repository's shape.

| Kind | Shape |
| --- | --- |
| `library` | A Rust workspace that commits no `Cargo.lock`, and an npm workspace |
| `application` | A Rust binary crate that commits its lock, and an npm workspace |
| `tool` | A library workspace whose binaries are also baked into the run-container images; depended on as a library is |
| `shell` | A Tauri workspace, a Rust shell crate that commits its lock plus an npm workspace, building desktop and Android bundles; depends on nothing of the project at build time |
| `site` | An npm workspace and no Rust |
| `content` | No Rust, and an npm workspace of the tools its content is authored with |

`cold-storage` is a submodule too, and the kit renders nothing into it.

## The repositories

| Repository | Kind | What it holds |
| --- | --- | --- |
| `contracts` | library | Every wire and file shape and its validation, the suite runtime, telemetry, redaction, the backend's client, both generators and the packages they write |
| `engines` | library | The authored engines and their manifests, the voxel, particle and lattice playback runtimes, the case harness, and the adversarial and performance runtimes with the match runner |
| `ui-common` | library | `@clockwyrks/ui` and `@clockwyrks/run-stats` |
| `tool-model-core` | tool, library only | `model-core`, `voxel-mesh`, `model-skin` |
| `tool-sprite` | tool | `draw` (`draw`, `draw-sheet`) |
| `tool-paint` | tool | `paint`, the UI and material binaries |
| `tool-voxel` | tool | `voxel`, `voxel-anim` |
| `tool-mc` | tool | `mc`, `mc-anim`, `mc-skin` |
| `tool-sn` | tool | `sn`, `sn-anim`, `sn-skin` |
| `tool-dc` | tool | `dc`, `dc-anim`, `dc-skin` |
| `tool-particle` | tool | `particle-core`, `particle-2d`, `particle-3d` |
| `tool-audio-core` | tool, library only | `audio-core` |
| `tool-sfx-synth` | tool | `sfx-synth` |
| `tool-sfx-sample` | tool | `sfx-sample` |
| `tool-music` | tool | `music` |
| `microservice-backend` | application | `tcab-backend` and its ingest sidecar |
| `microservice-dispatcher` | application | `tcab-dispatcher` |
| `microservice-driver` | application | `tcab-driver`, the run engine, and the `tcab` CLI as a second binary |
| `microservice-artifacts` | application | `tcab-artifacts`, the write-through store of run trees and the one writer of both object stores |
| `microservice-repos` | application | `tcab-repos`, the write-through store of run implementations as git bundles and the public push |
| `microservice-publisher` | application | `tcab-publisher`, the per-publish Job |
| `microservice-arena` | application | `tcab-arena` |
| `gg` | application | gg, its SDKs, the program-language toolchains, the sandbox packages and artifact crates, the `agent-prompts` and `gg-sdk-documentation` skills, and gg's documentation pages |
| `the-spec-cabinet` | application | The authoring tool for test suites |
| `testcabinet.ai` | site | The public gallery, the `tcab.ai` share-link Worker and the gallery's preview-tag Worker |
| `console.testcabinet.ai` | site | The operator console |
| `gg.rocks` | site | gg's public site |
| `client-tauri` | shell | The operator client for Windows, Linux, macOS and Android |
| `test-suites` | content | The test cases and game jams, and the lattice factory designer |

Every repository but `contracts`, `engines`, `gg`, `gg.rocks`,
`microservice-repos`, `tool-audio-core`, `tool-dc`, `tool-mc`,
`tool-model-core`, `tool-music`, `tool-paint`, `tool-particle`,
`tool-sfx-sample`, `tool-sfx-synth`, `tool-sn`, `tool-sprite`, `tool-voxel`,
`test-suites`, `ui-common` and `cold-storage` is still a directory of the
superrepo's own tree today.

### Where each responsibility lives

`contracts` is checked out at `contracts/` and holds:

- `crates/contracts` (`test-cabinet-contracts`): the run record, the asset
  contract, the harness contract (gg's types, the session record and journal,
  metrics), code analysis, cold storage, the showcase, the toolchain report,
  the layout of a run tree, the test case and suite formats, the job API and
  publish-job API wire types, the reference lock format, the match-play shapes,
  the ingest wire structs, `AssetPreview`, `Writeup` and its parser,
  `SEED_COMMIT_MESSAGE`, `IMPLEMENTATION_COMMIT_MESSAGE`,
  `RUN_IMAGE_OVERRIDE_ENVS`, `MODALITY_IMAGE`, the harness display names, the
  key names redaction scrubs, the `proof_*` naming rules and the
  `find_build_output` layout rules, and the asset-reference key layout. Its
  `fixtures/` holds the scoring goldens.
- `crates/suites` (`test-cabinet-suites`): the suite runtime. Resolving and
  validating a suite, the engine catalog resolution, the browser driver, the
  vitest validator, the `test_case`, `test_case_group` and `test_suite`
  loaders, `prompt` rendering and the color parsers a test case needs. A
  browser call takes the traceparent from its caller. It names no engine
  table; `engines` publishes `built_in_catalog`, which binds this crate's
  catalog to the authored engines, and a caller that needs the built-in
  catalog takes it from `engines`.
- `crates/telemetry`: the OpenTelemetry plumbing every service initializes.
- `crates/redact`: secret scrubbing.
- `crates/backend-client`: the backend's HTTP client over the contract types,
  used by the driver, the CLI, the arena and the publisher.
- `crates/contract-codegen` and `crates/api-codegen`, with the packages they
  write, `packages/run-record`, `packages/asset-contract` and
  `packages/backend-api`, and the JSON Schemas under `schema/`.

`engines` holds the engine catalog (`built_in_catalog`, published by its
engines crate), the `simple-*` and `structured-*` packages, `case-harness`,
`voxel-runtime`, `particle-runtime`, `lattice-runtime` (the browser playback
of a factory, with `lattice-core` compiled to its playback ABI), and
`foray-core`, `foray-host`, `lattice-core` and `lattice-host` with the
match-play logic and the foray and lattice reference controllers and SDKs.

`test-suites` holds the authored content and, as `tools/lattice-designer`, the
lattice factory designer: the dev-only tool a performance scenario is laid out
with, which runs the layout through `@clockwyrks/lattice-runtime` as it is
drawn and saves it in place as one of the lattice version's scored scenarios.
See [the factory
designer](/testing/performance/lattice/architecture/#the-factory-designer).

`microservice-driver` holds the run engine: `RunEngine` and its lib root,
execution, the container runtimes, seeding, the harnesses and the harness
registry with their telemetry, the orchestrators, events and the exec stream,
gg's launch and session assembly, the install and lockfile checks, the
post-run stages, the audio and toolchain stages, the three validators
(validation, adversarial and performance), preview rendering, reference
rendering with the reference renderer and version
materialization, salvage, code analysis and the local half of the run record.
For the CLI binary it also holds the remote backend, the asset-reference
builder and the Pages build deploy helper.

`microservice-backend` holds the review and comparison scoring with its
aggregation and gating, pricing, TCQ (`gg_query`), model-id canonicalization,
the publish and auto-publish orchestration, the public snapshot's composition
(documents, media, index objects and short codes, written through
`microservice-artifacts`), the Access assertion check and what of accounts the
Access identity needs, `entities` (the SeaORM models), `migration` and
`db-auth`.

`microservice-artifacts` holds the playable serving and the object-store
writer; `microservice-repos` the git half of a publish; and
`microservice-publisher` the Pages half. Each owner defines its own error
type.

gg's version is a pinned gg version declared once in the driver, independent
of any crate version. The driver image fetches that release from the blob
container, and the backend image fetches `gg-reference` the same way; see
[Releasing gg](/development/releasing/#releasing-gg).

## The edges

A repository depends on another only along an edge. A build edge is one a
manifest names: a Rust dependency on another repository's crate, or an npm
dependency on a package another repository produces.

```text
contracts               -> nothing of this project
engines                 -> contracts
ui-common               -> contracts, engines (the voxel and particle runtimes)
tool-model-core         -> contracts (the asset-contract types)
tool-sprite             -> contracts
tool-paint, tool-voxel, tool-mc, tool-sn, tool-dc, tool-particle
                        -> contracts, tool-model-core
tool-audio-core         -> contracts
tool-sfx-synth, tool-sfx-sample, tool-music
                        -> contracts, tool-audio-core
microservice-backend    -> contracts, engines (the built-in catalog, for ingest)
microservice-dispatcher -> contracts
microservice-driver     -> contracts, engines, tool-sprite, tool-voxel,
                           tool-model-core, tool-audio-core
                           (seeding, previews, validation, audio staging)
microservice-artifacts  -> contracts
microservice-repos      -> contracts
microservice-publisher  -> contracts
microservice-arena      -> contracts, engines
gg                      -> contracts
the-spec-cabinet        -> contracts, engines, ui-common
testcabinet.ai          -> contracts (run-record), engines (runtimes), ui-common
console.testcabinet.ai  -> contracts (run-record, backend-api), engines, ui-common
client-tauri            -> nothing of this project (it loads the console by URL)
test-suites             -> engines (packages alone; the validators and the
                           designer import them)
gg.rocks                -> nothing of this project
```

No repository depends on gg at build time: the driver runs a pinned release of
its binary. The table is `edges.py` in the kit's `ci` library
(`templates/repository/ci/src/the_test_cabinet_ci/edges.py`), with the kind of
every repository and the package each `@clockwyrks/` name is produced by.

A data edge is one no manifest can name, such as a run reading a suite or the
driver pinning gg's released binary. The table records them beside the build
edges, and the superrepo's `dependency-graph` gate reports them.

```text
microservice-backend -> test-suites              ingest
microservice-driver -> gg                        the pinned released binary
microservice-driver -> tool-*                    the tool images
test-suites -> microservice-backend              the sample packs
console.testcabinet.ai -> test-suites            the vendored sprite atlas and
                                                 reference scenarios
the-spec-cabinet -> test-suites                  the suite being authored
client-tauri -> console.testcabinet.ai           the URL it loads
gg.rocks -> gg                                   the documentation pages it presents
microservice-driver -> microservice-artifacts, microservice-repos
                                                 HTTP, the run tree and bundle uploads
microservice-backend -> microservice-artifacts, microservice-repos
                                                 HTTP, the dataset writes and the
                                                 bundle reads it serves
microservice-publisher -> microservice-artifacts, microservice-repos
                                                 HTTP, during a publish
```

Two gates hold the edges. Each repository's `dependency-edges` gate reads its
name from `.test-cabinet-repo.toml` and holds every `Cargo.toml` and
`package.json` it carries to its row. The superrepo's `dependency-graph` gate
holds every checked-out repository to the same table, imported from the kit by
path.

## How a dependency is named

A Rust manifest names another repository's crate by its public source, the
GitHub mirror, at the tag its dependents pin or on `master` while the
repository has none:

```toml
[workspace.dependencies.test-cabinet-contracts]
git = "https://github.com/TheClockwyrks/contracts"
tag = "v0.2.2"
```

The render writes the tag `TAGS` in `scripts/repos/render.py` records for the
repository, `v0.2.2` for `contracts`, and `branch = "master"` for one it records
none for. A new tag is recorded there, and reaches a dependent with its next
`render.py --update`.

A manifest never names a path outside its repository or an Azure source, and
`dependency-edges` refuses both. That is what lets each repository build on its
own, in its own pipeline.

An npm manifest names another repository's package at the exact version a tag
of that repository published to the `the-test-cabinet` feed of the project's
Azure Artifacts:

```text
https://pkgs.dev.azure.com/genyume/the-test-cabinet/_packaging/the-test-cabinet/npm/registry/
```

A public package names the feed under `publishConfig.registry`, and the kit's
`typescript` gate refuses one that does not. A repository's `.npmrc` names the
feed as the registry of the `@clockwyrks` scope.

## Inside the superrepo

Cargo reads `.cargo/config.toml` from every parent of the directory it runs in,
so a build inside a submodule inherits the superrepo's. Its `[patch]` tables
redirect each repository's public source to the sibling checkout, so a change
to `contracts` is seen by a build of `microservice-driver` the moment it is
saved. The tables sit between two marker lines of the superrepo's
configuration, and `scripts/repos/sources.py patch-table --write` writes them.

A repository that is not checked out has its table written as a comment.
Cargo loads every patch path eagerly, so an entry naming a missing directory
fails every build under the superrepo. An active table applies to every Cargo
workspace beneath the superrepo, and a workspace that does not use an entry
records it in its lock as `[[patch.unused]]`, at the patched crate's version.
`[net] git-fetch-with-cli` joins the block once an entry is active: cargo still
fetches a patched source to resolve the lock file, and while the mirrors are
private `scripts/repos/sources.py rewrites --apply` sends each mirror's fetch
to its Azure remote through the user's git configuration, which only the
command-line fetch reads.

`.package-links.json` is the npm counterpart. It names every package the npm
workspace of each checked-out repository produces, a repository's workspace
being its root, and `scripts/repos/link-packages.sh` writes it and installs
every workspace that names a sibling's package with that package linked from
the checkout. The install is `npm install --no-save --install-links=false`
after a dry run of `npm ci`, so the manifests and the lock stay as committed.

The `dependency-graph` gate holds the three together. Every submodule is a
repository of the table or one the kit renders nothing into; the patch table
covers every repository carrying a crate; and a checked-out repository carries
its record, a patch entry per crate it declares, manifests its edges permit,
CI image pins this checkout names, and package links that are current. A
submodule that is not checked out is noted and passed over.

## The record of what builds together

A library commits no lock file, and an application commits one. The revisions
that build together are recorded by each application's `Cargo.lock` and by each
repository's pipeline, which builds it on its own against the sources its
manifests name. The superrepo's pointer to each submodule is a development
checkout, bumped when useful.

Inside the superrepo cargo rewrites an application's lock file to the sibling
checkouts, so that copy is never committed. An application's
`scripts/resolve-lock.sh` resolves the lock in a copy of the sources outside
every patch table and writes it back.

### Bumping a pin

A commit that moves a repository's pin carries, in the same commit:

1. the gitlink, a commit on the repository's `master`
   (`git -C contracts checkout <commit>`);
2. in every checked-out application that depends on it, the lock resolved
   again by its `scripts/resolve-lock.sh`, when a crate's version moved;
3. the package links, rewritten by `scripts/repos/link-packages.sh`, when a
   package moved;
4. the matching `ciImageTag`, when the repository's pipeline's image pin moved,
   which the `dependency-graph` gate requires.

The `dependency-graph` gate names a stale lock or a stale link at commit time.

## The kit

Every repository is rendered from the repository kit, a
[copier](https://copier.readthedocs.io) template. `copier.yml` at the superrepo
root declares it, with `templates/repository/` as the tree it renders, so
copier records a superrepo commit as the version a repository was rendered
from. The superrepo's own `.copier-answers.yml` is unrelated: it records the
fleet's workspace template the superrepo is rendered from.

The template asks three questions, `name`, `kind` and `description`. Every
other value a file needs is derived from those by `scripts/repos/context.py`,
the template's context extension, from the tables `scripts/repos/render.py`
and the kit's `edges.py` hold:

- the scaffolded crate, `crates/<directory>` with the package name the crate
  carries (`crates/driver` and `test-cabinet-driver` for `microservice-driver`);
- the workspace's dependencies along the repository's Rust edges;
- the pipeline's repository resources, the closure of those edges;
- the CI images, at the commit `ci/images/tags.yml` pins as `ciImageTag`: the
  Rust job runs in the `rust-browser` image for a repository whose suite drives
  a browser, in the `android` image for a `shell`, and in the `rust` image
  otherwise (`RUST_TRACKS` in `render.py`);
- the Windows job, for a repository `WINDOWS_TESTS` names;
- the steps of the gates a repository writes itself, which `EXTRA_GATES` names
  by the job each runs in;
- for an `application`, the `Dockerfile` scaffold and its `.dockerignore`
  allowlist, the `build-context` gate, and the image stage that builds the
  image natively on an amd64 and an arm64 agent and fuses the two into
  `<name>:<commit>` (`IMAGE_KINDS` in `render.py`);
- the includes of the jobs, stages and Rust setup steps a repository writes
  itself, which `PROJECT_PIPELINE` names with the stages the mirror waits on,
  and the Rust job's time limit (`RUST_TIMEOUTS`);
- for a `tool`, the image job that bakes its binaries, and for a `shell`, the
  bundle jobs;
- the mirror, the feed and the branches.

A crate's workspace uses resolver `"3"` and sets `publish = false` under
`[workspace.package]`, since a crate is consumed by its git source.
`.cargo/config.toml` documents the private items
(`[build] rustdocflags = ["--document-private-items"]`), so the `rust-doc` gate
judges the same documentation inside the superrepo and in the pipeline. The
root `.gitattributes` opens with `* text=auto eol=lf`, so every text file checks
out with LF on every host, and declares the binary formats after it. Every
repository carries the superrepo's MIT `LICENSE`, the license its crates and
packages declare. The commit hooks' large-file check leaves out
`history/commit-map`, the map an extracted repository commits from its
history's rewrite, which is larger than the check's 500 KB.

A file a kind does not carry has a conditional name that renders to nothing,
and a kind carrying no crate is rendered no workspace and no Rust gate.

```sh
uv run --project ci scripts/repos/render.py contracts \
  --description "The data contracts every component reads and writes."
scripts/repos/bootstrap.sh contracts
uv run --project ci scripts/repos/protect.py contracts
```

`render.py` writes `<superrepo>/<name>/` from the superrepo's committed `HEAD`,
with two records at its root. `.copier-answers.yml` holds the answers, the
template's source (`..`) and the commit; `.test-cabinet-repo.toml` holds the
answers for the gates. `bootstrap.sh` makes the directory a repository on
`master`, resolves an application's `Cargo.lock` and, for a kind carrying an
npm workspace, writes its `package-lock.json` with
`npm install --package-lock-only`, writes the gate runner's `ci/uv.lock` with
`uv lock --project ci`, commits, pushes to the Azure remote of the same name
and adds the repository as a submodule by the relative URL `../<name>`. The
lock files are committed: the render writes none of them, the `typescript`
gate installs the workspace with `npm ci`, which requires the lock, and the
first `uv run --project ci` would otherwise leave `ci/uv.lock` untracked, as
the superrepo commits its own. A repository whose first commit is made by hand
runs `npm install` at its root and `uv lock --project ci`, and commits the
locks they write. `protect.py` creates `staging` and `nightly` and copies the
superrepo's branch policies onto `master` and `staging`.

A kit change reaches a repository through a three-way merge:

```sh
uv run --project ci scripts/repos/render.py --update contracts
```

Copier renders the template at the recorded commit and at `HEAD`, and applies
the difference, so a line the repository added survives and a line the kit
changed arrives; a line both changed is left between conflict markers. The
crate's `src/lib.rs` and `src/main.rs` are written once and left to the
repository. `--uncommitted` renders the working tree, to try a kit change
before it is committed, and leaves a record that is not for committing.

## A repository's gates and pipeline

The kit renders the gate runner into every repository, with these gates:

| Id | What it checks |
| --- | --- |
| `rust-fmt`, `rust-clippy`, `rust-doc`, `rust-test` | The Rust workspace, warnings denied and the tests under `cargo nextest`, in a kind carrying a crate |
| `dependency-edges` | The manifests against the repository's edges |
| `typescript` | The npm workspace at the root, in a kind carrying one: installed from its lock, built, type-checked and tested |
| `playwright-image` | On a Rust track that drives a browser: the workspace's `playwright` finds the browser the image carries |
| `build-context` | In a kind that builds an image: every Dockerfile's `COPY` sources and its Rust pins |
| `markdownlint`, `cspell`, `format` | The prose and the formatting |
| `python-lint`, `ci-tests`, `shell-tests`, `no-nul-bytes` | The gate runner and the scripts |

A repository may add gates of its own, such as `contracts`' `contract-drift`,
`engines`' `seeded-contract`, `ui-common`'s `web-lint` or `test-suites`'
`frozen-paths`, `spec-prose`, `spec-vocabulary`, `audio-packs` and
`validators-typecheck`. The gate is a file
the repository writes under `ci/gates/`, and the kit leaves it to the
repository; `EXTRA_GATES` in `render.py` names it and the job it runs in, and
the render gives it one step there. Every gate a repository adds is hookless,
and the rendered `ci/tests/test_wiring.py` holds each to its one step.

A repository whose pipeline runs work beyond the kit's, such as `gg`, which
releases its binaries, its reference and its toolchains image on a tag, or
`gg.rocks`, whose `deploy` stage uploads the site to its Pages project, writes
it as the superrepo writes its own: its jobs in `.azure/project/jobs.yml`,
which the gates stage includes after the kit's jobs, and its stages in
`.azure/project/stages.yml`, which the pipeline includes after the publish
stage. `PROJECT_PIPELINE` in `render.py` names the repository and its stages,
and the kit leaves both files to it. Each is handed the image of the Rust
track, the registry, the service connection to it and the arm64 agent pool as
the parameters `rustImage`, `registry`, `registryEndpoint` and `arm64Pool`. The
mirror stage waits on each of the repository's stages as on the publish, and
the rendered `ci/tests/test_wiring.py` holds the includes to the parameters
each file declares, each stage to depending on the gates, and both files to
running no gate. Such a repository's Rust job also takes the steps of
`.azure/project/setup-steps.yml` after it fetched its dependencies and before
its first check, which is where gg provisions the toolchains its build script
needs, and `RUST_TIMEOUTS` gives a Rust job whose cold build outlasts the
kit's hour a longer limit.

A repository's `azure-pipelines.yml` runs on every push to `master`, `staging`
and `nightly` and to a `v*` tag. The gates stage runs the Rust gates in the
Rust job and every other check in the checks job, inside the web image. On
`master` and `staging` an application's run then builds its image and pushes
it to the registry as `<name>:<commit>`, and a tool's run builds the image
carrying its binaries the same way. A tag's run publishes each public package
of the workspace to the feed, at the version its manifest carries, which is
the tag's, and an application's or shell's tag publishes its binaries or
bundles as pipeline artifacts of that run; see
[Releasing](/development/releasing/).

A repository's pipeline names each CI image it runs in by commit,
`ubuntu-the-test-cabinet-<track>-cicd:<commit>`, at the `ciImageTag` of the
render that wrote it. The superrepo's image pipeline deletes, after each run,
every image tag nothing live pins (`scripts/ci/ci-image-purge.sh`). It keeps
what the superrepo's `master`, `staging` and `nightly` pin and, for each
submodule the `.gitmodules` of the checkout or of any of those branches names
by a relative URL, every image the `azure-pipelines.yml` of that repository's
`master`, `staging` and `nightly` names. Reading every branch's `.gitmodules`
is what keeps a repository added on `nightly` safe from a run on `master`,
where it is not yet a submodule. A repository it cannot read stops the purge,
so the image pipeline declares every such repository under `resources` and
each of its jobs names it under `uses:`, which puts it in the job token's
scope, and a new submodule is added in both places with it.
Two rules follow:

- **The merge-up rule.** A repository's image pin moves
  `nightly → staging → master` with the superrepo change that bumped
  `ciImageTag`: the `render.py --update` that brings the new pin lands on the
  repository's `nightly` with that change, and is merged up as it is. So no
  live branch of a repository pins an image older than the superrepo's oldest
  live pin by more than one merge-up, and the purge never deletes an image a
  live branch still runs in.
- **The patch-tag rule.** A tag's pins are not kept. A tag's run publishes and
  mirrors once, and a re-run after its image is purged fails at container
  initialization. A tag whose run failed is followed by a patch tag (`v0.1.1`
  after `v0.1.0`) on a commit carrying current pins, never re-run.

On a Rust track whose suite drives a browser, the Rust job runs with
`TCAB_REQUIRE_BROWSER=1` and installs the npm workspace with `npm ci` before
its gates, since the browser tests drive the workspace's `vitest`,
`@vitest/browser-playwright` and `playwright`. Its `playwright-image` gate then
fails unless that `playwright` finds its Chromium, naming the version and
`PLAYWRIGHT_BROWSERS_PATH`. The image carries the browser of the playwright
image the superrepo's devcontainer names as `PLAYWRIGHT_IMAGE`, so an image
bump that moves that image's tag moves the `playwright` devDependency of each
such repository in the same change as the `render.py --update` that brings the
new pins.

A `shell` runs its Rust job and its bundle jobs in the `android` image, the
Rust image with the Android SDK and NDK and Tauri's build tools on top, which
the superrepo's image pipeline builds for that kind alone. The desktop bundles
of the other platforms are built on hosted agents of each platform.

A repository `WINDOWS_TESTS` names runs its suite on Windows too, in the
`windows` job of the gates stage on a hosted `windows-2022` agent. The job runs
no gate: it installs nextest with `scripts/ci/install-nextest.sh`, at the
devcontainer's `NEXTEST_VERSION`, and runs `cargo nextest run --workspace`.

The last stage pushes a branch or a published tag to the repository's GitHub
mirror with `scripts/ci/mirror.sh`, over ssh with the secure file
`github-mirror-key-<name>`, a deploy key of its own. The stage runs only after
the gates and the publish passed, so a mirror holds gated commits alone, and
the script refuses a push that would not move the mirror forward; see
[The GitHub mirror](/development/building/#the-github-mirror).
