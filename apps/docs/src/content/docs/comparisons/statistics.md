---
title: "Statistics"
---

A comparison runs each arm `N` times because a single run is noise. The
statistics turn those `N` runs into an honest summary of the spread. They live
in `crates/core/src/comparison_stats.rs`.

## The one rule

Present the distribution and its sample size; never emit a verdict. No
comparison computes significance, crowns a winner, or draws one arm's bar taller
as a ranking. Every arm is shown with its `n` and its spread, and the reader
draws the conclusion. This is consistent with the site-wide stance that [metrics
measure resources, not rank](/components/core/metrics/).

## Statistic per metric

Each metric has its own shape, and each is summarized on its own terms.

Cost and tokens are right-skewed. A run has a floor, since it cannot cost less
than the minimum work, and a long upper tail. The median is the honest typical
run, and it is reported with its spread: the min and max, and the interquartile
range. The mean is reported alongside it, because the mean is what is actually
paid averaged over many runs, and for a skewed metric it sits above the median.
The gap between them is informative.

Pass rate is a proportion. A plain average understates the uncertainty of a
small sample, so it is summarized with a Wilson score interval.

The automated-only score is bounded. It is reported as a mean fraction with
every run's individual point shown, because at small `n` the points matter more
than any single summary.

## Sample size

Small `n` is the norm, and every view states it plainly.

`n` is always shown. It is never implied, and an arm with three runs is labeled
as such. The raw points are shown alongside the summary, so the box and median
read as an aid over the data rather than as a replacement for it.

Rigor scales to how close the call is. An effect of several multiples dwarfs the
noise at three runs per arm, and showing the two distributions is enough. The
formal machinery earns its keep on close calls, such as two [gg
configurations](/gg/configurations/) that differ by a tenth, where small-`n`
noise can fake a difference. The summaries below stay honest at either end.

## Per-arm statistics

For comparable cost and for total tokens, `MetricSummary::compute` returns `n`,
the median, the mean, the min, the max, the first and third quartiles, the
interquartile range, and a bootstrap confidence interval on the median. A run
missing a metric is left out of that metric's distribution rather than folded in
as a zero.

The interval comes from 10,000 bootstrap resamples, taking the 2.5th and 97.5th
percentiles of the resulting medians. Bootstrapping assumes no normality,
tolerates skew, and stays honest at small `n`, where it correctly returns a wide
interval. With a single run the distribution collapses to a point and the
interval has zero width. An empty sample returns no summary at all, so a view
shows "no runs" rather than a fabricated zero.

The pass rate is the proportion of an arm's scored runs that earned every
auto-covered point, reported with its 95% Wilson score interval.

The [automated-only score](/comparisons/experiments/#automated-only-scoring) is
reported as the mean fraction earned across the arm's scored runs, with each
run's earned-over-total point.

## Comparing two arms

When exactly two arms are placed side by side, the effect size is presented as
the ratio of their medians, ordered so the ratio reads at least one, with both
medians spelled out beside it. The ratio is a presented number, and both
distributions are drawn under it. A ratio is reported only when both arms have a
cost distribution and the denominator median is above zero.

No p-value and no significance badge is shown. A significance verdict is a
verdict, and at three runs per arm a rank-based test would mislead.

## Determinism

The aggregation is computed off recorded runs and is deterministic for a given
set of runs. The bootstrap draws from a seeded SplitMix64 generator, seeded from
the arm's sorted run ids, and nothing in the module reads a clock or a
thread-local generator. A published comparison therefore renders identically
every time, and a recomputation never silently shifts the numbers.
