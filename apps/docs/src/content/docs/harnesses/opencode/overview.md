---
title: Overview
---

OpenCode (slug `opencode`) is a coding agent CLI driven non-interactively
through its `opencode run` subcommand. It reaches its model through OpenRouter,
so an OpenCode run reports OpenRouter-style model IDs and is priced from
OpenRouter's listed rates. The harness itself is documented at
[opencode.ai](https://opencode.ai/).

## Model IDs

OpenCode's model IDs are OpenRouter slugs carrying an `openrouter/` prefix. A
run adds that prefix at launch when the model is bound to the OpenRouter
provider. The following are illustrative, not exhaustive:

- `openrouter/minimax/minimax-m3`
- `openrouter/google/gemini-3.5-flash`

## Invocation

The harness probes and invokes the `opencode` binary. It is installed into the
run container at run time with:

```sh
npm install -g opencode-ai && npm cache clean --force
```

A session runs the `run` subcommand with these flags, followed by the prompt as
the final positional argument:

| Flag                             | Purpose                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--format json`                  | Emit the line-delimited JSON stream consumed for [events](/harnesses/opencode/events/) and [usage](/harnesses/opencode/metrics/). |
| `--dangerously-skip-permissions` | Run unattended, without per-action approval prompts.                                                                              |
| `--model <id>`                   | The model to run.                                                                                                                 |

## Authentication

OpenCode authenticates with an OpenRouter API key, sourced from
`OPENROUTER_API_KEY` on the host and injected into the run container under the
same name. See [Authentication](/harnesses/opencode/authentication/).

## Pricing

The comparable-cost lookup strips the leading `openrouter/` before consulting
OpenRouter, so `openrouter/minimax/minimax-m3` is priced as
`minimax/minimax-m3`. OpenCode reports no run cost of its own, so the comparable
cost is always OpenRouter-derived. See [Metrics](/harnesses/opencode/metrics/).
