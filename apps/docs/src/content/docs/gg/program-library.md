---
title: "Program library"
---

Under [responses as code](/gg/responses-as-code/) a model's whole reply is a program, and
that is why the protocol pays for itself: measured against traditional tool calling on the
same case, a task that took roughly **twenty-three turns** took about **six**. A model
given a program instead of one call at a time simply does far more per turn.

The whole cost of that is carried by mistakes. A sixty-line program with one wrong
identifier is sixty lines the model has to write again to change one of them — the error
is small and the retry is total, paid in output tokens and in latency for text the model
has already written once, and every re-emission is another chance to introduce a second
mistake.

The **program library** makes the retry proportional to the mistake. gg keeps the source
of every program it runs; the agent fetches one back, patches it with ordinary string
work, and hands it over to be run:

```ts
const source = programs.get();
programs.rerun(source.replace("cosnt total", "const total"));
```

Two lines instead of sixty.

Opt-in, per agent, and inert without responses as code — there are no programs in a
tool-calling session to keep.

## The three calls

They live on a `programs` object, bound into a program's scope only when the capability is
on. An agent without it has no `programs` object at all — a withheld family is an
undefined identifier, not a call that travels to the host to be refused, exactly as a
withheld tool is.

| Call | What it does |
| --- | --- |
| `programs.history()` | Every program still held, oldest first: its turn, how many lines and characters it was, whether it ran to its end, and the error it ended with if it did not. |
| `programs.get(turn?)` | The exact source of one program. No argument is the most recent. |
| `programs.rerun(source)` | Hands gg a program to run **in place of this one**. |

`history()` describes shapes and never carries source. A directory that inlined sixty
lines per entry would put the whole session back in front of the model, which is the one
thing the library exists to avoid — so the source is reached for one at a time, by turn.

A `get` of a turn that ran no program, or of one the retention has dropped, is
`not-found`, and the message **names the turns that are held**. The two ways to miss have
the same remedy, and a refusal that did not say which turns exist would cost a second turn
to discover the same thing.

## What `rerun` actually does

It is **registered, not performed** — the same shape [`context.compact`](/gg/agent-managed-context/)
and a [transition](/gg/fork-and-exec/) have. The call validates the source and returns; the
calling program carries on to its end; and only then does gg compile and run what it was
handed, as the same turn's program.

Running it inside the call would mean a program executing inside itself, with two sets of
tool calls, two throw sites and one turn to report them in. Deferring it costs nothing the
model can observe and removes that whole class of question.

Three consequences follow, and each is a rule the model is told:

- **Nothing is undone.** Every call the registering program already made stands, and the
  program that runs next sees exactly the world it left behind. So a program hands over
  *before* doing work it does not want done twice.
- **The first hand-over stands**, and a second is `refused` — the same argument that makes
  a [succession](/gg/fork-and-exec/) first-wins: a silently replaced program is a change
  the model cannot see.
- **A program that then fails loses it.** An uncaught throw or a sandbox ceiling revokes
  the hand-over exactly as it revokes an [ending](/gg/completion/), because a program that
  did not run to its end did not decide what should run next either. The model is told the
  replacement was not run, rather than left waiting for a turn that already happened.

An **ending outranks a hand-over**. A program that both called `finish` and handed one over
asked for two incompatible things, and the ending is the one earned by work already done.

### One turn, whatever it took

A chained turn is still **one turn** to everything outside it: one model call, one
`CodeExecution` event, one entry in the library. What the turn *accumulated* — the tool
calls it dispatched, the views it opened, the lines it logged, the time it burned — is the
sum across every program in the chain, because those are facts about the turn. What it
*resulted in* is the last program's: its throw, its ending, its verdict. The operator's
stream says how many programs ran.

The chain is bounded at **four** programs. A chain longer than one is not what the
capability is for, but a small allowance is worth having — assembling a program in two
steps is a legitimate thing to do — and what the bound stops is the runaway: a program
whose replacement hands over again, forever, inside one turn that never reports anything.
A turn that reaches the bound is told so, rather than left believing its last program ran.

## What gets kept

**The program that executed**, not the program that was sent. When a turn's program was
itself handed over by `rerun`, what the library records is the program that did the work —
not the two lines that asked for it. That is what makes fetch-patch-rerun *compose*: the
patched program is what the next turn's `get()` returns, so a chain of turns each refining
the last does not degenerate into a chain of trampolines.

A turn whose reply was **not a program** contributes nothing: there is no source, so
`get()` after such a turn still returns the last program the agent really ran, which is
what it wants.

A program that **failed** is kept, and is the single most likely thing to fetch. Its
record carries the error it ended with — in the same words the model was already given —
so a program deciding whether to reach for it can read what went wrong without searching
its window.

## Why it is not just the context window

The obvious alternative is to leave the programs where they already are: in the
conversation, where the model can read them. Being independent of that window is the
point.

A window is [compacted](/gg/compaction/), [archived](/gg/agent-managed-context/) and
evicted. gg's own state is not. An agent forty turns past a compaction can still fetch the
program it wrote before it — and the library is never rendered into a prompt, so holding it
costs the model nothing until it asks.

## Configuration

```json
{ "id": "program-library", "enabled": true, "params": { "keep": 20 } }
```

`keep` is how many of the agent's most recent programs are retained. gg's default is **20**
— a model reaches back for the turn it just ran, and occasionally for something a few turns
older it wants to run again, and twenty covers both while bounding an agent's resident
source at a few hundred kilobytes. `0` keeps every program of the session.

It is per agent, like every other capability: a run may keep programs for its implementer
and not for its reviewer. The launch log names each agent that keeps them and how many, so
the arm of a study without the library and the arm with it where no program ever reached
back are not indistinguishable in an operator's log.

A `keep` gg cannot read is **reported and ignored** rather than guessed at, on the same
rule a mistyped [healing](/gg/response-healing/) key is: a retention that silently reverted
to the default would be a run holding a different number of programs than its configuration
says, and that is unrecoverable from the data afterwards.

## Where it lives

| Piece | Where |
| --- | --- |
| The library, its retention, and the `keep` resolution | `crates/gg/src/programs.rs` |
| The membrane's three host functions | `crates/gg/src/sandbox/membrane/programs.rs` |
| The `programs` object a model calls | `packages/gg-sandbox/src/tools/programs.ts` |
| The chain — running a hand-over, and folding the turn's records | `crates/gg/src/agent.code.rs` |
