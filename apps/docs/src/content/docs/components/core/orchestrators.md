---
title: Orchestrators
---

A test case is implemented by driving an agent harness. The simplest way to do
that is a single harness session: hand the harness the prompt and let its own
agent loop run to completion. That is enough for small cases, but a larger case
can outgrow what one session can do, and then the work has to be spread across
several sessions that build on each other.

An **orchestrator** decides how those sessions are conducted. It owns the loop
around the harness — how many sessions to run, what each one is told, and when
the work is done — while the harness layer still owns each individual session
(how the harness is invoked, how its usage is parsed, how its activity is
translated into [events](/components/core/events/)). The single-session behaviour
is just one orchestrator (`one-shot`); a multi-session strategy would be another.

Orchestration is **harness-agnostic**: an orchestrator drives sessions the same
way regardless of which harness is selected. It is therefore a distinct run
dimension, selected per run alongside the test case, variant, harness, and model,
and recorded as `orchestratorSlug` in the [run record](/components/core/run-records/).

## Orchestrators are data, not code

Unlike a [harness](/components/core/harnesses/) — whose imperative half (session
invocation, usage parsing) is necessarily code in `crates/core` — an orchestrator
is **entirely data**. It is a directory containing:

- a **manifest**, `orchestrator.toml`, with the orchestrator's `slug`, `name`,
  `description`, the `runner` entrypoint, and any `[params]` the runner reads;
- a **runner script**, the entrypoint named by the manifest.

This is deliberate. Because an orchestrator carries no in-tree code, a new
strategy can be supplied **entirely from outside this repository** (see
[External orchestrators](#external-orchestrators)) — there is no privileged
in-tree path, and the built-in orchestrators use exactly the same machinery as a
custom one.

The built-in orchestrators live under `orchestrators/<slug>/` in the repo and are
catalogued under [Orchestrators](/orchestrators/overview/). Today there is one:

- **`one-shot`** — a single harness session driven to completion. This is the
  default, and it reproduces the original single-session behaviour exactly.

A multi-session built-in (`ralph`, which told the harness to record progress to a
status file, resume from it, and create a marker file when done) was shipped and
has since been removed. Driving a *third-party* harness across sessions through
the filesystem is superseded by [gg](/gg/overview/), The Test Cabinet's own
harness, whose executor conducts multi-step work directly. A session loop is
still expressible as an [external orchestrator](#external-orchestrators).

## The execution model

All setup is shared and happens once, exactly as for a single-session run: the
run-container image is pulled, the container is started, authentication is
applied, the harness CLI is installed and probed, and the test case's `init`
command runs. Only then does the orchestrator take over, in place of the single
harness invocation.

The orchestrator's **runner script runs inside the run container**, so it drives
sessions and inspects progress from where the work actually happens — its
commands run natively against the seeded workspace at `/work`, and it checks
status and marker files on the workspace filesystem directly. The whole runner
script is bounded by the run's [maximum runtime](/components/core/execution/),
just as a single session is.

### The `tcab-session` wrapper

A runner script must be able to invoke a harness session without knowing any
harness-specific details — which binary, which flags, which output format. The
run therefore writes a **`tcab-session` wrapper** into the container before
running the orchestrator. Invoking `tcab-session "<prompt>"` runs the selected
harness's CLI with the adapter's exact session arguments, substituting the
prompt. The harness's output flows back through the runner script's stream, where
it is parsed for usage and translated into events exactly as a single session is.

The wrapper emits a sentinel line around each session so the run can **segment
the stream into sessions** and sum each session's reported usage into the run's
totals. A single-session (`one-shot`) run has exactly one segment, so its metrics
are identical to a run with no orchestration layer at all.

### Runner environment contract

The runner script is handed everything it needs through its environment:

| Variable | Meaning |
| --- | --- |
| `TCAB_PROMPT` | The rendered test-case prompt (the goal). An orchestrator wraps this with its own protocol before passing it to `tcab-session`. |
| `TCAB_WORKSPACE` | The seeded workspace directory (`/work`). |
| `TCAB_DEADLINE` | Epoch seconds after which the run's maximum runtime is exhausted. A multi-session runner checks this to stop **gracefully** before the hard cap. |
| `TCAB_PARAM_<KEY>` | Each `[params]` entry from the manifest, upper-cased (for example `marker_file` becomes `TCAB_PARAM_MARKER_FILE`). |

So `one-shot`'s runner is a single `tcab-session "$TCAB_PROMPT"`; a multi-session
runner is a loop that calls `tcab-session` with a wrapped prompt until its marker
file exists or `TCAB_DEADLINE` is reached.

### Budget and timeouts

The run's maximum runtime bounds the whole orchestrator the same way it bounds a
single session: when it is exceeded, the run is stopped. That hard cap is a
backstop. A multi-session orchestrator is expected to manage the budget itself
via `TCAB_DEADLINE` — stopping after the current session rather than starting one
it cannot finish — and to **exit successfully with partial work** when the budget
runs out. Because the runner exits normally, the produced workspace is still
collected and [validated](/components/core/validation/); running out of budget is
a likely-incomplete result, not a discarded one.

An orchestrator's scratch files (a status or marker file, for example) live under
a dot-directory in the workspace so they are easy to keep out of the collected
implementation.

## External orchestrators

Because an orchestrator is just a directory of data, one can be supplied at run
time from **outside this repository** — pointing a run at a directory anywhere on
disk with `--orchestrator-dir <path>`. The directory has the same shape as a
built-in (`orchestrator.toml` plus a runner script). A custom orchestrator is
resolved purely at run time: it is never enumerated in the catalogue, never
documented here, and requires no change to The Test Cabinet's code. This is the
supported way to experiment with an orchestration strategy that is not part of
this project.

## Selecting an orchestrator

An orchestrator is selected per run, defaulting to `one-shot`. Every runner —
the [CLI](/components/cli/overview/) (`--orchestrator`, `--orchestrator-dir`), the
[driver](/components/driver/overview/) (built-in slugs only, as the driver has no
access to a submitter's local directory), and the run-execution UI — selects one,
and the resolved slug is recorded on the run.

A **non-default** orchestrator — in practice an external one, since `one-shot` is
the only built-in — is **limited to the test types that build a program over a
working session**: [end-to-end](/testing/end-to-end/overview/),
[full-stack](/testing/full-stack/overview/), and
[game-jam](/testing/game-jam/overview/). Those are where a multi-session
implementation is needed; the other types build a single artifact in one pass. The
run rejects a non-default orchestrator for any other test type, before any
container is started.
