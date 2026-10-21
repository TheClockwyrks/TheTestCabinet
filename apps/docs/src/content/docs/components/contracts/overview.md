---
title: Overview
---

`contracts` is the hub of the [repositories](/development/repositories/): the
one library every other repository of the project may depend on, and the one
that depends on nothing of the project. Every shape two parties read or write,
and everything that keeps repositories in step, lives here, so an application
never depends on another application. The superrepo checks it out at
`contracts/`.

The repository holds these crates and packages:

| Crate or package                                                         | Holds                                                                                           |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `crates/contracts` (`test-cabinet-contracts`)                            | Every wire and file shape and its validation                                                    |
| `crates/suites` (`test-cabinet-suites`)                                  | The test-suite runtime and the manifest loaders                                                 |
| `crates/telemetry`                                                       | The OpenTelemetry plumbing every service uses                                                   |
| `crates/redact`                                                          | Secret scrubbing                                                                                |
| `crates/backend-client`                                                  | The backend's HTTP client over the contract types, used by the driver, CLI, arena and publisher |
| `crates/contract-codegen`, `crates/api-codegen`                          | The generators of the packages below                                                            |
| `packages/run-record`, `packages/asset-contract`, `packages/backend-api` | The TypeScript bindings and JSON Schemas                                                        |
| `packages/browser-driver` (private)                                      | The Playwright script the suites crate's browser calls run                                      |

## The contracts crate

A shape belongs in the contracts crate when more than one party reads or writes
it:

- The [run record](/components/contracts/run-records/) and every part of it:
  the subject and state, the normalized
  [events](/components/driver/events/), the validation summary, the
  [metrics](/components/contracts/metrics/), toolchain and code-analysis
  blocks, the [showcase](/components/driver/showcase/), and the names of the
  files and directories a run tree is made of.
- The asset contract: the rig and F-curve shapes a produced model is described
  by.
- The harness contract: gg's configuration, telemetry, session record and
  journal, and the display name of every `HarnessSlug`.
- The [review](/components/backend/results/) shapes, `merge_review_items`,
  which a resolved test case's checklist is built with, and the TCQ query
  shapes.
- A resolved test case version, the engine identity a run names, and the test
  suite format with its export and save rules.
- The job API and publish-job API wire types, the ingest API's request, report
  and feed, the reference lock format, the match-play shapes, the
  `AssetPreview` shape, and the cold storage root a checkout names.
- The constants the repositories agree on: `SEED_COMMIT_MESSAGE` and
  `IMPLEMENTATION_COMMIT_MESSAGE` (the seed commit's message and the message of
  the commit the driver makes at run end), the `RUN_IMAGE_OVERRIDE_ENVS` and
  `MODALITY_IMAGE` tables, the names of the environment variables redaction
  scrubs, the playable build's layout rules (`find_build_output`, the `proof_*`
  naming), the asset-reference key layout, and the `Writeup` a review is parsed
  from.

The crate holds data, the functions over it, and the reading and writing of the
files that data is stored in: a suite version's export, a partial suite tree,
the cold storage root. Anything that reaches a container, a process, the
network or a clock belongs to the repository that runs it. A method that needs
runtime is a trait with the same name and signature in the crate that holds the
runtime: the driver has `RunToolingExt::current` (the build's commit),
`RunStateExt::classify_failure` (over the driver's error) and
`HarnessEventExt::system` (stamped with the clock), each re-exported beside its
type.

The scoring rules over the review shapes are the
[backend](/components/backend/overview/)'s, and they have a TypeScript mirror,
`@clockwyrks/run-stats` in `ui-common`. The
[scoring goldens](/development/building/#the-scoring-goldens) under
`fixtures/scoring/` hold the two to the same cases.

Each owner defines its own error type over the shapes it uses; the crate
defines none that a caller is expected to match on.

## The suites crate

The test-suite runtime lives in `test-cabinet-suites`, which depends on the
contracts crate and on no other crate of this project, so the
[driver](/components/driver/overview/), the backend and The Spec Cabinet run
the same suite logic. It holds what reads a `test-suites` checkout and turns an
offered definition into something a run executes:

- the manifest loaders `test_case`, `test_case_group` and `test_suite`, with
  the validators and catalogs over them, and the color parsers `test_case`
  needs;
- the suite catalog, the lowering of a definition onto a test case version,
  previews, and `prompt`, which renders a definition's prompt;
- the engine catalog, which resolves a selection against a manifest table it is
  given;
- the resolver, the static server and browser driver, and the vitest runner a
  case's validator project and a suite's validator project run through;
- the content digests and labels an ingest keys a version by.

The suites crate names no engine table. The
[engines](/components/engines/overview/) repository publishes
`built_in_catalog`, which binds the suites crate's catalog to the authored
engines, so every part of the suites crate that checks a declared engine slug
takes the catalog as an argument, and a caller that needs the built-in catalog
takes it from `engines`. The authored catalog a suite definition's identity
collides with is the caller's, asked through `AuthoredLookup`.

The suites crate links no OpenTelemetry. Its browser driver calls (`capture`,
`drive_script` and `smoke_check`) take the function that names the current
span's `traceparent`, and a caller passes the telemetry crate's propagation.

## Telemetry, redaction and the backend client

`crates/telemetry` is the OpenTelemetry plumbing every service initializes:
the exporter, the resource attributes and the propagation of a trace across a
request. See [Observability](/development/observability/).

`crates/redact` scrubs secrets from text that leaves a run: the values of the
environment variables the contracts crate names, in the published repository,
the recorded logs and the event stream.

`crates/backend-client` is the one HTTP client of the backend's API, typed over
the contract shapes. The driver, the CLI, the arena and the publisher address
the backend through it, with the service token or the per-job token the caller
holds. The driver's own extensions of it, the renderer of a case's rendered
references and `materialize_version`, live in the driver.

## Generated packages

The TypeScript bindings and JSON Schemas are generated from the Rust types and
committed, and the repository's `contract-drift` gate holds them current:

- `@clockwyrks/run-record` and the schemas under `schema/`, generated by
  `contract-codegen` from the contracts crate alone through its `contract`
  feature;
- `@clockwyrks/asset-contract`, generated alongside it from the same types but
  kept in its own package, because the voxel and particle runtimes depend on it
  and are vendored into a model's workspace, which `run-record` never is;
- `@clockwyrks/backend-api`, generated by `api-codegen` over the API wire
  types, which is how the console and The Spec Cabinet address the backend
  without depending on it.

See [Generating the data
contract](/development/building/#generating-the-data-contract).
