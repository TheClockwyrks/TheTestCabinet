# Raise the default shell timeout to ten minutes

Run a shell command that names no `timeoutSecs` under a ten-minute ceiling, so
a build or a test suite completes on the first call.

## Current state

`DEFAULT_TIMEOUT_SECS` in `crates/gg/src/tools/shell.rs` is 120 seconds, stated
in the tool's parameter description and on the shell page of the docs. A run of
`openai/gpt-5.6-sol` on 2026-09-22 ran the gg crate's unit tests through the
shell without a timeout twice in a row, and both calls were killed at two
minutes during the test compile. Each cost a turn and counted toward the
consecutive error ceiling before the model raised the figure.

Two minutes is under what a compile of this repository's crates takes. Claude
Code's default for the same tool is ten minutes.

## Design

Make the default 600 seconds. State the new figure in the tool's parameter
description and on `apps/docs/src/content/docs/gg/shell.md`, and keep the
per-call `timeoutSecs` and its clamps as they are.

## Done when

- [ ] A call naming no timeout runs under 600 seconds.
- [ ] The tool description and the shell page name 600.
- [ ] Gates green.
