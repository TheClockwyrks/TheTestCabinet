---
title: Overview
---

**Anthropic Claude Code** (slug `claude`) is Anthropic's command line coding
agent, run non-interactively against the test case prompt. It talks to the
Anthropic API directly with a user-supplied key, so its runs are billed and
served by a single provider rather than routed through an aggregator. See
[claude.com/claude-code](https://claude.com/claude-code).

## Model IDs

Claude Code is driven with vendor-native Anthropic model identifiers — the same
names the Anthropic API accepts — passed straight through to the CLI's `--model`
flag. The following are illustrative, not an exhaustive list:

- `claude-opus-4-8`
- `claude-sonnet-4-6`
- `claude-haiku-4-5`

## Invocation

The harness probes and invokes the `claude` binary. Because a harness is
installed into the run container at run time rather than baked into an image,
each run picks up the most recently published version. The installer runs as the
unprivileged run user and drops the binary into `~/.local/bin`, which is already
on `PATH`:

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

`--print` runs a single non-interactive turn; `--permission-mode
bypassPermissions` lets the agent act without approval prompts; and
`--output-format stream-json --verbose` selects the line-delimited JSON event
stream the harness layer parses (see [Events](./events/)).

The agent authenticates from the `ANTHROPIC_API_KEY` environment variable, which
must be present on the host; it is forwarded into the run container under the
same name.

Because Claude Code drives one provider at one price, the orchestrator records
the exact charge the CLI reports rather than looking up per-token prices. Its
pricing model is a passthrough — the native model ID is used unchanged — and the
cost it reports on its terminal result serves as both the comparable and the
actual cost (see [Metrics](./metrics/)).

---

See [Events](./events/) for how Claude Code's output maps to normalized harness
events, [Metrics](./metrics/) for how its usage and cost are recorded, and the
[agent harness layer](/components/core/harnesses/) for the contracts both
implement.
