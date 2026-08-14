---
title: Metrics
---

Every run records a small set of metrics describing how much it cost to produce.
These are the numbers surfaced on the [site](/components/site/overview/). They
measure the *resources* a run consumed — distinct from the run's quality
[score and rating](/components/core/results/#reviews), which come from the review.
The metrics exist to let viewers understand a run's cost, not to rank
implementations; the per-case [leaderboard](/components/site/overview/#leaderboard)
ranks by score, never by cost or tokens.

## Run Time

The end to end wall clock time of a run must be recorded. Run time is the least
important metric because it depends heavily on which underlying provider serves
the request. It is recorded for completeness but should be presented as
secondary.

## Tokens

Token usage is the most meaningful resource metric. Every run must record the
following normalized token classes:

- **Uncached input tokens** — input tokens that were not served from the
  provider's cache. If a harness reports input as `input + cache_read`, the
  cached reads must be subtracted so this value excludes them.
- **Cached input tokens** — input tokens served from the provider's cache. These
  are billed at a much lower rate than uncached input tokens, so they are
  tracked separately.
- **Output tokens** — non reasoning output tokens. If a harness reports output
  as `output + reasoning`, the reasoning tokens must be subtracted so this value
  excludes them.
- **Reasoning tokens** — internal reasoning tokens. These are billed as output
  tokens but are tracked separately because they are not useful output to a
  reader.

Each class is **optional**: a class is `null` when the harness does not report it
at all. `null` means "could not be determined" and is deliberately distinct from
`0` ("reported, and was zero") — for example a harness that folds reasoning into
its output total, and so never reports a separate reasoning figure, records `null`
for reasoning rather than `0`.

A `null` class is not lost from the **total**: a harness that doesn't break a split
out still folds those tokens into the class it does report — a cache-unaware
harness reports all input as uncached, and a harness that doesn't separate
reasoning reports it within output — so the total counts them, and the run still
participates in token comparisons. A total is unknown only when *no* input (or
output) class is reported at all. What `null` does signal is that the **breakdown**
is unavailable: a consumer must not, say, chart "cached vs uncached" for a run
whose cached class is `null`, because the split is genuinely unknown rather than
zero.

The [agent harness layer](/components/core/harnesses/#usage-reporting) is
responsible for producing these normalized values from each harness's raw
reporting.

## Cost

Every run must record cost two ways:

- The **comparable cost**, the canonical figure shown on the site. By default it
  is computed from the per token prices that OpenRouter lists for the model
  used, rather than the exact charged amount, because OpenRouter may route a
  single model to different providers that price calls differently, which would
  make raw charged costs inconsistent between otherwise identical runs.
- The **actual cost** charged for the run, recorded alongside the comparable
  cost for reference.

Comparable cost is derived from the recorded token classes and the listed prices
for uncached input, cached input, and output tokens, with reasoning tokens
priced at the output rate.

Both figures are `null` when the cost cannot be determined — including when *no*
token class was reported at all. A run whose usage never reached us is not a free
run, so it is never recorded as `$0.00`: the same unknown-versus-zero distinction
the token classes draw applies to the cost derived from them.

The OpenRouter per-token prices are fetched by the **backend**, not the CLI. The
backend records a model's price **when a run completes** — capturing the rate in
effect at that moment, so a promotional price such as a launch-week discount is
reflected in the runs that ran under it — and again on a **24-hour periodic
refresh**, appending a new observation to the model's price history only when the
price changed. The history is retained per model and shown on the model's detail
page. A run whose model id carries a `:free`-style OpenRouter variant tag is
priced at the model's **base rate**, never `$0`: the free tag is a routing hint,
not a genuinely free run.

### Harness-reported cost

Some harnesses drive a single provider directly through an API key and report
the exact cost of a run themselves — for example, Claude Code reports a
`total_cost_usd` figure on its terminal result. When a harness reports its own
cost, that figure is used for **both** the comparable and the actual cost, and
the OpenRouter price lookup is skipped:

- The reasoning behind the OpenRouter figure — normalizing away OpenRouter's
  per-provider routing — does not apply to a harness that talks to one provider
  at one price, so its reported charge is already provider-stable and serves as
  the comparable figure directly.
- These harnesses pass the provider's native model ID (such as
  `claude-sonnet-4-6`), which is not guaranteed to appear in OpenRouter's
  catalog, so an OpenRouter lookup would fail for them in any case.

The [agent harness layer](/components/core/harnesses/#usage-reporting) is
responsible for extracting any reported cost from each harness's output.
