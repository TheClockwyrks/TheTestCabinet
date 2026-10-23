---
title: "Publishing"
---

Publishing puts a comparison, and optionally the runs behind it, on the public
gallery, so a reader can drill from the comparison into an individual run.
Comparisons are created and run from the console; the public gallery
renders them read-only.

## Published objects

The comparison record itself: its controls, arms, aggregated
[statistics](/comparisons/statistics/), and
[diagnostics](/comparisons/diagnostics/), written into the public
[snapshot](/components/backend/snapshot/).

The runs behind it, each published like any other run, so a reader can open a
single run's full record, events, and per-run diagnostics.

## Run publishing

Publishing a run is a full release. Each published run is one publish Job, run
by `microservice-publisher`, which fetches the run's build output from the
[artifacts service](/components/artifacts/overview/), deploys it to Cloudflare
Pages, and has the [repos service](/components/repos/overview/) push the run's
implementation to its public GitHub repository; see
[Publish](/components/backend/results/#publish). Publishing a comparison's runs
therefore means one Job, repository, and deploy per run, against GitHub and
Cloudflare rate limits.

`POST /comparisons/{id}/publish` enqueues one publish job per
[counted](/comparisons/experiments/#which-runs-an-arm-holds) arm run and lets
the dispatcher drain them through the publish lane (`POST /publish-jobs/next`
→ Job → `POST /publish-jobs/{id}/result`). Run ids are deduplicated across arms
first, so a run shared by two arms is published once.

A completed validator-rated arm run
[publishes itself](/components/backend/results/#automatic-publishing) when it
finishes, so most of an arm's runs are public or releasing before the
comparison is published. The comparison publish enqueues nothing for a run that
is already published, and a run whose release is under way keeps the job it
has. The response's `enqueued` list names only the runs this publish enqueued.

The publish is best-effort per run. A run that cannot be published is skipped
and reported in the response as a `runId` with a reason, rather than failing the
whole publish, and the console shows the skipped runs so a partially-published
comparison never reads as if every run is inspectable.

Asset-generation runs release no repo, but a playable
[end-to-end](/testing/end-to-end/overview/) comparison run does the full GitHub
and Cloudflare release, so the heavy case is the one to budget for.

## Review gate

A completed legacy run needs at least one human
[review](/components/backend/results/#reviews) before it can be published;
`gate_publishable` in `microservice-backend` rejects a zero-review completed
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

## Rendering the comparison on the public gallery

A published comparison is written into the snapshot, like a game-jam aggregate.

The snapshot writer in `microservice-backend` emits one document per comparison
at `<prefix>/comparisons/<id>.json` plus a `comparisons.json` index, scrubbed
like every other public object and written through the artifacts service. Each
is assembled by the same `assemble_comparison` the internal `/comparisons` API
uses, over the whole experiment's runs rather than only the published ones, so
the public numbers match the console's exactly.

The gallery reads the comparison index from the bucket and fetches each document
by key, exactly as it reads runs and cases. An empty index renders as no
comparisons.

The pages under `packages/ui/src/app/pages/comparisons/` in `ui-common` render
for both hosts. Create, edit, trigger, and publish affordances are gated on
`canExecute` (`GalleryDataInput`), which is true in the console and false on
the gallery, so the same page is interactive internally and read-only publicly.

## Publish flow

1. An operator builds and runs a [comparison](/comparisons/experiments/)
   internally, and its arms fill with auto-validated runs.
2. The operator publishes it. The comparison is marked published and a publish
   job is enqueued per publishable arm run.
3. The dispatcher drains the publish jobs. Each completed publish marks its run
   published and writes the run's document, media, and short code into the
   bucket.
4. The backend writes the comparison's document and the updated index objects
   through the artifacts service and swaps the `index.json` pointer. The gallery
   reads the bucket at request time, so the comparison is live and read-only.
