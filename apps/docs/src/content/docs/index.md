---
title: The Test Cabinet
---

The Test Cabinet is an evaluation suite for AI models and harnesses. It does not
attempt to be a purely objective-based benchmark that gives a single numeric
score per model/harness combination, but instead relies on a reviewer running
the final implementation and comparing it against the specs. Implementations are
then assigned a final score based on how well the implementation matches the
specs and whether bugs are present.

Test cases used by The Test Cabinet are very different from existing benchmarks
like SWE Bench Pro. The Test Cabinet's tests do not attempt to be small-scale;
if anything, these test cases are intentionally *not* small scale. The purpose
of the tests is not to answer "How well can a model complete a small task in a
codebase?", but rather "How well can a model handle a large, complex task and
take it to completion autonomously?".

## Audience

This documentation is intended for developers working on The Test Cabinet itself
and for any end users who would like to run The Test Cabinet locally. Developers
will want to primarily refer to the Components section, while end users should
focus their attention on the Quickstart page and User Guide section.

## Status

This project is currently in early development. Expect missing features, janky
implementations, and UI/UX built around knowing the project ahead of time. The
project is not at a state where a user could pick up the project without any
knowledge about it and be able to use it to its full extent.
