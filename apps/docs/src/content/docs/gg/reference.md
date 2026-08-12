---
title: "Reference"
---

The **Reference** is the answer to a question this documentation deliberately does not
try to answer: *what, exactly, was the model told?* Every page in this section describes
a capability — what it is for, why it is shaped the way it is, what a study can do with
it. None of them quotes the prose gg actually sends, because a quote is a second copy,
and a second copy of text written for a model drifts the first time somebody rewords a
tool description.

So the reference is not written at all. It is **projected out of gg's own definitions**:

- every **tool** entry is the live `ToolDefinition` a real `ToolRegistry` hands the
  provider — the same name, the same description, the same JSON-Schema parameters; and
- every **API** entry — each function a program can call and each type it can be handed —
  carries the documentation view gg renders for that name: literally the block a program is
  shown by `gg.views.openDocsView("gg.files.readFile")` mid-session, produced by the same
  call, not a rendering of a signature record assembled for this page.

That second point is the whole shape of the surface, so it is worth being blunt about it:
there is **one renderer**, and it is gg's. The console re-renders nothing. A page that
took gg's structured fields and laid them out its own way would be a second renderer over
one input — faithful the day it was written, and a source of truth of its own the day
after — which is exactly what "show what the agent sees" forbids. What that costs is real:
the page cannot filter by parameter, cannot fold a long argument list, and cannot turn a
type named *inside* the block into a link without parsing prose. The links come from the
name lists beside the block instead.

It is the same rule the [built-in skills](/gg/skills/) obey, and for the same reason: a
tool that is renamed is renamed in the one place its name appears.

## Two documents, because the surface has two halves

A tool's name, description and JSON schema are the **wire's**. They are identical whatever
[program language](/gg/program-languages/) a run's agents write their responses in, so
they belong to no arm. The responses-as-code surface is the opposite: gg offers one set of
capabilities through eleven SDKs, each deliberately written to read as *its own language*
rather than as a transliteration of some other. One call, three arms:

```text
rust        read_file(path: &str, options: files::ReadOptions) -> Result<files::FileRead, ToolError>
purescript  readFile :: String -> { offset? :: Int, limit? :: Int } -> Effect Gg.Files.FileRead
ruby        read_file(path, offset: nil, limit: nil) -> GG::Files::TextFile or GG::Files::ImageFile
```

So the reference is an **index** plus one document per arm:

| Document | What is in it |
| --- | --- |
| `index.json` | The twelve families the surface is grouped by, all 35 tools with their real descriptions and schemas, and a line per registered program language carrying that arm's module, function and type counts. |
| `<language>.json` × 11 | One arm's whole responses-as-code surface: the modules it is divided into, and every function and type in them, each with its documentation view's body. |

Splitting by *document* rather than by *field* is what keeps the duplication out: a single
document carrying all eleven arms would carry the tools eleven times, and a reader who
wanted Kotlin would fetch Ruby.

## Reading it in the console

The console serves it at **gg → Reference**, in two tabs — **Tools** and **API**. The
page's intro names the gg version the documents were projected from, and says the two
things a reader has to know to use the page at all: nothing on it was written *for* it,
and it describes the gg of the deployment this console is pointed at rather than whatever
version the console itself was built from.

Both tabs run in gg's own order, and share one vocabulary — the twelve families it divides
its surface into (`Filesystem`, `Shell`, `Project management`, `Tasks`, `Memories`,
`Skills`, `Context`, `Delegation`, `Documentation`, `Views`, `Program library`, `Ending the
session`), which is the order the system prompt's module table and the built-in skills
index both list them in. They are *grouped* differently, though, because a tool and an API
call are addressed differently: the Tools tab files an entry under its family, and the API
tab under the capability module a program writes in front of the call.

Each tab is its own address — `/gg/reference/tools` and `/gg/reference/api` — and what is
selected within it rides in the query string (`?tool=compact`, `?fn=gg.files.readFile`,
`?lang=rust`), so one tool, or one function on one arm, is a link you can paste into an
issue.

### The Tools tab

Grouped by **family**, and only the families that have tools appear — eight folders rather
than twelve, because `Documentation`, `Views`, `Program library` and `Ending the session`
are responses-as-code carve-outs with no native tools at all.

An entry shows the description and the JSON-Schema parameters verbatim, an argument list
read off that schema, and above them what a run must have for the tool to be offered:

- the **capabilities** it needs, by gg's own ids. Usually one; `fork` names two, because it
  needs the capability of its own name *and* the `subagents` capability that buys the calls
  collecting the copy. Where none is named, that is a fact rather than a gap and the page
  says so — `transition_state` is offered from where an agent *stands*, and naming a
  capability for it would name something that does not decide it.
- every further **condition**, one sentence each: a bound store, a writable handle, a
  memory strategy, a non-empty roster, a position in a machine. These sentences are
  **gg's**, composed from an ablation it runs against its own registry — it withholds one
  thing at a time from a maximal run and records what disappears — so the console renders a
  string it never wrote. They replaced 32 hand-written gate notes, each of which could be
  silently wrong about the `if` it described, because nothing ever compared one against the
  other.
- **variants**, for the handful of tools whose *definition* changes with how their
  capability is configured. `read_file` offers no `offset`/`limit` arguments at all under
  the unlimited read mode; `shell` describes where a command's output went, which is the
  whole substance of the [offloading modes](/gg/shell/); `create_issue` demands reviewers
  under the project-management capability's `reviewers` feature and merely permits them
  without it; `add_task` and `update_task` gain an issue's structured
  `inScope` / `outOfScope` / `completionCriteria` sections under the
  [task list's `issues` mode](/gg/tasks/); and `create_memory` and `read_memory` are
  written for the pinned index only the [`markdown` strategy](/gg/memories/) keeps — under
  `keyword-search` a memory is found by searching, and `create_memory` stops requiring the
  `description` the index line was made of.

  The top-level entry is the **default** configuration's and each other configuration is a
  labelled variant beside it. A configuration that changes only a *number* — a memory's
  length ceiling, a search's result cap — is not a variant; the schema and the sentence are
  the same ones.

  The **limits are the one thing the page shows at a run's defaults rather than in every
  form it can take**, and the reason to say so plainly is that a limit can be switched off
  entirely (`0` means "no limit"), which drops its clause rather than changing its figure —
  and with every limit off, `write_memory`'s "(at most 64 memories, 4096 characters…)"
  parenthetical goes with them. Enumerating that is a subset lattice per tool: every call,
  every argument and every sentence gg can send is here, and only the numbers a run bounds
  them by belong to the run.

Five tools describe **run data** rather than a policy — the skills in the library, the
agents on the roster, the state an agent stands in and where it may go next. There is no
configuration-independent rendering of those, so the reference is projected from a run
holding obvious stand-ins, and each one is **marked in place** in the description, the
argument list and the schema, under a caption saying what it stands for. The page learns
which strings those are from gg, which recorded the constants it substituted — not by
hunting for angle brackets, which ordinary tool prose contains too.

### The API tab

The tab opens with an **arm picker**: all eleven languages at once rather than a dropdown,
each carrying that arm's function count as the server counted it, because this row is the only place
on the console where the breadth of the surface is visible and a reader who does not know
gg has a Swift arm will not open a menu looking for one. The pick rides in the address as
`?lang=`, and is remembered across a flip to the Tools tab and back.

**Switching arms keeps you on the call.** The fully-qualified name cannot survive the
switch — that is the point of eleven idiomatic SDKs — so a function carries over on gg's
[operation](/gg/telemetry/#what-an-agent-is-offered) id, which is the same in all eleven,
and a type on its module plus a folded name (`FileRead` ≡ `file_read`). An arm that has no
counterpart says so rather than landing you somewhere plausible and wrong.

Entries are grouped by the **capability modules** a program calls through — `gg.files`,
`gg.shell`, `gg.board`, `gg.tasks`, `gg.memories`, `gg.docs`, `gg.views`, `gg.context`,
`gg.delegation`, `gg.skills`, `gg.programs`, `gg.session`, and the one every arm has for
the type declarations that belong to no capability — because that is how a program reaches
them (`gg.files.readFile`, not "the filesystem family's read call"), it is the only
vocabulary the [system prompt](/gg/prompts/) supplies, and it is what a model itself
searches by mid-run. Each folder is captioned with the module's **own** one-line
description, reflected from its declaration, and shows that arm's spelling of the module
path. The folders are joined to their entries by gg's cross-arm module **id** rather than
by the path, so the grouping is the same on every arm — grouping by the path would silently
empty every folder the moment a reader picked another one.

Functions and types are both rows, in the order a model meets them: each module's callable
functions, then the types declared in it. Only the types are badged, because functions are
the majority of every folder and what a reader came for.

An entry's own heading is the **fully-qualified name** a documentation lookup takes
(`gg.files.readFile`), and beside it:

- the gg [operation](/gg/telemetry/#what-an-agent-is-offered) it serves (`files.read_file`)
  — the one identity on the page that is the same in every arm, and the string a run's
  `api_call` records name it by. A reader with this page open and a run's calls in front of
  them is looking at the same identifier in both;
- what **binds** it, in the vocabulary that actually decides it: a *tool* being enabled for
  most calls, the agent's *ending role* for the ending call, a *capability* for a few. When
  all three are empty the page says **always available** — an affirmative claim, made only
  about functions, because a type is a declaration and is withheld from nobody;
- where the arm hangs a convenience off the value it operates on, the receiver and the
  operation it is a second way to reach. That is a fact about the *arm* rather than about
  gg, which is what eleven idiomatic SDKs means in practice;
- the `import` line, on the one arm that needs one.

Then the **documentation view** itself, verbatim, whitespace and all: for a function, every
shape it may be called in with a line per argument, then its description; for a type, its
declaration, its paragraph, a line per member, and a line per member function a value of it
offers. That last block is one a lookup renders and no structured projection ever carried.

Under it, **the declarations the signature reaches** — transitively closed — as names
linked to their own entries in the same document, never as expanded declarations. Each row
is marked with whether it is in the **return** position and whether opening this function
mid-session would open it too, under either
[documentation-view mode](/gg/responses-as-code/#configuring-it). Those two sets are gg's
own answer, computed by the same function a run calls: opening goes exactly **one** level
deep and the closure does not, and the page shows both rather than explaining the gap in a
paragraph.

A **filter box** sits above the tree. It matches the loaded arm's names, briefs and bodies
and hides rows; it does not rank, and it is captioned to say so, because gg's own
[documentation search](/gg/responses-as-code/) is a different thing: it ranks its hits and
returns only what a run granted, where this page is the whole pool. Reimplementing that
ranking here would be a frozen copy of an algorithm that lives in gg — the second source of
truth again — answering a different question.

## It is the pool, not one run's view

Nothing on either tab is filtered by what any particular run granted, and that is the point
rather than an omission. The reference is what gg **can** offer, and every gate on it is
written as a condition rather than as an answer.

*Which of them one agent of one run was actually offered* is a different question with its
own answer: that instance's [`agent_surface`](/gg/telemetry/#what-an-agent-is-offered)
event, read in the console's Instances and Agents views — where a tool this page describes
and that instance never had is the case worth finding. A page that tried to answer both
would answer neither.

## Projecting it

```sh
gg reference                      # the index document, as JSON, on stdout
gg reference --out <dir>          # index.json + <language>.json × 11
```

Stdout gets the index alone, pretty-printed, because a human is the only thing that reads a
binary's stdout and `gg reference | jq .tools` is how the tool surface is read from a shell;
eleven arms' worth of documentation views would bury it. The per-arm documents are large
enough that the only sensible consumer is a file, so `--out` is how they are had.

The subcommand needs **no invocation file, no runtime, no network and no toolchain**.
Everything it projects is already in the binary: the tool definitions directly, and the
eleven [signature catalogues](/gg/program-languages/#the-catalogue) through the crate's
build script, which reflects each out of that arm's own SDK sources. So a `gg` binary
carries a projection of the SDK sources it was built from and cannot be asked about
anything else — and a freshly linked static binary, run in an image-build stage with
nothing else installed, emits the same twelve files every time.

From a checkout, the wrapper writes them where the backend looks by default:

```sh
scripts/gg-reference.sh            # -> target/gg-reference/
scripts/gg-reference.sh /tmp/ref   # -> anywhere else
```

Note what *that* needs, which is not the same thing: running the projection needs no
toolchain, but **building** gg reflects all eleven catalogues out of their guest SDKs and
compiles every arm's artifacts, so it is
[the same toolchain territory](/gg/program-languages/#reading-a-catalogue) any other build
of the crate is in. The devcontainer has them.

## How it reaches the console

The backend serves the documents as files it reads at run time:

```text
gg reference --out <dir>            → index.json + <language>.json × 11
  └─ TCAB_GG_REFERENCE              → tcab-backend reads the directory
       ├─ GET /gg/reference         → the index
       └─ GET /gg/reference/{lang}  → one arm
            └─ console              → gg → Reference
```

The service image bakes them at `/opt/gg-reference` out of **the same build stage that
produces the `gg` binary the driver image ships**, which is the property the whole
arrangement exists for: a deployed console and the harness its runs execute are one build of
one checkout, so the page cannot describe a gg the deployment does not have. A backend run
from a release tarball unpacks the arch-independent `gg-reference-<version>.tar.gz` asset and
points `TCAB_GG_REFERENCE` at it; a developer running the binary from a checkout leaves the
variable unset and runs `scripts/gg-reference.sh`.

A backend with no documents where it was told to look serves **everything else normally** and
answers `503` on the two reference endpoints, with a body naming both fixes — and the console
renders that body rather than a blank page. A directory that is *partly* there degrades one arm
at a time: an arm document that is missing or does not decode is warned about and left out of
the index the endpoint serves, so the picker never offers a button whose only answer is a `404`
(and a reader who asks for it by address gets a `404` naming the arms that are served). An arm
document that is present but *empty* is served as it is, warned about, and the page says it is a
broken projection rather than letting it read as a filter that matched nothing. The sizes on the
picker's chips are counted from the documents the server actually read, never copied out of the
index file's own lines about them. The endpoints are ungated, unlike everything else
under `/gg`: the documents are static, identical for every caller, and carry no account, run or
deployment data, so requiring a token would buy nothing and would stop a signed-out console
from linking to it.

## Why none of it is committed

The obvious alternative is to project the reference once, commit the JSON, and have the
backend embed it — the generate-and-commit path the run-record contract takes. That is what
this surface did until it was replaced, and it is worth writing down why it was.

The backend **cannot depend on the gg crate**: gg pulls `oxc` and `tiktoken-rs`, neither of
which is anywhere in the server's dependency tree, and *building* gg reflects a signature
catalogue out of each of its eleven SDKs with that SDK's own documentation tool — so every
machine and every CI job that linked it would need eleven language toolchains before it could
compile a server. (Not wasmtime, which is a natural thing to assume and wrong: the backend
already links it, statically, under musl, through the adversarial engine's host.) A committed
artifact stood in for the dependency, with a regenerate-and-diff gate to make it "as
trustworthy as one". It was neither.

- It carried **one of eleven arms**, because the projection ran against gg's default program
  language. Ten SDKs were invisible on a page that looked complete.
- Being structured rather than rendered, it needed a **second renderer** in the console — over
  prose whose first renderer is gg's own documentation runtime. Two renderers over one input
  is a second source of truth one level below the file.
- A gate that finds staleness *after the fact*, and only when somebody runs it, is strictly
  weaker than an artifact that cannot be stale. The committed bytes could disagree with the gg
  in the image beside them for as long as it took someone to notice.

Reading files the same build produced removes all three at once, and it is the move
[the signature catalogues](/gg/program-languages/#reading-a-catalogue) and every arm's
compiled artifacts already made, one level down. What it costs is that a missing file is now a
run-time condition rather than a compile error — hence the loud `503` — and that a developer
running the backend as a bare process runs one script first. `npm run gen:contract` no longer
builds gg at all, and `scripts/ci/contract-drift.sh` has nothing of gg's left to diff.

The wire shape is `GgReference` and `GgReferenceApi` in
[`crates/core/src/gg_reference.rs`](https://github.com/TheClockwyrks/the-test-cabinet/tree/master/crates/core/src/gg_reference.rs),
which is where each field's meaning is documented. The projection that fills them in is
`crates/gg/src/reference.rs` and its three halves: `reference.tools.rs` (the registry's own
definitions), `reference.conditions.rs` (the ablation that derives what buys a tool) and
`reference.api.rs` (the documentation runtime's own bodies, per arm).
