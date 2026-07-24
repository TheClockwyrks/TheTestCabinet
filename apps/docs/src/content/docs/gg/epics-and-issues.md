---
title: "Epics & issues"
---

An expansion of the [tasks](/gg/tasks/) capability into something substantial
enough to organize a large build.

- **Epics** group related issues together for organization.
- **Issues** are heavier than tasks. Instead of just a title and description, an
  issue has structured sections: **title**, **description**, **in-scope**,
  **out-of-scope**, and **completion criteria**. The explicit scope boundaries and
  completion criteria are what make an issue safe to hand to a subagent — they tell
  the subagent exactly what it is and is not responsible for, and how it will be
  judged done.
- Issues can be **blocked by** other issues (the same acyclic blocked-by relation
  as tasks).
- An issue can be **dispatched to a [subagent](/gg/subagents/)** to implement — the
  issue's structured fields become the subagent's brief.

The epic/issue board is retained across [compaction](/gg/compaction/) like the task
list, and it is a primary thing the [telemetry](/gg/telemetry/) capability streams
to the console. Before an issue is accepted, a [Code Review](/gg/code-reviews/) can
be required to gate it.
