---
title: Overview
---

The public site lives at [testcabinet.ai](https://testcabinet.ai) and is where
published runs are browsed and played. It is a gallery first: visitors compare
implementations above all by playing them. Each run carries a numeric score and
[rating](/components/core/results/#reviews), and each test case has a
[leaderboard](#leaderboard). Only published runs appear.

## A static site

The site is fully static, with no backend, no accounts, and no database of its
own. Interactivity such as filtering and sorting is handled client-side. The
built bundle is deployed to Cloudflare Pages at the project's custom domain, and
Cloudflare builds it directly from the repository.

The gallery is the same routed application the [web
console](/components/web/overview/) renders, shared through the [UI
library](/components/ui/overview/). The site mounts it with the build-time
snapshot as its data source and `canExecute` false, so it shows the published
gallery without the console's run, monitor, review, or connection screens.
Signing in and launching runs stay with the console.

The dataset is the public snapshot the
[backend](/components/backend/overview/#public-snapshot) exports to a Cloudflare
R2 bucket. A build-time Vite plugin fetches that snapshot once from
`TCAB_SNAPSHOT_URL` and inlines it, so the shipped output never queries the
backend or R2 at runtime. A backend deploy hook triggers a rebuild whenever the
snapshot changes. An unset URL, or a bucket whose `index.json` is absent because
nothing has been published yet, resolves to an empty dataset and still builds; a
reachable but broken snapshot fails the build.

The build inlines the snapshot's [summary
index](/components/backend/snapshot/#runsjson--the-run-index), one `RunSummary`
card per published run, as the in-memory dataset every list, card, leaderboard,
and metric reads. Each run's full record is emitted as a per-run `runs/<id>.json`
static asset, fetched when that run's detail page opens, so the bundle does not
grow with each record.

## Gallery

The site presents published runs as a browsable gallery. Each run is attributed
to the [variant](/testing/end-to-end/overview/#variants) of the case it built,
taken from its [run record](/components/core/run-records/#subject). Listings are
paged rather than loaded whole, and their search and sorting run client-side
over the inlined run index. The authoritative ranking of models for a given case
and variant lives in that case's [leaderboard](#leaderboard).

A validator-rated run carries a read-only browser of its automated
[validation](/components/core/validation/) items, in which a visitor replays the
implementation against the reference baseline. Every visitor sees that browser.

## Playing and cloning

A run's page links to the run's public source repository so a visitor can clone
and run it themselves, embeds its playable build, and shows the run's
[showcase](/components/core/showcase/) when its record carries one. A published
implementation is released as it is and may be incomplete or visibly broken, so
the embed loads on demand rather than with the page.

## Leaderboard

Each test case has a leaderboard, scoped to the selected
[variant](/testing/end-to-end/overview/#variants). One row is a harness and
model pair, folded across every scored run that pair produced of this case and
variant. Splitting by harness as well as model keeps a model's results under two
harnesses from merging into one rank. A [test-case
group](/components/core/test-case-groups/) carries a cross-case leaderboard of
its own.

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

A run's score is carried on its summary card in the snapshot's run index. A
validator-rated run's score is its validators' earned share of the declared
checklist weight while the run has no reviews, and the average of its reviews'
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
[review](/components/core/results/#reviews). Reviews are authored separately
from the machine-generated [run record](/components/core/run-records/) and each
is attributed to the [account](/components/auth/overview/) that wrote it.
Publishing a legacy run requires a review, so a published legacy run carries at
least one. A published validator-rated run may carry none, standing on its
functional rating and score alone until someone rates its aesthetics. A run may
carry several reviews from different reviewers, and its overall rating on the
reviewer-given channel is the worst across them. Reviews travel to the site in
the exported snapshot alongside the run record.

## Hosting

Each run's generated code and playable build are hosted independently of the
site, as described in [Results](/components/core/results/#generated-code). Every
run is its own repository with its own build, and the gallery embeds each build
rather than bundling every implementation, which keeps the site lightweight as
the number of published runs grows.

Each build is deployed to its own Cloudflare Pages URL and embedded from there.
The gallery points an iframe at the deployment URL the deploy reported, recorded
as a link in the run's [record](/components/core/run-records/#links). That
reported URL is used verbatim, because a host constructed from the run id and
project may not match Cloudflare's sanitized branch alias.
