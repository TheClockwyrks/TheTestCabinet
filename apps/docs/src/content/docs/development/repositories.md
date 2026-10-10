---
title: Repositories
description: "The repositories of The Test Cabinet, the edges between them, how the superrepo joins their checkouts, and the kit every repository is rendered from."
---

The Test Cabinet is a set of repositories, and this one, `the-test-cabinet`, is
the superrepo that holds each of them as a submodule at its root. Every
repository lives in the `the-test-cabinet` project of the `genyume` Azure
DevOps organization under its plain name, and is mirrored to GitHub under
`TheClockwyrks` by the same name; the superrepo's mirror is `TheTestCabinet`.
The documentation site and the issue board stay in the superrepo, and so do
the kit and the gates over the whole set.

## The repositories

| Repository | Kind | What it holds |
| --- | --- | --- |
| `contracts` | library | The data contracts: the run record, the asset contract and the shapes the components exchange |
| `engines` | library | The authored engines, the voxel and particle runtimes and the case harness |
| `gg` | application | The in-container coding harness |
| `platform` | application | The CLI and the services: backend, dispatcher, driver, artifacts and arena |
| `web` | application | The web console, the gallery, the UI library and the run statistics |
| `the-spec-cabinet` | application | The authoring tool for test suites |
| `gg.rocks` | site | gg's public site |
| `test-suites` | content | The test cases and game jams |

`contracts` is checked out at `contracts/`. It holds
`crates/contracts` (`test-cabinet-contracts`, with its fixtures),
`crates/suites` (`test-cabinet-suites`, the test suite runtime, which depends
on `test-cabinet-contracts` and on no `platform` crate, so `platform` and The Spec
Cabinet run the same suite logic), `crates/contract-codegen`, which generates
from the contracts crate alone, the two packages it generates,
`packages/run-record` and `packages/asset-contract`, and their JSON Schemas under
`schema/`. The other repositories are still the superrepo's own directories.
`platform`'s side of the cut with `contracts` is `crates/api-codegen` and the
package it generates, `packages/backend-api` (`@clockwyrks/backend-api`), which
is the one package `web` takes from `platform`.

The kind decides a repository's shape. A library carries a Rust workspace and
commits no `Cargo.lock`; an application carries one and commits its lock. A
site carries an npm workspace and no Rust, and a content repository carries
neither. `cold-storage` is a submodule too, and the kit renders nothing into
it.

## The edges

A repository depends on another only along an edge. A build edge is one a
manifest names: a Rust dependency on another repository's crate, or an npm
dependency on a package another repository produces.

```text
contracts        -> nothing of this project
engines          -> contracts (crates, and of the packages @clockwyrks/asset-contract alone)
gg               -> contracts
platform         -> contracts, engines
web              -> contracts, engines, platform (@clockwyrks/backend-api alone)
the-spec-cabinet -> contracts, engines, web (@clockwyrks/ui alone)
test-suites      -> engines (packages alone)
gg.rocks         -> nothing of this project
```

No repository depends on gg at build time: `platform` runs a pinned release of
its binary. The table is `edges.py` in the kit's `ci` library
(`templates/repository/ci/src/the_test_cabinet_ci/edges.py`), with the kind of
every repository and the package each `@clockwyrks/` name is produced by.

A data edge is one no manifest can name, such as a run reading a suite or the
CLI pinning gg's released binary. The table records them beside the build
edges, and the superrepo's `dependency-graph` gate reports them.

```text
platform -> test-suites          ingest, and the files the performance image copies
platform -> gg                   the pinned released binary
test-suites -> platform          the sample packs the audio declarations resolve against
web -> test-suites               the replay assets the console vendors
the-spec-cabinet -> test-suites  the suite being authored
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
tag = "v0.1.0"
```

The render writes the tag `TAGS` in `scripts/repos/render.py` records for the
repository, `v0.1.0` for `contracts`, and `branch = "master"` for one it records
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

The superrepo's own workspaces, which hold every repository not yet split out,
build against a checked-out repository by path. Its Cargo crates name
`contracts`' crates as `path = "../../contracts/crates/<crate>"`, its root
`Cargo.toml` lists `contracts` under `exclude`, since that directory is a
workspace of its own, and its root `package.json` lists `contracts/packages/*`
among its workspaces. So a build inside the superrepo compiles the checkout at
the commit the superrepo pins, and neither the feed nor a git source is
fetched for it.

Cargo reads `.cargo/config.toml` from every parent of the directory it runs in,
so a build inside a submodule inherits the superrepo's. Its `[patch]` tables
redirect each repository's public source to the sibling checkout, so a change
to `contracts` is seen by a build of `platform` the moment it is saved. The tables
sit between two marker lines of the superrepo's configuration, which also holds
the monorepo's own aliases and build settings, and
`scripts/repos/sources.py patch-table --write` writes them.

A repository that is not checked out has its table written as a comment.
Cargo loads every patch path eagerly, so an entry naming a missing directory
fails every build under the superrepo. An active table applies to every Cargo
workspace beneath the superrepo, and a workspace that does not use an entry
records it in its lock as `[[patch.unused]]`, at the patched crate's version.
So the locks of the workspaces nested under `packages/` (gg's guest and its
Rust library set, which gg's build resolves with `--locked`) carry those
entries. `[net] git-fetch-with-cli` joins the
block once an entry is active: cargo still fetches a patched source to resolve
the lock file, and while the mirrors are private
`scripts/repos/sources.py rewrites --apply` sends each mirror's fetch to its
Azure remote through the user's git configuration, which only the command-line
fetch reads.

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
CI image pins this checkout names, and package links that are current. With a
repository carrying crates checked out, the superrepo's `Cargo.lock` is current
against it (`cargo metadata --locked --offline`). A submodule that is not
checked out is noted and passed over.

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

The superrepo's `Cargo.lock` records the version and the dependencies of every
crate its workspace reaches by path, and its `package-lock.json` those of every
package its npm workspace holds. A pin bump that changes either leaves both
stale, and every `--locked` cargo command and `npm ci` then fails. So a commit
that moves the `contracts` pin carries, in the same commit:

1. the gitlink, a commit on `contracts`' `master`
   (`git -C contracts checkout <commit>`);
2. the root lock, updated for the three crates:
   `cargo update --offline -p test-cabinet-contracts -p test-cabinet-suites -p contract-codegen`;
3. each nested lock under `packages/`, rewritten by
   `cargo metadata --offline --format-version 1` in its directory, when a
   crate's version moved;
4. `npm install` at the root, and the `package-lock.json` it writes;
5. the matching `ciImageTag`, when the `contracts` pipeline's image pin moved,
   which the `dependency-graph` gate requires.

The `dependency-graph` gate names a stale root or nested `Cargo.lock` at commit
time, and the
`web-browser-test` gate a `playwright` pin of `contracts` that differs from the
image's.

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

- the scaffolded crate, `crates/<directory>` with the package name the
  monorepo gives it (`crates/cli` and `test-cabinet-cli` for `platform`);
- the workspace's dependencies along the repository's Rust edges;
- the pipeline's repository resources, the closure of those edges;
- the CI images, at the commit `ci/images/tags.yml` pins as `ciImageTag`, with
  the Rust job in the `rust-browser` image for a repository whose suite drives
  a browser and in the `rust` image otherwise (`RUST_TRACKS` in `render.py`);
- the Windows job, for a repository `WINDOWS_TESTS` names;
- the steps of the gates a repository writes itself, which `EXTRA_GATES` names
  by the job each runs in;
- the mirror, the feed and the branches.

A crate's workspace uses resolver `"3"`, the monorepo's, and sets
`publish = false` under `[workspace.package]`, since a crate is consumed by its
git source. `.cargo/config.toml` documents the private items
(`[build] rustdocflags = ["--document-private-items"]`), as the superrepo's
does, so the `rust-doc` gate judges the same documentation inside the
superrepo and in the pipeline. The root `.gitattributes` opens with
`* text=auto eol=lf`, so every text file checks out with LF on every host, and
declares the binary formats after it. Every repository carries the superrepo's
MIT `LICENSE`, the license its crates and packages declare. The commit hooks'
large-file check leaves out `history/commit-map`, the map an extracted
repository commits from its history's rewrite, which is larger than the check's
500 KB.

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
locks they write. `protect.py` creates `staging` and
`nightly` and copies the superrepo's branch policies onto `master` and
`staging`.

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
| `markdownlint`, `cspell`, `format` | The prose and the formatting |
| `python-lint`, `ci-tests`, `shell-tests`, `no-nul-bytes` | The gate runner and the scripts |

A repository may add gates of its own, such as `contracts`' `contract-drift`.
The gate is a file the repository writes under `ci/gates/`, and the kit leaves
it to the repository; `EXTRA_GATES` in `render.py` names it and the job it
runs in, and the render gives it one step there. Every gate a repository adds
is hookless, and the rendered `ci/tests/test_wiring.py` holds each to its one
step.

A repository's `azure-pipelines.yml` runs on every push to `master`, `staging`
and `nightly` and to a `v*` tag. The gates stage runs the Rust gates in the
Rust job and every other check in the checks job, inside the web image. A tag's
run then publishes each public package of the workspace to the feed, at the
version its manifest carries, which is the tag's.

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
so each image job declares every such repository under `resources` and names
it under `uses:`, which puts it in the job token's scope, and a new submodule
is added there with it.
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
`PLAYWRIGHT_BROWSERS_PATH`. The image carries the browser of the superrepo's
`PLAYWRIGHT_VERSION`, so an image bump that moves `PLAYWRIGHT_VERSION` moves
the `playwright` devDependency of each such repository in the same change as
the `render.py --update` that brings the new pins.

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
