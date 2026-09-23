# Detect a stalled model stream within a minute

Read every model reply as a stream and treat a stretch with no delta from the
model as a stalled request, cancelled and retried on the client's schedule, so
a provider that stops answering costs a run a minute rather than the whole
call ceiling.

## Current state

gg's ordinary transport buffers: it posts the request and awaits the whole
body under `modelCallTimeoutSecs`, 900 seconds by default. An agent streams
only when loop detection is armed, and on that path `read_stream` in
`crates/gg/src/client.rs` bounds each read by the same 900 seconds, so a
stream that goes quiet is reported as `Stalled` after the full ceiling. Either
way a stall is answered as a `model_timeout` error turn, outside the client's
retries, and the agent asks again.

On 2026-09-23 a run of `z-ai/glm-5.3` waited 900 seconds on a request its
provider never answered, recorded the timeout, and went silent on the next
request for another quarter hour before the operator killed it. A model that
reasons for minutes produces reasoning deltas for the whole of that time when
the provider streams them, so on a streamed reply the provider's silence and
the model's thinking are distinguishable within seconds. OpenRouter's
keep-alive comments carry no delta.

## Design

Every agent reads its replies as a stream, with `stream_options` requesting
usage as the streaming transport already does, and loop detection decides only
whether the detector runs over that stream. The buffered read goes.

`GgRunLimits` gains `modelStreamIdleSecs`, optional and always in force,
defaulting to 60. The clock measures time since the last chunk carrying a
`delta` with content, reasoning or tool-call arguments; keep-alive comments
and blank lines leave it running. A request whose clock expires is cancelled
and retried on the client's schedule as a transport error, with the retry's
`log` line naming the stall, so a stall and an outage are answered the same
way. `modelCallTimeoutSecs` stays as the ceiling on one attempt's whole
duration and keeps its meaning for a provider that streams nothing until the
reply is complete.

State the idle bound beside the call ceiling on
`apps/docs/src/content/docs/gg/execution-limits.md` and on
`configurations.md`, and rewrite the transport section of `loop-detection.md`
so that streaming is the transport and arming the detector no longer changes
it.

## Done when

- [x] Every agent's replies are read as a stream, whether or not loop
      detection is armed.
- [x] A stream with no delta for `modelStreamIdleSecs` is cancelled and
      retried on the client's schedule, and the retry is logged as a stall.
- [x] `GgRunLimits` carries `modelStreamIdleSecs`, absent means 60, and the
      console's limits form offers it.
- [x] The execution limits, configurations and loop detection pages describe
      the bound and the transport.
- [x] Gates green.
