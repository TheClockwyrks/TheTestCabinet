---
title: One-shot
---

**One-shot** (slug `one-shot`) is the default orchestrator: a single harness
session driven to completion. The harness is handed the test case's prompt and
its own agent loop runs to completion — that is the whole strategy. It reproduces
the original single-session behaviour exactly, so a `one-shot` run's metrics are
identical to a run with no orchestration layer at all.

## Runner

The runner reads no parameters. It is a single invocation of the
[`tcab-session` wrapper](/components/core/orchestrators/#the-tcab-session-wrapper)
against the goal carried in `TCAB_PROMPT`:

```sh
exec tcab-session "$TCAB_PROMPT"
```

`tcab-session` runs the selected harness's CLI with that harness's exact session
arguments, substituting the prompt — so the runner needs to know nothing
harness-specific.

## Parameters

None. A multi-session strategy such as [Ralph Loop](/orchestrators/ralph/)
declares a `[params]` table; one-shot does not.
