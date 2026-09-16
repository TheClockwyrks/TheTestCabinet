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

All issues must be in one of three folders:

- An epic's folder
  - Issues directly under an epic's folder are referred to as "open" issues and
    are ones that are ready to be implemented. Open issues may depend on other
    open issues but may not require user input prior to beginning implementation
    work.
- The `done/` folder within an epic
  - File in this folder are for historical context while working through a set
    of issues and are periodically pruned. Do **NOT** use completed issues for
    recording important information.
- The `blocked/` folder within an epic
  - This is used exclusively for issues that need user input to resolve some
    blocking issue. All open questions requiring clarification must be grouped
    together within the issue in one location rather than being spread across
    the file.

## Policies

### All Issues Must Be Sorted

All issues must be placed into subfolders within `tasks/`. Do not place any in
the folder itself. Use a `backlog/` folder for any miscellaneous items that
don't make sense to place in other categories.

### Completed Issues

Once an issue has been completed, it should be moved into a `done/` folder in
the same subfolder it's already in. This makes it easy to check what issues have
and have not been completed without needing to inspect file contents.

Move it with `git mv`. Once it is there the file is immutable: never edit a
completed issue, including to keep its cross-links or details current. There are
too many of them for that upkeep to be worth anything, and nothing may depend on
what they say. A `PreToolUse` hook denies the write. To reopen an issue, move it
back out of `done/` first, then edit it where it lands.

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

The filename is the kebab-case slug of the title, so that issue lives at
`verify-rendered-security-headers-in-a-browser.md`: lowercase ASCII letters and
digits, words joined by single hyphens, punctuation dropped, ending in `.md`.

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
input to resolve a blocking question, it must be placed under a `blocked/`
folder.

### No Walls of Text

Issues must be optimized for the reader. This means being concise, clear, and
organized. A gigantic paragraph that fills the screen with text without breaking
the text up into organized paragraphs fails to follow these principles and is
more likely to be outright skipped or skimmed over by readers, defeating the
point of issues.

Aim to keep paragraphs as 3-5 sentences on average and no more than 8.
