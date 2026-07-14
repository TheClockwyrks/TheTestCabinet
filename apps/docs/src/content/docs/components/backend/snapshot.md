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

## Atomic swap

A site build must never read a half-written dataset. To guarantee that, the
backend writes every file of a new snapshot under a content-addressed prefix
`snapshots/<snapshotId>/…` first, and writes the small top-level `index.json`
pointer **last**. Because `index.json` is a single small object, overwriting it
is the atomic cut-over: until that write lands, the site keeps reading the
previous snapshot, and a new snapshot never clobbers the previous one's files.
Old prefixes can be garbage-collected after a grace period.

`<snapshotId>` is a timestamp-plus-hash, e.g. `2026-06-17T2148Z-1a7b`.

## Keys

```text
index.json                                                              # top-level pointer (overwritten last)
snapshots/<snapshotId>/runs.json                                        # the run index — summaries (published runs only)
snapshots/<snapshotId>/runs/<run-id>.json                               # per-run: record + reviews + links
snapshots/<snapshotId>/cases/<slug>/<version>.json                      # per-case-version metadata
snapshots/<snapshotId>/cases/<slug>/<version>/references/<scope>/<view>.png  # rendered reference baselines
```

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

## `cases/<slug>/<version>.json` — case metadata

The site-facing slice of a [test case version](/testing/end-to-end/overview/):
what the gallery shows to frame a run — name, difficulty, tags,
summary/description, variant labels, the rendered prompt, the seeded spec files
(bodies inlined), the declared checks (without their action lists), and a
`references` array naming each rendered reference baseline by its
snapshot-relative key (with a `variant` of `null` for a common reference or the
variant slug for a variant-scoped one), which the site resolves to absolute URLs
to show baselines. The seeded specs are inlined in `commonSeededInputs` (shared by
every variant) and each variant's `seededInputs` (its own), in seed order, so the
fully static site shows the same specs a run is seeded with without a live
backend. It carries **no** mockup HTML and **no** host paths.

Only a version that **at least one published run built** is emitted — the gallery
is a gallery of published runs, so a case with no run has nothing to show. The
site keys lookups by `(slug, version)` from each run's subject, so it fetches
exactly the case files that are present.

Schema: [`snapshot/case.schema.json`](https://docs.testcabinet.ai/schema/snapshot/case.schema.json).
