---
title: Overview
---

A **performance** test case evaluates not just whether a model writes working
code, but **how well that code performs**. It targets an aspect of software
development that most benchmarks ignore: given two implementations that both
produce correct output, the one that does less work to get there is the better
piece of engineering. If one model writes an `O(n²)` algorithm and another writes
an `O(log n)` one, the `O(log n)` solution should win — and a performance case is
where that difference is measured rather than waved away.

These are cases that either require **complex logic** to solve at all, or require
**processing a large amount of data efficiently**, so that a naive but correct
solution is clearly distinguishable from a well-engineered one.

## Measuring with fuel, not time

The hard part of measuring performance in a benchmark is making the measurement
**fair and reproducible**. Wall-clock time is neither: it depends on the machine,
on what else is running, and on scheduling noise, so the same code can post
different numbers on different hosts.

Performance cases sidestep this with **wasmtime's deterministic fuel**. The
model's solution is compiled to WebAssembly and executed under fuel metering,
where fuel is consumed per unit of work the program does. The amount of fuel a
solution consumes to produce its output is a **deterministic** function of the
code and its input — it does not vary with the host's speed or load — so it is a
reproducible proxy for how much work the implementation actually does. **Lower
fuel is better.**

Because the measurement is fuel rather than time, a performance run produces the
same number wherever it runs, which is exactly what a comparable benchmark needs.

## Shape of a case

A performance case fixes a **problem** and a **contract** the solution must
implement, then runs the solution against a set of inputs:

- The model writes a solution in **any language that compiles to wasm** — Rust,
  JavaScript via [`componentize-js`](https://github.com/bytecodealliance/ComponentizeJS),
  and others — implementing the entry point the case's contract defines.
- The harness builds the solution to a wasm module, runs it against the case's
  **inputs**, and **checks correctness first**: a fast wrong answer is no answer
  at all.
- For a correct solution, the **fuel consumed** is recorded as the performance
  result.

This is the same wasm sandbox the [adversarial](/testing/adversarial/overview/)
type uses to run model-written code safely, applied to a different question: there
the model's code competes against other models', here it competes against the
clock — measured in fuel.

See [Manifests](/testing/performance/manifests/) for how a case declares its
contract, inputs, and limits, and [Evaluation](/testing/performance/evaluation/)
for how correctness and fuel combine into a result.

The first performance case is
[**Lattice**](/testing/performance/performance-factorio/overview/), a deterministic
Factorio-style factory simulation: the model writes the simulation **engine** —
two-lane belts, item compaction, splitters, inserters, assemblers — and is scored on
how little fuel it spends reproducing a reference engine's exact, bit-for-bit output.
