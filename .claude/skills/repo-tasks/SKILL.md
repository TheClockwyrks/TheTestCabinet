---
description: Required reading when modifying this repository's tasks/ folder.
name: repo-tasks
---

# Repo Tasks Policies

## Overview

This repo's `tasks/` folder is used as an issues board for work tracking. Follow
all policies documented here when filing new issues or working with existing
issues. Several of these rules are the same as those that apply to the repo's
documentation.

## Policies

### All Issues Must Be Sorted

All issues must be placed into subfolders within `tasks/`. Do not place any in
the folder itself. Use a `backlog/` folder for any miscellaneous items that
don't make sense to place in other categories.

### Completed Issues

Once an issue has been completed, it should be moved into a `done/` folder in
the same subfolder it's already in. This makes it easy to check what issues have
and have not been completed without needing to inspect file contents.

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
so that only accurate information exists in issue files.

### No "Narrative" Issues

Issues must be concise, authoritative, and appropriately detailed. Fluff that
wastes the reader's time and contributes nothing of value has no place in an
issue file.

### No Walls of Text

Issues must be optimized for the reader. This means being concise, clear, and
organized. A gigantic paragraph that fills the screen with text without breaking
the text up into organized paragraphs fails to follow these principles and is
more likely to be outright skipped or skimmed over by readers, defeating the
point of issues.

Aim to keep paragraphs as 3-5 sentences on average and no more than 8.
