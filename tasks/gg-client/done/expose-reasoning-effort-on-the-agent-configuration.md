# Expose reasoning effort on the agent configuration

Send a reasoning setting an agent's configuration names on every request of
that agent, so a run can hold a model to the effort its task warrants rather
than the provider's default.

## Current state

gg sends no reasoning parameter. `build_request_body` in
`crates/gg/src/client.rs` carries the model, the messages, the tools and the
cache fields, and every model runs at its provider's default effort.
`GgAgentConfig` in `crates/core/src/gg.rs` carries `promptCacheTtl` and
nothing about reasoning.

On 2026-09-23 the default decided whether a model was usable at all.
`deepseek/deepseek-v4.1-flash` spent 7,000 to 14,000 reasoning tokens per
turn on programs of about 200 tokens, at two to three minutes per request,
and wrote nothing in an hour. `z-ai/glm-5.3-flash` finished one issue and
then, on a second, grew to two to four minutes per request with the same
pattern. Neither run could ask for less.

OpenRouter's unified `reasoning` request object carries `effort` (`xhigh`,
`high`, `medium`, `low`, `minimal` or `none`), `max_tokens` for the providers
that take a budget instead, `exclude` to drop the reasoning text from the
reply, and `enabled`. The provider maps the object onto its own parameter.

## Design

`GgAgentConfig` gains `reasoning`, optional, with `effort` naming one of the
six levels and `maxTokens` naming a budget, one or the other. Absent, no
parameter is sent and the model runs at its default, which is today's
behaviour. The console's agent form offers the field beside the prompt cache
lifetime, and the resolved capability set records it.

`build_request_body` sends the object on every request of the agent, compaction
summaries included, since the summarizer runs on the same model. The
`session_started` event records the setting per agent profile.

Describe the field on `apps/docs/src/content/docs/gg/configurations.md` beside
`promptCacheTtl`, and remove the statement that gg sends no reasoning
parameter from the `driving-gg-directly` skill.

## Done when

- [x] `GgAgentConfig` carries an optional `reasoning` setting and the console
      form offers it.
- [x] Every request of a configured agent carries the object; an agent without
      the setting sends none.
- [x] `session_started` records the setting.
- [x] The configurations page describes it.
- [x] Gates green.
