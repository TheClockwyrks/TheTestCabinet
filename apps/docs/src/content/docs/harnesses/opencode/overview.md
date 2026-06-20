---
title: Overview
---

OpenCode (slug `opencode`) is an open-source coding agent CLI, driven non
interactively through its `opencode run` subcommand. It reaches its model
through OpenRouter, so an OpenCode run reports OpenRouter-style model IDs and is
priced from OpenRouter's listed rates. See the
[OpenCode site](https://opencode.ai/) for the harness itself.

## Model IDs

OpenCode runs models through OpenRouter, so its model IDs are OpenRouter slugs
carrying an `openrouter/` prefix. Examples (illustrative, not exhaustive):

- `openrouter/minimax/minimax-m3`
- `openrouter/google/gemini-3.5-flash`

## Invocation

The harness probes and invokes the `opencode` binary. It is installed into the
run container at run time with:

```sh
npm install -g opencode-ai && npm cache clean --force
```

A session is run with `opencode run` in non-interactive mode. The Test Cabinet
passes these flags:

| Flag | Purpose |
| ---- | ------- |
| `--format json` | Emit the line-delimited JSON event stream consumed for [events](./events/) and [usage](./metrics/). |
| `--dangerously-skip-permissions` | Run unattended, without per-action approval prompts. |
| `--model <id>` | The model to run. |

The prompt is passed as the final positional argument.

**Authentication.** OpenCode's API key is sourced from `OPENROUTER_API_KEY` on
the host and passed straight through to the run container under the same name.

**Pricing.** OpenCode's model IDs already carry an `openrouter/` prefix, so the
comparable-cost lookup strips it before consulting OpenRouter —
`openrouter/minimax/minimax-m3` becomes `minimax/minimax-m3`. OpenCode does not
self-report a run cost, so the comparable cost is always OpenRouter-derived; see
[Metrics](./metrics/).

---

See [Events](./events/) for how OpenCode's output is normalized and
[Metrics](./metrics/) for how its usage is counted. For the harness layer these
pages fit into, see [Harnesses](/components/core/harnesses/).
