---
title: "Overview"
---

Test Suites are how The Test Cabinet handles specifying workloads that can be
used as test cases. Each test suite represents a single project that may be used
as a test case, but allows a project to be used as multiple different types of
test cases. All test suites are authored by The Spec Cabinet and executed by
The Test Cabinet.

The most common configuration for a test suite is to expose the project as a
full stack test case, end to end test case, and as one or more asset generation
test cases. This allows test suites to be quickly authored, as the test suite
can first be defined as a full stack test case. That full stack test case can
then be executed one or more times via The Test Cabinet to produce a full asset
set, before the suite is complete enough to export. Those assets can then be
extracted and bundled with the test suite to allow it to operate as an end to
end test case. Each asset requires a specification as
part of the full stack test case, which means that test suites that support
being run as a full stack test case can offer one asset generation test case per
asset without authoring further specifications.

## Repository

Test suites are authored in their own repository, which The Test Cabinet
includes as a git submodule checked out at `test-suites/`. Suite definitions and
The Test Cabinet release on independent cadences, and a suite only needs a Test
Cabinet release when it calls for functionality that does not exist yet.

Each suite is a folder named by its slug, holding the drafts The Spec Cabinet
authors and the versions exported from them:

```text
<slug>/suite.toml                          # the suite manifest
<slug>/drafts/<draft>/                     # an editable, possibly incomplete suite tree
<slug>/versions/v<major>.<minor>.<patch>/  # an exported, complete suite tree
.previews/                                 # uncommitted previews of drafts
```

The Test Cabinet ingests [exported versions](#exported-versions) and never reads
a [draft](#drafts). A backend can be configured to also read the
[previews](#previews) under `.previews/`. The Test Cabinet never writes the
checkout.

## Structure

Test suites consist of the following entities:

- [Manifests](/test-suites/suite-manifest/): The suite manifest declares the
  suite's identity, and each version manifest declares a version and the prose
  describing it.
- [Test Case Definitions](/test-suites/test-case-definition/): Test case
  definitions describe what test cases are offered using the test suite's data,
  and declare how each one is seeded, built, and checked.
- [Specifications](/test-suites/specifications/): These describe what must be
  implemented.
- [Validators](/test-suites/validators/): Validators perform automated
  validation of an implementation's code.
- [Debug API](/test-suites/debug-apis/): A test suite defines a debug API when
  it defines a test case whose subject is an implementation the model wrote, so
  that its validators can drive and read that implementation.
- [Demonstrations](/test-suites/demonstrations/): Demonstrations are small
  playable builds showing what a specification's mechanic looks like in
  practice.
- [Assets](/test-suites/assets/): Assets are the produced files a suite bundles
  so that it can run as an end to end test case, and the subjects of its asset
  generation test cases.
- [Reference Implementations](/test-suites/reference-implementations/):
  Reference implementations demonstrate that the test suite is implementable and
  allow users to see what the test suite is intended to look like when
  implemented.
- [Showcase](/test-suites/showcase/): Showcase data is used by The Test Cabinet
  to demonstrate what the test suite is.

## On-disk layout

A draft folder and an exported version folder hold the same layout, called the
suite tree. Every path named on these pages is relative to the suite tree. A
suite tree is self-contained, and every path a suite file names resolves inside
the tree that declares it.

```text
  version.toml
  description.md
  changelog.md
  debug-api.toml                # when a test case's subject is a model-written build
  debug-api/<path>.toml
  assets/<asset-id>/asset.toml
  assets/<asset-id>/<asset files>
  demos/shared/
  demos/<slug>/demo.toml
  demos/<slug>/index.html
  demos/<slug>/src/
  prompts/<name>.hbs
  reference-implementations/<engine>/
  showcase/showcase.toml
  showcase/showcase.md
  showcase/<media files>
  specifications/<name>/specification.toml
  specifications/<name>/specification.md
  test-cases/<name>.toml
  validators/vitest.config.ts
  validators/<path>.ts
  validators/<path>.test.ts
  workspaces/<slug>/
```

| Path                         | Holds                                                                  | Documented by                                                        |
| ---------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `version.toml`               | The version's identity and the prose describing it                     | [Manifests](/test-suites/suite-manifest/)                            |
| `description.md`             | Site-facing prose describing the suite                                 | [Manifests](/test-suites/suite-manifest/)                            |
| `changelog.md`               | What changed in this suite version                                     | [Manifests](/test-suites/suite-manifest/)                            |
| `debug-api.toml`             | The surface validators drive and observe a model-written build through | [Debug API](/test-suites/debug-apis/)                                |
| `debug-api/`                 | One file per module of the debug API tree                              | [Debug API](/test-suites/debug-apis/)                                |
| `assets/`                    | One folder per bundled asset, each with an `asset.toml`                | [Assets](/test-suites/assets/)                                       |
| `demos/`                     | The shared demonstration library and one folder per demonstration      | [Demonstrations](/test-suites/demonstrations/)                       |
| `prompts/`                   | Handlebars prompt templates referenced by test case definitions        | [Test Case Definitions](/test-suites/test-case-definition/)          |
| `reference-implementations/` | A complete buildable project per engine                                | [Reference Implementations](/test-suites/reference-implementations/) |
| `showcase/`                  | Player-facing prose, the carousel, and its media                       | [Showcase](/test-suites/showcase/)                                   |
| `specifications/`            | Specification prose and the requirements derived from it               | [Specifications](/test-suites/specifications/)                       |
| `test-cases/`                | One test case definition per file                                      | [Test Case Definitions](/test-suites/test-case-definition/)          |
| `validators/`                | One Vitest project holding the validators and their own tests          | [Validators](/test-suites/validators/)                               |
| `workspaces/`                | The starter workspaces runs are seeded with                            | [Test Case Definitions](/test-suites/test-case-definition/)          |

Specification folders nest freely. A folder is a specification folder if and
only if it holds a `specification.toml`, and every file inside a specification
folder belongs to that specification alone.

## Identity and versioning

A suite's `<slug>` is kebab-case, matches its directory name, and is declared by
its `suite.toml`. An exported version lives at `<slug>/versions/v<version>/`, and
its `version.toml` declares the same version, so `version = "1.0.0"` lives in
`versions/v1.0.0/`.

The invariants on these pages describe a complete suite, and every exported
version satisfies all of them. A draft may break any of them while it is being
authored, and is exported only once it satisfies all of them.

Suites are versioned independently of the test cases they define. An exported
version is a frozen unit: its specifications, validators, assets, and test case
definitions move together, and changing any of them produces a new exported
version.

## Drafts

A draft is a named, editable state of a suite, stored at
`<slug>/drafts/<draft>/`. Its name is a kebab-case slug matching its folder,
unique within the suite. Drafts are independent of each other, so an edit to one
draft leaves every other draft and every exported version as it was. A draft
folder holds the suite tree plus a `draft.toml`:

```toml
# <slug>/drafts/<draft>/draft.toml
base = "1.0.0"  # the exported version this draft follows (optional)
```

- `base` names the exported version the draft's changes are measured against.
  It decides which version numbers the draft may export as and which version
  the draft is compared with. A draft that declares no base is base-less.

A draft may be incomplete in any way: any key the format requires may be absent,
any reference may name an entity that has not been authored, and any folder may
be empty. A draft's problems are exactly what stands between it and an export.

Problems never block a save. A change to a draft is refused only when it cannot
be represented in a draft at all, which is when it would write to an exported
version, declare an identifier that is not kebab-case or that duplicates another
identifier in the same file, or name a path that resolves outside the draft
folder. Every other rule on these pages is an export rule.

## Exported versions

An exported version is the immutable result of exporting a draft, stored at
`<slug>/versions/v<major>.<minor>.<patch>/`. It is a copy of the draft folder
without `draft.toml`, with `version` written into its `version.toml`, committed
and tagged `<slug>-v<major>.<minor>.<patch>` in the test suites repository. An
exported version is never edited: it is changed by creating a draft from it and
exporting that draft as a new version.

Exported versions are the only committed suite states The Test Cabinet ingests,
and every exported version satisfies every invariant stated on these pages.

A version number is chosen by how it relates to the draft's base. A base-less
draft of a suite with no exported versions exports as `0.1.0` or `1.0.0`, and a
draft with a base increments its major, minor, or patch, so base `1.4.2` exports
as `2.0.0`, `1.5.0`, or `1.4.3`. The resulting number must be free within the
suite.

## Previews

A preview makes a draft runnable in the local development stack before the draft
is complete, so its full stack test case can be run and the assets it produces
collected. A test case definition is complete when neither it nor any entity it
references carries a problem. A preview holds a draft's complete test case
definitions and every entity they reference, and a draft with no complete
definition cannot be previewed.

A preview of draft `<draft>` is written to the checkout as:

```text
.previews/<slug>/suite.toml                     # a copy of the suite manifest
.previews/<slug>/v0.0.0-preview.<draft>/        # the preview's suite tree
```

Its `version.toml` declares version `0.0.0-preview.<draft>` and
`experimental = true`, and the local backend is asked to ingest it with `force`.
Previewing the same draft again replaces the previous preview.

The test suites repository ignores `.previews/`, so previews are never committed
and never reach a deployment. A backend reads previews only when
`TCAB_BACKEND_INGEST_PREVIEWS` is set, as described in
[Backend](/components/backend/overview/#test-case-definitions).
