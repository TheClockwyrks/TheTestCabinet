---
title: "The session record"
---

Every gg run captures enough of itself to explain, afterward, what each agent was
asked and what came back. It exists for the one run that can explain nothing on its
own: a run that **hangs** or **outruns its cap** is torn down without its working
tree ever being collected, so an unexplained stall would otherwise be the single
outcome that leaves no trace.

:::note
Capture is **always on**. It used to be an opt-in capability; the
[content-addressed record format](/gg/analysis/session-records/) made a session cost
well under a megabyte to record, and at that price the switch bought nothing.
:::

The [telemetry](/gg/telemetry/) stream is what every console view — live and
post-run alike — is built from. The session record is additional, and it pins the
things the stream does not carry:

- the **model I/O** — each agent's prompts and responses,
- the **tool results** — what each tool call actually returned, and
- the **prompt frame** — the window as gg built it, with each item's slot, retention,
  turn and paged region, which is recoverable from no other artifact.

Because capture is additive to the telemetry schema, the schema is shaped with it in
mind: the reserved per-agent identity fields the telemetry already carries are what
let a captured record describe a deep [agent tree](/gg/subagents/) agent by agent.

## Where the record comes from

gg appends one JSON object per line to a **capture journal** inside the run
container as the session proceeds, and never holds a message body in memory. After
the run, the host folds those lines into the run tree's `replay.json.gz`. That split
is what makes always-on capture affordable — gg assembles nothing — and it is what
makes the record survivable: a journal is appended to, and a document with arrays in
it is not.

A per-run byte ceiling (`replayMaxBytes`, among the run's
[execution limits](/gg/execution-limits/)) bounds the worst case — 256 MiB unless a
configuration says otherwise; the console's editor offers it as
**Replay journal (MiB)** and writes the byte count itself. Crossing it stops capture
and marks the record truncated: **capture degrades, it never fails the run it
observes.**

## Salvage: the run the record exists for

Every other post-session read of a run goes through the collected working tree. A
run that hangs never gets there — its session ends in an error and the engine stops
the container and returns immediately, collecting nothing.

So before teardown, and while the container is still up, the engine copies the
**journal alone** out of it and assembles it through the ordinary stage. The record
lands at the run tree's root exactly as a completed run's would, and reports itself
`session_killed`, because a journal cut off mid-session carries no terminating line
— which is the honest description of what happened.

Only the journal is rescued. Salvaging the *implementation tree* from a hung
container was considered and deliberately rejected: it would give a hung run a
half-written build that a reviewer could open, score and publish, with no way to tell
it apart from one the model finished. The journal has no such problem — it renders no
verdict and reaches no score.

A failure anywhere in the salvage is never a failure of the run: this path is
*already* reporting one, and turning a diagnosable timeout into an unexplained
collection error would destroy the very information the salvage exists to preserve.
The absent record is the signal.
