---
title: "Statistics"
---

A comparison runs each arm _N_ times because a single run is noise — Pi lands
anywhere in 272K–320K tokens, Kilo in 3.1M–3.4M. The statistics turn those _N_
runs into an honest summary. Their job is to **describe the spread**, never to
declare a winner. This page is the methodology, written to be implemented from by
someone who is not a statistician.

## The one rule

**Present the distribution and its sample size; never emit a verdict.** No
comparison computes "significance," crowns a winner, or draws one arm's bar taller
as a ranking. Every arm is shown _with its `N` and its spread_, and the reader
draws the conclusion. This is a deliberate design constraint, consistent with the
site-wide stance that [metrics measure resources, not rank](/components/core/metrics/).

Everything below serves that rule.

## Match the statistic to the metric

The metrics have different shapes, and the wrong summary lies about each.

- **Cost and tokens are right-skewed.** A run has a floor (it cannot cost less than
  the minimum work) but a long upper tail (it can blow up). The **median** is the
  honest "typical" run; report it with a spread — the **min/max** and the
  **interquartile range (IQR)**. Also report the **mean**, because the mean is what
  you actually pay averaged over many runs, and for a skewed metric the mean sits
  above the median — showing both, and the gap between them, is informative, not
  redundant.
- **Pass rate is a proportion.** "100% of validators passed" over a handful of runs
  is a proportion, and a plain average understates the uncertainty of a small
  sample. Summarize it with a **Wilson score interval**, not a normal one.
- **The score (e.g. 68/68) is bounded.** Report the **mean with the individual
  points shown**; with small `N`, the points matter more than any single summary.

## Sample size

Small `N` is the reality (you will often have 3–5 runs per arm), and the design
handles it by being honest rather than by pretending.

- **Always show `N`.** It is never implied. An arm with `N = 3` is labeled as such.
- **Show the raw points, not just the summary.** With three runs, the three dots on
  the chart _are_ the data; the box/median is a reading aid over them.
- **Scale rigor to how close the call is** — the key insight for this feature.
  Effect sizes here are enormous: Pi versus Kilo is **6–7×**. An effect that large
  dwarfs the noise at `N = 3`; you do not need statistics to trust it, and the
  design simply shows the two distributions and lets the magnitude speak. Formal
  machinery earns its keep only on the **close** calls — and those are coming: two
  [gg configurations](/gg/configurations/) might differ by 10%, and _there_ small-`N`
  noise can fake a difference. The statistics below are built so the same view is
  honest whether the gap is 6× or 6%.

## What to compute per arm

For each arm, over its `N` runs, for each of cost (`comparable`), total tokens, and
the [automated-only score](/comparisons/experiments/#automated-only-scoring):

- `n`, **median**, **mean**, **min**, **max**, and **IQR** (or standard deviation).
- A **confidence interval on the median/mean via bootstrap**. Bootstrapping —
  resampling the arm's runs with replacement many times and taking the spread of
  the resulting medians — is the right default here: it makes **no normality
  assumption**, tolerates skew, and is honest at small `N` (with three runs the
  interval comes out wide, which is the correct answer). It is mechanical to
  implement and needs no distributional theory.
- For pass rate specifically, the **Wilson interval** rather than the bootstrap.

## Comparing two arms

When the view places two arms side by side:

- Show the **effect size as a ratio** — "Kilo's median cost is ~6.8× Pi's, $3.70
  vs $0.53." The ratio, with both distributions drawn, is the comparison. It is a
  _presented number_, not a verdict.
- Optionally show a **bootstrap confidence interval on the difference** (or ratio)
  of medians, which stays honest as arms get close: a wide interval that straddles
  "no difference" is the view telling the reader the call is too close to make at
  this `N` — **without** the view itself making it.
- Do **not** print p-values or a "significant / not significant" badge. That is a
  verdict in disguise. A rank-based test (Mann–Whitney U) is fine to _compute_ if
  it helps size the difference internally, but at `N = 3` vs `N = 3` it can reach
  at best p ≈ 0.1, so it would only ever mislead if surfaced as a gate.

## Determinism note

The aggregation is computed off recorded runs and must be **deterministic** for a
given set of runs. If the bootstrap uses randomness, seed it from a stable input
(the sorted run ids), so a published comparison renders identically every time and
a re-computation never silently shifts the numbers.
