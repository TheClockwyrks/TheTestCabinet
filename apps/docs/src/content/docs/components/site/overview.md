---
title: Overview
---

The public gallery lives at [testcabinet.ai](https://testcabinet.ai) and is where
published runs are browsed and played. It is a gallery first: visitors compare
implementations above all by playing them. Each run carries a numeric score and
[rating](/components/backend/results/#reviews), and each test case has a
[leaderboard](#leaderboard). Only published runs appear.

The gallery is the `testcabinet.ai` repository: the static site (`apps/site`),
the `tcab.ai` share-link Worker, and the preview-tag Worker in front of the
site's run routes.

## How it is served

The gallery is a static site on Cloudflare Pages that reads the public dataset
at runtime, so a run appears as soon as its publish has written the bucket. See
[Serving](/components/site/serving/).

The gallery is the same routed application the
[console](/components/web/overview/) renders, shared through
[`ui-common`](/components/ui/overview/), mounted with execution disabled so it
shows the published gallery alone. Signing in and launching runs stay with the
console.

The dataset is the public bucket described in
[Public Snapshot](/components/backend/snapshot/). Run listings, search, and
leaderboards are answered from the index objects the backend writes as it
publishes. A run's full record, its events, and all media are objects fetched
when that run's page opens, so what a page carries stays the same as the corpus
grows.

### Fetching the snapshot

The snapshot holds one document per published run, and the bucket serves them
without an edge cache, so a build makes about a thousand requests and a dropped
connection among them is expected. Every snapshot request is therefore retried
and bounded:

- An attempt has 60 seconds to return its whole body.
- A network error, a timeout, and an HTTP 408, 429 or 5xx are transient. A
  transient failure is retried up to 5 attempts in total, after a jittered
  backoff that starts at 500 ms, doubles per attempt and is capped at 8 seconds.
- Any other status is final on the first attempt. A 404 keeps its meaning: an
  absent `index.json` is the empty dataset, and an absent file that `index.json`
  references is a broken snapshot.

The per-run documents are fetched 8 at a time, which `TCAB_SNAPSHOT_CONCURRENCY`
overrides with any positive integer. Eight is roughly what a browser opens to
one host: a document's cost is its round trip, so it cuts a four-minute
sequential download to about half a minute while staying far below any rate the
bucket limits. The build's output is independent of the concurrency, because
each document is assembled and its assets emitted in the order of the summary
index whatever order the responses arrive in.

A run document or the summary index that still fails after its last attempt
fails the build, with a message naming the URL and the number of attempts made.
A per-case file or one of the optional payloads (models, comparisons, test-case
groups, the gg corpus) that fails the same way is left out and the build
continues. A successful fetch logs one line with the number of documents
fetched, how many of them needed a retry, and the elapsed time.

## Gallery

The site presents published runs as a browsable gallery. Each run is attributed
to the [variant](/testing/end-to-end/overview/#variants) of the case it built,
taken from its [run record](/components/contracts/run-records/#subject).
Listings are paged rather than loaded whole, and their search and sorting are
answered in the browser from the run index. The authoritative ranking of models
for a given case and variant lives in that case's [leaderboard](#leaderboard).

A validator-rated run carries a read-only browser of its automated
[validation](/components/driver/validation/) items, in which a visitor replays
the implementation against the reference baseline. Every visitor sees that
browser.

## Playing and cloning

A run's page links to the run's public source repository so a visitor can clone
and run it themselves, embeds its playable build, and shows the run's
[showcase](/components/driver/showcase/) when its record carries one. A published
implementation is released as it is and may be incomplete or visibly broken, so
the embed loads on demand rather than with the page.

## Share links

A published run carries a short code, assigned the first time it publishes and
never reassigned. [tcab.ai](https://tcab.ai) resolves `/r/<code>` to the run's
verdict page and `/p/<code>` to its play page, so a run is shared by a link
that stays short and stays valid. The [console](/components/web/overview/)
offers both links on a published run. How a code is minted is under [Short
codes](/components/backend/snapshot/#short-codes), and how a link resolves under
[Serving](/components/site/serving/#share-links).

## Leaderboard

Each test case has a leaderboard, scoped to the selected
[variant](/testing/end-to-end/overview/#variants). One row is a harness and
model pair, folded across every scored run that pair produced of this case and
variant. Splitting by harness as well as model keeps a model's results under two
harnesses from merging into one rank. A [test-case
group](/components/backend/test-case-groups/) carries a cross-case leaderboard
of its own.

The board draws its cohort from the page's [anchored
coordinate](/components/ui/overview/#the-case-detail-coordinate), and a visitor
can widen that cohort across versions and engines. A board widened across
engines keeps each engine's rows apart, because runs under different engines
measure different work. A case's metrics share the board's scope, so both
describe the same cohort. The metrics chart rating, points, tokens, cost, and
session duration per model.

Rows are ranked by average score, descending, then by the better best overall
rating, then by recency. Beside the score the board reports each pair's mean
comparable cost, mean token total, and mean session duration, each taken over
the runs that recorded the figure. A game jam carries a whole-game overall
grade in place of a domain rating.

A run's score is carried on its summary card in the run index. A
validator-rated run's score is its validators' earned share of the checklist
weight they decided, or zero of the declared weight when they decided none,
while the run has no reviews, and the average of its reviews'
effective scores once it has any. A legacy run's reviews each contribute their
earned share, averaged across the run's reviews.

A [performance](/testing/performance/overview/) case carries no reviewer score,
because it is graded by the harness on correctness and then on the fuel a
correct engine burned. Its leaderboard ranks by lowest total fuel over models
with a correct run, each folded to its best run. Fuel is
[deterministic](/testing/performance/evaluation/#fuel), so folding each model to
its best keeps a re-run model from flooding the board. The board is scoped to
the exact anchored version and variant, because fuel compares only within one
scored scenario set. A performance run's
[results](/testing/performance/evaluation/#no-human-review) report its placement
and percentile against this field.

## Implementation writeups

A run carries short, hand-written writeups attributed to their reviewers. A
writeup is curatorial: it calls out known-broken elements, caveats, and things
worth noticing, so a visitor knows what to expect before playing.

A writeup and its ratings, together with its checklist on a legacy run, form one
[review](/components/backend/results/#reviews). Reviews are authored separately
from the machine-generated [run record](/components/contracts/run-records/) and
each is attributed to the [identity](/components/auth/overview/) that wrote it.
Publishing a legacy run requires a review, so a published legacy run carries at
least one. A published validator-rated run may carry none, standing on its
functional rating and score alone until someone rates its aesthetics. A run may
carry several reviews from different reviewers, and its overall rating on the
reviewer-given channel is the worst across them. Reviews travel to the gallery
in the run's published document alongside the record.

## Hosting

Each run's generated code and playable build are hosted independently of the
site, as described in [Results](/components/backend/results/#generated-code).
Every run is its own repository with its own build, and the gallery embeds each
build rather than bundling every implementation, which keeps the site
lightweight as the number of published runs grows.

Each build is deployed to its own Cloudflare Pages URL and embedded from there.
The gallery points an iframe at the deployment URL the deploy reported, recorded
as a link in the run's [record](/components/contracts/run-records/#links). That
reported URL is used verbatim, because a host constructed from the run id and
project may not match Cloudflare's sanitized branch alias.
