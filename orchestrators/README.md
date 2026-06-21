# Orchestrators

An **orchestrator** decides how a test case's harness sessions are conducted —
how many sessions to run, what each one is told, and when the work is done —
while the harness layer still owns each individual session (how the harness is
invoked, how its usage is parsed, how its activity is translated into events).
Orchestration is **harness-agnostic**: an orchestrator drives sessions the same
way regardless of which harness is selected.

Unlike a [harness](../harnesses/README.md), an orchestrator carries **no in-tree
code** — it is entirely data. Each built-in orchestrator lives here, one
directory per orchestrator, named with its stable slug.

```
orchestrators/
└── one-shot/
    ├── orchestrator.toml   # the manifest
    └── runner.sh           # the runner entrypoint
```

The built-in orchestrators are embedded into `crates/core` at build time, so a
backend-driven worker (which has no local checkout) resolves them the same way
as the CLI. Because an orchestrator is just a directory of data, a custom one can
also be supplied **entirely from outside this repository** at run time by
pointing a run at a directory with the same shape (`--orchestrator-dir <path>`);
see the design doc.

The authoritative design lives at
[`components/core/orchestrators.md`](../apps/docs/src/content/docs/components/core/orchestrators.md).

## Manifest

Each `orchestrator.toml` declares:

| Field | Meaning |
| --- | --- |
| `slug` | Stable slug. For a built-in it must match the directory name; for an external directory the manifest's own slug is authoritative. |
| `name` | Human-readable name, shown in the catalogue. |
| `description` | What the strategy does, for display. |
| `runner` | The runner entrypoint filename, relative to this directory. |
| `[params]` | Optional table of parameters the runner reads. Each entry is exposed to the runner as `TCAB_PARAM_<KEY>` (the key upper-cased). Default empty. |

## The runner

The runner script **runs inside the run container**, after all shared setup
(image pull, container start, auth, harness install + probe, the test case's
`init`) has completed, in place of the single harness invocation. Its commands
run natively against the seeded workspace at `/work`. The whole runner is bounded
by the run's maximum runtime, the same hard cap that bounds a single session.

A runner invokes a harness session through the **`tcab-session` wrapper**, which
the run writes into the container before running the runner. Invoking
`tcab-session "<prompt>"` runs the selected harness's CLI with that harness's
exact session arguments, substituting the prompt — so the runner needs to know
nothing harness-specific. The harness's output flows back through the runner's
stream, where it is parsed for usage and translated into events exactly as a
single session is. The wrapper emits a sentinel line around each session so the
run can segment the stream into sessions and sum each session's usage into the
run's totals; a single-session (`one-shot`) run has exactly one segment.

### Runner environment contract

The runner is handed everything it needs through its environment:

| Variable | Meaning |
| --- | --- |
| `TCAB_PROMPT` | The rendered test-case prompt (the goal). An orchestrator wraps this with its own protocol before passing it to `tcab-session`. |
| `TCAB_WORKSPACE` | The seeded workspace directory (`/work`). |
| `TCAB_DEADLINE` | Epoch seconds after which the run's maximum runtime is exhausted. A multi-session runner checks this to stop gracefully before the hard cap. |
| `TCAB_PARAM_<KEY>` | Each `[params]` entry from the manifest, upper-cased (for example `marker_file` becomes `TCAB_PARAM_MARKER_FILE`). |

So `one-shot`'s runner is a single `tcab-session "$TCAB_PROMPT"`.

An orchestrator's scratch files should live under a dot-directory in the
workspace so they are easy to keep out of the collected implementation.
