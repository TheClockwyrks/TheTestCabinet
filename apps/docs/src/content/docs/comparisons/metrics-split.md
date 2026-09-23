---
title: "The metric split"
---

The per-test-case graphs group runs by the `(harness, model)` pair, so the same
model under two harnesses stays two series. Merging them would average a
multiple-fold cost gap into one meaningless number.

The graphs live in the shared `@clockwyrks/ui` package, so the internal
console and the public site group runs identically.

## Aggregators

The client-side aggregators use the pair as their fold key. The fold happens
entirely in the client.

| Location                                                                              | What it groups                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `packages/ui/src/primitives/MetricChartWidget.tsx` — `meanBars()` / `runBars()`       | the points, token, cost and duration bars        |
| `packages/ui/src/app/pages/testcases/[slug]/TestCaseMetricsPage.tsx` — `ratingModels` | the ratings chart                                |
| `packages/ui/src/app/pages/testcases/[slug]/TestCaseMetricsPage.tsx` — `points`       | the mean points per bar, and the order tie-break |
| `packages/ui/src/app/pages/testcases/[slug]/TestCaseLeaderboardPage.tsx` — `accs`     | the leaderboard                                  |
| `packages/ui/src/app/pages/gamejams/[slug]/JamMetricsPage.tsx`                        | reuses `MetricsContent` and the same widgets     |

The key is the harness slug and the canonicalized model id, joined by a NUL
separator, which neither part can contain. Groups are folded in first-seen order
and then drawn in the order the reader picked — see [Bar order](#bar-order).

## Key rules

Model ids stay canonicalized. `canonicalModelId` (`packages/ui/src/modelId.ts`,
mirrored in Rust at `crates/core/src/model_id.rs`) strips an `openrouter/`
prefix and, for OpenRouter-backed harnesses, a trailing `:tag`. Splitting on
harness is orthogonal: `openrouter/anthropic/claude-opus-4.8` and
`anthropic/claude-opus-4.8` are the same model and canonicalize together.

Bars are labeled `<model name> · <harness>`. Colors stay keyed on the model's
provider, so one model's several harness bars share a provider hue and are
distinguished by their labels.

Harness and model are separate fields on every [run
record](/components/core/run-records/) (`RunSubject.harnessSlug` and
`RunSubject.modelId`), and the `run` table lifts both into their own columns, so
the split needs no schema support of its own.

## Bar order

The Metrics tab carries one order control, rendered into every chart's header
row on its trailing edge. The sliders are linked: they all read and write a
single `ChartSort` held by the page, so moving any one of them moves the rest.
That is the point. The charts describe one roster and are only comparable while
they agree on where each bar sits.

| Order          | What it means                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `alphabetical` | By bar label. The default, and what Plot does on its own with an ordinal domain it infers.         |
| `best`         | Best-first on the chart's own metric: lowest cost, fewest tokens, shortest session, most points.   |

`best` is per-chart by design — every chart sorts on the metric it draws, so the
charts are deliberately not in the same order under it. Ties are split the same
way everywhere: by the pair's mean points, highest first, then by label so the
result never depends on the input order. A bar whose metric is unknown sorts
last rather than being read as a zero (which under a lowest-first metric would
rank it best).

The comparator is `orderBars()` in `packages/ui/src/primitives/chartSort.ts`,
and each chart states its resulting order as an explicit `xDomain` — Plot sorts
a domain it infers itself, which would otherwise silently override the choice.

None of this makes a chart a ranking. The board that _is_ a ranking is the
[Leaderboard](/components/web/overview/) tab; the order control only decides
where the bars sit.

## Display mode

The token, cost, and session duration charts each carry a display control,
rendered into the same header row as the order control.

| Mode      | What it draws                                               |
| --------- | ----------------------------------------------------------- |
| `bar`     | One bar per pair at its mean. The default.                  |
| `scatter` | One dot per run, with a horizontal rule at the pair's mean. |

Under `bar`, hovering a bar replaces it with the box plot of the runs it
averages: whiskers at the minimum and maximum, a box over the interquartile
range, a tick at the median, and a dashed tick at the mean. The tooltip states
those same figures as text, with the sample size. A pair holding one run draws
as a point, which is what a sample of one has to say about its spread.

Under `scatter`, each dot links to the run it stands for. Its tooltip names the
pair, the run's own figure, when the run started, the pair's mean, and the run
id.

Each chart owns its control. The order control is shared because the charts are
only comparable while the bars sit in the same places; the display mode is a
reading of one chart's own metric, so a reader sets cost to `scatter` and tokens
to `bar` to put a spread beside a magnitude. Both modes read one fold and one
order, so the mean a bar draws is the rule a scatter draws, and the axis is
identical under either.

Quartiles are cut by the linearly interpolated quantile the [comparison
statistics](/comparisons/statistics/) define, so a box here and a box on a
comparison agree. These charts fold in the browser over whatever runs the reader
has scoped, and summarize without a bootstrap interval. Session duration is
the harness session alone, and a run recorded before the stage durations were
measured is left out of that chart. It is comparable across runs of one model
because every run is pinned to that model's own provider.

## gg exclusion

gg runs are filtered out of the per-test-case metric, ratings, and leaderboard
graphs. A gg run is configured by a [capability set](/gg/overview/) whose agents
may span several models, so it has no single `modelId` to plot on a per-model
axis, and forcing it onto one would distort both its own data and the
third-party bars beside it.

gg's results are surfaced in its own [aggregation
views](/gg/result-aggregation/). To place a gg configuration against a
third-party harness, use a [comparison experiment](/comparisons/experiments/),
which puts gg and non-gg arms on equal footing.

## Orchestrator

A run also carries an [orchestrator](/orchestrators/overview/)
(`RunSubject.orchestratorSlug`). `one-shot` is the only built-in, so the
orchestrator is constant across every compared run and stays out of the split
key. A [comparison experiment](/comparisons/experiments/) records the
orchestrator among its held-constant controls, so a mismatch there surfaces as a
confound.
