---
description: Required reading when filing, editing or closing an issue of this repository.
name: repo-tasks
---

<!-- cspell:words nyxsis -->

# Repo Tasks Policies

## Overview

This repository's issues are filed, started, blocked, released and closed
through the issues server's MCP tools, `nyxsis-issues`. Follow all policies
documented here when filing new issues or working with existing issues.
Several of these rules are the same as those that apply to the repo's
documentation.

The server assigns each issue its id, its file under `.nyxsis/issues/` and its
label, and the file's frontmatter holds its state, so no issue is moved
between folders or renamed. An issue's state is one of the following:

- `open`
  - Ready to be implemented. Open issues may depend on other open issues but
    may not require user input prior to beginning implementation work.
- `done`
  - Closed with the `close` tool, carrying its outcome. A done issue is history.
    Do **NOT** use completed issues for recording important information.
- `blocked`
  - Blocked with the `block` tool, carrying a reason that states what the user
    must decide or provide, and set open again with the `release` tool. This is
    used exclusively for issues that need user input to resolve some blocking
    issue.

## Policies

### File the Design With the Issue

An issue records the work needed to align the code with the design, so the
design is edited in the same commit as the filing. That commit carries the
issue file the server wrote, since the server leaves committing it to the
session that filed it.

### Critical Cross-Linking Only

Insert a cross-link if and only if the reader would frequently want to
immediately follow the link, such as when explicitly stating that the reader
should see another page.

### Critical Emphasis Only

Bold, italics, and fully-capitalized words should be reserved for only the most
critical of words or phrases. Overuse of bold/italics/capitalization reduces
readability while simultaneously making it less obvious what's actually
important, defeating the entire point of using emphasis on critical text.

### Do Not Record Counts

Never write a count of issues to any file. A count in plain text can easily
drift and become inaccurate, which is worse than not having it in the first
place.

### Imperative Titles

An issue title is a verb phrase naming the work to do, in the style a git commit
subject uses: a base-form verb first, sentence case, no trailing period, and
under about 70 characters while keeping the nouns that make it distinctive.
Where a title would state an end state, name the action that reaches it, and
prefer a specific verb over "fix", "update" or "ensure".

```
BAD:  The rendered security headers are verified in a browser
GOOD: Verify rendered security headers in a browser
```

### Minimize Interjections

Very few sentences should be using patterns like the following:

```
An alternative to traditional tool calling: an agent answers a turn by writing a
whole program over its tools, which gg executes in a wasmtime sandbox — instead
of emitting one tool call, waiting for its result, and emitting the next. Loops,
conditionals, filtering, intermediate values and a dozen composed calls all
happen inside a single turn. What comes back is the views the program opened —
which are how anything a program computed reaches the model at all — and, when
something failed, the error and nothing else.
```

These fall into two categories - mid-sentence interjections ("foo bar - lorem
ipsum - baz") and end-of-sentence interjections ("lorem ipsum - foo bar baz").
Each interjection acts as an "interruption" to the flow of the paragraph and
disrupts the reader. This must be minimized as much as possible. The above
example uses this unwanted pattern in two of the three sentences, which is far
excessive.

### Minimize Negatives

Issues should state what designs should do and minimize mentions of what a
design should *not* do. Specifying what a design should do has an exact target.
Specifying what a design should not do is attempting to enumerate elements of an
infinite set.

### No Design Issues

All design changes are strictly required to be handled as part of filing issues.
**NEVER** file an issue that expects the implementer to change documentation.
The expectation is that the documentation **always** reflects what the code
should be written as, and issues record the work needed to align the code with
the documentation.

### No Historical Information

If a developer needs to know historical information about an issue, they should
look through the git history. **NEVER** write sentences like the following:

```
This issue used to specify that ...
```

```
Section 3 is superseded by ...
```

Issues may list different designs that were considered and not selected, but
must **NEVER** contain factual inaccuracies that were corrected or references to
material that has been removed from the issue. Correct inaccuracies immediately
with the `update` tool so that only accurate information exists in issues.

### No "Narrative" Issues

Issues must be concise, authoritative, and appropriately detailed. The second
paragraph in following example throws in unnecessary fluff that wastes the
reader's time and contributes nothing of value:

```
## Why the language is an axis at all

The capability itself exists to answer one A/B question: do code-shaped
responses help a model tackle the large Hard cases? Freeze the model, the test
case and the rest of the capability set, vary the one toggle, and the difference
is attributable to the shape of the response.

The moment that question is worth asking, a second one follows it: does the
language a model writes its program in change how well it works? It is not an
idle question. The arms differ in how much of the language was in the model's
training data and how recently its idioms moved; in how much a model has to
write before it has said anything, and in what those tokens buy — a type
annotation costs tokens and buys a checked program; in what a model's reflexes
cost it — `await` is the first thing many models reach for in JavaScript, and
the sandbox is synchronous, so the reflex costs the turn a refusal; in how a
language handles a failure, and therefore how naturally a program written in it
composes calls that can throw.
```

The above should be written as follows:

```
## Multiple Languages

gg supports multiple languages to determine if there are meaningful differences
in model effectiveness when using responses as code. If a model performs
noticeably better when using Python instead of JavaScript, a harness that forces
the model to use JavaScript is handicapping the model for no reason.

Supporting multiple languages also allows gg to check several other factors.
Some languages are more verbose than others; for example, C++ is notoriously
more verbose than Python. If models perform identically in two different
languages but one reduces the total token output from the model by a noticeable
amount, then forcing a model to use the more verbose language increases costs
unnecessarily.
```

### No Open Questions

Open issues are not allowed to contain open questions. If an issue requires user
input to resolve a blocking question, it is blocked with the `block` tool, its
reason stating what the user must decide or provide.

### No Walls of Text

Issues must be optimized for the reader. This means being concise, clear, and
organized. A gigantic paragraph that fills the screen with text without breaking
the text up into organized paragraphs fails to follow these principles and is
more likely to be outright skipped or skimmed over by readers, defeating the
point of issues.

Aim to keep paragraphs as 3-5 sentences on average and no more than 8.

### Reference the Documentation

An issue states what is wrong or missing, links the documentation page under
`apps/docs/src/content/docs/` that describes the intended behaviour, and says
how to verify the fix. The documentation page is what the implementer aligns
the code with, so the link is what lets a reader check the issue against the
design.

The documentation has no numbered requirement tables, so an issue carries no
`## Requirements` section and cites no requirement identifiers.
