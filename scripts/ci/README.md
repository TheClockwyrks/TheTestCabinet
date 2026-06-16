# CI scripts

Shared validation scripts invoked by both CI systems:

- **Azure DevOps** (`azure-pipelines.yml`) is the primary CI and runs every
  script. It covers the Linux and Windows platforms.
- **GitHub Actions** (`.github/workflows/`) runs the critical subset so a green
  GitHub run still means the targeted v1.0 components actually build and pass. It
  also owns **macOS** validation, since Azure has no macOS agents — but because
  macOS runners are costly and only needed at release time, that check runs
  **on demand** in the separate `binary-macos.yml` workflow (manual trigger or
  release-invoked) rather than on every change.

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
| `rust-test.sh`     | `cargo build` + `cargo test` (CLI + core)          | yes      |
| `binary-smoke.sh`  | release-build, `cargo test --release`, run binary  | yes      |
| `web-build.sh`     | `npm ci`, type-check + `vite build` of the site    | yes      |
| `catalog-check.sh` | regenerate the catalog, fail if the dataset drifts | yes      |
| `specs-lint.sh`    | markdownlint + cspell over `test-cases/**`         | no       |

"Critical" scripts are the ones that catch a genuinely broken change (the CLI or
site failing to build or test), so they run on both CI systems. The lint scripts
run on Azure DevOps only.

`binary-smoke.sh` is the release gate that keeps a flat-out-broken binary from
ever being published: it builds `tcab` in the shipped release profile, runs the
suite in that profile, and smoke-runs the produced binary (`--version`,
`--help`, and that its subcommands are wired up) with no container runtime or API
keys required. It runs per platform — Azure on Linux and Windows continuously,
GitHub on macOS on demand (the `binary-macos.yml` workflow, triggered manually or
by the release pipeline) — so each target's binary is proven to build and start
before a release. The forthcoming downloadable-binary pipeline should require this
check green (and can reuse this script on its produced artifacts).

## Scope

These cover the two components targeted for v1.0: the `tcab` CLI (Rust `crates/cli`
and the `crates/core` library it builds on) and the gallery website (`apps/site`
and the `packages/run-record` it imports). The Tauri desktop app (`crates/desktop`,
`apps/desktop`) is intentionally **not** built yet, so CI runners do not need the
desktop app's system libraries. The Rust scripts pass `-p test-cabinet-core
-p test-cabinet-cli` rather than `--workspace` to keep the desktop crate out.

`lib.sh` is a sourced helper (not a standalone script): it resolves the repo root
and provides the `log` helper.
