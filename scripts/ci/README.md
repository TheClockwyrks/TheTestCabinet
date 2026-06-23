# CI scripts

Shared validation scripts invoked by both CI systems:

- **Azure DevOps** (`azure-pipelines.yml`) is the primary CI and runs every
  script. It covers the Linux and Windows platforms.
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

| Script             | Checks                                             | Critical |
| ------------------ | -------------------------------------------------- | -------- |
| `rust-lint.sh`     | `cargo fmt --check`, `cargo clippy -D warnings`    | no       |
| `rust-test.sh`     | `cargo build` + `cargo test` (headless crates)     | yes      |
| `binary-smoke.sh`  | release-build, `cargo test --release`, run binary  | yes      |
| `smoke-binary.sh`  | run a built binary (`--version`/`--help`/commands) | yes      |
| `web-build.sh`     | `npm ci`, type-check + `vite build` of the front ends | yes   |
| `specs-lint.sh`    | markdownlint + cspell over `test-cases/**`         | no       |
| `contract-drift.sh`| regenerate TS bindings + JSON Schemas, fail on diff | yes     |

"Critical" scripts are the ones that catch a genuinely broken change (a crate or
front end failing to build or test), so they run on both CI systems. The lint
scripts run on Azure DevOps only.

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

## Scope

These cover every **headless** component. On the Rust side that is the whole
Cargo workspace except the Tauri desktop shell — the `tcab` CLI (`crates/cli`),
the `tcab-backend` (`crates/backend`) server, the run-topology services
(`tcab-dispatcher`, `tcab-driver`, `tcab-artifacts`), and the
`crates/core`/`crates/telemetry` libraries they share. On the TypeScript
side it is the front ends built by `web-build.sh`: the gallery (`apps/site`), the
operator web console (`apps/web`), and these docs (`apps/docs`), all on top of
`packages/run-record` and the source-consumed `packages/ui`.

The Tauri desktop app (`crates/desktop`, `apps/desktop`) is deliberately **not**
built by these per-change CI scripts, so their runners do not need the desktop
app's GUI system libraries. The Rust scripts therefore pass
`--workspace --exclude test-cabinet-desktop` rather than a bare `--workspace`; the
one excluded crate is the only one with that dependency. The desktop app is built
and bundled for every platform in the GitHub Release workflow
(`.github/workflows/release.yml`) instead.

`lib.sh` is a sourced helper (not a standalone script): it resolves the repo root
and provides the `log` helper.
