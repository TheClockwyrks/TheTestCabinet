---
title: Overview
---

A performance test case evaluates how well a model's working code performs.
Between two implementations that both produce correct output, the one that does
less work to get there is the better piece of engineering. If one model writes an
`O(n²)` algorithm and another writes an `O(log n)` one, the `O(log n)` solution
should win, and a performance case is where that difference is measured.

These are cases that either require complex logic to solve at all, or require
processing a large amount of data efficiently, so that a naive but correct
solution is clearly distinguishable from a well-engineered one.

## Measuring with fuel

A benchmark measurement has to be fair and reproducible. Wall-clock time is
neither, because it depends on the machine, on what else is running, and on
scheduling noise, so the same code posts different numbers on different hosts.

Performance cases measure wasmtime's deterministic fuel instead. The model's
solution is compiled to WebAssembly and executed under fuel metering, where fuel
is consumed per unit of work the program does. The fuel a solution consumes to
produce its output is a deterministic function of the code and its input rather
than of the host's speed or load, so it is a reproducible proxy for how much work
the implementation does. Lower fuel is better, and a performance run produces the
same number wherever it runs.

## Shape of a case

A performance case fixes a problem and a contract the solution must implement,
then runs the solution against a set of inputs:

- The model writes a solution in any language that produces an import-free
  `wasm32-unknown-unknown` core module, implementing the entry point the case's
  contract defines.
- The harness loads the built module, runs it against the case's held-out inputs,
  and checks correctness first. A fast wrong answer is no answer at all.
- For a correct solution, the fuel consumed is recorded as the performance
  result.

This is the same wasm sandbox the [adversarial](/testing/adversarial/overview/)
type uses to run model-written code safely, applied to a different question.
There the model's code competes against other models' code; here it competes on
how little work it does.

[Manifests](/testing/performance/manifests/) covers how a case declares its
contract, inputs, and limits, and [Evaluation](/testing/performance/evaluation/)
covers how correctness and fuel combine into a result.

The first performance case is
[Lattice](/testing/performance/lattice/overview/), a deterministic Factorio-style
factory simulation. The model writes the simulation engine (two-lane belts, item
compaction, splitters, inserters, assemblers) and is scored on how little fuel it
spends reproducing a reference engine's exact output.
