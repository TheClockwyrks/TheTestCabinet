# Public Site

## Overview

The public site is where published runs are browsed and played. It is a gallery,
not a leaderboard. The Test Cabinet does not rank implementations or reduce them
to a score; visitors compare implementations by reading their metrics and, above
all, by playing them.

## No Backend

The site must be a static site with no backend, no accounts, and no database.
This mirrors the constraint placed on the test cases themselves and keeps the site
cheap, durable, and trivially public. The site is built from the published
[run record](./run-records.md) dataset; any interactivity such as filtering must
be handled client side.

## Gallery

The site presents published runs as a gallery that can be browsed by test case,
model, and agent harness. For each run it surfaces:

- The token counts and cost from the run's metrics. These are the primary numbers
  shown.
- The run time, presented as secondary information and noted as dependent on the
  provider that served the run.
- The [validation](./validation.md) signals, such as whether the implementation
  loaded.

The site must not present a ranking or an aggregate score derived from these
numbers.

## Playing and Cloning

Each run has a page that lets a visitor play the implementation directly, by
embedding its playable build, and that links to the run's public source
repository so the visitor can clone and run it themselves.

## Hosting

Each run's generated code and playable build are hosted independently of the site,
as described in [Results](./results.md#generated-code). Because every run is its
own repository with its own build, the gallery embeds each build rather than
bundling every implementation into the site itself. This keeps the site
lightweight as the number of published runs grows.
