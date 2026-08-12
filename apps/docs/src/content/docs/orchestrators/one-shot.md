---
title: One-shot
---

One-shot (slug `one-shot`) is the default orchestrator. It runs a single harness
session and drives it to completion: the harness is handed the test case's prompt
and its own agent loop runs to the end. A one-shot run produces exactly one
session segment, so its metrics are those of the single session.

## Runner

The runner reads no parameters. It is a single invocation of the
[`tcab-session` wrapper](/components/core/orchestrators/#the-tcab-session-wrapper)
against the goal carried in `TCAB_PROMPT`:

```sh
exec tcab-session "$TCAB_PROMPT"
```

`tcab-session` runs the selected harness's CLI with that harness's exact session
arguments, substituting the prompt, so the runner needs no harness-specific
knowledge.

## Parameters

One-shot declares no `[params]` table, so the runner is handed only the shared
runner environment.
