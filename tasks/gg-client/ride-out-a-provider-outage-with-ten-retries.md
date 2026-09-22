# Ride out a provider outage with ten retries

Retry a failed model request up to ten times with backoff before giving up, and
leave a non-zero exit code when the retries are spent, so a pinned provider's
outage costs a run minutes rather than the run.

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
[`pin-every-run-to-the-model-s-official-provider.md`](pin-every-run-to-the-model-s-official-provider.md)
refuses fallbacks, that `502` comes back to gg, and a 3.5 s schedule gives up
inside the outage that produced it.

## Design

`RetryPolicy` allows ten retries after the first attempt, a 1 s first delay
doubled each retry and capped at 60 s, which is about five minutes of waiting in
all. A `429` or `503` carrying `Retry-After` waits that long instead when it is
longer than the schedule's delay. Each retry is a `log` event at `warn` naming
the attempt, the status or transport error, and the delay before the next.

The retry stays inside the client, and the turn loop keeps its one decision. A
timed-out call keeps bypassing the client's retries, since each retry of a stall
would cost the ceiling again and the turn-level retry bounds that.

A session that ends because the retries were spent, or because a response was
fatal on the first attempt, exits `1`. Both are the provider's failure rather
than the model's or the configuration's, and `1` is what the host records as a
retryable harness error. State the exit under what the process exits with on
`apps/docs/src/content/docs/gg/execution-limits.md`, and the schedule beside the
error it produces.

## Done when

- [ ] A request failing with `429`, `5xx` or a transport error is retried ten
      times on the schedule above, honouring `Retry-After`.
- [ ] Each retry is logged with its attempt, cause and delay.
- [ ] A session ended by spent retries or a fatal response exits `1`.
- [ ] The execution limits page states the schedule and the exit.
- [ ] Gates green.
