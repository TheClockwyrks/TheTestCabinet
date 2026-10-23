---
title: Results
---

## Overview

A run's value is in its output: the implementation a model produced, together
with the metrics describing how it got there. The Test Cabinet publishes both so
anyone can inspect, clone, and play the result. The final product is released as
it is, including any bugs and flaws.

A finished run reaches the public gallery through two separate steps, review and
publish, so that a model can be judged by someone other than the person who ran
it. A run's record is stored on the backend automatically when it finishes, so it
is reviewable as soon as it is produced. The public release of its code and build
happens at publish. On a
[validator-rated](/testing/end-to-end/evaluation/#rating-channels) run the
validators decide the functional rating and score at completion, so review may
follow publish. A review supplies the run's aesthetic rating and may override
individual verdicts.

## Generated code

Each published run whose model writes code, meaning every type except
asset-generation, is released as its own public git repository, pushed by the
[repos service](/components/repos/overview/) from the bundle the driver uploaded
at run end. Standalone repositories keep results independent and map cleanly
onto per-run hosting and embedding.

The generated implementation must include a README and any other documentation a
user needs to clone the repository and run it locally. Requiring that
documentation is part of every code-writing test case.

An [asset-generation](/testing/asset-generation/overview/) run is the exception.
Its authoritative output is the recorded sequence of operations, uploaded to the
[artifacts service](/components/artifacts/overview/) as the run's assets, so
publishing one creates no repository on GitHub and the run carries no source
link. The run folder is still a git repo, seeded
like any other. What the run uploads depends on its asset kind: a sprite or
sprite-sheet run uploads its regenerated images, and a model run uploads its
emitted geometry and rig so a reviewer can inspect the model interactively.

## Reference implementations

A test-case variant may ship a reference implementation: an authored, in-repo,
versioned, buildable static game that is the correct implementation of that
variant. It shows what a faithful build of the spec looks like.

A variant opts in with its optional
[`reference_implementation`](/testing/end-to-end/manifests/) key, naming either
one directory under the version folder that stands for every engine the case
supports, or one directory per engine slug (by convention
`references/<engine>/<variant>/`), since the build a reference demonstrates
differs under each engine. Each variant may declare its own correct build. Each
directory is built with the case's existing `[build]` commands run from it and
emits its static site into the same `dist/`, `build/`, or `out/` a run's build
does.

A reference implementation is never seeded into a run. It is the authored answer,
so it reaches the published gallery and nothing else.

A person deploys it out of band rather than as part of any run's lifecycle. The
[`tcab publish-reference`](/components/cli/overview/#commands) command builds
each of the variant's reference directories with the case `[build]` commands,
runs the same [secret-redaction](#secret-redaction) scrubber a run's publish
uses over the output, and deploys each to Cloudflare Pages. A required `--env`
selects prod's `test-cabinet-references` project or staging's
`test-cabinet-references-staging`, on a branch named
`<slug>-<version-with-dots-as-dashes>-<variant>-<engine>`, since a variant's
builds on two engines are two deploys. Cloudflare truncates long subdomains, so
the served URL is read back from `wrangler`'s output rather than constructed.

### Recording a reference build

Recording the URL follows a pull model, since the remote backends are private and
nothing off-cluster can write to them. `publish-reference` writes each URL into a
committed lockfile, `test-cases/reference-builds.lock.json`, keyed by environment
first, since prod and staging deploy to different Pages projects.

The backend ingests that lockfile from its own git checkout on the next
re-ingest, reads the entries for its own `TCAB_ENV`, and reconciles the
`case_reference_build` table, keyed by `(slug, version, variant, engine)`, to
match. It upserts each URL and prunes any the lockfile no longer lists.

A version's `GET /test-cases/{slug}/versions/{version}` response carries each
variant's `referenceBuilds` map, keyed by engine, and the public snapshot
serializes it as the same field. A case page offers the build recorded for its
variant and engine.

### Script references (asset generation)

An asset-generation case has no `[build]` table and produces no site, so it
records no Pages URL. It uses the same `reference_implementation` key.

Its reference is a `draw.sh` containing nothing but calls to the case's drawing
binary, drawing the correct sheet the same one-operation-at-a-time way a model
must. [`tcab publish-asset-reference`](/components/cli/overview/#commands) seeds
a workspace from the case manifest through the real seeding path, runs that
script, and writes each frame's rendered image and its recorded action log to
the public bucket under `media/references/<slug>/<version>/<variant>/frames/`,
through the artifacts service's `PUT /public/{key}` with an Access service
token. The log travels with the image because the log is what a run is scored
on.

The script is the only source of truth for both the images and the logs and
reproduces both exactly, so neither is committed. Object-store keys are
constructible, so the backend discovers references at ingest by listing
`media/references/` through the artifacts service's `GET /public?prefix=` and
reconciling a `case_reference_sheet` table. A reference sheet is
rendered from the variant's `referenceSheet` and its published frame indices.

### Bundled references (performance)

A [performance](/testing/performance/overview/) case produces an engine rather
than a site or an image, so its reference is what the authoritative engine does:
the case's scored scenarios, simulated in the browser. It takes no
`reference_implementation` key and no publish step. The reference engine and the
scenarios are vendored into the UI bundle from the case's replay bundle, so it
needs no backend and no snapshot bucket. It is offered off the case rather than a
variant. See [the performance
reference](/testing/performance/lattice/architecture/#the-reference-tab).

A reference implementation is distinct from a reference visual mockup, the
[`[[reference]]`](/testing/end-to-end/manifests/) views. A mockup is a rendered
screenshot of a single view, seeded into the run as a static target the model
builds toward and used as the baseline for a validation check, and it includes no
source. A reference implementation is the whole playable game, is never seeded,
and is deployed and shown as a live build.

## Run record

Each finished run's [run record](/components/contracts/run-records/) is
uploaded to the [backend](/components/backend/overview/), with its links
pointing at the run's source repository and playable build. The backend is the
system of record for runs, and the [public site](/components/site/overview/)
reads the [public dataset](/components/backend/snapshot/) the backend writes.

## Lifecycle

A run reaches the gallery through the automatic storage every produced run gets
when it finishes, followed by publishing. A completed validator-rated run
[publishes itself](#automatic-publishing), and every other publishable run is
published by an operator. Review is a separate step that a legacy run needs
before it can be published and that stays optional on a validator-rated run.

### Automatic storage

A run needs no operator action to become reviewable. When the
[driver](/components/driver/overview/) finishes a run it uploads the produced
tree, meaning the playable build together with proof and asset media, to the
[artifacts service](/components/artifacts/overview/) and the implementation's
git bundle to the [repos service](/components/repos/overview/), then reports the
produced [run record](/components/contracts/run-records/) to the backend, which
stores it privately. The run is stored
but absent from the public gallery, and its build is playable for review
straight off the artifacts service.

### Review

Anyone the [Access policy](/components/backend/overview/#identity) admits plays
the run's build and submits a [review](#reviews). The reviewer is typically
someone other than the operator who produced the run. On a validator-rated run
that is a writeup, one aesthetic rating for the whole run, and any checklist
verdicts the reviewer chose to override. On a legacy run it is a writeup, a
functional rating per scoring domain, and the checklist verdicts. Every review
is attributed to the Access identity that wrote it.

A run may carry multiple reviews, one per reviewer identity. Submitting a second
review replaces the reviewer's own.

### Publish

Publishing releases a run and flips it public. It is the only point at which a
run's outputs cross onto the open internet, and it is irreversible: a published
run cannot be deleted, and its repository and its build stay public. What it
requires depends on the run's
[terminal state](/components/contracts/run-records/#status):

- A `completed` validator-rated run is publishable as soon as it completes, with
  or without a review, since its functional rating and score stand on the run
  record. A `completed` legacy run is published through review: the backend
  refuses with `422` to publish one that has no review.
- A `catastrophic` or `timed_out` run is a publishable model failure. It has no
  review checklist to complete, so publishing it needs no review.
- A `harness_error` run likewise needs no review, but it is a statistic-only
  publish. It releases no source repository and no playable build, and is
  recorded as a per-model harness-error rate. A subscription auth-token refresh
  also surfaces as a harness non-zero exit, so publishing is deliberate: an
  operator records each real harness error and leaves the auth-refresh ones
  unpublished.
- A `hung` run publishes exactly like a `harness_error`.
- A `limit_exceeded` run publishes exactly like a `harness_error` too. The
  harness stopped it on an [execution ceiling](/gg/execution-limits/) its
  configuration armed, which is the model's outcome against that ceiling.
- An `infrastructure` failure is the Test Cabinet's own fault and is never
  publishable (`422`), whatever reviews it carries.
- A `canceled` run is likewise never publishable (`422`). A killed gg run is
  retained for inspection only, and a killed run of any other harness leaves no
  record at all.

Publishing is asynchronous. The backend gates the run and enqueues a per-publish
`tcab-publisher` Job, which the [dispatcher](/components/dispatcher/overview/)
admits in its publish lane. The Job, the `microservice-publisher` repository's
binary:

1. Fetches the build output from the artifacts service (`tree.tar`), with its
   per-publish-job token.
2. Deploys the static build to the per-run Cloudflare Pages project
   (`wrangler pages deploy <dir> --branch=<run-id>`), after scrubbing it, which
   serves it at its own `pages.dev` subdomain root, keeping the build playable
   exactly as the test case's [build
   interface](/testing/end-to-end/overview/#design-requirements) and the [load
   check](/components/driver/validation/#load-check) require.
3. Calls `POST /runs/{id}/publish` on the repos service, which creates the
   run's public repository and pushes the scrubbed bundle to it, skipped for an
   asset-generation run.
4. Reports both links to the backend.

Once the Job reports a terminal success the backend marks the run published,
records the links, mints the run's
[short code](/components/backend/overview/#short-codes) and writes its object,
has the artifacts service copy the run's media to the public bucket, then writes
the run's document and the updated index objects through it, swapping the
`index.json` pointer last. The publisher holds the Cloudflare credential alone;
the GitHub credential is the repos service's.

#### Repeating a step

A publish is resumable and idempotent. Every step of the publisher's sequence is
safe to repeat, so a publish that stopped at any point is finished by running the
sequence again from the start, and a repeated step reaches the state its first
run reached and reports the same links.

- The publisher first asks the backend whether the run is already published.
  When it is, the publisher reports the links the run carries and does nothing
  else.
- The download is a read, and a repeat fetches the same tree.
- The Pages deploy makes one deployment per run. The publisher deploys with the
  digest of the scrubbed build as the deployment's commit hash, and first looks
  up the run's branch for a deployment carrying that digest. A deployment it
  finds is reused and its URL reported.
- The repository publish is deterministic, as the repos service's
  [publishing](/components/repos/overview/#publishing) states: the commit is
  made from the run's tree with a fixed message, author and date, so a repeat
  reproduces its SHA, and a push whose remote already holds the same tree is a
  success.
- The backend accepts the result more than once. A repeated success re-asserts
  the same links and keeps the run's publication time.

Each step that reaches over the network retries a transient failure with backoff
before the publish fails: the download, the Pages deploy, the repository publish
and the result report.

#### A publisher that stops

On `SIGTERM` the publisher starts no further step. It finishes the step it is on
when that step ends within the pod's termination grace period, and otherwise
abandons it, which leaves it repeatable. It then reports the publish failed with
the reason that the publisher was interrupted, and the failure is retried like
any other.

A publisher that ends without reporting is recognised by three bounds:

- The dispatcher's [death detection](/components/dispatcher/overview/#lost-drivers)
  covers publisher Jobs as it covers driver Jobs. A publish job held
  `dispatched` with no active publisher Job for two minutes is reported lost,
  and the backend records it failed.
- The dispatcher gives every publisher Job an `activeDeadlineSeconds` of 45
  minutes, which ends a publisher that has hung.
- The backend records a publish job that has been `dispatched` for an hour with
  no result as failed, with the reason that its publisher never reported. It is
  recorded as having failed at that hour, so a job abandoned long ago takes its
  place in the order of events. The hour outlasts the deadline, so the sweep
  never fails a job whose publisher is still running.

#### Retrying a failed publish

A release that does not land records its reason on the publish job and raises a
publish-failed notification on the console, and the backend enqueues another
publish job for the run by itself. The retry applies to every unpublished run
whose latest publish job failed, whether automatic publishing or an operator
enqueued that job, and a run has at most one publish job in flight at any time.

| Consecutive failures of the run | Wait after the latest failure |
| ------------------------------- | ----------------------------- |
| 1                               | 5 minutes                     |
| 2                               | 10 minutes                    |
| 3                               | 20 minutes                    |
| n                               | 5 minutes doubled n - 1 times |
| 7 and above                     | 4 hours                       |

Before each retry the backend applies the publish gate again as the run stands
now, so a run that stopped being publishable after its publish failed is left
unpublished.

The retries of a run end 24 hours after its first failed publish job. The run
then waits in the console's [Unpublished
worklist](/components/web/overview/#the-runs-section) for an operator. An
operator's publish is accepted at any time, whatever the run's wait or age, and
a publish job it enqueues that fails counts as one more consecutive failure.

### Automatic publishing

A validator-rated run's functional rating is decided by its validators, so the
backend publishes it without waiting for anyone. A run publishes itself when all
of these hold:

- its terminal state is `completed`;
- its case version is
  [validator-rated](/terminology/#validator-rated);
- it is unpublished;
- no publish job has ever been enqueued for it.

Every other run stays manual. A `catastrophic`, `timed_out`, `hung`,
`harness_error` or `limit_exceeded` run is published deliberately by an
operator, a legacy run is published through review, and an `infrastructure` or
`canceled` run is never published.

The rule applies to every run however it was launched: from the run form, by a
coverage plan, by a ladder, or as a comparison's arm. The backend applies it at
two moments:

- When a driver reports a run's terminal status. The run's record is stored and
  its validator rating decided within that report, so the run is enqueued for
  publishing as the report is accepted. A report that stores the record again
  applies the rule again, which publishes a run whose case version the backend
  did not hold the first time.
- When a [ladder](/components/backend/ladders/#a-rung-slots-runs) launch pass
  reads a rung slot's runs. A run the dispatch counts is enqueued for publishing
  even when another launch produced it.

Automatic publishing enqueues the same publish job an operator's publish does,
and at most one for a run. At these moments a run that already has a publish job
in any state is left alone, and a run whose publish job failed is taken up by
the [retry of failed publishes](#retrying-a-failed-publish). An automatic
publish that cannot be enqueued is logged and never fails the report or the pass
that prompted it.

Only published runs appear in the public dataset and therefore in the gallery. A
published catastrophic or timeout failure shows its generated source and has no
playable build, and its outcome is reported as a per-model statistic separate
from the score that ranks workable runs. A published `harness_error`,
`limit_exceeded` or `hung` run shows no source and no build at all and is purely
a per-model statistic.

A model's published runs are counted as completed against the publishable
failure tiers, namely catastrophic failures, timeouts, harness errors, execution
ceilings, and hangs. `infrastructure` and `canceled` runs are absent from every
model statistic, since neither is a model outcome.

The backend performs publish and the dataset writes it triggers as the
synchronized half of the lifecycle, so two operators publishing at once cannot
race on the store or the index objects. See [the
backend](/components/backend/overview/#review-and-publish).

#### Secret redaction

A run executes with a real provider API key in its container, so a model that
dumps its environment can write that key into a source file it produced. The
backend a run streams to is private and trusted and keeps the captured data
as-is. The exposure is where a run's data crosses into the open internet, so
publishing redacts secrets at each public-egress point, with the one scrubber
the contracts' `redact` crate provides:

- The public source repository. Before the repos service commits and pushes the
  bundle's tree, every file is scanned and any leaked key is rewritten in place.
- The Cloudflare Pages build. Before the publisher deploys the static output,
  the built tree is scanned the same way, in case a key was carried through the
  build into an emitted asset.

The scrubber matches any provider-shaped `sk-…` token, anchored to the `sk-`
prefix and requiring a long enough body, along with the exact values of the
key-named environment variables the contract lists where the scrubbing process
holds them. Each match is replaced with `[REDACTED]`. A JSON document is
scrubbed in its object keys as well as its strings, since a tool call's
arguments carry keys the model wrote; two keys of one object that redact to the
same text are told apart by a number appended to the later one. The third public surface,
the run's record and event stream in the public dataset, is scrubbed by the
backend as it writes the run's document; see [the per-run
record](/components/backend/snapshot/#run-documents).

Review and publish are each submitted from the console under the caller's
Access identity (see [Identity](/components/backend/overview/#identity)).

## Reviews

A reviewed run carries one or more hand-written reviews. A single review is a
short [writeup](/components/site/overview/#implementation-writeups) together with
the reviewer's ratings and identity. Which [rating
channel](/testing/end-to-end/evaluation/#rating-channels) the reviewer rates
depends on the run:

- On a validator-rated run the review carries one aesthetic rating for the whole
  run. The checklist arrives decided by the validators, and the review may carry
  an override for any point's verdict. A point it leaves alone keeps the
  validator's verdict (see [The checklist](#the-checklist)).
- On a legacy run the review carries a functional rating per domain and a
  checklist of verdicts on the items the test case asked the reviewer to check.
  The verdicts and the items' point weights produce that review's numeric score.

A review is authored separately by a person after playing the finished build
rather than emitted by a run, and is not part of the [run
record](/components/contracts/run-records/) contract. Its reviewer identity is
the Access assertion's email. The ratings and checklist
verdicts travel with the writeup, in its frontmatter. A review must carry at
least one rating or verdict. Publishing makes a run's reviews available to the
site alongside the run record.

Which types are reviewed, and whether a reviewed type carries a checklist, varies
by test type. A
[performance](/testing/performance/evaluation/#no-human-review) run is graded
entirely by its validator, on correctness against a reference oracle and then the
fuel a correct engine burned, so it declares no scoring domains or checklist
items and carries no review at all. An
[asset-generation](/testing/asset-generation/evaluation/#review) run is reviewed
by a person on a single overall rating with no checklist, because a produced
asset is judged as a whole against its brief, so the case declares one `overall`
domain and no items and the run carries a rating and a writeup but no point
score.

### The checklist

The checklist records a verdict, with an optional note, for each reviewer
checklist item the test case version declares (see the version manifest's
[`review_item`s](/testing/end-to-end/manifests/)). An item that declares
[sub-items](/testing/end-to-end/manifests/#sub-items) is verdicted per sub-item,
each recorded under the composite id `<item id>.<sub-item id>`.

On a validator-rated run the verdicts are the validators', held on the run
record. A review may override any declared point with a binary `pass` or `fail`
and an optional note, and may decide a point the validators left undecided. Its
checklist carries only those overrides, and every point it leaves alone keeps the
validator's verdict. Overriding is the exception, for a validator whose
precondition could not be met in the world the build invented or a build that
clearly does the right thing despite broken instrumentation. A review's effective
checklist is the validators' verdicts overlaid with its own overrides, and its
score and functional rating are derived from that effective checklist.

On a legacy run every declared item and sub-item must carry a verdict before a
review can be submitted.

A binary item is judged `pass` or `fail`. Graded as a whole it earns its full
weight on a `pass` and none on a `fail`. Graded by sub-items, each sub-item earns
its own declared weight when it passes, and the item's weight is the sum of its
sub-items' weights, so sub-items within one item can be weighted independently.

A [game-jam](/testing/game-jam/overview/) case grades its items on a five-level
scale instead: `broken`, `poor`, `neutral`, `great`, and `incredible`, worth 0,
2, 5, 8, and 10 points. A graded item's available points are ten times its
weight, and it earns its tier's points times its weight. A reserved `overall`
verdict carries the reviewer's whole-game mark on the same scale.

A review's score is the earned weight over the total declared weight. On a
validator-rated run both sides of that ratio include only the points that have an
effective verdict, so a point nothing decided costs the build nothing while some
other scored point is decided. An effective checklist that decides no scored point
scores zero over the declared weight of every scored point. An item excluded from
scoring for the version, through an erratum, contributes to neither side of the
ratio while remaining visible and checked.

### Ratings

A case declares one or more common scoring domains, for example a game's
single-player and versus modes, and the run's variant may add its own. The
functional channel is rated per domain in the run variant's effective set,
meaning the common domains plus that variant's own. The aesthetic channel is one
tier for the whole run.

- The functional rating, in descending order of fidelity to the spec, is
  `flawless`, `great`, `passable`, `scuffed`, or `broken`. On a validator-rated
  run each domain's rating is decided from a review's effective checklist and
  each failing item's failure cap, as
  [Evaluation](/testing/end-to-end/evaluation/#the-validator-decided-functional-rating)
  specifies, and an effective checklist that decides no scored point rates every
  domain `broken`. On a legacy run the reviewer assigns it.
- The aesthetic rating, best to worst, is `legendary`, `amazing`, `good`, `okay`,
  or `slop`. It is one judgement about how the whole build looks, sounds, and
  feels to play, so a review carries a single tier for the run. The reviewer
  assigns it on a validator-rated run; a legacy run has none.

Within one review the overall functional rating is the worst across the domains.
What each reviewer-given tier means is reviewer judgement rather than anything a
run emits. The criteria for choosing one are stated in [Reviewing Test Run
Results](/guides/development/reviewing-test-run-results/).

### Aggregating across reviews

A published run may carry several reviews, so the numbers reported for the run
are aggregated across them:

- The run's score is the average of its reviews' scores. On a legacy run that is
  each review's earned weight over the shared total declared weight. On a
  validator-rated run it is each review's effective-checklist score, so a review
  with no overrides reproduces the validators' figure exactly. While a
  validator-rated run has no reviews, the validators' own score stands, which is
  zero over the declared weight when they decided no scored point.
- The run's functional rating is the worst across all of its reviews: the worst
  across domains within each review, then the worst of those across reviews. On a
  validator-rated run each review's rating is derived from its effective
  checklist, the validators' own rating stands while the run has no reviews
  (`broken` when they decided no scored point), and the
  [toolchain gate](/components/driver/validation/#the-toolchain-gate) applies to the
  aggregate.
- The run's aesthetic rating is the worst run-wide tier across its reviews. A
  validator-rated run with no review has a functional rating and score and no
  aesthetic rating.

Each test case's [leaderboard](/components/site/overview/#leaderboard) ranks
models by the aggregate score.
