# Metrics

## Overview

Every run records a small set of metrics describing how much it cost to produce.
These are the numbers surfaced on the [site](./site.md). The Test Cabinet does
not reduce runs to a single score; the metrics exist to let viewers understand
the resources a run consumed, not to rank implementations.

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
  are billed at a much lower rate than uncached input tokens, so they are tracked
  separately.
- **Output tokens** — non reasoning output tokens. If a harness reports output as
  `output + reasoning`, the reasoning tokens must be subtracted so this value
  excludes them.
- **Reasoning tokens** — internal reasoning tokens. These are billed as output
  tokens but are tracked separately because they are not useful output to a
  reader.

The [agent harness layer](./harnesses.md#usage-reporting) is responsible for
producing these normalized values from each harness's raw reporting.

## Cost

Every run must record cost two ways:

- The **comparable cost**, computed from the per token prices that OpenRouter
  lists for the model used. This is the canonical figure shown on the site. It is
  used instead of the exact charged amount because OpenRouter may route a single
  model to different providers that price calls differently, which would make raw
  charged costs inconsistent between otherwise identical runs.
- The **actual cost** charged for the run, recorded alongside the comparable cost
  for reference.

Comparable cost is derived from the recorded token classes and the listed prices
for uncached input, cached input, and output tokens, with reasoning tokens priced
at the output rate.
