---
title: Overview
---

Pi (slug `pi`) is a coding agent CLI driven non-interactively through its
`--print` mode. It reaches its model through OpenRouter, so a Pi run reports
OpenRouter-style model IDs and is priced from OpenRouter's listed rates. The
harness itself is at [pi.dev](https://pi.dev/).

## Model IDs

Every session is launched with `--provider openrouter`, so Pi's model IDs are
OpenRouter provider-prefixed slugs. The ID is passed to the CLI exactly as
supplied, with no routing prefix added. Illustrative examples:

- `z-ai/glm-5.2`
- `moonshotai/kimi-k2.7-code`
- `qwen/qwen3.7-plus`

## Invocation

The harness probes and invokes the `pi` binary, installed into the run container
at run time with:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent && npm cache clean --force
```

A session runs in `--print` mode with JSON output. The Test Cabinet passes these
flags:

| Flag                    | Purpose                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `--mode json`           | Emit the line-delimited JSON event stream consumed for [events](/harnesses/pi/events/) and usage. |
| `--print`               | Run non-interactively, printing output rather than entering an interactive session.               |
| `--provider openrouter` | Reach the model through OpenRouter.                                                               |
| `--model <id>`          | The model to run.                                                                                 |

The prompt is passed as the final positional argument.

## Authentication and cost

Pi's API key is sourced from `OPENROUTER_API_KEY` on the host and injected into
the run container under the same name. See
[Authentication](/harnesses/pi/authentication/).

The model ID is already an OpenRouter slug, so it is used as-is for the
comparable-cost lookup. Pi reports no run cost of its own, so the comparable
cost is always derived from OpenRouter's listed prices. See
[Metrics](/harnesses/pi/metrics/).
