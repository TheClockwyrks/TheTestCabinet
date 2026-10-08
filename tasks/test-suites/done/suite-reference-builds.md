# Suite Reference Implementations Are Playable In The Test Cabinet

Store a built reference implementation for each engine of an ingested suite
version, serve it, and play it from the web console's suite and test case
surfaces.

## Current state

[Reference Implementations](../../apps/docs/src/content/docs/test-suites/reference-implementations.md)
states that every reference implementation is published with its suite and may
be played in The Test Cabinet's UI. Nothing implements that for suites.

- Suite lowering sets `reference_impls` to an empty map
  (`crates/core/src/test_suite/lowering.rs`).
- The suite store records engine names only (`crates/backend/src/suite_store.rs`),
  and ingest deliberately leaves the implementation files out
  (`crates/backend/src/ingest.suites.rs`).
- Legacy test cases reach the console through `tcab publish-reference`, which
  deploys a build to Cloudflare Pages and records it in
  `test-cases/reference-builds.lock.json`. On every ingest,
  `reconcile_reference_builds` in `crates/backend/src/api/ingest_api.rs` loads
  that lockfile into `case_reference_build`, and
  `packages/ui/src/app/components/PlayableEmbed.tsx` plays it.
- `tasks/test-suites/done/suite-detail-surfaces.md` left playing a reference
  build to a later pass.

The backend has no Node toolchain for building a project, and ingest should stay
a copy rather than a build. The Spec Cabinet already builds and verifies a
reference implementation on the development machine, so it uploads the
verified build.

## Design

### Upload

`PUT /suites/{slug}/versions/{version}/reference-builds/{engine}` accepts a
gzipped tar of a static build. The backend refuses an engine the version's
definitions do not declare and a version it has not ingested. It unpacks into
the definition store beside the suite record at
`suites/<slug>/<version>/reference-builds/<engine>/`, replacing any previous
upload for that engine atomically.

The route takes the same authorization as `POST /ingest`. Uploads to preview
versions are accepted, so a reference implementation can be played from a
preview.

A whole-catalog prune that drops a suite version drops its reference builds with
it.

### Serving

`GET /suites/{slug}/versions/{version}/reference-builds/{engine}/{*path}` serves
the unpacked build with the content types and index fallback the artifact
service uses for a run's `build/`. The suite detail response and each lowered
definition's version detail list the engines with an uploaded build, alongside
the URL each is played at.

### Console

The suite detail surface and a suite-defined test case's version page show one
Reference entry per uploaded engine, played through `PlayableEmbed` exactly as a
legacy reference build is. An engine with no uploaded build is listed without a
play action.

The route and response changes are documented in the backend
[API](../../apps/docs/src/content/docs/components/backend/api.md) page, and the
console behaviour in the
[web console](../../apps/docs/src/content/docs/components/web/overview.md)
overview.

### Out of scope

The Spec Cabinet side that builds, verifies, and uploads belongs to
`tasks/spec-cabinet/publish-to-the-local-cluster.md`. Serving these builds from
the public site's snapshot belongs to a later pass.

## Done when

- [ ] Uploading a build for a declared engine of an ingested suite version
      stores it, and a second upload replaces it.
- [ ] Uploads for an undeclared engine or an uningested version are refused
      with a message naming the reason.
- [ ] The served build loads in a browser from the backend route with correct
      content types.
- [ ] Suite detail and suite-defined version detail list each uploaded engine
      and its URL.
- [ ] The web console plays an uploaded suite reference build on the suite page
      and on the test case version page.
- [ ] Pruning a suite version removes its reference builds.
- [ ] Verified on the local k3d stack by uploading a build and playing it from
      the console.
- [ ] Gates green.
