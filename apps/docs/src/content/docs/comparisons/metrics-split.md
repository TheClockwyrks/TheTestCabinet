---
title: "The metric split"
---

The per-test-case graphs group runs by the `(harness, model)` pair, so the same
model under two harnesses stays two series. Merging them would average a
multiple-fold cost gap into one meaningless number.

The graphs live in the shared `@test-cabinet/ui` package, so the internal
console and the public site group runs identically.

## Aggregators

Four client-side aggregators use the pair as their fold key. The fold happens
entirely in the client.

| Location | What it groups |
| --- | --- |
| `packages/ui/src/primitives/MetricChartWidget.tsx` — `meanBars()` / `runBars()` | the token and cost bars |
| `packages/ui/src/app/pages/testcases/[slug]/TestCaseMetricsPage.tsx` — `ratingModels` | the ratings chart |
| `packages/ui/src/app/pages/testcases/[slug]/TestCaseLeaderboardPage.tsx` — `accs` | the leaderboard |
| `packages/ui/src/app/pages/gamejams/[slug]/JamMetricsPage.tsx` | reuses `MetricsContent` and the same widgets |

The key is the harness slug and the canonicalized model id, joined by a NUL
separator, which neither part can contain. Groups keep their first-seen order.

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
