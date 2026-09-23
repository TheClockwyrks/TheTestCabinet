# Extract gg into its own repository

This issue follows the v0.7.0 tag and
[`create-the-contracts-repo-and-move-the-shared-contracts-into-it.md`](create-the-contracts-repo-and-move-the-shared-contracts-into-it.md).
Move gg, its SDKs and its toolchains into the `gg` repository
(`git@ssh.dev.azure.com:v3/genyume/the-test-cabinet/gg`), keeping their history, and have The Test Cabinet consume gg as a
released binary.

## Current state

gg lives in `crates/gg`, with the guest artifact crates in
`crates/gg-sandbox-artifacts` and one SDK package per program language under
`packages/gg-sandbox*`. Building gg reflects a signature catalogue out of each
language's SDK, so every job that compiles it installs the eleven
program-language toolchains through `scripts/ci/install-gg-toolchains.sh` and
the per-language installers beside it. The devcontainer installs the same set.

The driver image builds gg from source in its `gg-build` stage and bakes the
binary, and the backend image bakes the reference documents that same stage
projects. `gg_exec.rs` in core resolves the gg release to download for a run
from `DEFAULT_RELEASE_VERSION`, which is core's own package version, and the
release checks that `gg --version` matches the tag.

gg's only source dependency on The Test Cabinet is the harness contract, which
the contracts issue moves out of core.

## Design

### The move

Extract the following into the gg repository with `git filter-repo`'s
subdirectory filtering so their history comes along: `crates/gg`,
`crates/gg-sandbox-artifacts`, every `packages/gg-sandbox*` package,
`scripts/ci/install-gg-toolchains.sh` and the per-language installers, the
`agent-prompts` and `gg-sdk-documentation` skills, the gg pages of the docs
site, and `tasks/gg-*`. gg depends on the contracts crate and on nothing else
of this project.

The gg repository gets its own Azure pipeline running its gates, and on a tag
it publishes the static-musl binaries for both architectures and the
`gg-reference` tarball to the blob container described in
[`publish-gg-release-binaries-to-azure-blob-storage.md`](done/publish-gg-release-binaries-to-azure-blob-storage.md).
It mirrors to GitHub as a plain source mirror after its gates.

### Consuming gg as a binary

The driver image's `gg-build` stage becomes a fetch of the pinned gg version
from the blob container, and the backend image fetches `gg-reference` for that
version the same way. `DEFAULT_RELEASE_VERSION` becomes a pinned gg version
declared in one place in core, independent of core's own version, and the
release gate compares the baked binary's `gg --version` against that pin. The
eleven program-language toolchains leave The Test Cabinet's CI and the
devcontainer, and the toolchain-hydration steps in `azure-pipelines.yml` go
with them.

## Done when

- [ ] The gg repository holds the moved trees with their history, builds
      against the contracts crate alone, and its pipeline publishes the
      binaries and reference tarball on a tag.
- [ ] The Test Cabinet's driver and backend images fetch the pinned gg
      version and no longer build gg from source.
- [ ] No program-language toolchain is installed by The Test Cabinet's
      pipeline or devcontainer.
- [ ] `gg_exec.rs` resolves the pinned version, and a cluster run records the
      same `subject.harnessVersion` it does today.
- [ ] `CLAUDE.md`, the architecture page and the driver docs point to the gg
      repository for the harness.
- [ ] Gates green in both repositories.
