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

A file view arrives headed by its path and the 1-based inclusive line range it
shows, `File: src/main.ts:100-250` for a paged read and `File: specs/rules.md:1-N`
for a whole file, where `N` is the file's total line count. The range is what
the read returned rather than what the call asked for, and the path is the one
the view was opened under, relative to the workspace. A view that shows no
lines, an image or an empty file, is headed by the path alone. The body is the
file's text and nothing else.

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
| `gg.views.openFile(path, options?)` | Reads the file and opens a view of it, returning exactly what `gg.files.readFile` returns for that window. `options` adds `maxLineChars` to the read's own; see [caps](#caps). |
| `gg.views.openText(label, body)` | Opens the text view keyed by `label`. |
| `gg.views.openDocsView(target)` | Opens the documentation view for one bound function or type. |
| `gg.views.close(selector)` | Closes every file, text and search view carrying that selector, and returns how many it closed. |
| `gg.views.current()` | Lists what is open: each view's `kind`, `selector`, `tokens`, a paged file view's `region`, and a `close()` member. |

`openText` and `openDocsView` are serviced whatever the run's capability set
says, so a run that enables no tools can still show its model something.
`openFile` is gated on `read-file`, because it is a read and the one call in the
family that dispatches a tool. `close` and `current` — and the `close()` member
of the view `current` lists — are bought by
[`agent-managed-context`](/gg/agent-managed-context/), because closing a view and
listing what is open are context management. A program without it compiles
against the same SDK as every other, and the call is refused by the membrane with
the `unavailable` error every withheld call raises.

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

A documentation view supersedes only when its text has changed. Re-opening a key
under the body already open does nothing at all: not a move, not a re-emit. An
SDK entry's body is a projection of a catalogue compiled into the binary, so it
renders the same bytes every time and re-opening one is always that no-op.

A loaded module's page is the one that can change under a fixed key, since the
model writes the code a skill or a memory carries. Using a revised module
re-opens each of its pages, and a page whose text has changed replaces the copy
that was open, on the three rules above. Every other page in the band stays where
it sits.

The band is therefore append-only for as long as an agent's loaded code stands,
and the prompt prefix ahead of the earliest replaced page survives whatever else
the agent opens. Closing is bought by a capability and opening is not, because
closing is what takes back a page the agent still holds.

## Caps

| Cap | Value | Bounds |
| --- | --- | --- |
| `MAX_TEXT_VIEW_BYTES` | 65,536 | one `openText` body; one file view's text body |
| `MAX_VIEW_LABEL_BYTES` | 200 | one `openText` label |
| `MAX_COMPOSED_VIEW_BYTES_PER_TURN` | 8 MiB | every `openText` body across one turn's programs |
| `IMAGE_ATTACH_CAP` | 8 MiB | one attached picture |

Breaching one of the three text-view caps is a catchable `ApiError` with code
`limit-exceeded` stating the offending size and the bound (and, for the turn
budget, what remains of it), thrown at the call site, and never a truncation.
The program can split the body, trim it, or write it to a file and open a
windowed file view of that, in the same turn, before it has finished running.

A file view's text body is held to `MAX_TEXT_VIEW_BYTES` on the same terms: an
`openFile` whose window would carry more than the cap is refused with the size
and the bound, and the program narrows the window with `offset` and `limit`, or
cuts the file's long lines with `maxLineChars`, in the same turn. `openFile`
takes `maxLineChars` beside the read's own options. When it is set, each line of
the view longer than that count is cut at it and annotated in place with how
many characters were cut, as `foo (123 more chars...)`; left out, lines arrive
whole, and a value of zero or one over `MAX_TEXT_VIEW_BYTES` is
`invalid-argument`. The truncation is the view's alone, so what `gg.files.readFile`
returns — and what `openFile` itself returns — and the file itself are untouched,
and the byte cap is measured against the body after it, which is what lets a
window over a log of enormous lines fit. A picture's view is not a text body and
is bounded by `IMAGE_ATTACH_CAP` alone.

`IMAGE_ATTACH_CAP` is not enforced that way: an `openFile` of a picture over it
is a successful read whose result describes the file and says it is too large to
display, and no picture is attached.

Each cap bounds the size of one thing. The number of views an agent holds open
is bounded by its own context window, which the fullness signal in
[agent-managed context](/gg/agent-managed-context/) reports per band and per
file. `MAX_COMPOSED_VIEW_BYTES_PER_TURN` is a host-robustness bound charged per
turn, so a hand-over chain and an on-use script share one budget.

## Documentation search

`gg.docs.search` is the route into the documentation, and it is global: one
query reaches every module at once. Every argument is optional and every one of
them lives in the call's optional section, so a search is written as a query, as
a set of filters, or as both. It returns `{ total, offset, hits }`, each hit
carrying `key`, `kind`, `module`, `name` and `summary`, and it opens the
search-results view of the same page. A page is 20 hits by default and 100 at
most.

The filters `modules`, `type`, `kind`, `offset` and `limit` compose with the
query and with each other. `modules` takes a list and is a lookup rather than a
ranking: each entry names one module either by gg's own id or by the arm's
spelling of the path, matching is exact and case-insensitive, and naming several
returns the entries of any of them. A `modules` filter carrying no query is
those modules' whole directory.

A hit's `summary` is the entry's brief and stops there. The detail, the
signatures, the types and the import line are what opening a documentation view
of the hit is for, so a page of twenty hits costs a line apiece.

Three kinds of entry are searchable: `module`, `function` and `type`. A module is
whatever the arm's language makes importable, which is a namespace in C++ and a
module in PureScript. Every one of the three can be opened as a documentation
view, so a name a model can find is a name it can read in full.

A hit reports the one module the entry belongs to: for a function the module
that publishes it, and for a type the module that declares it. That is a value
the `modules` filter accepts, so the module a hit names and the module a filter
would have found it under are the same answer.

A type is an entry when a function's own signature writes its name. A type
reached only through another type's members sits a level below any signature the
model reads, and the failure class a call declares it throws is documentation
about that call rather than an entry to look up, so neither is a hit. A call's
failure class arrives beside the call's own documentation view.

A query matches an entry's name, its signature, its brief and the detail beneath
it. Every argument's name counts as signature text and every argument's own
description counts as detail, on every language, so a search for an argument
finds the call that takes it whatever the language's declaration syntax writes
down. Hits are ranked by which of those matched, name first and detail last.

A search carrying neither a query nor a filter, an unrecognised `kind` and a
`limit` of zero are each `invalid-argument`. A refusal opens no view.

The host filters every hit through the same predicate that decides what the
agent may call, so a search returns only calls its caller can make. Searching is
serviced whatever the capability set says.

A hit's `key` is the fully-qualified name, `gg.<module>.<name>`. That is the key
documentation is filed under and the key `openDocsView` takes.

The view the page opens as states what was asked for and how much of the answer
it holds, then the hits themselves under a `Modules:`, `Functions:` and `Types:`
heading apiece, in that order and in rank order within each. A heading is
written only when hits of that kind are on the page, so the kind is stated once
per group rather than once per hit.

The surface a query reaches includes the code modules that agent loaded. A
loaded module's key is a module entry and every declaration it exports is an
entry of its own, keyed by the loaded key and the declaration's name, so one
query finds an author's helper and gg's own functions together.

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

Every view states where the symbol is defined and how a program reaches it, on
its own line under the signature or the declaration. The module is named by this
language's own path for it, and the line a program writes to bring the symbol
into scope is quoted verbatim. Every module of every arm states one, since an
import is the only route in and a view that quoted none would describe a surface
no program could call.

A type is a view of its own, addressed by the type's name, and it ends with a
line per member function: the member's fully-qualified name and its one-line
brief, for the members this agent binds. A type is readable when some function
this agent binds refers to it. A key that resolves to nothing this agent binds
is `not-found` and places nothing, including none of the types.

A module is a view of its own too, addressed by the module's own path. It
carries the module's brief and detail, the same answer about reaching it, and a
line per function in it this agent binds, each with its own brief. A
module every function of which this run withheld is `not-found`, on the rule a
type is gated by: what a model can read describes a surface it can use.

One open places types one level deep. Which of them it places is the agent's
`docViewTypes` flags, each independent of the others: `return` places the types
the signature writes in the return position, `parameters` the types of its
arguments, and `errors` the error types the function's own documentation comment
declares. Whichever flags are set,
exactly one level is opened, and a type view opens no further type view.

Re-opening a function whose view is already open still places any of its types
that are not.

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

A loaded module opens the same way. Using a code [skill](/gg/skills/) or memory
opens one documentation view per function the module declares, together with the
type views that agent's `docViewTypes` flags place beside each, and the use
itself adds no message. A function's view carries its declaration, its
documentation, and the line a program writes to reach it, as an SDK function's
does.

A type a loaded declaration names is looked for in the module itself first and in
gg's own catalogue second, so a module's own `Row` opens rather than gg's and
another module's `Row` is never reached for. The flags select the same types
whether a use placed the page or the agent opened it by key itself.

Those views belong to the instance that loaded the module. An instance that
starts with nothing loaded holds none of them, and using the skill again opens
them. Once open they are ordinary documentation views, opened by key with
`gg.views.openDocsView` and closed with `gg.docs.close`.

## Undocumented calls

A documentation view a program opens arrives in the window on the turn after the
program that opened it, so the system prompt states the discipline that follows:
open a documentation view of each function you intend to call, and write the call
on a later turn. A model that calls a function it never opened a view of is
writing that signature from memory, which is the one thing this surface cannot
tolerate.

gg detects it at the same bracket that decides whether an agent was granted a
call. For every call it lets through, it asks whether a documentation view of
that call stood in the agent's window before the turn began, and records the call
when none did. The call is then serviced exactly as it would be otherwise, since
this is a measurement rather than a gate. It is not a turn error, so the
[error ceilings](/gg/execution-limits/) never observe one.

A view this turn's own program opened leaves the call it documents a violation.
The model wrote the whole program before any of it ran, so it had read nothing.
Only a view the agent was already holding as the turn opened clears a call, which
covers a view carried through a [compaction](/gg/compaction/), a view restored for
a [persistent](/gg/agent-persistence/) instance, and a view the program went on to
close. A view of any name the arm binds the operation under clears it, since one
operation is reachable through more than one declaration on some arms.

The [ending calls](/gg/ending-a-session/) are the one exemption. The system prompt
spells them at the model in the arm's own words, so calling one follows an
instruction gg gave. Every other call is measured, `gg.docs.search` and
the view-opening functions included: [the opening turn](#the-opening-turn) opens
their documentation before the model's first turn, so they are documented from
turn one.

gg's own programs contribute nothing. The opening turn's program and the on-use
script of a skill or memory are written by gg rather than by a model, so their
calls are measured nowhere.

The count is a lower bound. A guessed signature that fails to compile never
reaches a call site, so what is counted is the guess that was structurally right
while still being a guess.

### Where the finding lands

Each turn's [`code_execution`](/gg/telemetry/code-execution/) event carries
`undocumentedCalls`: how many such calls the turn made, and a count per gg
operation id. Naming the operations is what makes the finding actionable, since
forty calls of one function and one call each of forty functions are different
findings.

The session summary carries the run's total in the same shape, reachable in the
[query language](/gg/analysis/query-language/) as
`summary.undocumentedCalls.calls` and
`summary.undocumentedCalls.operations.<operation>`.

The first turn of a run that records one writes a `warn` line naming the calls it
recorded and what they say about the model. Later turns write none, since the
finding is a property of the model rather than of any one call.

## The opening turn

The system prompt names the capability modules and names no function, so a fresh
code-mode window is seeded with one program written in that agent's own
language, which gg then runs. Its source is pushed as the assistant message and
the views the window opens on are the ones its own calls placed, so the model's
first example of a well-formed reply is a program that provably ran.

That program is written under the same rules a model's reply is on that arm, so
the example a model opens on has the shape of a reply it has to send. It carries
its own import line and its own entry point, on the terms in
[invariants](/gg/responses-as-code/invariants/).

The program makes two kinds of call. It runs one search naming the agent's
filesystem and shell modules together, which leaves a single view listing every
function those two modules offer with its one-line brief. It also opens
documentation views of the calls discovery and showing are made of:
`gg.docs.search`, and every view-opening function this agent is offered, which
is `gg.views.openText` and `gg.views.openDocsView` on every run and
`gg.views.openFile` where the agent holds it. Where the agent holds
[`gg.files.search`](/gg/filesystem/#searching), its documentation is opened
too, so the call that greps a workspace is read before it is written. Between
them the agent opens holding what it reaches for first, the calls that put
anything in its own window, and the means to find everything else.

The window opens on those two modules alone. The system prompt names every
module the agent holds, one line each, and a module path is an exact lookup, so
a module the agent turns out to need costs it one search and a module it never
touches costs it nothing. Listing every granted module up front spends a
directory apiece on the ones a run never reaches for, on every request of that
run.

The listing is one view keyed under the modules it lists, so only a re-listing
of exactly those supersedes it. The agent's own searches keep the single results
selector and keep superseding each other.

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
