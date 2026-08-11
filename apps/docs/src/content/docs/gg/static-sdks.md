---
title: "Static SDKs"
---

Every one of gg's eleven [program languages](/gg/program-languages/) ships an SDK that is
**static**: every function it declares is compiled, linked and callable in every program,
whatever the run enabled, whatever role the agent was dispatched in, and whatever
capabilities it holds. Nothing is left out of a program's scope, and no arm withholds a
name.

What happens when a program calls something the agent was not granted is a **refusal from
the host** — a typed, catchable failure that names the missing capability and says what to
do instead. It is the same value on every arm, raised at the same boundary, recorded as the
same turn error.

This page is about that design: what "static" means here, why the surface a program can
*compile* and the surface a model can *discover* deliberately differ, and what a model
actually reads when it calls something it does not have.

## What it replaced, and why

gg had **three** capability models in one cross-language study, not two — which is worth
setting out plainly, because the middle one is easy to miss and seven arms changed here, not
four.

1. **Run-built guest scope, language-level failure** — TypeScript, JavaScript, Python, Ruby.
   The guest received the enabled tool names, the ending role and a program-library flag, and
   bound only what those bought. A withheld function was simply **absent**, and calling it was
   an undefined-identifier error from the language: `ReferenceError: readFile is not defined`
   in JavaScript, an `AttributeError` in Python, a `NoMethodError` in Ruby.
2. **Statically linked SDK over that same run-built scope** — PureScript, Java, Kotlin. These
   three compile to bundles the shared ECMAScript guest evaluates, and their SDK bridges
   resolve `fs`, `view`, `harness` and the rest as **free identifiers against that scope**. So
   the SDK was static and the surface underneath it was not, and each of the three carried its
   own refusal path for the gap: twelve `typeof fs === 'undefined' ? null : fs` accessors in
   `Wire.java` and `Wire.kt`, and an `unavailable()` in PureScript's `Wire.js`. The model got a
   `ToolError` — but one the *SDK* synthesized, whose message named the JavaScript lowering
   rather than the arm's own spelling.
3. **Genuinely host-refused throughout** — Rust, C++, Swift, C#. These link their SDK the way
   a program links any library, into a guest with no JavaScript scope to consult at all. They
   have always relied on the host to refuse, and nothing about them changed.

Inverting the shared ECMAScript guest made (1) and (2) static together. The evidence for the
second half is in the Java arm's own surface test, which changed with it: a refused
`Files.readFile` used to report `fs.readFile` — a name no Java program can write — and now
reports ``\`gg.files.Files.readFile\` is not available to you``.

Two capability models in one study is exactly the kind of difference a study must not have:

- **The message differed.** A model on a run-scoped arm was told a name does not exist, or was
  told by its own SDK that "this program's capability set does not offer it". A model on a
  host-refused arm was told, in one sentence, which capability is missing and what to do
  instead. Those are not the same information, and the last is a turn the model recovers from
  where the first is a turn it spends guessing.
- **The failure differed in kind.** An undefined identifier is a language error with no
  structure: nothing to catch by type, no code to branch on. A refusal is a `ToolError` with
  `.tool`, `.code` and `.message`, which a program can catch, inspect and route around
  without stopping.
- **On Python it was not a gate at all.** Python's SDK is an ordinary package, so
  `import gg.files` reached past the built scope to every function in it. The host had to check
  it anyway, which means the guest-side filtering was never the enforcement there; it was a
  *hint*, and a hint that replaced gg's sentence with the language's.
- **On TypeScript the arm already disagreed with itself.** `gg.d.ts` declared the whole
  catalogue to the type checker regardless of the run, so a withheld call type-checked and then
  failed in the guest. That is not a bypass — a declaration file is erased before anything runs,
  and the built scope really was the enforcement — but the *type* surface and the *scope*
  surface were already two different answers inside one arm. The inversion removed a
  disagreement rather than adding one.
- **Ruby's really did withhold.** `GG::Scope` lifted every method off its module and put back
  only what the run bought. What that bought was a `NoMethodError`.

All seven are now static, and the host's refusal is the whole of the gate on all eleven.

## One predicate, in one place

gg names every model-facing call an **operation** and states, once, what buys it: a gg tool
being enabled, an [ending role](/gg/ending-a-session/), a capability the agent holds, or
nothing at all. An agent's **grant** is the other half of that pair — the tools its run
enabled, the role it was dispatched in, the capability ids it was given.

"May this agent call *X*?" is one function over those two values, and it has exactly two
readers:

- the **membrane**, when a call arrives, to decide whether it is serviced or refused;
- the **documentation runtime**, when a [search](/gg/responses-as-code/#reading-the-documentation-is-opening-a-view)
  runs, to decide what the model may be shown.

They read the same value through the same function — and, since a grant is a value rather than
a predicate, they build it in one place too: one helper turns the flags a run resolved into the
capability ids a grant carries, so the membrane's grant and the documentation runtime's cannot
be assembled from two different lists. That matters more than it looks: if the membrane
permitted something search would not show, gg would be withholding a capability the model was
told it did not have; if search advertised something the membrane refuses, gg would be teaching
a model to write a call that cannot work. Neither is possible when there is one implementation
of the question **and** one construction of what it is asked about.

## The compile-time surface and the discovery surface differ, on purpose

This is the accepted consequence of going static, and it is worth stating plainly rather than
discovering.

**The compile-time surface is the language's.** Every function is in the SDK, so a compiled
arm will compile a call to a function the agent cannot use, and gg's TypeScript checker will
type-check one — the checker has always been handed the whole catalogue, so that a verdict
depends on the program alone and so that the same text checks identically as a turn's
program, as a [skill](/gg/skills/)'s on-use script, and as the code half of a
[memory](/gg/memories/) being written.

**The discovery surface is the grant's.** `docs.search` returns only what this agent may
call. A documentation view describes only what this agent may call. The prompt names only the
modules this agent has. A model following gg's own instructions is never pointed at something
it cannot use.

So a program *can* compile a call that search would never have shown it. That is accepted,
and it is safe for one reason, which every arm holds:

:::note
**Every toggleable function is namespaced, or requires an import.** A call the agent cannot
make never looks like an ordinary bare name.
:::

That is the condition the asymmetry rests on. A model does not stumble into a withheld call:
it has to write a qualifier that names gg. Per arm, it is held like this:

| Arm | How a call is written | What holds the condition |
| --- | --- | --- |
| TypeScript, JavaScript | `gg.files.readFile(…)`, `fs.readFile(…)` | The guest binds modules, never functions. No gg function is a bare identifier. |
| Python | `files.read_file(…)`, `gg.files.read_file(…)` | The scope binds capability *modules*; the functions live on them. |
| Ruby | `GG::Files.read_file(…)` | Module functions on constants under `GG`. |
| Rust | `files::read_file(…)` | The prelude glob-imports the modules, not their contents. |
| C++ | `files::read_file(…)` | The prelude's `using namespace gg;` elides `gg::` and nothing else. |
| C# | `Files.ReadFile(…)` | `global using Gg;` puts the namespace in scope. There is deliberately no `global using static` per module. |
| Java | `Files.readFile(…)` | On-demand imports of gg's *types*. `import static gg.Gg.*` — which put twelve free *values* in scope, `fs` among them — was removed for exactly this reason. |
| Kotlin | `gg.files.readFile(…)` | gg adds no import at all; a program writes the qualified name, or imports it itself. |
| Swift | `files.readFile(…)` | `@_exported import gg` re-exports the module enums; the functions are inside them. |
| PureScript | `Gg.Files.readFile` | Modules are imported by the program. |

## What a model sees

A refused call raises the arm's own gg failure type — the same one a failed tool raises, and
the one the prompt teaches a model to catch. On TypeScript that is `ToolError`, on Python
`gg.core.ToolError`, on Ruby `GG::Core::ToolError`, on Rust a `gg::core::ToolError` inside the
`Result` every call returns, on Java and Kotlin a `ToolError` exception, and so on. It carries
three fields, and all three matter:

- `.code` is `unavailable`, always, for this class of failure;
- `.tool` is gg's own key for the **call** — `read_file` for `fs.readFile`, `read_text_file`
  for `fs.readTextFile` — so a catch site can branch on the thing that failed without parsing
  prose. It is the call's key rather than the gg tool the call would have dispatched, because
  three operations share the `read_file` tool and a refusal has to say which of the three the
  model reached for;
- `.message` is the sentence, written in **this program's own spelling** of the call, because
  a message that quoted a name the model cannot type would be useless as an instruction.

The sentence names what is missing, never merely that something is:

```
`gg.files.readFile` is not available to you: it is bought by the gg tool `read_file`, which
this run's toolset does not offer.
```

```
`gg.programs.history` is not available to you: it is bought by the `program-library`
capability, which this agent was not given — this agent keeps no library of the programs it
has run.
```

An [ending call](/gg/ending-a-session/) belonging to another role says which endings the
agent *does* have, because an agent that reached for the wrong one has a right one:

```
`gg.session.finish` is not available to you: you were dispatched to review work, so your
session ends with a verdict — `gg.session.approve`, or `gg.session.requestChanges` naming
every change the work needs.
```

Because the failure is a value, a program can plan around it rather than stop:

```ts
try {
  gg.files.editFile(path, before, after);
} catch (error) {
  if (error instanceof ToolError && error.code === "unavailable") {
    gg.views.openText("blocked", `cannot edit: ${error.message}`);
  } else {
    throw error;
  }
}
```

## What it is recorded as

A refusal is opened and closed as an **API call** like any other, and counted as a failed
one. That count is the point: "the model reached for something this run does not offer it" is
precisely what a [toolset ablation](/gg/toolset-ablation/) is run to measure, and a refusal
that left no record would be invisible to it. The call also lands on the turn's refusal
roster, under gg's own `object.key` identity, so a cross-arm readout joins on a name every arm
agrees about.

:::tip[Count refusals from the roster, not from the turn error type]
The **refusal roster is uniform on all eleven arms** — caught or uncaught, whatever the guest
made of the throw. It is the record a cross-arm study should join on.
:::

If the throw is never caught, the turn's error is *usually* recorded as `program_unknown_name`
rather than `program_tool_error`, and the host decides that from the failure **code** rather
than from the guest's own reading, so that one event is one metric. That holds on nine arms.
It does not hold on two, and both were measured:

- **C#** reports every uncaught managed exception with kind `other` and no code at all, so an
  uncaught refusal is recorded as `program_throw` — and so is an uncaught `not-found`. That
  guest does not classify a `Gg.ToolException` by its code at any point.
- **Swift** has no top-level `throws` context its guest shell can wrap, so an uncaught error
  is not a program error at all: the runtime writes to stderr and traps the store, which
  arrives as a sandbox trap.

Changing either means rebuilding that arm's guest — a Mono shell and a Swift toolchain — so
they are stated here rather than papered over. Neither costs the measurement anything, because
the refusal itself is recorded identically on both; it is only the *uncaught* case's turn error
type that differs, and the roster does not care whether the program caught it.

## One more thing the four dynamic arms do differently

On TypeScript, JavaScript, Python and Ruby, a call's **arguments are lowered inside the guest**,
before the call crosses into the host — and the capability gate lives on the host side of that
crossing. So a call that is both *withheld* and *malformed* fails on the malformed half first.
Measured on JavaScript, with `add_task` withheld:

```js
gg.tasks.addTask(42);   // withheld, and not a task
// → invalid-argument | addTask | TypeError: expected a string, received [undefined]

gg.tasks.addTask({ id: "t1", title: "…" });   // withheld, well-formed
// → unavailable | add_task | `gg.tasks.addTask` is not available to you: …
```

The first never reaches the host, so it is not on the refusal roster. This is accepted rather
than fixed: closing it means asking the host "may I make this call?" before re-tagging a
lowering fault, which is a second reading of the capability question in a place that has no
business holding one. The seven compiled arms cannot present the case at all — a malformed call
does not compile — and the ablation count has a sound source in the roster for the calls that do
reach it.

## What gg still sends the guest, and why

The guest's `run` export still takes the run's enabled tool names, the agent's ending kind and
the program-library flag. **No guest reads any of them** any more — the four with their own
compiled-in guests (Rust, C++, Swift, C#) never did, and the three that built a scope from them
(the shared ECMAScript guest, Python's and Ruby's) have stopped. They are kept rather than
removed for two reasons: the WIT world is implemented by all eleven arms' guests, several of
which are large committed binaries rebuilt by hand, and gg does still answer those three
questions per run — at the membrane, in what a search will show, and in what the prompt names.
Removing a parameter would mean rebuilding every one of them to stop sending a value nobody
reads.

## How the committed artifacts are kept honest

Six arms commit a binary that a person rebuilds by hand. Three are guest components —
TypeScript (shared with JavaScript), Python and Ruby, each 14–25 MB of baked interpreter with
the SDK inside it. Three are compile inputs: the Rust library set, the Swift guest and library
archives, and the C++ guest archive, each carrying that arm's SDK as something a program is
linked or declared against.

Nothing in CI rebuilds any of them, and the reasons are good ones: the builds want
`componentize-js`, `componentize-py`, a ~200 MB wasi-sdk or an ~835 MB Swift toolchain, and two
of the six are not byte-reproducible, so a check that re-cut them would fail on every run over
bytes nobody edited.

That leaves one silent failure: a source edited without a rebuild, which leaves every program
of that arm evaluated by — or compiled against — what was committed, while the source in front
of a reader and the catalogue in the model's prompt describe something else. The checks that
did inspect these artifacts reached only part of it. `bound-tools` compares **tool names**, and
would have stayed green straight through the inversion above, which touched three guests' scope
builders and not one tool name. The C++ archive carries its SDK headers as source and they are
compared file for file — but not the bodies. The Swift archive carries the shell, not the SDK.
The Rust set carries no source at all.

So each build now writes a manifest beside its artifacts recording the SHA-256 of every source
it consumed — the SDK tree, and whatever else that arm's `build.sh` actually reads: a lockfile,
a pinned requirements list, a compiler configuration, the tool that lowers one arm's SDK — plus
each artifact's own digest, the toolchain pins, and a digest of the membrane's **declarations**
in `crates/gg/wit`. That last one is deliberately blind to the WIT's prose, which is most of
that file: a reworded comment must not demand a 25 MB rebuild, or whoever hits it will learn to
regenerate the manifest without rebuilding, which would make the whole mechanism worthless.

`crates/gg/src/sandbox/language/artifacts.test.rs` recomputes all of it from the checkout in
the ordinary test suite and fails **by arm name**, naming the files that moved, what a stale
artifact costs that particular arm, and the command that fixes it. A source edited, added or
deleted without a rebuild is a named failure rather than a silent correctness hole — and so is
a seventh committed binary arriving with no manifest at all, which the same file refuses.

**What this proves, and what it does not.** It proves an artifact matches the sources recorded
beside it. It does not prove the artifact was built *correctly* from them — that the build
compiled what it meant to, or that the guest behaves as the SDK reads. Those remain the job of
each arm's substrate, compile and surface tests, which run real programs through the real
membrane against these very artifacts.
