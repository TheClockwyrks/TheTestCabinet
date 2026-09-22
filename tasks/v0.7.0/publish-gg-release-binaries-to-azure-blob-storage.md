# Publish gg release binaries to Azure Blob Storage

Publish the `gg` binaries and its reference tarball from the Azure pipeline to a
storage account container, and point the download path in core at that
container, so a gg release depends on nothing hosted on GitHub.

## Current state

The `gg` job of `.github/workflows/release.yml` builds static-musl `gg` for
`x86_64` and `aarch64`, builds `gg-reference-<version>.tar.gz` with
`gg reference --out`, and attaches all three to a GitHub release at the tag. It
also gates the release on `gg --version` equalling the tag.

`crates/core/src/gg_exec.rs` resolves the binary a run executes in order:
`TCAB_GG_BINARY`, the path the driver image bakes it at, and then a download
from `https://github.com/{repo}/releases/download/v{version}/gg-{target}`. The
download is shaped by `TCAB_GG_RELEASE_VERSION`, `TCAB_GG_RELEASE_REPO` and
`TCAB_GG_RELEASE_TARGET`, and `DEFAULT_RELEASE_VERSION` is core's own package
version. The driver image bakes `gg` and the backend image bakes the reference
documents at `/opt/gg-reference`, so the download serves runs launched outside
the cluster.

Nobody uses gg directly. The harness that succeeds it is what people will use,
so gg's artifacts need a host the pipeline can write to and nothing more.

## Design

### The upload

A job in the Azure pipeline runs on tag builds and on `master`. It builds both
targets and the reference tarball exactly as the GitHub job does, then uploads
them with `AzureCLI@2` under a workload-identity service connection holding
Storage Blob Data Contributor on one storage account.

The container is named `gg` and allows anonymous read. Objects are laid out as
`v<version>/gg-<target>` and `v<version>/gg-reference.tar.gz`, so a version's
artifacts sit together and a URL can be built from a version and a target
alone.

The version gate stays with the upload: `gg --version` must equal the tag with
its `v` stripped, and a mismatch fails the job naming `crates/gg` and
`crates/core` as the crates to bump.

### The download

`gg_exec.rs` builds its download URL from the container's base URL,
`v{version}/gg-{target}`. `TCAB_GG_RELEASE_URL` overrides the base URL and
replaces `TCAB_GG_RELEASE_REPO`. `TCAB_GG_RELEASE_VERSION` and
`TCAB_GG_RELEASE_TARGET` keep their meanings, and the resolution order is
unchanged.

### Documentation

The Releasing gg section of `development/releasing.md` describes the container
and its layout. `components/driver/overview.md` describes the resolution order
with the new variable.

## Done when

- [ ] A tag build uploads `gg-x86_64-unknown-linux-musl`,
      `gg-aarch64-unknown-linux-musl` and `gg-reference.tar.gz` under the tag's
      version prefix, readable without credentials.
- [ ] A tag build whose `gg --version` differs from the tag uploads nothing and
      fails naming the crates to bump.
- [ ] A run outside the cluster with no `TCAB_GG_BINARY` downloads gg from the
      container and executes it.
- [ ] `TCAB_GG_RELEASE_URL` redirects the download and `TCAB_GG_RELEASE_REPO`
      is gone from the code and the docs.
- [ ] The listed pages describe the container as gg's release host.
- [ ] Gates green.
