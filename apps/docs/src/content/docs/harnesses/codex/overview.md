---
title: Overview
---

OpenAI Codex (slug `codex`) is OpenAI's coding agent CLI, driven
non-interactively through its `codex exec` subcommand. It authenticates against
OpenAI directly and runs the model OpenAI serves natively, so a Codex run
reports the vendor's own model IDs and usage figures. See the [OpenAI Codex
site](https://openai.com/codex/).

## Model IDs

Codex takes OpenAI's vendor-native model names unchanged, with no provider
prefix or routing slug. The following are illustrative:

- `gpt-5.5`
- `gpt-5.4-mini`
- `gpt-5.3-codex-spark`

## Invocation

The harness probes and invokes the `codex` binary. The CLI is installed into the
run container immediately before the session, so each run picks up the most
recently published version:

```sh
npm install -g @openai/codex && npm cache clean --force
```

A session runs `codex exec` with these flags:

| Flag                                         | Purpose                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--json`                                     | Emit the line-delimited JSON event stream consumed for [events](/harnesses/codex/events/) and [usage](/harnesses/codex/metrics/). |
| `--skip-git-repo-check`                      | Run outside a git repository without prompting.                                                                                   |
| `--dangerously-bypass-approvals-and-sandbox` | Run unattended, without per-action approval prompts.                                                                              |
| `--model <id>`                               | The model to run.                                                                                                                 |

The prompt is the final positional argument.

## Authentication

Codex authenticates with an OpenAI API key or a ChatGPT account subscription,
preferring the subscription when its credentials are present. In the API-key
mode the key is read from `OPENAI_API_KEY` on the host and injected into the run
container as `CODEX_API_KEY`, which is the variable `codex exec` reads. See
[Authentication](/harnesses/codex/authentication/).

## Pricing

Codex reports no cost figure of its own, so the comparable cost is always
derived from OpenRouter prices. Codex's bare OpenAI model IDs are prefixed with
`openai/` for that lookup, so `gpt-5.5` is priced as `openai/gpt-5.5`. See
[Metrics](/harnesses/codex/metrics/).
