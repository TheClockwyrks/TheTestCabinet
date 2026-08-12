---
title: Public Snapshot
---

The public snapshot is the dataset the [site](/components/site/overview/) is
built from. The backend exports its published runs to a public [Cloudflare
R2](https://developers.cloudflare.com/r2/) bucket, and the site build fetches
that export. This page is the authoritative contract for the snapshot's layout,
the surface between the backend that writes it and the site that reads it.

The snapshot's run documents hold only published runs. A produced run that has
not been published is private, and a run that can never be published, such as an
infrastructure failure or a [`canceled`](/components/core/run-records/#status)
run, never reaches them. The [gg document
corpus](#gg-runsjson--the-gg-document-corpus) is the one exception, and it is
redacted rather than gated on publication.

The backend regenerates the whole snapshot from its full published set on each
coalesced publish, uploads it, and swaps it into place. Regenerating everything
rather than applying deltas keeps the operation idempotent.

The JSON documents are small and are rewritten every publish. Media is not. Two
families of media live outside any single snapshot's prefix, are uploaded once,
and are referenced by every later snapshot:

- A run's media under [`media/runs/<run-id>/`](#run-media), keyed by run id and
  immutable once the run is published.
- A case version's media under [`media/cases/<slug>/<version>/`](#case-media). A
  version with a published run is [frozen](/development/frozen-versions/), so
  this is effectively immutable too.

Writing media once keeps a publish cheap as runs and cases accumulate, and it
lets a publish keep a run's media after the volumes the bytes were read from are
gone.

## Atomic swap

A site build must never read a half-written dataset. The backend writes every
file of a new snapshot under a content-addressed prefix
`snapshots/<snapshotId>/` first, and writes the small top-level `index.json`
pointer last. `index.json` is a single small object, so overwriting it is the
atomic cut-over: until that write lands the site keeps reading the previous
snapshot, and a new snapshot never clobbers the previous one's files. Superseded
prefixes are [pruned](#pruning-superseded-generations) after a grace period.

`<snapshotId>` is a timestamp plus a hash, for example `2026-06-17T2148Z-1a7b9c3d`.

## Keys

The documents, rewritten every publish:

```text
index.json
snapshots/<snapshotId>/runs.json
snapshots/<snapshotId>/runs/<run-id>.json
snapshots/<snapshotId>/cases/<slug>/<version>.json
snapshots/<snapshotId>/models.json
snapshots/<snapshotId>/comparisons.json
snapshots/<snapshotId>/comparisons/<id>.json
snapshots/<snapshotId>/gg-runs.json
```

The objects written once and shared across every later snapshot:

```text
media/runs/<run-id>/proof/<file>
media/runs/<run-id>/asset/<file>
media/runs/<run-id>/validation/<file>
media/runs/<run-id>/code-analysis/v<generation>.json
media/cases/<slug>/<version>/references/<scope>/<digest>-<view>.png
media/cases/<slug>/<version>/validation-baseline/<variant>/<digest>-<file>
pfp/<account-id>
```

`index.json` is the pointer, overwritten last. A per-run or per-case document
references its media by these snapshot-relative keys, so the atomic `index.json`
swap still points a site build at a complete, self-consistent dataset.

`<scope>` is `_common` for a reference shown on every variant, or a variant slug
for one scoped to that variant.

The site reads `index.json`, then follows its prefixes to the rest. Every JSON
file carries a `schemaVersion`, currently `1`.

## `index.json` — the pointer

The top-level pointer and summary: the snapshot id, when it was generated, the
run count, and the keys and prefixes the rest of the snapshot lives under.

```jsonc
{
  "schemaVersion": 1,
  "snapshotId": "2026-06-17T2148Z-1a7b9c3d",
  "generatedAt": "2026-06-17T21:48:00Z",
  "runCount": 128,
  "runsKey": "snapshots/2026-06-17T2148Z-1a7b9c3d/runs.json",
  "runsPrefix": "snapshots/2026-06-17T2148Z-1a7b9c3d/runs/",
  "casesPrefix": "snapshots/2026-06-17T2148Z-1a7b9c3d/cases/",
  "modelsKey": "snapshots/2026-06-17T2148Z-1a7b9c3d/models.json",
  "comparisonsKey": "snapshots/2026-06-17T2148Z-1a7b9c3d/comparisons.json",
  "comparisonsPrefix": "snapshots/2026-06-17T2148Z-1a7b9c3d/comparisons/",
  "ggRunsKey": "snapshots/2026-06-17T2148Z-1a7b9c3d/gg-runs.json"
}
```

Schema:
[`snapshot/index.schema.json`](https://docs.testcabinet.ai/schema/snapshot/index.schema.json).

## `runs.json` — the run index

A `runs` array of summary cards, newest first, one per published run. It is
enough for the gallery's cards and its client-side filter, sort and paging
without fetching every per-run file.

Each summary carries the run's id and timestamps, its
[subject](/components/core/run-records/#subject) including the [test
type](/testing/overview/), its [metrics](/components/core/metrics/), the
denormalized case name, the `validationLoaded` signal, the run state, the links,
and the review aggregates: `rating` (the worst rating any reviewer gave any
domain), `score` (the mean earned checklist weight across the run's reviews),
and `reviewCount`. A performance run's fuel result and the ranking slice of a
run's [code analysis](#code-analysis) ride along too. `rating` and `score` are
nullable in the contract, and the snapshot holds only reviewed runs, so both are
present here.

The site fetches full records lazily, one per run page. This summary index is
the whole dataset the list, home, leaderboard, and metrics views read.

Schema:
[`snapshot/runs.schema.json`](https://docs.testcabinet.ai/schema/snapshot/runs.schema.json).

## `runs/<run-id>.json` — per-run record

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
  "schemaVersion": 1,
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

## `models.json` — the model catalog

The composed model catalog: the curated model configuration unioned with the
models derived from recorded runs, each with its price history. The public site
renders its Models section from this file rather than a bundled dataset.

## `comparisons.json` — published comparisons

The index of published [harness comparisons](/comparisons/experiments/), each a
full read model of arms, distributions and diagnostics, with a per-comparison
`comparisons/<id>.json` for a direct fetch. Each document is scrubbed like every
other published document. An empty list is a valid index.

## Pruning superseded generations

Every refresh writes a whole new `snapshots/<snapshotId>/` generation and cuts
over by overwriting `index.json`. Nothing can reach an earlier generation
afterwards, so after the cut-over the refresh prunes the ones that are done
with. A generation is deleted only when both hold:

1. It is not the one `index.json` points at. The live generation is kept however
   old it is, so a bucket whose live snapshot predates the retention window
   keeps serving the site.
2. It is older than `TCAB_SNAPSHOT_RETENTION_HOURS`, default `24`. A site build
   that already read `index.json` is still fetching that generation's files, so
   a just-superseded generation has to outlive the build it is serving.

A generation id that does not parse as a timestamp is kept. The prune is
best-effort: it runs after the snapshot is already live, so a failure logs and
leaves the work to the next refresh rather than failing the publish. Without it
the bucket grows by a full generation per publish and never shrinks.

Run and case media under `media/` are never generation-scoped and are untouched
by the prune. Media orphaned by a deleted run is harmless, since no snapshot
references it; collecting it is a future cleanup.

## `cases/<slug>/<version>.json` — case metadata

The site-facing slice of a [test case version](/testing/end-to-end/overview/):
what the gallery shows to frame a run. It carries the name, test type,
difficulty, tags, summary and description, the declared checks without their
action lists, and a `references` array naming each rendered reference baseline
by its snapshot-relative [`media/cases/…` key](#case-media), with a `variant` of
`null` for a common reference or the variant slug for a variant-scoped one. The
site resolves those keys to absolute URLs.

Each variant carries its own fully rendered `prompt` and its own `seededInputs`,
the seeded spec bodies inlined in seed order, so the static site shows the same
instruction and specs a run is seeded with. A variant also names its deployed
reference implementation: a `referenceBuild` URL for a playable build, or a
`referenceSheet` of published frame indices whose object keys the site derives
itself. The file carries no mockup HTML and no host paths.

Only a version that at least one published run built is emitted. The site keys
lookups by `(slug, version)` from each run's subject, so it fetches exactly the
case files that are present.

This metadata is read from the backend's ingested definition store rather than
from the run record, which carries only the run's `(slug, version, variant)`
subject. The store is regenerable, and on a deployment where it lives on
ephemeral local disk a pod reschedule empties it until the ingest repopulates
it. A snapshot regenerated while the store is momentarily empty would emit each
published run with no case file for it, and the gallery would show a run with no
case to browse. To keep the snapshot self-consistent, an ingest that actually
(re)ingests a version queues a snapshot refresh, the same coalesced regeneration
a publish triggers. A no-op ingest does not, so the periodic refresh does not
rebuild the gallery on every cycle.

Schema:
[`snapshot/case.schema.json`](https://docs.testcabinet.ai/schema/snapshot/case.schema.json).

## `gg-runs.json` — the gg document corpus

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
