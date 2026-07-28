---
title: "Publishing"
---

A comparison is only valuable if a reader can see it. This layer publishes the
comparison — and, optionally, the full batch of runs behind it — to the public
site, so a reader who wants to go deeper can drill from the comparison into an
individual run. Comparisons are **created and run only** from the internal console
and Tauri app; on the public site they are **read-only**.

## Two things get published

1. **The comparison record** itself — its controls, arms, aggregated
   [statistics](/comparisons/statistics/), and [diagnostics](/comparisons/diagnostics/)
   — folded into the public [R2 snapshot](/components/backend/snapshot/).
2. **The batch of runs** behind it (optionally), each published like any other run
   so the reader can open a single run's full record, events, and per-run
   diagnostics.

## Publishing the runs is a batch of ordinary publishes

Publishing a run is **not** a cheap flag flip. Each published run spawns a
per-publish `tcab-publisher` pod that runs the real release: a public GitHub repo
for the source and a Cloudflare Pages deploy for the playable build
(`crates/publisher/src/publish.rs`). So publishing a comparison's runs means _N ×
(arms)_ pods, repos, and deploys — heavy and rate-limit-sensitive against GitHub
and Cloudflare.

Consequences for the design:

- There is **no cheap bulk path** and there should be no illusion of one. Batch
  publish **enqueues one publish job per run** and lets the dispatcher drain them
  through the existing queue (`POST /publish-jobs/next` → pod → `POST
  /publish-jobs/{id}/result`). A new endpoint (e.g. `POST /comparisons/{id}/publish`)
  that enqueues the jobs is the natural fit; do not loop synchronous publishes.
- Because it is expensive, batch publish should be **selective**: let the operator
  publish all runs, or a representative subset (for instance, drop failed runs, or
  publish _k_ per arm), and **[log what was left unpublished](/comparisons/statistics/)**
  so a partially-published comparison never reads as if every run is inspectable.

Asset-generation runs release no repo, but a playable [end-to-end](/testing/end-to-end/overview/)
comparison run does the full gh + wrangler release, so budget for the heavy case.

## The review gate is waived for auto-validated runs

Normally a `completed` run needs **at least one human [review](/components/core/results/#reviews)**
before it can be published — `gate_publishable` (`crates/backend/src/db.rs`) rejects
a zero-review completed run. But the codebase **already** publishes zero-review
runs: `publishable_failure_states` (catastrophic / timed-out / harness-error runs)
are a sanctioned waiver, admitted through the same gate with no review.

A comparison run carries an [automated-only score](/comparisons/experiments/#automated-only-scoring)
and is designed to skip human review, so it needs the **same kind of waiver**:
extend `gate_publishable` with an "auto-validated comparison run" predicate rather
than inventing a parallel publish concept. The single lever for "this run is
public" stays `run.published = true`; **`all_published()`** (`published = true`
only) remains the exact and only filter that decides
[snapshot](/components/backend/snapshot/) membership.

### Zero-review runs already render

No public-UI work is needed to show a review-less run. The site already renders
performance, adversarial, and failure-state runs that carry no reviewer verdict —
`RunVerdictPage` reads as **"Results"** (the auto-scored outcome _is_ the verdict)
rather than "Verdict," and every reviewer list is guarded on `reviews.length`. A
published comparison run with only auto-verdicts renders correctly through the
existing paths; the aggregate `rating`/`score` fields already degrade to `None`
when a run has no reviews.

## Rendering the comparison on the public site

The comparison record follows the **game-jam aggregate** precedent — a named
aggregate that _is_ folded into the snapshot and rendered in the gallery — not the
**tournament** precedent, which is live-only and never enters the snapshot.

- **Snapshot:** `SnapshotBuilder::build` (`crates/backend/src/snapshot.rs`) emits
  new comparison objects (e.g. `snapshots/<id>/comparisons/…` plus an index),
  scrubbed like every other public object.
- **Static site ingestion:** `apps/site/vite-plugin-snapshot.ts` and
  `staticGallery.ts` are extended to read those objects at build time, exactly as
  they already inline runs and cases.
- **Shared UI:** a new page under `packages/ui/src/app/pages/comparisons/` renders
  the comparison for both hosts. Create/run affordances are gated on
  **`canExecute`** (`GalleryDataInput`), which is `true` in the console/Tauri
  (`useLiveGallery`) and `false` on the static site (`useStaticGallery`) — so the
  same page is interactive internally and read-only publicly, with no per-route
  auth needed on the static site.

## Publish flow summary

1. Operator builds and runs a [comparison](/comparisons/experiments/) internally;
   arms fill with auto-validated runs.
2. Operator publishes the comparison. The comparison record is stored and the
   snapshot is marked dirty; optionally, a publish job is enqueued **per selected
   run**.
3. The dispatcher drains the run publish jobs (pods → repos → deploys); each
   completed publish flips `run.published` and re-marks the snapshot dirty.
4. The debounced [publisher](/components/backend/snapshot/) regenerates the R2
   snapshot — now including the comparison and its published runs — and fires the
   Cloudflare Pages deploy hook. The public site rebuilds and the comparison is
   live, read-only.
