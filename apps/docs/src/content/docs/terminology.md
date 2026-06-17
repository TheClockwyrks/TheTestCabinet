---
title: Terminology
---

## Catalog

The term "catalog" is used to refer to The Test Cabinet's full set of test
cases.

## Harness

In the context of The Test Cabinet, "harness" can refer to two elements:

1. The Test Cabinet itself
2. Agentic harnesses used to drive model(s)

The Test Cabinet handles running other harnesses. It does not directly hit LLM
APIs or implement an agentic loop. That responsibility lies entirely with the
agentic harnesses that The Test Cabinet uses to run the tests.

## Model

Models are the large language models that determine the actions an agentic
harness takes.

## Publishing

"Publishing" refers to pushing an implementation to GitHub and its result to The
Test Cabinet's website. Test runs exist only locally until published.

## Reporters

Reporters are The Test Cabinet components capable of reporting run results. Only
GUI reporters allow users to interact with test case implementations.

## Review

All test cases are manually reviewed after the implementation is complete. This
allows the reviewer to assess how well a model matched the spec, check for any
bugs, and otherwise provide non-automated feedback about the run result. Reviews
are slightly subjective since games don't map cleanly to a rigid grading scale.

## Run Records

A run record is produced each time a test case runs to completion. This records
all information from the run, such as its run time, version information, and
token/cost data.

## Runners

The term "runner" is used to refer to any The Test Cabinet component that is
capable of running test cases.

## Test Case

Test cases provide the scenarios used for testing. Each test case represents
some project that must be implemented from scratch.

## Validation

The Test Cabinet makes use of a small amount of automated validation. These are
used for basic checks like "Does this implementation even build?" or "How well
does the implemented UI match the reference image?".

## Variant

Test cases may define multiple variants, which identify modifications to make to
the specifications provided as input for the test. These variants may change
game mechanics, add or remove content, and may noticeably affect the difficulty
of a test case.
