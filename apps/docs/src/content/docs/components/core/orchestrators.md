---
title: Orchestrators
---

## Overview

An orchestrator decides how a test case's harness sessions are conducted. It
owns the loop around the harness: how many sessions to run, what each one is
told, and when the work is done. The [harness
layer](/components/core/harnesses/) still owns each individual session, meaning
how the harness is invoked, how its usage is parsed, and how its activity is
translated into [events](/components/core/events/). A single session driven to
completion is one orchestrator, `one-shot`; spreading a larger case across
several sessions that build on each other is another.

Orchestration is harness-agnostic: an orchestrator drives sessions the same way
whichever harness is selected. It is therefore a distinct run dimension,
selected per run alongside the test case, variant, harness, and model, and
recorded as `orchestratorSlug` in the [run
record](/components/core/run-records/).

## Orchestrator structure

An orchestrator carries no in-tree code. It is a directory containing:

- a manifest, `orchestrator.toml`, with the orchestrator's `slug`, `name`,
  `description`, the `runner` entrypoint, and any `[params]` the runner reads;
- a runner script, the entrypoint named by the manifest.

This keeps every orchestrator on the same footing. A new strategy can be
supplied entirely from outside this repository (see [External
orchestrators](#external-orchestrators)), and the built-in orchestrators use
exactly the same machinery as a custom one.

The built-in orchestrators live under `orchestrators/<slug>/` in the repo,
embedded into `crates/core` at build time so a backend-driven worker with no
checkout resolves them the same way the CLI does. They are catalogued under
[Orchestrators](/orchestrators/overview/). There is one:

- `one-shot`, a single harness session driven to completion. This is the
  default.

## The execution model

All setup is shared and happens once, exactly as for a single-session run: the
run-container image is pulled, the container is started, authentication is
applied, the harness CLI is installed and probed, and the test case's `init`
command runs. Only then does the orchestrator take over, in place of the single
harness invocation.

The orchestrator's runner script runs inside the run container, so it drives
sessions and inspects progress from where the work happens. Its commands run
natively against the seeded workspace at `/work`, and it reads status and marker
files on the workspace filesystem directly. The whole runner script is bounded
by the run's [maximum runtime](/components/core/execution/), just as a single
session is.

### The `tcab-session` wrapper

A runner script must be able to invoke a harness session without knowing any
harness-specific details, such as which binary, which flags, or which output
format. The run therefore writes a `tcab-session` wrapper onto the run user's
`PATH` inside the container before running the orchestrator. Invoking
`tcab-session "<prompt>"` runs the selected harness's CLI with the adapter's
exact session arguments, substituting the prompt. The harness's output flows
back through the runner script's stream, where it is parsed for usage and
translated into events exactly as a single session is.

The wrapper emits a sentinel line around each session so the run can segment the
output into sessions and sum each session's reported usage into the run's
totals. A `one-shot` run has exactly one segment, so its metrics are identical
to a run with no orchestration layer at all.

#### Where the usage is read from

The wrapper writes each session's stdout, sentinels and all, to a session log
inside the container at `~/.tcab/sessions.log` as well as streaming it back. The
streamed copy is what produces live [events](/components/core/events/); the log
is what the run's [usage and cost](/components/core/metrics/) are read from,
once the runner has exited.

The two carry the same bytes, so the distinction makes no difference to a
healthy run. An exec stream can close as the runner exits and lose its last
lines, though, and the last line is exactly where most harnesses report the
session's totals. When that happened the closing sentinel went missing with it,
the session was discarded whole, and the run was recorded with no token usage
and a cost of `$0.00`, a confident claim of a free run on a run that had cost
real money. Reading the totals off the container's own disk removes the
dependency on the stream surviving.

If the log cannot be read, the streamed copy stands in. Either way a session
that arrives without its closing sentinel is reported as a warning on the run's
event stream rather than silently costed at zero: its tokens are recorded as
unknown, not as none.

### Runner environment contract

The runner script is handed everything it needs through its environment:

| Variable | Meaning |
| --- | --- |
| `TCAB_PROMPT` | The rendered test-case prompt (the goal). An orchestrator wraps this with its own protocol before passing it to `tcab-session`. |
| `TCAB_WORKSPACE` | The seeded workspace directory (`/work`). |
| `TCAB_DEADLINE` | Epoch seconds after which the run's maximum runtime is exhausted. A multi-session runner checks this to stop gracefully before the hard cap. |
| `TCAB_PARAM_<KEY>` | Each `[params]` entry from the manifest, upper-cased (for example `marker_file` becomes `TCAB_PARAM_MARKER_FILE`). |

`one-shot`'s runner is a single `tcab-session "$TCAB_PROMPT"`, and a
multi-session runner is a loop that calls `tcab-session` with a wrapped prompt
until its marker file exists or `TCAB_DEADLINE` is reached.

### Budget and timeouts

The run's maximum runtime bounds the whole orchestrator the same way it bounds a
single session: when it is exceeded, the run is stopped. That hard cap is a
backstop. A multi-session orchestrator is expected to manage the budget itself
through `TCAB_DEADLINE`, stopping after the current session rather than starting
one it cannot finish, and to exit successfully with partial work when the budget
runs out. Because the runner exits normally, the produced workspace is still
collected and [validated](/components/core/validation/): running out of budget
yields a likely-incomplete result rather than a discarded one.

An orchestrator's scratch files, such as a status or marker file, live under a
dot-directory in the workspace so they are easy to keep out of the collected
implementation.

## External orchestrators

Because an orchestrator is a directory of data, one can be supplied at run time
from a directory anywhere on disk rather than from this repository. The
directory has the same shape as a built-in (`orchestrator.toml` plus a runner
script), and its manifest's own slug is authoritative for the run record. A
custom orchestrator is resolved purely at run time, so experimenting with a new
orchestration strategy takes no change to The Test Cabinet's code.

## Selecting an orchestrator

An orchestrator is selected per run, defaulting to `one-shot`. Every runner
selects one and the resolved slug is recorded on the run: the
[CLI](/components/cli/overview/) through `--orchestrator`, the
[driver](/components/driver/overview/) through built-in slugs only, since it has
no access to a submitter's local directory, and the run-execution UI.

A non-default orchestrator is limited to the test types that build a program
over a working session: [end-to-end](/testing/end-to-end/overview/),
[full-stack](/testing/full-stack/overview/), and
[game-jam](/testing/game-jam/overview/). Those are where a multi-session
implementation is needed; the other types build a single artifact in one pass.
The run rejects a non-default orchestrator for any other test type before any
container is started.
