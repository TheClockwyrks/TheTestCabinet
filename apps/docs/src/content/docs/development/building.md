---
title: Building
---

This page is the authoritative source for the superrepo's layout, for the
shape every repository shares, and for the build, format, lint, and test
commands of a Rust workspace and an npm workspace. The Test Cabinet is an
independent, open-source benchmark and depends only on public crates.io and
npm packages.

The superrepo is rendered from the k8s standard workspace template, which
supplies the dev container, the gates and their runner, the pipeline's gate
jobs and its staging publish and deploy. `.copier-answers.yml` records the
template's source, its version and this project's answers; see
[The workspace template](#the-workspace-template). Every other repository is
rendered from the superrepo's own kit; see
[Repositories](/development/repositories/).

## Toolchains

Everything is built inside the devcontainer under `.devcontainer/`, which
carries every toolchain below at a pinned version, for every repository of the
set. A gate whose toolchain is absent fails and names the command that installs
it, so the container is what makes a gate judge rather than complain.

The devcontainer and the CI images the pipelines' gates run in are built on
the images this project's template publishes, which the
`x-devcontainer-build-args` anchor of `.devcontainer/docker-compose.yml` names
by full reference: the toolchain image, and the tool images it copies over it.
Each reference's tag is what the image is built from, so a tool's version is
the published image's that holds it, and updating the project to a new template
version moves it onto the versions that template's images hold.

| Toolchain | Pinned by |
| --- | --- |
| Rust, with `rustfmt` and `clippy` | Every repository's `rust-toolchain.toml`, the kit's, and the toolchain image `TOOLCHAIN_IMAGE` names |
| `cargo-nextest` | The toolchain image |
| `mold`, the linker of a glibc build | The toolchain image |
| Node and npm | The toolchain image |
| `cspell`, `markdownlint-cli2`, Prettier, ESLint | Each repository's `package.json` and `package-lock.json` |
| Vite, Vitest, React and TypeScript | Each npm workspace's `package.json` and `package-lock.json` |
| The browser engines | The playwright image `PLAYWRIGHT_IMAGE` names, tagged with the Playwright version, and `playwright` in each workspace that drives one |
| uv, which the gates run under, and pre-commit | The toolchain image |
| `kubectl`, `k3d`, `kubelogin` | The toolchain image |
| The Claude Code and Codex CLIs | `CLAUDE_CODE_VERSION` and `CODEX_VERSION` in `.devcontainer/docker-compose.yml` |
| `musl-tools`, `ruby`, `libicu-dev`, `ffmpeg`, `cmake` and the local cluster tools' `iproute2`, `lsof` and `procps` | Ubuntu's, installed by `.devcontainer/system/packages.sh` |
| This architecture's musl target | `rust-toolchain.toml`, added by `.devcontainer/languages/rust/targets.sh` |
| The Android SDK and NDK, and Tauri's build tools | `.devcontainer/tools/android.sh`, at the versions the `android` CI image carries |
| `helm` | `.devcontainer/tools/helm.sh` |
| gg's program-language toolchains | Each arm's `packages/gg-sandbox-*/<lang>-version.sh` in the `gg` repository, which for Swift, C++, C#, Java, Kotlin, PureScript, Ruby and Python is the version of the template's language image the devcontainer copies; `.devcontainer/languages/gg/install.sh` links those and installs the rest |

Setting up a machine that executes test cases (container runtime,
run-container image, credentials) is covered by
[First Time Setup](/guides/setup/first-time-setup/). Running the services on your
own machine is covered by [Running](/development/running/).

## Cloning

The superrepo lives on Azure Repos and is mirrored to GitHub, and a clone from
either host works the same way. Every repository of the set is a submodule at
the superrepo's root, and so are [`cold-storage`](#cold-storage) and
`test-suites`, the [test suites](/test-suites/overview/) checkout.

A plain clone downloads the superrepo alone and leaves each submodule
directory empty. The superrepo's own gates and the docs site read
`contracts/`, whose schemas the docs publish, and `engines/`, which the
repositories still held in the superrepo's own tree build against, and nothing
else; every other checkout is fetched when a task needs it:

```sh
git clone <superrepo-url>
git submodule update --init contracts engines
git submodule update --init microservice-driver   # what the task touches
git submodule update --init --depth 1 cold-storage
git submodule update --init test-suites
```

The devcontainer populates `contracts/`, `engines/` and `test-suites/` when it
creates a container, the last because a local backend ingests its suites from that
checkout. `.gitmodules` sets the tracked branch of every repository to
`master`, so `git submodule update --remote <name>` moves that checkout to the
branch's tip.

A recursive clone also downloads every submodule at the commit the superrepo
pins, which for `cold-storage` is about 2 GB of media. `--shallow-submodules`
fetches only each pinned commit rather than the submodule's history:

```sh
git clone --recurse-submodules --shallow-submodules <superrepo-url>
```

A checked-out repository builds against its siblings through the superrepo's
patch table and package links, so a change to `contracts` is seen by a build
of `microservice-driver` as soon as it is saved; see
[Inside the superrepo](/development/repositories/#inside-the-superrepo).

### Submodule URLs

`.gitmodules` names every submodule by a URL relative to the superrepo, such
as `../cold-storage`. Git resolves it against the remote the superrepo was
cloned from. On Azure that is the sibling repository in the
`genyume/the-test-cabinet` project, and on GitHub it is `TheClockwyrks/<name>`.
A submodule repository therefore has the same name on both hosts, while the
superrepo's name may differ.

### Mirrors and pins

Each submodule repository's own pipeline pushes to the GitHub repository of
the same name, as its last stage, and is the only writer of the mirror.
`cold-storage`'s pipeline is that one job, `.azure-pipelines/mirror.yml`, which
pushes `master` alone.

A pin on superrepo branch B must be on the submodule's branch B or on its
`master`. On `master` that is the submodule's `master` alone, and a submodule
with no branch B is held to its `master`. Push the submodule commit to one of
those branches first, then commit the moved pointer here.
`scripts/ci/submodule-pins.sh` checks this, and the pipeline's `submodule_pins`
job runs it on every push. It fails when a pinned commit is not an ancestor of
either branch on the host the superrepo was cloned from.

The script decides B for itself. A pull request is checked against the branch
it merges into, because that is where its pins land, and any other pipeline run
against the branch it built. Off an agent, B is the branch checked out, and
`--branch <b>` names another. A tag or a detached HEAD is held to `master`.

The rule keeps a clone of the GitHub mirror able to fetch its submodules: a
superrepo commit on branch B names only submodule commits the mirror's B or
`master` holds, provided each submodule's mirror pushes B. Every repository's
pipeline mirrors `master`, `staging` and `nightly`; `cold-storage` mirrors
`master` alone, so it is pinned to `master` everywhere. The check fetches
commits without trees or blobs, so it finishes in seconds, and
`scripts/ci/submodule-pins.test.sh` is its offline table test.

### Submodules in CI

Every checkout in the superrepo's pipeline is made with `submodules: false`,
and nothing initializes submodules recursively, which keeps the baseline media
out of every job. A job that needs a submodule's files names it and runs
`scripts/ci/submodules.sh init <path>...`, which initializes exactly those
submodules at their pinned commits, one commit deep, without their own
submodules. `submodules.sh list` prints what `init` would initialize and
touches nothing.

The gate jobs and the `docs` job initialize `contracts` right after their own
checkout, for the schemas the docs site publishes and the `dependency-graph`
gate's check of the one checkout. The jobs that read nothing of a submodule
(the mirror and the deploys) initialize none.

The project scopes the job's access token to the repositories a job names.
The pipeline declares `contracts` under `resources.repositories`, and every
job that initializes it names it under the job's `uses: repositories:`, which
puts the repository in the token's scope without checking it out. The script
sends the token in `SYSTEM_ACCESSTOKEN` to `dev.azure.com` alone. A repository
is authorized for the `the-test-cabinet` pipeline definition once, in the
project's pipeline permissions.

`submodule_pins` checks every submodule's repository out instead:
`.azure/project/jobs.yml` lists them in its `submodules` parameter, with each
one's path and repository, and the job checks each repository out beside this
one before it runs `scripts/ci/submodule-pins.sh` with the token in
`SYSTEM_ACCESSTOKEN`. `scripts/ci/submodules.sh check` holds that list to
`.gitmodules`, and `scripts/ci/submodules.test.sh` runs the check against the
repository, so the `shell-tests` gate fails on a submodule added to one and not
the other.

## Layout

The superrepo holds what spans the set, and each repository of the set as a
submodule at its root:

- `.copier-answers.yml`: the workspace template's source, the version the
  repository was last rendered against, and the answers it asks.
- `.azure/`: the pipeline templates. `.azure/publish-image.yml` is the
  template's; `.azure/project/*.yml` is the project's own pipeline work, which
  `azure-pipelines.yml` includes; `.azure/tcab/` holds the project's job
  templates.
- `apps/docs`: `@the-test-cabinet/docs`, this Astro Starlight documentation
  site. The workspace template renders its `package.json`, which pins the
  site's dependencies; the pages are the project's.
- `ci/`: the gates, one file per gate under `ci/gates/`, the `ci` uv project
  that runs them, and under `ci/images/` the CI images every pipeline's gate
  jobs run in.
- `copier.yml` and `templates/repository/`: the repository kit, and under
  `scripts/repos/` the scripts that render it; see
  [The kit](/development/repositories/#the-kit).
- `deployments/`: the Kubernetes manifests of every environment, the local
  stack's Makefile and the deploy scripts; see
  [Deployment](/deployment/overview/).
- `.devcontainer/`: the dev container, whose image bakes in every toolchain a
  build of any repository needs (see
  [Running](/development/running/#the-dev-container)).
- `.cargo/config.toml` and `.package-links.json`: the patch table and the
  package links that point a checked-out repository at its sibling checkouts.
- `.claude/`: the harness settings, its hooks and its skills.
- `scripts/`: the hook installer and devcontainer check, the project's
  scripts, and under `scripts/ci/` the scripts the pipelines run.
- `tasks/`: the issue board.
- `<repository>/`: each repository of the set, and `cold-storage/`.

### A repository's layout

Every repository the kit renders shares one shape, by its kind:

- `Cargo.toml` and `crates/<name>/`, in a kind carrying a crate. A library's
  or a tool's workspace holds its crates under `crates/`, an application's
  holds its binary crate and the library crates beside it, and a shell's holds
  the Tauri shell crate. Shared dependency versions are declared once in the
  root `Cargo.toml` under `[workspace.dependencies]` and inherited with
  `{ workspace = true }`.
- `package.json` and `packages/*/`, in a kind carrying an npm workspace, with
  `apps/*/` for a site's page. A library's packages are what its dependents
  install from the feed.
- `containers/`, in `microservice-driver`, holding every run-container image.
- `ci/`, `scripts/ci/`, `azure-pipelines.yml`, `.copier-answers.yml` and
  `.test-cabinet-repo.toml`: the kit's, as
  [Repositories](/development/repositories/#a-repositorys-gates-and-pipeline)
  states.

Which repository holds which crate and package is the table under
[Where each responsibility lives](/development/repositories/#where-each-responsibility-lives).

### Cold storage

`cold-storage/` at the root is a git submodule holding the captured baseline
validation media, the bulk of the set's bytes. Its tree mirrors
`test-suites`', so a test-case version's baselines live at
`cold-storage/test-cases/<type>/<difficulty>/<slug>/<version>/validation-baseline/<engine>/<variant>/`
(see [where baselines live](/components/driver/validation/#where-baselines-live)).
Fetch it only to capture or review baselines, or to ingest a catalog that serves
them.

### Reference implementations

A [reference implementation](/guides/devops/publishing-a-reference-implementation/)
under a case version's `references/` in `test-suites` is its own npm project
rather than a member of a workspace, so it is installed from its own directory.
An engine-backed one resolves its engine, `@clockwyrks/simple-2d` or
`@clockwyrks/structured-2d`, from the feed at the version its manifest names.
Inside the superrepo the package links point that name at the `engines`
checkout instead, so the reference builds and tests against the engine's
current source once the engines workspace is built:

```sh
npm ci && npm run build          # in engines/
scripts/repos/link-packages.sh   # at the superrepo root
npm ci                           # in the reference's own directory
```

A reference installed over an unbuilt engine installs cleanly and fails at
`npm run typecheck` instead, reporting
`TS2307: Cannot find module '@clockwyrks/<slug>'` ahead of the property errors
that the failed resolution produces.

## The workspace template

The template renders most of what surrounds the superrepo's content:
`.devcontainer/`, `ci/`, `azure-pipelines.yml`, `azure-pipelines-ci-images.yml`,
`.pre-commit-config.yaml`, the lint and format configurations, `Makefile`,
`rust-toolchain.toml`, `.config/nextest.toml`, `.claude/settings.json` with its
hooks and four skills, `tasks/README.md`, and a few scripts.
`.copier-answers.yml` records the template's source, the version the
repository was last rendered against, and the answers the template asks; every
other value it derives from those by the fleet's conventions.

A rendered file is this project's to edit. An update is a three-way merge: the
recorded version is rendered again, what this repository changed in a rendered
file since is carried onto the new version's render, and a line both sides
changed is left inline between conflict markers for a person to resolve.

```sh
copier update --defaults --trust --conflict inline
```

The values this project holds otherwise than the fleet's conventions, and so
the lines an update's conflicts are usually about, are the container registry
(`testcabinet.azurecr.io`, with the CI images
`ubuntu-the-test-cabinet-{rust,rust-browser,web,android}-cicd`), the resource
group and cluster (`testcabinet-staging-westus2-rg`,
`testcabinet-staging-westus2-aks`), the service connection (`tcab-deploy`),
the deploy environment and namespace (both `tcab-staging`), the platform the
service images are built for (`linux/arm64`) and the two Tauri answers,
`tauri_desktop` and `tauri_android`, both true, which is what has the template
render the `android` CI image track the `shell` kind runs in. The other edits
an update carries are of the same kind: the project's gates and their wiring
in `.pre-commit-config.yaml` and `azure-pipelines.yml`, the CI image pin in
`ci/images/tags.yml`, the devcontainer image's gg layer and apt packages, the
project's skills and hooks under `.claude/`, and the project's pipeline work
in `.azure/project/*.yml`, which the template's pipeline includes.

`copier.yml` at the root is a second copier template, the repository kit this
project renders its own repositories from; see
[Repositories](/development/repositories/#the-kit).

## The gates

One command runs every check a commit of the superrepo runs, over its tree:

```sh
make gate
```

Every check is a gate: one file under `ci/gates/` whose stem is the gate's id,
run by the `gate` runner of the `ci` project. That id is what a commit hook, a
pipeline step and an issue all call the check by. Every repository carries the
same runner, rendered by the kit, with the gates of its kind; see
[A repository's gates and pipeline](/development/repositories/#a-repositorys-gates-and-pipeline).

```sh
uv run --quiet --project ci gate list         # every gate and what it checks
uv run --quiet --project ci gate run <id>...  # run some of them
uv run --quiet --project ci gate run --all    # what make gate runs
```

Given `--report-dir`, the runner keeps every gate's output in a file under that
directory and writes `SUMMARY.md` beside it, which is how a workflow hands an
agent a failure without the output itself; `ci/README.md` describes the report.

The template's gates:

| Id | What it checks |
| --- | --- |
| `no-nul-bytes` | No NUL byte in a file `.gitattributes` does not declare binary |
| `devcontainer-declaration` | The checkout is mounted at the folder the container works in |
| `shell-tests` | Every `*.test.sh` under `scripts/`, `scripts/ci/` and `scripts/repos/` |
| `k8s-manifests` | The template's render of every overlay; see [Kubernetes](/deployment/kubernetes/overview/) |
| `markdownlint` | The Markdown style, from `.markdownlint-cli2.yaml`, at 90 columns |
| `cspell` | The prose's spelling, from `cspell.json` and `.cspell/project-words.txt` |
| `format` | Prettier, with `.prettierignore` as its scope (plus the k8s manifests) |
| `docs-typecheck` | This site's `astro check` |
| `docs-build` | This site's build |
| `python-lint` | ruff over `ci/`, `scripts/repos/` and the repository kit's `templates/repository/` |
| `ci-tests` | pytest over `ci/` and `scripts/repos/`, the latter rendering the repository kit for each kind |

The project's own gates, wired the same way:

| Id | What it checks |
| --- | --- |
| `k8s-deploy-sets` | The staging and prod deploy sets, every image pinned to a commit |
| `ci-image-pins` | The root pipelines name every CI image as `<repository>:${{ variables.ciImageTag }}` and include `ci/images/tags.yml`, and no file under `.azure/` names one |
| `dependency-graph` | The submodules, the patch table and the package links against the repositories' [edges](/development/repositories/#the-edges), and every checked-out repository's lock and links |
| `scripts-test` | `node --test` over `scripts/lib` and `scripts/*.test.mjs` |

`.pre-commit-config.yaml` runs each gate as one hook, triggered by the files it
judges. `scripts/setup-hooks.sh` installs the hooks, and the dev container runs
it when the container is created. `git commit --no-verify` bypasses them.

The same file carries the checks the hook framework brings from its pinned
upstream repositories, the file checks of `pre-commit-hooks` and `shellcheck`;
they are hooks, not gates, so `make gate` does not run them and
`pre-commit run --all-files` does, and the pipeline gives each a step of its
own.

The gates over code live with the code. A Rust workspace's `rust-*` gates, an
npm workspace's `typescript` gate, `contracts`' `contract-drift`, `engines`'
`seeded-contract` and `test-suites`' `frozen-paths`, `spec-prose`,
`spec-vocabulary`, `audio-packs` and `validators-typecheck` each run in that
repository's checkout and pipeline, by the same runner and the same command.
A change to a repository runs that repository's gates from its directory:

```sh
cd microservice-driver && make gate
```

## Building Rust

In a repository carrying a crate:

```sh
cargo build --workspace
```

The toolchain is pinned to an exact patch release in `rust-toolchain.toml`, and
every checkout builds with that release. Format, lint, and test with:

```sh
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo doc --workspace --no-deps --document-private-items
cargo nextest run --workspace
cargo test --workspace --doc
```

Tests run under `cargo-nextest`, configured by `.config/nextest.toml`, which the
dev container and the Rust CI images both carry. nextest does not execute
doctests, so `cargo test --doc` runs those separately. `cargo doc` is what
checks intra-doc links, and `--document-private-items` is required for it to
reach crates whose public surface is small. Each repository's
`.cargo/config.toml` sets it as `build.rustdocflags`, so the `rust-doc` gate
documents private items too. Cargo reads that file for every run under the
repository, and an empty `RUSTDOCFLAGS` in the environment overrides it.

Inside the superrepo, a build of a repository resolves its dependencies on the
other repositories to their sibling checkouts through the patch table, so a
change to `contracts` is compiled into the next build of `microservice-driver`
with nothing fetched. The repository's committed lock names the public sources,
and cargo rewrites the working copy; an application's `scripts/resolve-lock.sh`
resolves the lock to commit outside every patch table. Outside the superrepo,
in a repository's own pipeline, the same manifests fetch each dependency from
its git source at the tag they pin.

The gates run the same commands, and are the ones to run locally when
reproducing a CI failure:

```sh
uv run --quiet --project ci gate run rust-fmt rust-clippy rust-doc
uv run --quiet --project ci gate run rust-test rust-doctest
```

### The scoring goldens

A run's score and rating are computed twice: by `microservice-backend` in
Rust, where the backend scores a stored review, and by `@clockwyrks/run-stats`
in TypeScript, where the console and the gallery score the same run. The
goldens under `contracts/crates/contracts/fixtures/scoring/` are the cases
both must agree on, one file per pair of functions that exists on both sides:
`score_checklist`, the toolchain gate (`gated`), the review aggregations
(`aggregate`), the validator-decided domain ratings (`validator_domain`),
`merge_review_items`, the errata's `score_exclusions`, and the automated-only
score with the verdicts and the covered score it is built on (`automated`).
Each case gives its `name`, `why` it exists, the `input` and what to `expect`.

The backend's `review.goldens.test.rs` executes them in its `rust-test` gate
and `ui-common`'s `packages/run-stats/src/scoring.goldens.test.ts` in its
`typescript` gate, both reading the files off the `contracts` dependency at
the version each pins, so a case added in `contracts` reaches both sides with
their next pin bump, and each fails when the directory holds a file it
executes no test for. Each rejects a key it does not know, since a misspelled
key would otherwise fall back to its default and assert less than it reads as
asserting. The expectations are the Rust output: a change to a scoring rule
changes the goldens, and the other side then has to follow. The writeup-based
`review::score` has no golden, being a thin wrapper over `score_checklist`
with no TypeScript counterpart.

### Tests that read case versions

A Rust test that resolves a named case version reads a copy of it under its
crate's `testdata/definitions/`, laid out like the `test-suites` root
(`test-cases/<type>/<difficulty>/<slug>/<version>/`, `game-jams/`,
`test-case-groups/`). A copy holds the version's tracked files without its
`.frozen` marker, so the [frozen-paths](/development/frozen-versions/) gate
guards the original alone. The tests read no other tree, so they pass wherever
the catalog itself lives, and a missing copy fails the test that resolves it.
The format, prose and lint gates and the image build context leave the
copies out.

The tests that hold every committed version to a rule are the backend's, such
as `every_stored_manifest_preserves_its_asset_shape`. They read the catalog
from `TCAB_DEFINITIONS_ROOT`, the directory holding `test-cases/`,
`game-jams/` and `test-case-groups/`, which is the `test-suites` checkout, and
they fail where it holds no catalog. That read is the data edge
`microservice-backend -> test-suites`, so the backend's pipeline checks
`test-suites` out beside itself for its Rust job.

### Tests that need a browser

A few of the suites crate's and the driver's tests run a real toolchain rather
than a stand-in for one: the lockfile check's script under the host's `node`,
and Playwright's Chromium launched through the npm workspace, which is how a
validator project runs under Vitest's browser mode. A machine without that
toolchain prints `skipped:` and what is missing, and the test passes, so the
rest of the suite still runs on a laptop with no browser.
`contracts/crates/suites/src/test_browser.rs` holds the helpers such a test
uses, which the suites crate's `test-support` feature exposes to the driver's
tests, and `test_browser::tests::the_repository_workspace_launches_chromium`
in the suites crate checks the toolchain on its own.

Where the toolchain is meant to be present, a skip is a pass nobody earned.
`TCAB_REQUIRE_BROWSER=1` names such a place: with it set, a missing `node`, a
workspace without the packages a test names, or a Chromium that does not
launch fails the test instead. The `rust` job of `contracts`, of
`microservice-driver` and of `the-spec-cabinet` is such a place: it runs in
the [rust-browser CI image](#ci-images), which carries Node and Chromium, and
sets the variable, so these tests run in CI and a missing toolchain fails
them. To hold a local run to the same standard, in the repository:

```sh
npm ci                                     # the workspace: Vitest, Playwright
scripts/ci/install-playwright-chromium.sh  # Chromium and its libraries (as root)
TCAB_REQUIRE_BROWSER=1 cargo nextest run --workspace
```

The dev container already carries Chromium. A test finds the npm workspace from
its crate's `CARGO_MANIFEST_DIR`, as the nearest ancestor holding a
`package.json` and a `node_modules`, and stops at the repository's root, so a
checkout inside the superrepo never borrows another repository's install.

### The Rust toolchain pin

`rust-toolchain.toml` is the template's in the superrepo and the kit's in
every repository, and pins the compiler to an exact patch release, the
compiler the toolchain image `TOOLCHAIN_IMAGE` in
`.devcontainer/docker-compose.yml` names holds, which the devcontainer and the
CI images are built on. A new compiler therefore arrives with a template
update, and reaches every repository with the `render.py --update` that
follows it. The images a repository builds compile with the same compiler:
each `FROM rust:<version>-bookworm` and each `ARG RUST_VERSION=<version>`
default there must equal the toolchain file's `channel`, and the
`build-context` gate, whose hook also fires on `rust-toolchain.toml`, fails
naming the file, the line and both versions until they do.

Two things follow a bump in the `gg` repository without anything to do by
hand:

- gg's Rust arm compiles a model's program against a set of `.rlib` files, a
  compiler-private format `rustc` refuses from any other release (E0514). The set
  is generated by `crates/gg-sandbox-artifacts/rust` into its `OUT_DIR`, and
  `rust-toolchain.toml` is in that crate's rerun set, so the next build re-cuts
  it with the new compiler.
- The toolchain file lists no `targets`. The wasm target gg's Rust arm compiles
  to is installed by `scripts/ci/install-rust-wasm.sh` instead, because a target
  named there is fetched on the first cargo invocation of every checkout,
  including the builder images that cross-compile nothing.

### `gg` and its eleven toolchains

[`gg`](/gg/overview/) drives a model in one of eleven program languages, and
building `test-cabinet-gg` in the `gg` repository produces two things for each
of them.

A signature catalogue is what a model is told an arm offers: every module,
signature, argument, type, and type member, reflected out of that language's own
SDK by that language's own documentation tool. `crates/gg/build.rs` generates all
eleven into the build's `OUT_DIR`, and the arm modules `include_str!` them from
there. A build of gg therefore describes the SDK sources in its own checkout. See
[Program languages](/gg/languages/overview/).

An arm's build artifacts are what a model's program is compiled and evaluated
against: a guest component, an SDK jar, a compiler, a library set. Each arm has a
crate under `crates/gg-sandbox-artifacts/` whose build script runs that arm's
`packages/gg-sandbox*/build.sh` into its own `OUT_DIR`, and `crates/gg` embeds
the result from there. Ten crates serve the eleven arms, because
`packages/gg-sandbox` serves TypeScript and JavaScript from one build. Separate
crates give each arm its own rerun set, so editing the Java SDK re-cuts the Java
jar alone, and cargo runs the independent arms concurrently.

Both are generated rather than committed. `crates/gg/src/sandbox/checkers/`
holds five files that are gg's own source: three hand-written Java compiler
drivers and the two JVM arms' pin declarations. A `.gitignore` allowlist names
exactly those five and ignores everything else in that directory.

Anything that compiles `crates/gg` needs those toolchains present: every cargo
command over the gg workspace, its pre-push clippy and doc hooks,
`scripts/build-gg-static.sh` and `scripts/gg-reference.sh`. No other
repository compiles gg, so a build anywhere else needs none of it.

Install them once, before the first build:

```sh
scripts/ci/install-gg-toolchains.sh        # the eleven arms, ~1.9 GB, idempotent
scripts/ci/install-gg-build-toolchains.sh  # the C# guest's build tools, idempotent
npm ci                                     # the pinned tsc two arms reflect with
```

The two lists stay separate. The first is every toolchain that a gg run and gg's
reflectors execute; it is installed into the dev container's image by
`.devcontainer/languages/gg/install.sh`, in gg's pipeline by
`scripts/ci/gg-ci-toolchains.sh`, and in the run images. The second is a .NET
SDK and an unpruned wasi-sdk that exactly one arm's artifact build needs,
since C#'s guest is Mono's IL interpreter, relinked. It installs under its own
prefix `~/.local/share/tcab/gg-build/` so the eleven-arm list keeps its
meaning and the run images keep their size. With the second prefix populated,
`packages/gg-sandbox-csharp/build.sh` resolves both from it instead of
fetching its own copies.

The dev container's image carries both lists, together with the apt packages
gg's installers and the asset tools need (`ruby`, `libicu-dev`, `ffmpeg`,
`cmake`, `iproute2`, `lsof`, `procps`) and `wrangler`. Most of the toolchains
are the template's language images, which every workspace on a machine copies
from the same layers: the Swift toolchain, wasi-sdk, the .NET SDK, the JDK, the
Kotlin compiler, `purs`, YARD, componentize-py and `wit-bindgen`. In the
image's last layer, `.devcontainer/languages/gg/install.sh` first runs gg's
`scripts/ci/gg-image-toolchains.sh`, which links each of those arms' default
homes to the image's tree with the installer's stamp, and then the two
installers above, which find those arms installed and fetch only what no image
holds. Each arm's pin is therefore the version its image's tag names, and a pin
the image does not hold fails the image build and the `shell-tests` gate rather
than downloading the arm. The one exception is the wasi-sdk the C# guest links
with, which is pinned to the release Mono's prebuilt runtime pack was built
against rather than to the C++ arm's, so while the two differ the second
installer downloads it. The installers run against a slice of the `gg`
checkout the Dockerfile stages for them, so a pin moving under gg's
`packages/` or an installer changing rebuilds that layer and nothing above it.
A container built before a pin moved reconciles by running the two installers
by hand; each checks what is there against its pin and touches no network
when they match. See "gg's toolchains" in `.devcontainer/README.md`. The one
prerequisite the image leaves to the checkout is the npm workspace, which
`post-create.sh` installs, because two catalogues are reflected with the
pinned `typescript` in it.

In gg's pipeline, `scripts/ci/gg-ci-toolchains.sh` is the one provisioner for
every job that builds or tests Rust. It installs the pinned Node and both lists
into a directory the job caches, with the default install locations under
`$HOME` linked into it, so a warm cache downloads only the wasm32 standard
library.

A missing toolchain fails the build with the arm named and the fix stated. A
failure naming `node_modules` is fixed by `npm ci`.

An interrupted install is safe to re-run, and it is cheap. Between them these
scripts fetch about 3 GB, the Swift toolchain alone 1.05 GB, and every one of
those fetches goes through `gg_fetch` (`scripts/ci/fetch.sh`), which retries a
dropped connection and resumes rather than restarting. The partial archive is
kept under `~/.cache/tcab/downloads`, so re-running the installer after a
failure picks up where it stopped instead of paying for the whole transfer
again; each installer deletes its own archive once the tree it feeds has
verified itself. Nothing under an install prefix is touched until every byte
is on disk, so a fetch that fails leaves a toolchain a machine already had
rather than half of one.

To read an arm's build artifacts, or a catalogue, run the same scripts the build
runs:

```sh
scripts/gg-artifacts.sh               # -> target/gg-artifacts/, every arm
scripts/gg-signatures.sh              # -> target/gg-signatures/<language>.signatures.json
```

Both accept a destination argument and default to a gitignored directory under
`target/`. Both read `scripts/gg-arms.sh`, the only enumeration of gg's arms in
the repository, and `build.rs` calls `gg-signatures.sh` rather than repeating it.
A catalogue is also where reflector bugs surface, such as a dropped `@return`
paragraph or a truncated parameter description.

#### Testing `gg`

nextest runs each test in its own process, and most of gg's tests need a
compiled guest component. The test build keeps compiled components on disk in
`component-cache` under the crate's `OUT_DIR`, so a guest is compiled a handful
of times per build rather than once per test. An entry is keyed on the
component's bytes and wasmtime's compatibility hash, is stored only once its
bytes have been compiled twice, and is evicted least recently used past 16 GiB.
`cargo clean` removes it. Production builds have no such cache.

A compiled language arm's tests each need a program built by that arm's real
toolchain, and a test process that builds one from cold pays the toolchain's
whole start-up. The test build therefore also keeps prepared programs on disk
in `prepared-cache` under the crate's `OUT_DIR`, so a fixture program is built
once per build rather than once per test. An entry is keyed on the content of
everything that shapes the output: the language, the arm's compiler identity
(its version and the toolchain it resolved), every embedded input the arm
compiles against, the program's source and each code module's key and source.
It holds the component the arm built, or the model-facing failure the arm
answered with; a toolchain failure is never stored. One process builds each
key, under an exclusive lock the others wait on; entries are written whole by
a rename, evicted least recently used past 4 GiB, and any failure of the store
falls back to building. `cargo clean` removes it. The store serves only the
tests that ask it for a program: no language arm, no turn and not the isolation
gate can reach it, since a build cache inside an arm is the breach that gate
exists to catch.

Test builds compile components on one thread, since nextest already runs one
test per core. The root manifest optimizes the Cranelift and wasmtime crates in
the dev profile, which is where that compile time goes.

Most of gg's tests compile a program in one of its language arms, so the suite
is the bulk of the workspace's test time, more than one Rust gate job holds.
`crates/gg/Cargo.toml` therefore sets `test = false` on gg's lib and bin and
`doctest = false` on the lib (gg has no compiled doctest), so the `rust-test`
gate and `make gate` skip the suite, while `rust-clippy` still lints its
`#[cfg(test)]` code. `scripts/ci/gg-test.sh` runs it with `--lib`, which
overrides `test = false`, whole with no argument or as one `k/N` hash
partition of it; gg's pipeline's `gg_tests_<k>_of_4` jobs run one partition
each. Run it after any change under `crates/gg/`:

```sh
scripts/ci/gg-test.sh        # the whole suite
scripts/ci/gg-test.sh 2/4    # one hash partition of it
```

### Portable (static) builds

The default build dynamically links against glibc and the generic FHS dynamic
loader (`/lib64/ld-linux-x86-64.so.2`), which suits mainstream Linux such as
Ubuntu. Distributions that ship no such loader, notably NixOS, need a fully
static binary built against the musl target instead. This is opt-in and leaves
the default build unchanged.

Prerequisites:

```sh
rustup target add x86_64-unknown-linux-musl
# plus a musl C toolchain on PATH (`musl-gcc`), for the little C that the `ring`
# TLS backend and the bundled SQLite compile. On Debian/Ubuntu: `musl-tools`.
```

Each application's `.cargo/config.toml` defines one `build-portable-<binary>`
alias per binary it ships, pinned to `x86_64-unknown-linux-musl` and writing
to `target/x86_64-unknown-linux-musl/release/`, so an aarch64 host
cross-compiles and needs an x86_64 musl cross toolchain on top of that. The dev
container installs the musl target for its own architecture, which is what
gg's `scripts/build-gg-static.sh` builds against.

| Repository | Alias | Binary |
| --- | --- | --- |
| `microservice-driver` | `cargo build-portable` | `tcab` |
| `microservice-driver` | `cargo build-portable-driver` | `tcab-driver` |
| `microservice-backend` | `cargo build-portable-backend` | `tcab-backend` |
| `microservice-dispatcher` | `cargo build-portable-dispatcher` | `tcab-dispatcher` |
| `microservice-artifacts` | `cargo build-portable-artifacts` | `tcab-artifacts` |
| `gg` | `cargo build-portable-gg` | `gg` |

The backend links statically too: its SeaORM SQLite driver compiles SQLite from
vendored C source with the same musl toolchain, and its PostgreSQL driver is pure
Rust over rustls. Under its `cli` runtime the driver still shells out to a host
container runtime, so that host needs Podman or Docker on `PATH` and the harness
API keys for the harnesses it runs; see the
[driver configuration](/components/driver/overview/).

#### Building `gg` for the run container

gg executes inside the run container, and a run's image varies by test type:
most are glibc Debian bookworm, and the blender image is Ubuntu. The static musl
build is what lets one binary run across every run-container image.

```sh
# Release/CI build (x86_64), matching the other `build-portable-*` aliases:
cargo build-portable-gg

# Arch-adaptive build for the HOST architecture. Use this in the dev container
# (aarch64 on Apple Silicon) for a local k3d cluster. It picks the musl target,
# wires up `musl-gcc`, and prints the built binary's path:
scripts/build-gg-static.sh            # -> …/<host-arch>-unknown-linux-musl/release/gg
scripts/build-gg-static.sh /out/gg    # …and also copies it to /out/gg
```

The driver image fetches the gg release the driver pins from the release
container and installs it at `/usr/local/lib/tcab/gg`, with `TCAB_GG_BINARY`
pointed at it, so a Kubernetes run installs gg from the image. The local
stack's `make -C deployments/local local-up` bakes the file `TCAB_GG_BINARY`
names in the environment instead, when it is set, which is how a gg built
from its checkout is run before it is released. See
[gg installation](/gg/overview/#installation--distribution).

## Building TypeScript

In a repository carrying an npm workspace, install its dependencies from the
lock, then build every workspace member that defines a build:

```sh
npm ci
npm run build
```

The other root scripts delegate to each member that defines them:
`npm run dev`, `npm run test`, `npm run typecheck` and `npm run lint`. That is
what the kit's `typescript` gate runs, in that order, so a workspace that
passes the gate is one that installs from its lock, builds, type-checks and
tests. `npm run test` runs `vitest` in each member; iterate on one with
`npm run test -w <package>`. On a clean checkout, build the packages a test
imports first, since the tests import them from a built `dist/`.

A workspace that names another repository's package installs it from the feed
at the version its manifest pins. Inside the superrepo,
`scripts/repos/link-packages.sh` links the name to the sibling checkout
instead, with the manifests and the lock as committed, so the console builds
against the `ui-common` and `contracts` checkouts; run it again after a
repository gains a package or a workspace. A linked package is read from its
`dist/`, so the producer is built before the consumer, in the order the
script's plan prints.

### Linting

ESLint lints the hand-written TypeScript of an npm workspace with type
information, from the `eslint.config.js` at its root, whose `PROJECTS` list
names each project with the `tsconfig.json` that owns it. Every file set is
derived from that list, so a new project is brought under the gate by adding
one entry to it. It also lints the build configurations beside them (each Vite
configuration and the plugins it loads) without type information.

The gate has one tier. The configuration raises every rule a preset leaves at
`warn` to an error, and an `eslint-disable` comment that suppresses nothing is an
error too.

A workspace whose code predates the gate carries it as a ratchet.
`eslint-suppressions.json` at the workspace root records, for each file, how
many errors of each rule the file had when it was recorded. It is ESLint's own
[bulk suppressions](https://eslint.org/docs/latest/use/suppressions) file, and
`npm run lint` reads it:

- A file whose count for a rule is at or under its record passes, and its
  recorded errors are not printed.
- A file whose count for a rule grows past its record fails, and ESLint prints
  every error of that rule in the file, since it cannot tell which one is new.
- A file the record does not name, or a rule it does not name for that file,
  fails on its first error. New code is held to the whole gate.
- An error ESLint cannot attribute to a rule is never recorded: a file that does
  not parse, or a file outside every project's `tsconfig.json`, fails as it is,
  and so does an `eslint-disable` comment that suppresses nothing.
- A count that shrinks passes. Record the shrink with `npm run lint:prune`,
  which lowers each count to what the code now has and drops what reached zero,
  so the shrink cannot be spent again.

| Command | What it does |
| --- | --- |
| `npm run lint` | The gate: ESLint, with the baseline applied |
| `npm run lint:prune` | Lowers the baseline to the current counts; never raises one |
| `npm run lint:baseline` | Rewrites the baseline from scratch to the current errors |
| `npm run lint -- --fix` | Applies ESLint's automatic fixes, then checks as the gate does |

`npm run lint:baseline` accepts every error the code has now, new ones included.
It is for widening the gate: adding a project to `PROJECTS`, or adopting a rule
set the existing code does not yet meet. A diff that raises a count in
`eslint-suppressions.json` is the visible record that it was run, and fixing the
new error is the usual answer instead. ESLint writes the file in its own
formatting, with no final newline, so `.prettierignore` leaves it out of the
`format` gate and the `end-of-file-fixer` hook leaves it alone.

A file moved or renamed loses its record, because the record is keyed by path.
Move its entry in `eslint-suppressions.json` to the new path with it, or run
`npm run lint:baseline` in the same change and check that the diff only moves
counts.

### Every page loads

`ui-common`'s `packages/ui/src/app/pages/routeSmoke.test.tsx` mounts the routed
app at every path in `routePatterns` and asserts that each one renders, meaning
the page error boundary caught nothing and the page put content on screen. It
walks that table against three hosts: a console with a stocked catalog, a
console holding nothing, and the read-only static gallery.

This suite covers whether a page loads at all; the per-page suites cover whether
it behaves correctly. Adding a route to `routePatterns` adds it to the walk.

The page error boundary in `packages/ui/src/app/components/PageErrorBoundary.tsx`
is the runtime counterpart. It wraps the routed body, so a page that throws is
contained to itself: the chrome and section nav stay, the panel names the
failure, and navigating to another page clears it.

### Validator projects

In the `test-suites` checkout, type-check every test case's validators with:

```sh
npm run typecheck:validators
```

It runs `tsc --noEmit` over each `test-cases/**/<version>/validation/<engine>/`
project. Nothing else compiles them: a run stages a project into the produced
tree and vitest transpiles it without checking types, so this is the only gate on
a validator that fails to compile. It is `test-suites`' `validators-typecheck`
gate.

A project resolves the build's `../src/*` against the case's reference
implementation and the shared harness's `./case-harness/*` against
`@clockwyrks/case-harness`, through the `rootDirs` its config declares. See
[Writing Case Specifications and Prompts](/guides/authoring/writing-case-specifications/#validators-type-check-where-they-are-authored).

Lint the authored prose with:

```sh
npm run lint:specs
```

It runs the `spec-prose` gate: `markdownlint-cli2` over the Markdown in
`test-cases/**`, `game-jams/**` and `test-case-groups/**`, then `cspell`, from
`.cspell/specs.json`, over the Markdown, HTML, CSS, TOML, and Handlebars there
that a case or jam ships to a model. Add a legitimate domain term to
`.cspell/project-words.txt` when `cspell` flags it. This is the linter the
test-case authoring and variant guides refer to under "Validate your work". The
rest of a repository's Markdown, this site included, is the `markdownlint` and
`cspell` gates'.

Check formatting over a checkout with:

```sh
npm run format:check  # check, the format gate
npm run format        # rewrite
```

It runs `prettier --check` over every file prettier has a parser for. A
formatting warning anywhere fails the check. What `.prettierignore` names is
left out (build trees, vendored copies, the Handlebars templates prettier does
not parse, and prose, which markdownlint and cspell own), and in `test-suites`
so are the frozen test-case versions, which `scripts/format-check.mjs` derives
from their `.frozen` markers on each run. It is the `format` gate.

## Generating the data contract

The run-record data contract and the backend API built on it have a single
source of truth: the Rust types that derive `ts_rs::TS` and
`schemars::JsonSchema` behind their `contract` feature, in the contracts crate.
Two generators in the `contracts` repository turn them into committed
TypeScript bindings and JSON Schemas:

- `crates/contract-codegen` writes the data contract: `packages/run-record/src/`
  and `packages/asset-contract/src/` (two packages, because only the latter may
  be seeded into a run) and their schemas under `schema/core/` and
  `schema/gg/`.
- `crates/api-codegen` writes the backend's API: `packages/backend-api/src/`
  and its schemas under `schema/backend-api/`, `schema/coverage/`,
  `schema/jobs-api/` and `schema/snapshot/`. It reads the first generator's
  modules and documents without writing them, so a backend type that refers to
  a contract type imports it from `@clockwyrks/run-record` and references it at
  the contract document's URL. Nothing in the data contract refers back to the
  backend API.

After changing a contract or backend API type, regenerate and commit, in the
`contracts` checkout:

```sh
npm run gen:contract
```

It runs both generators, mirrors gg's built-in system-prompt templates into
`packages/backend-api/src/gg-system-prompt.ts` (the backend API's package, not
the data contract's, because the data contract depends on nothing of gg's),
formats the output with Prettier, and compiles the three packages. The
`contract-drift` gate regenerates and fails on any diff, or on a generated
file that was never committed, so the Rust, TypeScript, and JSON Schema
representations stay in step. A change reaches a dependent by a
[pin bump](/development/repositories/#bumping-a-pin).

The docs site publishes every schema under `/schema/`. Its `prebuild` and
`predev` run `scripts/copy-contract-schemas.mjs`, which copies them out of
`contracts/schema/` into `apps/docs/public/schema/`, where `.gitignore` lists
them, and fails when the submodule is not checked out.

## Projecting gg's reference

The console's gg Reference section is served by the backend from files gg
projects: the whole tool vocabulary, and every responses-as-code function and
type on each of the eleven arms, carrying the bytes a model's own documentation
lookup renders. The backend links nothing of gg's, so the projection crosses
that boundary as files, in the `gg` checkout:

```sh
scripts/gg-reference.sh            # -> target/gg-reference/
```

That writes `index.json` plus one `<language>.json` per program language. The
backend finds them where `TCAB_GG_REFERENCE` points. The backend image fetches
the same files, as `gg-reference.tar.gz` of the release the driver pins, from
the release container at build time, and bakes them at `/opt/gg-reference`, so
a deployed console's reference and the harness its runs execute describe one
release; see [Releasing gg](/development/releasing/#releasing-gg). A backend
with no documents serves everything else normally and answers `503` on the
two reference endpoints.

The script builds gg, so it needs the toolchains described under
[gg and its eleven toolchains](#gg-and-its-eleven-toolchains). Running the
projection itself needs none of them, because every arm's catalogue is compiled
into the binary.

## Checking gg's arms in a run image

The run-container images live under `containers/` in `microservice-driver`.
Each copies the binaries of the `tool-*` images it needs at the commits the
driver pins, and the `-gg` variants copy the toolchain tree of the gg release
the driver pins, which gg's pipeline publishes beside the release as the
`gg-toolchains` image. Every language arm compiles inside the run container,
against that tree, so the question a build cannot answer is whether the tree
works where it is copied to. `gg selfcheck` answers it: it drives every arm's
bootstrap program through the real preparation, guest and views in whatever
environment the binary is running in, and exits non-zero when any arm fails.

```sh
make -C deployments/local run-images-gg-selfcheck   # build the five, check them
```

That target fetches the pinned gg release, or takes the file `TCAB_GG_BINARY`
names, and hands it to `containers/build.sh --gg-selfcheck`, which drives the
check inside each image between building it and pushing it, installing the
binary the way a run does, with `docker cp` to `/tmp/gg` and an `exec` as the
unprivileged run user. Naming the images runs the same command by hand, in the
driver's checkout:

```sh
containers/build.sh --gg-selfcheck target/gg-selfcheck/gg \
  sprite-gg base-wasm-gg voxel-gg full-stack-3d-gg blender-gg
```

Five images answer for all twenty-seven variants, because each copies one
tree to one absolute path and so carries the same tree byte for byte, and what
differs is the environment it runs in: the image the lineage is rooted at plus
every package a run image installs on the way down. `build.sh` re-derives that
grouping from the Dockerfiles on every gated build. The driver's pipeline
passes the same `--gg-selfcheck` flag post-merge, before the images are
published.

The tree being identical is a fact about the files, not about how the registry
stores them. Each variant carries its own layer for those bytes, so a host that
pulls two variants pulls the tree twice, and fifty-five images with twenty-seven
copies of a 2.2 GB tree do not fit on a build agent. So the CI build sets
`RECLAIM=1` alongside `PUSH=1`, and `containers/build.sh` then removes each image
from the local store once nothing later is `FROM` it and prunes the builder cache
as it advances. `RECLAIM` is deliberately a separate switch: the builder prune
takes every cache mount on the daemon, including ones belonging to other
Dockerfiles, so a publish from a development machine does not set it. A local
build sets neither and keeps everything, because there the images are what is
being produced.

### Reusing unchanged run images

The CI build is also content-addressed, so a commit that changes no run image
builds none. `scripts/ci/run-image-inputs.sh` prints a digest of every image's
inputs (its Dockerfile, the context paths it copies, the tool and gg images it
copies from, its parents' digests), and `containers/build.sh`, handed that
table as `REUSE_INPUTS`, pushes each image it builds under an
`inputs-<digest>-<arch>` tag as well as the commit's, and gives an image whose
inputs tag is already in the registry the commit's tag with a manifest write
instead of a build. `containers/README.md` says what the digest covers and how
a build is forced when an unpinned upstream has to be refreshed.

`cargo run -p test-cabinet-gg -- selfcheck` in the `gg` checkout asks the same
question of this machine's own toolchains, which is the form to run while
working on an arm. See [the self-check](/gg/languages/selfcheck/).

## Continuous integration

Azure Pipelines is the project's only CI. Every repository has a pipeline of
its own, rendered by the kit, which gates it, publishes what it releases and
mirrors it; see
[A repository's gates and pipeline](/development/repositories/#a-repositorys-gates-and-pipeline).
The superrepo's `azure-pipelines.yml` is the template's: it gates a commit of
the superrepo, and on `staging` deploys the `staging` overlay. The project's
own jobs and stages come from the files under `.azure/project/`, which it
includes. Every job delegates to a script, so a failure reproduces locally by
running the same script; `scripts/ci/README.md` lists them. The YAML names the
image a job runs inside, its caches, the credentials a step runs under, and
which registry round trips are retried, and nothing else.

Pushes to `master`, `staging` and `nightly` trigger it, batched: pushes that
arrive while a run of the same branch is in flight get one run, for the newest
commit, so an intermediate commit is not gated, mirrored or deployed on its own.
Pull requests into `master` and `staging` run it through build validation
policies on those branches, because Azure Repos ignores a `pr:` block. A tag of
the superrepo runs nothing: what a version releases, each repository's tag
releases; see [Releasing](/development/releasing/).

| Stage | Runs on | What it does |
| --- | --- | --- |
| `gates` | every run | The template's gate jobs and the project's jobs below; the GitHub mirror on `master`, `staging` and `nightly` |
| `deploy` | `staging` | The template's: rolls the `staging` overlay onto the deploy set; see [Kubernetes](/deployment/kubernetes/overview/#deploying) |
| `prod` | `master` | The project's: `scripts/ci/deploy-environment.sh prod`, which applies the `prod` overlay onto its set and waits on every workload together |
| `docs` | `master`, `staging` | The project's: deploys this site |

Every stage after `gates` depends on it, so a red job in the gates stage stops
the mirror, the deploys and `docs`.

### The gate jobs

The template's gate jobs run every gate, one step per gate, in the CI image of
their track. Each step runs `uv run --quiet --project ci gate run <id>`, the
command a commit hook and `make gate` run it with, so a failing check is one
red step named for it. Each upstream hook runs as
`pre-commit run <id> --all-files` in a step of its own.

The project adds steps through `.azure/project/setup-steps.yml` and
`.azure/project/steps.yml`: the `contracts` checkout, for the schemas the docs
build copies, and a variable that disables Astro's telemetry, whose write
outside the checkout fails the docs build.

Every gate that runs tests names `CI_GATE_ARTIFACTS: target/gate-artifacts/<id>`
on its step, which has it write its JUnit report there, and each job ends,
after the project's steps and whether the tests passed or failed, with
`scripts/ci/collect-test-results.sh` and a publish of what it collected as the
pipeline artifact `test-results-<job>-<attempt>`. `ci/README.md` describes the
report directory and the metrics read off it.

### The project's jobs

`.azure/project/jobs.yml` adds these jobs to the gates stage:

| Job | Runs on | What it does |
| --- | --- | --- |
| `submodule_pins` | every push; a pull request that touches a submodule pin | `submodule-pins.sh`: every pin is on the submodule's branch of the same name or on its `master`; see [Mirrors and pins](#mirrors-and-pins) and [Submodules in CI](#submodules-in-ci) |
| `mirror` | `master`, `staging`, `nightly` | Pushes the branch to GitHub, after every check job; see [The GitHub mirror](#the-github-mirror) |

The deploy stages pin every image of an environment to the commit the
superrepo's submodule pointer for its repository names, which that
repository's pipeline pushed to `testcabinet.azurecr.io` as `<name>:<commit>`
on its gated push; see
[The microservice images](/development/releasing/#the-microservice-images).

### The GitHub mirror

The `mirror` job runs `scripts/ci/mirror.sh`, which pushes the branch with
every tag it contains, or the tag a release built, to the repository's GitHub
mirror over ssh, with the deploy key held in a secure file. It is the only
thing that pushes there, so the mirror holds gated commits only. Every
repository's pipeline carries the same job, from the kit.

The target is the one the repository declares in `.nyxsis/mirrors.toml`, the
file the fleet that manages the repository reads its mirrors from, here
`https://github.com/TheClockwyrks/TheTestCabinet`. The job template,
`.azure/tcab/mirror-job.yml`, takes it as its `url` parameter, which
`.azure/project/jobs.yml` passes, and the script refuses a `url` the file does
not declare, so the two cannot drift apart. The template's `secureFile`
parameter names the key, `github-mirror-key` by default; GitHub refuses one
deploy key on two repositories, so each mirror has a key of its own. A
pipeline that passes no `url` has no `mirror` job at all, so a pipeline copied
into another repository pushes nowhere, and asks for no key, until its own
target is written in. Run directly with neither a `url` nor a declared mirror,
the script says so and pushes nothing.

Before it pushes, the script reads the mirror's refs and refuses the push when:

- the target branch exists on the mirror and its head is not an ancestor of the
  commit being pushed, or is a commit the clone does not hold; or
- a tag it would push already names a different object on the mirror.

Either means the mirror holds history this repository does not, such as another
repository's history pushed by a copied pipeline, or a history rewritten under
it. The push itself is not forced, so a mirror that moved between the check and
the push is refused by GitHub too. When replacing the mirror's history is
meant, queue a run with the pipeline variable `mirrorAllowRewrite` set to
`true`, which skips the check and forces the push; locally, `--allow-rewrite`
or `MIRROR_ALLOW_REWRITE=true` does the same.

In the superrepo's pipeline the `mirror` job sits in the gates stage, which
the deploy stages wait on, but the mirror is not an input to either. Its push
step therefore continues on error: a refused or failed push ends the job with
issues, the run shows the warning, and the stage still succeeds, so a re-run
of an older run, a branch rewritten here or a tag moved after it was mirrored
never holds back a deploy of a commit that passed every check.

### CI images

The gate jobs of every pipeline run inside the superrepo's CI images, one per
track:

| Image | Jobs |
| --- | --- |
| `testcabinet.azurecr.io/ubuntu-the-test-cabinet-rust-cicd` | A repository's `rust` job, and gg's test partitions and release builds |
| `testcabinet.azurecr.io/ubuntu-the-test-cabinet-rust-browser-cicd` | The `rust` job of a repository whose suite drives a browser |
| `testcabinet.azurecr.io/ubuntu-the-test-cabinet-web-cicd` | Every repository's checks job, and the superrepo's gate jobs |
| `testcabinet.azurecr.io/ubuntu-the-test-cabinet-android-cicd` | A `shell`'s `rust` job and its Linux and Android bundle jobs |

`ci/images/README.md` describes each. The Rust image carries the pinned
toolchain, nextest, the musl target, and the apt packages the project's tools
need beyond a compile's, which `ci/images/rust.Dockerfile` installs (`cmake`,
`ffmpeg`, `libicu-dev`, `python3`, `ruby`, `zip`); gg's toolchains and Node
come from gg's pipeline's `gg-toolchains` cache.

The rust-browser image is the project's own. It is the Rust image of the same
commit with Node and Playwright's Chromium on top
(`ci/images/rust-browser.Dockerfile`, which installs the browser with
`scripts/ci/install-playwright-chromium.sh`). A `rust` job in it runs with
`TCAB_REQUIRE_BROWSER=1`, so the Rust tests that drive a browser run there and
fail rather than skip when it is missing (see
[Tests that need a browser](#tests-that-need-a-browser)). The android image is
the template's, rendered because the superrepo's `tauri_desktop` and
`tauri_android` answers are both true: the Rust image with the Android SDK and
NDK, the Android Rust targets and Tauri's build tools on top. Every image is
tagged by the commit of the image run that built it.

`azure-pipelines-ci-images.yml` builds the images. It triggers on the files an
image is built from and on nothing else, and every run builds every track and
pushes each as `<repository>:<commit>`, the commit its run is on, from the
layer cache. The rust-browser and android jobs wait for the Rust one, since
they build on the image that job pushed. `ci/images/tags.yml` holds one
variable, `ciImageTag`, as a variables template the pipeline includes: the
full commit whose image pipeline run built the images every gates job pulls,
so a commit's diff says which images it ran in. The template renders the file
with forty zeros, which name no image, and the commit written over them is the
project's own edit, which a template update carries. A change to an image's
files is therefore two commits:

1. Push the change. The image pipeline's run on that commit pushes each track's
   image under the commit.
2. Once that run has finished, write the commit into `ciImageTag`, and push.
   That second commit's gates run in the new images.

Until the pin follows, the gates run in the images it names. The same loop is
the first one a branch runs after a template update that moves a pin, and the
one for taking an image whose base moved under a floating tag: queue the image
pipeline by hand on the branch's head and pin the commit it ran on. A
repository takes the new pin with its next `render.py --update`. After each
of its runs the image pipeline purges the registry of every CI image tag that
`master`, `staging`, `nightly` and the checkout do not pin
(`scripts/ci/ci-image-purge.sh`), keeping as well every tag the
`azure-pipelines.yml` of a submodule repository's `master`, `staging` or
`nightly` names. That reaches the repositories of every submodule the
`.gitmodules` of the checkout or of any of those branches names by a relative
URL, which the image pipeline declares under `resources` and each of its jobs
names under `uses:`; see
[Repositories](/development/repositories/#a-repositorys-gates-and-pipeline).

A job pulls its CI image from the registry before its first step runs, so a
registry answer that times out would fail the job before it has checked
anything. Every container job therefore sets
`VSTSAGENT_DOCKER_ACTION_RETRIES`, which makes the agent retry each Docker
login, pull and start, three attempts ten seconds apart; the template's gate
jobs take it from the pipeline's definition in Azure DevOps, as a pipeline
variable. Only registry round trips are retried; a build runs once, so a
failed one keeps its reason in the log.

### Credentials

No job holds a stored credential. The pipelines authenticate through
workload-identity-federated service connections and a few secret pipeline
variables:

| Name | Kind | Used for |
| --- | --- | --- |
| `the-test-cabinet-acr` | Docker Registry connection | `AcrPush` and `AcrDelete` on `testcabinet.azurecr.io`: every pipeline pulls the CI images through it, the image pipeline pushes them and purges the stale ones, and every repository's pipeline pushes its images |
| `tcab-deploy` | Azure Resource Manager | The registry purge after each deployment (`AcrDelete`) and the cluster deploys: the custom "Test Cabinet AKS Command Invoke" role on each cluster, "Azure Kubernetes Service RBAC Admin" on its application namespace |
| `tcab-gg-publish` | Azure Resource Manager | Storage Blob Data Contributor on `testcabinetartifacts`, for gg's pipeline |
| `github-mirror-key`, `github-mirror-key-<name>` | Secure files | The GitHub mirrors' write deploy keys, one per mirror |
| `contracts` and every other repository | Repository | The submodules a job initializes through its job token |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Secret pipeline variables | The docs deploy here, and the gallery and Worker deploys on `testcabinet.ai`'s pipeline |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AUDIO_R2_BUCKET`, `CLOUDFLARE_AUDIO_R2_PRESIGN_ACCESS_KEY_ID`, `CLOUDFLARE_AUDIO_R2_PRESIGN_SECRET_ACCESS_KEY` | Secret pipeline variables | Staging the audio store out of the audio object store (read-only), on `microservice-driver`'s pipeline |

The secret variables must be set on a pipeline before its `master` or `staging`
builds can complete their image and deploy stages.

### Creating the pipelines

Each pipeline is created once, from its repository's default branch, and then
follows the YAML on whichever branch triggers it. The superrepo's gates
pipeline is `the-test-cabinet` and its image pipeline `tcab-ci-images`; a
repository's pipeline is named after the repository, which is the name
`protect.py`'s build validation expects:

```sh
az pipelines create --org https://dev.azure.com/genyume -p the-test-cabinet \
  --name microservice-driver --repository microservice-driver \
  --repository-type tfsgit --branch master \
  --yml-path azure-pipelines.yml --skip-first-run
```
