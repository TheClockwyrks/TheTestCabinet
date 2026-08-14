---
title: "Program library"
---

Under [responses as code](/gg/responses-as-code/overview/) a model's whole reply
is a program, so one wrong identifier in a sixty-line program costs all sixty
lines again to fix. The program library keeps the source of every program an
agent ran. A later program fetches one back, patches it with ordinary string
work, and hands it over to be run in its own place.

```ts
const source = gg.programs.get();
gg.programs.rerun(source.replace("cosnt total", "const total"));
```

The `program-library` capability is per agent and applies only to an agent that
answers as code.

## The three calls

- `gg.programs.history()` lists every program still held, oldest first. Each
  entry carries its turn, how many lines and characters it was, whether it ran
  to its end, and the error it ended with.
- `gg.programs.get(turn?)` returns the exact source of one program, as it ran.
  No argument is the most recent.
- `gg.programs.rerun(source)` hands gg a program to run in place of this one.

Every arm's SDK compiles the module in whatever the agent holds, so the
capability is enforced on the host: all three calls are refused `unavailable` for
an agent that keeps no library. `history` answers with a result rather than a
bare list for that reason. An agent that keeps no library and an agent whose
library is empty on its first turn are different facts, and one empty list could
report only one of them.

A history entry can also fetch its own source, so a program that has read the
history need not carry a turn number back to `get`.

`history` describes shapes and never carries source. A directory that inlined
every program would put the whole session back in front of the model, so sources
are fetched one at a time, by turn. A `get` of a turn that ran no program, or of
one the retention has dropped, is `not-found`, and the message names the turns
that are held.

## Handing a program over

`rerun` is registered rather than performed, as `gg.context.compact` and an agent
[transition](/gg/fork-and-exec/) are. The call validates the source and returns,
the calling program carries on to its end, and gg then compiles and runs what it
was handed as the same turn's program.

Four rules follow, and the model is told each of them:

- Everything the registering program already did stands, and the program that
  runs next sees the world it left behind. A program hands over before doing work
  it does not want done twice.
- The first hand-over stands. A second is `refused`, and a blank source is
  `invalid-argument`.
- A program that then fails revokes its hand-over, exactly as it revokes an
  [ending](/gg/ending-a-session/). The model is told the replacement was not run.
- An ending outranks a hand-over. A program that both ended the session and
  handed one over gets the ending, and the replacement is not run.

A turn runs at most four programs: the model's own, plus three handed over. A
turn that reaches the bound is told so, and the last program gg ran is the
turn's.

### What a chained turn reports

A chained turn is one turn to everything outside it: one model call, one
`CodeExecution` event, one library entry. What the turn accumulated is summed
across every program in the chain: the tool calls it dispatched, the views it
opened, the lines it logged, the time it burned. What it resulted in is the last
program's throw, ending and verdict. The operator's stream reports how many
programs the turn ran, and reports a hand-over that was revoked or refused.

## What is kept

One entry per turn that ran a program, holding the source that executed. A turn
whose program was itself handed over by `rerun` records the program that did the
work rather than the lines that asked for it, which is what makes
fetch-patch-rerun compose across turns: the patched program is what the next
turn's `get` returns.

A program that failed is kept, and is the most likely thing to fetch. Its record
carries the error it ended with, in the same words the model was given in its
turn feedback.

The library is a text store. What a program did is the run's telemetry, its
session record, and the workspace.

It is also independent of the context window. A window is
[compacted](/gg/compaction/), archived and evicted; the library is not, and it is
never rendered into a prompt. An agent forty turns past a compaction can still
fetch the program it wrote before it, and holding the library costs the model
nothing until it asks.

## Configuration

```json
{ "id": "program-library", "enabled": true, "params": { "keep": 20 } }
```

`keep` is how many of the agent's most recent programs are retained, and is 20
when absent. `0` keeps every program of the session. A `keep` gg cannot read as a
retention refuses the launch, so a study never holds a different number of
programs than its configuration says.

Retention is per agent: a run may keep programs for its implementer and not for
its reviewer. The launch log names each agent that keeps programs, how many each
keeps, and the fetch and hand-over calls spelled in that agent's own language.

## Where it lives

| Piece | Where |
| --- | --- |
| The library, its retention, and the `keep` resolution | `crates/gg/src/programs.rs` |
| The three host functions | `crates/gg/src/sandbox/membrane/programs.rs` |
| The `programs` module in an arm's SDK | `packages/gg-sandbox/src/gg/programs.ts` |
| The hand-over chain, and folding a turn's records | `crates/gg/src/agent.code.rs` |

Every other language arm carries the same module in its own SDK package.
