---
title: Public Snapshot
---

The public snapshot is the public dataset: the [Cloudflare
R2](https://developers.cloudflare.com/r2/) bucket `snapshot.testcabinet.ai`,
which the [gallery](/components/site/overview/) and its Workers read at
runtime. The backend composes every object from its published set and writes
it through the [artifacts service](/components/artifacts/overview/), the one
writer of the bucket. This page is the authoritative contract for the bucket's
layout, the surface between the backend that writes it and the gallery that
reads it.

The run documents hold only published runs. A produced run that has not been
published is private, and a run that can never be published, such as an
infrastructure failure or a
[`canceled`](/components/contracts/run-records/#status) run, never reaches
them. The [gg document corpus](#gg-runsjson--the-gg-document-corpus) is the one
exception, and it is redacted rather than gated on publication.

A publish is an upload. After each publish the backend marks the run published,
mints the run's [short code](#short-codes) and writes its object, has the
artifacts service copy the run's media into the bucket, writes the run's
document, composes the index objects from its full published set under a new
generation, and swaps the `index.json` pointer. Composing each index from the
full set rather than applying a delta keeps the operation idempotent.

Writing a generation is distinct from re-uploading everything. The
per-generation index objects are small and are written with every generation.
Everything else is content-addressed under a prefix shared by every generation,
and a publish uploads only the objects the bucket does not already hold:

- A run's document under [`documents/runs/<run-id>/`](#run-documents), keyed by
  a digest of its own bytes.
- A run's media under [`media/runs/<run-id>/`](#run-media), keyed by run id and
  immutable once the run is published.
- A case version's media under [`media/cases/<slug>/<version>/`](#case-media)
  and its starter-workspace files under
  [`files/cases/<slug>/<version>/`](#case-files). A version with a published run
  is [frozen](/development/frozen-versions/), so these are effectively immutable
  too.

Writing each object once keeps a publish cheap as runs and cases accumulate.

## Writing through the artifacts service

The backend holds no bucket credential. It writes a document, an index object,
or a code with `PUT /public/{key}` on the artifacts service, and has a run's
media copied from the run's stored tree with `POST /runs/{id}/publish-media`,
which answers with the public keys the run's document then names. Every
connection flows outward from the private plane, and what crosses into public
reach is a read-only export of already-published runs.

## Atomic swap

The gallery must never read a half-written dataset. The backend writes every
index object of a new generation under a generation prefix
`snapshots/<snapshotId>/` first, uploading the objects concurrently, and writes
the small top-level `index.json` pointer last. `index.json` is a single small
object, so overwriting it is the atomic cut-over: until that write lands the
gallery keeps reading the previous generation, and a new generation never
clobbers the previous one's objects. A failed upload leaves `index.json`
unwritten and the previous generation live. Superseded prefixes are
[pruned](#pruning-superseded-generations) after a grace period.

`<snapshotId>` is a timestamp plus a hash, for example `2026-06-17T2148Z-1a7b9c3d`.

## Keys

The index objects, written with every generation:

```text
index.json
snapshots/<snapshotId>/runs.json
snapshots/<snapshotId>/cases/<slug>/<version>.json
snapshots/<snapshotId>/models.json
snapshots/<snapshotId>/comparisons.json
snapshots/<snapshotId>/comparisons/<id>.json
snapshots/<snapshotId>/test-case-groups.json
snapshots/<snapshotId>/gg-runs.json
```

The content-addressed objects, shared across every generation:

```text
documents/runs/<run-id>/<digest>.json
media/runs/<run-id>/proof/<file>
media/runs/<run-id>/asset/<file>
media/runs/<run-id>/validation/<file>
media/runs/<run-id>/showcase/<file>
media/runs/<run-id>/code-analysis/v<generation>.json
media/cases/<slug>/<version>/references/<scope>/<digest>-<view>.png
media/cases/<slug>/<version>/validation-baseline/<engine>/<variant>/<digest>-<file>
media/cases/<slug>/<version>/showcase/<variant>/<digest>-<file>
files/cases/<slug>/<version>/workspace/<digest>-<basename>
```

The short-code objects, each written once:

```text
codes/<code>
```

`index.json` is the pointer, overwritten last. A run's summary card names its
document by key, and a per-run or per-case document references its media by
these bucket-relative keys, so the atomic `index.json` swap still points the
gallery at a complete, self-consistent dataset.

`<scope>` is `_common` for a reference shown on every variant, or a variant slug
for one scoped to that variant.

The gallery reads `index.json`, then follows its keys and prefixes to the rest.
Every JSON file carries a `schemaVersion`, currently `2`.

## `index.json` — the pointer

The top-level pointer and summary: the snapshot id, when it was generated, the
run count, and the keys and prefixes the rest of the generation lives under.

```jsonc
{
  "schemaVersion": 2,
  "snapshotId": "2026-06-17T2148Z-1a7b9c3d",
  "generatedAt": "2026-06-17T21:48:00Z",
  "runCount": 128,
  "runsKey": "snapshots/2026-06-17T2148Z-1a7b9c3d/runs.json",
  "runDocumentsPrefix": "documents/runs/",
  "casesPrefix": "snapshots/2026-06-17T2148Z-1a7b9c3d/cases/",
  "modelsKey": "snapshots/2026-06-17T2148Z-1a7b9c3d/models.json",
  "comparisonsKey": "snapshots/2026-06-17T2148Z-1a7b9c3d/comparisons.json",
  "comparisonsPrefix": "snapshots/2026-06-17T2148Z-1a7b9c3d/comparisons/",
  "ggRunsKey": "snapshots/2026-06-17T2148Z-1a7b9c3d/gg-runs.json",
  "testCaseGroupsKey": "snapshots/2026-06-17T2148Z-1a7b9c3d/test-case-groups.json",
}
```

`runDocumentsPrefix` is informational: a run document's key carries a content
digest, so a reader reaches it through the `documentKey` on the run's summary
card rather than by composing a path. `testCaseGroupsKey` is optional, and a
reader treats its absence as an empty group set.

Schema:
[`snapshot/index.schema.json`](https://docs.testcabinet.ai/schema/snapshot/index.schema.json).

## `runs.json` — the run index

A `runs` array of summary cards, newest first, one per published run. It is
enough for the gallery's cards and its client-side filter, sort and paging
without fetching every per-run file.

Each summary carries the run's id and timestamps, its
[subject](/components/contracts/run-records/#subject) including the [test
type](/testing/overview/), its [metrics](/components/contracts/metrics/), the
denormalized case name, the `validationLoaded` signal, the run state, the links,
the run's short code, and every headline figure a listing needs: the functional
`rating`, the `aesthetic` rating, whether the run is `validatorRated`, the
`score`, and the `reviewCount`. A performance run's fuel result and the ranking
slice of a run's [code analysis](#code-analysis) ride along too. Each card names
the run's full document by `documentKey`.

The gallery fetches full records lazily, one per run page. This summary index
is the whole dataset the list, home, leaderboard, and metrics views read, and
the preview-tag Worker takes a run page's title, description and image from the
run's card.

Schema:
[`snapshot/runs.schema.json`](https://docs.testcabinet.ai/schema/snapshot/runs.schema.json).

## Run documents

A run's full document lives at `documents/runs/<run-id>/<digest>.json`, where
`<digest>` is over the document's own bytes. A run whose public content is
unchanged since its last publish keeps the key it already occupies and is
skipped; a new review, a newly uploaded proof, or an edited record mints a new
key and is uploaded. The key cannot be composed from the run id, so the
`documentKey` on the run's summary card is the only supported way to reach it.

The document is the full [run record](/components/contracts/run-records/) blob,
verbatim, with its links populated and its short code on it, plus the array of
[reviews](/components/backend/results/#reviews) and the run's links. Every run
here is published, so the document carries no publication flag. Each review
entry carries the reviewer's display name, the name recorded with the review
from the [identity](/components/auth/overview/) that wrote it.

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
stream](/components/driver/events/) it is included as `events`. Only the
normalized stream is published.

This document is published to the open internet, so any provider-shaped `sk-…`
token anywhere in the record or events is replaced with `[REDACTED]` before
upload. The backend never holds a key value, so it redacts by shape. Only this
public export is rewritten. The backend's own stored copy is left intact.

```jsonc
{
  "schemaVersion": 2,
  "record": { "…": "full RunRecord, links and short code populated" },
  "reviews": [
    {
      "reviewer": "Ada",
      "ratings": [
        { "domain": "single-player", "rating": "great" },
        { "domain": "versus", "rating": "scuffed" },
      ],
      "writeup": "Plays well, but the AI paddle…",
      "checklist": [],
      "reviewedAt": "2026-06-21T18:00:00Z",
    },
    {
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

## Short codes

A run is assigned a short code the first time it is published: the shortest
prefix of its run id, at least eight characters long, that no published run
already holds. The code is stored on the run record and written as the object
`codes/<code>`, whose body is the run id as `text/plain`.

Assignment happens once. A code keeps addressing the run it was minted for
whatever is published afterwards, and is never reassigned, so the object is
written once and never overwritten. The `tcab.ai` Worker resolves a share link
by reading this object; see [Share links](/components/site/serving/#share-links).
The console builds a run's share links from the code on its record.

## Run media

A per-run document names its media by bucket-relative key: `proofMedia` for
the proof-of-implementation images and videos, `validationMedia` for the run's
synthesized automated-validation outputs, `assetMedia` for an asset-generation
run's produced images and action logs, and `showcaseMedia` for the files of the
run's [showcase](/components/driver/showcase/), each entry pairing the recorded
file name with its published key. Those keys point under
`media/runs/<run-id>/`.

`validationMedia` covers two sets. The synthesized outputs are declared on the
run record. A recording's [shared image
store](/components/driver/validation/#the-shared-image-store) backs no verdict
and appears on no record, so the copy enumerates the run's stored validation
media for it. A store file is published under the same flat name it is served
under, so a console resolves it through the lookup that resolved the recording
naming it, and the gallery composes its URL by appending that name to a single
per-run prefix.

A published run's media never changes, so it is keyed by the run id and written
once. The artifacts service's copy lists what is already under the run's prefix,
skips every key already there, and copies the rest from the run's stored tree,
so a run's media is written exactly once however many generations follow. The
copy answers with the keys the run's document names.

A `video` is transcoded from webm to mp4, for iOS playback, exactly once. A
transcoded video's recorded file name keeps its `.webm` spelling while its
published key ends `.mp4`, so a reader follows the key rather than composing one
from the name. A `replay` recorded as `.webm` is published as recorded, because
the player decodes its frames and timestamps as the engine wrote them.

An upload stores both labels the object is served under: what the resource is
and how its bytes are framed. A 2D engine's validation recording is stored as
`application/json` with a gzip content encoding, so a published recording
arrives at the gallery as JSON, and a 3D engine's is stored as `video/webm`.

## Case media

A case-metadata file names its media the same way: `references[]` for the
rendered reference baselines, `validationBaselines[]` for the committed
validation baselines, and each variant's `showcase` for its authored [case
showcase](/components/driver/showcase/#the-case-showcase) media, under
`media/cases/<slug>/<version>/`. A version with a published run is
[frozen](/development/frozen-versions/), so re-uploading its baselines on every
publish would be waste.

`validationBaselines[]` covers every committed file of each engine and variant's
baseline directory, including the [shared image
store](/components/driver/validation/#the-shared-image-store) a baseline
recording draws from, alongside the recordings naming it. A store file is the
one case-scoped object published under its bare name rather than a
content-addressed key, because that name is already a hash of its own bytes, and
a key a consumer can compose lets the gallery carry one URL prefix per subject
instead of an entry per image.

A reference image is rendered from a committed mockup at ingest rather than
committed as bytes, so a re-ingest on a different browser build can legitimately
produce different bytes for the same view. Each object is therefore
content-addressed: its key carries a short digest of the source bytes.

```text
media/cases/pong/v1.0.0/references/_common/3f2a9c1b8e04d75a-gameplay.png
```

Identical bytes reuse the identical key and are skipped; changed bytes mint a
new key and are uploaded. The key is derived from the source bytes, so the
decision is made before any work happens: a video baseline already in the bucket
costs neither an upload nor a transcode. Computing the digest needs only a local
store read.

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

## Code analysis

A run's [code analysis](/gg/analysis/code-analysis/) is published in the two
tiers it is computed in, which is what keeps a run's page load bounded.

The bounded summary rides on the record inside the per-run document, and its
ranking-relevant slice (code lines, the size Gini, mean cognitive complexity) is
lifted onto the run's summary card in `runs.json` as `code`, alongside the
analyzer generation, the authored-or-tree basis, and the truncation flag. One
file therefore ranks every run's code without a fetch per run. The provenance
travels with the figures, because two analysed runs are comparable only under
the same generation and basis.

The unbounded document, holding every authored file, scored function, import
edge, cycle and clone group, is published as its own object with the analyzer
generation in its key:

```text
media/runs/<run-id>/code-analysis/v2.json
```

Like run media it sits under `media/`, so a publish after the first skips it and
two publishes upload it exactly once. A re-analysis under a newer generation is
a different document, and the generation in the key is what makes it mint a new
object rather than overwrite figures a published generation still points at.
The per-run document names it as `codeAnalysisKey`, and the gallery fetches it
on demand.

The object is a static read of model-written source, so it is parsed and passed
through the same secret scrubber before it becomes an object. An absent `code`
means the run was never measured rather than measured at zero.

## `models.json` — the model catalog

The composed model catalog: the curated model configuration unioned with the
models derived from recorded runs, each with its list price. The gallery
renders its Models section from this file.

## `comparisons.json` — published comparisons

The index of published [harness comparisons](/comparisons/experiments/), each a
full read model of arms, distributions and diagnostics, with a per-comparison
`comparisons/<id>.json` for a direct fetch. Each document is scrubbed like every
other published document. An empty list is a valid index.

## Pruning superseded generations

Every publish writes a whole new `snapshots/<snapshotId>/` generation and cuts
over by overwriting `index.json`. Nothing can reach an earlier generation
afterwards, so after the cut-over the publish prunes the ones that are done
with. A generation is deleted only when both hold:

1. It is not the one `index.json` points at. The live generation is kept however
   old it is, so a bucket whose live generation predates the retention window
   keeps serving the gallery.
2. It is older than `TCAB_SNAPSHOT_RETENTION_HOURS`, default `24`. A gallery
   session or a Worker that already read `index.json` is still fetching that
   generation's objects, so a just-superseded generation has to outlive the
   readers it is serving.

A generation id that does not parse as a timestamp is kept. The prune is
best-effort: it runs after the generation is already live, so a failure logs
and leaves the work to the next publish rather than failing this one.

The content-addressed objects under `documents/`, `media/`, and `files/`, and
the objects under `codes/`, are never generation-scoped and are untouched by
the prune. A run document superseded by a content change stays in the bucket;
that accumulation is proportional to content changes rather than to publishes.

## `cases/<slug>/<version>.json` — case metadata

The gallery-facing slice of a [test case version](/testing/end-to-end/overview/):
what the gallery shows to frame a run. It carries the name, test type,
difficulty, tags, summary and description, `engineFormat`, the declared checks
without their action lists, the review items with each point's `domains` and
`failureCap`, and a `references` array naming each rendered reference baseline
by its bucket-relative [`media/cases/…` key](#case-media), with a `variant` of
`null` for a common reference or the variant slug for a variant-scoped one. The
gallery resolves those keys to absolute URLs.

Each variant carries its own fully rendered `prompt` and its own `seededInputs`,
the seeded spec bodies inlined in seed order, so the gallery shows the same
instruction and specs a run is seeded with. Both are the engineless rendering,
which is also what a run on the `none` [engine](/components/engines/engines/)
received. An `engineRenderings` map keyed by engine slug carries the same pair
re-rendered for every other engine the version declares, and a reader takes the
entry for the engine its run recorded. A variant also names its deployed
reference implementations: a `referenceBuilds` map of engine slug to URL for
playable builds, or a `referenceSheet` of published frame indices whose object
keys the gallery derives itself. The file carries the case's addressing rather
than its mockup HTML or host paths.

A variant carries its authored `showcase` when it declares one: the description,
verbatim markdown, and the media carousel with each entry naming the [published
object](#case-media) its bytes live at. It also carries `workspaceFiles`, the
starter-workspace files a run of it is seeded with, each pairing the
run-root-relative destination path with the [published key](#case-files) of its
bytes. The engineless set rides the variant and each `engineRenderings` entry
carries the set for its engine, matching the prompt-and-specs split. Only the
addressing is inlined, so the gallery fetches a starter file on demand.

Only a version that at least one published run built is emitted. The gallery
keys lookups by `(slug, version)` from each run's subject, so it fetches exactly
the case files that are present.

This metadata is read from the backend's ingested definition store rather than
from the run record, which carries only the run's `(slug, version, variant)`
subject. The store is regenerable, and on a deployment where it lives on
ephemeral local disk a pod reschedule empties it until the ingest repopulates
it. A generation composed while the store is momentarily empty would emit each
published run with no case file for it, and the gallery would show a run with no
case to browse. To keep the dataset self-consistent, an ingest that actually
(re)ingests a version writes a generation, the same as a publish does. A no-op
ingest does not, so the periodic ingest does not write a generation on every
cycle.

Schema:
[`snapshot/case.schema.json`](https://docs.testcabinet.ai/schema/snapshot/case.schema.json).

## Test-case groups

The ingested [test-case group](/components/backend/test-case-groups/) set is
exported as one object, `test-case-groups.json`, under the generation's own
prefix, and the top-level `index.json` names it under an optional
`testCaseGroupsKey`. The file carries a `schemaVersion` and the groups in the
order [`GET /test-case-groups`](/components/backend/api/#get-test-case-groups)
serves them, each with its slug, name, optional summary, and member case slugs.
A reader treats an absent key as an empty group set. An ingest that changes the
group set writes a generation even when no version was re-ingested.

## `gg-runs.json` — the gg document corpus

Every recorded [gg](/gg/overview/) run as one flat
[document](/gg/analysis/query-language/) of dotted, typed fields, plus the
instant the export was taken. This is the whole of the public analysis surface:
the gallery's Discover page runs the mirrored browser evaluator over these
documents, so querying on the public gallery makes no backend request.

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

The corpus is written with each generation, so it lags the console's live index
by the interval between publishes, and the file carries its own `generatedAt`.

Schema:
[`snapshot/gg-runs.schema.json`](https://docs.testcabinet.ai/schema/snapshot/gg-runs.schema.json).
