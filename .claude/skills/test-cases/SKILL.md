---
description: Defines policies for The Test Cabinet's model-facing test cases.
name: test-cases
---

# Test Case Policies

## Overview

These policies apply to all files written for a test case. This includes user
facing descriptions/documentation and in model-facing specs.

## Policies

### Authoritative Specs

Any behavior that validators will check must be authoritatively stated in the
specs. **NEVER** leave validated mechanisms open to the model to decide on its
own as this results in flaky validators.

### No Cross Links

Do not link between specs. Models are expected to read all specs, so the full
data is expected to be in the model's context. Cross-linking therefore has no
benefit.

### Critical Emphasis Only

Bold, italics, and fully-capitalized words should be reserved for only the most
critical of words or phrases. Overuse of bold/italics/capitalization wastes
tokens while simultaneously making it less obvious what's actually important,
defeating the entire point of using emphasis on critical text.

### Logical Units Only

Do not specify gameplay values in px/s. Always specify values in terms of the
logical units that the playfield uses.

### No Historical Information

Models only see the specs and do not operate within The Test Cabinet's
repository, so any historical data in the specs is useless noise.

### Minimize Interjections

Write specs in the same style as the repo documentation. Do not write sentences
should be using patterns like the following:

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
Avoid these patterns entirely.

### Minimize Negatives

Specs should state what designs should do and minimize mentions of what an
implementation should *not* do. Proper authoritative specs rule out illegal
implementations by virtue of specifying the exact properties that a compliant
implementation must contain, not by attempting to enumerate all possible ways
an implementation could be non-compliant.

### No "Narrative" Documentation

Specs must be concise, authoritative, and appropriately detailed. The specs are
written for the implementer, not the player. There is absolutely zero reason to
explain the rationale behind elements in the spec. The implementer is there to
implement the specs exactly as described, not to form their own opinion about
why the spec is written the way it's written.

### No Walls of Text

Keep paragraphs as 3-5 sentences on average and no more than 8.

### No Opinionated Validators

Validators must have a clear yes/no answer that a reviewer can answer with no
ambiguity. Validators like "Is X particle effect larger than Y?" cannot be
answered by a reviewer, especially if the two effects are not guaranteed to
occur at the same time.

### Spec Layout

Write specs such that they're well organized for the target test case. Do not
use a suboptimal layout simply because another test case's specs used the
layout.
