---
title: "Responses as code"
---

An agent in this execution mode answers a turn by writing a program over gg's
tools, submitted as the `program` string of a required `submit_program` tool
call, and gg runs it in a wasmtime sandbox.
Loops, conditionals, filtering, intermediate values and a dozen composed calls
happen inside one turn.

Execution mode is a property of an agent, not of a run. gg records each agent's
mode as `responses_as_code` or `tool_calling`, and a configuration may mix the
two, so an A/B of the response shape is a comparison inside a single run.

## The contract

- The program is the `program` string of a `submit_program` call — bare code,
  with no fence and no prose inside it — and every request offers exactly that
  one tool and asks for a call to it: pinned to the tool where the provider
  takes a forced tool choice, on `auto` where it does not. gg runs no
  analysis of its own and repairs nothing: the string is prepared exactly as
  sent by the configured program language, and the language's compiler or
  parser is what accepts or refuses it. A submission that fails to compile is
  an error turn and counts against the run's error ceilings. Text the model
  writes beside the call is recorded as its assistant message and never parsed
  for code; a reply carrying several calls runs each program sequentially, in
  order — all of them — and counts at most one error for the turn.
- The program is a whole program in its language, written by the model. It
  declares whatever entry point that language requires and imports gg's SDK
  itself, and the bytes that compile are the bytes the model sent.
- Beyond `submit_program`, a responses-as-code agent is offered no native tool
  definitions. The system prompt names the capability modules and their
  one-line briefs, and names no function. An agent finds a function by
  searching the documentation and opening
  a documentation view of the hit, then writes the call on a later turn, since
  the view arrives in the window on the turn after the program that opened it.
  gg records every call written without such a view as an
  [undocumented call](/gg/responses-as-code/views/#undocumented-calls).
- Views are the only route by which anything a program computed reaches the
  model. A program that ran and did what it meant to gets nothing back; the
  views it opened are the result. What the program logged goes to the run's
  operator, and a value the program returns is discarded.
- A session ends only through an ending call. An agent doing work calls
  `gg.session.finish(summary)`; a reviewer calls `gg.session.approve()` or
  `gg.session.requestChanges(items)`. A program that throws after calling one
  loses the ending.
- Every function of the SDK is compiled, linked and callable in every program
  whatever the run enabled. A call the agent was not granted runs and fails,
  saying that the call is not available and, where the agent has one, which call
  to make instead.

## Configuration

The capability id is `responses-as-code`. It is the responses-as-code agent
type's settings panel in the [configuration](/gg/configurations/) editor, and
the agent-type selector is its switch. Four parameters are read, and a
profile that enables the capability writes all four:

| Param            | Meaning                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `language`       | The program language this agent writes in.                                                                                                                                                                               |
| `timeoutSecs`    | Guest-execution ceiling for one program, in seconds. A fraction is honoured.                                                                                                                                             |
| `maxMemoryBytes` | Guest linear-memory ceiling for one program, as a whole number of bytes.                                                                                                                                                 |
| `docViewTypes`   | Which SDK types opening a function's documentation opens beside it, as independent toggles keyed `return`, `parameters` and `errors`. `true` opens all three, `false` opens none, and an object names each of the three. |

The four of them are what a responses-as-code arm is, so each is read off the
profile and none is chosen for it. Neither numeric param is clamped.

An absent param refuses the launch, and so does one gg cannot honour exactly as
written: a `timeoutSecs` that is not a positive number, a `maxMemoryBytes` that
is not a positive whole number of bytes, a `language` outside its own
vocabulary, and a `docViewTypes` carrying a key gg does not recognise, a value
that is not a boolean, or an object that leaves one of its keys out. The
refusal names every such value in the configuration, so one
pass fixes them all.

JSON has no integer type, so `5e8` and `500000000` are one `maxMemoryBytes`
declaration. `500000000.5` names no count of bytes and is refused, since
rounding it would run the guest at a ceiling nobody wrote.

All four resolve per agent, from that agent's own profile. The language and the
documentation-view flags land on that agent's `agent_surface`
[event](/gg/telemetry/overview/), beside its execution mode. A root that opens
every type a signature names and a reviewer subagent that opens none are one
configuration.

## Program language

The language a program is written in is a configuration axis of the same kind as
the execution mode itself. gg registers eleven: TypeScript, JavaScript, Python,
Ruby, PureScript, Java, Kotlin, Rust, Swift, C++ and C#. Each ships its own
idiomatic SDK over the same typed surface, so two arms differ in the spelling of
a call rather than in which calls exist. An agent with this capability on names
one of the eleven, and a launch that omits it is refused. Every example in this
section is TypeScript.

See [program languages](/gg/languages/overview/) for the design of that seam and
for each arm.

## This section

- [Invariants](/gg/responses-as-code/invariants/): the rules every arm keeps,
  whatever language an agent writes in.
- [Programs](/gg/responses-as-code/programs/): the reply gg accepts, how a turn
  executes, the outcomes a turn can have, hand-over chains, and the rules for
  ending a session.
- [APIs](/gg/responses-as-code/api-surface/): the typed function surface a
  program calls, the module vocabulary, the capability gate, how a failed call is
  reported, and `lib` for code the agent loaded.
- [Views](/gg/responses-as-code/views/): the four kinds of view, their caps and
  supersession rules, and how an agent discovers and reads documentation.
- [Messages](/gg/responses-as-code/messages/): the three message bands gg feeds
  back to the model, and what only the run's operator is told.
- [Sandbox](/gg/responses-as-code/sandbox/): the execution limits, what a
  program can reach from inside the guest, and how the arms' artifacts are
  built.
