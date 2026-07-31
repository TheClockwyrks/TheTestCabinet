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

## The catalog is shared; what has been read is not

Skills are a [module](/gg/modules/) in two halves, because the two halves mean different
things. The **catalog** is authored ahead of the run and never changes, so every agent
reads the one copy. The **read set** — which skill bodies are pinned in the window — is a
statement about *that agent's window*, so it travels with the window it describes: a
[`fork`](/gg/fork-and-exec/) copies it along with the conversation it refers to, and a
[transfer](/gg/modules/#transfer) carries it to the successor that inherited that
conversation. A read set that outlived its window would promise a retained body the window
no longer holds.

Skills are also the one module where [ownership](/gg/modules/#ownership) removes something
from the *prompt* rather than from the window: the up-front listing of descriptions is the
module's state, so an **unowned** skills module has no menu at all. `read_skill` still reads
any skill by name — which makes "the agent knows the catalog exists but must be told a name"
an arm a study can actually run.
