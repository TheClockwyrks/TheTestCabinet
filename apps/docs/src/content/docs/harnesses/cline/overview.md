---
title: Overview
---

Cline is a coding agent run in The Test Cabinet through its `cline` CLI. It
drives a model through OpenRouter, so it reports OpenRouter model IDs and its
comparable cost is derived from OpenRouter prices. See the project at
[cline.bot](https://cline.bot/).

## Model IDs

Cline runs with `--provider openrouter`, so its model IDs are OpenRouter
provider-prefixed slugs and are used unchanged for the comparable-cost lookup
(pricing model `Passthrough`). The following are illustrative, not exhaustive:

- `z-ai/glm-5.2`
- `moonshotai/kimi-k2.7-code`
- `qwen/qwen3.7-plus`

## Invocation

Cline is invoked non-interactively through the `cline` binary, which is
installed into the run container at run time with:

```
npm install -g cline@latest && npm cache clean --force
```

A session is run with these flags, followed by the prompt:

```
cline --json --auto-approve true --provider openrouter --model <model> <prompt>
```

- `--json` selects the line-delimited JSON event stream parsed for
  [events](./events/).
- `--auto-approve true` runs the agent to completion without interactive
  approvals.
- `--provider openrouter` routes the model through OpenRouter.

Authentication uses the host's `OPENROUTER_API_KEY`, injected into the container
under the same name (no remapping). Because Cline talks to OpenRouter rather than
a single provider at one price, it reports no cost of its own; the comparable
cost is derived from OpenRouter prices via the `Passthrough` pricing model.

See [Events](./events/) and [Metrics](./metrics/) for how Cline's output is
normalized, and [Harnesses](/components/core/harnesses/) for the harness layer
these pages describe.
