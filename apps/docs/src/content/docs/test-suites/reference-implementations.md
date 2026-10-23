---
title: "Reference Implementations"
---

Reference implementations are hand-curated implementations that demonstrate what
the test suite is intended to look like. A test suite holds at most one
reference implementation per supported engine, and at least one across all
engines.

All reference implementations are published with the test suite and may be
played directly via The Test Cabinet's UI. All reference implementations are
also strictly required to pass every validator the test suite declares.

## Layout

Each reference implementation lives in a folder named for the engine it targets,
directly under the suite tree:

```
reference-implementations/
  none/
  simple-2d/
```

Every folder name is one of the engines declared by the suite's
[test case definitions](/test-suites/test-case-definition/). Each folder
holds a complete, buildable project laid out exactly as a run's workspace for
that engine, so the same commands apply to a reference implementation and to a
model's produced implementation without translation.

## Building

A reference implementation is built and checked with the
[test case definition's](/test-suites/test-case-definition/) `[build]` and
`[toolchain]` commands, run from the reference implementation's own folder. The
`[build]` commands install dependencies and produce the static build; the
`[toolchain]` commands typecheck, lint, format, and test it. Every declared
command exits zero.

## Verification

A reference implementation is verified by running the suite's
[validators](/test-suites/validators/) against the built implementation. Every
validator passes, and every assertion each validator returns passes. This proves
the suite's specifications are implementable as written and that each validator
decides the condition it claims to decide.
