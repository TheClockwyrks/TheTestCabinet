---
title: Overview
---

The Test Cabinet drives a model through a harness, the third-party coding agent
CLI that edits the workspace. The same test case runs against any supported
harness, so a model's results across harnesses are directly comparable.

This section is the catalogue of the third-party harnesses. gg is The Test
Cabinet's own first-party harness and is a distinct run mode with its own
configuration and result space, documented in [gg](/gg/overview/).

Each harness has the same five pages:

- Overview: the harness's website, the model IDs it accepts, and how it is
  installed and invoked.
- Authentication: the API-key variable it reads and, where supported, how a
  subscription is supplied.
- Events: how the harness's raw output is translated into the normalized
  [harness event](/components/core/events/) stream.
- Metrics: how its token usage and cost become the normalized
  [metrics](/components/core/metrics/).
- Telemetry: what the harness exports, what a run configures to make it, and
  whether its spans join the run's own trace.

[Agent Harnesses](/components/core/harnesses/) defines the cross-cutting
contracts these pages reference: installation, availability, authentication,
usage reporting, and event translation. The declarative half of each harness
(its name, CLI binary, and install command) is authored under
`harnesses/<slug>/harness.toml`. The imperative half is code:
`crates/core/src/harness_registry.rs` for invocation and usage,
`crates/core/src/event.rs` for event translation, and
`crates/core/src/harness_telemetry.rs` for telemetry.

## Supported harnesses

| Harness | Slug | Website | Example model IDs |
| --- | --- | --- | --- |
| [Anthropic Claude Code](/harnesses/claude/overview/) | `claude` | [claude.com/claude-code](https://claude.com/claude-code) | `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5` |
| [OpenAI Codex](/harnesses/codex/overview/) | `codex` | [openai.com/codex](https://openai.com/codex/) | `gpt-5.5`, `gpt-5.4-mini`, `gpt-5.3-codex-spark` |
| [Cline](/harnesses/cline/overview/) | `cline` | [cline.bot](https://cline.bot/) | `z-ai/glm-5.2`, `moonshotai/kimi-k2.7-code`, `qwen/qwen3.7-plus` |
| [Goose](/harnesses/goose/overview/) | `goose` | [goose-docs.ai](https://goose-docs.ai/) | `z-ai/glm-5.2`, `moonshotai/kimi-k2.7-code`, `qwen/qwen3.7-plus` |
| [Pi](/harnesses/pi/overview/) | `pi` | [pi.dev](https://pi.dev/) | `z-ai/glm-5.2`, `moonshotai/kimi-k2.7-code`, `qwen/qwen3.7-plus` |
| [OpenCode](/harnesses/opencode/overview/) | `opencode` | [opencode.ai](https://opencode.ai/) | `openrouter/minimax/minimax-m3`, `openrouter/google/gemini-3.5-flash` |
| [Kilo Code](/harnesses/kilo/overview/) | `kilo` | [kilo.ai](https://kilo.ai/) | `openrouter/minimax/minimax-m3`, `openrouter/google/gemini-3.5-flash` |
| [Google Antigravity](/harnesses/antigravity/overview/) | `antigravity` | [antigravity.google](https://antigravity.google/) | — |

The example IDs are illustrative. Each harness accepts whatever models its
configured provider exposes, and the ID formats differ. Claude Code and Codex
take their vendor's native model names. Cline, Goose, and Pi take
provider-prefixed slugs through OpenRouter. OpenCode and Kilo Code take
`openrouter/`-prefixed slugs. Each harness's Overview page states its exact
format.

## Telemetry support

Harness telemetry differs by harness, so each harness's Telemetry page carries
the detail.

| Harness | Traces | Metrics | Logs | Joins the run's trace | Configured by |
| --- | --- | --- | --- | --- | --- |
| [Claude Code](/harnesses/claude/telemetry/) | Yes | Yes | Yes | Yes, `TRACEPARENT` | environment |
| [OpenCode](/harnesses/opencode/telemetry/) | Yes | Yes | Yes | Yes, `OPENCODE_TRACEPARENT` | plugin + config file |
| [Goose](/harnesses/goose/telemetry/) | Yes | Yes | Yes | No | environment |
| [Codex](/harnesses/codex/telemetry/) | Yes | No | Yes | No | config file |
| [Kilo Code](/harnesses/kilo/telemetry/) | Yes | No | Yes | No | environment |
| [Cline](/harnesses/cline/telemetry/) | No | — | — | — | — |
| [Pi](/harnesses/pi/telemetry/) | No | — | — | — | — |
| [Antigravity](/harnesses/antigravity/telemetry/) | No | — | — | — | — |

Every exporting harness carries the `tcab.harness`, `tcab.test_case`,
`tcab.variant`, `tcab.model`, and `tcab.run_id` resource attributes, so a
harness that starts its own trace is still correlatable to the run by query.
`tcab.run_id` is the key that ties a harness's spans to the run they belong to.
All of this is gated on the deployment exporting telemetry at all; see
[Observability](/development/observability/).

## Antigravity availability

Google Antigravity authenticates through a Google account, so it runs under
subscription authentication alone. It becomes available once a user has signed
in with its `agy` CLI. It accepts no model ID and reports no token usage in its
non-interactive mode. See [Antigravity](/harnesses/antigravity/overview/).
