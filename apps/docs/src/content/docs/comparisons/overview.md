---
title: "Overview"
---

**Harness comparisons** are The Test Cabinet's A/B-testing capability: run the
same benchmark under several harnesses (or several [gg](/gg/overview/)
configurations), hold everything else constant, and publish the cost, token, and
score data side by side so a reader can judge for themselves. This section
documents the design of that capability — the metric split it depends on, the
comparison experiment that produces the data, the diagnostics that explain _why_
one harness costs more than another, the statistics that summarize noisy runs
honestly, and how a comparison and its runs are published to the public site.

:::note[Status]
This is the design specification for a feature landing in **v0.7.0**, written to
be implemented from directly. Where a page names a concrete file, function, or
database column, that is the current code the change builds on — verify it still
exists before relying on it.
:::

## Why this exists

Up to now every published run used a single harness ([OpenCode](/harnesses/opencode/overview/)),
so which harness ran was a constant and never needed to be a dimension. That
assumption broke the moment we measured. Running the **same model on the same
benchmark** ([Carom](/testing/end-to-end/overview/)) across five harnesses
produced wildly different costs:

| Harness | Cost / run | Tokens / run | Automated score |
| --- | --- | --- | --- |
| Pi | **$0.51–0.56** | 272K–320K | 68/70 (100% of validators) |
| gg | ~$? (n=1) | ~835K | — |
| Kilo Code | **$3.50–4.00** | 3.1M–3.4M | — |

Pi and Kilo differ by **6–7×** on identical work. That is not noise to be
averaged away — it is the single most valuable data point The Test Cabinet can
publish, and it is invisible in a graph that merges every harness of a model into
one bar. The comparison capability makes that difference first-class.

## The three layers

The capability is built in three independently shippable layers. Each has its own
page.

1. **[The metric split](/comparisons/metrics-split/).** The existing per-test-case
   metric graphs group runs by _model alone_, collapsing every harness of a model
   into one bar. That merge is corrected so each **`(harness, model)`** pair is
   its own series. gg is **excluded** from these graphs entirely (it has no single
   model to plot). This layer ships to the public site the moment it lands,
   because the graphs are shared UI.

2. **[Comparison experiments](/comparisons/experiments/).** A saved, named
   experiment that fixes the test (case, version, variant, orchestrator, container
   build) and pits two or more **configurations** against each other — a harness on
   a model, or a gg configuration with a model per slot, freely mixed — at _N_ runs
   per arm. It triggers those runs, computes an
   **[automated-only score](/comparisons/experiments/#automated-only-scoring)** so
   no human review is needed, and gathers each arm's outcome distribution and
   **[diagnostics](/comparisons/diagnostics/)**.

3. **[Publishing](/comparisons/publishing/).** A comparison, and optionally the
   full batch of runs behind it, is published to the public site so a reader can
   drill all the way into an individual run. Comparisons are **created and run
   only from the internal console and the Tauri app**; they are **read-only** on
   the public site.

## Design principles

Two principles run through every layer and are non-negotiable.

- **Never merge harnesses.** A model run under two harnesses is two different
  things. The data must never be reduced to a single bar, average, or rank that
  hides which harness produced it. This is the entire point.

- **Present data; never declare a winner.** A comparison shows distributions,
  spreads, sample sizes, and per-run detail. It does **not** compute a verdict,
  crown a winner, or assert that one harness is "better" — the reader decides from
  the presented data. This extends the existing site ethos that
  [metrics measure resources, not rank](/components/core/metrics/), and that
  [The Test Cabinet does not reduce a run to a single score](/components/core/results/).
  The [statistics](/comparisons/statistics/) exist to describe honestly, not to
  adjudicate.

## How it relates to gg

The [gg overview](/gg/overview/) already carves gg out of the per-model graphs,
on the reasoning that the third-party harnesses are "so similar that which harness
ran barely matters." The measurements above show the second half of that sentence
is **false** — the harnesses are _not_ similar. This feature corrects that: the
non-gg harnesses now each get their own series (the [metric split](/comparisons/metrics-split/)).
gg stays out of the per-model graphs for the _other_ reason given there, which
remains true: a gg run's agents may span several models, so it has **no single
model to plot**. gg's own results live in its
[aggregation views](/gg/result-aggregation/); the comparison experiment is the
bridge that lets a gg configuration be compared head-to-head against a third-party
harness on equal footing.
