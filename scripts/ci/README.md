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
| `rust-lint.sh`       | `cargo fmt --check`, `cargo clippy -D warnings`     | no       |
| `install-nextest.sh` | Install cargo-nextest pinned to `NEXTEST_VERSION`   | —        |
| `rust-test.sh`       | `cargo build` + `cargo nextest run` + doctests (headless crates) | yes |
| `binary-smoke.sh`    | release-build, `cargo nextest run --release` + doctests, run binary | yes |
| `smoke-binary.sh`  | run a built binary (`--version`/`--help`/commands) | yes      |
| `web-build.sh`     | `npm ci`, type-check + `vite build` of the front ends | yes   |
| `web-test.sh`      | `npm ci`, build the workspace runtime packages, `vitest run` across every workspace | yes |
| `desktop-build.sh` | `npm ci`, build the workspace runtime packages, type-check + `vite build` of the desktop UI, then clippy/rustdoc/build/test `crates/desktop` | yes |
| `specs-lint.sh`    | markdownlint + cspell over `test-cases/**`         | no       |
| `contract-drift.sh`| regenerate TS bindings + JSON Schemas, fail on diff | yes     |
| `frozen-check.sh`  | `.frozen` test-case versions match their recorded digests | yes |

"Critical" scripts are the ones that catch a genuinely broken change (a crate or
front end failing to build or test), so they run on both CI systems. The lint
scripts run on Azure DevOps only.

`install-nextest.sh` is a provisioning helper rather than a validation check
(hence no "Critical" mark): the Rust test scripts run the suite with
[cargo-nextest](https://nexte.st) (the repo's runner, configured in
`.config/nextest.toml`), which the devcontainer already ships but bare CI agents
do not, so every job that runs tests installs it first — pinned to
`NEXTEST_VERSION` so CI matches the devcontainer. It is cross-platform (Linux,
Windows, macOS) because `binary-smoke.sh` runs on all three. nextest does not
execute doctests, so the test scripts additionally run `cargo test --doc`.

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
