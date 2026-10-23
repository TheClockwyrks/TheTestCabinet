# The Local Backend Ingests Spec Cabinet Previews

Implement `TCAB_BACKEND_INGEST_PREVIEWS`, so a backend configured for local
development reads the previews The Spec Cabinet writes to the suites checkout's
`.previews/` folder, and enable it in the local k3d overlay.

## Current state

[Backend](../../apps/docs/src/content/docs/components/backend/overview.md)
documents the setting and
[Test Suites](../../apps/docs/src/content/docs/the-spec-cabinet/test-suites.md#previews)
documents the preview layout. Neither is implemented: `crates/backend/src/config.rs`
has no such field, and `deployments/k8s/overlays/local/patch-backend.yaml` sets
only `TCAB_BACKEND_CHECKOUT=/checkout` and `TCAB_BACKEND_ALLOW_EXPERIMENTAL=true`.

The local cluster mounts the repository read-only at `/checkout` through the
`cluster` target in `deployments/local/Makefile`, and the suites submodule is a
folder inside it. A file The Spec Cabinet writes into
`test-suites/.previews/` on the host is visible to the backend pod through that
mount.

This depends on
[`revised-layout-in-core-and-ingest.md`](revised-layout-in-core-and-ingest.md).

## Design

### Reading previews

A preview is a suite tree at `.previews/<slug>/v0.0.0-preview.<draft>/` beside a
copy of the suite manifest at `.previews/<slug>/suite.toml`.
`TestSuiteCatalog` gains a previews root it enumerates the same way it
enumerates `versions/`, and the backend passes `<checkout>/test-suites/.previews`
as that root when `TCAB_BACKEND_INGEST_PREVIEWS` is truthy.

Preview versions are ingested under the suite's slug with their prerelease
version string, so a preview definition's identity is `<slug>-<definition>` at
version `0.0.0-preview.<draft>`. A preview's `version.toml` declares
`experimental = true`, so a preview surfaces only where experimental versions
are allowed.

### Targeting and pruning

`<slug>@v0.0.0-preview.<draft>` targets one preview. A whole-catalog scan
enumerates previews along with exported versions when the setting is on.

A preview version removed from `.previews/` is pruned by the next whole-catalog
scan, under the same rule that keeps any version a stored run references. Runs of
a preview therefore stay resolvable for import after the preview is replaced.

### Deployments

The local overlay sets `TCAB_BACKEND_INGEST_PREVIEWS=true`. The Azure overlays
leave it unset, and `.env.backend.example` lists it commented out with a line
stating it belongs to local development.

## Done when

- [ ] With the setting on, a whole-catalog ingest and a targeted
      `<slug>@v0.0.0-preview.<draft>` ingest both store the preview's
      definitions.
- [ ] With the setting off, `.previews/` is never read.
- [ ] A preview definition is listed only where experimental versions are
      allowed.
- [ ] Replacing a preview and forcing its ingest serves the new content.
- [ ] A removed preview is pruned by a whole-catalog scan unless a stored run
      references it.
- [ ] The local overlay enables the setting, and a preview written on the host
      ingests into a running k3d backend without a pod restart.
- [ ] Gates green.
