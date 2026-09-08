---
description: Required reading when writing system prompts for gg's responses-as-code agents.
name: agent-prompts
---

# RaC Agent Prompts

## Overview

All policies listed in this documentation apply to system prompts passed to gg's
responses-as-code agents.

## Policies

### Actionable Items Only

When writing error messages, never include information that an agent can't act
on. Extra context or information that an agent can't do anything about is a
waste of tokens.

### Critical Emphasis Only

Bold, italics, and fully-capitalized words should be reserved for only the most
critical of words or phrases. Overuse of bold/italics/capitalization inflates
token counts unnecessarily while simultaneously making it less obvious what's
actually important, defeating the entire point of using emphasis on critical
text.

### Just-in-Time Delivery

If information is only relevant in specific scenarios _and_ said scenarios are
detectable, do **NOT** provide that information up front. Information should
**ONLY** be specified if it is legitimately needed ahead of time.

For example, text views have a maximum size. This size is not normally an issue
for most views, so it must **NOT** be written into system prompts. If a view
exceeding the size limit is created, gg can generate an error and specify
the size limit then. An agent that needs the information sees it when it's
needed, while agents that never attempt to open a large view never see the
message.

### Need to Know

Always provide information on a need-to-know basis. If an agent has no way to
interact with other agents and can't interfere or be interfered with by other
agents, then there's zero reason for the agent to know if there are other agents
active.

### Never Enumerate Failure Conditions

Do not attempt to enumerate failure conditions.

Prompts must always be written around what to do, **NEVER** what not to do.
"What to do" is a finite set. "What not to do" is an infinite set. Common
failure modes must also not be enumerated as common failure modes differ by
model.

### No Narrative Writing

System prompts are read by models, not humans. There is zero reason to write
flowing, narrative prose. Keep instructions concise, to the point, and
appropriately detailed.

### Use Handlebars Conditionals

**NEVER** write information like "If X, then ..." if the condition is something
that can be determined by gg. Handlebars conditionals must be used to
only include the branch that's actually relevant.
