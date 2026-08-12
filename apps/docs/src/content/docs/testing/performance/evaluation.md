---
title: Evaluation
---

A performance run is scored in two steps, in order: correctness first, then fuel.
A fast wrong answer is no answer at all, so a solution earns a performance result
only once it is known to be correct.

## Correctness

The build commands run in the run container, and the validator loads the wasm
module the manifest's `[build] module` names. It runs the contract's `entry`
function against each declared [`[[case]]`](/testing/performance/manifests/)
input and checks the returned output against that case's `expected` answer.

A submission is incorrect, and earns no performance score, when it fails to
build, does not export the contract entry, cannot instantiate, exceeds the
[sandbox limits](/testing/performance/manifests/), or produces a wrong answer on
any input. Correctness is a gate the solution passes before its efficiency means
anything. A correct answer produced just over the fuel ceiling is a distinct
outcome that is measured without passing; see [Overshoot](#overshoot).

### Smoke tests and stress cases

The held-out set runs in two phases, set by each case's `kind`. The smoke tests
run first: tiny instances that each exercise one behavior in isolation, graded on
correctness alone. Only if every smoke test reproduces its `expected` answer do
the stress cases run at all. If any smoke test fails, the stress cases are
skipped and counted as failed.

This catches a broken solution in milliseconds instead of after burning through
the large instances, and it makes a failure legible: the run's Results tab shows
which behavior the solution got wrong, in its own section, before any fuel is
spent. A run is correct only when every case, smoke and stress, passed.

## Fuel

For a correct solution, the fuel consumed running the stress cases is the
performance result. Fuel is wasmtime's deterministic measure of work done: it is
a function of the code and its input rather than of the host, so the same
solution posts the same number wherever it runs.

Lower fuel is better. Between two correct solutions, the one that consumed less
fuel did less work and is the better implementation. Larger inputs dominate the
total, which is where an `O(log n)` solution pulls decisively ahead of an
`O(n²)` one. Because the measurement is deterministic, performance results are
directly comparable across runs and models.

## Overshoot

The fuel ceiling `[sandbox].fuel_limit` is the pass line. A solution that just
misses it and one that misses it by 10× are very different, and wasmtime traps
exactly at the ceiling, so an exhausted run reports no fuel at all. A case may
therefore grant a per-case
[`fuel_runway`](/testing/performance/manifests/), which lets the solution keep
running past the ceiling, up to `fuel_limit * fuel_runway`, purely to get a
reading.

That adds a middle outcome between pass and fail:

- Pass. A correct answer produced within `fuel_limit`. Its fuel is the score.
- Over the ceiling. A correct answer produced only on the runway. It does not
  pass and earns no comparable score, its consumed fuel is recorded as the
  overshoot, and its factory stays [playable](/components/core/results/), so a
  reader can see how far an inefficient-but-correct solution went over. The
  Results tab marks it as over ceiling with the percentage over.
- Incorrect. A wrong answer at any fuel, or a solution that exhausted even the
  runway.

The runway leaves the pass line where it is and buys visibility into a failure.
The multiplier is scaled down for larger inputs, whose verification is costlier,
so a small input can afford a wide runway while a large one keeps it tight.

## No human review

A performance run is graded entirely by the harness. Correctness plus the fuel
number is the whole result, so a performance case declares no scoring `[[domain]]`
and no `[[review_item]]` checklist, and a performance run carries no
[review](/components/core/results/#reviews), rating, or writeup. In the console a
performance run's detail page opens on a Results tab carrying the recorded
correctness and fuel breakdown, and such runs stay out of the unreviewed
worklist.

Because fuel alone gives no sense of how good a number is, the Results tab places
a correct run against the field: its rank and efficiency percentile among every
model's best correct run of the same case, version, and variant. The field is
per-model-best, with each model counted once at its lowest fuel, so re-running a
model does not skew the standing. The run being viewed is still placed as itself,
so a slower duplicate sees where it lands. The same per-model-best ranking drives
the case's [Leaderboard](/components/site/overview/#leaderboard) tab, which for a
performance case ranks models by the fuel of their best correct engine.

:::note[Lattice's correctness gate]
[Lattice](/testing/performance/lattice/overview/), the first performance case,
makes the correctness gate bit-exact: a submission's factory state must match a
reference engine's at every snapshot, compared by
[checksum](/testing/performance/lattice/architecture/). Correctness is graded on
a held-out set of scenarios, and only a correct engine's fuel becomes its result.
A transport-line engine and a move-every-item-every-tick engine post the same
checksums for wildly different fuel.
:::
