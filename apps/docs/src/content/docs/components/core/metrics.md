---
title: Metrics
---

## Overview

Every run records the resources it consumed: how long each stage of the run
took, normalized token counts, and cost. They are distinct from the run's
quality score and rating, which come from its
[review](/components/core/results/#reviews), and take no part in ranking a
run.

## Durations

Every run records its end-to-end wall-clock time in seconds as the run time, and
records the duration of each lifecycle stage beside it.

- Setup covers the start of the run through to the instant the session begins:
  rendering the case's references, seeding the workspace, starting the
  container, probing its environment, installing the harness, and running the
  test case's `init` step.
- Session covers the harness session alone.
- Teardown covers collecting the produced tree and stopping the container.
- Validation covers the [validation](/components/core/validation/) pass.

Setup, session and teardown sum exactly to the run time. The run time excludes
the wall clock a run container spent queued for cluster capacity before it
started, which is subtracted from setup, the stage that contains it. Validation
sits outside the run time, which is frozen before the validation pass and before
every post-run stage.

The session duration is the figure that describes a model, and the run time
answers what a run cost in machine time. Every run of a model is pinned to that
model's own provider, so the session duration is comparable across runs of one
model. The surfaces that compare models report it beside tokens and cost, over
the same runs, and a run that recorded no session duration is left out.

Each stage duration is optional. `null` means the run recorded no figure for
that stage, which is distinct from `0`. A cancellation skips validation, so a
canceled gg run records no validation duration.

## Tokens

Every run records four normalized token classes:

- Uncached input tokens: input tokens that were not served from the provider's
  cache. A harness that reports input as `input + cache_read` has its cached
  reads subtracted so this value excludes them.
- Cached input tokens: input tokens served from the provider's cache, tracked
  separately because they are billed at a lower rate.
- Output tokens: non-reasoning output tokens. A harness that reports output as
  `output + reasoning` has its reasoning tokens subtracted so this value
  excludes them.
- Reasoning tokens: internal reasoning tokens, billed as output tokens and
  tracked separately because they are not useful output to a reader.

Each class is optional. A class is `null` when the harness does not report it,
which is distinct from `0`, meaning the harness reported the class and it was
zero. A harness that folds reasoning into its output total records `null` for
reasoning.

A `null` class still counts toward the totals. A harness that reports no split
folds those tokens into the class it does report: a cache-unaware harness
reports all input as uncached, and a harness that folds reasoning into output
reports it there. An input or output total is `null` only when neither class on
that side is reported. `null` signals that the breakdown is unavailable, so a
consumer separates cached from uncached only for a run that reports the cached
class.

The [agent harness layer](/components/core/harnesses/#usage-reporting) produces
these normalized values from each harness's raw reporting.

## Cost

Every run records cost two ways:

- The comparable cost, the canonical figure. It is computed from the per-token
  prices OpenRouter lists for the model used rather than the amount actually
  charged, because OpenRouter may route one model to providers that price calls
  differently.
- The actual cost charged for the run, recorded alongside the comparable cost
  for reference.

Comparable cost is derived from the recorded token classes and the listed prices
for uncached input, cached input, and output tokens, with reasoning tokens
priced at the output rate. A class that carries tokens but whose per-token price
is unknown makes the whole cost unknown rather than under-counted, while a class
with zero tokens needs no price. A cost of `null` means unknown, distinct from
`0.0`, a genuinely free run. Both figures are `null` whenever the cost cannot be
determined, including when no token class was reported at all, so a run whose
usage never reached us is recorded as unknown rather than as `$0.00`.

### Price history

The OpenRouter per-token prices are fetched by the
[backend](/components/backend/overview/), not the CLI. The backend records a
model's price when a run completes, capturing the rate in effect at that moment
so a promotional price is reflected in the runs that ran under it, and again on
a 24-hour periodic refresh. A refresh appends a new observation to the model's
history only when the observed facts changed, covering the price triple along
with the context window, release date, and accepted input modalities.

A model with no price on record is seeded the first time it is seen at all, both
when it is curated in the app and when a run binding it is enqueued, so a cost
split is available while the run is still going. The history is retained per
model.

A model id carrying a `:free`-style OpenRouter variant tag is priced at the
model's base rate. The tag selects a pricing route rather than a different
model.

### Harness-reported cost

Some harnesses drive a single provider directly through an API key and report
the exact cost of a run themselves. Claude Code reports a `total_cost_usd`
figure on its terminal result. When a harness reports its own cost, that figure
is used for both the comparable and the actual cost and the OpenRouter price
lookup is skipped. These harnesses pass provider-native model ids, which
OpenRouter's catalog need not list.

The [agent harness layer](/components/core/harnesses/#usage-reporting) extracts
any reported cost from each harness's output.
