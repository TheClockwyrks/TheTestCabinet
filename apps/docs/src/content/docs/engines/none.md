---
title: None
---

None (slug `none`) is the default engine and the baseline every test case
supports. The run provides no runtime, so the build supplies its own frame loop,
input handling, audio, asset loading, and diagnostics.

A case run under `none` measures a model building a game from nothing. Its
specification states the whole deliverable, and nothing about the build is
provided.

## Instrumentation

Because no engine host exists, a `none` run is driven through the
[instrumentation](/testing/end-to-end/instrumentation/) the case mandates: a debug
API on a case-specific global, a deterministic core beneath it, and a read-only
debug overlay. That contract is written by the model, so it is load-bearing. A
build that does not expose it fails the checklist points its absence hides.

## Documentation

No engine documentation is seeded, and the prompt carries no engine preamble. The
seeded files are the case's own specification, assets, and reference media.
