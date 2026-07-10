---
title: Overview
---

> This section is about how The Test Cabinet handles tests for harnesses/models.
> It does not cover how The Test Cabinet itself is tested.

The Test Cabinet supports five classes of test cases:

- [End to End](/testing/end-to-end/overview/)
- [Full Stack](/testing/full-stack/overview/)
- [Adversarial](/testing/adversarial/overview/)
- [Asset Generation](/testing/asset-generation/overview/)
- [Performance](/testing/performance/overview/)

Each type of test is designed to evaluate harnesses and models' capabilities in
different ways. End to end tests are used to evaluate how well a harness/model
can take a large task to completion while remaining fully autonomous. These
types of tasks require long-horizon planning and benefit significantly from
harness-provided planning assistance.

Full stack tests are end-to-end tests with a twist: the model must also produce
the program's own 2D assets during the run — its sprites, particle effects, and
sound — using asset-generation binaries baked onto its PATH, rather than being
handed them. One model both makes the art and builds the program, so a full-stack
case measures whether a single model can carry a whole small product to a coherent
whole. They are scored exactly like end-to-end tests, with the produced assets'
quality judged as part of the playable result.

Adversarial tests are smaller-scoped tests that require a model to create an
implementation that is then tested head-to-head against other models'
implementations. These are typically test cases that require the model to "bake
in" intelligence, i.e. by building a "classical" AI controller. Once the model's
code has been written, the model does not participate in the evaluation of its
implementation against other models' implementations.

Asset generation tests evaluate how well models can make use of tools to handle
creating new graphical assets. This is a significantly different class of tests
as it does not test code generation.

Finally, performance tests are used to evaluate not just whether a model
implements working code, but how well the model's code performs. This tests an
aspect of software development that's largely ignored by most other benchmarks.
If two models put out working code but one implements an `O(n^2)` algorithm and
the other produces an `O(log n)` algorithm, the `O(log n)` algorithm should be
judged as better.
