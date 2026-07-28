---
title: "The metric split"
---

The per-test-case metric graphs group runs by **model alone**. Two runs of the
same model under different harnesses land in the same bar, so a 6× cost gap
between [Pi and Kilo](/comparisons/overview/#why-this-exists) is averaged into a
single meaningless number. This layer changes the grouping key so each
**`(harness, model)`** pair is its own series, and removes gg from these graphs
entirely.

Because the graphs live in the shared `@test-cabinet/ui` package, this change
ships to **both** the internal console and the public site at once.

## The grouping key today

Every aggregator keys on `canonicalModelId(run.subject.modelId)` and uses the
harness only as a label tiebreaker. There are **four** such spots, all client-side
— no backend aggregation is involved:

| Location | What it groups |
| --- | --- |
| `packages/ui/src/primitives/MetricChartWidget.tsx` — `meanBars()` / `runBars()` | the token and cost bars |
| `packages/ui/src/app/pages/testcases/[slug]/TestCaseMetricsPage.tsx` — `ratingModels` | the ratings chart |
| `packages/ui/src/app/pages/testcases/[slug]/TestCaseLeaderboardPage.tsx` — `accs` | the leaderboard |
| the game-jam Metrics tab | reuses the same `MetricsContent`/widgets |

`canonicalModelId` (`packages/ui/src/modelId.ts`, mirrored in Rust at
`crates/core/src/model_id.rs`) strips an `openrouter/` prefix and, for OpenRouter
harnesses, a trailing `:tag`. That is why `openrouter/anthropic/claude-opus-4.8`
from OpenCode collapses into the same bar as `anthropic/claude-opus-4.8` from
another harness.

## The change

The grouping key becomes the composite **`(harnessSlug, canonicalModelId(modelId))`**
in all four spots. Each already has `run.subject.harnessSlug` in hand.

- **Keep** the model-id canonicalization. Splitting on harness is orthogonal to
  it: `openrouter/anthropic/claude-opus-4.8` and `anthropic/claude-opus-4.8` are
  still the _same model_ and must still canonicalize together — we are adding the
  harness axis, not removing the model axis. The `:tag`-stripping argument to
  `canonicalModelId` stays exactly as it is.
- **Labels** become `<model name> · <harness>` (the console already uses this
  disambiguator form for per-run bars; it becomes the primary label).
- **Colors** stay keyed on the model's provider (`providerColor`). When one model
  has several harness bars they share a provider hue; distinguish the harnesses
  within that hue (a shade ramp or the harness label), never by recoloring the
  model.

No backend or schema change is required. Harness and model are already separate
fields on every [run record](/components/core/run-records/) (`RunSubject.harnessSlug`
and `RunSubject.modelId`), and the `run` table already lifts both into their own
columns.

## gg is excluded from these graphs

gg runs are **filtered out** of the per-test-case metric and leaderboard graphs.
A gg run is configured by a [capability set](/gg/overview/#the-capability-set)
whose agents may span **several models**, so it has no single `modelId` to plot on
a per-model axis — forcing it onto one would distort both its own data and the
third-party bars beside it. This matches the
[existing rationale](/gg/overview/) for keeping gg separate; only the _other_ half
of that rationale (that harnesses are interchangeable) is what this feature
overturns.

gg's results are surfaced in its own [aggregation views](/gg/result-aggregation/).
To compare a gg configuration against a third-party harness, use a
[comparison experiment](/comparisons/experiments/), which is built to place gg and
non-gg arms on equal footing.

## Orchestrator is not part of the key

A run also carries an [orchestrator](/orchestrators/overview/)
(`RunSubject.orchestratorSlug`), and one-shot versus `ralph` materially changes
cost. It is **not** added to the split key, because **`ralph` is being retired** —
gg subsumes what a multi-session orchestrator offered, so in practice every
compared non-gg run is one-shot and the orchestrator axis is constant. If a
`ralph` run appears in a case's history it simply shares its harness's bar; do not
add an orchestrator dimension to these graphs. (A [comparison experiment](/comparisons/experiments/)
still records the orchestrator among its held-constant controls, so a stray
mismatch there is surfaced as a confound rather than silently mixed in.)
