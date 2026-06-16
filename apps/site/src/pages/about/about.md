## About The Test Cabinet

The Test Cabinet is a benchmark for coding agents, created to test not only the
models themselves but also the harnesses that drive them. We don't ask models to
fix a bug, implement a single feature, or address a pull request. We ask models
to implement entire games from scratch, then put the results up for anyone to
play.

These tests aren't intended to be a benchmark in the traditional sense. There's
no automated validation that determines the final score for a model. Instead, we
provide the specifications that we used to run the model, the numbers we
recorded during the run, and the final result - bugs included. We test and rate
each build, but you're free to try the implementation yourself and draw your own
conclusions.

Our goal with these tests is simple. We want to see how well models - and
harnesses - can handle large-scale autonomous software development. This is
*very* different than benchmarks like SWE Bench Pro, which tests models on small
scale problems. A model and harness that can handle a single bug is not
necessarily a model/harness that can handle building a large project from
scratch.
