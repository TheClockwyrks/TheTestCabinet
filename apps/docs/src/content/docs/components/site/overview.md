---
title: Overview
---

The public site lives at [testcabinet.ai](https://testcabinet.ai) and is where
published runs are browsed and played. It is the way the public interacts with
The Test Cabinet: a gallery, not a leaderboard. The Test Cabinet does not rank
implementations or reduce them to a score; visitors compare implementations by
reading their metrics and, above all, by playing them.

## A Static Site

The site is a fully **static** site with no backend, no accounts, and no database
of its own. This keeps it cheap, durable, and trivially public, and mirrors the
constraint placed on the games themselves (see
[Test Cases](/components/core/test-cases/#design-requirements)). Any
interactivity, such as filtering, is handled client-side.

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
[variant](/components/core/test-cases/#variants) of the case it built, taken
from its [run record](/components/core/run-records/#subject). For each run it
surfaces:

- The token counts and cost from the run's metrics. These are the primary
  numbers shown.
- The run time, presented as secondary information and noted as dependent on the
  provider that served the run.
- The [validation](/components/core/validation/) signals, such as whether the
  implementation loaded.
- The run's [rating](/components/core/results/#reviews), shown as a per-run
  quality badge.

The site must not present a ranking or an aggregate score derived from these
numbers. The rating is shown per run as qualitative context — it is never used
to sort, rank, or aggregate runs, which would turn the gallery into the
leaderboard it deliberately is not.

Alongside the home page, which leads with the most recent results, a dedicated
runs index lists the cabinet's full run history one page at a time, newest
first, with a search that narrows by test case, harness, or model name. A run's
own detail page sits under this section. Like the rest of the gallery it is
ordered purely by recency and presents no ranking.

## Playing and Cloning

Each run has a page that links to the run's public source repository, so a
visitor can clone and run it themselves, and that lets the visitor play the
implementation directly by embedding its playable build.

A published implementation may be incomplete or visibly broken. That is
expected: releasing the result as it is, rather than hiding it, is the point. So
when a run has a [writeup](#implementation-writeups), the embedded build is
gated behind it — the visitor reads the writeup first and then chooses to launch
the build, rather than being dropped into a broken page with no context.

## Implementation Writeups

A run carries a short, hand-written writeup shown on its page before the
playable build is launched, headed by the run's [rating](/components/core/results/#reviews).
The writeup is curatorial: it is where known-broken elements, caveats, or things
worth noticing about an implementation are called out, so a visitor knows what
to expect before playing, and the rating gives them the reviewer's one-glance
verdict up front.

The writeup and rating together form a run's [review](/components/core/results/#reviews).
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

Each build is deployed to Cloudflare Pages under a per-run branch alias, so it
is served at its own `https://<run-id>.<project>.pages.dev` root and embedded
from there. The gallery does not host the builds; it only points an iframe at
each run's `pages.dev` URL, recorded as a link in the run's
[record](/components/core/run-records/#links).
