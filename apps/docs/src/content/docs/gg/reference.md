---
title: "Reference"
---

The Reference answers one question this documentation does not: what, exactly,
was the model told? Every other page in this section describes a capability and
what a study can do with it. None of them quotes the prose gg sends, because a
second copy of text written for a model drifts the first time somebody rewords a
tool description.

So the reference is projected out of gg's own definitions rather than written:

- every tool entry is the live `ToolDefinition` a real `ToolRegistry` hands the
  provider, carrying the same name, the same description and the same
  JSON-Schema parameters;
- every API entry, meaning each function a program can call and each type it can
  be handed, carries the documentation view gg renders for that name. It is the
  block a program is shown by `gg.views.openDocsView("gg.files.readFile")`
  mid-session, produced by that same call.

There is one renderer and it is gg's. The console re-renders nothing. What that
costs is real: the page cannot filter by parameter, cannot fold a long argument
list, and cannot turn a type named inside a block into a link. The links come
from the name lists beside the block instead. It is the same rule the
[built-in skills](/gg/skills/) obey, so a tool that is renamed is renamed in the
one place its name appears.

## Two documents

A tool's name, description and JSON schema are the wire's. They are identical
whatever [program language](/gg/languages/overview/) a run's agents write their
responses in, so they belong to no arm. The responses-as-code surface is the
opposite: gg offers one set of capabilities through eleven SDKs, each written to
read as its own language. One call, three arms:

```text
rust
  read_file(path: &str, options: files::ReadOptions) -> Result<files::FileRead, ApiError>
purescript
  readFile :: String -> { offset? :: Int, limit? :: Int } -> Effect Gg.Files.FileRead
ruby
  read_file(path, offset: nil, limit: nil) -> GG::Files::TextFile or GG::Files::ImageFile
```

The reference is therefore an index plus one document per arm:

- `index.json` — the twelve families the surface is grouped by, all 35 tools
  with their real descriptions and schemas, and a line per registered program
  language carrying that arm's module, function and type counts.
- `<language>.json`, one per arm — that arm's whole responses-as-code surface:
  the modules it is divided into, and every function and type in them, each with
  its documentation view's body.

Splitting by document rather than by field keeps the duplication out. A single
document carrying all eleven arms would carry the tools eleven times, and a
reader who wanted Kotlin would fetch Ruby.

## In the console

The console serves the reference at gg → Reference, in a Tools tab and an API
tab. The page's intro names the gg version the documents were projected from and
states that the page describes the gg of the deployment this console is pointed
at rather than the version the console was built from.

Both tabs run in gg's own order and share one vocabulary: the twelve families it
divides its surface into (`Filesystem`, `Shell`, `Project management`, `Tasks`,
`Memories`, `Skills`, `Context`, `Delegation`, `Documentation`, `Views`,
`Program library`, `Ending the session`), listed in the order the built-in
skills index uses. The two tabs group
differently, because a tool and an API call are addressed differently: the Tools
tab files an entry under its family, and the API tab under the capability module
a program writes in front of the call.

Each tab is its own address, `/gg/reference/tools` and `/gg/reference/api`, and
what is selected within it rides in the query string (`?tool=compact`,
`?fn=gg.files.readFile`, `?lang=rust`), so one tool, or one function on one arm,
is a link that can be pasted into an issue.

### The Tools tab

Entries are grouped by family, and only the families that have tools appear:
eight of the twelve, since `Documentation`, `Views`, `Program library` and
`Ending the session` are responses-as-code carve-outs with no native tools.

An entry shows the description and the JSON-Schema parameters verbatim, an
argument list read off that schema, and above them what a run must have for the
tool to be offered:

- the capabilities it needs, by gg's own ids. `fork` names two, because it needs
  the capability of its own name and the `subagents` capability that buys the
  calls collecting the copy. Where none is named the page says so, since
  `transition_state` is offered from where an agent stands and no capability
  decides it.
- every further condition, one sentence each: a bound store, a writable handle,
  a memory strategy, a non-empty roster, a position in a machine. Those
  sentences are gg's, composed from a sweep it runs against its own registry,
  withholding one thing at a time from a maximal run and recording what
  disappears.
- variants, for the seven tools whose definition changes with how their
  capability is configured.

`read_file` offers no `offset`/`limit` arguments under the unlimited read mode.
`shell` describes where a command's output went, which is the substance of the
[offloading modes](/gg/shell/). `create_issue` demands reviewers under the
project-management capability's `reviewers` feature and merely permits them
without it. `add_task` and `update_task` gain an issue's structured `inScope` /
`outOfScope` / `completionCriteria` sections under the
[task list's `issues` mode](/gg/tasks/). `create_memory` and `read_memory` are
written for the pinned index only the [`markdown` strategy](/gg/memories/)
keeps; under `keyword-search` a memory is found by searching, and
`create_memory` stops requiring the `description` the index line was made of.

The top-level entry is the default configuration's, and each other configuration
is a labelled variant beside it. A configuration that changes only a number,
such as a memory's length ceiling or a search's result cap, is not a variant,
because the schema and the sentence are the same ones.

Limits are the one thing the page shows at a run's defaults rather than in every
form they can take. A limit can be switched off entirely, since `0` means "no
limit", which drops its clause rather than changing its figure; with every limit
off, `write_memory`'s "(at most 64 memories, 4096 characters…)" parenthetical
goes with them. Enumerating that would be a subset lattice per tool. Every call,
every argument and every sentence gg can send is on the page, and only the
numbers a run bounds them by belong to the run.

Some descriptions enumerate run data rather than a policy: the skills in an
agent's library, the agents on the roster, the state an agent stands in and
where it may go next. There is no configuration-independent rendering of those,
so the reference is projected from a run holding obvious stand-ins, and each one
is marked in place in the description, the argument list and the schema, under a
caption saying what it stands for. The page learns which strings those are from
gg, which records the constants it substituted.

### The API tab

The tab opens with an arm picker showing all eleven languages at once, each
carrying that arm's function count as the server counted it. The pick rides in
the address as `?lang=`, and is remembered across a flip to the Tools tab and
back.

Switching arms keeps the reader on the call. The fully-qualified name cannot
survive the switch, so a function carries over on gg's
[operation](/gg/telemetry/agent-surface/) id, which is the same in
all eleven arms, and a type on its module plus a folded name (`FileRead` ≡
`file_read`). An arm that has no counterpart says so rather than landing the
reader somewhere plausible and wrong.

Entries are grouped by the capability modules a program calls through:
`gg.files`, `gg.shell`, `gg.board`, `gg.tasks`, `gg.memories`, `gg.docs`,
`gg.views`, `gg.context`, `gg.delegation`, `gg.skills`, `gg.programs`,
`gg.session`, and the one every arm has for the type declarations that belong to
no capability. That is how a program reaches them, it is the only vocabulary the
[system prompt](/gg/prompts/) supplies, and it is what a model itself searches
by mid-run. Each folder is captioned with the module's own one-line description,
reflected from its declaration, and shows that arm's spelling of the module
path. Folders are joined to their entries by gg's cross-arm module id rather
than by the path, so the grouping is the same on every arm.

Functions and types are both rows, in the order a model meets them: each
module's callable functions, then the types declared in it. Only the types are
badged.

An entry's own heading is the fully-qualified name a documentation lookup takes
(`gg.files.readFile`), and beside it:

- the gg [operation](/gg/telemetry/agent-surface/) it serves
  (`files.read_file`), which is the one identity on the page that is the same in
  every arm and the string a run's `api_call` records name it by;
- what binds it: the capability that buys it for most calls, the agent's ending
  role for the three ending calls. When neither is set the page says always
  available, an affirmative claim made only about functions, since a type is a
  declaration and is withheld from nobody. No gg tool name appears, because no
  tool decides anything on this surface;
- where the arm hangs a convenience off the value it operates on, the receiver
  and the operation it is a second way to reach;
- the `import` line the arm states for the symbol's own module.

Then the documentation view itself, verbatim: for a function, every shape it may
be called in with a line per argument, then its description; for a type, its
declaration, its paragraph, a line per member, and a line per member function a
value of it offers.

Under that are the declarations the signature reaches, transitively closed, as
names linked to their own entries in the same document rather than as expanded
declarations. Each row states which
[documentation-view flags](/gg/responses-as-code/overview/) would place it beside
the function mid-session, out of `return`, `parameters` and `errors`, and a row
no flag places says so. Each answer is gg's own, computed by the same function a
run calls: opening goes exactly one level deep and the closure does not.

A filter box sits above the tree. It matches the loaded arm's names, briefs and
bodies and hides rows. It does not rank, and it is captioned to say so, because
gg's own documentation search ranks its hits and returns only what a run
granted, where this page is the whole pool.

## Coverage

Nothing on either tab is filtered by what any particular run granted. The
reference is what gg can offer, and every gate on it is written as a condition
rather than as an answer.

Which of them one agent of one run was actually offered is a different question
with its own answer: that instance's
[`agent_surface`](/gg/telemetry/agent-surface/) event, read in the
console's Instances and Agents views, where a tool this page describes and that
instance never had is the case worth finding.

## Projection

```sh
gg reference                      # the index document, as JSON, on stdout
gg reference --out <dir>          # index.json + <language>.json × 11
```

Stdout gets the index alone, pretty-printed, so `gg reference | jq .tools` reads
the tool surface from a shell. The per-arm documents are large enough that the
only sensible consumer is a file, so `--out` is how they are had.

The subcommand needs no invocation file, no runtime, no network and no
toolchain. Everything it projects is already in the binary: the tool definitions
directly, and the eleven signature catalogues through the crate's build script,
which reflects each out of that arm's own SDK sources. A `gg` binary therefore
carries a projection of the SDK sources it was built from, and a freshly linked
static binary run in an image-build stage emits the same twelve files every
time.

From a checkout, the wrapper writes them where the backend looks by default:

```sh
scripts/gg-reference.sh            # -> target/gg-reference/
scripts/gg-reference.sh /tmp/ref   # -> anywhere else
```

Running the projection needs no toolchain, but building gg reflects all eleven
catalogues out of their guest SDKs and compiles every arm's artifacts, so it is
[the same toolchain territory](/gg/languages/compilation/) any other build of
the crate is in. The devcontainer has them.

## Serving the documents

The backend serves the documents as files it reads at run time:

```text
gg reference --out <dir>            → index.json + <language>.json × 11
  └─ TCAB_GG_REFERENCE              → tcab-backend reads the directory
       ├─ GET /gg/reference         → the index
       └─ GET /gg/reference/{lang}  → one arm
            └─ console              → gg → Reference
```

The service image bakes the documents at `/opt/gg-reference` out of the same
build stage that produces the `gg` binary the driver image ships, so a deployed
console and the harness its runs execute are one build of one checkout. A
backend run from a release tarball unpacks the arch-independent
`gg-reference-<version>.tar.gz` asset and points `TCAB_GG_REFERENCE` at it; a
developer running the binary from a checkout leaves the variable unset and runs
`scripts/gg-reference.sh`.

The documents are loaded on first use rather than at startup, and only a
successful load is cached. A backend with no documents where it was told to look
serves everything else normally and answers `503` on the two reference
endpoints, with a body naming both fixes and the path the variable resolved to;
the console renders that body.

A directory that is partly there degrades one arm at a time. An arm document
that is missing or does not decode is warned about and left out of the index the
endpoint serves, so the picker never offers a button whose only answer is a
`404`, and a reader who asks for that arm by address gets a `404` naming the
arms that are served. An arm document that is present but empty is served as it
is, warned about, and the page says it is a broken projection. Every count the
picker shows is recounted from the documents the server read rather than copied
out of the index file.

The two endpoints are ungated, unlike everything else under `/gg`. The documents
are static, identical for every caller, and carry no account, run or deployment
data, so requiring a token would buy nothing and would stop a signed-out console
from linking to the page.

The wire shape is `GgReference` and `GgReferenceApi` in
`crates/core/src/gg_reference.rs`, which is where each field's meaning is
documented. The projection that fills them in is `crates/gg/src/reference.rs`
and its three halves: `reference.tools.rs` for the registry's own definitions,
`reference.conditions.rs` for the sweep that derives what buys a tool, and
`reference.api.rs` for the documentation runtime's own bodies, per arm.
