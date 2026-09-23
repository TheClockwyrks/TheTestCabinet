# Ride out a provider outage with configurable retries

Retry a failed model request on a schedule the run configures, ten retries by
default, and leave a non-zero exit code when the retries are spent, so a pinned
provider's outage costs a run minutes rather than the run.

## Current state

`RetryPolicy` in `crates/gg/src/client.rs` retries `429`, `5xx` and transport
errors with four attempts in total, a 500 ms first delay doubled each retry and
capped at 8 s. The whole schedule is about 3.5 s. When it is spent the client
returns `RetryExhausted`, the session ends as `model_error`, and the process
exits `0` with the ending recorded only in the telemetry. A `4xx` ends the
session the same way on the first response.

Today an outage is hidden by OpenRouter: on 2026-09-22 OpenAI answered one
request of a `openai/gpt-5.6-sol` run with a `502`, OpenRouter moved the run to
Azure, and gg saw a successful response. Once
[`pin-every-run-to-the-model-s-official-provider.md`](../pin-every-run-to-the-model-s-official-provider.md)
refuses fallbacks, that `502` comes back to gg, and a 3.5 s schedule gives up
inside the outage that produced it.

## Design

`GgRunLimits` gains two figures, both optional in the document and always in
force on a launched run: `maxModelRetries`, the retries after the first attempt,
defaulting to 10, and `modelRetryMaxDelaySecs`, the ceiling on one backoff
delay, defaulting to 60. The first delay is 1 s, doubled each retry and capped
at the ceiling, so the defaults wait about five minutes in all, and 30 retries
at the same ceiling wait about half an hour. A run of a long test case may be
hours in, and an operator sets the retries by what the run is worth against
what an outage costs. A `0` for the delay ceiling refuses the launch; a `0` for
the retries is a run that gives up on the first failure and is honoured as
written. The console's limits form offers both beside the error ceilings, and
the resolved capability set records them.

`RetryPolicy` reads the two figures. A `429` or `503` carrying `Retry-After`
waits that long instead when it is longer than the schedule's delay. Each retry
is a `log` event at `warn` naming the attempt, the status or transport error,
and the delay before the next.

The retry stays inside the client, and the turn loop keeps its one decision. A
timed-out call keeps bypassing the client's retries, since each retry of a stall
would cost the ceiling again and the turn-level retry bounds that.

A session that ends because the retries were spent, or because a response was
fatal on the first attempt, exits `1`. Both are the provider's failure rather
than the model's or the configuration's, and `1` is what the host records as a
retryable harness error. State the exit under what the process exits with on
`apps/docs/src/content/docs/gg/execution-limits.md`, the two limits beside the
other ceilings there and on `configurations.md`, and the schedule beside the
error it produces.

## Done when

- [x] `GgRunLimits` carries `maxModelRetries` and `modelRetryMaxDelaySecs`,
      absent means 10 and 60, and the console's limits form offers both.
- [x] A request failing with `429`, `5xx` or a transport error is retried on the
      configured schedule, honouring `Retry-After`.
- [x] Each retry is logged with its attempt, cause and delay.
- [x] A session ended by spent retries or a fatal response exits `1`.
- [x] The execution limits page states the schedule and the exit.
- [x] Gates green.
