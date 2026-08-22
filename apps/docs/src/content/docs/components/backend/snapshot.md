---
title: Public Snapshot
---

The public snapshot is the document half of the public dataset. The backend
uploads a published run's record, its events, and all media to a public
[Cloudflare R2](https://developers.cloudflare.com/r2/) bucket, and the
[gallery](/components/site/serving/) fetches those objects by key. The index half
is the [public projection](/components/backend/projection/), whose rows name
these objects. This page is the authoritative contract for the bucket's layout.

A run's row carries every headline figure a listing needs — outcome, rating and
aggregate score — so ranking and paging the published set costs no document
fetch. The score is the one figure not readable from a run record alone, because
the checklist point weights live in the case catalog rather than on the record,
so it is computed where both are in hand and written to the row.

The bucket holds documents for published runs. A produced run that has not been
published is private, and a run that can never be published, such as an
infrastructure failure or a [`canceled`](/components/core/run-records/#status)
run, has no document here. The [gg document
corpus](#the-gg-document-corpus) is the one exception, and it is
redacted rather than gated on publication.

## Content addressing

Every object's key carries a digest of its content, so a key changes only when
the bytes do. A publish computes each key and uploads the objects the bucket does
not already hold.

This gives a publish a cost proportional to what changed. A run's media and a
[frozen](/development/frozen-versions/) case version's baselines are written once
and referenced by every later publish. A run document that gains a review lands
on a new key and is uploaded, and one whose content is unchanged is skipped.
There is no separate "has this run changed?" signal that can go stale, because
the bytes are the signal.

A refresh therefore rebuilds every document in memory, which costs no network
and no source bytes, and writes only what genuinely differs. The uploads that do
remain are issued concurrently rather than one at a time, so the publish is not
serialized on bucket round trips either.

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
media/runs/<run-id>/code-analysis/v<generation>.json
media/cases/<slug>/<version>/references/<scope>/<digest>-<view>.png
media/cases/<slug>/<version>/validation-baseline/<engine>/<variant>/<digest>-<file>
pfp/<account-id>
```

`<scope>` is `_common` for a reference shown on every variant, or a variant slug
for one scoped to that variant.

A document is reached through the projection row that names its key, so a reader
follows a key rather than composing a path. The key carries a digest of the
document's own bytes and cannot be composed from the run id, which is why the
row naming it is the only supported way in. Every document carries a
`schemaVersion`, currently `2`.

## Run documents

The full [run record](/components/core/run-records/) blob, verbatim, with its
links populated, plus the array of [reviews](/components/core/results/#reviews)
and the links the detail page needs. Every run here is published, so the
document carries no publication flag. Each review entry includes the reviewer's
id and display name, and the key of their [profile
picture](#reviewer-pictures) when they have one, so the site can attribute a
writeup and per-domain ratings to the person who wrote them. The site computes
the run's score and overall rating from this array. When the run captured a
normalized [event
stream](/components/core/events/) it is included as `events`. Raw harness output
is never published.

This document is published to the open internet, so it is scrubbed of leaked
secrets as the snapshot is built. A model that dumped its environment can have
printed the run's provider API key into an event or a failure detail, so any
provider-shaped `sk-…` token anywhere in the record or events is replaced with
`[REDACTED]` before upload. The backend never holds a key value, so it redacts
by shape. The operator-side release scrubs the [source repository and playable
build](/components/core/results/#secret-redaction) by exact value as well. The
backend's own stored copy is left intact; only this public export is rewritten.

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
        { "domain": "versus", "rating": "scuffed" }
      ],
      "writeup": "Plays well, but the AI paddle…",
      "checklist": [],
      "reviewedAt": "2026-06-21T18:00:00Z"
    }
  ],
  "links": {
    "sourceRepo": "https://github.com/…",
    "playableBuild": "https://abc123.test-cabinet-runs.pages.dev"
  },
  // Optional: the normalized event stream, a JSON array of HarnessEvents.
  "events": [{ "timestamp": "…", "type": "agent", "message": "…" }]
}
```

Schema:
[`snapshot/run.schema.json`](https://docs.testcabinet.ai/schema/snapshot/run.schema.json).

## Run media

A per-run document names its media by snapshot-relative key: `proofMedia` for
the proof-of-implementation images and videos, `validationMedia` for the run's
synthesized automated-validation outputs, and `assetMedia` for an
asset-generation run's produced images and action logs. Those keys point under
`media/runs/<run-id>/`. A published run's media never changes, so it is keyed by
the run id and written once:

- On each publish the builder lists what is already under `media/` and
  references any object already there without reading the source bytes or
  re-uploading. A run's media is exported exactly once across all snapshots, and
  a video is transcoded from webm to mp4, for iOS playback, exactly once.
- Only media not yet in the bucket is read, from the backend store or the
  [artifact service](/components/artifacts/overview/), and uploaded.

Two consequences follow. A publish stays cheap as asset-generation runs
accumulate, because it uploads only new media. Media already in the bucket is
referenced without needing its source bytes, so a publish keeps a run's media
even when the volumes it was originally read from have been lost, such as after
a cluster is recreated. To re-seed the bucket from a prior snapshot in that
recovery case, use `scripts/recover-run-media-from-snapshot.sh`.

An upload stores both labels the object is served under: what the resource is
and how its bytes are framed. A validation recording is stored as
`application/json` with a gzip content encoding, so a published recording
arrives at the gallery as JSON.

## Case media

A case-metadata file names its media the same way: `references[]` for the
rendered reference baselines and `validationBaselines[]` for the committed
validation baselines, under `media/cases/<slug>/<version>/`. A version with a
published run is [frozen](/development/frozen-versions/), so re-uploading its
baselines on every publish would be waste.

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
therefore ranks every run's code without a fetch per run. The provenance
travels with the figures, because two analysed runs are comparable only under
the same generation and basis.

The unbounded document, holding every authored file, scored function, import
edge, cycle and clone group, is published as its own object with the analyzer
generation in its key:

```text
media/runs/<run-id>/code-analysis/v2.json
```

Like run media it sits under `media/`, so a refresh after the first skips it and
two refreshes upload it exactly once. Unlike run media it is not immutable per
run: a re-analysis under a newer generation is a different document, and the
generation in the key is what makes it mint a new object rather than overwrite
figures a published snapshot still points at. The per-run document names it as
`codeAnalysisKey`, and the site's Code tab fetches it on demand.

Two things follow that the surfaces above must honour:

- The object is scrubbed on its own. The builder redacts the per-run document
  and only that document, so a sibling object must opt in. This one is a static
  read of model-written source, so it is parsed and passed through the same
  secret scrubber before it becomes an object.
- An absent `code` means the run was never measured. The corpus is [not
  backfilled](/gg/analysis/code-analysis/#publishing-and-the-analyzer-version),
  so a run that finished before the analyzer shipped carries no figures. A view
  must render that absence as a gap rather than as a zero.

## Comparison documents

One document per published [harness comparison](/comparisons/experiments/), a
full read model of arms, distributions and diagnostics. Each is scrubbed like
every other published document, and the projection holds the row a comparison is
listed and reached by.

## Superseded objects

A run whose content changes mints a new key, so the object it previously occupied
is left with nothing referencing it. Reclaiming those, and the media of a deleted
run, is a future cleanup. The accumulation is proportional to content changes
rather than to publishes, so it settles at a small multiple of the live set.

Deleting them needs a signal the bucket does not carry. A listing reports when an
object was *written*, not when it fell out of use, so a document written months
ago says nothing about the moment it was superseded — pruning on that clock would
delete a just-orphaned document and 404 any reader still following the key it had
a moment ago. Reclaiming the space waits on a recorded supersession time.

## Case documents

The site-facing slice of a [test case version](/testing/end-to-end/overview/):
what the gallery shows to frame a run. It carries the name, test type,
difficulty, tags, summary and description, the declared checks without their
action lists, and a `references` array naming each rendered reference baseline
by its snapshot-relative [`media/cases/…` key](#case-media), with a `variant` of
`null` for a common reference or the variant slug for a variant-scoped one. The
site resolves those keys to absolute URLs.

Each variant carries its own fully rendered `prompt` and its own `seededInputs`,
the seeded spec bodies inlined in seed order, so the static site shows the same
instruction and specs a run is seeded with. Both are the engineless rendering,
which is also what a run on the `none` [engine](/components/core/engines/)
received. An `engineRenderings` map keyed by engine slug carries the same pair
re-rendered for every other engine the version declares, because the templates
branch on the selected engine; a run's Inputs surface reads the entry for the
engine its run recorded. A variant also names its deployed reference
implementations: a `referenceBuilds` map of engine slug to URL for playable
builds, or a `referenceSheet` of published frame indices whose object keys the
site derives itself. The file carries no mockup HTML and no host paths.

Only a version that at least one published run built is emitted. The site keys
lookups by `(slug, version)` from each run's subject, so it fetches exactly the
case files that are present.

This metadata is read from the backend's ingested definition store rather than
from the run record, which carries only the run's `(slug, version, variant)`
subject. The store is regenerable, and on a deployment where it lives on
ephemeral local disk a pod reschedule empties it until the ingest repopulates
it. A publish taken while the store is momentarily empty would leave a run with
no case document to frame it. To keep the dataset self-consistent, an ingest that
(re)ingests a version republishes the case documents and rows it touched. A no-op
ingest leaves them as they are.

Schema:
[`snapshot/case.schema.json`](https://docs.testcabinet.ai/schema/snapshot/case.schema.json).

## The gg document corpus

Every recorded [gg](/gg/overview/) run as one flat
[document](/gg/analysis/query-language/) of dotted, typed fields, plus the
instant the export was taken. This is the whole of the public analysis surface:
the site's Discover page runs the mirrored browser evaluator over these
documents, so querying on the public gallery makes no backend request.

Three rules govern the corpus's contents:

- It is decoupled from run publication. A document carries configuration ids and
  outcome numbers, with no source, prompts or model output, and hardly any gg
  run is ever published, so gating the export on publication would export an
  empty corpus. Redaction is the control instead.
- It respects the experimental catalog gate. The backend hides
  [experimental](/development/frozen-versions/) case versions from the UI, and
  exporting one's document would publish an unreleased case's slug, its
  existence, its run count and its scores. Those documents are dropped, and a
  case whose manifest this process cannot read is treated as unreleasable.
- It is field-redacted and scrubbed. A field is dropped when its name is on the
  private-field deny-list, and any field whose name or string value exceeds 200
  characters is dropped whatever it is called. In practice that catches a
  capability parameter carrying free text an operator pasted into a
  configuration. The whole object then passes the same secret scrubber as every
  other published document.

A [session record](/gg/analysis/session-records/) is never exported. A document
carries configuration and outcomes, while a record carries the complete model
conversation verbatim, so records stay console-only.

The corpus is a build-time export, so it lags the console's live index. The file
carries its own `generatedAt` and the site renders it beside the figures.

Schema:
[`snapshot/gg-runs.schema.json`](https://docs.testcabinet.ai/schema/snapshot/gg-runs.schema.json).
