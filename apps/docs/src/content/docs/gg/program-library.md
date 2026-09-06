---
title: "Program library"
---

Under [responses as code](/gg/responses-as-code/overview/) a model's whole reply
is a program, so one wrong identifier in a sixty-line program costs all sixty
lines again to fix. The program library keeps the source of every program an
agent ran, each under an id of its own. A later program fetches one back by that
id, patches it with ordinary string work, and hands it over to be run in its own
place.

```ts
import { programs } from "gg";

const source = programs.get("k3p9");
programs.rerun(source.replace("cosnt total", "const total"));
```

The `program-library` capability is per agent and applies only to an agent that
answers as code.

## Program ids

Every `submit_program` call that carries a program is assigned an id when it is
acknowledged, before the program runs. The acknowledgement's body is that id and
nothing else: a bare string such as `k3p9`, a receipt rather than a verdict. A
call that carried no program is answered with the reason, as it is today, and is
assigned no id. The system prompt tells the model both facts, and that `get`
takes the id the acknowledgement handed it.

An id is a cuid2 of the length the agent's `idLength` param sets. It is minted
against every id the agent's library has ever issued, retained or since dropped,
so a fetch of a dropped program is `not-found` rather than another program.
Minting makes at most sixteen attempts, re-rolling a collision; exhausting the
bound is gg's own defect, reported on the operator's stream, and the turn is
fatal in the way a host fault is.

Ids are scoped to the agent. An agent fetches its own programs and no other
agent's, and the same id string may name different programs in different
agents' libraries.

## The three calls

- `gg.programs.history()` lists every program still held, oldest first. Each
  entry carries its id, the turn it ran in, how many lines and characters it
  was, whether it ran to its end, and the error it ended with.
- `gg.programs.get(id)` returns the exact source of one program, as it ran. The
  id is required.
- `gg.programs.rerun(source)` hands gg a program to run in place of this one.

Every arm's SDK compiles the module in whatever the agent holds, so the
capability is enforced on the host: all three calls are refused `unavailable` for
an agent that keeps no library. `history` answers with a result rather than a
bare list for that reason. An agent that keeps no library and an agent whose
library is empty on its first turn are different facts, and one empty list could
report only one of them.

A history entry can also fetch its own source, so a program that has read the
history need not carry an id back to `get`.

`history` describes shapes and never carries source. A directory that inlined
every program would put the whole session back in front of the model, so sources
are fetched one at a time, by id. A `get` of an id the agent was never issued,
or of one the retention has dropped, is `not-found`, and the message names the
ids that are held and the turn each ran in.

## Handing a program over

`rerun` is registered rather than performed, as `gg.context.compact` and an agent
[transition](/gg/fork-and-exec/) are. The call validates the source and returns,
the calling program carries on to its end, and gg then compiles and runs what it
was handed as the same submission's program.

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

A submission runs at most four programs: the model's own, plus three handed
over. A chain that reaches the bound is told so, and the last program gg ran is
the submission's.

### What a chained submission reports

A chained submission is one program to everything outside it: one
`CodeExecution` event, one library entry under the submission's id. What the
chain accumulated is summed across every program in it: the tool calls it
dispatched, the views it opened, the lines it logged, the time it burned. What it
resulted in is the last program's throw, ending and verdict. The operator's
stream reports how many programs the chain ran, and reports a hand-over that was
revoked or refused.

## What is kept

One entry per submission that carried a program, holding the source that
executed. A reply that carried [several submissions](/gg/responses-as-code/programs/#several-submissions-in-one-reply)
leaves several entries in the same turn, each under its own id. A rerun keeps
the submission's id and replaces its source: the entry records the program that
did the work rather than the lines that asked for it, which is what makes
fetch-patch-rerun compose across turns. The patched program is what the next
`get` of that id returns.

A program that failed is kept, and is the most likely thing to fetch. Its record
carries the error it ended with, in the same words the model was given in its
turn feedback.

gg's own opening programs are kept on the same terms, each on turn 0 under the
id its acknowledgement carried: the [opening
turn](/gg/responses-as-code/views/#the-opening-turn)'s program, the seeding
[autoloaded specifications](/gg/autoload-specifications/) synthesize, and the
re-opened views of a [restored desk](/gg/agent-persistence/).

The library is a text store. What a program did is the run's telemetry, its
session record, and the workspace.

It is also independent of the context window. A window is
[compacted](/gg/compaction/), archived and evicted; the library is not, and it is
never rendered into a prompt. An agent forty turns past a compaction can still
fetch the program it wrote before it, and holding the library costs the model
nothing until it asks.

## Across a succession

The library follows the agent through an [exec, fork or FSM
transition](/gg/fork-and-exec/) on the same terms as its other per-instance
state. A `fork` clones it: the copy gets its own entries and its own record of
issued ids, and the two diverge from there. An `exec` or FSM transition moves it
to the successor, entries and issued ids together, so a successor can fetch the
program its predecessor wrote and never re-issues an id it once handed out.

The successor resolves `enabled`, `keep` and `idLength` from its own profile and
then adopts what was carried, truncated to its own `keep`. A successor whose
profile disables the capability keeps nothing.

## Configuration

```json
{
  "id": "program-library",
  "enabled": true,
  "params": { "keep": 20, "idLength": 4 }
}
```

`keep` is how many of the agent's most recent programs are retained, and an
enabled program-library capability writes it. `0` keeps every program of the
session.

`idLength` is the length of the ids the agent's programs are assigned, from 2 to
32, and defaults to 4. A longer id costs the model more tokens on every fetch and
buys more room before re-rolls.

An absent `keep` or `idLength`, one gg cannot read as a number, and an
`idLength` outside its range each refuse the launch, so a study never holds a
different number of programs, or ids of a different shape, than its
configuration says.

Retention is per agent: a run may keep programs for its implementer and not for
its reviewer. The launch log names each agent that keeps programs, how many each
keeps, the length of its ids, and the fetch and hand-over calls spelled in that
agent's own language.

## Where it lives

| Piece                                                                            | Where                                        |
| -------------------------------------------------------------------------------- | -------------------------------------------- |
| The library, its retention, id minting, and the `keep` and `idLength` resolution | `crates/gg/src/programs.rs`                  |
| The three host functions                                                         | `crates/gg/src/sandbox/membrane/programs.rs` |
| The `programs` module in an arm's SDK                                            | `packages/gg-sandbox/src/gg/programs.ts`     |
| The hand-over chain, and folding a submission's records                          | `crates/gg/src/agent.code.rs`                |
| Carrying the library across a succession                                         | `crates/gg/src/agent.transitions.rs`         |

Every other language arm carries the same module in its own SDK package.
