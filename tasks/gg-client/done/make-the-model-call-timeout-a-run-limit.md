# Make the model call timeout a run limit

Make the per-call ceiling on a model request an operator-set figure in
`GgRunLimits`, defaulting to fifteen minutes, so a model that is still producing
a reply is given the time it needs.

## Current state

`MODEL_CALL_TIMEOUT` in `crates/gg/src/client.rs` is a constant of five minutes.
The buffering transport, which every agent without loop detection runs, applies
it as a total-duration cap over the whole call. The streaming transport applies
it as an idle cap on the response head and between chunks.

A model that reasons at length before answering routinely runs past five
minutes on the buffering transport. In a run of `xiaomi/mimo-v2.6-pro` against
[`drop-the-desktop-app.md`](../v0.7.0/drop-the-desktop-app.md) on 2026-09-22,
turns carrying 4,500 to 6,200 reasoning tokens took 200 to 280 seconds, and
three agents each lost turns to the ceiling while the provider was still
generating. Each timed-out turn is retried byte-identical, so the retry tends
to reproduce the same long generation and the consecutive-error ceiling ends the
agent. The figure is not visible in the invocation and cannot be raised without
rebuilding gg.

The ceiling is described in `apps/docs/src/content/docs/gg/execution-limits.md`
under the model API errors, and named there as five minutes.

## Design

Add `modelCallTimeoutSecs` to `GgRunLimits`. It is optional in the document and
defaults to 900 when absent, since a run always has a ceiling: the value `0`
refuses the launch alongside every other unhonourable limit. The launch
resolves it once and the recorded capability set carries the figure in force,
so a run's record states the ceiling it ran under.

Both transports read the resolved figure in place of the constant: the total
duration cap on the buffering transport, and the head and idle caps on the
streaming one. The `model_timeout` error and the `ModelError::Timeout` variant
keep reporting the ceiling that fired.

A fresh configuration in the console's editor seeds the field at 900 beside the
error ceilings, and the limits form offers it with the other figures.

Bring `execution-limits.md` and `configurations.md` onto the limit, and add the
field to `templates/` under the `driving-gg-directly` skill.

## Done when

- [ ] `GgRunLimits` carries `modelCallTimeoutSecs`, absent means 900, and `0`
      refuses the launch.
- [ ] Both transports take their ceiling from the resolved limit.
- [ ] The console's limits form and a fresh configuration carry the field.
- [ ] The execution limits and configurations pages describe the limit.
- [ ] Gates green.
