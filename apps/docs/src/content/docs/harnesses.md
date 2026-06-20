---
title: Harnesses
---

The Test Cabinet drives a model through a **harness** — the third-party coding
agent CLI that actually edits the workspace. The same test case can be run
against any supported harness, and comparing a model's results across harnesses
is itself a useful data point.

This page is the catalogue of supported harnesses: each one's website and a few
example model IDs you can give it. For how a harness is defined, installed, and
invoked, see [Agent Harnesses](/components/core/harnesses/); the manifests live
in the repo under `harnesses/<slug>/harness.toml`.

## Supported harnesses

| Harness | Slug | Website | Example model IDs |
| --- | --- | --- | --- |
| Anthropic Claude Code | `claude` | [claude.com/claude-code](https://claude.com/claude-code) | `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5` |
| OpenAI Codex | `codex` | [openai.com/codex](https://openai.com/codex/) | `gpt-5.5`, `gpt-5.4-mini`, `gpt-5.3-codex-spark` |
| Cline | `cline` | [cline.bot](https://cline.bot/) | `z-ai/glm-5.2`, `moonshotai/kimi-k2.7-code`, `qwen/qwen3.7-plus` |
| Goose | `goose` | [goose-docs.ai](https://goose-docs.ai/) | `z-ai/glm-5.2`, `moonshotai/kimi-k2.7-code`, `qwen/qwen3.7-plus` |
| Pi | `pi` | [pi.dev](https://pi.dev/) | `z-ai/glm-5.2`, `moonshotai/kimi-k2.7-code`, `qwen/qwen3.7-plus` |
| OpenCode | `opencode` | [opencode.ai](https://opencode.ai/) | `openrouter/minimax/minimax-m3`, `openrouter/google/gemini-3.5-flash` |
| Kilo Code | `kilo` | [kilo.ai](https://kilo.ai/) | `openrouter/minimax/minimax-m3`, `openrouter/google/gemini-3.5-flash` |
| Google Antigravity | `antigravity` | [antigravity.google](https://antigravity.google/) | — (see below) |

The example IDs are illustrative, not exhaustive — each harness accepts whatever
models its configured provider exposes. Note the differing formats: Claude Code
and Codex take their vendor's native model names, Cline, Goose, and Pi take
provider-prefixed slugs, and OpenCode and Kilo Code route through OpenRouter.

## Antigravity availability

Google Antigravity authenticates only through a Google account and reports no
token usage in its non-interactive mode, so its adapter reports it **unavailable**
under The Test Cabinet's API-key-only authentication. It is defined here for when
subscription auth is added; until then it accepts no model ID for a run.
