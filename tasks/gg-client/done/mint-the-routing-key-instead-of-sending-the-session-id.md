# Mint the routing key instead of sending the session id

Send a key gg mints as `session_id` and `prompt_cache_key`, so the run's session
id can be any text and neither field can exceed a provider's cap.

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

The only property the two fields need is that every request of one run carries
the same value. Nothing requires that value to be the session id, and deriving
it from caller-supplied text is what put a length rule in the client.

## Design

gg mints one `cuid2` at launch, which the crate already depends on, and every
client in the run sends it as both `session_id` and `prompt_cache_key`. A cuid2
is 24 characters, inside both caps, so the truncation and its constant go.

The `session_started` event carries the minted key as `routingKey`, so a
provider dashboard row can still be matched to a run. The session record keeps
it beside the session id.

Describe the key in the prompt caching section of
`apps/docs/src/content/docs/gg/overview.md` and in the telemetry page for
`session_started`.

## Done when

- [x] Every request of a run carries one minted cuid2 as both fields, whatever
      the session id is.
- [x] `session_started` records the key.
- [x] The overview and telemetry pages describe it.
- [x] Gates green.
