---
title: "The session record"
---

Every gg run captures a session record: enough of the session to explain,
afterward, what each agent was asked and what came back. Capture is always on and
is not configurable. It exists for the run that can explain nothing on its own.
A run that hangs or outruns its cap is torn down before its working tree is ever
collected, so an unexplained stall would otherwise leave no trace.

The [telemetry](/gg/telemetry/overview/) stream is what every console view is built from,
live and post-run. The record is additional, and it pins the things the stream
does not carry:

- the model I/O, meaning each agent's request and the response it returned, and
  each call that failed together with the error the loop branched on,
- the tool results, meaning each call and the exact outcome its dispatch
  returned,
- the prompt frame, meaning the window as gg built it, with each item's slot,
  band, retention, turn and paged region,
- the shell commands gg ran, each stamped with the path that issued it, and the
  `git` subprocesses gg's own orchestration ran, and
- the cancel probes and clock reads the session loop branched on, so a record
  says why a session ended when it did.

The per-agent identity carried on every entry is what lets one record describe a
deep [agent tree](/gg/subagents/) agent by agent.

## Where the record comes from

gg appends one JSON object per line to a capture journal at `.gg/replay.ndjson`
inside the run container as the session proceeds, and holds no message body in
memory. After the run, the host folds those lines into the run tree's
`replay.json.gz`. That split is what keeps always-on capture affordable, and it
is what makes the record survivable: a journal is appended to, and a document
with arrays in it is not. The
[record format](/gg/analysis/session-records/) specifies both halves.

What the record holds of a large payload is bounded, because it is written on
every run. An image is recorded as its descriptor, meaning its media type and
decoded size, exactly as the telemetry stream records it. A text payload past its
ceiling is recorded as its kept tail, with the whole payload's byte count and
content address alongside it.

A per-run byte ceiling bounds the worst case. It is `replayMaxBytes`, among the
run's [execution limits](/gg/execution-limits/), and it is 256 MiB unless a
configuration says otherwise; the console's editor offers it as Session
journal (MiB) and writes the byte count itself. Crossing it stops capture and
marks the record truncated. Capture degrades rather than failing the run it
observes.

## Who reads it

The record is written on every run, mirrored to the backend and served at
`GET /runs/{id}/replay`. Nothing in this repository deserializes it: the console
is built from telemetry alone, live and post-run. It is a diagnostic for a
person, reached by downloading a run's archive or that route and opening the
JSON, when a run hung, stalled, or ended somewhere the telemetry summary cannot
explain.

That is what makes capture worth its cost. The record holds the exact model I/O,
the exact tool results and the exact prompt frame, and those are recoverable from
nothing else once the container is gone. Any later reader, whether an analysis
tool or a diffing view, reads this document rather than requiring a session to be
captured again.

## Salvage

Every other post-session read of a run goes through the collected working tree. A
run that hangs or runs past its cap never gets there: its session ends in an
error, and the engine's error path stops the container and returns immediately,
collecting nothing.

So before teardown, while the container is still up, the engine copies the
journal alone out of it and assembles it through the ordinary stage. The record
lands at the run tree's root exactly as a completed run's would, and reports its
truncation reason as `session_killed`, because a journal cut off mid-session
carries no terminating line.

Only the journal is rescued. Salvaging the implementation tree would give a hung
run a half-written build that a reviewer could open, score and publish, with no
way to tell it apart from one the model finished. The journal renders no verdict
and reaches no score.

A failure anywhere in the salvage leaves the run's own failure exactly as it is.
This path is already reporting one, and the absent record is the signal that
there was nothing to rescue.
