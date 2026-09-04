---
description: Policies that apply to documentation for gg SDK functions and types.
name: gg-sdk-documentation
---

# gg SDK Documentaiton

## Overview

All policies listed in this documentation apply to documentation written for
gg's responses-as-code SDKs. Policies apply across all languages and to all
documentation that may be displayed to agents.

## Policies

### Actionable Items Only

When writing documentation, never include information that an agent can't act
on. Extra context or information that an agent can't do anything about is a
waste of tokens.

### Critical Emphasis Only

Bold, italics, and fully-capitalized words should be reserved for only the most
critical of words or phrases. Overuse of bold/italics/capitalization inflates
token counts unnecessarily while simultaneously making it less obvious what's
actually important, defeating the entire point of using emphasis on critical
text.

### Minimize Advice

Documentation should not be opinionated. Explain what a function does or what
a field gets set to. There should be minimal or no explanations of how to use
the functions/types. That information should be clear from explaining what the
function/type is, not by words in the documentation.

### Minimize References to Other Symbols

Avoid referencing other functions/types in documentation. This is because
documentation is static, but whether the functions/types are usable is dynamic
based on what capabilities are enabled for an agent. Unless a function/type is
guaranteed to always be part of the same capability set, avoid referencing the
symbol directly since it may not be usable by the agent.

### Need to Know

Always provide information on a need-to-know basis. If an agent has no way to
interact with other agents and can't interfere or be interfered with by other
agents, then there's zero reason for the agent to know if there are other agents
active.

### No Narrative Writing

SDK documentation is used by models, not humans. There is zero reason to write
flowing, narrative prose. Keep documentation concise, to the point, and
appropriately detailed.

### No References to Agents

Do not ever write documentation that refers to "the agent". For example:

```
Read a file and show it to the agent, handing the program the same value
`gg.files.readFile` does.
```

The SDK is only ever used by agents. The above should have been written as:

```
Opens a view into the file.
```
