---
title: Overview
---

Anthropic Claude Code (slug `claude`) is Anthropic's command line coding agent,
run non-interactively against the test case prompt. It talks to the Anthropic
API directly, so a single provider serves and bills its runs. See
[claude.com/claude-code](https://claude.com/claude-code).

## Model IDs

Claude Code takes vendor-native Anthropic model identifiers, the same names the
Anthropic API accepts, passed straight through to the CLI's `--model` flag. The
following are illustrative:

- `claude-opus-4-8`
- `claude-sonnet-4-6`
- `claude-haiku-4-5`

## Invocation

The harness probes and invokes the `claude` binary. The CLI is installed into
the run container immediately before the session, so each run picks up the most
recently published version. The installer runs as the unprivileged run user and
drops the binary into `~/.local/bin`, which is already on `PATH`:

```sh
curl -fsSL https://claude.ai/install.sh | bash
```

Each non-interactive session runs the binary with these flags:

```
claude --print \
  --permission-mode bypassPermissions \
  --output-format stream-json \
  --verbose \
  --model <model> \
  <prompt>
```

`--print` runs a single non-interactive turn.
`--permission-mode bypassPermissions` lets the agent act without approval
prompts. `--output-format stream-json --verbose` selects the line-delimited JSON
event stream the harness layer parses into
[events](/harnesses/claude/events/). The prompt is the final positional
argument.

## Authentication

Claude Code authenticates with an Anthropic API key or a Claude account
subscription, preferring the subscription when its credentials are present. See
[Authentication](/harnesses/claude/authentication/) for the variables and
credential files each mode uses and how to lock the mode.

## Pricing

Claude Code drives one provider directly and reports the exact charge for the
run on its terminal result. That figure is recorded as the run's actual cost.
The comparable cost is computed from the model's curated list price, as for
every harness. See [Metrics](/harnesses/claude/metrics/).
