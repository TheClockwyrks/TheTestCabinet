---
description: Defines policies that apply when modifying this repository's Astro Starlight docs.
name: documentation
---

# Documentation Policies

## Overview

This repository follows a documentation-first approach. The repo documentation
documents the intent behind designs and any key implementation specifics. The
documentation is authoritative over the code, not the other way around.

Documentation that fails to follow these rules should be edited immediately
regardless of what work is in-flight. The fixes should be committed in its own
commit prior to making edits for the in-flight work.

## Policies

### Authoritative Documentation

The Test Cabinet documentation is a declarative version of the source code. It
must identify the key aspects of the code that must exist and omit any details
that are insignificant. Any detail left out of the documentation is an
implementation detail and may be written as the implementation sees fit. Only
elements that must be implemented in a specific manner should be present in the
documentation.

### Critical Cross-Linking Only

Do not add a cross-link simply because a word matches another page or header.
Insert a cross-link if and only if the reader would frequently want to
immediately follow the link, such as when explicitly stating that the reader
should see another page.

### Critical Emphasis Only

Bold, italics, and fully-capitalized words should be reserved for only the most
critical of words or phrases. Overuse of bold/italics/capitalization reduces
readability while simultaneously making it less obvious what's actually
important, defeating the entire point of using emphasis on critical text.

### Minimize Historical Information

If a developer needs to know historical information about a design, they should
look through the git history. **NEVER** write sentences like the following:

```
Eleven are registered, and between them they separate four things that used to
be one.
```

The documentation should **ALWAYS** record what the implementation is required
to implement now, not what it used to implement.

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

Documentation should state what designs should do and minimize mentions of what
a design should *not* do. Specifying what a design should do has an exact
target. Specifying what a design should not do is attempting to enumerate
elements of an infinite set.

### No Implementation Status Notes

Documentation is written and then immediately implemented. **NEVER** write
phrases like "The design is specified in full on these pages and awaiting its
implementation". All documentation should be written as though the documented
design were already implemented.

### No "Narrative" Documentation

Documentation must be concise, authoritative, and appropriately detailed.
The second paragraph in following example throws in unnecessary fluff that
wastes the reader's time and contributes nothing of value:

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

### No Walls of Text

Documentation must be optimized for the reader. This means being concise, clear,
and organized. A gigantic paragraph that fills the screen with text without
breaking the text up into organized pargraphs fails to follow these principles
and is more likely to be outright skipped or skimmed over by readers, defeating
the point of documentation.

Aim to keep paragraphs as 3-5 sentences on average and no more than 8.
