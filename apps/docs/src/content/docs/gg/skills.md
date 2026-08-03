---
title: "Skills"
---

Skills are **markdown files with front matter**. At the start of a session, the
model is shown each skill's **description** (from its front matter), so it knows the
skill exists and what it is for.

The one behavioral difference between reading a skill and reading a plain file:

- Reading a skill **strips the front matter** and returns the body, and
- the skill's contents are **automatically retained after compaction** — a skill,
  once read, stays in context across a [compaction](/gg/compaction/) boundary,
  unlike an ordinary file view (which the model may have to re-read, or which
  [agent-managed context](/gg/agent-managed-context/) may evict).

This mirrors the skills mechanism used elsewhere in this repository (the
`.claude/skills/` skills that guide agents working in this repo), reframed as a
capability gg offers the *model under test*. [Memories](/gg/memories/) are the same
mechanism, curated by the model itself.

## The band is shared with documentation views

A read skill lands in the **Documentation** band of the
[context breakdown](/gg/context-visibility/), and it is not alone there: a
[responses-as-code](/gg/responses-as-code/#showing-yourself-things) program that calls
`view.openDocsView` to read a function's signature and documentation puts the result in the
same band. From the window's point of view the two are the same *kind* of thing — authored
material the agent asked to see, rather than the workspace, its own output, or the harness
talking — so they share a band, and the console labels it **Skills & docs**.

What tells them apart is **retention**, not where they came from. A read skill is pinned and
carries no label: it keeps the bare `Documentation` heading, it survives a
[compaction](/gg/compaction/) for the reason above, and `view.current()` does not offer it,
because a close that would reclaim nothing is worse than no close at all. A documentation
view is ephemeral and labelled with the function it documents (`Documentation: openText`), so
it is listed, replaceable, and closable like any other view. `view.close(name)` therefore
reaches a docs view and spares the pinned skill sitting beside it in the same band — the
removal path skips pinned items, so there is no way for a program to close a skill it did not
open.

## The catalog is shared; what has been read is not

Skills are a [module](/gg/modules/) in two halves, because the two halves mean different
things. The **catalog** is authored ahead of the run and never changes, so every agent
reads the one copy. The **read set** — which skill bodies are pinned in the window — is a
statement about *that agent's window*, so it travels with the window it describes: a
[`fork`](/gg/fork-and-exec/) copies it along with the conversation it refers to, and a
[transfer](/gg/modules/#transfer) carries it to the successor that inherited that
conversation. A read set that outlived its window would promise a retained body the window
no longer holds.

[Ownership](/gg/modules/#ownership) is worth a note here because for skills the catalog *is*
the state: an **unowned** skills module has no menu and no section describing one, and
`read_skill` still reads any skill by name — which makes "the agent must be told a name" an
arm a study can actually run.
