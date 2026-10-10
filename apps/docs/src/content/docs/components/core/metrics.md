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

- The comparable cost, the canonical figure. It is computed from the model's
  list price, the uncached input, cached input, and output rates per Mtok held
  on its catalog entry, so the figure is stable across providers and discounts
  rather than tracking what one provider happened to bill.
- The actual cost charged for the run, recorded alongside the comparable cost
  for reference. It is the harness's own accounting where the harness reports
  one, and equal to the comparable cost otherwise.

The list price is the only model price the system holds, and every price
calculation reads it. The backend resolves the model's list price when a run is
enqueued and stamps it onto the launch, so a run is scored at the list price its
model carried at enqueue and keeps that cost when the entry's price later
changes. A gg run is scored at the list price of the model it is published
under, and every model its capability set binds is priced the same way.

Comparable cost is derived from the recorded token classes and the list price's
rates for uncached input, cached input, and output, with reasoning tokens priced
at the output rate. A class that carries tokens but whose rate is unknown makes
the whole cost unknown rather than under-counted, while a class with zero tokens
needs no rate. A cost of `null` means unknown, distinct from `0.0`, a genuinely
free run. Both figures are `null` whenever the cost cannot be determined,
including when no token class was reported at all, so a run whose usage never
reached us is recorded as unknown rather than as `$0.00`.

### List price resolution

A list price read from OpenRouter is the first of these that yields a complete
rate:

1. The standard endpoint of the developer provider set on the catalog entry,
   when one is set. The provider is matched by name, ignoring case and
   punctuation.
2. The standard endpoint of the provider named by the model id's author
   segment, `anthropic` for `anthropic/claude-haiku-5.5`.
3. The model's own price in OpenRouter's models listing (the `pricing` field of
   its `/models` entry).

A complete rate has the input, cached input, and output rates all known, where
a price that lists no cached input rate takes its input rate for it. A step that
finds no endpoint, or a price without a complete rate, falls to the next one.
When no step yields a rate, OpenRouter has no list price for the model. The
resolution reports which step answered.

The first two steps read the model's `/models/{id}/endpoints` listing. The third
reads the models listing at `GET /models`, which is read only when the first two
steps yielded no rate. The price of a provider that neither the entry nor the
model id names is read at no step, wherever the endpoints listing places it.

The third step's figure is the one OpenRouter's API reports for the model. It
can differ from the "In / Out Price" on OpenRouter's web page for the model,
which shows the first-listed provider's rate. It is also a third party's rate.
Where OpenRouter spells the developer differently from the model id's author
segment, such as `qwen/…` served by `Alibaba` or `mistralai/…` by `Mistral`,
setting the developer provider on the entry is how an operator gets the
developer's own price.

A developer provider set on the entry therefore decides the price for as long as
its standard endpoint lists a complete rate. Every read, the 24-hour refresh and
the Refresh button included, takes that provider's rate, and falls to the
later steps only when that provider yields none.

A standard endpoint is one whose `tag` has no `flex` segment. OpenRouter lists a
provider's Flex tier as a second endpoint under the same provider name, at a
discount, with a `tag` such as `openai/flex` or `google-vertex/global/flex`.
The first two steps read standard endpoints only: a provider that lists its Flex
endpoint first is priced at its standard one, and a provider that lists only
Flex endpoints yields no rate at its step.

Every list price written from OpenRouter is resolved this way, is dated the UTC
day it was read, and is marked as sourced from OpenRouter. A list price an
operator enters on the model's form is marked as entered by hand. A save of the
form that sends the stored rates and date back unchanged enters nothing: the
entry keeps its list price, date, and source as stored.

### List price refresh

A refresh resolves the list price of every curated catalog entry and writes it
onto the entry, whether or not the entry already holds one and whoever entered
it. The [backend](/components/backend/overview/) runs a refresh in the
background shortly after it starts and every 24 hours after that, and an
operator runs one on demand with the Models page's Refresh button.

An entry is looked up by its OpenRouter slug. An entry without one is looked up
by its aliases, each mapped onto OpenRouter's spelling for the alias's harness
family, and the first alias OpenRouter lists is used. The endpoints listings are
read a bounded number at a time, and each read is given 15 seconds to finish. A
listing that has not answered by then could not be read.

A refresh reads the models listing at most once, the first time an entry reaches
the third step, and every later entry that reaches it reuses that read. When the
models listing cannot be read, the entries that reached the third step are
unresolved and the entries the first two steps answered are written as usual.

Each entry ends a refresh in one of three states:

- Updated: the resolved rate differs from the stored one, or the entry held
  none. The rate, date, and source are written.
- Unchanged: the resolved rate equals the stored one. The date and source are
  still written, so the date states how fresh the figure is.
- Unresolved: OpenRouter does not list the model, the resolution yields no
  complete rate for it, or a listing it needed could not be read. The entry
  keeps what it holds, so a price entered by hand for a model OpenRouter does
  not list stands.

A refresh reports the count of entries in each state beside the total, and
regenerates the public snapshot when any rate changed. Entries are written one
at a time as their listings are read, so a refresh that stops part-way, on a
database failure or because the request that ran it went away, leaves the
entries it reached written. It regenerates the public snapshot for those too.

A catalog entry that carries no list price when a run binding it is enqueued is
filled then, by the same resolution. A launch naming a model the catalog has no
entry for, or one OpenRouter yields no rate for, is refused with the reason
named.

A list price an operator enters on the model's form stands until the next
refresh resolves a rate for that model from OpenRouter.

### Harness-reported cost

Some harnesses drive a single provider directly through an API key and report
the exact cost of a run themselves. Claude Code reports a `total_cost_usd`
figure on its terminal result. A harness-reported cost is recorded as the run's
actual cost; the comparable cost stays computed from the list price.

The [agent harness layer](/components/core/harnesses/#usage-reporting) extracts
any reported cost from each harness's output.
