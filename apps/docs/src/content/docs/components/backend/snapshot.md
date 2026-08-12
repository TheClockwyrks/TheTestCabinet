---
title: Public Snapshot
---

The public snapshot is the dataset the [site](/components/site/overview/) is
built from. The backend is private, so rather than letting the site read it
directly, the backend **exports** its published runs to a public
[Cloudflare R2](https://developers.cloudflare.com/r2/) bucket and the site build
fetches that export. The snapshot holds **only published runs** — a produced run
that has not yet been published is private and never appears here. The [Overview](/components/backend/overview/#public-snapshot)
covers why this boundary exists; this page is the authoritative contract for the
snapshot's **layout** — the cross-component surface between the backend that
writes it and the site that reads it.

The backend regenerates the whole snapshot from its full published set on each
(coalesced) publish, uploads it, and swaps it into place. Regenerating
everything rather than applying deltas keeps the operation idempotent.

The JSON documents (the index, run summaries, per-run records, case metadata) are
small and are rewritten every publish. **Media is not.** Two families of it live
outside any single snapshot's prefix, are uploaded **once**, and are referenced by
every later snapshot instead of being re-read and re-uploaded:

- A run's media — proof images/videos and an asset-generation run's produced
  images/logs — under [`media/runs/<run-id>/`](#run-media), keyed by the run id. It
  is immutable once a run is published.
- A case version's media — its rendered reference baselines and its committed
  validation baselines — under [`media/cases/<slug>/<version>/`](#case-media). A
  version with a published run is [frozen](/development/frozen-versions/), so this
  is effectively immutable too.

This is what keeps a publish cheap as runs and cases accumulate, and it lets a
publish keep a run's media even after the volumes the bytes were read from are gone.

## Atomic swap

A site build must never read a half-written dataset. To guarantee that, the
backend writes every file of a new snapshot under a content-addressed prefix
`snapshots/<snapshotId>/…` first, and writes the small top-level `index.json`
pointer **last**. Because `index.json` is a single small object, overwriting it
is the atomic cut-over: until that write lands, the site keeps reading the
previous snapshot, and a new snapshot never clobbers the previous one's files.
Superseded prefixes are [pruned](#pruning-superseded-generations) after a grace
period.

`<snapshotId>` is a timestamp-plus-hash, e.g. `2026-06-17T2148Z-1a7b`.

## Keys

```text
index.json                                                              # top-level pointer (overwritten last)
snapshots/<snapshotId>/runs.json                                        # the run index — summaries (published runs only)
snapshots/<snapshotId>/runs/<run-id>.json                               # per-run: record + reviews + links + media keys
snapshots/<snapshotId>/cases/<slug>/<version>.json                      # per-case-version metadata
media/runs/<run-id>/proof/<proof-id>.<ext>                              # a run's proof media (content-stable; shared across snapshots)
media/runs/<run-id>/asset/<file>                                        # an asset-generation run's produced media (same)
media/cases/<slug>/<version>/references/<scope>/<digest>-<view>.png     # rendered reference baselines (content-addressed)
media/cases/<slug>/<version>/validation-baseline/<variant>/<digest>-<file>  # committed validation baselines (same)
```

Only the **JSON documents** live under the per-snapshot `snapshots/<snapshotId>/`
prefix and are rewritten each publish. All media — run-scoped (see
[Run media](#run-media)) and case-scoped (see [Case media](#case-media)) — lives
under the snapshot-independent `media/` prefix and is written once. A per-run or
per-case document references its media by these snapshot-relative `media/…` keys, so
the atomic `index.json` swap still points a site build at a complete,
self-consistent dataset.

`<scope>` is `_common` for a reference shown on every variant, or a variant slug
for one scoped to that variant. Each case-metadata file names its baselines by
their snapshot-relative key (see [below](#casesslugversionjson--case-metadata)).

The site reads `index.json`, then follows its prefixes to the rest. Every file
carries a `schemaVersion` (currently `1`).

## `index.json` — the pointer

The top-level pointer and summary: the snapshot id, when it was generated, the
run count, and the keys/prefixes the rest of the snapshot lives under.

```jsonc
{
  "schemaVersion": 1,
  "snapshotId": "2026-06-17T2148Z-1a7b",
  "generatedAt": "2026-06-17T21:48:00Z",
  "runCount": 128,
  "runsKey": "snapshots/2026-06-17T2148Z-1a7b/runs.json",
  "runsPrefix": "snapshots/2026-06-17T2148Z-1a7b/runs/",
  "casesPrefix": "snapshots/2026-06-17T2148Z-1a7b/cases/"
}
```

Schema: [`snapshot/index.schema.json`](https://docs.testcabinet.ai/schema/snapshot/index.schema.json).

## `runs.json` — the run index

A flat array of run **summaries** (the `RunSummary` card), newest first — every
summary is a **published** run, enough for the gallery's cards and its
client-side filter/sort/paging (by test case, harness, model) without fetching
every per-run file. Each summary carries the run's id and timestamps, its
[subject](/components/core/run-records/#subject) (including the
[test type](/testing/overview/), so a card can label a run without its record) and
[metrics](/components/core/metrics/) verbatim from the
[run record](/components/core/run-records/), the denormalized case name for
cards, the `validationLoaded` signal, the run state, the aggregate `rating` (the
run's overall rating — the worst across every domain of every review — shown as a
per-run badge), a `reviewCount` of how many reviews the run carries, and the
links. The `rating` is nullable in the contract (an unrated console run carries
none), but the snapshot holds only reviewed runs, so it is always present here.
The aggregate **score** (the average across reviews) is not summarized here; the
site computes it client-side from the per-run file's reviews. The site fetches
full records lazily, per run page — the summary index is the whole dataset the
list, home, leaderboard, and metrics views read; a full record loads only when a
run's detail page opens.

Schema: [`snapshot/runs.schema.json`](https://docs.testcabinet.ai/schema/snapshot/runs.schema.json).

## `runs/<run-id>.json` — per-run record

The full [run record](/components/core/run-records/) blob, verbatim, with its
links populated, plus the **array of [reviews](/components/core/results/#reviews)**
and the links the site needs for the detail page — where each writeup is gated
ahead of the embedded build and the aggregate rating is shown up front. Every run
here is published, so `published` is always `true`. A run carries one or more
reviews (one per reviewer account); each entry includes the reviewer's id and
display name, so the site can attribute a writeup and per-domain ratings to the
person who wrote them. The site computes the run's **score** (the average across
reviews) and its **overall rating** (the worst across reviews) from this array. When
the run captured a normalized [event stream](/components/core/events/), it is
included as `events` (omitted otherwise); the site emits it as a per-run static
asset its Events tab fetches. Raw harness output is never published.

Because this document is published to the open internet, it is **scrubbed of
leaked secrets** as the snapshot is built: a model that dumped its environment can
have printed the run's provider API key into an event or a failure detail, so any
provider-shaped `sk-…` token anywhere in the record or events is replaced with
`[REDACTED]` before upload. The backend never holds a key value, so it redacts by
shape; the operator-side release scrubs the [source repository and playable
build](/components/core/results/#secret-redaction) by exact value as well. The
backend's own stored copy is left intact — it is private, and only this public
export is rewritten.

```jsonc
{
  "schemaVersion": 1,
  "record": { "…": "full RunRecord, links populated" },
  "published": true,
  "reviews": [
    {
      "reviewerId": "acct_7yq…",
      "reviewer": "Ada",
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

Schema: [`snapshot/run.schema.json`](https://docs.testcabinet.ai/schema/snapshot/run.schema.json).

## Run media

A per-run document names its media by snapshot-relative key: `proofMedia[]` for the
proof-of-implementation images/videos, `assetMedia[]` for an asset-generation run's
produced images and action logs. Those keys point under `media/runs/<run-id>/`, **not**
the per-snapshot prefix. A published run's media never changes, so it is keyed by the
run id and written **once**:

- On each publish the builder lists what is already under `media/` and, for any
  media object that is already there, references it in the per-run document **without
  reading the source bytes or re-uploading** — so a run's media is exported exactly
  once across all snapshots, and a video is transcoded ([webm→mp4](#atomic-swap), for
  iOS playback) exactly once.
- Only media not yet in the bucket is read (from the backend store, falling back to
  the [artifact service](/components/artifacts/overview/)) and uploaded.

Two consequences follow. First, a publish stays cheap as asset-generation runs
accumulate — it re-uploads only new media, not the entire corpus each time. Second,
because the media already in the bucket is referenced without needing its source
bytes, a publish keeps a run's media even when the volumes it was originally read from
have been lost — for example after a cluster is recreated, which wipes the backend
store (an ephemeral volume) and the artifact service's disk. To re-seed the bucket
from a prior snapshot in that recovery case, see
`scripts/recover-run-media-from-snapshot.sh`.

## Case media

A case-metadata file names its media the same way: `references[]` for the rendered
reference baselines and `validationBaselines[]` for the committed validation
baselines. Those keys point under `media/cases/<slug>/<version>/`, **not** the
per-snapshot prefix — the case-scoped counterpart of [run media](#run-media), and for
the same reason: a version that has a published run is
[frozen](/development/frozen-versions/), so re-uploading its baselines on every
publish is pure waste.

One difference from run media. A reference PNG is *rendered* from a committed mockup
at ingest rather than committed as bytes, so a re-ingest on a different browser build
can legitimately produce different bytes for the same view. Keying purely by
`(slug, version, view)` would pin the gallery to whichever render landed first, so
each object is instead **content-addressed** — its key carries a short digest of the
source bytes:

```text
media/cases/pong/v1.0.0/references/_common/3f2a9c1b8e04d75a-gameplay.png
```

Identical bytes therefore reuse the identical key and are skipped; genuinely changed
bytes mint a new key and are uploaded. Because the key is derived from the *source*
bytes, the decision is made before any work happens: a video baseline already in the
bucket costs neither an upload nor an ffmpeg transcode.

Computing the digest needs a local store read, which is cheap; it is the upload and
the transcode that the skip avoids.

## Pruning superseded generations

Every refresh writes a whole new `snapshots/<snapshotId>/` generation and cuts over
by overwriting `index.json`. Nothing can reach an earlier generation afterwards, so
after the cut-over the refresh **prunes** the ones that are done with. A generation is
deleted only when both:

1. It is **not** the one `index.json` points at. The live generation is never pruned,
   however old it is — a bucket whose live snapshot predates the retention window
   (nothing published in a while) must not have the site deleted out from under it.
2. It is older than `TCAB_SNAPSHOT_RETENTION_HOURS` (default `24`). A site build that
   already read `index.json` is still fetching that generation's files, so a
   just-superseded generation has to outlive the build it is serving.

A generation id that does not parse as a timestamp is kept rather than deleted on a
guess. The prune is **best-effort**: it runs after the snapshot is already live, so a
failure logs and leaves the work to the next refresh rather than failing the publish.

Without this the bucket grows by a full generation per publish and never shrinks —
which is exactly how it once reached ~7.8 GB of which 96% was unreachable. Run and
case media under `media/` are never generation-scoped and are not touched by the
prune; media orphaned by a *deleted* run is still a future cleanup.

Superseded snapshot generations *are* [pruned](#pruning-superseded-generations), but
the media prefix is not: a run's media at `media/runs/<run-id>/` is orphaned but
harmless once the run is deleted, since no snapshot references it. Pruning that is a
future cleanup.

## `cases/<slug>/<version>.json` — case metadata

The site-facing slice of a [test case version](/testing/end-to-end/overview/):
what the gallery shows to frame a run — name, difficulty, tags,
summary/description, variant labels, the rendered prompt, the seeded spec files
(bodies inlined), the declared checks (without their action lists), and a
`references` array naming each rendered reference baseline by its
snapshot-relative [`media/cases/…` key](#case-media) (with a `variant` of `null` for
a common reference or the variant slug for a variant-scoped one), which the site
resolves to absolute URLs to show baselines. The seeded specs are inlined in `commonSeededInputs` (shared by
every variant) and each variant's `seededInputs` (its own), in seed order, so the
fully static site shows the same specs a run is seeded with without a live
backend. It carries **no** mockup HTML and **no** host paths.

Only a version that **at least one published run built** is emitted — the gallery
is a gallery of published runs, so a case with no run has nothing to show. The
site keys lookups by `(slug, version)` from each run's subject, so it fetches
exactly the case files that are present.

This metadata is read from the backend's **ingested definition store**, not from
the run record (which carries only the run's `(slug, version, variant)` subject).
The store is regenerable — on a deployment where it lives on ephemeral local disk
(the managed-Postgres shape, where only Postgres is durable), a pod reschedule
empties it and the ingest sidecar re-populates it. So a snapshot regenerated while
the store is momentarily empty would emit each published run but **no** case file
for it, and the gallery would show the run with no case to browse. To keep the
snapshot self-consistent, **an ingest that actually (re)ingests a version queues a
snapshot refresh** — the same coalesced regeneration a publish triggers — so a
repopulated or edited catalog re-exports a corrected snapshot rather than leaving
the gallery frozen on one built while the store was empty. A no-op ingest (every
version already present and unchanged) does not, so the periodic refresh does not
rebuild the gallery on every cycle.

Schema: [`snapshot/case.schema.json`](https://docs.testcabinet.ai/schema/snapshot/case.schema.json).
