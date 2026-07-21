---
title: Evaluation
---

A performance run is scored in two steps, in order: **correctness first**, then
**fuel**. A fast wrong answer is no answer at all, so a solution earns a
performance result only once it is known to be correct.

## Correctness

The harness builds the solution with the manifest's required
[`[build]` commands](/testing/performance/manifests/), loads the wasm module, and
runs its [`entry`](/testing/performance/manifests/) function against each declared
[`[[case]]`](/testing/performance/manifests/) input, checking the returned output
against that case's `expected` answer. A submission that fails to build, does not
export the contract's entry point, exceeds the
[sandbox limits](/testing/performance/overview/#measuring-with-fuel-not-time), or
produces a wrong answer on any input is **incorrect** and earns no performance
score — correctness is a gate the solution must pass before its efficiency means
anything. (A correct answer produced just over the fuel ceiling is a distinct
"over the ceiling" outcome that still does not pass but *is* measured — see
[Overshoot](#overshoot-the-fuel-runway) below.)

## Fuel

For a correct solution, the **fuel consumed** running the inputs is the
performance result. Fuel is wasmtime's deterministic measure of work done: it is a
function of the code and its input, not of the host, so the same solution posts
the same number wherever it runs. **Lower fuel is better** — between two correct
solutions, the one that consumed less fuel did less work and is the better
implementation. Larger inputs dominate the total, which is the point: that is
where an `O(log n)` solution pulls decisively ahead of an `O(n²)` one (see
[Overview](/testing/performance/overview/#measuring-with-fuel-not-time)).

Because the measurement is deterministic and reproducible, performance results
are directly comparable across runs and models in a way wall-clock timings never
could be.

## Overshoot: the fuel runway

The fuel ceiling (`[sandbox].fuel_limit`) is the pass/fail line, but a solution
that only *just* misses it and one that misses it by 10× are very different, and
without help the harness cannot tell them apart — wasmtime traps exactly at the
ceiling, so an exhausted run reports no fuel at all. A case may therefore grant a
per-`[[case]]` [`fuel_runway`](/testing/performance/manifests/): the solution is
allowed to keep running past the ceiling, up to `fuel_limit * fuel_runway`, purely
to get a reading.

This adds a middle outcome between pass and fail:

- **Pass** — correct answer produced within `fuel_limit`. Its fuel is the score.
- **Over the ceiling** — correct answer, but produced only past `fuel_limit` (on the
  runway). It does **not** pass and earns no comparable score, but its consumed
  fuel is recorded as the *overshoot*, and its factory is still
  [playable](/components/core/results/) — so you can see exactly how, and how far,
  an inefficient-but-correct solution went over. The Results tab marks it "over
  ceiling" with the percentage over.
- **Incorrect** — wrong answer (any fuel), or it exhausted even the runway.

The runway never moves the pass line; it only buys visibility into a failure. The
multiplier is scaled down for larger inputs, because their verification is costlier
per unit of fuel — so a small input can afford a wide runway (10×) while a large one
keeps it tight (2×).

## No human review

A performance run is graded **entirely** by the harness. Correctness plus the fuel
number is not merely the decisive signal — it is the whole result. A performance
case therefore declares no scoring `[[domain]]` and no `[[review_item]]`
checklist, and a performance run carries no
[review](/components/core/results/#reviews), rating, or writeup: there is nothing
for a reviewer to add that the bit-exact checksum gate and the fuel total have not
already settled. In the console a performance run's detail page opens on a
**Results** tab (where a reviewed run shows its **Verdict**) carrying the recorded
correctness and fuel breakdown, and such runs never enter the unreviewed worklist.

Because fuel alone gives no sense of *how good* a number is, the Results tab places
a correct run against the field: its **rank and efficiency percentile** among every
model's best correct run of the same case, version, and variant. The field is
**per-model-best** — each model counts once, at its lowest fuel — so re-running a
model does not skew the standing, but the run being viewed is placed as itself, so
a slower duplicate still sees where it lands (and that its model already has a
better run). The same per-model-best ranking drives the case's
[Leaderboard](/components/site/overview/#leaderboard) tab, which for a performance
case ranks models by the fuel of their best correct engine instead of by a reviewer
score it does not have.

:::note[How the first case applies this]
[Lattice](/testing/performance/lattice/overview/), the first
performance case, makes the correctness gate **bit-exact**: a submission's factory
state must match a reference engine's at every snapshot, compared by
[checksum](/testing/performance/lattice/architecture/#determinism-and-the-canonical-state)
(Factorio's own desync-detection model). Correctness is graded on a **held-out** set
of scenarios the model never trained on, and only a correct engine's fuel becomes its
result — where a transport-line engine and a move-every-item-every-tick engine post
the same checksums for
[wildly different fuel](/testing/performance/lattice/architecture/#why-this-is-a-performance-case).
:::
