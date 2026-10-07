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
asset-generation, is released as its own public git repository. Standalone
repositories keep results independent and map cleanly onto per-run hosting and
embedding.

The generated implementation must include a README and any other documentation a
user needs to clone the repository and run it locally. Requiring that
documentation is part of every code-writing test case.

An [asset-generation](/testing/asset-generation/overview/) run is the exception.
Its authoritative output is the recorded sequence of operations, uploaded to the
backend as the run's assets, so publishing one creates no repository on GitHub
and the run carries no source link. The run folder is still a git repo, seeded
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
runs the same [secret-redaction](#secret-redaction) scrubber the run publisher
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
must. `publish-reference` seeds a workspace from the case manifest through the
real seeding path, runs that script, and uploads each frame's rendered image and
its recorded action log to the public snapshot bucket under
`media/references/<slug>/<version>/<variant>/frames/`. The log travels with the
image because the log is what a run is scored on.

The script is the only source of truth for both the images and the logs and
reproduces both exactly, so neither is committed. Object-store keys are
constructible, so the backend discovers references by listing the prefix at
ingest and reconciling a `case_reference_sheet` table. A reference sheet is
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

Each finished run's [run record](/components/core/run-records/) is uploaded to
the [backend](/components/backend/overview/), with its links pointing at the
run's source repository and playable build. The backend is the system of record
for runs, and the [public site](/components/site/overview/) is built from a
dataset the backend exports.

## Lifecycle

A run reaches the gallery through the automatic storage every produced run gets
when it finishes, followed by two explicit steps, review and publish.

### Automatic storage

A run needs no operator action to become reviewable. When the
[driver](/components/driver/overview/) finishes a run it reports the produced
[run record](/components/core/run-records/) to the backend, which stores it
privately, and it uploads the produced tree, meaning the playable build together
with proof and asset media, to the [artifact
service](/components/artifacts/overview/). The run is stored but absent from the
public gallery, and its build is playable for review straight off the artifact
service.

### Review

Anyone with an [account](/components/backend/overview/#authentication) plays the
run's build and submits a [review](#reviews). The reviewer is typically someone
other than the operator who produced the run. On a validator-rated run that is a
writeup, one aesthetic rating for the whole run, and any checklist verdicts the
reviewer chose to override. On a legacy run it is a writeup, a functional rating
per scoring domain, and the checklist verdicts. Every review is attributed to
the authenticated account that wrote it.

A run may carry multiple reviews, one per account. Submitting a second review
replaces the reviewer's own.

### Publish

Publishing releases a reviewed run and flips it public. It is the only point at
which a run's outputs cross onto the open internet. What it requires depends on
the run's [terminal state](/components/core/run-records/#status):

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
`tcab-publisher` Job, which does the release work and reports back. The release
Job:

- Releases the run's generated code to its own public repository, skipped for an
  asset-generation run.
- Deploys the produced static build to Cloudflare Pages
  (`wrangler pages deploy <dir> --branch=<run-id>`), which serves it at its own
  `pages.dev` subdomain root, keeping the build playable exactly as the test
  case's [build interface](/testing/end-to-end/overview/#design-requirements)
  and the [load check](/components/core/validation/#load-check) require.

The backend records the resulting links on the run and, once the Job reports a
terminal success, flips the run public and regenerates the snapshot. The Job
holds the credentials each release needs.

The release is idempotent. A re-publish reuses an existing repository rather than
recreating it, and still re-commits and re-pushes the implementation, which
recovers a publish whose repository was created before its first push landed. The
first push settles briefly and is then retried with backoff, so a transient
post-create `403` from GitHub's permission-propagation lag self-heals.

A release that does not land records its reason on the publish job and raises a
publish-failed notification on the console. Publishing the run again is the
recovery, admitted as soon as the failed publish job is terminal, and the run
waits in the console's [Unpublished
worklist](/components/web/overview/#the-runs-section) until a release lands.

Only published runs appear in the public snapshot and therefore in the gallery. A
published catastrophic or timeout failure shows its generated source and has no
playable build, and its outcome is reported as a per-model statistic separate
from the score that ranks workable runs. A published `harness_error`,
`limit_exceeded` or `hung` run shows no source and no build at all and is purely
a per-model statistic.

A model's published runs are counted as completed against the publishable
failure tiers, namely catastrophic failures, timeouts, harness errors, execution
ceilings, and hangs. `infrastructure` and `canceled` runs are absent from every
model statistic, since neither is a model outcome.

The backend performs publish and the snapshot regeneration it triggers as the
synchronized half of the lifecycle, so two operators publishing at once cannot
race on the store or the snapshot. See [the
backend](/components/backend/overview/#review-and-publish).

#### Secret redaction

A run executes with a real provider API key in its container, so a model that
dumps its environment can write that key into a source file it produced. The
backend a run streams to is private and trusted and keeps the captured data
as-is. The exposure is where a run's data crosses into the open internet, so
publishing redacts secrets at each public-egress point as the release Job
produces it:

- The public source repository. Before the generated code is committed and
  pushed, every staged file is scanned and any leaked key is rewritten in place.
- The Cloudflare Pages build. Before the static output is deployed, the built
  tree is scanned the same way, in case a key was carried through the build into
  an emitted asset.

The scrubber matches any provider-shaped `sk-…` token, anchored to the `sk-`
prefix and requiring a long enough body, along with the exact key values from the
release Job's environment where it holds them. Each match is replaced with
`[REDACTED]`. The third public surface, the run's record and event stream in the
public snapshot, is scrubbed by the backend as it builds that snapshot; see [the
per-run record](/components/backend/snapshot/#run-documents).

### Combined review and publish

When one operator ran the model, played it, and vouches for it, the CLI's
`tcab publish` does both in one step: it self-reviews the run with the writeup
and ratings the operator wrote, then publishes it. A validator-rated run with no
local writeup is published without a self-review, and the command says so in its
output. It is batch-capable. A batch is checked for its reviews up front, since
the review is known locally, so a legacy run missing one stops the whole batch
before anything is published.

Submitting to the backend requires the caller to be authenticated. Review and
publish each require a bearer token attributed to an account (see
[Authentication](/components/backend/overview/#authentication)). Reads stay open.

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
record](/components/core/run-records/) contract. The ratings and checklist
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
effective verdict, so a point nothing decided costs the build nothing. An item
excluded from scoring for the version, through an erratum, contributes to neither
side of the ratio while remaining visible and checked.

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
  specifies. On a legacy run the reviewer assigns it.
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
  validator-rated run has no reviews, the validators' own score stands.
- The run's functional rating is the worst across all of its reviews: the worst
  across domains within each review, then the worst of those across reviews. On a
  validator-rated run each review's rating is derived from its effective
  checklist, the validators' own rating stands while the run has no reviews, and
  the [toolchain gate](/components/core/validation/#the-toolchain-gate) applies
  to the aggregate.
- The run's aesthetic rating is the worst run-wide tier across its reviews. A
  validator-rated run with no review has a functional rating and score and no
  aesthetic rating.

Each test case's [leaderboard](/components/site/overview/#leaderboard) ranks
models by the aggregate score.
