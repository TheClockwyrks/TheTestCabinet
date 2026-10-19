---
format: nyxsis-issue
version: 2
id: c74zn6w2tknmqdkgaezjb1ez
zone: GGH
number: 3
title: Emit a heartbeat while an agent waits so the idle watchdog never kills gg
type: generic
state: open
created: 2026-10-18T23:42:15.18603096Z
---

gg emits nothing on its stream while a tool call, a model request or a
subagent is in flight, and its shell tool allows a call 3600 seconds, so a
tool call that outlives the driver's 30-minute idle watchdog is killed as
`hung` instead of returning a timeout the model could act on. The
documentation has gg emit a `heartbeat` event during any wait, at an interval
well inside the watchdog's window, so a gg run is recorded `hung` only when gg
itself has stopped: `apps/docs/src/content/docs/gg/telemetry/overview.md`,
section "What the stream carries", and
`apps/docs/src/content/docs/components/driver/execution.md`, section "Runtime
limits". The shell tool's timeout kill is documented as reaching the command's
whole process group: `apps/docs/src/content/docs/gg/shell.md`, section
"Running a command".

On prod, three pong runs since 2026-10-17 (deepseek-v4.1-flash-1017,
muse-wonder and gemini-4-argon) ended `hung` on a model-written capture script
that spawned Vite through `npx` with piped stdio and then killed only the
wrapper, leaving the orphaned server holding the pipe so the script never
exited. The shell tool would have returned a timeout after an hour; the
watchdog fired first.

## What is missing

- A `heartbeat` telemetry event, emitted per agent at most every 60 seconds
  of a wait on a model request, a tool call, a program's execution or a
  subagent, carrying what the agent waits on and how long it has waited,
  written to the same stream the driver's watchdog reads.
- The shell runner's timeout kill signalling the command's process group
  rather than `sh` alone, so an orphaned grandchild dies with the command.
- Output collection after the command's exit bounded by a short grace, so a
  backgrounded grandchild still holding the pipes ends the call instead of
  holding it open.
- Tests for each: a wait longer than the interval emits heartbeats, a
  timed-out command's orphan is dead, and an exited command with a pipe still
  held returns within the grace.

## Verify

Against a local deployment, a gg run whose model runs
`node -e "require('child_process').spawn('sleep',['3000'],{stdio:'pipe'})"`
with a 2400-second tool timeout completes with a timeout result on that call
rather than ending `hung`, and the run's event stream carries heartbeats
through the wait. The gg crate's gates pass.
