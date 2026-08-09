---
title: "Autoload specifications"
---

An agent normally opens with just the [build prompt](/gg/prompts/) and has to discover
and [read](/gg/filesystem/) the test case's specification for itself. With
**autoload-specifications** on, gg does that reading up front: an agent's very first
context is seeded with the **full contents of every file the test case provided** — its
specification and its reference images — injected as though the model had already read
each for itself. The whole brief is in the window from the first turn.

It is off by default, and per agent: it is one profile's [capability](/gg/configurations/#agents),
so a run can front-load the entire spec for one agent while another reads only what it
needs. Turning it on and off is a clean experiment — *does giving the model the whole
specification up front, rather than letting it choose what to read, produce a better
build?* — which is the kind of question gg exists to answer.

## What is loaded, and how

The files are exactly the ones the test case **provided** — its specs (in the order they
were seeded) followed by its rendered reference images — nothing the model itself wrote
and nothing from a starter-workspace scaffold. gg does not guess which seeded files are
the brief: The Test Cabinet's `core` computes the list when it seeds the run (it is the
authority on what came from the case) and hands it to gg at launch.

The seeding has to read as a conversation the agent itself could have had. Reads it never
made, sitting at the top of a fresh session, are otherwise indistinguishable from a
hallucination — so gg does not narrate the files into the window, it synthesizes the turn
that would have produced them. What that turn looks like therefore depends on how the
agent works.

In **tool-calling mode** each file is injected as a matched pair — a synthesized
`read_file` assistant call answered by the file's contents — so the opening conversation
reads exactly as it would had the model made those reads itself.

Under [responses as code](/gg/responses-as-code/) that shape is not merely awkward, it is
unavailable. A code turn's assistant message *is* a program, it carries no tool calls at
all, and `read_file` is not a function a program can call. A synthesized `read_file` pair
was a turn the mode cannot produce: the opening context taught the model an API it does
not have, on the very first thing it read. gg now synthesizes what a code agent would
actually have written — one assistant message whose content is a program of
[`view.openFile`](/gg/responses-as-code/#showing-yourself-things) calls, one per provided
file in seeding order, followed by the file views that program opened.

```ts
view.openFile("specs/rules.md");
view.openFile("reference/board.png");
```

Nothing else is in the program — no `const`, no loop, no logging — because the seeded turn
has to be a program the model could plausibly have written as its opening move, and an
opening move is exactly that list of calls and no scaffolding around them. Paths are
JSON-quoted, so a quote or a backslash in a path cannot break the parse. The views the
program opened arrive as headed `File` items keyed by path: the same envelope a real
`view.openFile` push produces, not a seeding-only one.

A text spec arrives as text; a reference mockup arrives as a picture when this agent's
model [can see images](/gg/filesystem/#reading-images) and as a description otherwise, on
the same terms as any read. A file that cannot be read (a reference that failed to seed)
is skipped with a warning rather than failing the run — and in the code arm it never
appears in the synthesized program either. The reads run first and the program is written
from what actually succeeded, because a program listing a call whose view never arrived
would teach the model something worse than a missing spec: that `view.openFile` sometimes
silently does nothing.

The specs are read **whole**, regardless of the run's `read_file`
[line cap](/gg/filesystem/#read-modes): the point of the capability is the *full*
specification, not a capped first window of it. The line cap still governs the reads the
model makes itself.

Because the injected material is ordinary file views, it shows up in the
[context breakdown](/gg/context-visibility/) under the same **file** band a manual read
would, and — unless locked, below — it is charged, summarized, and evictable exactly like
one.

## Locked

The capability's one lever is **locked**, its `implementation`:

- **Not locked** *(default)* — the autoloaded specs are ordinary, ephemeral file reads.
  They are summarized away when the thread is [compacted](/gg/compaction/) and can be
  dropped by [agent-managed context](/gg/agent-managed-context/)'s `evict_file_view`, just
  as a spec the model read itself would be. If it needs a detail again later, it re-reads
  the file.
- **Locked** (`locked`) — the autoloaded specs are **pinned** into the window. They are
  kept verbatim across every compaction boundary (a reference image kept as a picture, not
  degraded to its caption) and are spared even by a blanket eviction — including a
  [`view.close`](/gg/responses-as-code/#showing-yourself-things) naming the path, and they
  are left out of `view.current()` for the same reason: offering an agent a close that
  would reclaim nothing is worse than not offering it. The full brief is guaranteed present
  for the whole session.

What either arm pins or leaves ephemeral is the **file views**. The synthesized assistant
turn that opened them — the `read_file` call, or the program — is always ephemeral: it is
there to make the reads attributable, not to be part of the brief.

Locking trades window space for certainty: a large specification held pinned is context
the working thread cannot reclaim, which on a long run is context [compaction](/gg/compaction/)
cannot buy back — so the two arms are a real study, not just a preference. The prompt tells
the model which arm it is in, so a locked run knows it can always rely on the spec being
present and an unlocked one knows to re-read rather than trust its memory.
