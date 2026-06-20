---
title: Overview
---

**Kilo Code** (slug `kilo`) is a command line coding agent run non-interactively
against the test case prompt. It reaches its model through OpenRouter with a
user-supplied key, so its runs are routed and priced by an aggregator rather than
billed by a single provider. See [kilo.ai](https://kilo.ai/).

## Model IDs

Kilo Code uses OpenRouter model identifiers, which carry an `openrouter/` prefix
in front of the provider-qualified slug. The following are illustrative, not an
exhaustive list:

- `openrouter/anthropic/claude-opus-4.8`
- `openrouter/minimax/minimax-m3`
- `openrouter/google/gemini-3.5-flash`

## Invocation

The harness probes and invokes the `kilo` binary. It is installed into the run
container at run time with:

```sh
npm install -g @kilocode/cli && npm cache clean --force
```

Each non-interactive session runs the binary with these flags:

| Flag | Purpose |
| ---- | ------- |
| `run` | The non-interactive subcommand. |
| `--format json` | Emit the line-delimited JSON event stream consumed for [events](./events/) and [usage](./metrics/). |
| `--auto` | Run unattended, without per-action approval prompts. |
| `--model <id>` | The model to run. |

The prompt is passed as the final positional argument.

**Authentication.** Kilo Code's API key is sourced from `OPENROUTER_API_KEY` on
the host, which is forwarded into the run container under the same name.

**Pricing.** Kilo Code already reports OpenRouter-prefixed model IDs, so the
comparable-cost lookup strips the leading `openrouter/` before consulting
OpenRouter — `openrouter/anthropic/claude-opus-4.8` becomes
`anthropic/claude-opus-4.8`. Kilo Code does not self-report a run cost, so the
comparable cost is always OpenRouter-derived; see [Metrics](./metrics/).

---

See [Events](./events/) for how Kilo Code's output is normalized and
[Metrics](./metrics/) for how its usage is counted. For the harness layer these
pages fit into, see [Harnesses](/components/core/harnesses/).
