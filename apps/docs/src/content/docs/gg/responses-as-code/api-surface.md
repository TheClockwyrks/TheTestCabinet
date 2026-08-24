---
title: "The API surface"
---

## Typed functions

Every gg operation is a distinct, typed function in the run's program language,
named at a path the arm files it under. A program names no operation through a
dispatcher and assembles no JSON.

The interface between a program and gg is a
[WIT](https://component-model.bytecodealliance.org/design/wit.html) membrane,
`crates/gg/wit/gg-sandbox.wit`. It declares one function per operation, with
typed parameters and a typed `result<T, api-error>`, grouped one interface per
family: `types`, `shell`, `files`, `helpers`, `skills`, `memories`, `tasks`,
`board`, `context`, `session`, `docs`, `views`, `programs`, `delegation`,
`feedback`. Three properties follow, and each is required:

- A membrane function cannot exist without a host implementation, so an
  operation cannot be added, renamed or removed without a typed signature
  following it.
- A model gets a real API. `gg.files.readFile(p, { limit: 200 })` is
  discoverable and wrong in ways the SDK can name.
- The membrane is the only route to gg. What the interface does not declare is
  not something a program can ask gg to do.

No JSON crosses the membrane and none reaches a tool implementation. The
membrane calls a native, typed method per operation, and that method calls gg's
tool struct directly. JSON is built in one place only, as the request
[session-record](/gg/session-record/) capture keys a dispatched call on, so a
replay re-feeds a program's call from the same shape it re-feeds a native one.

The WIT is language-neutral. Each arm binds this same world and layers its own
idiomatic SDK over it, so two arms differ in the spelling of a call rather than
in which calls exist.

## The module vocabulary

gg's surface is divided into modules, and a program names the ones it calls.
The module ids, in the order the prompt and the agent surface present them:
`files`, `shell`, `board`, `tasks`, `memories`, `docs`, `views`, `context`,
`delegation`, `skills`, `programs`, `session`, `core`. `core` carries no
function; it holds `ApiError` and the types other signatures name.

The model-facing spelling of a call is its fully-qualified name,
`gg.<module>.<name>`. That is the key documentation is filed under and the key a
search hit carries. How an arm writes that name at a call site is the arm's own
answer, given by the module's import line: an arm whose SDK is reached module by
module writes the name with the module's binding at its head. The table below
gives the fully-qualified names, which are what everything gg prints uses:

| Function | Returns |
| --- | --- |
| `gg.shell.shell(command: string, options?: { timeoutSecs?: number })` | `ShellOutput` |
| `gg.files.readFile(path: string, options?: { offset?: number; limit?: number })` | `FileRead` |
| `gg.files.readTextFile(path: string, options?: { offset?: number; limit?: number })` | `string` |
| `gg.files.writeFile(path: string, contents: string)` | `number` (bytes written) |
| `gg.files.editFile(path: string, oldString: string, newString: string)` | `void` |
| `gg.files.listDir(path?: string)` | `DirEntry[]` |
| `gg.views.openText(label: string, body: string)` | `void` |
| `gg.delegation.spawnSubagent(request: { agent: string } & ({ prompt: string } \| { issueId: string }))` | `SubagentHandle` |

Two names belong to the surface without being a capability. `ApiError` is the
failure type every failed call raises, documented under `core` and reached the
way every other name is. `lib` holds the code the agent has loaded, and the
documentation views a use opens quote the form that reaches it.

Which line reaches a name is the arm's, and a model reads its own arm's answer in
its prompt and in every [documentation view](/gg/responses-as-code/views/) it
opens. [Static SDKs](/gg/languages/static-sdks/) records the line each arm
states.

## Static binding

Every function of the SDK is compiled, linked and callable in every program
whatever the run enabled, and the SDK covers all 50 operations. Both ending
groups are declared on every agent, and the agent's role decides which of them
the membrane accepts.

A call the agent was not granted travels to the membrane and is refused there.
See [static SDKs](/gg/languages/static-sdks/) for that design and for what a
model reads on each arm.

Three delegation calls are deferred rather than performed in place.
`gg.delegation.exec` and `gg.delegation.transitionState` register the
succession, return, and let the program run to its end; the loop applies it once
the turn closes. They share one succession slot and the first declaration
stands, so a second succession in a turn is refused. `gg.delegation.fork`
returns the copy's real id immediately and the copy is dispatched when the turn
closes, so a fork is waited on from a later turn rather than from the program
that created it.

## The capability gate

`crates/gg/src/sandbox/operations.rs` holds this surface's whole model-facing
vocabulary as 50 operations, and it is the only vocabulary the surface has. gg's
tool names are the other surface's, are callable from no program, and decide
nothing here.

Each row names an `OperationId` of the form `namespace.key` (`files.read_file`),
the family it belongs to, whether the call takes input, and its `Binding`. A
`Binding` is one of four things:

- `Capability(id)`, bought by a gg capability the agent holds and named in that
  agent's [allowlist](/gg/configurations/#granting-calls). 41 rows, and a
  capability commonly buys several: `read-file` alone buys `files.read_file`,
  `files.read_text_file` and `views.open_file`, which are three separately
  documented, separately called and separately grantable operations over one
  read.
- `Ending(role)`, bought by the agent's ending role. `session.finish` is
  `Standard`; `session.approve` and `session.request_changes` are `Review`.
- `Machine`, bought by where the instance stands rather than by anything on its
  profile. Its one row is `delegation.transition_state`, held by an agent
  running a [machine](/gg/fsms/) state with somewhere to go.
- `Always`, bound to every program whatever a run enables. `docs.search`,
  `views.open_text` and `views.open_docs_view`: a run that grants nothing must
  still be able to show its model something and to find what it holds.
  `views.close` and `views.current` are not among them — closing a view and
  listing what is open are context management, bought by
  `agent-managed-context`.

Capability ids appear only in this table. No signature catalogue, no SDK and
nothing a reflector emits carries one, so no arm asserts anything about gg's
configuration surface.

`Grants::permits` is the whole gate. The membrane asks it when a call arrives,
and the documentation runtime asks it when a search decides what to show. There
is one implementation of the question, so what a model can find and what gg will
service are one set.

The same grant decides the prompt's vocabulary. A module is named in the system
prompt where this agent binds a function in it, so a capability this agent was
granted nothing from contributes no prompt text, and the surface and its
description come from one source.

The gate is asked inside the call's own recording bracket, so a refused call is
still an API call the model made and lands on the turn's refusal roster as a
failed one. That roster is what a comparison of two configurations reads to see
what a narrowed agent reached for anyway.

An operation's `Applicability` is `Universal` or `UniversalExcept`, and every
exemption carries a written reason held at compile time. No operation carries an
exemption.

### Refusals

A refusal is a typed `ApiError` with code `unavailable`, which a program can
catch and recover from on the same turn. Its message says the call is not
available and, where the agent has one, which call to make instead. It says
nothing about what would have unlocked the call, since the profile was fixed
before the session began and no program can edit it. The call the message quotes
is spelled in the program's own language, because the sentence is an instruction
the model can act on; the error's `operation` field carries the operation's own
key, so a catch site branches on that key.

An uncaught refusal is classified from the failure code where the arm's guest
carries one up with the throw, and it records as `program_unknown_name`. The
arms whose programs die the way their runtime kills them carry nothing up, so a
cross-arm count of refusals joins on the refusal roster rather than on the
[turn's error type](/gg/languages/static-sdks/#the-turn-error-for-an-uncaught-refusal).

## Failed calls

A failed call throws a typed `ApiError` carrying `.operation`, `.code` and
`.message`, and an uncaught throw ends the program at that statement. Every call
the program landed before the throw has landed for good. What the model is told
is which statement threw, at the coordinates of its own program.

- `.operation` names the failed call by the key of the operation the program
  wrote. The guest re-tags a binding-level `TypeError` as an `ApiError` on the
  call it came out of, and that one carries the SDK's spelling, so
  `gg.tasks.addTask({ title: "x" })` reports as `` `addTask` failed
  (invalid-argument) `` with the bindings' own complaint after it.
- `ApiError` serialises. It carries an explicit `toJSON`, because a plain
  `Error`'s `message` is non-enumerable and a failure a program put in a view
  would otherwise arrive as `{}`.
- Every classifier in the guest asks `Object.prototype.toString` for a value's
  brand. The generated component bindings are evaluated against a different
  `Error` intrinsic than the SDK and the program see, so `instanceof Error`
  answers `false` for a bindings fault.
- `gg.shell.shell` is carved out. A process that ran is a successful call
  whatever it exited with, so the exit code is a value the program branches on
  and a call is usable inside an expression.
- A `ReferenceError` is answered with the list of gg's modules, qualified as the
  documentation qualifies them, plus `lib` when the agent has loaded code. The
  common cause is a program reaching for a flat name where the qualified one
  belongs.

## `lib`: code the agent loaded

`lib` holds the code the agent has loaded, from exactly two sources, both of
them things the agent used: a [code skill](/gg/skills/), a skill directory's
module in this language's own file, and a [code memory](/gg/memories/), the
`code` a program handed `writeMemory`, `createMemory` or `updateMemory`.

Each is loaded under a key, `key` being the skill's name or the memory's slug in
the language's own convention. Two things that spell alike are deduplicated with
a numeric suffix: a skill `csv-tools` and a memory `csv_tools` both want
`csvTools`, the first use gets it and the second gets `csvTools2`.

A loaded module is made available the way the arm makes gg's SDK available, and
the program reaches it through the line the language requires. That line, the
key, and everything the module declares reach the model as
[documentation](/gg/responses-as-code/views/): the use opens a view per declared
function, and the entries are searchable and closable like any other.

```ts
import * as csvTools from "lib:csvTools";
import { files, views } from "gg";

const rows = csvTools.parseCsv(files.readTextFile("data/vendor.csv"));
views.openText("rows", `${rows.length} rows, ${rows[0].length} columns`);
```

Each arm's page states its own form: an import of the arm's own module
specifier, a name reached through an extern or a classpath entry, or a module the
program imports by name.

Loaded code is not an API object: it holds no gg function, and the hint an
unknown name earns names it separately from the modules.

Loaded code costs no tokens. It is prepared source the host holds and hands to
the guest, so it is never a context item, is never summarized or evicted, and a
[compaction](/gg/compaction/) does not touch it. A `fork` or a successor
inherits the window and the skills read set and starts with nothing loaded, and
holds none of the documentation views a load opened. Using the skill again loads
it and opens them.

### Module shape

A module is an ordinary file in the run's program language, prepared by a step of
its own beside the one for programs, and compiled in its own coordinates so that
every diagnostic points at the line the author wrote.

A module exports whatever it says it exports, and a file that says nothing
exports everything it declares. Type-only declarations export nothing, and a
renaming export is offered under the name it was exported as. An arm whose
module step needs the author to write in a narrower shape than a program's says
so on its own page, with a located diagnostic in the same voice a program's
errors use.

### Module scope

A module reaches the same surface a program does, so it may call any gg function
the run offers and a helper may be a whole procedure. A module's author writes
the same import line a program writes.

Modules are prepared independently of one another. A module reaches another
loaded module only on an arm whose guest resolves a module specifier for a
module as well as for a program. Load order is the order the agent happened to
use things in, and it is kept out of the contract.

### Module failures

A module's author is whoever wrote the skill or the memory rather than the model
whose program has it in scope, so a module that fails reaches the model as a
module error naming the binding key and the message rather than as the program's
own failure. The module's source is never shown to the model. Module errors
accumulate across a hand-over chain and are deduplicated.

A module is evaluated by the import the program wrote, so a program that imports
none of them runs none of them. A module that threw while it was evaluated is
reported that way and the program carries on with that binding empty. An arm
whose language evaluates an imported module as part of the importing program's
own evaluation reports the module's located failure as the program's instead.

The same channel carries an on-use script that failed: one sentence naming the
skill or the memory, and the turn's own outcome untouched.
