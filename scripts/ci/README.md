# CI scripts

Shared validation scripts invoked by both CI systems:

- **Azure DevOps** (`azure-pipelines.yml`) is the primary CI and runs every
  script, on both the Linux and Windows platforms. If a check can run without a
  macOS agent, it runs here — a release must never be the first thing to fail.
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
only for provisioning toolchains (Rust, Node), caching, and (on GitHub) Pages
deployment; the scripts own the actual validation.

Each script resolves the repository root from its own location (via `lib.sh`)
and can be run from anywhere, including locally:

```sh
./scripts/ci/rust-test.sh
```

## Scripts

| Script               | Checks                                              | Critical |
| -------------------- | --------------------------------------------------- | -------- |
| `rust-lint.sh`       | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo doc --document-private-items` | no |
| `install-nextest.sh` | Install cargo-nextest pinned to `NEXTEST_VERSION`   | —        |
| `install-gg-toolchains.sh` | Install every toolchain a gg **run** and gg's reflectors execute | — |
| `install-gg-build-toolchains.sh` | Install the full .NET + wasi-sdk only the C# guest's **link** needs | — |
| `rust-test.sh`       | `cargo build` + `cargo nextest run` + doctests (headless crates) | yes |
| `binary-smoke.sh`    | release-build, `cargo nextest run --release` + doctests, run binary | yes |
| `smoke-binary.sh`  | run a built binary (`--version`/`--help`/commands) | yes      |
| `web-build.sh`     | `npm ci`, type-check + `vite build` of the front ends | yes   |
| `web-test.sh`      | `npm ci`, build the workspace runtime packages, `vitest run` across every workspace | yes |
| `desktop-build.sh` | `npm ci`, build the workspace runtime packages, type-check + `vite build` of the desktop UI, then clippy/rustdoc/build/test `crates/desktop` | yes |
| `specs-lint.sh`    | markdownlint + cspell over `test-cases/**`         | no       |
| `contract-drift.sh`| regenerate TS bindings, JSON Schemas and gg's prompt templates, fail on diff | yes |
| `frozen-check.sh`  | `.frozen` test-case versions match their recorded digests | yes |
| `build-context.sh` | every Dockerfile `COPY` source — and every gg guest package, and every tree the workspace bakes in with `include_str!` — survives every `.dockerignore` allowlist that can apply to it | yes |

"Critical" scripts are the ones that catch a genuinely broken change (a crate or
front end failing to build or test), so they run on both CI systems. The lint
scripts run on Azure DevOps only.

`build-context.sh` is the only gate that can see a broken container build without
building one. `.dockerignore` is an **allowlist** (`*`, then explicit `!`
re-inclusions), so a `Dockerfile` that `COPY`s a path nobody re-included fails at
build time with `failed to compute cache key: "/path": not found` — and the image
builds run on a GitHub workflow that only fires on `master`/`staging`, long after
the commit that broke them. This script reads every tracked Dockerfile against every
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
program languages, and what a model is *told* each one's sandbox offers is a
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
*reflects* each arm — it **runs every arm's artifact build**, because what a
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
and provides the `log` helper.

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
