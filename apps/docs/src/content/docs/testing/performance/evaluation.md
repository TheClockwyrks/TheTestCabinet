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
anything.

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
could be. A published run may still carry a human
[review](/components/core/results/#reviews) discussing the approach the model
took, but the decisive signal here is correctness plus the fuel number.

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
