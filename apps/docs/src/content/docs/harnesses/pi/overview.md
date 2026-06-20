---
title: Overview
---

Pi (slug `pi`) is a coding agent CLI, driven non-interactively through its
`--print` mode. It reaches its model through OpenRouter, so a Pi run reports
OpenRouter-style model IDs and is priced from OpenRouter's listed rates. See the
[Pi site](https://pi.dev/) for the harness itself.

## Model IDs

Pi runs models through OpenRouter — every session is launched with
`--provider openrouter` — so its model IDs are OpenRouter provider-prefixed
slugs. Examples (illustrative, not exhaustive):

- `z-ai/glm-5.2`
- `moonshotai/kimi-k2.7-code`
- `qwen/qwen3.7-plus`

## Invocation

The harness probes and invokes the `pi` binary. It is installed into the run
container at run time with:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent && npm cache clean --force
```

A session is run in `--print` mode with JSON output. The Test Cabinet passes
these flags:

| Flag | Purpose |
| ---- | ------- |
| `--mode json` | Emit the line-delimited JSON event stream consumed for [events](./events/) and [usage](./metrics/). |
| `--print` | Run non-interactively, printing output rather than entering an interactive session. |
| `--provider openrouter` | Reach the model through OpenRouter. |
| `--model <id>` | The model to run. |

The prompt is passed as the final positional argument.

**Authentication.** Pi's API key is sourced from `OPENROUTER_API_KEY` on the
host and passed straight through to the run container under the same name.

**Pricing.** Pi uses the `Passthrough` pricing model: the model ID is already an
OpenRouter slug, so it is used as-is for the comparable-cost lookup. Pi does not
self-report a run cost, so the comparable cost is always OpenRouter-derived; see
[Metrics](./metrics/).

---

See [Events](./events/) for how Pi's output is normalized and
[Metrics](./metrics/) for how its usage is counted. For the harness layer these
pages fit into, see [Harnesses](/components/core/harnesses/).
