---
title: "Views"
---

A view is material an agent has declared should be visible to it. Views are the
only route by which anything a program computed reaches the model: a value the
program returns is discarded, and what it logs goes to the run's operator. gg
pushes one message per open view into the next prompt, the counterpart of one
tool result per tool call.

Each agent owns its own set of open views. A view has a kind, a selector that
keys it, and a body. Everything a view carries arrives on the turn after the one
that opened it.

## Kinds of view

| Kind | Selector | [Band](/gg/context-visibility/) |
| --- | --- | --- |
| File | the path and, for a paged read, the line region | `FileView` |
| Text | the label the program gave it | `TextView` |
| Documentation | the name of the function or type it documents | `DocsView` |
| Search | the constant `search results` for an agent's own search, the module path for an opening-turn listing | `SearchResults` |

Everything on disk is a file and everything a program computes is a string, so a
directory listing, a `shell` result, a subagent's answer, a computed diff and an
assembled table are all text views. gg picks the kind from the call the program
made.

An image is a file view of an image file, whose item carries the picture. A view
is the only way a picture reaches a code agent's window.

A search view carries a selector like any other view, and a search the agent
itself ran is keyed under one constant selector, so every such search replaces
the last. The selector is an argument rather than a constant because [the
opening turn](#the-opening-turn) keys one listing per module and each has to
survive the next. `gg.views.current` reports a search view as a text view, which
is what it behaves like at that boundary: composed text under one label, closed
by `gg.views.close`.

## Opening and closing views

| Function | What it does |
| --- | --- |
| `gg.views.openFile(path, options?)` | Reads the file and opens a view of it, returning exactly what `gg.files.readFile` returns for that window. |
| `gg.views.openText(label, body)` | Opens the text view keyed by `label`. |
| `gg.views.openDocsView(target)` | Opens the documentation view for one bound function or type. |
| `gg.views.close(selector)` | Closes every file, text and search view carrying that selector, and returns how many it closed. |
| `gg.views.current()` | Lists what is open: each view's `kind`, `selector`, `tokens`, a paged file view's `region`, and a `close()` member. |

`openText`, `openDocsView`, `close` and `current` are serviced whatever the run's
capability set says, so a run that enables no tools can still show its model
something. `openFile` is gated on `read_file`, because it is a read and the one
call in the family that dispatches a tool.

Closing a selector that names nothing open returns `0`, which is a successful
call. An empty selector handed to `close` is `invalid-argument`, as is an empty
label handed to `openText`. An empty body is allowed: it is how a program says
that something it was showing is now empty.

`gg.views.close` reaches file, text and search views. Documentation views are
closed by `gg.docs.close(key)` and `gg.docs.closeAll()`, which the
`docview-close` capability buys.

## Reads and views

`gg.files.readFile` gets bytes for the program; `gg.views.openFile` shows a file
to the agent. A program that reads forty files to grep them adds nothing to the
window. A program that opens a view of one has put one file in the window,
charged to its path, closable by its path and countable against it.

The split is literal for pictures. `gg.files.readFile` of an image succeeds and
hands the program the descriptor with `shown: false`, plus a sentence naming the
call that shows it. `openFile` performs the identical read, under the same gate,
telemetry pair, session-record entry and read policy, and then pushes the view.
Its `(path, region)` key comes from what the read returned rather than from what
the call asked for.

## Supersession

Re-opening the same selector supersedes the view that was under it: the same
label, or the same file and the same page. `openFile` and `openText` name an
intent, and re-stating an intent replaces it rather than repeating it.

- A copy pushed on an earlier turn has already been sent. It stays where it
  sits, retagged as ordinary history with its selector cleared, and the new copy
  is appended at the tail.
- A copy pushed in this turn is replaced in place.
- A view opened and then closed within one program reaches the window not at
  all.

A retired copy keeps its text and loses its picture, gaining a line that says so
and points at the live view below it. Its token estimate follows the bytes.

The file-view key carries the region so that two pages of one file are two views
that coexist. A whole-file read has no region and so is its own key.
`gg.views.close` works on the path and closes every page of it.

Supersession is the view API's alone. A native `read_file` names an action and
appends a fresh view per read, and that path is untouched by any of this.

A documentation view never supersedes. Re-opening a key that is already open
does nothing at all: not a move, not a re-emit. The documentation band is
therefore append-only for the life of a session, and closing is the only thing
that can disturb it, which is why closing is bought by a capability and opening
is not.

## Caps

| Cap | Value | Bounds |
| --- | --- | --- |
| `MAX_TEXT_VIEW_BYTES` | 65,536 | one `openText` body |
| `MAX_VIEW_LABEL_BYTES` | 200 | one `openText` label |
| `MAX_COMPOSED_VIEW_BYTES_PER_TURN` | 8 MiB | every `openText` body across one turn's programs |
| `IMAGE_ATTACH_CAP` | 8 MiB | one attached picture |

Breaching one of the three text-view caps is a catchable `ToolError` with code
`limit-exceeded` naming the cap, thrown at the call site, and never a
truncation. The program can split the body, trim it, or write it to a file and
open a file view of that, in the same turn, before it has finished running.
`IMAGE_ATTACH_CAP` is not enforced that way: an `openFile` of a picture over it
is a successful read whose result describes the file and says it is too large to
display, and no picture is attached.

Each cap bounds the size of one thing. The number of views an agent holds open
is bounded by its own context window, which the fullness signal in
[agent-managed context](/gg/agent-managed-context/) reports per band and per
file. `MAX_COMPOSED_VIEW_BYTES_PER_TURN` is a host-robustness bound charged per
turn, so a hand-over chain and an on-use script share one budget.

## Documentation search

`gg.docs.search(query, options?)` is the route into the documentation, and it is
global: one query reaches every module at once. It returns `{ total, offset,
hits }`, each hit carrying `key`, `kind`, `module`, `name` and `summary`, and it
opens the search-results view of the same page. The filters `module`, `type`,
`kind`, `offset` and `limit` compose with the query and with each other, and an
empty query with a `module` filter is that module's whole directory. A page is
20 hits by default and 100 at most.

A blank query carrying no filter, an unrecognised `kind` and a `limit` of zero
are each `invalid-argument`. A refusal opens no view.

The host filters every hit through the same predicate that decides what the
agent may call, so a search returns only calls its caller can make. Searching is
serviced whatever the capability set says.

A hit's `key` is the fully-qualified name, `gg.<module>.<name>`. That is the key
documentation is filed under and the key `openDocsView` takes.

## Documentation views

`gg.views.openDocsView(target)` opens one entry's documentation. Pass the bound
function itself, as in `gg.views.openDocsView(gg.files.readFile)`, or its name
as a string. Both the fully-qualified name and the bare name resolve, and
identity is canonicalized to the fully-qualified name before the view is filed,
so spelling one lookup both ways places the page once.

A function's view is every shape the function may be called in, with a line per
argument giving its name, type, default where the language states one, and
description, followed by the function's own description. An argument the
language passes by name rather than by position is marked `(passed by name)`.

A type is a view of its own, addressed by the type's name, and it ends with a
line per member function: the member's fully-qualified name and its one-line
brief, for the members this agent binds. A type is readable when some function
this agent binds refers to it. A key that resolves to nothing this agent binds
is `not-found` and places nothing, including none of the types.

One open places types one level deep, from the names the function's own
signature writes down. Which of them it places is the agent's `docViewTypes`
setting: `return` (the default), `return-and-parameters` or `off`. Re-opening a
function whose view is already open still places any of its types that are not.

An argument that is neither a bound function nor a name is refused in the guest,
before the lookup. `undefined` and `null` answer that no documentation was
found, and any other type is named for what it is. An unknown name is
`not-found` carrying at most three of the nearest bound names on an indented
second line.

```text
Runtime error
----
`openDocsView` failed (not-found): no documentation for `write`
  Did you mean `writeFile` or `writeMemory`?
```

The candidates are the names this agent binds. Matching is tiered by gg tool
name, then stem, then typo, and only the best tier is offered. A miss with no
bound name near it carries no suggestion at all, because a wrong name sends the
model to read documentation for a function it did not want.

## The opening turn

The system prompt names the capability modules and names no function, so a fresh
code-mode window is seeded with one program written in that agent's own
language, which gg then runs. Its source is pushed as the assistant message and
the views the window opens on are the ones its own calls placed, so the model's
first example of a well-formed reply is a program that provably ran.

The program makes two kinds of call. It searches each capability module the
agent was granted, as an exact whole-module lookup, which leaves one search view
per module listing every function that module offers with its one-line brief.
It also opens the documentation of `gg.docs.search` and
`gg.views.openDocsView`, the two calls discovery itself is made of. Between them
the agent opens knowing every function it may call and how to read any of them
in full.

Each module's listing is its own view, keyed under that module's own path, so
one listing supersedes only a re-listing of the same module. The agent's own
searches keep the single results selector and keep superseding each other.

The program runs against the agent's real capability grants and sandbox limits,
with no deadline and no code modules, and it is prepared through a cache keyed
by language and source so a run with a dozen agents compiles it once. It is not
an agent turn: it consumes no turn index, no usage and no cost, records no
program-library entry, and emits no turn or execution event.

Seeding happens once, on a fresh window, immediately after the build prompt and
before every other opening step. A window carried across an `exec` succession or
a history-keeping `fork` is not re-seeded.

A failure to run it is gg's, not the model's. A program that fails to prepare,
a sandbox error, an execution the program itself reports as failed, a refused
call, or a run that places no view at all ends the agent as an internal error:
the fault latch is raised, the detail goes to the operator's `error` stream, and
the run stops rather than opening a window the prompt describes and the session
does not have.
