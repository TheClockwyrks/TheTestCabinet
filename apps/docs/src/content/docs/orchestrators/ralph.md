---
title: Ralph Loop
---

**Ralph Loop** (slug `ralph`) is the simplest multi-session orchestrator. Where
[one-shot](/orchestrators/one-shot/) drives a single session, Ralph re-runs the
harness across as many sessions as it takes, each resuming from the last, until
the implementation signals it is done. It is the smallest possible strategy for a
case that outgrows what one session can do: the only control logic is "check the
marker file, run a session if it does not exist."

## Protocol

Each session is given the test case's goal wrapped with a short protocol:

- **Resume from a progress file.** A status file (`status_file`, default
  `.tcab/ralph/progress.md`) tracks what is done and what remains. At the start of
  a session the harness reads it if it exists and resumes from where it leaves
  off, or creates it on the first session.
- **Make progress, then record it.** The session makes meaningful progress toward
  the goal, then revises the status file — recording what is now done, what is
  left, and any context the next session needs — rather than deleting prior
  progress.
- **Mark completion.** Only once the entire goal is fully implemented and verified
  does the session create a marker file (`marker_file`, default
  `.tcab/ralph/done`).

The runner re-runs sessions until that marker file appears or the run's
[deadline](/components/core/orchestrators/#runner-environment-contract)
(`TCAB_DEADLINE`) is reached. When the budget runs out it stops **gracefully**,
exiting successfully with whatever partial work exists on disk so it can still be
collected and [validated](/components/core/validation/).

## Parameters

| Parameter | Default | Meaning |
| --- | --- | --- |
| `status_file` | `.tcab/ralph/progress.md` | The progress file the session records to and resumes from across sessions. |
| `marker_file` | `.tcab/ralph/done` | The file a session creates once the entire goal is complete; its appearance ends the loop. |

Both live under a `.tcab/ralph/` dot-directory in the workspace so the
orchestrator's scratch is easy to keep out of the collected implementation. Each
is exposed to the runner as `TCAB_PARAM_<KEY>` (the key upper-cased) and resolved
relative to the workspace.
