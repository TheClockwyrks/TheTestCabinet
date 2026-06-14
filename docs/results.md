# Results

## Overview

A run's value is in its output: the implementation a model produced, together with
the metrics describing how it got there. The Test Cabinet publishes both so that
anyone can inspect, clone, and play the result. The final product is released as
it is, including any bugs and flaws, rather than being reduced to graphs or a
single percentage.

## Generated Code

Each published run's generated implementation must be released as its **own**
public git repository.

- Releasing each run as a standalone repository keeps results independent and maps
  cleanly onto per run hosting and embedding. See [Site](./site.md#hosting).
- The generated implementation must include a README and any other documentation
  that a user needs to clone the repository and run it locally. Requiring this
  documentation is part of every test case.

## Run Record

Each published run's [run record](./run-records.md) must be added to the dataset
the site is built from, with its links pointing at the run's source repository and
playable build.

## Publishing

Publishing a run must be an explicit operation that takes a finished run and:

- Releases its generated code to a public repository.
- Makes its playable build available for embedding.
- Adds its run record to the site's dataset.

The publish operation must be idempotent and must be usable in batch, so that a
sweep producing many runs can be published without manual handling of each one.
