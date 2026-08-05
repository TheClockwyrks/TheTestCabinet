---
title: "Program languages"
---

Under [responses as code](/gg/responses-as-code/) a model answers a turn by writing a
whole **program** over its tools. Which *language* it writes that program in is a
**variable**, not a fact of the capability: gg registers a set of program languages, a
run picks one per agent, and every answer that used to be TypeScript's — how a reply
becomes something a guest can evaluate, which committed component evaluates it, what
that component needs from the host, how the prompt teaches it, which
[healing](/gg/response-healing/) questions have language-shaped answers — is asked of
that language rather than baked in.

TypeScript is the default and, today, the only registered one. This page is the design
of the seam: why the language is an axis, what an agent-facing surface has to look like
in *any* language, what a language must supply to be registered, what stops two
languages from quietly describing different capabilities, and what adding a second one
actually costs.

## Why the language is an axis at all

The capability itself exists to answer one A/B question: **do code-shaped responses help
a model tackle the large [Hard](/testing/end-to-end/) cases?** Freeze the model, the test
case and the rest of the [capability set](/gg/overview/#the-capability-set), vary the one
toggle, and the difference is attributable to the shape of the response.

The moment that question is worth asking, a second one follows it: **does the language a
model writes its program in change how well it works?** It is not an idle question. The
arms differ in how much of the language was in the model's training data and how recently
its idioms moved; in how much a model has to write before it has said anything (a
TypeScript type annotation costs tokens a Python signature does not, and buys nothing here
because nothing type-checks it); in what a model's *reflexes* cost it — `await` is the
first thing many models reach for in JavaScript, and the sandbox is synchronous, so the
reflex costs a [healing](/gg/response-healing/) repair or a refusal; in how a language
handles a failure, and therefore how naturally a program written in it composes calls that
can throw.

None of that is answered here. The point is that it is a *question a harness can answer by
running two arms* — and that gg could not answer it at all while the language was a fact
rather than a variable. So the language is one:

- it is a param of the [`responses-as-code`](/gg/responses-as-code/#configuring-it)
  capability (`language`), resolved **per agent**, so a run may in principle drive a root
  in one language and a reviewer subagent in another;
- an unreadable value changes **nothing** and is reported at launch, on the same terms
  every unreadable param is — reading `"pythn"` as Python would be bad, and reading it as
  TypeScript *without saying so* would be worse, because the run would then be recorded
  under a language nobody chose;
- and the answer is recorded as a **scalar** in two places — `summary.programLanguage`
  and each `agent_surface` event's `programLanguage` — so a
  [query](/gg/analysis/query-language/) slices arms on it with no new vocabulary. Both are
  absent for a tool-calling agent, which has no program language at all, as against an
  unknown one.

## The rules an agent-facing surface obeys in every language

A language is free to spell things its own way. It is not free to change **what the model
is looking at**. Five rules hold in every language, and each of them exists because of who
the caller is: a language model, working from a signature it read once, writing a whole
program before it sees a single result.

**1. Capabilities arrive as typed, standalone, namespaced bindings** — `fs.readFile(path)`,
`system.shell(command)` — and never as a generic dispatcher taking the capability name as
data (`call("read_file", {…})`). A dispatcher moves the whole surface out of the type
system and into a string the model has to remember; every mistake it enables is a runtime
one, discovered a turn later, with a message that can only say *no such tool* rather than
*that argument is the wrong shape for this call*. Namespacing is part of the same rule and
not decoration: `fs.` and `system.` are how the model knows what it has, and the object
names are [identity](#the-agreement-gate) rather than spelling for exactly that reason.

**2. Every call is synchronous.** Nothing returns a promise, a future or a coroutine.
There is no event loop inside the guest, so an `await` has nothing to yield to — but the
deeper reason is that a program is written in one shot, blind. Concurrency is the feature
most likely to make a program *look* right and do nothing, and its failure mode here is
the worst one available: work that never ran, on a turn that reported success.

**3. No strings-as-enums where a fixed choice exists.** A parameter that accepts one of
four values is a typed value in the SDK, not a free string. A model that guesses the
spelling of a string constant guesses wrong roughly as often as it guesses right, and a
string it guessed wrong is a runtime error where an enum member is a name it either has or
does not have.

**4. Neither an argument nor a result is a JSON document.** The model never hand-assembles
JSON to make a call, and never parses JSON to read the answer. A result is a typed value
whose fields the program reads directly. Model-authored JSON is the failure mode this whole
capability was built to get away from: it is the tool-calling surface's one untyped door,
and putting it back *inside* the program would mean a model that got its program right
could still get its arguments wrong in a way nothing but the host can see. The same holds
in reverse — a result that arrives as a document has to be parsed by the program before it
can be read, and a parse is a place to be wrong about a shape the SDK already knows.

**5. Required arguments are positional; optional ones use the language's own idiom.**
Required-positional is what makes the common call short enough to write from memory, and
what makes a missing one impossible to write by accident. Optional arguments are the half
that is *not* fixed across languages: TypeScript takes a trailing options object, and
Python would take keyword arguments, because those are what each language's readers and
writers expect. The SDK bridges its idiom to the wire; the model never sees the bridge.

Two things fall out of this list. First, every rule is about **what the model can see the
exact type of** — a capability whose exact type is not visible is one the model calls
wrong, and it discovers that a turn later, having spent the turn. Second, these rules are
what a cross-language study **holds constant**. If one arm's surface were less typed than
the other's, the study would be measuring the surface and reporting it as the language.

## The SDK is hand-written, and native

Each language's SDK is authored by hand and reads as **idiomatic code in its own
language**. It — never the model — is what bridges that idiom onto the WIT wire.

This is the expensive answer, and the cheap one is obvious: generate the SDK from the wire
schema. The WIT is already a complete, typed description of ~55 functions; a generator
would emit a binding per function, for every language, for free, and it could never drift.

It is still the wrong call, for a reason that has nothing to do with effort. **A generator
emits only what its schema can express.** Point one at a set of typed functions with
optional record fields and it converges — reliably, in every language — on flat functions
taking one keyed argument object, because that is the shape that survives translation from
anything to anything. And a flat function taking one keyed argument object *is the model
authoring a document by another name*: rule 4 broken by construction, with the parameter
list replaced by a bag the model has to fill in correctly from memory. Everything a native
SDK does for its reader — a keyword argument with a real default, an enum member with a
real name, an exception where the language's readers expect an exception, a result the
IDE and the model's own memory can both complete — is precisely the material a schema
does not carry, because it is knowledge about the *language*, not about the wire.

The measurement argument closes it. The thing being compared across arms is *what it is
like to write a program in this language against this surface*. An SDK that is not
idiomatic makes the arm a measurement of a foreign-looking API rendered in the language's
syntax, which is not the question.

**Codegen still belongs — one layer down.** The generated WIT bindings are exactly where a
generator should be: below the SDK, where the concern really is a mechanical lowering of
typed values across a membrane and where nobody reads the output. The hand-written layer
sits on top of them and is thin — it validates a few argument shapes the wire cannot
(an options object that arrived as a bare number, a negative `offset` that would wrap), maps
the wire's `result<T, tool-error>` onto the language's own failure idiom, and gives every
function the name and shape its language would give it. That layer is small enough to write
and read, and it is the whole of what the model sees.

## What a language supplies

A registered language is one implementation of gg's `ProgramLanguage` trait
(`crates/gg/src/sandbox/language.rs`) plus a pair of committed artifacts. The trait is
object-safe and the registry is an exhaustive `match` **derived from the core enum**, so a
language added to the enum does not compile until it is registered, and once it is, it is
instantly in every gate that iterates languages.

| What it supplies | Why it belongs to the language |
| --- | --- |
| An **id** and a **display name** | The id is the config value, the telemetry value and the stem of its committed artifacts; the display name is what the model reads in its prompt and its diagnostics. |
| **Preparing a program** | Turning a model's reply into source its guest can evaluate. TypeScript's is the `oxc` type-strip, the early-error check, the refusals for module syntax and top-level `await`, and the stack sizing an unguarded recursive-descent parser forces on untrusted text. |
| **Preparing a module** | Turning a [code skill](/gg/skills/#code-skills)'s or [code memory](/gg/memories/#code-memories)'s file into something whose evaluation yields a namespace, bound at `lib.<key>`. |
| Its **guest component** | The committed `.wasm` that evaluates the prepared source, embedded in the binary. |
| Its **host requirements** | What that component needs from gg's linker. [Below](#the-linker-requirement). |
| Its **signature catalogue** | The committed JSON reflected out of its own SDK — the signatures and documentation the model reads through `object.list()` and `view.openDocsView()`. |
| A **healing dialect** | The language-shaped questions [response healing](/gg/response-healing/#the-skeleton-and-the-dialect) asks: which fence tags mean "this block is the program", which lines are certainly code and which are certainly prose, which bytes of a source are code rather than string or comment, what an import statement looks like, what makes a binding the language refuses to see twice, and what a whole-program concurrency wrapper looks like. |
| A **prompt dialect** | Its own `system-code.<id>.hbs` and `code-nothing-shown.<id>.hbs` templates, and the handful of spellings gg itself has to quote back — the four [ending calls](/gg/ending-a-session/#ending-calls) and the call that closes a view. |
| **Healing fixtures** (tests only) | Replies its own dialect must survive, so that healing's delete-only invariant is re-earned per language rather than inherited. |

Its two committed artifacts follow one convention:
`crates/gg/src/sandbox/guests/<language-id>.component.wasm` and
`<language-id>.signatures.json`. Both are checked in and embedded, which is what means no
build or CI step ever needs a componentizing toolchain.

The prompt is **per language and not one template with branches**, which looks like
duplication and is not. The shared tail quotes the SDK's own spellings at nearly every
bullet — `skills.readSkill(name)`, `project.createIssue`, `view.openText`,
`JSON.stringify` — and function spelling is precisely what the seam declares free to
differ. A merged template would need a branch at almost every line, and adding a language
would mean editing the one file every language shares. It is also operator-facing surface:
the console's prompt-override editor is seeded from it, and an operator overriding the
prompt is overriding it for the language they are running. What a copied template can lose
is a whole section, so that is [asserted](#the-agreement-gate) rather than trusted: every
registered language's prompt must render, under every context fixture, carrying every
required section.

### What the host checks, and what a language must not be trusted with

A language's SDK is **not** part of gg's capability model, and this is the one place the
seam had to move for a second language to be safe.

TypeScript's guest builds a program's scope out of the run's enabled tool names, its
agent's [ending group](/gg/ending-a-session/) and its
[program-library](/gg/program-library/) flag, and evaluates the program as the body of a
function whose parameters are exactly those names — so a withheld call is an undefined
identifier rather than a call that reaches the host. That is an excellent enforcement
mechanism and it is entirely the *guest's*. A language whose SDK is linked as an ordinary
library — an import, a package, a namespace the compiler resolves — has no scope to leave
anything out of, and every name is there whatever the run offers.

So the membrane holds all three facts itself and refuses anything outside them
`unavailable`: a tool outside the enabled set, an ending outside this agent's role, a
library call from an agent that keeps none. Nine of those checks were already there for the
tools; the six that were not — the three ending calls and the three library calls — were
reachable only through scope construction, which is to say reachable only for as long as
gg had exactly one language. A standard agent that could call `approve` would hand back a
verdict on its own work, and gg reads a reviewer's answer straight off the ending it
declared without ever re-asking whose it was.

Two consequences for a language being added:

- **A new SDK is free to expose the whole surface**, and should: a function it cannot
  reach is a function a doc view cannot show, and hiding one per run is a per-run artifact
  where the point is that every arm sees the same surface. Prompts never advertise a
  disabled capability, `object.list()` filters them, and calling one is an error — from the
  host.
- **The refusal is not the model's own failure.** `unavailable` is recorded as the same
  turn error a missing name is, and gg decides that from the failure *code* rather than
  from what the guest made of the throw — otherwise the identical event would be counted
  one way in a language that can withhold a name and another way in a language that
  cannot.
- **A refusal that names a call names it in this language.** Every one of these sentences
  ends by telling the model what to call *instead* — an agent doing work is pointed at
  `harness.finish`, a reviewer at `review.approve` — and an instruction is only useful if
  the model can write what it names. gg's own vocabulary is `snake_case` and belongs to no
  SDK, so the alternatives are resolved from the run language's catalogue at the moment of
  the refusal, the same way the prompt resolves them. Both fields of the error say
  something different on purpose: the message is that instruction, and the error's `tool`
  field stays gg's own name for the call, because it is an **identity** a catch site
  reports rather than a name the program writes.

### The linker requirement

This is the part that is easy to miss, and the empirical finding that shaped the seam: **a
language is not merely a source dialect plus an SDK.** It also has to declare what its
component needs from the host.

gg's TypeScript component is baked with *every* WASI capability disabled — no filesystem,
no clock, no randomness, no network, no module system — so gg's linker provides no WASI at
all. That is not frugality for its own sake. It is half of the trust boundary (what the
membrane does not declare does not exist inside the guest) and half of
[determinism](/gg/responses-as-code/#determinism): a code turn has to be reproducible, both
so two runs of the same program are comparable and so [replay](/gg/replay/) means what it
says.

A guest built from a general-purpose runtime is not so frugal. A component built with
`componentize-py` imports the **full WASI p2 surface** — `wasi:cli`, `wasi:filesystem`,
`wasi:sockets`, `wasi:clocks`, `wasi:random`, `wasi:io` — whether or not the program uses
any of it, because the runtime it embeds is linked against the whole of it. The host would
have to answer for every one of those imports before such a component could instantiate at
all.

So the requirement travels **with the language**, as data, and gg's linker matches on it
exhaustively. TypeScript's answer is "nothing beyond the sandbox world". A second variant
is where a WASI-needing language lands, and it must name not just the surface but **how
each nondeterministic capability is pinned** — a fixed clock, a seeded RNG, a denied
filesystem and socket set — because that is what replay's exactness rests on. Adding the
variant makes the linker fail to compile until it is handled, which is the pressure the
type exists to apply: the seam is enforced by the compiler, not by this paragraph.

## The agreement gate

The seam says the only thing free to differ between two languages is **spelling**. That is
not left as a convention anyone is asked to remember; it is asserted, for every registered
language, on every test run.

gg builds an **identity** for each function a language's catalogue describes, and compares
the sets:

- **Identity** — the section it sits in, the **object** it hangs off (`fs`, `view`,
  `harness`), its language-independent **key** (a tool's is its gg tool name;
  `request_changes` and `open_text` are the carve-outs' own), the gg tool that **gates**
  it, the ending **role** whose programs bind it, and whether it belongs to the
  [program library](/gg/program-library/). None of it may differ.
- **Spelling** — the name a program calls, the signature it is declared with, and the
  prose that documents it. Compared for nothing except being present, unique within its
  object, and consistent with each other.

Each language is additionally anchored to **gg's own vocabularies**: its tools in exact
bijection with the tool registry's, its component binding exactly those tools, its ending
calls exactly the four the tool-calling arm dispatches and each bound to the role gg gives
it, every gate a real tool name, `view.openFile` gated on `read_file` and the rest of the
view surface gated on nothing, and every type a signature mentions declared in its own
catalogue.

**Why it is load-bearing for the experiment:** its absence is *silent*. Each language's own
drift gates compare it to gg's tool vocabulary and to its own committed component — never
to another language. Two internally consistent surfaces that disagree with **each other**
are therefore two green test suites, and an A/B across them measures the difference in the
surface while reporting it as a difference in the language. This gate is the only thing
standing between a configured `language` param and an invalidated study.

It returns its complaints rather than asserting them, so its own failure mode is testable:
a gate that can be shown to pass but never shown to *catch* anything is a gate nobody knows
works. Its tests hand it deliberately damaged catalogues — a missing `edit_file`, a
renamed object, a view function gated on the wrong tool, an ending offered to the wrong
role — and assert on what comes back.

With one registered language the comparative half degenerates to "equals itself" and the
anchored half does not, which is why the gate earns its place today. The comparative half
is nonetheless exercised on every run, against a **fixture language** that exists only
under `#[cfg(test)]`: a second implementation of the whole seam whose catalogue is
TypeScript's own, re-spelled to `snake_case` at test time — same keys, same objects, same
gates — with its own line-oriented preparation step, its own healing dialect and its own
prompt templates. It is derived rather than copied, so it cannot rot; it has no wire id,
so it can never be configured, recorded or run; and it is deliberately not in the registry,
so nothing that iterates registered languages pays for it. What it buys is that every claim
the seam makes is *observed* rather than asserted — that the healing skeleton asks the
dialect rather than knowing TypeScript's answers, that a prompt is selected per language
rather than shared, that no language can be served another's artifacts.

## Adding a language, worked: Python

A second language is **additive**. Nothing in `packages/gg-sandbox/` changes when it lands,
and neither does the WIT, the host's `ToolApi`, the membrane or the gate model.

### What was measured

A spike answered the questions that could have made this a redesign rather than an
addition, and the answers were good:

| Question | Finding |
| --- | --- |
| Does another toolchain bind gg's existing WIT world? | **Yes.** `componentize-py` generates clean Python bindings for this exact world — 14 interfaces, ~55 typed functions with real records, enums and variants. WIT is a language-neutral IDL and behaves like one; no generic `call(name, json)` fallback was needed anywhere. |
| What does baking one cost? | **~1.3 s**, which is a hand-run build step, not a problem. |
| How big is the artifact? | **~17.5 MB**, against the JavaScript guest's ~13.4 MB. Larger, and the same *kind* of number: both embed a whole runtime. |
| What does it import? | The **full WASI p2 surface** — `wasi:cli`, `wasi:filesystem`, `wasi:sockets`, `wasi:clocks`, `wasi:random`, `wasi:io`. |

The first three are cheap facts. The fourth is the open question.

### The open decision: WASI, and what it costs determinism

gg's linker provides no WASI, so a `componentize-py` guest **cannot instantiate today**.
There are three ways out, and this is deliberately recorded as an *open* decision rather
than a settled one, because the trade is real:

1. **Bake the imports away.** Investigate whether the guest can be built (or post-processed)
   against a stubbed WASI, in the way the JavaScript guest is baked with every capability
   disabled. Best outcome if it works — determinism is preserved by construction and
   nothing about the host changes — and the least certain, because the imports come from
   the embedded runtime rather than from the program.
2. **Provide a pinned, deterministic WASI.** Add the new `WasiSurface` variant and give the
   guest a host implementation in which every nondeterministic capability is nailed down: a
   fixed clock, a seeded RNG, a denied filesystem, denied sockets. Workable, and the cost is
   that determinism stops being structural and starts being a thing gg maintains — every
   capability is a place where an unpinned answer would make a code turn irreproducible and
   [replay](/gg/replay/) subtly wrong.
3. **Provide ambient WASI and give up replay for that arm.** Cheapest to build and the only
   option that changes what the capability *means*. A guest with the ambient host is a guest
   whose turns cannot be reproduced, which would make the Python arm of a study a different
   kind of object from the TypeScript arm — so this is listed for completeness and is the
   least attractive of the three.

Whichever is chosen is the language's declared `HostRequirements`, and the exhaustive match
in gg's linker makes the choice explicit rather than incidental.

### The steps

1. **A sibling guest directory** — say `packages/gg-sandbox-python/`, with a `pyproject.toml`
   and its own build script driving `componentize-py`. It is not an npm workspace and shares
   no code with the TypeScript package.
2. **Bind the one WIT.** `crates/gg/wit/gg-sandbox.wit` is the wire and there is exactly one
   copy of it. The guest binds it directly.
3. **Hand-write the SDK**, idiomatic for the language, obeying the
   [five rules](#the-rules-an-agent-facing-surface-obeys-in-every-language) above.
4. **Emit a catalogue** at `crates/gg/src/sandbox/guests/python.signatures.json`, in the same
   shape, with `language: "python"` and the same `key`s. It need not use the TypeScript
   package's reflector — only the emitted JSON is contractual, and a Python guest would
   reflect its own docstrings and type hints with its own script.
5. **Commit both artifacts** under `crates/gg/src/sandbox/guests/`.
6. **Add the enum variant** in `crates/core/src/gg.rs`, and list it in `GgProgramLanguage::ALL`
   with an `ordinal()` arm. Neither is optional and neither can be forgotten: `ordinal()` is an
   exhaustive `match`, so the variant does not compile without an arm, and each arm checks its
   own position against `ALL` in a `const` block, so an arm for a language missing from the list
   is a build failure. gg then does not compile until the registry has an arm for it either.
7. **Implement the trait** in `crates/gg/src/sandbox/language/python.rs`: the preparation
   step, the binding-name convention, the synthesized file-view statement, the healing dialect,
   the prompt dialect, the two templates (`system-code.python.hbs`,
   `code-nothing-shown.python.hbs`), the host requirements, and the healing fixtures its dialect
   must survive.
8. **Add a line to `scripts/ci/contract-drift.sh`** regenerating the new guest's catalogue, so
   the drift gate covers it rather than only diffing it.
9. **Add the console's row**: an option in `PROGRAM_LANGUAGE_OPTIONS`
   (`packages/ui/src/app/pages/runs/gg/ggCatalog.ts`) so an operator can configure the arm, and a
   name in `PROGRAM_LANGUAGE_NAMES` on the Reference page. Both are typed over the
   `GgProgramLanguage` union, so a missing row is a TypeScript error rather than a language
   nobody can pick. The prompt editor needs nothing: `npm run gen:contract` discovers
   `system-code.*.hbs` from the directory and mirrors every one.
10. **Run the gates.** The agreement gate compares the new catalogue against TypeScript's
    identity-for-identity; the prompt gate renders the new templates under every context
    fixture and checks every required section; the healing invariant re-earns delete-only over
    the new dialect's own fixtures **and** over the shared round-1 corpus.

Every step in that list is either a new file the language owns, or a one-line registration the
compiler refuses to let anyone skip. Nothing edits another language's implementation, which is
the property the seam was built for.

### What "native" means, concretely

An idiomatic Python SDK is not the TypeScript one transliterated. The differences are the
point, and every one of them is a spelling rather than an identity:

- **Keyword arguments, not a trailing options object.** `fs.read_file(path, limit=200)`
  where TypeScript writes `fs.readFile(path, { limit: 200 })`. Required arguments stay
  positional in both.
- **`snake_case` throughout** — `request_changes` for `requestChanges`, `open_text` for
  `openText`. The catalogue's `key` is what lets gg tell that those are the *same function*,
  which is exactly what it is for.
- **`None`, not `undefined`.** An absent optional is `None`, and an optional field of a
  result is `T | None` rather than `T | undefined`.
- **Exceptions for the wire's error arm.** WIT's `result<T, tool-error>` becomes a typed
  exception raised at the call site — `except ToolError as e: if e.code == "conflict":` —
  rather than a `ToolError` object thrown by hand. Same inversion, same reason (a surface
  where every call returns `(ok, output)` forces a branch after every line and makes a
  composed program unwritable), spelled the way the language spells it.
- **Dataclasses and enums for results and fixed choices**, so a field is read as
  `entry.kind is EntryKind.FILE` rather than by string comparison, and the model's editor
  and the model's memory can both complete it.

What must not differ: which functions exist, which object each hangs off, what gates each
one, and the [five rules](#the-rules-an-agent-facing-surface-obeys-in-every-language). A
Python SDK that offered `call("read_file", {...})` would be a smaller diff and a different
experiment.
