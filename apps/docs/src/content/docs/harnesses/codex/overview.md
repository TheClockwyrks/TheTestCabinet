---
title: Overview
---

OpenAI Codex (slug `codex`) is OpenAI's coding agent CLI, driven non
interactively through its `codex exec` subcommand. It authenticates against
OpenAI directly with an API key and runs the model OpenAI serves natively, so a
Codex run reports the vendor's own model IDs and usage figures. See the
[OpenAI Codex site](https://openai.com/codex/) for the harness itself.

## Model IDs

Codex uses OpenAI's vendor-native model names unchanged — there is no provider
prefix or routing slug. Examples (illustrative, not exhaustive):

- `gpt-5.5`
- `gpt-5.4-mini`
- `gpt-5.3-codex-spark`

## Invocation

The harness probes and invokes the `codex` binary. It is installed into the run
container at run time with:

```sh
npm install -g @openai/codex && npm cache clean --force
```

A session is run with `codex exec` in non-interactive mode. The Test Cabinet
passes these flags:

| Flag | Purpose |
| ---- | ------- |
| `--json` | Emit the line-delimited JSON event stream consumed for [events](./events/) and [usage](./metrics/). |
| `--skip-git-repo-check` | Run outside a git repository without prompting. |
| `--dangerously-bypass-approvals-and-sandbox` | Run unattended, without per-action approval prompts. |
| `--model <id>` | The model to run. |

The prompt is passed as the final positional argument.

**Authentication.** Codex's API key is sourced from `OPENAI_API_KEY` on the
host. Because `codex exec` reads its key only from `CODEX_API_KEY` and ignores
`OPENAI_API_KEY`, the host's `OPENAI_API_KEY` is injected into the run container
under the name `CODEX_API_KEY`.

**Pricing.** Codex reports bare OpenAI model IDs, so the comparable-cost lookup
prepends an `openai/` prefix before consulting OpenRouter — `gpt-5.5` becomes
`openai/gpt-5.5`. Codex does not self-report a run cost, so the comparable cost
is always OpenRouter-derived; see [Metrics](./metrics/).

---

See [Events](./events/) for how Codex's output is normalized and
[Metrics](./metrics/) for how its usage is counted. For the harness layer these
pages fit into, see [Harnesses](/components/core/harnesses/).
