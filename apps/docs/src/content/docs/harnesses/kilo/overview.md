---
title: Overview
---

Kilo Code (slug `kilo`) is a command-line coding agent driven non-interactively
through its `kilo run` subcommand. It reaches its model through OpenRouter, so a
Kilo Code run reports OpenRouter-style model IDs and is priced from OpenRouter's
listed rates. The harness itself is documented at [kilo.ai](https://kilo.ai/).

## Model IDs

Kilo Code's model IDs are OpenRouter slugs carrying an `openrouter/` prefix. A
run adds that prefix at launch when the model is bound to the OpenRouter
provider. The following are illustrative, not exhaustive:

- `openrouter/anthropic/claude-opus-4.8`
- `openrouter/minimax/minimax-m3`
- `openrouter/google/gemini-3.5-flash`

## Invocation

The harness probes and invokes the `kilo` binary. It is installed into the run
container at run time with:

```sh
npm install -g @kilocode/cli && npm cache clean --force
```

A session runs the `run` subcommand with these flags, followed by the prompt as
the final positional argument:

| Flag | Purpose |
| ---- | ------- |
| `--format json` | Emit the line-delimited JSON stream consumed for [events](/harnesses/kilo/events/) and [usage](/harnesses/kilo/metrics/). |
| `--auto` | Run unattended, without per-action approval prompts. |
| `--model <id>` | The model to run. |

## Authentication

Kilo Code authenticates with an OpenRouter API key, sourced from
`OPENROUTER_API_KEY` on the host and injected into the run container under the
same name. See [Authentication](/harnesses/kilo/authentication/).

## Pricing

The comparable-cost lookup strips the leading `openrouter/` before consulting
OpenRouter, so `openrouter/anthropic/claude-opus-4.8` is priced as
`anthropic/claude-opus-4.8`. The comparable cost is always OpenRouter-derived.
See [Metrics](/harnesses/kilo/metrics/).
