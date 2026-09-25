---
title: "Publishing"
---

Publishing puts a comparison, and optionally the runs behind it, on the public
site, so a reader can drill from the comparison into an individual run.
Comparisons are created and run from the web console; the public site renders them read-only.

## Published objects

The comparison record itself: its controls, arms, aggregated
[statistics](/comparisons/statistics/), and
[diagnostics](/comparisons/diagnostics/), folded into the public [R2
snapshot](/components/backend/snapshot/).

The runs behind it, each published like any other run, so a reader can open a
single run's full record, events, and per-run diagnostics.

## Run publishing

Publishing a run is a full release. Each published run spawns a per-publish
`tcab-publisher` pod that creates a public GitHub repo for the source and a
Cloudflare Pages deploy for the playable build
(`crates/publisher/src/publish.rs`). Publishing a comparison's runs therefore
means one pod, repo, and deploy per run, against GitHub and Cloudflare rate
limits.

`POST /comparisons/{id}/publish` enqueues one publish job per arm run and lets
the dispatcher drain them through the existing queue (`POST /publish-jobs/next`
→ pod → `POST /publish-jobs/{id}/result`). Run ids are deduplicated across arms
first, so a run shared by two arms is published once.

The publish is best-effort per run. A run that cannot be published is skipped
and reported in the response as a `runId` with a reason, rather than failing the
whole publish, and the console shows the skipped runs so a partially-published
comparison never reads as if every run is inspectable.

Asset-generation runs release no repo, but a playable
[end-to-end](/testing/end-to-end/overview/) comparison run does the full GitHub
and Cloudflare release, so the heavy case is the one to budget for.

## Review gate

A completed legacy run needs at least one human
[review](/components/core/results/#reviews) before it can be published;
`gate_publishable` (`crates/backend/src/db.rs`) rejects a zero-review completed
legacy run. A completed
[validator-rated](/testing/end-to-end/evaluation/#rating-channels) run and the
publishable failure states (catastrophic, timed out, harness error) are
admitted through the same gate with no review: the former carries its
validators' rating and score, and the latter have no checklist to complete.

A comparison run is scored from its [automated
validators](/comparisons/experiments/#automated-only-scoring) and is designed to
skip human review, so the comparison publish path passes `allow_auto_validated`
and the gate waives the review requirement for a run that carries at least one
automated verdict. A run with no automated verdicts is still refused, because
nothing stands in for the missing review. Every other publish path keeps the
review requirement.

The single lever for "this run is public" remains `run.published`, and
`all_published()` remains the only filter deciding
[snapshot](/components/backend/snapshot/) membership.

### Runs without reviews

The public UI renders a run that carries no reviewer verdict. The run's default
tab states that no manual review has been written, the reviewer list is guarded
on the review count, and the aggregate `rating` and `score` fields resolve to
nothing. The run's automated validation results stay available on its own tabs.

## Rendering the comparison on the public site

A published comparison is folded into the snapshot, like a game-jam aggregate.

The snapshot builder (`crates/backend/src/snapshot.rs`) emits one document per
comparison at `<prefix>/comparisons/<id>.json` plus a `comparisons.json` index,
scrubbed like every other public object. Each is assembled by the same
`assemble_comparison` the internal `/comparisons` API uses, over the whole
experiment's runs rather than only the published ones, so the public numbers
match the console's exactly.

The static site reads those objects at build time
(`apps/site/vite-plugin-snapshot.ts` and `apps/site/src/staticGallery.ts`),
exactly as it inlines runs and cases. A snapshot published without a comparisons
index renders as no comparisons rather than failing the build.

The pages under `packages/ui/src/app/pages/comparisons/` render for both hosts.
Create, edit, trigger, and publish affordances are gated on `canExecute`
(`GalleryDataInput`), which is true in the web console and false on the static
site, so the same page is interactive internally and read-only publicly.

## Publish flow

1. An operator builds and runs a [comparison](/comparisons/experiments/)
   internally, and its arms fill with auto-validated runs.
2. The operator publishes it. The comparison is marked published, a publish job
   is enqueued per publishable arm run, and the snapshot debounce is woken.
3. The dispatcher drains the publish jobs. Each completed publish flips
   `run.published` and wakes the snapshot debounce again.
4. The [publisher](/components/backend/snapshot/) regenerates the R2 snapshot
   with the comparison and its published runs, and fires the Cloudflare Pages
   deploy hook. The public site rebuilds and the comparison is live, read-only.
