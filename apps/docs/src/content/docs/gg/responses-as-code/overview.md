---
title: "Responses as code"
---

An agent in this execution mode answers a turn by writing a program over gg's
tools. The whole reply is that program, and gg runs it in a wasmtime sandbox.
Loops, conditionals, filtering, intermediate values and a dozen composed calls
happen inside one turn.

Execution mode is a property of an agent, not of a run. gg records each agent's
mode as `responses_as_code` or `tool_calling`, and a configuration may mix the
two, so an A/B of the response shape is a comparison inside a single run.

## The contract

- The model's entire reply is the program. It carries no fence, no prose and no
  Markdown, and gg runs no analysis of its own to decide whether a reply is a
  program. The reply is healed, prepared by the configured program language, and
  the language's compiler or parser is what accepts or refuses it. A reply that
  fails to compile is an error turn and counts against the run's error ceilings.
- A responses-as-code agent is offered no native tool definitions. The system
  prompt names the capability modules and their one-line briefs, and names no
  function. An agent finds a function by searching the documentation and opening
  a documentation view of the hit.
- Views are the only route by which anything a program computed reaches the
  model. A program that ran and did what it meant to gets nothing back; the
  views it opened are the result. What the program logged goes to the run's
  operator, and a value the program returns is discarded.
- A session ends only through an ending call. An agent doing work calls
  `gg.session.finish(summary)`; a reviewer calls `gg.session.approve()` or
  `gg.session.requestChanges(items)`. A program that throws after calling one
  loses the ending.
- Every function of the SDK is bound in every program whatever the run enabled.
  A call to a withheld function runs and fails, naming what is missing: the gg
  tool a toolset did not offer, the capability the agent was not given, or the
  endings the agent does have.

## Configuration

The capability id is `responses-as-code`. It is the responses-as-code agent
type's settings panel in the [configuration](/gg/configurations/) editor, and
the agent-type selector is its switch. Six parameters are read:

| Param | Default | Meaning |
| --- | --- | --- |
| `language` | `typescript` | The program language this agent writes in. |
| `timeoutSecs` | `30` | Guest-execution ceiling for one program, in seconds. A fraction is honoured. |
| `maxMemoryBytes` | `268435456` | Guest linear-memory ceiling for one program. A fraction truncates towards zero. |
| `docViewTypes` | `return` | Which SDK types opening a function's documentation opens beside it: `return`, `return-and-parameters` or `off`. |
| `healing` | per-strategy defaults | Which [response-healing](/gg/response-healing/) repairs are armed. |
| `assistantMessages` | `none` | How the assistant turn is recorded: `none` records the reply as the model sent it, `response-healing` records the healed program that ran. |

The two numeric params fall back to their default when the value is absent,
non-numeric or non-positive, and neither is clamped. A value gg cannot read for
`language`, `docViewTypes`, `healing` or `assistantMessages` changes nothing and
is reported at launch.

All six resolve per agent, from that agent's own profile. The language and the
documentation-type mode land on that agent's `agent_surface`
[event](/gg/telemetry/overview/), beside its execution mode. A root that opens
every type a signature names and a reviewer subagent that opens none are one
configuration.

## Program language

The language a program is written in is a configuration axis of the same kind as
the execution mode itself. gg registers eleven: TypeScript (the default),
JavaScript, Python, Ruby, PureScript, Java, Kotlin, Rust, Swift, C++ and C#.
Each ships its own idiomatic SDK over the same typed surface, so two arms differ
in the spelling of a call rather than in which calls exist. Every example in
this section is TypeScript.

See [program languages](/gg/languages/overview/) for the design of that seam and
for each arm.

## This section

- [Programs](/gg/responses-as-code/programs/): the reply gg accepts, how a turn
  executes, the outcomes a turn can have, hand-over chains, and the rules for
  ending a session.
- [Tools](/gg/responses-as-code/tools/): the typed function surface a program
  calls, the module vocabulary, the capability gate, how a failed call is
  reported, and `lib` for code the agent loaded.
- [Views](/gg/responses-as-code/views/): the four kinds of view, their caps and
  supersession rules, and how an agent discovers and reads documentation.
- [Messages](/gg/responses-as-code/messages/): the three message bands gg feeds
  back to the model, and what only the run's operator is told.
- [Sandbox](/gg/responses-as-code/sandbox/): the execution limits, what a
  program can reach from inside the guest, and how the arms' artifacts are
  built.
