---
title: "Messages"
---

Every assistant turn is a program, and everything gg sends back is plain `user`
text. The heading is the only thing telling the model what it is looking at, so
the vocabulary is exactly three messages.

| Heading | When | Body |
| --- | --- | --- |
| `Compiler error` | the program did not compile, so none of it ran | the language's diagnostic, verbatim, and the library set it was measured against |
| `Runtime error` | it compiled and then threw, or a sandbox limit stopped it | the error |
| `Notice` | a fact about the session rather than about the program | the fact |

A turn that produces both a notice and an error pushes the notices first and the
error last, so the error is the last thing the model reads before it writes its
next program.

## Error messages

The two error bands carry the error and nothing else. No preamble, no advice, no
roster of what the program called, no restatement of the rules it broke.

Everything gg might otherwise add is already somewhere better. A failed call
throws into the program, carrying the operation, the failure code and the
message, at the statement that made the call. A refused view throws at the call
site naming the cap it breached. What is left over is a standing rule, and a
standing rule is stated once in the [system prompt](/gg/prompts/): that a
program which throws does not end the session, that whatever it did before the
throw stands, that a view is the only channel out of a program, that logging is
not a channel to the model.

gg may remove from an error, and removal is the only edit it may make. What the
model reads is a subsequence of what the compiler or the runtime emitted, so a
stack trace is cut down to the model's own frames and a diagnostic list is cut
to its first few entries.

The one carve-out is that the layer raising a fault may compose into it the fact
that fault implies, because at that point the fact is part of the diagnostic. A
`ReferenceError` is answered in the guest, at the call site, with the names of
gg's modules, plus `lib` when the agent has loaded code. A documentation lookup
that resolves nothing is answered by the host with at most three of the nearest
names this agent binds, indented under the message. A compile failure on an arm
whose catalogue declares a library set is answered with that set, since it is
what the compiler resolved against. Each is a fact the fault implies, never
advice about what to do with it.

### Runtime errors

The body is what the language emitted: the error as its runtime composed it, the
location that runtime reported, and whatever the program wrote to standard
error.

```text
`edit_file` failed (conflict): `oldString` matched 3 times in src/main.rs
    at line 12, column 5
```

The location is the model's own, because the program that ran is the program the
model wrote and the next prompt carries that same text. Frames belonging to the
SDK and to gg's own plumbing are dropped from a trace, which is a deletion like
any other trim.

### Toolchain failures

A language toolchain that crashed or could not be started is a `Notice`, not a
`Compiler error`. Nothing read the program, so there is no diagnostic, and the
`Compiler error` heading would tell the model its program was rejected. The
notice says the program was not run, says explicitly that nothing about it was
rejected, and names the only action there is: write it again. The crash detail
goes to the operator's stream at `error` level.

## Notices

A notice is charged to the [System band](/gg/context-visibility/), where gg's
own messages live.

- A `gg.programs.rerun` hand-over gg did not run. Three wordings, one per
  reason: the program failed afterwards, the program also ended the session, or
  the turn had already run as many programs as it may.
- A [skill](/gg/skills/) or [memory](/gg/memories/) whose code failed to load, by
  name and with what the failure said. Its `lib` binding is empty, and a name
  that is not bound reads exactly like one the run never granted, so a model that
  was not told would fix the wrong thing. The source is gg's or the workspace's
  and the model has never been shown it, which is why this is a notice rather
  than an error and why the source is not quoted.
- The compiler-could-not-finish notice.
- An ending an [agent-stop hook](/gg/hooks/) rejected, and the results of a
  deferred `wait_for_issue`.
- The one notice a working program can earn.

## Successful turns

A program that ran and did what it meant to gets nothing back. The views it
opened are the turn's result, and the system prompt states that a program which
ran is not told so.

The exception is mechanical. A window that would otherwise end on the
assistant's own message makes the next request ask the provider to continue that
message rather than to answer it, so gg pushes a `Notice` rendered under the
agent's own language:

```text
Your program ran and put nothing in your context.

A view is the only way to see anything — a value you computed, or a file.
Nothing `console.log` writes is readable by you.
```

The condition is tested against the assembled window rather than inferred from
the program's outcome. Re-opening a view that was opened earlier in the same
turn lands the new copy in place rather than at the tail, and a compaction
rewrites the window under the turn, so either can leave a turn that opened a
view ending where it started.

## The window after a runtime error

The views a program opened before it threw are still there on the next turn.
They were pushed live against the agent's own context as the program ran, so a
throw ten statements later takes nothing back.

A program that read six files, opened views of two of them and then threw on the
seventh leaves its model looking at those two views and one error. The results
it wanted to keep are in front of it, and the standing rules in the prompt say
the rest of the work landed too.

## The operator's stream

The facts a report would have carried go to the run's operator stream, where
they reach telemetry, the run record, the session-record capture and the
console's activity feed:

- every call refused before it ran, and how many further refusals a cap
  suppressed;
- every refused view call, and how many further view records a cap suppressed;
- every view opened or replaced, with its kind, selector and token estimate, and
  every view closed, by selector;
- that a later ending call replaced an earlier one, how many times, and the
  summary the session ended on;
- that an ending was revoked because the program then failed;
- a hand-over gg did not run, and why.

The stream is quiet on the ordinary path: a program that called some tools and
opened some views did what programs do.

Beside those, every call a program makes is bracketed on the stream as an
`api_call` before the work and an `api_result` after it. The console's activity
feed reads a code agent by that pair, in the model's own vocabulary
(`gg.files.readFile`), resolved from the `operation` the pair carries through
the agent's reported surface. Calls that no gg tool backs appear there for the
same reason the rest do: a documentation search, a view call, an ending call and
a program-library call are all things the agent did.

Everything the program logged rides out on the turn's `code_execution`
[telemetry](/gg/telemetry/overview/) event. That event is the only record of it.

## Caps on the operator's record

| What | Cap |
| --- | --- |
| Calls described | 500 |
| Refusals described | 100 |
| View records described | 100 per kind (opened, closed, refused) |
| Failure text kept per call | 512 bytes |
| Log lines kept | 200 lines, 16 KiB in total, 2 KiB per line; the tail is what is kept |

Each cap counts what it discarded on the same `code_execution` event, so a
capped list reads as a tail rather than as a program that stopped doing
anything. None of these bounds anything the model reads.

## Context cost of a code turn

A code turn is charged to the window as one message per view the program opened,
plus one short message carrying the error on a turn that failed. A program that
ran cleanly and opened one view costs the window that view and nothing else.

Everything else a program did costs the window nothing: its reads, its computed
values and its calls are charged only where it opened a view of one. What a
program can put in the prompt is bounded by the
[view caps](/gg/responses-as-code/views/), which refuse rather than truncate.

The dispatched-call count reported in telemetry is the described set plus what
the cap suppressed, so it always equals the number of `ToolCall`/`ToolResult`
pairs the turn streamed. The `api_calls` count legitimately exceeds it: the
families no gg tool backs are calls too, as is a call the membrane refused.
