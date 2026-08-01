---
title: "Replay"
---

Deterministic session replay: every gg run records enough of itself to **replay it
exactly** afterward. It exists because a surprising outcome across a deep
[agent tree](/gg/subagents/) is otherwise very hard to chase down — and a surprising
outcome is by definition not one anybody predicted, which is why capture is no longer
something you switch on beforehand.

:::note
Capture is **always on**. It used to be an opt-in capability; the
[content-addressed record format](/gg/analysis/replay-records/) made a session cost
well under a megabyte to record, and at that price the switch bought nothing. The
`replay` capability still exists, but it now escalates a run to **full fidelity**
rather than deciding whether the run is recorded at all.

The reconstruction half of the redesign — a playback that drives the real turn loop
instead of walking the record — is specified under
[gg analysis](/gg/analysis/overview/): see [playback](/gg/analysis/playback/).
:::

The [telemetry](/gg/telemetry/) stream is already most of the capture; replay
additionally pins the non-deterministic inputs so a run reconstructs step for step:

- the **model I/O** — each agent's prompts and responses,
- the **tool results** — what each tool call actually returned, and
- the **prompt frame** — the window as gg built it, with each item's slot, retention,
  turn and paged region, which is recoverable from no other artifact.

A replay driver then re-runs the session from that record, letting a developer step
through exactly what each agent saw and did. This is the same instinct as The Test
Cabinet's [Foray](/testing/adversarial/foray/architecture/) replays, applied to gg.

Because replay capture is additive to the telemetry schema, the schema is shaped
with replay in mind: the reserved per-agent identity fields the telemetry already
carries are what let a captured record reconstruct a deep agent tree step for step.

## The two fidelities

| Input | Standard — every run | Full — the `replay` capability |
| --- | --- | --- |
| Model I/O and model errors, tool outcomes, orchestrator `git`, the cancel probe, the deadline clock, the prompt frame | recorded | recorded |
| Latency clock reads | — | recorded |
| Startup filesystem loads (skills, memories, autoloaded files, templates) | digested | verbatim |
| Payload truncation | may apply | never |

The escalation is read from **any** agent in the
[configuration](/gg/configurations/), not just the root: enabling it on the one
profile whose turns are under suspicion is the natural thing to do, and it is what
the capability is for. The fidelity a run captured at is recorded on the record
itself, so an absent full-only input reads as "this run was not recorded that
closely" rather than as "the session did not have one".

A per-run byte ceiling (`replayMaxBytes`, among the run's
[execution limits](/gg/execution-limits/)) bounds the worst case. Crossing it stops
capture and marks the record truncated: **capture degrades, it never fails the run it
observes.**
