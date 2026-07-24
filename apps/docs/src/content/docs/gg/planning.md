---
title: "Planning"
---

A **read-only planning pass** followed by a **fresh-context implementation pass**:

1. Put an agent into **read-only mode** (it can explore and read but not mutate the
   workspace).
2. Have it produce a **plan**.
3. **Clear the context**, then hand the agent the **original prompt plus the plan**
   and let it implement from a clean context window.

The value is that implementation starts from a compact, deliberate plan rather than
from a context window already cluttered with exploration. Planning is a strong
candidate for offering a **different planning tool** — different planning prompts
and structures are exactly the kind of thing gg exists to compare.

Planning is available two ways. It can be driven as an [FSM](/gg/fsms/) — the two
states being "plan (read-only)" → "implement (fresh context)". It must **also** be
reachable as a **tool**: an agent that started *not* in plan mode can decide,
mid-session, to **enter plan mode**. So planning is both a predetermined process an
agent is driven through and an action an agent can elect.
