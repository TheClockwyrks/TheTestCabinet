---
title: Overview
---

The Test Cabinet drives a model through a **harness** — the third-party coding
agent CLI that actually edits the workspace. The same test case can be run
against any supported harness, and comparing a model's results across harnesses
is itself a useful data point.

This section is the catalogue of supported harnesses. Each harness has its own
pages:

- **Overview** — the harness's website, the model IDs it accepts, and how it is
  installed and invoked.
- **Authentication** — the API-key variable it reads and, for the harnesses that
  support it, how a subscription is supplied.
- **Events** — how the harness's raw output is translated into the normalized
  [harness event](/components/core/events/) stream.
- **Metrics** — how its token usage and cost are extracted into the normalized
  [metrics](/components/core/metrics/).

For the cross-cutting contracts these pages reference — installation,
availability, authentication, usage reporting, and event translation — see the
core [Agent Harnesses](/components/core/harnesses/) doc. The declarative half of
each harness (its name, CLI binary, and install command) lives in the repo under
`harnesses/<slug>/harness.toml`; the imperative half (invocation flags, usage
parsing, event mapping) is code in `crates/core/src/harness_registry.rs` and
`crates/core/src/event.rs`.

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
| [Google Antigravity](/harnesses/antigravity/overview/) | `antigravity` | [antigravity.google](https://antigravity.google/) | — (see below) |

The example IDs are illustrative, not exhaustive — each harness accepts whatever
models its configured provider exposes. Note the differing formats: Claude Code
and Codex take their vendor's native model names; Cline, Goose, and Pi take
provider-prefixed slugs through OpenRouter; and OpenCode and Kilo Code take
`openrouter/`-prefixed slugs. Each harness's Overview page covers its exact
format.

## Antigravity availability

Google Antigravity authenticates only through a Google account, so it has no
API-key mode and runs under [subscription
authentication](/components/core/harnesses/#authentication) alone: it is
unavailable until you sign in with its `agy` CLI, and runnable once you have. It
still accepts no model ID and reports no token usage in its non-interactive mode.
See [Antigravity → Overview](/harnesses/antigravity/overview/).
