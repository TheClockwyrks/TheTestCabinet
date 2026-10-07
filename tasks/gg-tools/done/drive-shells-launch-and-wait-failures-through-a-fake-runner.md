# Drive shell's launch and wait failures through a fake runner

Reach the two `run_command` branches that answer a shell call with a classified
failure and no `ShellData`, by substituting a runner that reports them, and the
signal-terminated branch that reports a process with no exit code.

## Current state

`run_command` returns early on `ShellStatus::LaunchFailed` at
`crates/gg/src/tools/shell.rs:560`, and again on `ShellStatus::WaitFailed` at
`crates/gg/src/tools/shell.rs:591`. Both are the shape the comment above the
first calls "a failure of the call rather than a result of it": a `ToolFailure`
from the runner, the runner's message, and no sidecar. The exit-code arm below
them reports `None` as "terminated by signal"
(`crates/gg/src/tools/shell.rs:605-620`).

The seam that makes them reachable already exists.
`ToolContext::with_shell` (`crates/gg/src/tools/mod.rs:512`) swaps the runner,
`StubShellRunner` (`crates/gg/src/tools/shell.runner.rs:295`) records every
request and answers each with one fixed `ShellExecution`, and
`a_substituted_runner_replaces_the_process_entirely`
(`crates/gg/src/tools/shell.runner.test.rs:118`) drives `run_command` through it.
`StubShellRunner::exiting` (`crates/gg/src/tools/shell.runner.rs:305`) is its one
constructor, and it only builds `ShellStatus::Exited { code: Some(code) }`.

`the_real_runner_reports_a_launch_failure_with_empty_streams`
(`crates/gg/src/tools/shell.runner.test.rs:84`) asserts the launch failure at the
runner, before `run_command` sees it.

## Design

Add three constructors beside `exiting` at
`crates/gg/src/tools/shell.runner.rs:305`, each answering with one fixed status
and empty streams: `launch_failing(failure, message)`, `wait_failing(failure,
message)` and `signalled()`, the last answering `ShellStatus::Exited { code:
None }`.

The tests land in `crates/gg/src/tools/shell.runner.test.rs`, beside the
substituted-runner section that starts at `:107`. Each builds a `ToolContext`
over a `TempDir` with `with_shell`, then calls `ShellTool`'s `invoke` with
`json!({ "command": "…" })` so the JSON adapter and `run_command` are both on the
path.

- `a_launch_failure_is_a_failure_of_the_call_and_carries_no_sidecar` — the stub
  answers `LaunchFailed { failure: ToolFailure::IoError, message }`. The outcome
  is not ok, its `failure` is `IoError`, its output is the runner's message, and
  `outcome.data` is `None`.
- `a_launch_failure_keeps_the_runners_classification` — the stub answers
  `LaunchFailed { failure: ToolFailure::NotFound, .. }`, and the outcome's
  `failure` is `NotFound`: `run_command` passes the runner's judgement through
  rather than re-deriving one.
- `a_wait_failure_is_a_failure_of_the_call_and_carries_no_sidecar` — the stub
  answers `WaitFailed { failure: ToolFailure::IoError, message }`, with the same
  three assertions.
- `a_signal_terminated_command_reports_no_exit_code` — the stub answers
  `Exited { code: None }`. The outcome is not ok, its `failure` is `None` because
  the process ran, its summary is `terminated by signal`, and the `ShellData`
  sidecar carries `exit_code: None`.

## Done when

- [ ] `StubShellRunner` can answer a launch failure, a wait failure and a
      signal-terminated exit.
- [ ] Each of the four cases above is its own `#[tokio::test]` driving
      `ShellTool`'s `invoke` with a synthesized JSON argument object.
- [ ] The two classified-failure cases assert that no `ApiData` sidecar is
      attached.
- [ ] Gates green.
