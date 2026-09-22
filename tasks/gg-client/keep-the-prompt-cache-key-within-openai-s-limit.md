# Keep the prompt cache key within OpenAI's limit

Send a `prompt_cache_key` that every provider accepts, whatever the length of
the run's session id.

## Current state

`build_request_body` in `crates/gg/src/client.rs` sends the run's session id as
both `session_id` and `prompt_cache_key`, truncated to `MAX_SESSION_KEY_CHARS`,
which is OpenRouter's 256-character cap on `session_id`. OpenAI's endpoints cap
`prompt_cache_key` at 64 characters and reject the whole request past it:

```
Invalid 'prompt_cache_key': string too long. Expected a string with maximum length 64, but got a string with length 72 instead.
```

A session id core mints is a UUID and never reaches the cap. A direct
invocation names its own session id, and one of 72 characters ended a run of
`openai/gpt-5.6-sol` on its first request with `model_rejected` on 2026-09-22.
The rejection is fatal to the session, since no turn can be made at all.

## Design

Derive the `prompt_cache_key` separately from the `session_id`: the same key
when it fits in 64 characters, and otherwise a stable digest of it that does.
A digest keeps two requests of one run on one key, which is the only property
the field needs, and keeps a long descriptive session id usable in telemetry.
`session_id` keeps its own 256-character truncation.

State the two caps beside each other in the request-body documentation and in
the prompt caching section of `apps/docs/src/content/docs/gg/overview.md`.

## Done when

- [ ] A run whose session id is longer than 64 characters makes its first
      request to an OpenAI model without a rejection.
- [ ] The two keys are documented with their caps.
- [ ] Gates green.
