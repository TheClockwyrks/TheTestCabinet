# A Suite-Defined Test Case Runs On The Local Cluster

Close the loop: a suite saved to disk by The Spec Cabinet is ingested into the
local k3d stack, and a run of one of its test cases completes on the cluster with
requirement outcomes recorded.

## Current state

`deployments/local/Makefile`'s `local-up` runs `cluster`, `images`,
`run-images`, `apply-overlay`, `local-ingest`, and `apply-wait`. The `cluster`
target mounts the repository at `/repo` on the server node, and the local
overlay's `patch-backend.yaml` mounts that at `/checkout` and points
`TCAB_BACKEND_CHECKOUT` at it. `local-ingest` waits for a running `tcab-backend`
pod, holds an ephemeral port-forward on `8787`, and runs `scripts/reingest.sh`,
whose change detection walks the test-case and game-jam version folders.

`crates/dispatcher` claims a queued run and creates one driver Job, knowing
nothing about definitions. `crates/driver/src/run.rs` calls
`materialize_version`, which is `crates/core/src/backend_client.rs` fetching the
resolved version, the prompt template, the specification sources, the assets, the
starter workspace files, and the references by store-relative key into the
per-job definition store. `crates/core/src/harness.rs` `resolve_run_image`
selects the run image from the test type, asset kind, asset dimension, and
harness, against the images `containers/` builds.

[Running](../../apps/docs/src/content/docs/development/running.md) is
authoritative for the local stack and the ingest step, read alongside the
[driver](../../apps/docs/src/content/docs/components/driver/overview.md) and
[dispatcher](../../apps/docs/src/content/docs/components/dispatcher/overview.md)
overviews.

## Design

### The checkout the cluster ingests

The suites checkout is a path inside the mounted repository, so the backend
reaches a suite at `/checkout/test-suites/<slug>/v<x.y.z>/` through the
`TCAB_BACKEND_CHECKOUT` value the local overlay already sets. `local-up` ingests
it as part of `local-ingest`, and a re-ingest after an edit picks the change up,
so editing a suite in The Spec Cabinet and re-ingesting is the whole development
loop.

`scripts/reingest.sh` extends its change detection over the suites tree, treating
a suite version folder the way it treats a test-case version folder. A suite
version with no file newer than the baseline is skipped, `--force` ignores the
baseline, and a whole-catalog scan still prunes. A suite version is targetable by
its slug the same way a case is.

The ingest request shape and the backend's own scan belong to
[suite ingestion](suite-ingestion.md).

### Materialization of a suite-derived version

`materialize_version` fetches everything a suite-derived version references, so
the driver's definition store holds the same inputs a locally-checked-out case
gives it. That covers the rendered prompt template, the rendered specification
documents the definition's `specifications` key selects, the starter workspace
files for the selected engine, the suite's bundled assets for an end-to-end
definition, and the validator project the requirement outcomes come from.

The resolved version's path fields point at the materialized copies, as they
already do for a test case. A suite-derived version that references a file the
store cannot serve fails the run in setup with the missing key named.

### The run image

A faithful mapping from the suite's test case type, and for an asset-producing
definition its asset kind, resolves to an image `containers/` already builds, so
`local-up`'s `run-images` has already imported whatever a suite-defined run
resolves. An end-to-end definition resolves the base-wasm image, and an
asset-producing definition resolves the image for its kind.

A suite-defined run enqueues, claims, dispatches, and records through the
existing job row and the existing launch identity, leaving the coverage and
comparison surfaces untouched by this issue.

### Seeding, building, and judging

The seeded workspace holds the starter workspace the definition's `[workspaces]`
table names for the selected engine, plus the rendered specifications under
`specs/` at each specification's declared `path`. The rendered prompt is handed
to the harness rather than seeded.

The definition's `[toolchain]` commands run over the produced implementation,
with a non-zero `typecheck` rating the run broken and the rest recorded. The
`[build]` commands produce the static build, and the validator stage runs the
suite's Vitest validator project against it, recording a requirement outcome per
requirement. The outcome rules themselves belong to
[requirement outcomes](requirement-outcomes-from-validators.md).

An asset-producing definition takes a different path through both seeding and
judging. It seeds the specifications alone, produces the asset its type table
names, and is graded by review against that asset's specification.

### Verification

Verification is an actual run on the cluster. Bring the stack up with
`make -C deployments/local local-up`, forward the data plane, and launch from the
console and from `tcab`, so both launch paths are covered against the same
ingested suite.

## Done when

- [ ] `local-up` ingests a suite from the mounted checkout.
- [ ] `scripts/reingest.sh` re-ingests a suite version whose files changed, and
      skips one that did not.
- [ ] A suite-derived version materializes every file the driver needs into the
      definition store, and names the missing key when one cannot be served.
- [ ] A suite-defined end-to-end run resolves a run image the local cluster
      already holds.
- [ ] A suite-defined end-to-end run seeds its starter workspace and its
      rendered specifications, and the harness receives the rendered prompt.
- [ ] The definition's toolchain and build commands run, with their outcomes
      recorded and a non-zero `typecheck` rating the run broken.
- [ ] A run of a suite-defined end-to-end case completes and records a
      requirement outcome per requirement the definition covers.
- [ ] A run of an asset-producing definition completes and records its produced
      asset.
- [ ] A run launched from the web console and one launched from `tcab` both
      complete against the same ingested suite version.
- [ ] The run record of each reads back through the web console.
- [ ] Gates green.
