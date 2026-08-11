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
- every **API function** entry is the committed
  [signature catalogue](/gg/responses-as-code/), reflected out of the sandbox SDK's own
  emitted declarations and their doc comments — the same material a program gets back from
  `openDocsView(...)` mid-run: every shape the function may be called in, and a line per
  argument.

  Its **Types** section is the one place the page shows *more* than a lookup does, and
  deliberately: it lists every declaration the signature reaches, transitively closed, so a
  reader can see the whole shape of what a function hands back. A lookup mid-run goes exactly
  one level deep and opens only what that agent's `docViewTypes`
  [mode](/gg/responses-as-code/#configuring-it) selects — the return position by default,
  everything the signature names under `return-and-parameters`, nothing under `off` — minus
  anything the session has already been shown. Sizing a run's per-lookup context cost from
  this list overstates it.

It is the same rule the [built-in skills](/gg/skills/) obey, and for the same reason: a
tool that is renamed is renamed in the one place its name appears.

## Reading it in the console

The console serves it at **gg → Reference**, in two tabs — **Tools** and **API**. The page's
intro names the [program language](/gg/program-languages/) the API signatures are spelled in,
beside the gg version they were projected from — gg's **default** language, which is the arm a
run that configures none is held to. It says so because a signature *is* a spelling: a run
configured to another language offers exactly these operations, in exactly these modules, under
that language's own names, and a reader comparing two arms of a cross-language study has to be
able to tell which surface is on screen. Both tabs are
ordered by the eleven families gg divides its surface into (`Filesystem`, `Shell`,
`Project management`, `Tasks`, `Memories`, `Skills`, `Context`, `Delegation`, `Views`,
`Program library`, `Ending the session`), in the order the system prompt's own API table
uses — but they are *grouped* differently, because a tool and an API call are addressed
differently:

- the **Tools** tab groups by family, and shows only the families that have tools. `Views`,
  `Program library` and `Ending the session` are responses-as-code carve-outs with no
  native tools at all, so eight folders appear rather than eleven.
- the **API** tab groups by the **capability modules** a program calls through — `gg.files`,
  `gg.shell`, `gg.board`, `gg.tasks`, `gg.memories`, `gg.skills`, `gg.context`,
  `gg.delegation`, `gg.views`, `gg.programs`, `gg.session` — because that is how a program
  reaches them (`gg.files.readFile`, not "the filesystem family's read call"), it is the only
  vocabulary the [system prompt](/gg/prompts/) supplies, and it is what a model itself
  searches by mid-run. Each folder is captioned with the module's **own** one-line
  description, reflected from its declaration; the folders are joined to their functions by
  gg's cross-arm module id rather than by the spelling, so the page groups the same way
  whichever language it is projected from. What a folder holds is exactly the catalogue's own
  entries — nothing is appended that no SDK declaration produced, which is also how an
  instance's own [surface](/gg/telemetry/#what-an-agent-is-offered) reports it. A module in
  which nothing is callable — the one every arm has for the type declarations that belong to
  no capability — is not shown as an empty folder.

  A function's own entry names it by the **fully-qualified name** a documentation lookup
  takes (`gg.files.readFile`) and, beside it, the gg
  [operation](/gg/telemetry/#what-an-agent-is-offered) it serves (`files.read_file`) — the
  one identity on the page that is the same in every language arm, and the string a run's
  `api_call` records name it by. A reader with this page open and a run's calls in front of
  them is looking at the same identifier in both.

An API function shows **every signature** the SDK offers it in, each above its own argument
list. There is usually exactly one — TypeScript spells an optional argument with `?` — but a
[language](/gg/program-languages/#one-entry-many-signatures) that has to spell it as an
overload pair carries two, and showing only the first would tell a reader half of what a
program may write. Each type under a signature is shown the same way: the declaration, the
paragraph explaining what it is for, and a line per member. Every one of those lines is the
SDK's own, written on the argument or member it describes.

Descriptions and documentation are rendered verbatim, whitespace and all, rather than as
markdown: the point of the page is to see what the model sees.

Each tab is its own address — `/gg/reference/tools` and `/gg/reference/api` — and the
selected entry rides in the query string (`?tool=compact`, `?fn=gg.files.readFile`), so one
tool or one function is a link you can paste into an issue.

Each tool also carries what the definitions themselves do not:

- the **capability** that contributes it, and a **note** naming any further condition — a
  bound store, a memory strategy, a non-empty roster, a position in a machine. These are
  the only authored words on the page, and a test asserts the table covers exactly gg's
  tool vocabulary, so a new tool cannot arrive without its gate being written down.
- **variants**, for the handful of tools whose *definition* changes with how their
  capability is configured. `read_file` offers no `offset`/`limit` arguments at all under
  the unlimited read mode; `shell` describes where a command's output went, which is the
  whole substance of the [offloading modes](/gg/shell/); `create_issue` demands reviewers
  under the project-management capability's `reviewers` feature and merely permits them
  without it; `add_task` and `update_task` gain an issue's structured
  `inScope` / `outOfScope` / `completionCriteria` sections under the
  [task list's `issues` mode](/gg/tasks/); and `create_memory` and `read_memory` are
  written for the pinned index only the [`markdown` strategy](/gg/memories/) keeps —
  under `keyword-search` a memory is found by searching, and `create_memory` stops
  requiring the `description` the index line was made of.

  The top-level entry is the **default** configuration's, and each other configuration is a
  labelled variant beside it. The two memory calls are the one exception, and their notes
  say so: the default memory strategy is the scratchpad, which offers neither call, so
  their entry is the `markdown` rendering and the variant is `keyword-search`'s. A
  configuration that changes only a *number* — a memory's length ceiling, a search's result
  cap — is not a variant; the schema and the sentence are the same ones.

A description that enumerates **run data** rather than a policy — the skills in the
library, the agents on the roster, a state's outgoing edges — has no
configuration-independent rendering, so it is built from obvious placeholders (`<skill>`,
`<agent>`, `<state>`) and its note says the real list is the run's.

The reference is therefore what gg **can** offer, and every gate on this page is written
as a condition rather than an answer. *Which of them one agent of one run was actually
offered* is a different question, answered by that instance's own
[`agent_surface`](/gg/telemetry/#what-an-agent-is-offered) event and read in the console's
Instances and Agents views — where a tool this page describes and that instance never had
is the case worth finding.

## Generating it

```sh
gg reference           # the whole reference, as JSON, on stdout
```

The subcommand needs no invocation file, no runtime and no network: everything it prints
is either compiled into the binary or a committed artifact beside it.

It exists as a subcommand rather than as something the backend computes because the
backend **cannot depend on the gg crate** — that crate pulls `wasmtime`, `oxc` and
`tiktoken-rs`, and the backend is built portable and static under musl. So the reference
takes the generate-and-commit path `crates/gg/src/sandbox/guests/typescript.signatures.json`
and the run-record contract already take:

```text
gg reference                    → the contract, as JSON
  └─ scripts/gen-contract.mjs   → crates/backend/src/gg_reference.json
       └─ backend include_str!  → GET /gg/reference
            └─ console          → gg → Reference
```

`npm run gen:contract` regenerates it, and CI's contract-drift gate regenerates and diffs
it — so a tool whose description changed without the artifact being regenerated fails the
build rather than shipping a page that describes the previous release.

The wire shape is `GgReference` in
[`crates/core/src/gg_reference.rs`](https://github.com/TheClockwyrks/the-test-cabinet/tree/master/crates/core/src/gg_reference.rs),
which is where each field's meaning is documented; the projection that fills it in is
`crates/gg/src/reference.rs`.
