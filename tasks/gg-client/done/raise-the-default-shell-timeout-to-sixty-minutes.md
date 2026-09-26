# Raise the default shell timeout to sixty minutes

Run a shell command that names no `timeoutSecs` under a sixty-minute ceiling,
so a legitimate build or test suite is never killed by the default and only a
command that hangs pays for the wait.

## Current state

`SHELL_DEFAULT_TIMEOUT_SECS` in `crates/gg/src/tools/mod.rs` is 600 seconds,
stated in the tool's parameter description, the membrane restatement, the WIT
document, every language SDK's shell documentation under `packages/gg-sandbox*`
and on the shell page of the docs. On 2026-09-23 a run of `z-ai/glm-5.3-flash`
asked for a 590-second timeout on `cargo nextest run -p test-cabinet-gg` in a
fresh target directory and was killed twice, each time after the compile and
before the tests, and spent two turns on it.

A killed legitimate command costs the turn, the compile it was part way
through, and the consecutive error count. A hung command under a long ceiling
costs the wait once.

## Design

Make the default 3600 seconds. State the figure everywhere the current one is
stated, and keep the per-call `timeoutSecs` and its clamps as they are.

## Done when

- [x] A call naming no timeout runs under 3600 seconds.
- [x] The tool description, the SDK documentation of every arm, the WIT
      document and the shell page name 3600.
- [x] Gates green.
