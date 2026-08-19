---
title: "Autoload specifications"
---

With the `autoload-specs` capability on, an agent's opening context is seeded
with the full contents of every file the test case provided, its specifications
and its reference images, injected as though the model had already read each for
itself. The whole brief is in the window from the first turn. An agent with the
capability off reads what it needs itself. Its opening context is the
[build prompt](/gg/prompts/) and, in code mode, the
[opening turn](/gg/responses-as-code/views/#the-opening-turn) every fresh window
is seeded with.

It is off by default and per agent. It is one profile's
[capability](/gg/configurations/), listed in the editor's Context group, so a
run can front-load the entire spec for one agent while another reads only what
it needs. Turning it on and off is a clean experiment: does giving the model the
whole specification up front, rather than letting it choose what to read,
produce a better build?

## What is loaded

The files are the ones the test case provided: its specs in the order they were
seeded, followed by its rendered reference images. The Test Cabinet's `core`
computes the list when it seeds the run, since it is the authority on which
seeded files came from the case rather than from a starter-workspace scaffold,
and hands it to gg at launch.

The specs are read whole, regardless of the run's `read_file`
[line cap](/gg/filesystem/#read-modes), because the capability's promise is the
full specification. The line cap still governs the reads the model makes itself.

A text spec arrives as text. A reference mockup arrives as a description of the
file, and as the picture itself when the [`images`](#images) param is on and
this agent's model [can see images](/gg/filesystem/#reading-images).

Every file on that list has to arrive. gg reads them once the run is seeded and
before the first turn, and a file it cannot read ends the run there, naming the
file. A run seeded with part of the brief measures something other than the arm
it was configured as.

Because the injected material is ordinary file views, it appears in the
[context breakdown](/gg/context-visibility/) under the same file band a manual
read would, and unless locked it is charged, summarized, and evictable exactly
like one.

## The synthesized turn

The seeding has to read as a conversation the agent itself could have had, since
the model reads its own transcript as the example of what a well-formed turn
looks like. gg therefore synthesizes the turn that would have produced the
reads, in whichever protocol the agent works in.

In tool-calling mode each file is injected as a matched pair: a synthesized
`read_file` assistant call answered by the file's contents, paired by a call id
so the opening conversation is well-formed exactly as a real read would be.

Under [responses as code](/gg/responses-as-code/overview/) the assistant message
is a program, so gg synthesizes one assistant message whose content is a program
of file-view calls, one per provided file in seeding order, followed by the file
views that program opened:

```ts
import * as gg from "gg";

gg.views.openFile("specs/rules.md");
gg.views.openFile("reference/board.png");
```

The program is a whole program of the agent's own language, on the terms the
[invariants](/gg/responses-as-code/invariants/) set for every program: the line
that reaches gg's surface, then one call per file, and nothing else. A Python
agent is shown Python. Paths are JSON-quoted, so a quote or a backslash in a
path cannot break the parse. The views arrive as headed `File` items keyed by
path, the same envelope a real file-view call produces.

The reads run first, and the program holds one call per file that was read.
Every one of those views is present in the same opening context, since the run
ends on a file gg cannot read. A program listing a call whose view never arrived
would teach the model that opening a file view sometimes does nothing.

## Images

The `images` param decides whether an autoloaded reference mockup is attached as
a picture. It is off by default, so the seeding costs what its text costs.

A picture is charged to the window by its
[dimensions](/gg/filesystem/#what-this-costs-the-context-window), and it is
charged again on every request for as long as it stays in the window. A test
case's mockups are large enough that seeding three of them into the first turn
outweighs the specifications they illustrate. Turning the param on is therefore
a deliberate arm of the study: does the model build a better game for having
seen the target rather than read it?

Off, the mockup still arrives. It is read, it takes its place in the seeded
order, and it enters the window as the same file view with the label, format and
byte size any read produces. The model knows the file exists and reads it with
`read_file` when it wants to look.

The param governs the seeding alone. A read the model makes for itself attaches
the picture on the ordinary terms `read_file` sets.

A model that cannot see images is never sent one, so this agent's model decides
the outcome as much as the param does. gg resolves that in two stages, described
under [models that cannot see images](/gg/filesystem/#models-that-cannot-see-images).
With the param on and the model declared text-only, the mockup arrives as its
description and no request is wasted.

## Locked

The capability's one lever is its `implementation`:

- Unset, the default, leaves the autoloaded specs as ordinary, ephemeral file
  views. They are summarized away when the thread is
  [compacted](/gg/compaction/) and can be dropped by [agent-managed
  context](/gg/agent-managed-context/)'s `gg.context.evictFileView`, just as a
  spec the model read itself would be. If the agent needs a detail again later,
  it re-reads the file.
- `locked` — the autoloaded specs are pinned into the window. They are kept
  verbatim across every compaction boundary, with a reference image kept as a
  picture rather than degraded to its caption, and they survive a blanket
  eviction and a `gg.views.close` naming the path. They are left out of
  `gg.views.current()` for the same reason: an entry whose close reclaims
  nothing is worse than no entry. The full brief is present for the whole
  session.

`locked` is the lever's whole vocabulary. An `implementation` written as anything
else refuses the launch, listed with every other value in the capability set gg
cannot honour exactly as written, so one pass over the configuration fixes them
all.

Either arm applies to the file views. The synthesized assistant turn that opened
them is always ephemeral, since it is there to make the reads attributable
rather than to be part of the brief.

Locking trades window space for certainty. A large specification held pinned is
context the working thread cannot reclaim, which on a long run is context
[compaction](/gg/compaction/) cannot buy back, so the two arms are a real study.
