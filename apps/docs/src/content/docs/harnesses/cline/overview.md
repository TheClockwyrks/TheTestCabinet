---
title: Overview
---

Cline (slug `cline`) is a coding agent driven non-interactively through its
`cline` CLI. It reaches its model through OpenRouter, so it reports OpenRouter
model IDs and is priced from OpenRouter's listed rates. The harness itself is
documented at [cline.bot](https://cline.bot/).

## Model IDs

Cline runs with `--provider openrouter`, so its model IDs are OpenRouter
provider-prefixed slugs, launched and priced unchanged. The following are
illustrative, not exhaustive:

- `z-ai/glm-5.2`
- `moonshotai/kimi-k2.7-code`
- `qwen/qwen3.7-plus`

## Invocation

The harness probes and invokes the `cline` binary. It is installed into the run
container at run time with:

```sh
npm install -g cline@latest && npm cache clean --force
```

A session runs the binary with these flags, followed by the prompt as the final
positional argument:

| Flag | Purpose |
| ---- | ------- |
| `--json` | Emit the line-delimited JSON stream consumed for [events](/harnesses/cline/events/) and [usage](/harnesses/cline/metrics/). |
| `--auto-approve true` | Run unattended, without per-action approval prompts. |
| `--provider openrouter` | Route the model through OpenRouter. |
| `--model <model>` | The model to run. |

## Authentication

Cline authenticates with an OpenRouter API key, sourced from
`OPENROUTER_API_KEY` on the host and injected into the run container under the
same name. See [Authentication](/harnesses/cline/authentication/).

## Pricing

Cline's model IDs are already OpenRouter slugs, so the comparable-cost lookup
uses them as reported. A trailing variant tag such as `:free` selects a pricing
route rather than a different model, so it is stripped and the model is priced
at its base rate. Cline reports no run cost of its own, so the comparable cost
is always OpenRouter-derived. See [Metrics](/harnesses/cline/metrics/).
