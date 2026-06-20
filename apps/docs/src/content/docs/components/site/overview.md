---
title: Overview
---

The public site lives at [testcabinet.ai](https://testcabinet.ai) and is where
published runs are browsed and played. It is the way the public interacts with
The Test Cabinet: a gallery first — the home page and runs index are ordered by
recency, and visitors compare implementations above all by playing them — but
each run also carries a numeric [score and rating](/components/core/results/#reviews)
from its review, and each test case has a [leaderboard](#leaderboard) that ranks
models by score.

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
  its scoring domains — shown as a per-run quality badge.

The home page and the global runs index are ordered purely by recency, not by
score — the cost and token metrics in particular are never used to sort or rank
runs. Ranking lives in each test case's [leaderboard](#leaderboard) instead, where
it is meaningful (models on the same case and variant), and is by review score
rather than by resource metrics.

Alongside the home page, which leads with the most recent results, a dedicated
runs index lists the cabinet's full run history one page at a time, newest
first, with a search that narrows by test case, harness, or model name. A run's
own detail page sits under this section, opening on its review — the overall
rating, the score, the per-domain ratings, and the per-item checklist breakdown
— ahead of the playable build.

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
overall rating badge. This is the one place the gallery deliberately *does* rank,
because models on the same case and variant are directly comparable; the home
page and runs index stay recency-ordered. Like the rest of the site it is built
from the static snapshot, computing each run's score from the case's review-item
weights and the run's recorded verdicts.

## Implementation Writeups

A run carries a short, hand-written writeup shown on its page before the
playable build is launched, headed by the run's overall
[rating](/components/core/results/#reviews) and its score, with the per-domain
ratings and the per-item checklist breakdown alongside. The writeup is
curatorial: it is where known-broken elements, caveats, or things worth noticing
about an implementation are called out, so a visitor knows what to expect before
playing, and the rating and score give them the reviewer's verdict up front.

The writeup, ratings, and checklist together form a run's [review](/components/core/results/#reviews).
A review is authored separately from the machine-generated
[run record](/components/core/run-records/) and is not part of that data
contract. Every published run has one — publishing refuses a run without it — so
a published run is always framed by its review. Reviews travel to the site as
part of the exported snapshot, alongside the run record.

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
