---
title: Metrics
---

## Overview

Every run records the resources it consumed: how long each stage of the run
took, normalized token counts, and cost. They are distinct from the run's
quality score and rating, which come from its
[review](/components/core/results/#reviews), and take no part in ranking a
run.

The metrics block of a run record is defined in the
[contracts crate](/components/core/overview/#the-contracts-crate)
(`test_cabinet_contracts::metrics`); the price tables and the cost computation over
them live in the core.

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

- The comparable cost, the canonical figure. It is computed from the model's
  list price, curated on its catalog entry as the uncached input, cached input,
  and output rates per Mtok entered from the developer's own pricing page, so
  the figure is stable across providers and discounts rather than tracking what
  one provider happened to bill.
- The actual cost charged for the run, recorded alongside the comparable cost
  for reference. It is the harness's own accounting where the harness reports
  one, and equal to the comparable cost otherwise.

The backend resolves the model's list price when a run is enqueued and stamps it
onto the launch, so a run is scored at the list price its model carried at
enqueue. A gg run is scored at the list price of the model it is published
under, and every model its capability set binds is priced the same way.

A catalog entry that carries no list price is filled at enqueue from OpenRouter:
the backend reads the model's official endpoint rate, by the same rule the
[billed rate](#price-history) follows, and writes the three rates onto the entry
dated that day and marked as sourced from OpenRouter. The operator confirms or
corrects the filled rates against the developer's pricing page later; the runs
already enqueued keep the rates they were stamped with. A filled list price
stays as written until the operator edits it. A launch naming a model
the catalog has no entry for, or one OpenRouter lists no rate for, is refused
with the reason named.

A list price filled before Flex endpoints were ignored can hold a Flex rate, so
the backend rewrites the stored list prices once per database. The first time
it starts on a database, in the background, it reads the standard rate of every
catalog entry that carries a list price and writes it over the stored one,
dated that day and marked as sourced from OpenRouter, whoever entered the
figure it replaces. It leaves an entry as it is when the entry has no list
price, has no OpenRouter slug, is not listed by OpenRouter, has no priced
official endpoint, or already holds the standard rate. Runs keep the cost they
were scored at. The backend reads every rate before it writes any: if OpenRouter
cannot be read it writes nothing and tries again the next time it starts, and
once the rewrite has happened it is recorded on the database and never runs
again. A rewrite regenerates the public snapshot.

Comparable cost is derived from the recorded token classes and the list price's
rates for uncached input, cached input, and output, with reasoning tokens priced
at the output rate. A class that carries tokens but whose rate is unknown makes
the whole cost unknown rather than under-counted, while a class with zero tokens
needs no rate. A cost of `null` means unknown, distinct from `0.0`, a genuinely
free run. Both figures are `null` whenever the cost cannot be determined,
including when no token class was reported at all, so a run whose usage never
reached us is recorded as unknown rather than as `$0.00`.

### Price history

Beside the curated list price, the [backend](/components/backend/overview/)
records the official provider endpoint's billed rate as a per-model history: the
rates the model's OpenRouter endpoints listing shows at that moment for the
endpoint its developer provider names, with the date, the developer provider, and the catalog
facts observed alongside. A model with no priced official endpoint records the
listing's headline rate. An
observation is recorded when a run completes, missing-only when a model is saved
or first enqueued, and on a 24-hour periodic refresh, and is appended only when
the observed facts changed.

The official endpoint is the developer provider's standard endpoint: the first
priced one the listing shows under that provider's name whose `tag` has no
`flex` segment. OpenRouter lists a provider's Flex tier as a second endpoint
under the same provider name, at a discount, with a `tag` such as `openai/flex`
or `google-vertex/global/flex`. A Flex endpoint is ignored wherever a price is
read from the listing, so a developer provider that lists only Flex endpoints
has no priced official endpoint. An observation already in the history stays as
recorded, and a later observation at a different rate is appended after it.

The recorded history is what the model's Stats tab shows beside the list price,
with the difference, so a discount, a price change, or a listing error is
visible on the model. It never rewrites what a run is scored at: the comparable
cost is computed from the list price and nothing else.

### Harness-reported cost

Some harnesses drive a single provider directly through an API key and report
the exact cost of a run themselves. Claude Code reports a `total_cost_usd`
figure on its terminal result. A harness-reported cost is recorded as the run's
actual cost; the comparable cost stays computed from the list price.

The [agent harness layer](/components/core/harnesses/#usage-reporting) extracts
any reported cost from each harness's output.
