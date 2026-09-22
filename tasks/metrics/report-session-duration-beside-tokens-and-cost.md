# Report session duration beside tokens and cost

Chart and tabulate a run's session duration everywhere the console and the
site compare models on tokens and cost, so a model's speed is weighed with its
price.

## Current state

Every run records its run time and the durations of its setup, session,
teardown and validation stages, as the metrics page defines them, and the run
record carries them. No comparison surface reports them: a run's duration was
left out of the model comparisons because it depended on which provider
OpenRouter routed the run to, which varies from run to run of one model.

[`pin-every-run-to-the-model-s-official-provider.md`](../gg-client/pin-every-run-to-the-model-s-official-provider.md)
sends every run of a model to its developer's own endpoint. Duration is then a
property of the model, and one that decides whether a model is worth using: a
model that costs the same as another and takes five times as long on a task is
the wrong choice at equal price.

The surfaces that compare tokens and cost today:

- The test case Metrics tab (`TestCaseMetricsPage.tsx`), which charts rating,
  points, tokens and cost per model with `MetricChartWidget`.
- The test case Leaderboard tab (`TestCaseLeaderboardPage.tsx`), which
  tabulates mean cost and mean tokens per model.
- The model overview page (`ModelOverviewPage.tsx`), which folds cost and
  tokens over the model's completed runs.
- The comparison detail page (`ComparisonDetailPage.tsx` and
  `comparisonMath.ts`), which summarizes cost and tokens per arm on the terms
  the comparisons statistics page sets.
- The public site's case and model pages, which show the same figures from the
  snapshot.

## Design

The session duration is the figure compared, since setup, teardown and
validation are the cabinet's time rather than the model's. It is reported only
for a completed run, on the same terms as cost and tokens, and a run recorded
before the stage durations were measured contributes nothing.

Each surface above gains duration beside tokens and cost: a chart on the
Metrics tab, a mean column on the Leaderboard, a fold on the model overview, a
per-arm statistic on the comparison detail page, and the site's copies of each.
Duration is right-skewed like cost and tokens, so the comparisons statistics
page summarizes it the same way, with the median, its spread and the mean.

The metrics page states that session duration is comparable across runs of one
model because of the provider pin, and the comparisons statistics page lists it
as a metric.

## Done when

- [ ] The test case Metrics tab charts session duration per model.
- [ ] The Leaderboard tab, model overview, comparison detail page and the
      site's case and model pages report session duration beside tokens and
      cost.
- [ ] The comparisons statistics page and the metrics page describe the
      metric.
- [ ] Gates green.
