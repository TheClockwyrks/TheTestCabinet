---
title: "Programs"
---

An agent in this execution mode answers each turn by writing one program. This
page covers the reply gg accepts, how that reply becomes an executed program,
the outcomes a turn can have, and how a session is ended from inside a program.

## The reply gg accepts

The model's whole reply is the program. The first character of the reply is the
first character of its code, and the reply carries no fence, no `ts` tag and no
prose around the code. gg runs no analysis of its own to decide whether a reply
is a program. The reply is healed, then prepared by the agent's program
language, and that language's compiler or parser is what accepts or refuses it.

The reply is a whole program in its language. It imports the parts of gg's SDK
it calls, and it declares the entry point its language requires of a program
that runs. gg compiles it as it stands, on the terms in
[invariants](/gg/responses-as-code/invariants/).

A program, written in TypeScript:

```ts
import * as gg from "gg";

const specs = gg.files.listDir("specs").filter((e) => e.kind === "file");
const missing = specs.filter(
  (e) => !gg.files.readTextFile(`specs/${e.name}`).includes("## Rules"),
);
gg.views.openText("missing-rules", missing.map((e) => e.name).join("\n"));
if (missing.length === 0) {
  gg.session.finish(`Checked ${specs.length} spec files; each has rules.`);
}
```

The import is the namespace form because `gg.files.readFile` is the name every
documentation view is filed under and every quoted call is written with, and that
line is what makes the printed name an expression the program can write. A named
import (`import { files } from "gg";`) reaches the same module and is equally
valid.

Four rules govern what such a program can do with what it computed.

- A [view](/gg/responses-as-code/views/) is the only route by which anything a
  program computed reaches the model. gg pushes one message per open view into
  the next prompt.
- What the program logged reaches the run's operator. A log line is never shown
  back to the model.
- A value the program returns is discarded.
- An ending call ends the session, and nothing else does.

Every reply is compiled and gg judges none of them. Prose does not compile and
earns a `Compiler error`. Two programs pasted together earn the redeclaration
error that is what is wrong with them. A reply of comments, or an empty reply,
is a program that compiles, runs and does nothing. A turn whose reply failed to
compile is an error turn, so a configured
[error ceiling](/gg/execution-limits/) can stop a model that has started
answering in prose.

## Response healing

Between the raw reply and the preparation step sits a deletion-only healing
pass. It unwraps a Markdown fence a model wrapped its program in, drops
explanatory lines around the program, and, for a run that arms the strategy,
halves a reply the transport delivered as a byte-identical copy of itself.

Every repair is counted on the run and disclosed on the operator's stream. The
model is told nothing about it. Healing runs before the turn does, because the
loop needs the healed program in order to decide which assistant message to
record. See [response healing](/gg/response-healing/) for the strategies, their
decline rules, their configuration and their metrics.

## Turn execution

1. Heal the reply. Healing deletes only, and never refuses a reply.
2. Prepare the healed reply for the agent's language. The language's own
   compiler or parser reads it, and a program it rejects is not executed.
3. Instantiate the guest and evaluate the program. Each call the program
   composes crosses the typed membrane into gg's tools, is gated, dispatched
   and streamed as an ordinary `ToolCall`/`ToolResult` pair.
4. Record the source that executed, with the turn's verdict, for an agent whose
   profile enabled the [program library](/gg/program-library/).
5. Report to the operator, and emit the turn's `code_execution` event. The
   event is emitted whether the turn succeeded or not, including a turn whose
   reply never compiled.
6. Read the ending flag before interpreting the result. An ending that survived
   ends the session here.
7. Assemble the turn's notices, then classify the outcome.

The sandbox is synchronous and CPU-bound, so it runs on a blocking thread. Every
call the program composes is serviced on that same thread, calling gg's typed
tool functions directly, and the delegation family is routed back onto the async
loop. Everything that services a native tool call services a composed one: the
compaction gate, the call telemetry, replay capture, agent-managed-context
reclaim and skill pinning.

The per-turn state is the context window, the skills runtime, the docs runtime
and the delegation context. It is moved into the API for the duration of the
program, so a program's calls act on the live window, and is reclaimed when the
program ends. On the one path where it cannot come back, a panicked blocking
task, the turn is fatal and the loop ends the session.

Four declarations a program makes are applied once the turn closes rather than
mid-program: a compaction, a succession through `exec` or `transitionState`, a
`fork`, and an issue wait. Rewriting or replacing the window a program is
running in would pull it out from under the turn still using it. The last
compaction stands, the first succession stands, and every fork is dispatched.

## Turn outcomes

A turn produces exactly one of three outcomes, and each records exactly one
outcome against the run's ceilings.

- `Finished` carries the ending the program declared. Its text is the session's
  final word.
- `Continue` carries the messages gg pushes back, the specific turn error when
  the turn was an error, and one line describing what the turn produced for
  whoever spawned the agent.
- `Fatal` carries gg's own failure. The loop ends the session and the run ends
  with it.

When the sandbox could not run the program to a result, the failure is split by
owner:

| Failure | What the model reads | Session |
| --- | --- | --- |
| The prebuilt artifact could not be run, or gg's own plumbing failed | nothing | the run ends |
| gg accepted the program and could not prepare it | nothing | the run ends |
| The language's compiler could not finish | nothing | the run ends |
| The language read the program and rejected it | the language's diagnostic verbatim, under `Compiler error` | continues |
| A sandbox ceiling stopped the program | the ceiling's own words, under `Runtime error` | continues |

A program that ran and then failed on its own account is a result rather than a
failure of the sandbox. gg reports what the language emitted, with the location
that language reported and whatever the program wrote to standard error, under
`Runtime error`. The turn is an error turn and the session continues.

The fatal failures are fed back to nobody and charged to no ceiling. The model
answered and gg could not run the answer, so the failure is gg's and is recorded
as gg's: the run ends under `internal_error` whichever agent was taking the turn,
on the terms in [gg's own defects](/gg/execution-limits/#ggs-own-defects).

A turn is an error when the work it declared could not be carried out as
declared: a program that did not compile, one that threw uncaught, one a sandbox
ceiling stopped. A failure gg reported into a program that carried on is not one.
A caught throw, a refused call, a non-zero `shell` exit and a call refused for a
spent wall-clock budget all leave the turn an ordinary turn.

## Hand-over chains

`gg.programs.rerun(source)` hands gg a program to run in place of the one
calling it, once that one has finished. Everything the handing-over program
already did stands, and the program that runs next sees the world it left
behind. The first hand-over in a turn stands and a second is refused.

One turn runs at most four programs: the model's own, plus up to three handed
over. The turn's outcome and its ending come from the last
program in the chain, and that is the source the program library records. The
calls dispatched, the views opened, the lines logged, the module errors and the
elapsed and compile time accumulate across every link.

gg declines a hand-over for three reasons, and each earns a `Notice` of its own:
the handing-over program failed afterwards, it also ended the session, or the
turn had already run as many programs as it may.

## Ending a session

The role an agent was dispatched in decides which ending calls it may make. An
agent doing work calls `gg.session.finish(summary)`. An agent reviewing work
calls `gg.session.approve()` or `gg.session.requestChanges(items)`. Both groups
are declared on every agent. The membrane accepts the calls of the agent's own
role and refuses the other group as `unavailable`, naming the endings the agent
does have. See [ending a session](/gg/ending-a-session/) for the shape of each
declaration.

- Ending sets a flag in the agent's own host-side context and returns. The
  statements after it run, their calls are dispatched and recorded like any
  other, and the session ends when the program does. There is no unwind, so
  there is nothing for a program to catch.
- The last call wins. Replacements are counted and the run logs a warning
  naming the count.
- A program that fails after declaring an ending loses it. An uncaught throw or
  a sandbox ceiling revokes the flag, the run logs a warning, and the model
  reads the throw alone. A failure the program catches revokes nothing.
- The role gate runs first, before the declaration is checked for
  well-formedness, so a well-formed `approve` from an agent that may not
  approve is refused as `unavailable`.
- An empty summary is refused as `invalid-argument` at the membrane. A change
  list is trimmed of its blank items first, and is refused the same way when
  nothing is left.
- Ending bypasses the dispatch path, so a spent wall-clock budget never
  withholds the exit.
- Nothing ends implicitly. A session whose programs never call an ending
  continues until a bound stops it.
