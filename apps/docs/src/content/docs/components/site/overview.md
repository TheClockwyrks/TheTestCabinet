---
title: Overview
---

The public site lives at [testcabinet.ai](https://testcabinet.ai) and is where
**published** runs are browsed and played. It is the way the public interacts
with The Test Cabinet: a gallery first — the home page and runs index are ordered
by recency, and visitors compare implementations above all by playing them — but
each run also carries a numeric [score and rating](/components/core/results/#reviews)
aggregated across its [reviews](/components/core/results/#reviews), and each test
case has a [leaderboard](#leaderboard) that ranks models by score. Only published
runs appear; a produced run that has not yet been published is private and never
reaches the gallery.

## A Static Site

The site is a fully **static** site with no backend, no accounts, and no database
of its own. This keeps it cheap, durable, and trivially public, and mirrors the
constraint placed on the games themselves (see
[Test Cases](/testing/end-to-end/overview/#design-requirements)). Any
interactivity, such as filtering, is handled client-side. The built bundle is
deployed to **Cloudflare Pages**, served at the project's custom domain
([testcabinet.ai](https://testcabinet.ai)). Cloudflare builds it directly from
the repository, so a push rebuilds it — and, as below, so can the backend on its
own when the snapshot changes.

The gallery is the same routed application the [web](/components/web/overview/)
and [Tauri](/components/tauri/overview/) consoles render, shared through the
[UI library](/components/ui/overview/). The site simply mounts it with the
build-time snapshot as its data source and run execution turned off
(`canExecute` is false), so it shows the published gallery without the consoles'
run, monitor, review, or connection screens.

The site is built from a dataset of published [run records](/components/core/run-records/).
Originally that dataset was committed into the site's own repository; it is now
a **public snapshot exported from the [backend](/components/backend/overview/)**
to a Cloudflare R2 bucket (see
[Public Snapshot](/components/backend/overview/#public-snapshot)). The backend
itself is private, so the site never queries it at runtime — the build fetches
the snapshot from R2 and ships static output, with no live dependency on the
backend. A backend deploy hook triggers a rebuild whenever the snapshot changes.

The build does **not** inline every full record into the JS bundle. It ships the
snapshot's [summary index](/components/backend/snapshot/#runsjson--the-run-index)
— a lightweight [`RunSummary`](/components/backend/snapshot/#runsjson--the-run-index)
card per published run — as the in-memory dataset every list, card, leaderboard,
and metric reads, and emits each run's full record as a per-run
`runs/<id>.json` **static asset** fetched lazily when that run's detail page
opens. The runs index and home list page over the in-memory summary index
client-side (the same filter/sort/paging the console runs server-side), so the
bundle size no longer grows with each run's full record.

## Gallery

The site presents published runs as a gallery that can be browsed by test case,
model, and agent harness. Each run is attributed to the
[variant](/testing/end-to-end/overview/#variants) of the case it built, taken
from its [run record](/components/core/run-records/#subject). For each run it
surfaces:

- The token counts and cost from the run's metrics. These are the primary
  numbers shown.
- The run time, presented as secondary information and noted as dependent on the
  provider that served the run.
- The [validation](/components/core/validation/) signals, such as whether the
  implementation loaded.
- The run's overall [rating](/components/core/results/#reviews) — the worst across
  every domain of every review the run carries — shown as a per-run quality badge,
  with a note of how many reviewers contributed.

The home page and the global runs index default to recency order, newest first,
but their columns are sortable: clicking a header re-sorts the whole list by that
column — test, harness, model, timestamp, category, duration, tokens, cost, or
rating — ascending, then descending, then back to the default. The columns are
also user-resizable, and the optional timestamp, category, and duration columns
can be shown or hidden (drag the header boundaries, or right-click a header — or
use the picker button — to choose columns). Sorting a run listing is a browsing
convenience across differing cases; the authoritative ranking of *models* for a
given case and variant still lives in that case's
[leaderboard](#leaderboard), where a comparison is meaningful — by review score
for a human-reviewed case, or by fuel for a
[performance](/testing/performance/overview/) case — rather than by the
browsing-only resource columns.

Alongside the home page, which leads with the most recent results, a dedicated
runs index lists the cabinet's full run history one page at a time, newest
first, with a search that narrows by test case, harness, or model name. A run's
own detail page sits under this section, opening on its reviews — the aggregate
overall rating and score up front, then each review's writeup, per-domain ratings,
and per-item checklist breakdown, attributed to the reviewer who wrote it — ahead
of the playable build.

## Playing and Cloning

Each run has a page that links to the run's public source repository, so a
visitor can clone and run it themselves, and that lets the visitor play the
implementation directly by embedding its playable build.

A published implementation may be incomplete or visibly broken. That is
expected: releasing the result as it is, rather than hiding it, is the point. So
when a run has a [writeup](#implementation-writeups), the embedded build is
gated behind it — the visitor reads the writeup first and then chooses to launch
the build, rather than being dropped into a broken page with no context.

## Leaderboard

Each test case's detail page carries a **Leaderboard** tab, scoped to the
selected [variant](/testing/end-to-end/overview/#variants). It ranks every model
that has a scored run of that case and variant by
[score](/components/core/results/#reviews) (points): each model appears once,
represented by its best-scoring run (ties broken by the better overall rating,
then recency), and the table shows the rank, model, `earned / total` points, and
overall rating badge. This is where the gallery presents an explicit, canonical
ranking — a rank column and a single score-ordered row per model — because models
on the same case and variant are directly comparable; the sortable run listings
elsewhere reorder rows for browsing but assign no rank. Like the rest of the site it is built
from the static snapshot, computing each run's score client-side: each review's
earned-over-declared checklist weight, then **averaged across the run's reviews**.
Ties are broken by the better aggregate overall rating (the worst across reviews),
then recency.

A [performance](/testing/performance/overview/) case carries **no reviewer score**
— it is graded by the harness (correctness, then the fuel a correct engine burned)
— so its Leaderboard ranks by **fuel** instead: every model with a **correct** run
of the case and variant, ranked by the **lowest total fuel** its engine posted
(lower is better), each model shown once at its best run with its run count. Because
fuel is [deterministic](/testing/performance/evaluation/#fuel), re-running the same
engine posts the identical number; folding each model to its best keeps a re-run
model from flooding the board. Fuel is only comparable within one scored scenario
set, so the board is scoped to the case's version and variant. A single run's
[Results tab](/testing/performance/evaluation/#no-human-review) additionally shows
that run's **placement and percentile** against this per-model-best field, so the
raw fuel number reads as a standing rather than an isolated figure.

## Implementation Writeups

A run carries one or more short, hand-written writeups shown on its page before
the playable build is launched, headed by the run's **aggregate** overall
[rating](/components/core/results/#reviews) and its score, with each review's
per-domain ratings and per-item checklist breakdown alongside, attributed to the
reviewer who wrote it. A writeup is curatorial: it is where known-broken elements,
caveats, or things worth noticing about an implementation are called out, so a
visitor knows what to expect before playing, and the aggregate rating and score
give them the reviewers' verdict up front.

A writeup, its ratings, and its checklist together form one
[review](/components/core/results/#reviews). Reviews are authored separately from
the machine-generated [run record](/components/core/run-records/) and are not part
of that data contract; each is attributed to the [account](/components/backend/overview/#accounts)
that wrote it. Every published run has at least one — publishing refuses a run
without a review — and may carry several from different reviewers. The run's score
is the **average** across them and its overall rating the **worst** across them.
Reviews travel to the site as part of the exported snapshot, alongside the run
record.

## Hosting

Each run's generated code and playable build are hosted independently of the
site, as described in [Results](/components/core/results/#generated-code).
Because every run is its own repository with its own build, the gallery embeds
each build rather than bundling every implementation into the site itself. This
keeps the site lightweight as the number of published runs grows.

Each build is deployed to its own Cloudflare Pages URL and embedded from there.
The gallery does not host the builds; it only points an iframe at the deployment
URL the deploy reported, recorded as a link in the run's
[record](/components/core/run-records/#links). That reported URL is used verbatim
rather than a host constructed from the run id and project, which Cloudflare's
branch-alias sanitization may truncate.
