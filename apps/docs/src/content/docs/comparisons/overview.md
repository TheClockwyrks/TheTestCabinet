---
title: "Overview"
---

A harness comparison is The Test Cabinet's A/B test. It runs the same benchmark
under several harnesses, or several [gg](/gg/overview/) configurations, holds
every other variable constant, and presents the cost, token, session duration,
and score data side by side so a reader can judge for themselves. This section
documents the metric split the capability depends on, the experiment that
produces the data, the diagnostics that explain a cost gap, the statistics that
summarize noisy runs, and how a comparison and its runs reach the public site.

## The harness axis

Running the same model on the same benchmark under different harnesses produces
costs that differ by multiples rather than by percentages. That difference is
the most valuable single measurement The Test Cabinet publishes, and a graph
that merges every harness of a model into one bar hides it entirely. The harness
is therefore a first-class axis everywhere a run's numbers are presented.

## The three layers

The capability is built in three layers, each with its own page.

1. [The metric split](/comparisons/metrics-split/). The per-test-case metric
   graphs, ratings chart, and leaderboard group runs by the `(harness, model)`
   pair, and exclude gg. The graphs are shared UI, so the split applies to the
   internal console and the public site alike.

2. [Comparison experiments](/comparisons/experiments/). A saved, named
   experiment fixes the test and pits two or more configurations against each
   other at `N` runs per arm. A configuration is a harness on a model or a gg
   configuration with a model per slot, and the two shapes mix freely in one
   experiment. The experiment triggers the runs, scores each from automated
   validation alone, and gathers each arm's outcome distribution and
   [diagnostics](/comparisons/diagnostics/).

3. [Publishing](/comparisons/publishing/). A comparison, and optionally the runs
   behind it, is published to the public site so a reader can drill into an
   individual run. Comparisons are created and run from the web console; the
   public site renders them read-only.

## Design principles

Two principles run through every layer.

Never merge harnesses. A model run under two harnesses is two different things.
The data is never reduced to a single bar, average, or rank that hides which
harness produced it.

Present data; never declare a winner. A comparison shows distributions, spreads,
sample sizes, and per-run detail. It computes no verdict, crowns no winner, and
asserts no ranking; the reader decides from the presented data. This extends the
site-wide stance that [metrics measure resources, not
rank](/components/core/metrics/), and that [a run is never reduced to a single
number](/components/core/results/).

## gg in comparisons

gg is excluded from the per-model graphs because a gg run's agents may span
several models, leaving no single model to plot on a per-model axis. gg's own
results live in its [aggregation views](/gg/result-aggregation/).

A comparison experiment is where a gg configuration meets a third-party harness
on equal footing: each is one arm, each keeps its own runs and distribution, and
the comparison holds the case and every other control constant across both.
