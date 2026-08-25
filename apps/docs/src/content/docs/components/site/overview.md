---
title: Overview
---

The public site lives at [testcabinet.ai](https://testcabinet.ai) and is where
published runs are browsed and played. It is a gallery first: the home page and
the runs index are ordered by recency, and visitors compare implementations
above all by playing them. Each run also carries a numeric score and
[rating](/components/core/results/#reviews) aggregated across its reviews, and
each test case has a [leaderboard](#leaderboard). Only published runs appear.

## How it is served

The gallery is served by an origin that resolves routes and reads the published
set at request time, so a run appears as soon as it is published. The origin
answers each URL with the status that URL deserves and writes each run page's
preview tags. See [Serving](/components/site/serving/).

The gallery is the same routed application the [web](/components/web/overview/)
and [Tauri](/components/tauri/overview/) consoles render, shared through the [UI
library](/components/ui/overview/). The origin mounts it with `canExecute`
false, so it shows the published gallery without the consoles' run, monitor,
review, or connection screens. Signing in and launching runs stay with the
consoles.

The dataset is split by shape. Run listings, search, and leaderboards read the
[public projection](/components/backend/projection/) the backend writes as it
publishes. A run's full record, its events, and all media are objects in the
public bucket, fetched when that run's page opens, so what a page carries stays
the same as the corpus grows.

## Gallery

The site presents published runs as a gallery browsable by test case, model, and
harness. Each run is attributed to the
[variant](/testing/end-to-end/overview/#variants) of the case it built, taken
from its [run record](/components/core/run-records/#subject). For each run it
surfaces:

- The token counts and cost from the run's metrics. These are the primary
  numbers shown.
- The run time, presented as secondary information and dependent on the provider
  that served the run.
- The [validation](/components/core/validation/) signals, such as whether the
  implementation loaded.
- The run's overall functional [rating](/components/core/results/#ratings),
  and beside it the overall aesthetic rating when the run has one, with a count
  of contributing reviewers. A legendary aesthetic badge is drawn distinctly so
  it reads as exceptional at a glance.

Run listings default to recency, newest first. Clicking a column header sorts by
that column ascending, then descending, then back to the default; test, version,
category, harness, variant, model, start time, duration, tokens, cost, code,
points, and rating each offer a sort. Columns are resizable, and the optional
ones are shown or hidden from a picker button or by right-clicking a header.
Both choices persist.

Sorting a run listing is a browsing convenience across differing cases. The
authoritative ranking of models for a given case and variant lives in that
case's [leaderboard](#leaderboard).

The runs index lists the full run history a page at a time, with a search that
narrows by test case, harness, or model name. A run's detail page opens on its
Verdict tab: the functional rating, the aesthetic rating when there is one,
and the score first, then the per-item checklist breakdown and each review's
writeup and per-domain ratings, attributed to its reviewer. The playable build
has its own Play tab.

## Playing and cloning

A run's page links to the run's public source repository so a visitor can clone
and run it themselves, and embeds its playable build.

A published implementation may be incomplete or visibly broken, and is released
as it is. The embed therefore loads on demand: the visitor is shown a short
caveat and clicks to launch the build into a near-fullscreen overlay.

## Leaderboard

Each test case's detail page carries a Leaderboard tab, scoped to the selected
[variant](/testing/end-to-end/overview/#variants). One row is a harness and
model pair, folded across every scored run that pair produced of this case and
variant. Splitting by harness as well as model keeps a model's results under two
harnesses from merging into one rank.

The board draws its cohort from the page's [anchored
coordinate](/components/ui/overview/#the-case-detail-coordinate): by default the
anchored version's `major.minor` line under the anchored engine, widenable to
the major line or every version, and to every engine. A board widened across
engines lists each engine's rows separately, because runs under different
engines measure different work. The Metrics tab shares the same scope, so the
board and the charts describe the same cohort.

Rows are ranked by average [score](/components/core/results/#reviews),
descending, then by the better best overall rating, then by recency. Beside the
rank and the model, the board offers highest, average and lowest score, best and
worst rating, and average cost and tokens; average score, best rating and
average cost are shown by default and the rest come from the column picker. A
game jam carries a whole-game overall grade in place of a domain rating, and its
rows show that grade.

A run's score is carried on its projection row. A validator-rated run's score
is its validators' earned share of the declared checklist weight. A legacy run's
reviews each contribute their earned share, averaged across the run's reviews.

A [performance](/testing/performance/overview/) case carries no reviewer score,
because it is graded by the harness on correctness and then on the fuel a
correct engine burned. Its leaderboard ranks by lowest total fuel instead, over
models with a correct run, each shown once at its best run with its run count.
Fuel is [deterministic](/testing/performance/evaluation/#fuel), so folding each
model to its best keeps a re-run model from flooding the board, and the board is
scoped to the exact anchored version and variant because fuel compares only
within one scored scenario set. A single run's [Results
tab](/testing/performance/evaluation/#no-human-review) shows that run's
placement and percentile against this field.

## Implementation writeups

A run carries short, hand-written writeups, headed by the run's overall
[ratings](/components/core/results/#ratings) and score, with each review's
per-domain ratings and the per-item checklist breakdown alongside, attributed to
its reviewer. A writeup is curatorial: it calls out known-broken elements,
caveats, and things worth noticing, so a visitor knows what to expect before
playing.

A writeup and its ratings, together with its checklist on a legacy run, form one
[review](/components/core/results/#reviews). Reviews are authored separately
from the machine-generated [run record](/components/core/run-records/) and each
is attributed to the [account](/components/auth/overview/) that wrote it. A
published legacy run carries at least one, because publishing it requires a
review; a published validator-rated run may carry none yet, showing its
functional rating and score alone until someone rates its aesthetics. A run may
carry several reviews from different reviewers, and its overall rating on the
reviewer-given channel is the worst across them. Reviews travel to the gallery
in the run's published document alongside the record.

## Hosting

Each run's generated code and playable build are hosted independently of the
site, as described in [Results](/components/core/results/#generated-code).
Because every run is its own repository with its own build, the gallery embeds
each build rather than bundling every implementation, which keeps the site
lightweight as the number of published runs grows.

Each build is deployed to its own Cloudflare Pages URL and embedded from there.
The gallery points an iframe at the deployment URL the deploy reported, recorded
as a link in the run's [record](/components/core/run-records/#links). That
reported URL is used verbatim, because a host constructed from the run id and
project may not match Cloudflare's sanitized branch alias.
