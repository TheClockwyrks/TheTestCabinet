---
format: nyxsis-issue
version: 3
id: l3frgtvirspascil6awvsrrz
zone: GGH
number: 2
title: Arm the stream idle bound on the first delta instead of at send
type: generic
state: done
created: 2026-10-18T23:42:01.87306174Z
done: 2026-10-20T01:23:45.561299509Z
outcome: |
  Landed as superrepo PR 4490 into nightly with gg PR 4469 (gg nightly ad294107b)
  and contracts PR 4471 (master a9c473ad7): the idle clock is armed by a reply's
  first progressing delta, the call ceiling alone bounds the head wait, the
  head-stall fault is gone, and the default model call timeout is thirty minutes
  in gg, the contracts and the console. Left: contracts PR 4485
  (issue/ggh-2-wording) rewords the run limits' doc comments and regenerated
  schema text and waits on the user's vote; gg's own over-long doc-comment lines
  were left for a later release; no live provider stream was exercised, only gg's
  deterministic client tests.
---

gg starts the `modelStreamIdleSecs` clock when a request is sent and cancels
the attempt after 60 seconds with no delta, so a model that streams no
reasoning and delivers its reply in one piece is cut for silence whenever that
reply takes longer than the bound. The documentation arms the bound on the
first delta and leaves the wait for it to `modelCallTimeoutSecs` alone, which
defaults to 1800 seconds:
`apps/docs/src/content/docs/gg/execution-limits.md`, sections
`modelCallTimeoutSecs` and `modelStreamIdleSecs` and the defaults table, and
`apps/docs/src/content/docs/gg/configurations.md`.

On prod, every gemini-4-argon run of pong since 2026-10-17 ended
`harness_error` this way. Through OpenRouter the model emits a tool call as a
single chunk with no reasoning deltas, so a `write_file` of a few thousand
tokens arrives after 55 to 60 seconds. Once the context passed about 75k
tokens a third of attempts stalled at exactly 60 seconds, and a turn whose
reply needed longer stalled on all eleven attempts and ended the session.

## What is missing

- The idle clock in the model client armed by the first progressing chunk and
  restarted by each one after it, with the wait for the response head and for
  the first delta bounded by the call timeout only.
- The call timeout's default raised to 1800 seconds in the client, the limits
  resolution, the console's seeded configuration and the schema the
  configuration is validated against.
- Tests covering a response head that never arrives, a first delta that
  arrives late inside the call ceiling, and a reply that goes quiet after it
  started.

## Verify

A recorded gemini-4-argon turn whose reply takes 90 seconds to arrive in one
chunk completes under the defaults, and a stream that stops mid-reply is still
cancelled 60 seconds after its last delta. The gg crate's gates pass.
