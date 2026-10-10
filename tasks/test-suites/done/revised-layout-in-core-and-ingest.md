# Core And Ingest Read The Revised Suite Layout

Move the test suite format in `crates/core` onto the layout the docs now
specify: a suite manifest at `<slug>/suite.toml`, exported versions at
`<slug>/versions/v<x.y.z>/` each carrying a `version.toml`, and drafts at
`<slug>/drafts/<draft>/` that ingest skips.

## Current state

The format still assumes one flat folder per version, `<slug>/v<x.y.z>/`, whose
`suite.toml` carries both the suite identity and the version fields.

- `crates/core/src/test_suite/model.rs` `SuiteManifest` holds `slug`, `name`,
  `version`, `tags`, `summary`, `description`, `changelog`, and `experimental`
  together.
- `crates/core/src/test_suite/version.rs` reads `SUITE_MANIFEST_FILE`
  (`suite.toml`) from the version folder.
- `crates/core/src/test_suite/validation.rs` `validate_identity` checks the
  parent folder against `slug` and the folder against `v{version}`.
- `crates/core/src/test_suite/catalog.rs` `TestSuiteCatalog` walks
  `root/<slug>/<version>/suite.toml`.
- `crates/backend/src/ingest.suites.rs` resolves `suite_root` as
  `checkout/test-suites/<slug>/<version>`.
- `packages/run-record/src/test-suite.ts` is generated from the combined
  manifest.
- The only suite content is the fixture at
  `crates/core/src/testdata/test-suite/carom/v1.0.0/`.

A suite or definition that fails to resolve during ingest is logged and skipped
without an NDJSON event (`ingest.suites.rs`), so a client cannot see why a
version was absent from the report.

[Test Suites](../../apps/docs/src/content/docs/test-suites/overview.md) and
[Manifests](../../apps/docs/src/content/docs/test-suites/suite-manifest.md) are
authoritative for the layout.

## Design

### Two manifests

`SuiteManifest` carries `slug` and `name` and is read from `<slug>/suite.toml`.
A new `VersionManifest` carries `version`, `tags`, `summary`, `description`,
`changelog`, and `experimental` and is read from `version.toml` at the root of a
suite tree. A folder in the checkout is a suite exactly when it holds
`suite.toml`.

The version tree loader takes the suite manifest and a suite tree path, so the
same loader reads an exported version, a draft, and a preview. Identity
validation checks `suite.toml`'s `slug` against the suite folder, and an exported
version's `version` against its `v<x.y.z>` folder name.

### The catalog

`TestSuiteCatalog` enumerates `<slug>/versions/v<x.y.z>/` for every suite folder
holding a `suite.toml`. It reads nothing under `drafts/`. The display name every
lowered definition reports comes from the suite manifest, so renaming a suite
applies to each of its exported versions.

Lowering, prompt rendering, and the suite store resolve paths through the
catalog's suite tree path, so no module outside the catalog composes a version
folder path itself.

### Ingest

`ingest.suites.rs` resolves suite trees through the catalog. Targets keep their
spelling: a bare suite slug expands to every exported version, and
`<slug>@v<x.y.z>` names exactly one.

A suite version or definition that fails to resolve emits an NDJSON `version`
event carrying `ingested: false` and a `problem` message naming the file and the
failure, and the version counts toward `skipped`. The event shape change is
documented in the backend
[API](../../apps/docs/src/content/docs/components/backend/api.md) page.

### Fixtures and generated types

The carom fixture moves to `testdata/test-suite/carom/suite.toml` plus
`carom/versions/v1.0.0/version.toml`. A draft fixture at
`carom/drafts/main/` exercises the rule that the catalog skips drafts. The
`@clockwyrks/run-record` test-suite module is regenerated so it exports both
manifests.

`crates/cli/src/catalog.rs` resolves suite cases for `tcab validate` through the
same catalog.

## Done when

- [ ] `suite.toml` holds only `slug` and `name`, and `version.toml` holds the
      version fields, in the core model and in the generated TypeScript types.
- [ ] The catalog lists exported versions from `<slug>/versions/v<x.y.z>/` and
      lists nothing from `drafts/`.
- [ ] A folder without `suite.toml` is not a suite.
- [ ] Identity validation reports a `suite.toml` slug that differs from its
      folder and a `version.toml` version that differs from its folder.
- [ ] `POST /ingest` ingests the fixture's exported version, both whole-catalog
      and targeted as `carom@v1.0.0`, and a whole-catalog scan still prunes.
- [ ] A suite version that fails to resolve appears in the NDJSON stream with
      its problem message.
- [ ] `tcab validate` resolves a suite case from the revised layout.
- [ ] Every test under `crates/core/src/test_suite/`,
      `crates/backend/src/ingest.suites.test.rs`, and `crates/cli` reads the
      revised fixture.
- [ ] Gates green.
