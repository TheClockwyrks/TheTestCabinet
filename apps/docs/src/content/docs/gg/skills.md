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
