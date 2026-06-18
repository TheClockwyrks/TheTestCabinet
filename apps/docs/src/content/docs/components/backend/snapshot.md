---
title: Public Snapshot
---

The public snapshot is the dataset the [site](/components/site/overview/) is
built from. The backend is private, so rather than letting the site read it
directly, the backend **exports** its published runs to a public
[Cloudflare R2](https://developers.cloudflare.com/r2/) bucket and the site build
fetches that export. The [Overview](/components/backend/overview/#public-snapshot)
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
index.json                                           # top-level pointer (overwritten last)
snapshots/<snapshotId>/runs.json                     # the run index — summaries
snapshots/<snapshotId>/runs/<run-id>.json            # per-run: record + review + links
snapshots/<snapshotId>/cases/<slug>/<version>.json   # per-case-version metadata
```

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

A flat array of run **summaries**, newest first — enough for the gallery's cards
and its client-side filter (by test case, harness, model) without fetching every
per-run file. Each summary carries the run's id and timestamps, its
[subject](/components/core/run-records/#subject) and
[metrics](/components/core/metrics/) verbatim from the
[run record](/components/core/run-records/), the denormalized case name for
cards, the `validationLoaded` signal, the run state, the review `rating` (a
per-run badge, never aggregated), and the links. The site fetches full records
lazily, per run page.

Schema: [`snapshot/runs.schema.json`](https://docs.testcabinet.ai/schema/snapshot/runs.schema.json).

## `runs/<run-id>.json` — per-run record

The full [run record](/components/core/run-records/) blob, verbatim, with its
links populated, plus the [review](/components/core/results/#reviews) and links
the site needs for the detail page — where the writeup is gated ahead of the
embedded build and the rating is shown up front.

```jsonc
{
  "schemaVersion": 1,
  "record": { "…": "full RunRecord, links populated" },
  "review": { "rating": "great", "writeup": "Plays well, but the AI paddle…" },
  "links": {
    "sourceRepo": "https://github.com/…",
    "playableBuild": "https://abc123.test-cabinet-runs.pages.dev"
  }
}
```

Schema: [`snapshot/run.schema.json`](https://docs.testcabinet.ai/schema/snapshot/run.schema.json).

## `cases/<slug>/<version>.json` — case metadata

The site-facing slice of a [test case version](/components/core/test-cases/):
what the gallery shows to frame a run — name, difficulty, tags,
summary/description, variant labels, and the declared checks (without their
action lists). It carries **no** spec bodies, **no** mockup HTML, and **no** host
paths. Emitting only the case-versions that have a published run is sufficient;
emitting every ingested version is also valid. The site keys lookups by
`(slug, version)` from each run's subject.

Schema: [`snapshot/case.schema.json`](https://docs.testcabinet.ai/schema/snapshot/case.schema.json).
