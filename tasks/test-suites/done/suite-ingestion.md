# The Backend Ingests Test Suites

Ingest discovers the suites tree in the checkout, lowers every suite-defined test
case into the definition store beside an authored case, and serves both the
suite-derived versions and the suite's own entities to the console and the
driver.

## Current state

`crates/backend/src/ingest.rs` builds a `TestCaseCatalog` over
`checkout.join("test-cases")` for group membership validation, for
`version_targets`, and for `ingest_version`, and lowers each resolved
`TestCaseVersion` into the `Stored` tree written by `build_version`.

`crates/backend/src/store.rs` owns the
`<store>/test-cases/<slug>/<version>/` key space, the `.tcab/manifest.json`
resolved manifest, `STORE_FORMAT`, and `needs_reingest`.
`crates/backend/src/api/ingest_api.rs` serves `POST /ingest` with its NDJSON
progress feed and an `IngestBody` carrying `testCases`, `force` and
`catalogVersion`. `crates/backend/src/api/test_cases.rs` serves the catalog,
version resolution, artifacts, specs and references, and gates experimental
versions on `state.config.allow_experimental`.

Nothing reads `test-suites/`.

The ingest contract and the definition store are specified by
[Backend](../../apps/docs/src/content/docs/components/backend/overview.md), read
alongside the suite layout in
[Test Suites](../../apps/docs/src/content/docs/test-suites/overview.md).

## Design

### Discovery and lowering

Ingest scans `checkout/test-suites` for `<slug>/v<major>.<minor>.<patch>/`
folders holding a `suite.toml`, and enumerates the definitions each version
declares under `test-cases/<name>.toml`. Every definition resolves through the
suite catalog in core, which hands back the same `TestCaseVersion` an authored
case resolves to, so `build_version` lowers it into the identical `Stored` tree
through one lowering path.

The files a version's entities reference are copied into the stored version the
way an authored version folder is copied today, covering the starter workspaces,
the prompt templates, the rendered specification documents, the asset files, the
validator project, and the debug API declaration. The driver then fetches each
of them by store-relative key through the existing artifact and materialization
endpoints.

Bump `STORE_FORMAT` so an existing local store re-ingests rather than serving
records written before the suite coordinate existed.

### Identity and the store key space

Suite-derived versions live in the existing `<store>/test-cases/<slug>/<version>/`
key space under the identity [`suite-catalog-in-core.md`](suite-catalog-in-core.md)
fixes, so `resolve_version`, the artifact routes and run materialization serve a
suite-defined case through the fetch family they serve an authored one through.

Record the suite coordinate on the stored manifest, naming the suite slug, the
suite version, and the definition slug the version was lowered from, and serve it
on the catalog listing entry and on version resolution so the console groups
suite-derived cases under their suite. An authored case carries no coordinate,
which is how a client tells the two apart.

The suite's own entities are stored under a sibling
`<store>/test-suites/<slug>/<version>/` key space holding the validated manifest,
the suite prose, the changelog, the specifications with their requirements, the
definitions, the demonstrations, the reference implementations, the assets, and
the showcase, each written as the resolved record the read endpoints serve
directly.

### Targeting

Extend `version_targets` so an entry names a suite or a single suite version in
addition to a case id and an `id@version`. A suite entry expands to every
definition of every version the suite declares, and a suite-version entry
expands to every definition of that one version. The existing entry forms keep
resolving against the authored catalog, and an entry matching neither tree
resolves to the error it resolves to today.

A whole-catalog scan enumerates the authored catalog and the suites tree
together, so its prune sees every declared version and a suite version deleted
from the checkout is dropped from the store under the same protected-case rule,
taking the stored suite version with it.

`scripts/reingest.sh` hard-codes the authored path shapes for change detection
and gains the suite layout: a candidate is also a suite slug, and a changed
`test-suites/<slug>/v<version>/` contributes that suite version as a target.

### Suite read endpoints

Add a listing endpoint serving every ingested suite with the versions it holds,
each version's name, summary, tags and experimental flag, gated on
`allow_experimental` the way the test case catalog is gated.

Add per-version read endpoints keyed by suite slug and suite version, covering
the manifest's identity, the suite prose, the changelog, the specifications with
their requirements and the validator paths each requirement claims, the
definitions, the demonstrations, the reference implementations, the assets, and
the showcase. Add byte-serving routes for showcase media and asset files,
resolved inside the stored suite version and serving only a path that stays
inside it.

These read the store rather than the checkout, so a deployment whose checkout is
absent still serves what it ingested. The surfaces consuming them are
[`test-suites-tab.md`](test-suites-tab.md) and
[`suite-detail-surfaces.md`](suite-detail-surfaces.md).

### Out of scope

Ingest reads the suites tree as The Spec Cabinet saved it. Authoring a suite
belongs to `tasks/spec-cabinet/`, extracting a run's produced assets back into a
suite belongs to a later pass, and the agentic harness writes nothing this issue
reads.

## Depends on

- [`test-suites-submodule.md`](test-suites-submodule.md)
- [`suite-catalog-in-core.md`](suite-catalog-in-core.md)

## Done when

- [ ] A suite version in the checkout ingests, and each of its definitions
      appears in the catalog carrying its suite coordinate.
- [ ] A second scan over an unchanged suite version reports it skipped, and
      `force` re-ingests it.
- [ ] A store stamped with the previous `STORE_FORMAT` reports unready on
      `/readyz`, and the next scan re-ingests the whole catalog.
- [ ] An ingest naming a suite expands to every definition of every version it
      declares, and one naming a suite version expands to that version alone.
- [ ] A whole-catalog scan prunes a suite version the checkout no longer
      declares, and keeps one a stored run references.
- [ ] Version resolution serves a suite-derived version's manifest, artifacts
      and specs through the routes an authored version uses.
- [ ] The listing endpoint serves every ingested suite with its versions, and
      omits an experimental suite unless `TCAB_BACKEND_ALLOW_EXPERIMENTAL` is
      set.
- [ ] The per-version endpoints serve the manifest, prose, changelog,
      specifications with their requirements and validator claims, definitions,
      demonstrations, reference implementations, assets and showcase.
- [ ] The byte routes serve a showcase media file and an asset file, and refuse a
      path resolving outside the stored suite version.
- [ ] `scripts/reingest.sh` detects a change under `test-suites/` and targets the
      affected suite version.
- [ ] Gates green.
