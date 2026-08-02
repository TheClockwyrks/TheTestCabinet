---
title: "Autoload specifications"
---

An agent normally opens with just the [build prompt](/gg/prompts/) and has to discover
and [read](/gg/filesystem/) the test case's specification for itself. With
**autoload-specifications** on, gg does that reading up front: an agent's very first
context is seeded with the **full contents of every file the test case provided** — its
specification and its reference images — injected as though the model had already
`read_file`d each. The whole brief is in the window from the first turn.

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

Each file is injected as a matched pair — a synthesized `read_file` assistant call
answered by the file's contents — so the opening conversation reads exactly as it would
had the model made those reads itself. A text spec arrives as text; a reference mockup
arrives as a picture when this agent's model [can see images](/gg/filesystem/#reading-images)
and as a description otherwise, on the same terms as any read. A file that cannot be read
(a reference that failed to seed) is skipped with a warning rather than failing the run.

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

Locking trades window space for certainty: a large specification held pinned is context
the working thread cannot reclaim, which on a long run is context [compaction](/gg/compaction/)
cannot buy back — so the two arms are a real study, not just a preference. The prompt tells
the model which arm it is in, so a locked run knows it can always rely on the spec being
present and an unlocked one knows to re-read rather than trust its memory.
