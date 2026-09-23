# Run responses as code without a forced tool choice

Pin `tool_choice` to `submit_program` where the provider takes it, and run on
`auto` where it does not, so a model whose provider refuses a forced tool choice
can still drive a responses-as-code run.

## Current state

`build_required_tool_request_body` in `crates/gg/src/client.rs` offers one tool
and pins `tool_choice` to it, for every responses-as-code turn through
`complete_requiring` and for handoff compaction. A provider that refuses the
pin refuses the whole request. On 2026-09-23 a run of `qwen/qwen3.8-max-0902`
ended on its first request with `model_rejected`:

```
The tool_choice parameter does not support being set to required or object in thinking mode
```

The model is served in thinking mode by default and gg sends no reasoning
parameter, so no responses-as-code run of it can start. The pin is a
convenience rather than a requirement: a reply that makes no `submit_program`
call is already an error turn of its own, `missing_completion_no_program`, and
a compaction reply that makes no `compact` call is
`missing_completion_compaction`. Both leave the run running.

## Design

The client sends the pinned request first. A `400` whose body names
`tool_choice` is answered by re-sending the same request with `tool_choice` set
to `auto`, and the client stays on `auto` for the rest of the run, so the pin is
tried once per run rather than once per request. The downgrade is a `log`
event at `warn` naming the model and the provider's message, once.

A reply on `auto` that carries no call to the required tool is the error turn
it already is, and the turn loop continues on its existing terms. Handoff
compaction reads the same client state, so a compaction on a model that took
the downgrade runs on `auto` and a summary that makes no `compact` call is
`missing_completion_compaction` as today.

State on `apps/docs/src/content/docs/gg/responses-as-code/overview.md` and
`programs.md` that the call is pinned where the provider takes it and asked for
on `auto` where it does not, and describe the downgrade beside the
`missing_completion_no_program` error on `programs.md`.

## Done when

- [x] A provider rejection naming `tool_choice` is answered with the same
      request on `auto`, once per run, and logged.
- [x] A responses-as-code run of a model whose provider refuses the pin runs to
      its own end.
- [x] The overview and programs pages describe the pin and the downgrade.
- [x] Gates green.
