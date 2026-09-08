---
title: Public Snapshot
---

The public snapshot is the document half of the public dataset. The backend
uploads a published run's record, its events, and all media to a public
Cloudflare R2 bucket, and the [gallery](/components/site/serving/) fetches those
objects by key. The index half is the [public
projection](/components/backend/projection/), whose rows name these objects.
This page is the authoritative contract for the bucket's layout.

A run's projection row carries every headline figure a listing needs, so ranking
and paging the published set costs no document fetch: outcome, functional
rating, aesthetic rating, whether the run is validator-rated, and score.

The bucket holds documents for published runs. A produced run that has not been
published is private, and a run that can never be published, such as an
infrastructure failure or a [`canceled`](/components/core/run-records/#status)
run, has no document here. The [gg document corpus](#the-gg-document-corpus) is
the one exception, and it is redacted rather than gated on publication.

## Content addressing

Every object's key carries a digest of its content, so a key changes only when
the bytes do. A publish computes each key and uploads only the objects the
bucket does not already hold, issuing those uploads concurrently.

An object at a given key is immutable, so the gallery and the browser cache it
indefinitely, and a projection row naming a key always names complete content.
Writing media once also lets a publish keep a run's media after the volumes the
bytes were read from are gone.

## Keys

```text
documents/runs/<run-id>/<digest>.json
documents/cases/<slug>/<version>/<digest>.json
documents/comparisons/<id>/<digest>.json
documents/gg-runs/<digest>.json
media/runs/<run-id>/proof/<file>
media/runs/<run-id>/asset/<file>
media/runs/<run-id>/validation/<file>
media/runs/<run-id>/showcase/<file>
media/runs/<run-id>/code-analysis/v<generation>.json
media/cases/<slug>/<version>/references/<scope>/<digest>-<view>.png
media/cases/<slug>/<version>/validation-baseline/<engine>/<variant>/<digest>-<file>
media/cases/<slug>/<version>/showcase/<variant>/<digest>-<file>
files/cases/<slug>/<version>/workspace/<digest>-<basename>
pfp/<account-id>
```

`<scope>` is `_common` for a reference shown on every variant, or a variant slug
for one scoped to that variant.

A key carries a digest of the document's own bytes and cannot be composed from
the run id, so the projection row naming a key is the only supported way to
reach a document. Every document carries a `schemaVersion`, currently `2`.

## Run documents

The full [run record](/components/core/run-records/) blob, verbatim, with its
links populated, plus the array of [reviews](/components/core/results/#reviews)
and the run's links. Every run here is published, so the document carries no
publication flag. Each review entry includes the reviewer's id and display name,
and the key of their [profile picture](#reviewer-pictures) when they have one.

A legacy run's score and functional rating are computed from this array, and any
run's aesthetic rating is the worst run-wide tier across its reviews. A
validator-rated run's figures start from the verdicts on its record and case
version: each review's effective checklist is the validators' verdicts overlaid
with that review's overrides, the run's score is the average of its reviews'
effective scores and its functional rating the worst of their effective ratings,
and the validators' own figures stand while the run has no reviews.

A validator-rated review entry carries its run-wide `aesthetic` tier and, in
`checklist`, only the verdicts it overrides. A reader resolves a review's tier
as `aesthetic` when set, falling back to the worst tier in a per-domain
`aesthetics` array when that is what the entry carries.

When the run captured a normalized [event
stream](/components/core/events/) it is included as `events`. Only the
normalized stream is published.

This document is published to the open internet, so any provider-shaped `sk-…`
token anywhere in the record or events is replaced with `[REDACTED]` before
upload. The backend never holds a key value, so it redacts by shape. Only this
public export is rewritten. The backend's own stored copy is left intact.

```jsonc
{
  "schemaVersion": 2,
  "record": { "…": "full RunRecord, links populated" },
  "reviews": [
    {
      "reviewerId": "acct_7yq…",
      "reviewer": "Ada",
      "pictureKey": "pfp/acct_7yq…",
      "ratings": [
        { "domain": "single-player", "rating": "great" },
        { "domain": "versus", "rating": "scuffed" },
      ],
      "writeup": "Plays well, but the AI paddle…",
      "checklist": [],
      "reviewedAt": "2026-06-21T18:00:00Z",
    },
    {
      "reviewerId": "acct_3kd…",
      "reviewer": "Bao",
      "aesthetic": "amazing",
      "checklist": [
        {
          "id": "controls.ai",
          "status": "fail",
          "note": "Precondition unmet.",
        },
      ],
      "writeup": "Gorgeous art; overrode one point whose precondition was unmet.",
      "reviewedAt": "2026-08-24T09:00:00Z",
    },
  ],
  "links": {
    "sourceRepo": "https://github.com/…",
    "playableBuild": "https://abc123.test-cabinet-runs.pages.dev",
  },
  // Optional: the normalized event stream, a JSON array of HarnessEvents.
  "events": [{ "timestamp": "…", "type": "agent", "message": "…" }],
}
```

Schema:
[`snapshot/run.schema.json`](https://docs.testcabinet.ai/schema/snapshot/run.schema.json).

## Run media

A per-run document names its media by snapshot-relative key: `proofMedia` for
the proof-of-implementation images and videos, `validationMedia` for the run's
synthesized automated-validation outputs, `assetMedia` for an asset-generation
run's produced images and action logs, and `showcaseMedia` for the files of the
run's [showcase](/components/core/showcase/), each entry pairing the recorded
file name with its published key. Those keys point under
`media/runs/<run-id>/`.

A published run's media never changes, so it is keyed by the run id and written
once. A publish references any object already under `media/` without reading the
source bytes or re-uploading, and reads and uploads only what is missing, from
the backend store or the [artifact service](/components/artifacts/overview/). A
run's media is therefore exported exactly once across all snapshots.

A `video` is transcoded from webm to mp4, for iOS playback, exactly once. A
transcoded video's recorded file name keeps its `.webm` spelling while its
published key ends `.mp4`, so a reader follows the key rather than composing one
from the name. A `replay` recorded as `.webm` is published as recorded, because
the player decodes its frames and timestamps as the engine wrote them.

To re-seed the bucket from a prior snapshot after the source volumes are lost,
use `scripts/recover-run-media-from-snapshot.sh`.

An upload stores both labels the object is served under: what the resource is
and how its bytes are framed. A 2D engine's validation recording is stored as
`application/json` with a gzip content encoding, so a published recording
arrives at the gallery as JSON, and a 3D engine's is stored as `video/webm`.

## Case media

A case-metadata file names its media the same way: `references[]` for the
rendered reference baselines, `validationBaselines[]` for the committed
validation baselines, and each variant's `showcase` for its authored [case
showcase](/components/core/showcase/#the-case-showcase) media, under
`media/cases/<slug>/<version>/`.

A reference image is rendered from a committed mockup at ingest rather than
committed as bytes, so a re-ingest on a different browser build can legitimately
produce different bytes for the same view. Each object is therefore
content-addressed: its key carries a short digest of the source bytes.

```text
media/cases/pong/v1.0.0/references/_common/3f2a9c1b8e04d75a-gameplay.png
```

Identical bytes reuse the identical key and are skipped. Changed bytes mint a
new key and are uploaded. A video baseline already in the bucket costs neither
an upload nor a transcode.

Showcase media follows the same content-addressed rule, and its videos the same
transcode rule as run media: a `.webm` entry is published as `.mp4`, with the
entry's `file` keeping its authored spelling while its `key` ends `.mp4`. A
`replay` baseline recorded as `.webm` is published as recorded.

## Case files

A case version's starter-workspace files are published under
`files/cases/<slug>/<version>/workspace/`, content-addressed like case media and
keyed by digest plus base name. They sit under their own prefix because they are
the text files a run is seeded with, served with text content types so the
gallery displays a fetched file rather than downloading it.

## Reviewer pictures

Each distinct reviewer's profile picture is exported as a `pfp/<account-id>`
object, served with its own content type. The bytes are fetched from the [auth
service](/components/auth/overview/) on each refresh, because a picture is
mutable. A per-run document's review entries carry the key, and the site
resolves it against the snapshot base. A reviewer with no picture carries no
key.

## Code analysis

A run's [code analysis](/gg/analysis/code-analysis/) is published in the two
tiers it is computed in, which is what keeps a run's page load bounded.

The bounded summary rides on the record inside the per-run document, and its
ranking-relevant slice (code lines, the size Gini, mean cognitive complexity) is
lifted onto the run's projection row as `code`, alongside the analyzer
generation, the authored-or-tree basis, and the truncation flag. A listing
therefore ranks every run's code without a fetch per run. The provenance travels
with the figures, because two analysed runs are comparable only under the same
generation and basis.

The unbounded document, holding every authored file, scored function, import
edge, cycle and clone group, is published as its own object with the analyzer
generation in its key:

```text
media/runs/<run-id>/code-analysis/v2.json
```

A re-analysis under a newer generation is a different document, and the
generation in the key is what makes it mint a new object rather than overwrite
figures a published snapshot still points at. The per-run document names it as
`codeAnalysisKey`, and the site fetches it on demand.

The object is a static read of model-written source, so it is parsed and passed
through the same secret scrubber before it becomes an object. An absent `code`
means the run was never measured rather than measured at zero.

## Comparison documents

One document per published [harness comparison](/comparisons/experiments/), a
full read model of arms, distributions and diagnostics. Each is scrubbed like
every other published document, and the projection holds the row a comparison is
listed and reached by.

## Superseded objects

A run whose content changes mints a new key, and the object at its old key is
retained. Superseded objects and the media of a deleted run stay in the bucket.
The accumulation is proportional to content changes rather than to publishes, so
it settles at a small multiple of the live set.

## Case documents

The site-facing slice of a [test case version](/testing/end-to-end/overview/):
what the gallery shows to frame a run. It carries the name, test type,
difficulty, tags, summary and description, `engineFormat`, the declared checks
without their action lists, the review items with each point's `domains` and
`failureCap`, and a `references` array naming each rendered reference baseline
by its snapshot-relative [`media/cases/…` key](#case-media), with a `variant` of
`null` for a common reference or the variant slug for a variant-scoped one. The
site resolves those keys to absolute URLs.

Each variant carries its own fully rendered `prompt` and its own `seededInputs`,
the seeded spec bodies inlined in seed order, so the static site shows the same
instruction and specs a run is seeded with. Both are the engineless rendering,
which is also what a run on the `none` [engine](/components/core/engines/)
received. An `engineRenderings` map keyed by engine slug carries the same pair
re-rendered for every other engine the version declares, and a reader takes the
entry for the engine its run recorded. A variant also names its deployed
reference implementations: a `referenceBuilds` map of engine slug to URL for
playable builds, or a `referenceSheet` of published frame indices whose object
keys the site derives itself. The file carries the case's addressing rather than
its mockup HTML or host paths.

A variant carries its authored `showcase` when it declares one: the description,
verbatim markdown, and the media carousel with each entry naming the [published
object](#case-media) its bytes live at. It also carries `workspaceFiles`, the
starter-workspace files a run of it is seeded with, each pairing the
run-root-relative destination path with the [published key](#case-files) of its
bytes. The engineless set rides the variant and each `engineRenderings` entry
carries the set for its engine, matching the prompt-and-specs split. Only the
addressing is inlined, so the site fetches a starter file on demand.

Only a version that at least one published run built is emitted. The site keys
lookups by `(slug, version)` from each run's subject.

This metadata is read from the backend's ingested definition store rather than
from the run record, which carries only the run's `(slug, version, variant)`
subject. To keep the dataset self-consistent, an ingest that (re)ingests a
version republishes the case documents and rows it touched. A no-op ingest
leaves them as they are.

Schema:
[`snapshot/case.schema.json`](https://docs.testcabinet.ai/schema/snapshot/case.schema.json).

## Test-case groups

The ingested [test-case group](/components/core/test-case-groups/) set is
exported as one object, `test-case-groups.json`, under the snapshot's own
prefix, and the snapshot's top-level `index.json` names it under an optional
`testCaseGroupsKey`. The file carries a `schemaVersion` and the groups in the
order [`GET /test-case-groups`](/components/backend/api/#get-test-case-groups)
serves them, each with its slug, name, optional summary, and member case slugs.
A reader treats an absent key as an empty group set.

## The gg document corpus

Every recorded [gg](/gg/overview/) run as one flat
[document](/gg/analysis/query-language/) of dotted, typed fields, plus the
instant the export was taken. This is the whole of the public analysis surface:
the gallery runs the mirrored browser evaluator over these documents, so
querying it makes no backend request.

Three rules govern the corpus's contents:

- It is decoupled from run publication. A document carries configuration ids and
  outcome numbers, with no source, prompts or model output, and hardly any gg run
  is ever published, so redaction is the control rather than a publication gate.
- It respects the experimental catalog gate. A document for an
  [experimental](/development/frozen-versions/) case version is dropped, and a
  case whose manifest this process cannot read is treated as unreleasable.
- It is field-redacted and scrubbed. A field is dropped when its name is on the
  private-field deny-list, and any field whose name or string value exceeds 200
  characters is dropped whatever it is called. The whole object then passes the
  same secret scrubber as every other published document.

A [session record](/gg/analysis/session-records/) is never exported. A document
carries configuration and outcomes, while a record carries the complete model
conversation verbatim, so records stay console-only.

The corpus is a build-time export, so it lags the console's live index, and the
file carries its own `generatedAt`.

Schema:
[`snapshot/gg-runs.schema.json`](https://docs.testcabinet.ai/schema/snapshot/gg-runs.schema.json).
