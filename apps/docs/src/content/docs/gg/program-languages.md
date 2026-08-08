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

Ten are registered, and between them they separate four things that used to be one. TypeScript
is the default, and its programs are **type-checked** before they run; **JavaScript** is that
same arm with the [type check removed](#javascript-the-same-arm-unchecked) and nothing else
changed; **[Python](#python-a-guest-that-carries-its-own-interpreter)** is the first arm that is a
different language rather than a variation on one, and nothing reads its programs before the
interpreter does; **[Ruby](#ruby-compiled-to-javascript-before-it-crosses)** is
**compiled without being typed** — a real compiler reads the whole program and may refuse it,
with no type system anywhere;
**[PureScript](#purescript-a-compiler-in-the-image-a-library-set-in-the-binary)** is the far end
of that axis, **compiled and totally typed** by a real compiler that lives in the run image
rather than inside gg; **[Java](#java-a-warm-jvm-and-two-compilers-per-program)** is the arm a
study reads for what a *big* compile costs, since its program passes through two compilers inside
a JVM gg keeps warm between programs; **[Kotlin](#kotlin-a-program-that-is-a-script)** rides
that same road from bytecode onwards, which makes the pair the closest thing this seam has to a
**controlled experiment on the language itself** — one toolchain, one guest, one classlib, two
surfaces written the way each language is really written; and
**[Rust](#rust-the-program-is-the-artifact)** is the fourth thing: the first arm that ships **no
guest at all**, because its compiler produces the program rather than something that later reads
one; **[Swift](#swift-the-reply-is-the-artifact-verbatim)** is that same shape reached down a
different road, compiling a model's reply **byte for byte** while still admitting `extension`,
`protocol` and `import` in it; and **[C++](#c-the-prelude-is-precompiled-and-the-exceptions-work)**
is the third of that shape and the cheapest of the three per turn, because the whole of what a
program is compiled against is precompiled once per machine — it is also the only arm whose guest
has a working **exception** mechanism, and the only one where a failure the language caused can be
hard to tell in the run record from a model that reasoned badly. This page is the
design of the seam: why the
language is an axis, what an agent-facing surface has to look like in *any* language, what a
language must supply to be registered, what stops two languages from quietly describing different
capabilities, and what adding another actually costs.

## Why the language is an axis at all

The capability itself exists to answer one A/B question: **do code-shaped responses help
a model tackle the large [Hard](/testing/end-to-end/) cases?** Freeze the model, the test
case and the rest of the [capability set](/gg/overview/#the-capability-set), vary the one
toggle, and the difference is attributable to the shape of the response.

The moment that question is worth asking, a second one follows it: **does the language a
model writes its program in change how well it works?** It is not an idle question. The
arms differ in how much of the language was in the model's training data and how recently
its idioms moved; in how much a model has to write before it has said anything, and in
what those tokens buy — a type annotation costs tokens and buys a
[checked program](/gg/responses-as-code/#stripped-and-checked); in what a model's
*reflexes* cost it — `await` is the
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

## JavaScript: the same arm, unchecked

The second registered language is the narrowest one gg could have, and that is the point of
it. **JavaScript is TypeScript with the `tsc` pass taken out.** Same committed component,
same hand-written SDK, same signature catalogue, same type-strip, same healing dialect. One
difference: gg does not check the program before evaluating it.

It exists because the check is a **bet**. Type-checking a program costs ~90 ms and some
tokens of annotation every turn, and buys a class of mistake caught before any work happens
rather than a turn later, in a `TypeError` half way through a piece of work. Whether that
trade is worth taking is not a thing to argue about — it is an A/B, and an A/B measures the
check only while the check is the *only* thing that differs.

So every other variable is held at zero by construction:

| Held constant | How |
| --- | --- |
| The evaluator | JavaScript serves TypeScript's committed component, reached through the constant rather than embedded a second time. Two byte-identical 13.4 MB `.wasm` files would be a second copy of one artifact and a standing chance for the one thing the arms must share to diverge. |
| The surface a model reads | Its catalogue is the same declarations reflected under a second id — **including the type annotations**. A model on this arm reads `readFile(path: string): FileRead` exactly as a model on the other does. Stripping the types out of what the *prompt* shows would have made the arms differ in how much the model was told about the surface, which is a second variable and a bigger one than the check. |
| What a program may contain | The same strip. A program that annotates its own bindings runs here too — the annotations are erased rather than rejected. "JavaScript" on this arm means *a program nothing checked*, not a narrower grammar. |
| How a reply is read | The same [healing dialect](/gg/response-healing/): healing is a lexical reading of a reply, and the two arms are one syntax. |

What is its own: the id, the display name, and the two prompt templates. The prompt names
the language the model is writing, and it carries no section claiming the program is
checked, because it is not. It does not announce the *absence* of a check either — that is
the arm's variable, not a rule the model is being taught, and a prompt that dwelt on it
would be measuring a sentence. What it does add is one paragraph the checked arm does not
need: that the signatures below are written with annotations, which a program may use or
leave off. Without it, a model told it is writing JavaScript and shown a typed signature
has been handed a contradiction to resolve on its own.

The sharing is **declared**, not merely unnoticed. The seam's rule is that no language is
served another's artifacts, and the gate that asserts it now walks every pair of registered
languages; this pair is named in its exemption table with the reason above, and is held to
something stronger than the rule — the bytes must actually be identical, or the exemption
is covering for something else.

One consequence worth naming, because it is the first time gg has had it: JavaScript is a
registered language whose programs report **no compile time at all**. `compileMs` is absent
rather than `0`, on exactly the terms the next section describes.

## Python: a guest that carries its own interpreter

The third registered language is the first that is a **different language** rather than a variation
on one, and it is the arm that makes the seam's claims falsifiable in production rather than only
under `#[cfg(test)]`: a different SDK, a different guest, a different healing dialect, a different
prompt, and — for the first time — a call whose arguments are passed **by name**.

Everything it owns is in `crates/gg/src/sandbox/language/python.rs` and
`packages/gg-sandbox-python/`, and the one structural thing to know about it is where the language
lives:

**There is no compiler on the turn path, because CPython is inside the artifact.**
`componentize-py` links a real CPython 3.14 against `crates/gg/wit/gg-sandbox.wit`, so a program
crosses the membrane as *source* and the first thing to read it is the interpreter that runs it.
Nothing is installed in the run container and nothing is added to the
[gg toolchain layer](#where-a-compiler-lives-and-what-it-must-never-share) — this arm is the
demonstration that a language can be added without one.

Three consequences follow from that, and each is a fact about the arm rather than a preference:

| | What it means here |
| --- | --- |
| **Preparing a program does nothing** | The bytes the model wrote are the bytes the guest evaluates. Not a placeholder: there is no host-side Python for a prepare step to run. |
| **`checker()` is `None`** | Nothing judges a program before it runs, so `compileMs` is absent rather than `0` — the same branch [JavaScript](#javascript-the-same-arm-unchecked) takes, reached for a completely different reason. |
| **A syntax error is a run-time error** | It arrives as a located `ProgramError` carrying CPython's own message and the program's own line and column, not as a `transpile_syntax` turn. The model reads the same thing; the band it is recorded under is the honest one for an arm where nothing read the program first. |

A Python parser on the host was considered and rejected. It would buy the `transpile` band and a
marginally earlier diagnostic, and it would cost a **second implementation of Python's grammar**,
lagging the interpreter that actually runs the program and refusing valid programs written in syntax
the guest accepts — CPython 3.14 takes template strings and no third-party parser does yet. A false
rejection is a turn spent rewriting a correct program, which is the misattribution this codebase
spends the most effort not making.

### Its dialect says "no" three times, and each "no" is a decision

[Healing](/gg/response-healing/) asks every language the same lexical questions. This arm answers
three of them differently from the ECMAScript pair, and the differences are worth reading as a group
because they are what a second real language looks like: not a translation, but a different set of
things that are true.

| Question | This arm's answer | Why |
| --- | --- | --- |
| Is this line an import? | **Never** | The ECMAScript guest is baked with no module system, so every `import` there is dead text. This guest is a whole CPython: `import json` runs, `from gg import ToolError` runs. There is no lexical shape that is *certainly* dead, and deleting a working line is the failure the subsystem exists not to commit. `drop-imports` therefore never fires here. |
| Does this text redeclare something the language refuses twice? | **Never** | Python has no such rule. `def main():` twice is legal and a program pasted twice *runs twice*, so `drop-duplicate-program` has no proof that the deletion changes nothing and gives itself up. The coarser `drop-doubled-response` — a transport artefact, and the one strategy that asks a dialect nothing — still fires. |
| What is the whole-program concurrency wrapper? | `import asyncio`, an `async def`, and `asyncio.run(main())` — **three parts** | Python's runner is a *module* rather than a keyword. Unwrapping the middle and leaving the first would produce a program whose first line raises `ModuleNotFoundError`, since this guest is deliberately baked without `asyncio`. So the import comes off with the wrapper, which is how the arm can answer "no import is ever deleted" and still deliver the repair the pipeline's imports-before-async ordering was built to enable. |

One smaller difference is worth naming because it looks like a bug and is not. `#` opens a Python
comment **and** a Markdown heading, and nothing lexical tells them apart — so a `#` line is never
deleted as prose. A model that headed its explanation `## Plan` keeps that heading in its program,
where the interpreter reads it as a comment and it costs nothing. The alternative is deleting the
model's own comments, which is a deletion of code.

The `await` deletion differs too, in one byte: this arm takes the whitespace after the token with
it. `    await work()` dedents to `await work()`, and deleting the token alone would leave ` work()`
— a line opening with a space, which is an `IndentationError` rather than a program.

### What "native" bought, in the catalogue

The SDK is [hand-written](#the-sdk-is-hand-written-and-native) and reads as Python reads, and the
[agreement gate](#the-agreement-gate) accepts every one of those choices as spelling: `snake_case`
throughout, keyword arguments with real defaults rather than a trailing options object, frozen
dataclasses for results, enums for fixed choices, `isinstance` narrowing rather than a discriminant
field, a raised `ToolError` for the wire's error arm, an `UNCHANGED` sentinel where `None` already
means "clear it", and a record's fields spelled as the function's own arguments.

The measurable consequence is that this is the **first registered arm to emit `kind: "keyword"`** —
69 positional parameters and 31 keyword ones — which turns that half of the catalogue schema from a
shape nothing produced into a shape a gate reads.

## Ruby: compiled to JavaScript before it crosses

The fourth registered arm, and the first that is **checked without being typed**: `language:
"ruby"` is a value an operator configures, and a Ruby program is read whole by a real compiler
in a real process before it runs, with no type system anywhere in sight.

**A Ruby program is compiled to JavaScript on the host by Opal, and evaluated by a guest with
Opal's runtime, gg's Ruby SDK and the libraries a program may require all pre-initialised into
it.** Nothing crosses the membrane as Ruby, and everything the compiled program is evaluated
*against* is Ruby.

That single sentence is what makes this the cheapest arm gg has added, and it is cheap in both
of the places a language arm is usually expensive:

| | |
| --- | --- |
| **Nothing is installed in the run container** | Opal's compiler is *itself* Ruby compiled to JavaScript — a self-hosted build — so it is 2.9 MB gg carries inside its own binary (`crates/gg/src/sandbox/checkers/ruby.opal.cjs`) and runs with the `node` every run image already ships. This is the first arm to take the "[a compiler small enough to *be* an artifact](#the-steps)" route for a language that is not TypeScript, and [the toolchain image](#where-a-compiler-lives-and-what-it-must-never-share) gains a paragraph rather than a toolchain. |
| **No second engine** | The compiled program is JavaScript, so the guest is `componentize-js`'s, not a second runtime linked against the WIT. |

### Where Opal's runtime lives is the whole design

The one open question was where Opal's 743 KB runtime goes, and it was settled by measurement
before anything was built. Through gg's own store and linker, on this repository's dev
container:

| Where the runtime lives | Per program |
| --- | --- |
| Prepended to the program, evaluated in the committed ECMAScript component | 45.6–51.0 ms |
| Imported by the guest's entry module, so `componentize-js` pre-initialises it | **2.1–2.6 ms** |
| (a plain JavaScript program on the same component, for scale) | 1.2–1.4 ms |

`componentize-js` executes the entry module's top level at build time under `wizer` and
snapshots the resulting heap, so the corelib is built **once, into the artifact** instead of once
per turn. That is a twentyfold difference, paid out of the guest's own
[execution budget](/gg/execution-limits/) on every program — and two further findings would each
have settled it on their own:

- **A code module could not have seen a prepended runtime.** A [skill](/gg/skills/)'s or
  [memory](/gg/memories/)'s module is evaluated *before* the program and against the same scope,
  so a runtime living inside the program's own source would not exist yet when the module ran.
  `lib.<key>` in Ruby would have been unimplementable.
- **Baking it into the *shared* component was worse.** It would put `globalThis.Opal` in front of
  the TypeScript and JavaScript arms as well, and those two must differ in
  [the type check and in nothing else](#javascript-the-same-arm-unchecked) — a checked program
  cannot name `Opal`, because no declaration covers it, and an unchecked one can.

So this arm has a component of its own (`ruby.component.wasm`, ~20 MiB), and the seam's
"[no language is served another's artifacts](#what-a-language-supplies)" rule is satisfied
outright rather than by an exemption. A test asserts that this component's imported interfaces are
**exactly** the ECMAScript guest's, so a capability on one side only is a failing test rather than
a confound.

Two things it does that no SDK could do for itself are worth naming, because both were silent
failures before they were fixed. Ruby's `$stdout` and `$stderr` are pointed at `console` on every
run — Opal picks its write procedure once, at load, and captures the `console` that existed while
`wizer` was pre-initialising the component, so without it `puts "hello"` logs nothing at all. And
every array the membrane hands back is **re-made in this module's realm**: the generated bindings
run against a different set of intrinsics (the same split that makes `instanceof Error` answer
false for a binding-level fault), so an array they built carries *their* `Array.prototype`, which
Opal never patched — and `entries.map { … }` on a value the program was *handed* would fail with
`$map is not a function`, which is the worst shape of failure available: correct Ruby, refused.

### What compiling costs, and what it buys

Measured on the same machine, one process per compile: loading Opal takes ~100–110 ms, compiling
a representative program ~50 ms, and the whole invocation including `node`'s own start
**~176–190 ms**. Against TypeScript's ~91 ms this is the more expensive checked arm, and the
figure is [recorded](#what-compiling-costs-and-where-it-is-recorded) rather than argued about.

Two ways to roughly halve it were measured and neither is taken yet: a **Node startup snapshot**
(`node --build-snapshot` over the bundle produces a 16 MB blob that starts with Opal loaded; a
compile through it measures 90–95 ms and the output is byte-identical), and a **pooled warm
process** ([`CompilerPool`](#what-a-language-uses-instead-and-where-it-comes-from) driving a
resident `node`, which would pay only the ~50 ms compile). Both are additive and neither is a
correctness question, so they wait for a measurement that says the arm's compile time is
distorting a study rather than merely being one of its findings.

What the compile *buys* is the reason it is on the host at all. Opal is JavaScript, so the
component could have carried it and a program could have crossed the membrane as Ruby — and then
a Ruby syntax error would be a run-time error like Python's, `compileMs` would be absent, and the
`transpile` band would not exist for this arm. Compiling on the host restores both, and the
driver gg wrote into the bundle is what makes the
[two failures](#a-compiler-has-two-ways-to-fail) distinguishable: it says in its **exit code**
which of them happened, because a compiler that rejected a program and a compiler that could not
start both exit non-zero and gg must never report the second as the first.

Ruby's rejections are all one band. There is no compile-time type system, so what Opal refuses
it refuses as a syntax error — and that covers two shapes: Ruby the parser could not read, and
valid Ruby this compiler has no lowering for (`BEGIN { … }`). Both arrive as
`transpile_syntax`, because the model's answer to each is the same, carrying Opal's own message
and — where the parser located it — the model's own line with the offending text quoted back:

```
program.rb:2: unexpected token tSTAR
  y = 2 +* 3
```

### What the SDK bought, in the guest

The [hand-written Ruby SDK](#what-native-means-in-ruby) is what turned this component from an
engine that evaluates compiled Ruby into a guest that puts **Ruby** in front of a program, and it
closed both of the gaps the substrate landed with:

- **A guest owns its own `run`, so a raise is located in the model's Ruby.** The compile appends a
  v3 source map — 0.4 ms to produce, and `sourcesContent` stripped before it is encoded — and the
  guest decodes it **lazily, only when something raised**, so the happy path pays nothing. A
  `raise ArgumentError` on line 3 of a model's program is reported at line 3 rather than at the
  line of compiled JavaScript it became.
- **The library set is declared, baked and checked.**
  `packages/gg-sandbox-ruby/src/library.rb` is a manifest of `require` lines under headings; the
  build compiles exactly that set — and, by *running* each require in a clean Opal and answering
  each `LoadError` with another compile, everything those in turn require — out of the pinned
  Opal release's own sources; and the catalogue's [`libraries`](#the-catalogue) section is
  reflected from the same file. Twenty-two names, in five groups, and a test drives every one of
  them into the committed component and requires it.

What a Ruby program gets **without** requiring anything is Opal's corelib — `Set`, `Struct`,
`Time`, `Math`, `Random`, `Enumerator` with `lazy`, `Comparable`, `Rational`, `Complex` — plus
**pattern matching**, which is Ruby 3 syntax rather than a library and which Opal lowers to a call
into a corelib module the npm runtime bundle does not carry. Without baking it, an ordinary
`case … in` would be `uninitialized constant PatternMatching`: a sentence about gg's build rather
than about the model's program.

Two absences are facts about the artifact rather than policies, and are asserted as such:
`bigdecimal` (Opal's needs a JavaScript big-number library gg does not carry) and
`fileutils`/`net/http`/`socket` (Opal ships those only for its Node and browser platforms, and
this guest is neither).

What a turn costs went up and is worth stating: **4.8 ms with no tool bound and 7.7 ms with all
thirty-five**, against 2.1–2.6 ms for the substrate that had no SDK and 1.2–1.4 ms for a plain
JavaScript program. The difference is this SDK's surface, which is built *in Ruby, per run*, out
of the run's own enabled set — twelve API objects and thirty-odd methods defined on `Object`.
Still two hundredths of a second beside a model request measured in seconds, and still bounded by
a test that only a runtime falling out of the snapshot could move.

### What "native" means in Ruby

An idiomatic Ruby SDK is not the Python one with different brackets. Every difference below is a
spelling rather than an identity, and the [agreement gate](#the-agreement-gate) accepts each of
them:

- **A block where a Ruby author expects one.** `view.open_text("failing tests") { rows.join("\n") }`
  and `fs.write_file("notes.md") { body }` — the two calls whose last argument is a long body.
  That makes Ruby the **first arm to emit an entry with more than one signature**, which turns
  that half of the catalogue schema from a shape nothing produced into a shape a gate reads —
  exactly as Python was the first to emit `kind: "keyword"`.
- **A `Range` is a span.** `context.archive_thread(4..19, 30...36)` rather than a record with a
  `start` and an `end`, because a span of integers in this language *is* a `Range`. An exclusive
  range means the same thing and is lowered the same way.
- **Splats where the argument is a list.** `memory.search_memories("cargo", "nextest")`,
  `review.request_changes("widen the test", "name the file")`,
  `project.set_issue_blocked_by("i1", "i0")`. Passing an array instead works too, which is the
  forgiveness a Ruby caller expects of a variadic method.
- **Predicates.** `read.byte_truncated?`, `out.truncated?`, `found.archive_empty?`,
  `summary.ok?` — a boolean reader ends in `?`, so the catalogue's member names do too.
- **Value objects.** A result carries `==`, `hash`, `to_h`, `inspect` and `deconstruct_keys`, so
  two reads of one file compare equal and `case read in TextFile[contents:]` destructures.
- **`case`, not a discriminant.** A read is a `TextFile` or an `ImageFile`, narrowed with an
  ordinary `case … when`. There is no union *type* at all, because Ruby has no annotations for one
  to appear in — where Python needs `FileRead = TextFile | ImageFile` to write its signature.
- **Symbols for a fixed choice**, with a real check behind them. `tasks.update_task(id,
  status: :done)`, `failure.code == ToolErrorCode::NOT_FOUND`. Opal's `Symbol` **is** `String`, so
  the language will not tell `:done` from `"done"` and cannot tell `:nearly` from a typo — which
  is why the SDK validates every fixed choice against its accepted set by hand and refuses an
  unknown one with `invalid-argument` naming every symbol that would have worked. That is what
  [rule 3](#the-rules-an-agent-facing-surface-obeys-in-every-language) actually asks for, and it
  is a place where the *guarantee* had to be re-earned rather than inherited from the language.
- **A raised `ToolError`,** which is a `StandardError` — so a bare `rescue => failure` catches it,
  as a Ruby programmer expects of anything a library raises.
- **The surface is Ruby's own top level.** The API objects are methods on `Object`, which is what a
  top-level `def` produces, so `fs.read_file("main.rb")` works with no receiver and no `require`
  line; the types are top-level constants. A program that reaches past the surface into
  `GG::Files.read_file` is refused **by the host**, exactly as a Python program that imports `gg`
  is.
- **`lib.<key>` is a `Module`.** A Ruby file has no exports, so the host wraps a code skill's or
  memory's source in the call that evaluates it against a fresh anonymous module, which extends
  itself. What the body defines is what the namespace offers, and there is no export protocol for
  an author to remember. The wrapper costs one line, and the diagnostic for a syntax error is
  moved back over it so an author reads their own line number.

One further fact a study has to record: **Opal is not CRuby.** Integer division is JavaScript's, so
`1 / 0` is `Infinity` where CRuby raises `ZeroDivisionError`; there is no bignum, so `2 ** 64`
loses precision; and `:done.class` is `String`. All three are asserted against the committed
artifact rather than described in prose, so the claim is checkable.

**Arity is checked, and Opal defaults it off.** This is the fourth divergence, and the only one gg
pays to remove rather than record. Opal compiles a `def` to a JavaScript function that binds a
missing parameter to `undefined` and carries on, so `def two(a, b)` called with one argument does
not raise — it dies further down with `can't access property "$inspect", b is undefined`, a message
naming a variable of the *compiled JavaScript*, which is the single leak the source map gg appends
to every compile exists to prevent. gg therefore compiles with
`arity_check` on: the model's program, this SDK, and the curated libraries. Measured on a
method-dense 30-line program, the compiled output grows about a third and the compile itself is not
measurably slower.

Two edges of that promise are worth stating precisely, because both are asserted against the
artifact:

- **Opal's corelib is outside it.** `Array`, `Hash`, `String` and `Integer` arrive *already
  compiled* inside `opal-runtime`'s `opal.js`, built by Opal with the flag off, and gg does not
  recompile them. `[1, 2].fetch` with no argument is not an `ArgumentError` — the method reads past
  its arguments and the JavaScript engine raises, so a bare `rescue` (which is `rescue
  StandardError`) does not see it at all and `rescue Exception` catches a bare `Exception` carrying
  no clue what was wrong. The system prompt's promise is scoped to the model's own methods and the
  SDK's functions for exactly this reason.
- **`arity_check` does not see an *unknown* keyword.** It counts positionals and catches a missing
  *required* keyword; Opal lowers keyword arguments to a trailing hash and never reads the extra
  keys. So `project.create_issue(…, reviewer: ["r1"])` — the singular/plural typo — was accepted,
  and the issue was created with `reviewers: []` while the program believed it had named one.
  `GG::ApiObject`, the forwarder that binds each function onto its API object, is the one place that
  knows both what was passed and what the target declares, and it raises CRuby's own
  `unknown keyword: :reviewer` naming the accepted set. It checks the positional count there too,
  so the refusal names `fs.read_file` — the call the model wrote — rather than the internal
  `GG::Files.read_file`, and renders `expected 1..2` rather than Ruby's negative arity encoding
  (`expected -3`), which is a number no CRuby message ever prints.

Knowing what each function declares is reflection, and reflection is not free: `Method#parameters`
over the thirty-five bound functions cost **~3 ms of a ~9 ms turn** when the forwarder did it as a
run bound its objects. It is reflected at the SDK's top level instead, so the table is in the heap
`wizer` snapshots and a turn pays nothing — the same argument the baked Opal runtime rests on, one
level down, and asserted the same way: a test reads the table's size out of a running program,
because a per-turn rebuild and a baked one are indistinguishable from inside one.

One difference runs the *other* way from Python's, and is worth naming beside that arm's
[caution about a parked guest](#wasi): Ruby's `sleep` is a **busy wait** in Opal rather than a park
in a host call, so the execution deadline reaches it exactly as it reaches any other runaway. A
`sleep 30` under a 400 ms budget is stopped at the budget, and that has a test.

### What its dialect says, and the two answers nobody else gives

[Response healing](/gg/response-healing/) asks each language the same seven questions, and this
arm is the only one that answers two of them the way it does.

**The concurrency wrapper is a `Thread`.** Ruby has no `async` keyword and no suspension token —
every method call in the language already blocks — so the shape a model wraps a whole program in,
when it wraps one at all, is `Thread.new do … end.join`, or the two-statement `worker =
Thread.new do … end` … `worker.join`. That wrapper is not merely redundant here: this guest is
Opal, which has no `Thread` at all, so a program wearing one raises `NameError: uninitialized
constant Thread` before a single line of the model's own work runs. Both shapes are unwrapped,
the `require "thread"` above either comes off with it, and the count of suspension tokens removed
is **zero** — honestly, because there is no such token in this language and a number there would
report a repair that never happened.

**The lexer reads six string shapes and a heredoc.** `'…'`, `"…"` with `#{…}` interpolation
delimited by *brace counting* (so `"total: #{rows["n"]}"` — which Ruby allows — stays one string),
`` `…` ``, the `%w[…]` family with nesting, `<<~EOS` heredocs, and `=begin`/`=end` block
comments. One shape is deliberately **not** read: a regular-expression literal, because `/…/`
cannot be told from division without knowing whether the previous token was a value, which is a
parse. A regex carrying an apostrophe therefore opens a string that never closes and the scan
declines — which is the right failure, because declining costs a repair and the alternative
reading costs a deletion.

Three further answers agree with [Python's](#python-a-guest-that-carries-its-own-interpreter),
and each is a decision rather than a gap. A `require` is **never** deleted, because this guest
bakes a declared library set and `require "json"` is a working line — and a `require` of
something it did not bake is no better a candidate, since a program may rescue the `LoadError`.
Nothing is **refused twice**, because Ruby redeclares freely and a program pasted twice runs
twice, so `drop-duplicate-program` gives itself up rather than delete work the model asked for
(the coarser `drop-doubled-response`, which asks a dialect nothing, still fires). And a `#` line
is never prose, because a Ruby comment and a Markdown heading are the same byte.

### What a Ruby code module offers

A Ruby file has no exports, so what `lib.<key>` binds is the anonymous `Module` the compile step
wraps the author's source in. The names gg *reports* for it are the module's own **methods** —
`def name` and `def self.name`, both reached as `lib.<key>.name` because the wrapper extends
itself — with Ruby's own privacy honoured in both spellings: a bare `private` makes everything
below it private, and `private def name` makes that one method private.

A **constant is not reported**, and that is a fact about evaluation rather than a choice: the
author's source is a *block*, and a constant assigned inside a block belongs to the block's
lexical scope — the top level — rather than to the module it is evaluated against. So
`lib.helpers.LIMIT` does not exist however the file is written, and a `class` or a nested
`module` is a constant by the same rule.

## PureScript: a compiler in the image, a library set in the binary

The fifth registered arm, and the first whose compiler is a **binary in the run image** rather
than something gg carries inside its own executable. It is also the only arm besides TypeScript
whose programs are read by a **type system** — and, unlike TypeScript's, by a total one over a
language designed for it, which is what makes the pair the two ends of the axis a study of
*checked* against *typed* actually varies.

**A PureScript program is compiled to JavaScript on the host by `purs`, flattened into one
script by `esbuild`, and evaluated by the same ECMAScript guest the TypeScript and JavaScript
arms use.** Nothing crosses the membrane as PureScript, and nothing about the arm is per-run.

### Why this arm has no component of its own

It shares TypeScript's — the same sharing
[JavaScript](#javascript-the-same-arm-unchecked) has, and for a related but distinct reason.
[Ruby](#ruby-compiled-to-javascript-before-it-crosses) also compiles to JavaScript and does
*not* share it, so the comparison is worth making explicitly:

| | Ruby | PureScript |
| --- | --- | --- |
| Runtime the compiled program depends on | Opal's, 743 KB, needed on every turn | **none** — `purs` compiles the program's own code and the library code it used into ordinary JavaScript |
| Cost of not baking it into a component | 45.6–51.0 ms per program | nothing to bake |
| Could a code module see it? | no — a module is evaluated before the program | yes — a module is bundled exactly as a program is |
| Effect on the TypeScript and JavaScript arms | `globalThis.Opal` in front of both | none: this arm adds nothing to the artifact |

A component of PureScript's own would therefore differ from the shared one in **nothing at
all**, and a second 20 MiB artifact that differs in nothing is a second artifact to keep in
step with the WIT rather than an isolation boundary.

The one thing that decision costs is worth stating rather than hiding: a guest backtrace is in
the **bundle's** coordinates, not the model's PureScript, because owning `run` is what would let
a guest map one to the other. The mapping is not lost — both `purs` and `esbuild` emit source
maps, and the host that produced the bundle holds them — but `feedback.program-error` carries a
single `location` and the guest picks the innermost frame, which once the SDK is linked into the
bundle is inside the SDK. The fix is a frame *list* on the wire, which is a change shared with a
future Java arm and rebuilds every committed component. It is neither made cheaper nor dearer by
the component decision above.

### The toolchain and the library set travel in opposite directions

This is the first arm to need [the toolchain image](#where-a-compiler-lives-and-what-it-must-never-share),
and the first whose committed artifact is not a compiler but the thing its compiler cannot work
without. Both halves go the only way they can:

| | Where it lives | Why |
| --- | --- | --- |
| `purs` (~100 MB) and `esbuild` (~10 MB) | `containers/gg-toolchains`, at `/opt/gg/toolchains/bin` | statically linked, one build per platform. gg is copied into a run container as a single file; a binary copies fine, a per-platform Haskell executable does not. |
| The **library set, compiled** (1.3 MB gzipped), with this arm's SDK compiled into it | inside gg's binary, unpacked once per machine | `purs` cannot type-check a program without both the sources *and* the compiled externs of everything it imports — with externs alone every import is `ModuleNotFound` — and compiling the set from scratch costs ~16 s, which no turn can pay. |

The library set could have gone in the image beside `purs`, and deliberately does not. The image
is built separately from the binary that runs in it, so a tree living there could be a different
vintage from the gg reading it — and once this arm's SDK is compiled into that tree, that would
mean a model shown one surface in its prompt and compiled against another. Both are versioned
from one file (`packages/gg-sandbox-purescript/purescript-version.sh`), which the image build and
the developer/CI install script both read, because externs are a compiler-version-private format:
a tree built by one `purs` and read by another does not compile at all.

"One artifact" is a gate rather than a slogan. The catalogue is reflected from the working tree's
`packages/gg-sandbox-purescript/src`, and a compile resolves `Gg` against the **tarball's**
`libs/gg-sdk` — so an SDK edit committed with a regenerated catalogue and a stale tarball would
tell a model about a surface it is not compiled against, and the manifest gate would not notice,
because it compares directory names and counts modules. `the_shipped_sdk_is_the_sdk_in_the_working_tree`
unpacks the tarball and compares the two SDK trees file for file — the `.js` foreign modules
included, since that is where a call's lowering lives — and names the file that drifted.

The compiler that reads a tree must also be the one that wrote it, and that is checked rather than
assumed: the first compile of a process asks `purs --version` once and refuses a release that is
not the manifest's pin, naming both and saying where the pinned one comes from. Without it a
drifted image fails *every* program with diagnostics inside gg's own library modules, which lands
in the right band — a toolchain failure, never blamed on the model — under the message *purs
reported no diagnostic in the program*, which names neither the cause nor the fix. A `--version`
that cannot be read is deliberately not a mismatch: that is a strange machine rather than a wrong
one, and the compile that follows has far more to say about it.

### What the libraries are, and why they are generous

The set is declared in `packages/gg-sandbox-purescript/spago.yaml`, resolved against a pinned
registry package set, compiled by `build.sh` — **together with this arm's own SDK**, which is
staged into the same tree and compiled into the same tarball — and recorded package by package in
`crates/gg/src/sandbox/checkers/purescript.compiler.json`: 50 packages and 329 modules as it
stands, the SDK's nineteen among them. It carries the collections (`Data.Map`, `Data.Set`, arrays, lists, `Foreign.Object`), the
monad transformers, `profunctor-lenses`, the `Effect` types including the two the sandbox's
[ambient WASI](#wasi) makes real (`Effect.Now`, `Effect.Random`), and the everyday prelude,
strings, records and dates.

That is a rule rather than a kindness: commonly used libraries are available by default in every
arm, and an arm that made a model live without `Data.Map` and a lens would be measuring how well
it copes without its own idioms rather than how well it works. What is left out is left out for a
reason — no JSON library, because
[neither an argument nor a result is a JSON document](#the-rules-an-agent-facing-surface-obeys-in-every-language)
a program assembles; no `aff`, because every call in this sandbox is synchronous.

The manifest is what the drift gate holds the tarball to. Re-cutting the tree needs `purs`,
Spago and the registry, so `scripts/ci/contract-drift.sh` verifies it by its **declared
contents** instead — a test unpacks the committed tarball and compares every package and module
against the manifest, so a tree rebuilt with a different set and committed without its manifest
fails. `spago.yaml` and `spago.lock` are committed beside it, so what went in is reviewable even
though what came out is a binary.

`spago.yaml`'s dependency list is also **machine-readable prose**: each package sits under a
`# --- heading ---`, and the catalogue's [`libraries`](#the-catalogue) section is the modules of
those packages, grouped by those headings and read out of the tree that actually shipped. So what
a model is told it may import is reflected out of the file that decides the set — the failure the
[Python arm shipped once](#the-model-is-told-the-set-and-is-told-it-from-the-artifact), in the one
place it could recur.

### What compiling costs

Measured on this repository's dev container, aarch64, against the committed tree, median of
nine:

| | |
| --- | --- |
| Hard-linking the tree into the preparation's own workspace (1,119 files) | ~19 ms |
| `purs compile` — dominated by loading 9 MB of externs, not by the program | ~200 ms |
| `esbuild` — bundling and tree-shaking the module graph | ~65 ms |
| **End to end** | **~290 ms** |

The feasibility study priced this arm at 0.45–0.65 s and expected a `purs ide server` daemon to
be needed to bring it to 151–713 ms. It is cheaper than that here, and the difference is the
staging: a real copy of the tree costs ~150 ms where a hard-linked one costs ~19 ms, and the
study's figure included the copy. **So the daemon is not taken**, on a measurement rather than a
preference — batch compilation already sits inside the range a warm daemon was measured in, and
a daemon reused across preparations would make "what a preparation returns is a function of its
input alone" a property of that daemon's cache invalidation rather than of the filesystem.

Inside the guest, what a turn pays is a store, an instantiate and an evaluate: ~2.7 ms for a
representative program, against ~2.1 ms for the equivalent plain JavaScript on the same
artifact. That closeness is the whole benefit of sharing the component, and it is what a
per-turn regression — a runtime that stopped being tree-shaken out — would move. It is asserted
as the **ratio** rather than as a figure in milliseconds, because the same 2.7 ms reads as 53 ms
beside the rest of gg's test suite: both numbers inflate together under load, so dividing one by
the other cancels the machine out.

### Isolation, which this arm is the reason for

`purs` is one of the two toolchains whose silent corruption
[the isolation rule](#per-agent-compiler-isolation) exists to prevent: eight concurrent compiles
into one shared output tree produced a single `output/Main/index.js` holding two agents' programs
interleaved, three times out of three, with every process exiting zero. The shape here is the
opposite one, in three layers:

1. **The shared tree is never written.** It is unpacked once per machine into a content-keyed
   shared toolchain directory through `place_tree`, which renames a finished tree into place and
   **seals every file and directory in it read-only**.
2. **Each preparation compiles in its own tree**, hard-linked from that one in ~19 ms. Hard links
   are what make a private tree affordable — and what makes the seal bite, since a link to a
   read-only inode is read-only too. The two files `purs` rewrites whatever else it does
   (`output/cache-db.json` and `output/package.json`) are staged as real copies; the other 1,050
   stay linked and stay sealed.
3. **The spawn goes through the seam**, so the working directory, `HOME`, `TMPDIR` and the
   `XDG_*` roots are inside that private tree.

The seal is not decoration: it is what *found* the second of those two writable files. Left
hard-linked, the compile failed with `Permission denied` naming `output/package.json` instead of
writing through into every other agent's tree — which is exactly the loud failure a seal exists
to turn a silent corruption into. And the arrangement is verified by mutation, not only by
passing: pointed at one shared output tree, the seam's own isolation gate failed this arm three
independent ways at sixteen-way — artifacts that did not carry their own marker, artifacts that
carried **another preparation's program**, and one preparation reading a `package.json` another
was halfway through writing.

### The two failures, and which is the model's

`purs` is asked for `--json-errors`, so a rejection arrives as structured diagnostics with the
compiler's own stable error code and its exact span rather than as prose to be scraped:

| What happened | How it is reported |
| --- | --- |
| `ErrorParsingModule` / `ErrorParsingFFIModule` | `TranspileSyntax` — the parser could not read it |
| any other `purs` code (`TypesDoNotUnify`, `UnknownName`, `NoInstanceFound`, …) | `TranspileCompile` — read whole and rejected, which is the band a typed arm exists to produce |
| `esbuild` reporting no matching export for `main` | `TranspileCompile`, with a sentence saying the program must define `main :: Effect Unit` |
| `purs` or `esbuild` could not run, was killed, or reported nothing about the program | [a toolchain failure](#a-compiler-has-two-ways-to-fail) — **not** the model's |

An error `purs` reports in a file that is not the model's is a fault in gg's own shipped library
tree, so it is a toolchain failure too: blaming a model for it would send it rewriting something
that was never wrong.

### What "native" means in PureScript

An idiomatic PureScript SDK is not the TypeScript one with `::` in it. Every difference below is
a spelling rather than an identity, and the [agreement gate](#the-agreement-gate) accepts each of
them:

- **An API object is a record of functions.** `fs.readFile "main.purs" {}` is a field access and
  an application. That is not decoration: it is the only way this language can carry the
  `fs.read_file` **identity** every other arm has, because a module alias must be capitalised and
  `Fs.readFile` is therefore a different name from the one the seam says every arm must offer.
- **Optional arguments are a record whose row is checked.**
  `Union given rest ReadOptions => String -> Record given -> Effect FileRead` is PureScript's own
  idiom for "any subset of these fields": `fs.readFile "a" {}` and `fs.readFile "a" { limit: 20 }`
  both type-check, and `{ limitt: 20 }` is a type error that prints every field that would have
  worked. A call with a bag of required fields takes one **open** record instead —
  `project.createIssue { title, inScope, outOfScope, completionCriteria, agent, blockedBy }` —
  where the required labels are in the type and the rest is that same constrained row.
- **A three-way patch field needs no sentinel.** Leave `description` out to keep it, pass
  `Nothing` to clear it, pass `Just` to replace it — where [Python](#what-native-bought-in-the-catalogue)
  needs an `UNCHANGED` because `None` is already taken and TypeScript needs `undefined` beside
  `null`.
- **A fixed choice is a `data` type**, and its arms are prefixed by what they belong to
  (`TaskDone`, `IssueDone`, `AgentTimedOut`, `FileEntry`) because a program imports the whole
  surface from one module and two types cannot both call an arm `Done` there.
- **A read is a real sum type.** `case read of TextFile file -> … ; ImageFile picture -> …`,
  narrowed by the compiler rather than by comparing a `kind` field against a string.
- **A failure is thrown and caught with `attempt`**, which hands back
  `Either ToolError a` and re-throws anything that is not a gg failure. That is how effectful
  PureScript expresses a failure that is usually fatal to what you were doing; a surface where
  every call returned `Effect (Either ToolError a)` would force a branch after every line and make
  a composed program unwritable.
- **The brief a child agent is spawned with is a constructor** — `Prompt "…"` or `Issue "AUTH-1"`
  — so "both" and "neither" are programs that do not compile, where every other arm can only
  refuse them at run time.
- **`lib.<key>` is the one place the program says what type it expects.** A code
  [skill](/gg/skills/)'s module is compiled separately from the program that uses it, so there is
  no `import` for `purs` to check the two against: `lib "helpers" "greet"` hands back
  `Maybe a` and the program annotates it. What comes back really is ordinary PureScript — a
  curried function, because that is what a PureScript function is.

Underneath all of it is **one foreign module**, `Gg.Internal.Wire`, naming the API objects the
guest binds. They are free identifiers in the bundle, resolved at call time against the scope the
guest built — which is what makes a capability this run withheld a `ToolError` carrying
`unavailable` rather than a `ReferenceError`, and what makes every call land in the *same*
lowering a TypeScript program's does. That last part is worth stating plainly, because it is what
a cross-language study rests on: the two arms produce **byte-identical** arguments for the same
capability by construction, and a test drives all thirty-five tools through the real membrane to
say so.

### The catalogue, and the two things PureScript does not have

`purs compile --codegen docs` emits a `docs.json` per module carrying every exported declaration's
doc comment and its full type, so a signature in the committed catalogue is the compiler's own
reading of the SDK. Two things it cannot carry, and one convention that replaces both:

| What is missing | What is done instead |
| --- | --- |
| A per-parameter doc slot — an ML type says `String -> Int -> Effect Unit` and names nothing | a `# Arguments` list in the declaration's own doc comment, exactly as Rust's convention does it, from which the reflector takes each argument's **name** and description |
| A record-field doc slot — `purs` discards a comment written on a field in all three placements | a `# Fields` list on the type |

A third thing the notation has to say is not missing so much as invisible. A row-typed optional
argument is declared `Union given rest ReadOptions => String -> Record given -> Effect FileRead`,
and `Record given` on its own says nothing at all — so the reflector prints the row flat and marks
the fields it stands for: `readFile :: String -> { offset? :: Int, limit? :: Int } -> Effect FileRead`.
Unmarked, that record reads as a **closed** one — every field required — which would be the single
point where a model is told something stricter than what it is compiled against, and it matters most
where a record mixes the two (`project.createIssue`'s six required labels beside its four optional
ones). The `?` is gg's notation rather than PureScript's, it is the marker
[TypeScript's](#stripped-and-checked) catalogue already carries for the same fact, and the prompt
says so where it explains the idiom.

Neither of the two absences is decoration, because the reflector refuses to emit a catalogue that
does not satisfy them: a signature that takes *N* arguments must document *N* in order, every field of a record
argument must be documented and every documented field must exist, a `# Fields` list must name
every field of its type and only those, and nothing may be blank. The failure lands on the author
rather than on a model.

One thing this arm made the [agreement gate](#the-agreement-gate) learn. Its signatures are
written in **ML notation**, which puts its argument list in a chain of top-level arrows rather
than between brackets — and the gate's shallow bracket rule was wrong about that in both
directions, reading `list :: Effect (Array FunctionSummary)` as taking an argument and
`readFile :: String -> Effect FileRead` as taking none. It now reads an ML signature by its
arrows, which is strictly *more* than it could see before; and the one check such a signature
cannot satisfy — that a documented argument's name appears in it — is skipped for the arguments a
type cannot name and kept for the **fields** of a structured one, which are named by the type in
every notation. That is the half that can mislead a call site, so it is the half that is held.

### What a PureScript program is

A **module**, because PureScript has no loose statements: a program is a module with a `main` of
type `Effect Unit`. gg rewrites its header to a fixed module name so the bundler can import the
entry point by a fixed path — in place, so no line moves and no diagnostic coordinate has to be
corrected — and a reply with no header at all is given one, which costs exactly one line and is
the number every diagnostic is moved back by. A program that defines no `main` is refused with a
sentence saying so rather than failing inside the guest.

A code [skill](/gg/skills/)'s or [memory](/gg/memories/)'s module is an ordinary PureScript
module too, compiled the same way; its exports are what `lib.<key>` offers, and they are curried,
because that is what a PureScript function is.

Its exports are also the module's own answer rather than a convention gg imposed, which is more
than either of the other compiled arms could manage: `module Helpers (greet, add) where` says
exactly what it offers and a header with no list offers everything its top level declares, and
`purs` honours both. What gg *reports* for `lib.<key>` is the **values** among them — the names a
field access can reach — and deliberately not a data constructor, which `purs` really does export
and which naming would take reading the `data` declaration the header refers to. Under-reporting
is free there; a name gg failed to list is bound by the guest all the same.

One thing about `lib.<key>` is forced rather than chosen, and it is the reason this arm's binding
convention differs from [TypeScript's](#javascript-the-same-arm-unchecked) in one place: the key is a
**record label**, and PureScript will not parse an upper-case one unquoted (`s.Foo` is
`Unexpected token 'Foo'`). So a skill called `CSV-tools` binds at `lib.csvTools` — camelCase like
TypeScript's, with the leading run brought down whole rather than one character at a time.

### What its dialect says, and the answer that runs the other way

[Response healing](/gg/response-healing/) asks each language the same seven questions. Three of
this arm's answers are its own, and the first of them is the most interesting thing on this page
about how a dialect is *derived* rather than copied.

**A `#` line is prose here, and is deleted.** [Python](#python-a-guest-that-carries-its-own-interpreter)
and [Ruby](#ruby-compiled-to-javascript-before-it-crosses) both refuse to delete one, because
`# Plan` is a Markdown heading *and* a comment in those languages and nothing lexical tells them
apart — so the heading survives into the program and costs nothing. PureScript comments with `--`
and `{- … -}`, and `#` is an ordinary operator; a `## Plan` left in a program is a parse error
rather than a comment. The rule is unchanged in all three — never delete a comment, never keep a
heading — and it lands the opposite way here because the language does. `--` takes the other half
of the same rule: a `--` line is never prose.

The same fact cuts back the other way exactly once, and the carve-out is worth stating because it
is the cost of the answer above. `#` is `Data.Function.applyFlipped`, so `# map trim` is a
**pipeline continuation** — and with `#` off the never-delete list, that line shared a first byte
with the one shape this dialect deletes on sight. An **indented** single `#` applied to a
lower-case name and an argument is code and is kept; anything else with a leading `#` is a heading
and goes. A heading whose title begins with a lower-case word, indented, is kept too, which is the
direction the whole subsystem is allowed to be wrong in.

**A call written without brackets is not two words of English**, and this is the arm where that had
to be said out loud. PureScript applies a function by juxtaposition, so `log "done"` and
`throwError message` are statements carrying no bracket, no operator, no keyword and no dot for a
lexical test to find — where every other arm's syntax hands it the call parentheses. Two clauses
answer it: `"` is on this dialect's non-prose character list, which no other arm needs, and the
sentence test reads the *shape English is written in* — a sentence opens with a capital or closes
with terminal punctuation, an application does neither — rather than the tokens, which are
identical. The residue is a lower-case unpunctuated line of prose, which is kept.

**The concurrency wrapper is a monad, not a block.** Every other arm's wrapper *encloses* the
program: an `async function` with a body, an `async def` with an indented suite, a
`Thread.new do … end`. PureScript's does not — the shape a model reaches for is
`main = launchAff_ do`, and what makes that block asynchronous is the monad it is in. So the
deletion is distributed: the wrapper token on `main`'s right-hand side, and the `Effect.Aff`
import that made it reachable, exactly as Python's `asyncio` import comes off with its wrapper.
What is left is the same `do` block in `Effect`, which is the monad every call in this SDK is
already in.

Two things make that repair provable rather than hopeful. `aff` is deliberately **not** in the
shipped library set, so a program wearing the wrapper cannot compile at all and there is no
working behaviour to preserve. And the wrapper must be on **`main`**, which is the one
declaration gg's own entry module calls — so "the program invokes the wrapper", which every other
arm has to look for in the text, is a property of the compile here. A wrapper on any other
declaration, or a program that does more with `Aff` than wrap itself in it, is declined. The
count of suspension tokens removed is **zero**, honestly, because PureScript has no `await`;
`liftEffect` is the nearest thing and is left alone, since an `Effect` is a `MonadEffect` and
`liftEffect` there is the identity.

**A doubled program is halved, and the proof is the compiler's.** This is the first arm since the
ECMAScript pair to answer `declares_a_redeclarable_binding` with anything but `false`, and every
clause of it was measured against the real `purs`: two module headers is `ErrorParsingModule`
(*Unexpected token 'module'*), and `main :: Effect Unit` or `main = …` twice is `RedefinedIdent`
(*The value main has been defined multiple times*) whether the two are adjacent or not. What is
deliberately *not* proof is a definition **with arguments** — `f 0 = 1` and `f n = n` are two
equations of one declaration, which is ordinary PureScript — and that exclusion is what keeps the
strategy from deleting work a model asked to have done.

Two smaller answers are worth naming because both are places a naive lexer loses the source.
`--` is only a comment when the run of dashes is followed by something that is **not** a symbol
character, because `-->` is an operator a program may define; and a `'` is a **prime** on an
identifier unless it opens a character literal that closes within the handful of bytes one can
be. Reading either wrongly masks the rest of a line — and the rest of a line is where a wrapper
lives.

An import is **never** deleted, for the reason [Python's](#python-a-guest-that-carries-its-own-interpreter)
never is and then some: `purs` resolves every one of them against a library set gg ships, and
`import Gg` is the line without which a program has no surface at all.

## Java: a warm JVM, and two compilers per program

The sixth registered language, `language: "java"`, and the first arm whose **compiler is kept warm**
between programs.

**A Java program is compiled to bytecode by `javac` and then to JavaScript by TeaVM, both inside a
warm JVM gg keeps between preparations, and evaluated by the same ECMAScript guest the TypeScript,
JavaScript and PureScript arms use.**

That makes it the only arm whose program passes through **two** compilers, which is what a
diagnostic here is a diagnostic *of*: javac's when the program is wrong about a type, an overload or
a name, and TeaVM's when it is wrong about what the standard library carries. Both are the same
recoverable, model-facing [compile error](#a-compiler-has-two-ways-to-fail), reported under javac's
name because that is [the one this language's own users would name](#what-it-declares-as-its-checker).

### The first arm whose compiler is kept warm

Java is the first toolchain gg cannot afford to spawn per compile. Measured on this repository's
dev container: a cold `java` that starts a JVM, loads TeaVM and builds costs **4–9 s**; the same
build in a JVM that has already done one costs **0.33–0.56 s**, of which ~30 ms is `javac` and the
rest is TeaVM. A per-compile process would make this arm ten times dearer than every other one,
which is a difference in the *harness* rather than in the language.

Warmth is also exactly where the study's measured TeaVM corruption lives: one
`InProcessBuildStrategy` driven from four threads produced **no output at all for three of the
four**, and `build()` threw nothing. So the warmth is the shape the seam sanctions rather than the
shape that broke — a `CompilerPool` of four JVM **processes**, each lent to one preparation at a
time, started through the seam's new `daemon()` affordance onto a private tree of its own. Two
preparations can never be inside one JVM together, so the measured bug's precondition does not
exist. A JVM is retired after 64 builds, because every build makes a fresh class loader over the
toolchain's jars and metaspace is not something gg can reclaim from here.

The gate was **verified by mutation, and one of the two mutations did not fire** — which is the
more useful half. Pointed at a single shared `classes` directory, the arm's sixteen-way gate failed
four independent ways, including artifacts carrying *another preparation's program*. Made to reuse
one `InProcessBuildStrategy` across builds, it **passed**, because the pool has already removed the
precondition the measured bug needed. The fresh strategy is kept for what it is — cheap, and the
only thing that makes a build independent of the last one through the same JVM — rather than for a
failure this gate has been shown to catch.

### Two TeaVM settings that are not optional

- `setJsModuleType(NONE)`, so the emitted code names its entry point as a **bare identifier** in
  the enclosing scope. The guest evaluates a program as the body of a function whose parameters are
  the API objects, and a module wrapper would put those names out of the program's reach.
- `setStrict(true)`, without which TeaVM omits the null and bounds checks that make a
  `NullPointerException` an exception at all — and `catch (NullPointerException)` **silently fails
  to catch**. A program that failed would be recorded as one that succeeded, which is the one class
  of error a measurement harness must never make.

### What a Java program is, here

A **sequence of statements**, as on every arm but PureScript. Java has nowhere for a loose
statement to live, so gg wraps the reply in the body of a method of a class it declares. Two
lexical transforms make that survivable, and both are **line-preserving**, because a diagnostic is
only worth handing back if it names the line the model wrote:

- an `import` the model wrote is copied into the header and **blanked where it stood**, so a Java
  author's first instinct is not a syntax error on every turn and no later line moves;
- a `package` declaration is refused by name, because there is nowhere for it to go and dropping
  one silently would leave a model wondering why its own type names did not resolve.

One thing this shape costs, and it is Java's rather than gg's: a helper type declared in a program
is a **local** declaration, and a local declaration may not carry an access modifier. `class Helper
{}` is fine; `public class Helper {}` is `modifier public not allowed here`. That is a located
compile error the model can act on, which is the band it belongs in — the alternative, hoisting the
declaration out of the body, would move its lines and make every diagnostic after it point
somewhere the model did not write.

A **code module** is a class body, and its `public static` methods become the namespace at
`lib.<key>` — Java's own visibility rule, so nothing gg-specific is written in a skill file. gg
inserts `@JSExport` inline before each of them (inline, so no line moves) and TeaVM's
`@JSExportClasses` emits them onto an object the bundle hands back.

### The error surface, which is what the study said this arm would get wrong

The feasibility study's stated worry was that an uncaught `NullPointerException` arrives as
`Error: Error: null` at a line inside TeaVM's runtime. Both halves are fixed, and what is left is
stated rather than hidden.

- **The name and the message** come from an **enumerated catch chain** in gg's generated entry
  class rather than from `getClass().getName()`, which TeaVM answers `null` for a
  `NullPointerException`. Twelve classes are named one by one, subtype before supertype because
  Java takes the first clause that matches. The chain hands the description to JavaScript and
  **rethrows the original**, so a failure a *binding* threw reaches the guest as itself rather than
  wrapped in gg's opinion of it.
- **The location** comes from TeaVM's own source map, folded on the host into a compact
  generated-line → model-line table and shipped in the bundle's prelude. A `NullPointerException`
  on the model's line 3 is reported as `java.lang.NullPointerException` followed by `at
  program.java:3`. The fold keeps the classlib's runs as "not yours" rather than dropping them,
  because a source map is sparse and the lookup is nearest-preceding: without them a frame deep in
  `java.util` would be attributed to whichever of the model's lines came before it.
- **What is still wrong** is the `location` *field*. `feedback.program-error` carries one, the guest
  fills it from the innermost frame of what was thrown, and for this arm that frame is inside
  TeaVM's runtime where the exception was constructed. So the model reads the right line in the
  **message** and a meaningless one in the **location**. The fix is a frame list on the wire, shared
  with the PureScript arm.
- **One failure has no model line at all, in either JVM arm**, and it is the price of the rethrow
  above rather than a defect on top of it. A refusal the sandbox itself raised — `setTimeout is not
  available in the sandbox`, which is what a started `Thread` runs into — reaches the JVM as a
  JavaScript exception TeaVM wrapped, and the catch chain is required to pass it through
  *undescribed* so that gg classifies it from what the host said. Describing and locating are the
  same act here: only the branch that sets a description folds the source map, so this failure
  carries the host's own sentence and no `at program.java:N`. That is the better half of the trade —
  the sentence names the mistake more precisely than a line number would — and both arms hold it
  with a test rather than leaving the located-line property to read as unconditional.

There is one more property, and it was not expected: **what TeaVM's classlib is missing is a
located compile error rather than a run-time surprise**. `java.nio.file.Paths` is
`program.java:1: Class java.nio.file.Paths was not found` on the turn that wrote it, which is a far
better answer than a `ReferenceError` three turns later.

### What TeaVM is not, recorded rather than assumed

TeaVM is not a JVM. A study has to record where it differs rather than discover it in a transcript,
so the arm's own tests assert each of these:

| | |
| --- | --- |
| Integer division by zero | **0**, not `ArithmeticException`. It is JavaScript's `(7/0)\|0`, and `setStrict(true)` does not insert this check. This arm's sharpest semantic edge |
| A *constant* division by zero | **breaks the compiler** — TeaVM folds it and throws out of its own optimiser. Reported as a toolchain failure, because it is not a diagnostic about the program |
| Floating-point division by zero | `Infinity`, which is what Java says too |
| `java.time` | **present** — `LocalDate`, `Duration`, `Instant`, `DateTimeFormatter` all work, via a bundled ThreeTen backport transpiled off the bootclasspath. The first feasibility pass concluded it was absent from a `grep` that was right about the tree and wrong about the outcome |
| A started `Thread` | **refused**. TeaVM schedules one with `setTimeout`, which this sandbox denies because `run` is synchronous and there is no event loop |
| `String.format("%%")` | `IllegalArgumentException: Unknown format conversion` at run time |
| `java.nio.file` | **absent**, and deliberately: the sandbox's filesystem is reached through gg's own `fs` object, which is the surface a study compares |

### What "native" means in Java

An idiomatic Java SDK is not the TypeScript one with types moved to the left. Every difference
below is a spelling rather than an identity, and the [agreement gate](#the-agreement-gate) accepts
each of them:

- **An optional argument is an overload**, because Java has no default parameters and no keyword
  arguments. `fs.readFile("main.java")` and `fs.readFile("main.java", 2, 5)`;
  `system.shell("npm test")` and `system.shell("npm test", 30)`. That makes Java the arm the
  catalogue's [overload groups](#one-entry-many-signatures) were designed for — **fourteen entries**
  carry more than one signature here, against Ruby's two, and it is the first arm where the count of
  signatures is routinely the interesting thing about an entry.
- **Varargs where the argument is a list.** `review.requestChanges("widen the test", "name the
  file")`, `memory.searchMemories("cargo", "nextest")`, `context.archiveThread(new TurnRange(4,
  19))`, `agents.waitForSubagents()`. A trailing `...` also spells "and you may name none", which is
  how the surface's optional *lists* stay one signature rather than two.
- **A bag of optional fields is a builder**, which is what Java libraries do and what four optional
  fields make unavoidable: `new IssueOptions().epic("AUTH").reviewers("critic")`,
  `new TaskPatch().status(TaskStatus.DONE)`.
- **A three-way patch field is two methods**, so no sentinel is needed and none is invented: never
  naming `description` keeps it, `description(…)` replaces it, `clearDescription()` empties it —
  where [Python](#what-native-bought-in-the-catalogue) needs an `UNCHANGED` because `None` is
  already taken.
- **A read is a sealed interface narrowed by a `switch`.** `FileRead` permits `TextFile` and
  `ImageFile`, both records, so `switch (read) { case TextFile text -> …; case ImageFile picture ->
  …; }` compiles with no `default` and the compiler knows the two arms are all there are. Every
  other result is a `record` too, so a field is `read.contents()` and two reads of one file compare
  equal.
- **A fixed choice is an enum**, and one that has a wire spelling carries it as a method
  (`TaskStatus.DONE.wireName()`), so gg's own vocabulary is reachable without being what the program
  writes.
- **A value the wire may leave out is `Optional`** — `Optional<ViewRegion> region()`,
  `OptionalInt exitCode()` — which is the one place Java's answer is more ceremonious than every
  other arm's and is still the right one: the alternative is a `null` a program forgets to check.
- **A child agent's brief is a typed value.** `Brief.prompt("…")` or `Brief.issue("AUTH-1")`, so
  "both" and "neither" are programs that do not compile, exactly as
  [PureScript's constructor](#what-native-means-in-purescript) makes them.
- **A failure is an unchecked exception.** `catch (ToolError failure)` and
  `failure.code() == ToolErrorCode.NOT_FOUND`. Unchecked because a checked one would force a `try`
  around every line and make a composed program unwritable — which is the same argument every arm
  makes, spelled the way Java spells it.
- **The surface is a static import.** gg's wrapper writes `import gg.*;` and
  `import static gg.Gg.*;` into every program's header, so `fs.readFile` is an ordinary method call
  on an ordinary object and a program that declares its own `view` shadows gg's by Java's own rule.
  A code module gets the same header, which is why the import is *outside* the body in both shapes:
  a field gg wrote into a class body would be a member the author did not write.
- **`lib.<key>` is a small reflection surface**, because it has to be: a code module is compiled
  separately and there is no `import` for javac to check the program against. `lib.text("helpers",
  "slugify", "Some Title")`, `lib.number(…)`, `lib.flag(…)`, `lib.run(…)`, `lib.has(…)` — the
  position a Java author is already in when they reach something at run time, answered the way Java
  answers it. A key or a name this session has no module for is a `ToolError` carrying `NOT_FOUND`
  rather than a `NullPointerException`.

One thing the SDK does that no other arm's has to, and it is the difference between a `catch` clause
that works and one that silently never fires. **TeaVM wraps a JavaScript exception crossing into
Java in a `RuntimeException` it prefixes with `(JavaScript) `**, so a `ToolError` the host raised
would not match `catch (ToolError failure)` at all. The SDK therefore catches the throw *in
JavaScript*, inside the `@JSBody` that made the call, hands the three fields back as data, and
raises a real Java exception. The half that follows from it is gg's rather than the SDK's: a
`ToolError` that **escapes** must still reach the guest as a tool failure, because gg classifies a
turn's error from the host's own code — so the generated entry class records those same three fields
in the bundle's prelude on the way past, and the tail throws that record instead of the Java object.
Both halves are asserted against the real membrane rather than described.

### The catalogue, and what the doclet API buys

`javadoc` with a doclet of gg's own reads the SDK and writes the catalogue, so a signature is
javac's reading of the declaration rather than a string anybody typed and every word of prose comes
off the thing it describes: a function's from its doc comment, an argument's from that argument's
`@param`, a record component's from the `@param` on the record, an enum constant's from the comment
above it, an API object's from the doc comment on the field of `gg.Gg` that holds it.

This is the arm with **full sufficiency** — nothing here needs the `# Arguments` convention
[PureScript](#the-catalogue-and-the-two-things-purescript-does-not-have) and Rust have to fall back
on, because `ParamTree` carries the parameter's own name and `ThrowsTree` carries the failure prose.
Two readings of the same comments have to agree before anything a model sees is written: `build.sh`
compiles the model-facing package a second time under `-Xdoclint:all/protected -Werror`, which is
the JDK's own completeness check, and the doclet refuses to emit a catalogue with a blank in it —
including in the direction the per-entry checks cannot see, a public method of an API object that
the identity table never names and no model would therefore be told about.

The identity half — that `fs.readFile` **is** gg's `read_file`, that `view.openFile` is bound
exactly when `read_file` is — is the one thing Java cannot say on the declaration, so it sits in
`tools/GgCatalogue.java` and is checked against the SDK in both directions.

### The library set is TeaVM's classlib, and it is checked against it

There is nothing to install and nothing to bake: what a Java program may reach is what TeaVM can
translate, which is a large subset of `java.base` plus the ThreeTen backport that makes `java.time`
real. `packages/gg-sandbox-java/libraries.txt` declares that set in groups, the catalogue's
[`libraries`](#the-catalogue) section is reflected from it, and the prompt renders it — so what a
model is told it may import is read off the file that decides the claim rather than described in a
template.

The claim is then held to the artifact. `java_reaches_every_library_this_arm_says_it_may` drives
every declared package through the real javac and the real TeaVM and requires a real class in each
to compile **and** run, with the probe deliberately a call rather than an import, since TeaVM emits
only what a call graph reached. Twenty-two packages, in six groups.

**The subset is a subset at method granularity, not only at class granularity**, and that is the
part of "a large subset of `java.base`" a study reader would otherwise get wrong: a package this arm
declares can carry a class that is missing a method every Java author uses. So the gate probes both
questions — one call per declared package for "may I import this?", and fifteen of the idioms a
model reaches for first (`strip`, `repeat`, `isBlank`, `String.join`, `Map.of`, `Stream.toList`,
`Optional.orElseThrow`, `var`, `Math.floorMod`, records, `Arrays.toString`,
`Collections.unmodifiableList`, `StringBuilder.reverse`, `String.format`, `split`) for "may I call
this?". Four absences found that way are recorded as absences rather than discovered in a
transcript: two packages — `java.security`, `java.util.random` — and two **methods inside declared
packages**, `String.lines()` and `java.util.StringJoiner`, of which the first is a first-reach-for
method for a model splitting a shell command's output. All four are, as ever on this arm, a located
compile error on the turn that wrote them, and all four are named in the system prompt beside a
working alternative, because a gap the model is told about costs it nothing and a gap it discovers
costs it a turn.

Nine of those packages need no `import` at all, because gg's wrapper writes them into every
program's header beside its own: a model that has to say `java.util.stream.Collectors` in full is a
model spending its reply on ceremony no Java author would type.

**No third-party library is shipped, and that is a finding rather than an omission.** The rule the
seam states is that the libraries a language's authors reach for by default are available, and in
Java that is overwhelmingly `java.base` itself — `Map`, `Stream`, `Optional`, `Pattern`,
`BigDecimal`, `LocalDate`, records and sealed types are the language's own idioms, not somebody's
package. What a Java author would reach *past* them for is a JSON library, which
[no arm ships](#the-rules-an-agent-facing-surface-obeys-in-every-language) because neither an
argument nor a result is a document a program assembles, and a collections or HTTP library, which
would have to be translatable by TeaVM to be worth anything and which `system.shell` already covers
the useful half of. So the set is generous by this language's standards while being the one arm that
adds nothing to what its runtime carries — and the classlib being a *subset* of `java.base` is the
part that had to be measured rather than assumed, which is what `libraries.txt` and its gate are.

### What it declares as its checker

Two compilers read a Java program, and the seam asks a language to name **one** — the thing its
own users would say a program is judged by. That is `javac`: TeaVM translates what javac accepted
and judges nothing about the program except that its classlib carries what the program reached.
Naming one is also what has the ~0.4 s compile [recorded](#what-compiling-costs-and-where-it-is-recorded)
rather than absorbed, on the failing path as much as the succeeding one — and this arm's is the
largest of any, so an arm that went untimed would look free and would not be.

### Where the toolchain lives

Three things, shipped three ways because each can only go one way. A JDK (~190 MB, a build per
platform) and TeaVM's jars (~29 MB) go into the **gg toolchain image**, installed by
`scripts/ci/install-java.sh`, which the Dockerfile runs rather than duplicating so the list of jars
exists once. Running it there rather than restating it makes this the first block in that image to
read the **build context**, and the repository's `.dockerignore` is an allowlist — so the installer
and the version file it sources are re-included there by name, and `scripts/ci/build-context.sh`
holds every Dockerfile in the repository to the same thing. gg's own **compiler driver** goes inside
gg's binary: it is a single `.java` file run
by the JDK's single-file source-code launcher, so there is no jar to build, no binary artifact to
commit and no reproducible-build gate — and a driver of a different vintage from the gg speaking to
it is a protocol mismatch a version handshake refuses by number.

That single file is **assembled from two**, and the split is not cosmetic. `javac`, the TeaVM build,
the two diagnostic shapes and the little JSON the driver speaks are the same whatever language the
program was written in, so they live once, in `checkers/jvm.backend.java`, which gg appends to an
arm's own front end before closing the class. The reason is
[`setStrict(true)`](#two-teavm-settings-that-are-not-optional): it fails **silently** when it goes
missing, so a second copy of the code that sets it would be a standing chance for one arm to lose it
and for nobody to notice — the same argument that has
[JavaScript](#javascript-the-same-arm-unchecked) serve TypeScript's committed component rather than a
byte-identical copy of it. The launcher compiles one *file*, so sharing here means gg builds the
file; the assembled text is what is placed on disk, and what the shared directory's key is taken
over.

The **SDK** goes inside gg's binary too, as a committed jar, and that is the same split
[PureScript's library set](#the-toolchain-and-the-library-set-travel-in-opposite-directions) is on
and for the same reason: the image is built separately from the binary that runs in it, so an SDK
living beside TeaVM could be a different vintage from the gg whose catalogue describes it — which
would mean a model shown one surface in its prompt and compiled against another. Committed, the SDK
and the catalogue reflected from it move in one diff, and unlike PureScript's tarball it is cheap
enough to rebuild that `scripts/ci/contract-drift.sh` re-cuts and diffs it rather than verifying it
by a manifest: 52 classes, a fixed entry timestamp and a sorted entry list, so two builds of
identical sources are identical bytes. gg places it beside the driver in a shared directory whose
key folds in a digest of both, so a gg carrying a different SDK never reads another build's jar.

On a developer's or CI machine the same script installs under `~/.local/share/gg-java`, which
`crates/gg` looks in by name. That is a departure from the PureScript arm, and it has a reason: this
toolchain is not a binary on `PATH` but a JDK *and* a directory of jars, and there is no `PATH`
lookup for a directory.

### What this arm pays inside the guest

More than any other, and it is measured rather than assumed: **~9 ms** per turn for a small program
against ~2 ms for the equivalent JavaScript on the same artifact. A compiled Java program carries as
much of TeaVM's 1,213-class classlib as its call graph reached — ~600 KB for an ordinary one.

The obvious response is a component of this arm's own, so `componentize-js` pre-initialises the
classlib under wizer the way Ruby's holds Opal. It does not work, and the reason is TeaVM rather
than gg: TeaVM does not *have* a runtime to bake. It emits, per program, only the classlib methods
that program reached, renamed and inlined into the same file. There is no stable object two programs
could share, so a component carrying one would carry the wrong 600 KB for every program that was not
the one it was built from. This arm therefore shares the ECMAScript guest, like JavaScript and
PureScript, and the seam's "no language is served another's artifacts" rule names all three pairs in
its exemption table with that measurement as the reason.

### What its dialect says, and the four answers nobody else gives

Java's syntax is the closest of any arm to TypeScript's, and handing it TypeScript's
[healing dialect](/gg/response-healing/) would have been wrong in four places — each one the *same
rule* reaching a different conclusion because the language is different.

| Question | This arm's answer | Why |
| --- | --- | --- |
| Is this line an import? | **Never** | On the ECMAScript arms an `import` is dead text: the guest has no module loader, so dropping it can only help. Here gg's own wrapper **hoists** every `import` a model wrote into the compilation unit's header, so the line resolves and does its job — and one javac cannot resolve is a located compile error on the turn that wrote it, which is a better answer than a silent deletion. `drop-imports` never fires here. |
| Is a `#` line prose? | **Yes, and it is deleted** | [Python](#python-a-guest-that-carries-its-own-interpreter) and [Ruby](#ruby-compiled-to-javascript-before-it-crosses) refuse to touch one, because `# Plan` is a comment in those languages as well as a Markdown heading. Java has no `#` at all — not a comment, not an operator, not a legal token — so a `#` line is certainly not Java and leaving one in a program is a syntax error rather than a surviving comment. What is never prose here is a `//` line. |
| Is a **backtick** code punctuation? | **No** | Every other C-shaped dialect lists it, because in ECMAScript a backtick opens a template literal. Java has no template literal and no backtick anywhere in its grammar, so a line carrying one is *certainly* prose — which is what lets a lead-in written with an inline code span be deleted here where TypeScript's dialect has to keep it. |
| What does the language refuse to declare twice? | A **local variable**, or a local type | ECMAScript makes redeclaring a `const` an early error; Java makes redeclaring a local in one block a compile error, and a program's statements *are* one block. So a repeated tail declaring `String plan = …`, or a local `class`/`record`/`interface`/`enum`, is a reply that could not have compiled as sent — which is exactly the proof `drop-duplicate-program` needs. A statement keyword followed by a name (`return value;`, `assert ok;`, a second identical `import`) is deliberately *not* proof, because every one of those may legally appear twice. |

The concurrency wrapper is a **thread**. Java has no `async` keyword and no suspension token — every
call in the language already blocks — so the shape a model wraps a whole program in is
`new Thread(() -> { … }).start();`, or the same thing declared and started under a name, or a
`CompletableFuture` run and joined. Unwrapping it is provably a repair rather than a change of
behaviour: TeaVM schedules a started thread with `setTimeout`, which this sandbox denies, so a
program wearing one fails before a line of the model's own work runs. **Zero** suspension tokens are
reported, because this language has none to delete.

Two details of that repair are its own. The match is **anchored to the constructor** — the text
between where the wrapper may start and the lambda's `{` has to be one of the recognised
constructors and nothing else — so a program whose *last* statement happens to start a thread keeps
every statement above it. And the `import` above the wrapper **stays**, where Python's arm deletes
the `import asyncio` and Ruby's the `require "thread"`: those two name something their guest does not
carry, so leaving the line would leave the one line of the repaired program that still fails, while
`java.util.concurrent` is in this arm's declared set, an unused import is legal Java, and deleting a
working line is the one thing this subsystem must never do.

Two smaller answers are worth naming because each is a place a naive scan loses the source. Every
lexical scan on this arm — the healing dialect's *and* the wrapper's, which are two readings written
for two purposes — compares **bytes** rather than slicing the source, because it walks one byte at a
time and `&source[at..]` panics on any index that is not a character boundary: a single `é` in a
string, a comment or an identifier would otherwise take the turn down with a slice index error
rather than reaching javac, which a model writing a message in any language but English produces on
its first turn. And a leading `*` is **not** read as code, even though it is how a Javadoc
continuation line begins, because it is also how half the models that write a bullet list write one
— and `strip-fences` declines outright when any line outside the fences is code-shaped, so reading
it as code would send the most common real reply shape there is to javac whole. Nothing is lost:
`strip-prose` deletes only runs from the two ends of a reply, and a run that would reach a Javadoc
block stops at its `/**` opener.

### What a Java code module is, and the one gate that noticed

A code module here is a **class body** while a program is a sequence of statements, which makes Java
the only arm whose two preparation shapes are not the same shape. The
[isolation gate](#per-agent-compiler-isolation) drives both steps sixteen ways and had, until this
arm, been able to use the one whole program the seam guarantees every language can write — its
generated documentation script — as the subject for both. For Java that script is a module offering
nothing, and the gate said so by name on its first run, from the baseline pass it makes *before* any
concurrency. So a language may now answer with a module of its own shape, and the default remains
that program for every arm whose module is ordinary source of the language. The default is safe
precisely because the baseline pass exists: a language for which it is wrong finds out from the gate
rather than from a review.

## Kotlin: a program that is a script

The seventh arm: `language: "kotlin"` is a value an operator configures.

It is the cheapest arm gg has added, and cheap in the place a language arm is usually most
expensive — everything from bytecode onwards already existed. That is also what makes it the most
*useful* arm to have added: run beside [Java](#java-a-warm-jvm-and-two-compilers-per-program) it is
as close to a controlled experiment on a language as this seam can get. One JDK, one TeaVM, one
guest, one classlib, one compile shape, one pool discipline. What differs is the language a model
writes and the surface it writes against — and the surface is deliberately as far from Java's as
two idiomatic surfaces over one capability set can be, because a transliterated one would have made
the pair measure the toolchain.

**A Kotlin program is compiled to bytecode by the Kotlin compiler and then to JavaScript by TeaVM,
both inside a warm JVM gg keeps between preparations, and evaluated by the same ECMAScript guest the
TypeScript, JavaScript, PureScript and [Java](#java-a-warm-jvm-and-two-compilers-per-program) arms
use.**

**Everything from bytecode onwards already existed.** The JDK, TeaVM, the
[two settings that are not optional](#two-teavm-settings-that-are-not-optional), the reading of
TeaVM's source map that turns a generated line back into the model's own, the shared guest — all of
it is the Java arm's, and it is now literally shared rather than copied. `checkers/jvm.backend.java`
is the half of gg's compiler driver that does not depend on which language the program was written
in, and gg *assembles* each arm's driver out of that plus a front end of its own, because the JDK's
single-file launcher compiles one file and `setStrict(true)` is a setting whose absence is
[silent](#two-teavm-settings-that-are-not-optional).

### Why a program is a script, which is the one decision that had to be measured

Kotlin has no place for a loose statement in an ordinary `.kt` file, so the obvious shape is the one
[Java takes](#what-a-java-program-is-here): wrap the reply in the body of a function gg declares.
That shape was built, pointed at the real compiler, and found to be **wrong for this language**.
Kotlin's rules for what may be declared *locally* are far tighter than Java's:

| What a model wrote | What the compiler said |
| --- | --- |
| `object Registry { … }` | `LOCAL_OBJECT_NOT_ALLOWED` |
| `interface Shape`, and so `sealed interface Event` | `LOCAL_INTERFACE_NOT_ALLOWED` |
| `enum class Colour { … }` | `WRONG_MODIFIER_TARGET` — enum is not applicable to a local class |
| `companion object` in a helper class | `WRONG_MODIFIER_CONTAINING_DECLARATION` |
| `typealias Rows = List<Int>` | `UNSUPPORTED_FEATURE` — local type aliases are experimental |
| `private fun helper() = 1` | `WRONG_MODIFIER_TARGET` — private is not applicable to a local function |

Five of those six are ordinary modern Kotlin. A `sealed interface` with `data class` arms is *the*
idiom for a closed set of cases, and `private fun` is what a Kotlin author types without thinking. An
arm that refused them would be measuring how well a model copes with gg's wrapper rather than how
well it works in Kotlin, which is the one thing a language study must not do.

So a program is compiled as a **Kotlin script** — a real compilation shape of the language in which
statements and declarations sit side by side at the top level, in whatever order the model wrote
them. Every one of the six above compiles. Two things follow that no other compiled arm can say:

- **a reply with no `import` in it is compiled byte for byte as the model wrote it.** There is
  nothing to wrap, so the shift every diagnostic is moved back by is *zero* and a coordinate needs no
  arithmetic at all;
- **a function declared beside a value can still see it.** The alternative fix — hoisting
  declarations to a file's top level to make `object` and `interface` legal — would have broken
  exactly that, because a Kotlin top-level function cannot see a top-level statement's `val`. Both
  work here.

What the script shape costs is all in the toolchain, and all of it was found by running it: four
scripting jars (the `-embeddable` variants, since the compiler they plug into is the embeddable
one), loaded by four **unversioned** file names out of a `kotlin-home/lib` directory the installer
lays out; the `-Xallow-any-scripts-in-source-roots` flag, which compiles a script where `-script`
would compile it and then *run* it inside gg's own daemon; and three `idea.*` system properties,
without which the compiler's IntelliJ core throws `Could not find installation home path` out of a
static initialiser before it has read a line of the program. Each is pinned, each is asserted, and
each fails in a way that looks like a diagnostic about the model's program if it is missing.

One consequence is worth recording rather than discovering in a transcript: **a `main` the model
declared is not called.** In a script, `fun main()` is a function like any other and the top-level
statements are what run — so a model that wrapped its work in one has written a program that does
nothing.

### Why the compiler is embedded

`kotlinc` is a shell script around a JVM and has no daemon of its own to ask, but the compiler warms
dramatically when it is embedded. Measured on this repository's dev container, through this arm's own
driver:

| | |
| --- | --- |
| The first build in a JVM (the compiler's own class loading, then TeaVM's) | 1.7–9 s |
| Every build after it — Kotlin | 0.14–0.4 s |
| … and TeaVM | 0.15–0.6 s |
| javac, on gg's own generated entry class | ~20–40 ms |

So the shape is [Java's](#the-first-arm-whose-compiler-is-kept-warm), for the same reasons and with
the same guarantees: a `CompilerPool` of four JVM **processes**, each lent to one preparation at a
time, a fresh compiler and a fresh TeaVM build strategy per request, output written where the request
says, and a JVM retired after 64 builds. Two preparations are never inside one JVM together, which is
the precondition of the measured TeaVM corruption. [The seam's own isolation
gate](#per-agent-compiler-isolation) drives **both** halves sixteen ways — 32 real builds through
those four JVMs — which is what registration bought: the gate walks the registry, so an arm is
inside it the moment it has a wire id, and the hand-pointed copy this arm carried before then was
deleted with the commit that registered it.

One thing this arm's handshake asks that Java's cannot: **which Kotlin release the daemon actually
loaded**. That arm's driver names no release of anything it did not install; this one loads a
compiler out of a directory a script filled, and a drifted one would word its diagnostics
differently — which is the hardest kind of difference to attribute when two runs of a study
disagree. A version that cannot be read at all is deliberately *not* a mismatch: that is a strange
machine rather than a wrong one.

### What a program may reach, and why that took being deliberate

The Kotlin standard library, and nothing else. That is a claim gg can only make by construction: the
driver runs with a 60 MB compiler and every TeaVM jar on its classpath, and a program compiled
against *that* could import the compiler's own internals and — worse — `kotlinx.coroutines`, which is
a runtime dependency of the compiler and which this sandbox cannot run. So the arm keeps **four**
classpaths rather than one, and a model's program is compiled against two jars: the standard library,
and the script runtime its script class extends. A code module gets one more, TeaVM's `@JSExport`,
which gg writes into a module and an author never types.

The difference that makes is visible in what a model reads. `import kotlinx.coroutines.*` compiled
against the driver's classpath produced **forty-five** TeaVM errors inside `kotlinx/coroutines/*.kt`;
compiled against the standard library it is one `UNRESOLVED_IMPORT` at the model's own line.

### Where a diagnostic in somebody else's file comes from

This is the one place the arm parts company with Java's, and the reason is the language rather than a
preference.

| Where an error is | Java's answer | Kotlin's |
| --- | --- | --- |
| the model's own file | the model's | the model's |
| gg's generated entry class | [a toolchain failure](#a-compiler-has-two-ways-to-fail) | a toolchain failure |
| a **library** file | a toolchain failure | **the model's**, with the library's own file named |

A Java program reaches TeaVM's classlib *directly*, so a diagnostic in a file the model did not write
is gg's own code and blaming a model for it would send it rewriting something that was never wrong. A
Kotlin program reaches that same classlib **through a standard library written in Kotlin** — so
`kotlin.concurrent.thread { … }` is refused at `kotlin/concurrent/Thread.kt:40`, which is a fact
about the program the model wrote. It is reported as one, quoting the file the program reached
through and not pretending the model can open it. TeaVM reports one problem per *call site*, so
identical renderings are folded and at most eight reach the model with the rest counted — a model
reads the first few and pays tokens for all of them.

Two bands sit above that, and both are the compiler's own reading rather than gg's: Kotlin reports
every parse failure under a single diagnostic name (`SYNTAX`), which is exactly the
[`transpile_syntax`](#a-compiler-has-two-ways-to-fail) band, and everything else it refuses is the
`transpile` one. Those names are only available because the compile asks for
`-Xrender-internal-diagnostic-names`; without it, telling *the parser could not read this* from *I
read it and disagreed* would mean matching on English.

### What a Kotlin code module is

An ordinary Kotlin **file**, not a script — which makes Kotlin the second arm (after
[Java](#what-a-java-code-module-is-and-the-one-gate-that-noticed)) whose two preparation shapes are
not the same shape. What `lib.<key>` binds is a namespace of functions; a Kotlin file's public
top-level functions are exactly that, and they compile to the static methods of one class TeaVM can
export. A script's declarations are members of a script *instance*, which is a thing that would have
to be constructed before anything could be read off it.

`private` and `internal` keep a function out, which is Kotlin's own visibility rule rather than
anything gg invented; `@JSExport` is inserted **inline** before each exported `fun`, so no line
moves. One detail is a measured trap rather than a choice: the file's JVM class and the name TeaVM
exports it under must **differ**, because TeaVM declares both in the bundle's scope and when they are
the same word the inner declaration shadows the outer one — leaving `lib.<key>` bound to `undefined`
with no error anywhere, which is the quiet kind of wrong.

### What "native" means in Kotlin

An idiomatic Kotlin SDK is not the Java one with the types moved right — and this is the arm where
that matters most, because the two share a compiler road, a guest and a classlib, so a surface that
was merely Java's transliterated would make the pair measure the *toolchain* rather than the
language. Every difference below is a spelling rather than an identity, and the
[agreement gate](#the-agreement-gate) accepts each of them:

- **An optional argument is a default argument, passed by name.** `fs.readFile("main.kt", offset = 2,
  limit = 5)`, `system.shell("npm test", timeoutSecs = 30)`. Where
  [Java](#what-native-means-in-java) needs fourteen **overload groups**, this arm needs **none at
  all**: every entry in its catalogue carries exactly one signature, and the optional half of it is
  `kind: "keyword"` with a stated default. Those are the two shapes the catalogue's
  [`signatures` array](#one-entry-many-signatures) was designed to hold, produced by two arms that
  compile through the same two compilers — which is as close as the seam comes to an experiment on its
  own schema.
- **A bag of optional fields is more default arguments, not a builder.**
  `project.createIssue(title, inScope, outOfScope, criteria, "builder", epicId = "AUTH", reviewers =
  listOf("critic"))` — where Java's answer to four optional fields is an object whose setters chain.
  The same goes for the two halves of code a memory may carry: they are `code = …` and `onUse = …`
  rather than a value to build first, so "an on-use script and no module" is one named argument.
- **A three-way patch field is a `sealed interface`, and needs no sentinel constant.** `null` is
  already "leave it alone" here, because leaving an argument out *is* passing `null` — so the third
  state is a **value**: `description = Patch.Replace("…")`, `description = Patch.Clear`. That is what
  [Python's `UNCHANGED`](#what-native-bought-in-the-catalogue) is, given a type.
- **A span of turns is a range**, because that is what a span of integers is in this language:
  `context.archiveThread(4..19, 30..<36)`. Ruby is the other arm that can say it that way; Java has to
  construct a record per span.
- **A read is a sealed interface narrowed by `when`**, which needs no `else` — `is TextFile ->
  read.contents`, `is ImageFile -> read.label` — and every result is a `data class`, so a field is
  `read.contents`, two reads of one file compare equal, and `val (id, slot, model) = handle`
  destructures.
- **A value the wire may leave out is nullable.** `exitCode: Int?`, `region: ViewRegion?`, where Java
  reaches for `Optional` and `OptionalInt`. This is the one place the seam's own note about Kotlin was
  already written down before the arm existed, and the arm did not have to argue for it.
- **A fixed choice is an `enum class`**, and one with a wire spelling carries it as a property
  (`TaskStatus.DONE.wireName`) rather than as a method, because a Kotlin author reads a value as a
  value. A child agent's brief is a **sealed** one instead — `Brief.Prompt("…")` or
  `Brief.Issue("AUTH-1")` — so "both" and "neither" are programs that do not compile, exactly as
  [PureScript's constructor](#what-native-means-in-purescript) and Java's typed value make them.
- **A failure is an exception, caught with `catch` or `runCatching`.** Kotlin has no checked
  exceptions at all, so the argument every other arm has to make — that a checked one would force a
  `try` around every line — is made by the language. `failure.code == ToolErrorCode.NOT_FOUND` reads a
  property. A surface returning `Result<T>` was the alternative and is not taken, for the reason the
  language's own guidance gives: `Result` is for a value you will branch on immediately, and a program
  that branched after every line would be unwritable.
- **`lib.<key>` is a small reflection surface**, as [Java's](#what-native-means-in-java) is and for the
  same reason: a code module is compiled separately and there is no `import` for the compiler to check
  the program against. `lib.text("helpers", "slugify", "Some Title")`, `lib.number(…)`, `lib.flag(…)`,
  `lib.run(…)`, `lib.has(…)`.

**And the surface needs no import at all**, which no other arm's does. That is not a convenience: it
is what keeps the substrate's headline property true now that there is a surface to reach. Kotlin
**forbids importing from the root package** into a named one, and resolves a name in the *same*
package with no import — and a model's program, having no `package` line, is itself in the root
package. So the SDK is declared there, `fs.readFile("main.kt")` resolves with nothing written above
it, and **a reply with no `import` in it is still compiled byte for byte, with a shift of zero**.
Every other compiled arm writes a header and moves every diagnostic back over it.

The bridge stays out of a program's reach all the same, and by a stronger fence than a package would
have given it: every declaration in it is `internal`, which is *module* visibility, and a model's
program is compiled as its own module against the SDK's jar. A program cannot name the crossing at
all — where Java's arm relies on package-private and PureScript's on a module the program could
import if it knew the name.

One thing about that jar is a measured trap rather than a choice, and it is the shape of bug that is
found in the wrong week: it must carry `META-INF/<module>.kotlin_module` as well as its class files.
That file is what tells the compiler which facade class a package's **top-level** declarations live
in, and a jar built from `*.class` alone compiles, ships, and answers every `fs.readFile` in every
program with `Unresolved reference 'fs'` — a sentence about gg's packaging wearing the shape of a
diagnostic about the model's program.

### The catalogue, and the documentation tool that is the compiler

Kotlin's documentation tool is **Dokka**, and this arm does not use it. Dokka has no JSON output —
its formats are HTML, GFM, Jekyll and Javadoc — so emitting a catalogue through it means writing a
Dokka *plugin*: a second Kotlin artifact compiled against `dokka-core`, run through `dokka-cli` with
a plugins classpath, and **pinned separately from the compiler that compiles a model's program**.

What Dokka does to read KDoc is ask the compiler's own front end for it, and that is what
`tools/GgSignatures.kt` does directly: `KotlinCoreEnvironment` builds the compiler's project,
`PsiFileFactory` parses each SDK file into the same `KtFile` the compiler compiles, and `KDoc` is the
compiler's own KDoc parser rather than a regular expression over comments. The difference is a
dependency, not a reading — and the property that decides it is the one
[PureScript's arm](#the-catalogue-and-the-two-things-purescript-does-not-have) has, whose
documentation tool *is* its compiler: **the release that describes the surface is the release that
compiles a program against it**, because both come out of one pinned `kotlin-compiler-embeddable`. A
Dokka pinned separately could read a KDoc dialect the compiler no longer does, and a model would be
shown the difference.

It is a **parse** rather than an analysis, deliberately: what a model needs to read is the type the
SDK's author *wrote* — `Patch<String>?`, `List<DirEntry>` — rather than a resolver's fully qualified
expansion of it.

This arm has **full sufficiency**, as Java does: nothing needs the `# Arguments` convention
PureScript and Rust fall back on, because KDoc has `@param` for an argument, `@property` for a
type's field and for an enum's own constructor property, `@throws` for the failure prose, and a
declaration's own comment for an enum entry. The completeness half is two independent readings that
have to agree: `build.sh` compiles the SDK a second time under **`-Xexplicit-api=strict -Werror`**,
which is Kotlin's own public-API check — every declaration a model can see states its visibility and
its return type — and the reflector refuses to emit a catalogue with a blank in it, an identity the
SDK does not declare, a `@param` naming an argument the function does not take, or a public function
of an API object that the identity table never names.

Two renderings are the reflector's own decision rather than the language's. A signature says
`: Unit` out loud where a block-bodied Kotlin function would state nothing, because *that a call
returns nothing* is exactly what tells a model the rest of its program still runs after it — the
same thing TypeScript's `void` is load-bearing for. And a sealed type's declaration carries its arms
inline (`sealed interface Patch<out T> { data class Replace<out T>(val value: T) : Patch<T>; data
object Clear : Patch<Nothing> }`), because Kotlin has no `permits` clause to name them with and a
bare `sealed interface Patch` would tell a model nothing about how to write one.

### The library set is the standard library, and it is checked against it

There is nothing to install and nothing to bake: what a Kotlin program may reach is the **Kotlin
standard library**, as TeaVM's classlib is able to translate it.
`packages/gg-sandbox-kotlin/libraries.txt` declares that set in groups, the catalogue's
[`libraries`](#the-catalogue) section is reflected from it, and the prompt renders it — so what a
model is told it may import is read off the file that decides the claim rather than described in a
template.

The claim is then held to the artifact. `kotlin_reaches_every_library_this_arm_says_it_may` drives
every declared package through the real Kotlin compiler and the real TeaVM and requires a real
declaration in each to compile **and** run, with the probe deliberately a call rather than an import,
since TeaVM emits only what a call graph reached. Seventeen packages, in three groups.

The first group needs no `import` line at all, and neither does gg's own surface: Kotlin's default
imports already cover `kotlin`, `kotlin.collections`, `kotlin.text`, `kotlin.ranges`,
`kotlin.sequences`, `kotlin.comparisons` and `kotlin.io` in every file, and the SDK is in the root
package the program is itself compiled in. A program that reaches for `kotlin.math`, `kotlin.time`
or `java.time` writes one line; everything else is already there.

**No third-party library is shipped**, and on this arm that is not even a judgement call — it is
what the [four classpaths](#what-a-program-may-reach-and-why-that-took-being-deliberate) are for. The
driver runs with a 60 MB compiler and every TeaVM jar on *its* classpath; a program is compiled
against two jars and gg's SDK. `kotlinx.coroutines` is the one that matters, because it is a runtime
dependency of the compiler and because it is the first thing a model reaching for concurrency writes:
compiled against the driver's classpath it produced **forty-five** TeaVM errors inside somebody else's
files, and compiled against the standard library it is one `Unresolved reference 'kotlinx'` at the
model's own line. That is a fact about the arm recorded as a test rather than a sentence.

### The checker this arm names

`kotlinc` — what a Kotlin author calls the compiler, even though gg drives the compiler class
[embedded rather than as that binary](#why-the-compiler-is-embedded). Not TeaVM, on the same grounds
[Java does not name it](#what-it-declares-as-its-checker): it translates what the Kotlin compiler
accepted and judges nothing about the program except that its classlib carries what the program
reached. Naming a checker is also what has this arm's compile
[recorded](#what-compiling-costs-and-where-it-is-recorded) on every turn, the failing path included.

### What its dialect says, and the five answers the other JVM arm does not give

This is the arm that shows a [healing dialect](/gg/response-healing/) is **derived** rather than
copied. Java is the language closest to Kotlin that gg registers, the two share a compiler road, a
guest and a classlib, and gg's preparation does the same import hoist to both — and *five* of the
lexical answers still differ. Every one of them is the same rule reading a different grammar.

| Question | Java's answer | Kotlin's |
| --- | --- | --- |
| Is a backtick code punctuation? | no — Java's grammar has no backtick | **yes** — backquoted identifiers |
| Is `;` what says "this line is code"? | yes, its strongest single clause | **it says almost nothing** |
| What proves a repeated tail could not have run? | a local variable or a local type | **any declaration at all**, `fun` and `object` included |
| Does the import above a concurrency wrapper survive? | yes, it resolves | **no**, it names something unreachable |
| Is there a suspension token to delete? | no, and zero is reported | **yes** — `suspend`, on a declaration |

**A backtick is code here.** Kotlin has backquoted identifiers, so a line carrying one may perfectly
well be code, and the rule that every clause of the prose predicate be a shape *only English has*
puts the backtick back on the non-prose list beside TypeScript's, Python's and Ruby's. Java may
delete a lead-in written with an inline code span; this arm may not. On the `#` character the two
agree and both differ from Python and Ruby, for the same reason in reverse: Kotlin has no `#` token
at all, so a `#` line is certainly not Kotlin.

**There is no statement terminator to lean on.** Java's strongest reading of "this is code" is a `;`
that ends a statement; a Kotlin statement simply ends at the newline. So the weight moves onto the
keyword clause, the call clause, a **chain-continuation** clause (`.map { … }`, `?.let { … }` — how
a Kotlin author breaks a long expression, and how nobody writes a sentence) and one clause no other
C-shaped arm needs: a line that carries an **assignment**. Without it `total += 1` is a line the
dialect could say nothing at all about.

**Every declaration is keyword-led, so the redeclaration proof needs no deny list.** Java's reading
has to recognise "a type, a name and a terminator" and then subtract two dozen statement keywords
that match the same shape — `return value;`, `throw failure;`, a second identical `import`, each of
which may legally appear twice. Kotlin puts `val`, `var`, `fun`, `class`, `object`, `interface` or
`typealias` in front of every declaration it has, so the reading recognises the keyword and
everything else declines by construction. It is also a **wider** proof than any arm's: a program's
top level here is a *script's*, where the compiler refuses a second `fun` or `object` of one name as
readily as a second `val` — measured, as `Overload resolution ambiguity` and `Duplicate JVM class
name`.

**The concurrency wrapper is three shapes, and all three are measured failures.**
`runBlocking { … }` is `Unresolved reference 'kotlinx'`, because that library is deliberately not on
[the program classpath](#what-a-program-may-reach-and-why-that-took-being-deliberate);
`thread { … }` is refused by TeaVM inside `kotlin/concurrent/Thread.kt`; and `Thread { … }.start()`
compiles and then fails with `setTimeout is not available in the sandbox` before a line of the
model's own work runs. Kotlin's trailing-lambda syntax puts the block *outside* the parentheses, so
`runBlocking(Dispatchers.Default) { … }` and `thread(start = false) { … }` are the same wrapper with
an argument list in the middle — a shape Java's arm cannot have, since there the lambda is inside
the call. The match is **anchored** to the head, which matters more here than anywhere: in Kotlin
`something { … }` is the shape of half the expressions a program writes.

**The import above it is deleted**, where Java's is kept, and that is the divergence that shows the
rule is about the *program* rather than about the language family. Java keeps
`import java.util.concurrent.CompletableFuture;` because that package is in its declared set, so the
line resolves and an unused import is legal. Kotlin's wrapper library is not reachable at all, so
leaving the line behind would leave the one line of the repaired program that still fails — which is
[Python's answer](/gg/response-healing/) and Ruby's, reached from Kotlin's classpath rather than
from theirs.

**And this is the one arm with a suspension token to delete.** Kotlin marks suspension on the
*declaration* rather than at the call site: there is no `await`, and a suspending call is written
exactly like any other. But a `suspend fun` declared inside the wrapper cannot be called once the
wrapper is off, so the modifier comes off with it and is counted — which is what makes the repair
actually run, and what makes this arm report a non-zero count where Java's and Ruby's report the
honest zero of a language with no such token.

Two more answers are its own without being disagreements. The fence tags are `kotlin`, `kt` and
**`kts`**, which is not a slip: a program here really is compiled as a script, so a model that
tagged its block with the script extension tagged it correctly. And the arm carries **two lexers**
rather than reusing one — the preparation's, which is total and tolerant because the compiler is
downstream of it, and the dialect's, which must be able to say *I lost my place* and return nothing
at all, because its answer decides whether gg deletes the model's work. Both read Kotlin's three
awkward shapes (a `${…}` template, a **nested** block comment, a backquoted identifier), each of
which is a place a Java-shaped scan silently loses the source rather than declining.

## Rust: the program is the artifact

The eighth arm: `language: "rust"` is a value an operator configures, and it is the first arm that
is a **different shape** rather than a different language.

**A Rust program is compiled by `rustc` into the wasm component that turn is evaluated by.** There
is no guest. Every arm before this one ships a committed `.wasm` carrying a whole language runtime —
a CPython, an Opal, a JavaScript engine — and hands it the model's reply as a *string* to read.
`rustc` produces no such thing: it produces the program. The seam's two shapes and what carries
them are described under [an arm whose artifact is the program](#an-arm-whose-artifact-is-the-program);
what its SDK looks like is [above](#what-rusts-sdk-looks-like); the rest of this section is what a
model and an operator see.

Measured in this repository's dev container, aarch64, on an ordinary program: `rustc` — the whole
compile, including the link — and the in-process component encode together are **~60 ms**, wasmtime's
`Component::new` on the result is **~9 ms**, and the artifact is **~25 KB**, because the link
dead-strips everything the program did not reach. The compiler itself is **~376 MB** and lives in
the [gg toolchain image](#where-a-compiler-lives-and-what-it-must-never-share); the library set it
compiles against is 9.4 MB gzipped inside gg's binary, which is the same split every compiled arm
here makes and for the same two reasons.

### The one arm with no exception mechanism at all

`wasm32-unknown-unknown` has no unwinder, so `panic = "unwind"` is not available on it and a panic
**aborts** — which traps the store, and a trap carries no message, no class and no location. Taken
literally that would make every Rust panic reach the model as "your program trapped", which is the
least useful thing gg could say about a failure it can describe exactly.

What saves it is that a panic *hook* runs before the abort, on a live guest, and can make an
ordinary synchronous host call. gg installs one that completes `feedback.report-error` carrying the
panic's message and the **model's own line and column**, out of `std::panic::Location` — static
data, which is why `-C strip=symbols` costs this arm nothing even though it deletes the name
section. The host half prefers what the program said about itself over the trap that followed it,
and displaces only an ordinary trap: a timeout or an out-of-memory is a ceiling gg imposed, so a
program that reported an error and *then* ran away is still recorded as the runaway.

The ordinary path is not a panic at all. Every call returns `Result<_, ToolError>` and the body gg
wraps a program in returns `Result<(), Failure>`, so `?` is what a Rust author reaches for and an
unhandled failure ends the turn with the failed call's own class attached.

### What its dialect says, and the three answers nobody else gives

Its [healing dialect](/gg/response-healing/) is `crates/gg/src/sandbox/language/rust.healing.rs`, and
three of its answers are ones no other registered arm gives.

**`let` is not part of the redeclaration proof.** On every other arm the keyword that opens a
binding is the whole of that proof — a second `const`, `val`, `def` or `let` of one name is refused
before a statement runs, which is exactly the warrant
[`drop-duplicate-program`](/gg/response-healing/) needs. Rust **shadows**: `let total = 1;
let total = 2;` is ordinary, deliberate, everyday Rust, so a duplicated program made only of `let`s
and calls is one that *runs its work twice* rather than one the compiler refuses. The proof here
rests on **items** instead — `fn`, `struct`, `enum`, `union`, `trait`, `type`, `const`, `static`,
`mod`, each `E0428` twice in one block — and on a single-name `use`, which is `E0252`. Both were
measured against `rustc` rather than reasoned about, and a glob import is excluded because writing
one twice is legal. A duplicated program with no item and no import declines, which is the honest
answer: it would have run.

**Nothing is done about an import, and nothing needs to be.** Every other arm either deletes the
model's `import` lines — they have no module loader — or hoists them somewhere they resolve, which
is what the two JVM arms do. Rust needs neither: a program here is a function body, Rust admits an
**item** wherever a statement may stand, and `use std::collections::HashMap;` therefore resolves
exactly where the model wrote it. This is the one arm that answers "no" to
`is_import_statement` because the line *works*, rather than because gg moved it.

**The lexer has to tell a character literal from a lifetime.** `'a'` is a `char` and `'a` is a
lifetime, and they open with the same byte — a hazard no other arm's `'` carries. A scan that read
the `'` of `&'static str` as an opening quote would swallow the rest of the program into a string,
and every strategy that consults the mask would then be reading the wrong text. So a `'` here opens
a literal **only** when what follows it is one character and then a closing `'`. That rule has a
second effect worth having: an apostrophe in a stray line of English (`don't`) is ordinary code
punctuation rather than an unterminated literal, so a reply of prose around a program still lexes —
where the identical apostrophe leaves Kotlin's scan with no mask at all.

Two more of its lexer's answers are its own without being disagreements. A Rust string may **span
newlines**, so a `"` still open at a `\n` is not evidence of anything, which is the opposite of every
other C-shaped arm; and a **raw** string carries its own fence (`r"…"`, `r#"…"#`, `r##"…"##`, with
`b` and `c` prefixes), so the fence has to be counted rather than looked for. A backtick goes back
*off* the non-prose list, which is Java's answer and not Kotlin's: Rust has no backtick anywhere in
its grammar — an identifier that needs escaping is written `r#type` — so a lead-in written with an
inline code span may be deleted here.

Its concurrency wrapper is `std::thread::spawn(|| { … })`, in both the immediate and the
bound-and-joined shapes, and it is a **measured** failure rather than an assumed one: `spawn`
compiles for this target and then panics, because the target has no threads. The `use` lines above
it are **kept**, which is Java's answer rather than Kotlin's and for this arm's own reason —
`std::thread` really is in its library set, so the line resolves and an unused import is a warning
gg has already silenced. `.await` inside the body comes off and is counted, which is Rust's
suspension token in the one place it lives: after the expression rather than in front of it.
Deliberately *not* recognised is any `async` shape — `block_on(async { … })` needs `futures` or
`tokio`, neither of which is in the library set, so a program that reaches for one already gets
`E0433` naming the crate before it runs.

### What a Rust program is, and the one shape it refuses

A **sequence of statements**, as on every arm but PureScript, put inside the body of a function gg
declares — because Rust has nowhere else for a statement to live, and because a function body admits
everything a Rust author writes: `use`, `struct`, `enum`, `trait`, `impl`, `fn`, `const`, `static`,
`mod`, `#[derive(…)]` and even an inner `#![allow(…)]`. The wrapper is **one line**, which is the
whole of the arithmetic that keeps a diagnostic at the model's own line and column, and the
[code modules](#a-module-a-program-has-to-be-linked-against) it declares go *below* the model's
text where they move nothing.

The one refusal is a program that defines **`fn main`**. There is no `main` on this arm, so a model
that put its work inside one has written a local function nothing calls — and gg would otherwise
report a clean turn over a program that did nothing, which round 1 established is the one failure a
model cannot recover from. It is refused by name, at the line, with a sentence saying what to write
instead.

## Swift: the reply is the artifact, verbatim

The ninth arm: `language: "swift"` is a value an operator configures, and it is
[Rust](#rust-the-program-is-the-artifact)'s **shape** reached down a different road.

**A Swift program is compiled by `swiftc` into the wasm component that turn is evaluated by**, and
there is no guest to commit. What its SDK looks like is [above](#what-swifts-sdk-looks-like); what
the shape is and what it costs the seam is under
[an arm whose artifact is the program](#an-arm-whose-artifact-is-the-program); the rest of this
section is what a model and an operator see.

Measured in this repository's dev container, aarch64: `swiftc` — type-check, optimise and link in
one invocation — is **~0.3 s**, the in-process component encode is **~10 ms**, the artifact is
**~7.1 MB**, and wasmtime's `Component::new` on it is **~1.3 s**. **This is the only arm that pays
more to instantiate a program than to compile it**, and it is a real result rather than an
accident: Swift's standard library is statically linked and its reflection metadata keeps most of
itself reachable, so the dead-strip that leaves a Rust program at 25 KB has almost nothing to
remove here. The compiler and the Swift SDK for WebAssembly are **~835 MB** and live in the
[gg toolchain image](#where-a-compiler-lives-and-what-it-must-never-share); the curated library set
is 3.4 MB inside gg's binary.

### The reply is compiled verbatim, and that is what forced the shape

**A model's reply is compiled as `main.swift`, unaltered.** Nothing is prepended, nothing appended,
nothing re-indented — so a diagnostic at line 7 is line 7, and there is no offset to subtract
anywhere in this arm. It is the only compiled arm that can say that of a reply carrying
declarations.

It is forced rather than chosen. Swift refuses `extension`, `protocol` and `import` inside a
function body, so the wrapper every statement-shaped arm uses would forbid three things a Swift
author writes without thinking, one of which (`extension`) is what the language is built around. A
top-level file is the only Swift context that admits declarations and bare statements together, and
what makes it work is that gg's shell is a second file of the **same module**: Swift lowers a
top-level file's statements into the target's C entry point, and the shell, sharing the module,
names that symbol and calls it from the `run` export. The same fact is what puts gg's whole surface
in the model's file with **no import line** — the shell writes `@_exported import gg`, and a
re-export is module-scoped where a plain import is file-scoped.

There is no refusal here at all. No program shape is turned away, which is the one thing this arm
has that [Rust](#what-a-rust-program-is-and-the-one-shape-it-refuses) does not.

### A guest whose failures nothing inside it can catch

[Rust](#the-one-arm-with-no-exception-mechanism-at-all) has no unwinder either, but it has a panic
*hook* — a function that runs on a live guest before the abort and can complete an ordinary
`feedback.report-error` first. Swift has no equivalent, and its top-level code is not a `throws`
context a shell could wrap, so an uncaught error, a `fatalError`, a force-unwrapped `nil`, an index
out of range and an arithmetic overflow all end as a **trap**.

What keeps those from being opaque is not what anyone would guess, and it was measured rather than
assumed. Swift at `-Osize` does not *print* its runtime failures: the optimiser replaces the report
with a bare `unreachable` and encodes the message in the **debug information**, as the name of a
synthetic inlined frame. So the artifact is compiled with `-g`, gg's engine symbolicates a trap's
frames, and a model reads

```text
Swift runtime failure: Index out of range
  … at /gg/work/main.swift:3:22
```

— the message and its own line, for a failure it could not have caught. Without the debug
information the same program says `program.wasm!main` and nothing else.

Two gaps are worth stating rather than glossing. A `precondition`'s *custom* message is dropped by
the optimiser where a `fatalError`'s is kept. And an **uncaught throw** arrives with gg's own
sentence and *no line at all*: the runtime hands the error to `swift_errorInMain` from the entry
point's synthesized epilogue, so the only frames left are `/<compiler-generated>`. Catching what
you expect is what buys the line back.

### What a Swift code module is

A **file of the program's own Swift module**, with each of its top-level declarations moved into
`lib.<key>` by being wrapped *where it stands* in an `extension` of a caseless `enum`:

```text
public func parse(_ text: String, delimiter: Character = ",") -> [Row] {          // as authored
extension lib.csvTools { public static func parse(_ text: String, …) -> [Row] {   // as compiled
```

Two things follow, and both are why this shape was chosen over the two alternatives. **Every line
number is preserved**, because the wrap is a prefix on the declaration's first line and a suffix on
its last. And **the declaration keeps everything a Swift declaration has** — argument labels,
default values, generics, `where` clauses, `throws`, overloads — because nothing is re-synthesized.
The alternative, compiling each module as its own Swift module and binding its exports into `lib`
through forwarders, was rejected for exactly that: a function bound as a value (`static let parse =
csvTools.parse`) **loses its argument labels**, which on the arm whose SDK is built around them is
the one thing that must not be quietly given up, and it cannot bind an overload or a generic at all.

What it costs is stated rather than hidden. A module's `import`, `extension`, `protocol` and
operator declarations cannot live inside a type, so they stay at file scope — which here is the
program's own module, so a `protocol` two code modules both declare is a redeclaration the turn's
compile reports. And a `#if` at a module's top level is **refused by name**: its two halves would
land in two different scopes, and this sandbox compiles for one target, so one of its branches was
never going to be taken.

Because a module and the program are one Swift module, a module is checked with a `-typecheck`
rather than a build when it is read — there is nothing to optimise and nothing to link for
something that will be compiled again as part of every program that uses it.

### What its dialect says, and the three answers worth reading beside another arm's

Its [healing dialect](/gg/response-healing/) is
`crates/gg/src/sandbox/language/swift.healing.rs`.

**The redeclaration proof is the widest of any registered arm's**, and it is the exact inverse of
Rust's. Rust shadows, so its proof had to retreat to items; Swift refuses a second `let`, `var`,
`func`, `struct`, `class`, `enum`, `actor`, `protocol` or `typealias` of one name at one scope,
before a statement runs. So the everyday doubled program — the one made of nothing but bindings and
calls — is provably dead code here where it might have run there. `import` is the one declaration
excluded, because writing one twice is legal, and `extension` because it declares no name of its
own.

**Nothing is done about an import, and this is the second arm where that is because the line
works.** A program here is a whole top-level file, Swift admits an `import` anywhere in one —
measured, not assumed — and every module of this arm's library set is on the search path the
program is compiled with. A module that is *not* in the set is a located `no such module` on the
turn that wrote it, which is a better answer than a silent deletion.

**Its lexer survives text two of the others' do not, and asks two things no other's does.** Swift
has **no character literal**, so an apostrophe in a stray line of English is ordinary punctuation
here where the identical byte leaves Kotlin's scan with no mask at all. Interpolation is a **paren**
count rather than a brace count (`"total: \(rows["n"])"`), and inside a raw string the escape
carries the fence too (`#"\#(value)"#`). A raw string's `#` fence has to be counted rather than
looked for, `"""` may span a newline where `"` may not, and block comments nest.

Its concurrency wrapper is `Task { … }`, in both the immediate and the bound-and-awaited shapes,
and it is a **measured** failure rather than an assumed one: the artifact compiles, the task is
scheduled, the program returns, and nothing is left to run it — which is the worst failure shape
there is, a clean turn over a program that did nothing. The `import` lines above it are **kept**,
for the same reason nothing is done about an import anywhere on this arm. `await` comes off as a
**prefix**, which is where Swift puts suspension, and is counted.

## C++: the prelude is precompiled, and the exceptions work

The tenth arm: `language: "cpp"` is a value an operator configures, and it is
[Swift](#swift-the-reply-is-the-artifact-verbatim)'s **shape** — a reply compiled byte for byte
into the component that evaluates it — reached at a fraction of the cost.

**A C++ program is compiled by `clang++` into the wasm component that turn is evaluated by**, and
there is no guest to commit. What its SDK looks like is [above](#what-cs-sdk-looks-like); what the
shape is, what the precompiled header buys, what enabling exceptions cost the workspace and what
the three failure bands are, is under
[an arm whose artifact is the program](#c-a-compiler-with-a-precompiled-prelude); the rest of this
section is what a model and an operator see.

Measured in this repository's dev container, aarch64: `clang++` is **~85 ms** for a small program
and **~0.95 s** for one leaning on ranges, `std::format` and a map; the in-process component encode
is **~2 ms**; the artifact is **~800 KB**; and wasmtime's `Component::new` on it is **~19 ms**.
That makes this the **cheapest arm per turn of the three that compile their own artifact** — but
only because the prelude is precompiled once per machine. Without that, the same small program is
883–1110 ms. wasi-sdk is **~200 MB** pruned and lives in the
[gg toolchain image](#where-a-compiler-lives-and-what-it-must-never-share); the compile inputs gg
carries are 36 KB inside its binary, and there is no third-party library set at all.

### What a model has to know that it does not on any other arm

Two things, and both are consequences of C++ having nowhere to put a statement except a function
body.

**The reply must define `main`.** It is compiled as `main.cpp`, unaltered — nothing prepended,
nothing appended, no line moved, so a diagnostic at line 7 is line 7 — and gg's shell calls the
model's own entry point. A reply that defines none is refused by name *at prepare time*, with a
sentence saying what to write, because the linker will not object: wasi-libc references `main`
weakly, so a program with nothing to run links cleanly and traps having done nothing.

It is the exact inverse of the [Rust](#rust-the-program-is-the-artifact) arm's one refusal, which
is a program that *does* define `main` — and the two are the same rule read in two grammars. On
that arm a `main` is a function nothing calls; on this one its absence is a program with nothing
in it. Both are the failure a model cannot recover from: a clean turn over work that never ran.

**Nothing has to be included.** The precompiled prelude puts gg's whole surface *and* the C++
standard library in front of the model's first line, so `fs::read_file`, `std::vector` and
`std::format` are names a program may write on line 1. Writing the includes anyway costs nothing —
clang de-duplicates them against the precompiled header — which is the point of compiling the reply
verbatim rather than editing it.

### What a C++ code module is

**A header, with the author's declarations opened inside `namespace lib::<key>` where they stand.**
gg writes two lines above the author's first and one below their last, and the module is put in
front of the model's program with `clang++ -include` — which is what a header is for, and the one
way to add declarations to a translation unit whose first line has to stay the model's own.

```cpp
namespace lib::csv_tools {                                             // gg's line
#line 1 "module_csv_tools.hpp"                                         // gg's line
std::vector<row> parse(std::string_view text, char delimiter = ',') {  // as authored
```

It is the plainest module shape of the three compiled arms, and two things about C++ are why.
It has a **real nested namespace**, so nothing is moved, re-synthesized or declared twice — every
default argument, template parameter, overload and `struct` survives because the author's own text
is what the compiler reads, where the Swift arm had to reach for an `extension` of a caseless
`enum` to keep the same properties. And it is the one language here with a **line-control
directive**, so gg *says* what the author's first line is instead of subtracting two from every
diagnostic afterwards: no line number moves at all.

Two modules may declare the same name — `lib::a::row` and `lib::b::row` are different types —
which is a thing the Swift arm cannot say, because its `protocol` and `extension` declarations stay
at file scope.

**A `#include` at a module's top level is refused by name**, and it is this half's one refusal.
`#include` is textual, so one inside a namespace pulls the whole header into `lib::<key>` — and
when the header is one the prelude already read, its include guard is already defined and it
expands to *nothing at all*, which is worse: the module would compile, and the same line would
detonate the day somebody wrote a header the prelude does not carry. Hoisting it out would be gg
editing the author's file, which is the one thing this arm has never done to anybody's text. The
refusal says to delete the line and write nothing in its place, because the prelude is in front of
a module exactly as it is in front of a program.

That is an asymmetry with a **program**, whose `#include` is left exactly as written, and it is the
language's rather than gg's: a program is not compiled inside a namespace.

### What its dialect says, and the one question only this arm has to answer

Its [healing dialect](/gg/response-healing/) is `crates/gg/src/sandbox/language/cpp.healing.rs`.

**`#` is both Markdown's heading and C++'s preprocessor, and case is what tells them apart.** No
other arm has to answer this: every other dialect keeps `#` off its prose test and loses nothing,
while here `#include` and `#define` open the file and `# Heading` opens the reply. So `#` is not
read as code punctuation — a heading stays deletable — and a line whose `#` is followed by one of
the fourteen directive words **spelled lower-case** is code to both predicates. `# Include the
manifest` is capital-I and is prose; `#include` is not.

**The redeclaration proof is the strongest of any registered arm's, and this arm gets it from the
shape of the language.** Every other arm's version of it asks whether the repeated tail happens to
declare something the compiler refuses twice. A C++ program *must* define `main`, so a reply that
is one program pasted after an identical copy of itself always carries two definitions of it —
`redefinition of 'main'`, before a statement runs. The reading is wider than that, so a doubled
*fragment* is caught too; the one shape it must not get wrong is a **reopened `namespace`**, which
is ordinary C++ and is excluded by name.

**Nothing is done about an `#include`, and this is the third arm where that is because the line
works.** A redundant include is de-duplicated against the precompiled header for nothing, and a
header the prelude does not carry is a located `file not found` on the turn that wrote it — which
is a better answer than a silent deletion.

**There is no concurrency wrapper to unwrap**, and that is two independent facts rather than an
omission. A reply's top level is a translation unit rather than a statement list, so the shape the
strategy looks for — a whole program that is one wrapper and nothing else — does not exist in this
grammar; the model's work is inside `main` either way. And `<thread>`, `<future>` and `<atomic>`
are deliberately off the library set, so a program that reached for concurrency is `no type named
'thread' in namespace 'std'` at the model's own line. That is the opposite of the
[Rust](#rust-the-program-is-the-artifact) arm, whose `std::thread::spawn` **compiles** and then
does nothing at run time — which is why that arm deletes the wrapper and this one has nothing to
delete.

Its lexer asks three things no other arm's does. A **raw string's fence is chosen by its author**
(`R"gg(…)gg"`), so it has to be read rather than looked for; `'` is a **digit separator** as often
as it is a quote, and the rule that tells them apart is that a literal cannot open where a value
has just ended; and **block comments do not nest**, which is the opposite of Swift's and Kotlin's.
It is also the one lexer here with two readers: healing gets a mask **only when the scan ended
cleanly**, because a strategy that deletes text must not act on a reading known to be wrong, while
the reader that asks whether a reply defines `main` takes the best reading whatever happened,
because its errors are safe in the accepting direction.

## What compiling costs, and where it is recorded

A language is free to spend real time turning a model's reply into something its guest can
evaluate, and every registered one does. TypeScript's
[prepare step](#what-a-language-supplies) is an in-process parse and type-strip of about
0.2 ms **and** a `tsc` pass that brings the step to about 90 ms in total, and that
[type-checks the program](/gg/responses-as-code/#stripped-and-checked) before the guest
sees it; a compiled language spends whatever its compiler takes. An arm cannot be compared
on cost against an arm that spends less.

That time is **recorded per program and rolled up per run**, because nothing else records
it. The sandbox's own clock starts once a program is prepared, so a compile lands in
neither the turn's `durationMs` nor its `compileWaitMs` — the latter is the one shared
interpreter-component compile, which belongs to the process — and would otherwise be
absorbed into the turn's response time, indistinguishable from a `shell` build that took
four minutes.

- each [`code_execution`](/gg/telemetry/) event carries **`compileMs`**: what compiling
  cost *that turn*. A turn that handed over to a replacement program compiled each of
  them, and the figure is their sum.
- the session summary carries **`summary.compileMs`**: the run's total, folded from those
  very events, so it and `summary.codeExecutions` are an honest ratio — what a turn of
  arm A costs in compile time against a turn of arm B is one query.

**Everything a turn made its compiler do is in that figure, not just the model's own
reply.** Three things reach a compiler on a code turn, and all three are charged to the
turn that caused them:

- the program the model wrote, and each replacement it
  [handed over](/gg/program-library/#what-rerun-actually-does) to;
- the code half of every [skill](/gg/skills/) or [memory](/gg/memories/) the turn brought
  into use — a code skill is compiled again on each agent that reads it, which is a real
  recurring cost of a compiled arm rather than a one-off;
- and each [on-use script](/gg/skills/) such a read queued, which is a whole program of
  its own.

The middle one is the reason the field is folded rather than simply read off the sandbox: a
read happens *inside* a call the program made, after the sandbox has taken its reading and
while the turn's own clock is stopped. Nothing else is running a clock at that moment, so a
figure that skipped it would be short by exactly what a skill-heavy run spends — silently,
and always in the direction that makes the arm look cheap.

Two deliberate asymmetries in how absence is spelled. Per turn, a language that compiles
nothing reports **nothing at all** rather than a zero: `null` says "there is no compiler on
this path", which a zero would not, and a column of zeroes on every turn of such a run
would be noise in front of the one study the field exists for. Per run, the same arm
reports **`0`** rather than omitting the field, because a query averages a measurement and
silently drops a run that has none. Two registered languages take that branch, for opposite
reasons — [JavaScript](#javascript-the-same-arm-unchecked) because gg deliberately took its
check away, [Python](#python-a-guest-that-carries-its-own-interpreter) because there is no
host-side compiler to take away — and JavaScript is the arm a checked one is compared against,
so the difference between "compiled, in under a millisecond" and "there is no compiler here"
is exactly the difference being measured.

And the figure is reported for the turn whose program the compiler **rejected**, which is
the turn it most exists for: a compile that spent four seconds refusing the program spent
them, the model gets its turn back, and every other reading of that turn is zero.

A language declares whether it compiles at all — it is a required answer, not an inferred
one, so a language cannot be registered with its compile time going quietly unrecorded.

### A compiler has two ways to fail

They look alike and they mean opposite things, so the prepare step reports them as different
values and gg keeps them apart from there to the run record:

| | What happened | What the model is told | How the turn is recorded |
| --- | --- | --- | --- |
| **The compiler rejected the program** | It read the reply whole and found a type error, a borrow error, a name that does not resolve | a `Compiler error` carrying the compiler's own diagnostics and nothing else | `transpile_compile`, under the `transpile` base kind — the model's to fix |
| **The compiler could not finish** | It crashed, its own timeout killed it, or the binary is not in the run's image | a `Notice`: its program was not run, this is the environment, and **nothing about the program was rejected** | `toolchain_failed`, under the `toolchain` base kind — not the model's |

Reporting the second as the first is the failure that matters, because it is silent: the
model reads "your program did not compile" over a program nothing ever read, and spends its
next turn rewriting something that was never wrong. Meanwhile the arm's `transpile` rate
absorbs the image's flakiness and reads as a worse model.

Neither of them is [`SandboxError::Compile`](/gg/responses-as-code/#what-can-go-wrong), which
is the *committed interpreter component* failing to compile — an artifact defect that ends
the session, because every further turn would fail identically. Both of these are
recoverable: the next turn's program may well compile.

A compiler that could not finish is still an **error turn** and still counts against the run's
[error ceilings](/gg/execution-limits/#a-broken-compiler-counts-but-is-not-the-models-error),
because a run whose compiler is broken must stop rather than burn to its deadline. The
separate base kind is what makes the attribution survive that counting.

The split holds on the **other** thing gg compiles, too. A [code skill](/gg/skills/#code-skills)
or a [code memory](/gg/memories/#code-that-does-not-compile) goes through the same prepare
step, and the same two failures mean the same two things there: a rejection hands the author's
diagnostic back on the read, while a compiler that could not finish tells the model only that
the module was not compiled and that nothing about it was rejected, and puts the crash detail
on the operator's stream — where it has a reader who can fix the image, which is the only
reader it has at all.

### Where a compiler lives, and what it must never share

A compiler is on the **turn path**, so it has to be in the run container. Some compilers
travel *inside* gg and need no image at all — TypeScript's `tsc` and the Opal that compiles
[Ruby](#ruby-compiled-to-javascript-before-it-crosses) are both JavaScript bundles gg carries
and runs with the `node` every run image already ships, which is why neither language has a
block in the toolchain image. This section is about the ones that cannot: gg itself is
copied in as a single static binary, which works because a binary copies fine — a JDK does
not. [PureScript](#purescript-a-compiler-in-the-image-a-library-set-in-the-binary) is the
first arm to need this, and it needs it for exactly that reason: `purs` is a ~100 MB
statically linked Haskell executable with one build per platform. So a gg run resolves a `<name>-gg` **variant** of the image it would otherwise get:
that image plus a toolchain tree (`containers/gg-toolchains/`, laid onto a parent by
`containers/gg/Dockerfile`, resolved by `harness::gg_variant`).

Three things about that image follow from how gg works, and each of them is a constraint
rather than a preference.

**Every toolchain is present together.** A program's language is
[configured per agent](#what-a-language-supplies), so one run can drive a C# agent and a
Python agent at the same time. There is no such thing as "the run's toolchain".

**No other harness's image carries them.** They are for one harness. A Claude Code run must
not pull gigabytes it cannot use, and a model that found a Swift compiler on `PATH` in an
end-to-end run would have been handed a capability no other arm of that comparison has —
which is the same reason the toolchains are a variant image rather than a layer on the
shared one.

**Every image publishes one, and the name is derived rather than listed.** Because language
is per agent, a gg run on *any* case — an asset-generation kind, an adversarial case — may
drive a compiled-language agent, so there is no combination of test type and `asset_kind`
for which gg may resolve an image with no compilers in it. `ImageSpec::gg_variant` appends
the suffix instead of consulting a table, and a test fails the build if the names Rust
resolves and the names `containers/image-names.sh` publishes ever disagree. The cost is a
doubled image set and CI matrix; the thing it buys is that "does this image have the
toolchains?" has one answer.

What the tree carries today, and what each weighs: `purs` and `esbuild` (~110 MB), a
Temurin JDK with TeaVM's jars (~154 MB), the Kotlin compiler on top of it (~67 MB), a
pruned `rustc` with the `wasm32-unknown-unknown` standard library (~376 MB), a pruned
Swift toolchain with the Swift SDK for WebAssembly (**~835 MB**, the largest by a wide
margin), and a pruned **wasi-sdk** — clang, `wasm-ld`, wasi-libc and libc++ — for the C++
arm (~200 MB, the *smallest* of the three compiled arms'). Rust's is pruned to `rustc`, its two shared libraries, the wasm standard
library and `rust-lld` — `cargo`, `rustdoc`, the lint tools, the standard-library sources
and the *host* standard library are all removed, none of which a cross-compile of a program
with no proc macros touches. That toolchain's version is the one place a pin is **not** the
arm's own: it is `rust-toolchain.toml`'s, because an `.rlib` is a compiler-version-private
format and the compiler in the image must be exactly the one that built the library set
inside gg's binary, so there is only one Rust release in the repository at all.

Swift's is pruned from 3.3 GB to the driver, the front end, `clang`, `lld` and the transitive
closure of the shared objects those need — walked rather than copied by directory, which is
what leaves Foundation's networking half and `libcurl`'s own system closure behind — plus the
SDK's wasm sysroot and its *static* standard library; the editor services, the debugger, the formatter, the
documentation tool, the build system, the host standard library and 577 MB of Embedded
Swift resources all go. It is also the one toolchain here that carries **libraries of its
own that are not a compiler**: the published build is Debian 12's and its `lld` links
against that distribution's `libxml2` soname, which the Debian-derived run images have and
`blender-gg`'s Ubuntu does not — so the closure travels under the tree and gg names it on
`LD_LIBRARY_PATH` for every compile. Its pin is **hard**, for Rust's reason arrived at
differently: gg carries that arm's SDK as a `.swiftmodule`, which is a
compiler-version-private format, so the compiler in the image must be the one that built it. That is the "a language's own step vendors what it
needs" clause of the image's portability constraint, taken literally, and it is the reason
that block runs an installer rather than two `curl`s.

C++'s is the same clause satisfied at a tenth of the effort, and the difference is the
toolchain rather than the work: wasi-sdk is built to be relocated, so `clang` finds its own
sysroot from its own path, every binary carries an `$ORIGIN/../lib` rpath, and the only
things outside the tree it needs are the two GCC-runtime sonames its Debian build links —
which the installer copies in beside it, where that rpath finds them and nothing else in the
image does. No `LD_LIBRARY_PATH` and no closure walk. What is pruned is the debugger, the
lint and format tools, the object utilities, the other linker drivers, and — the largest
deletion by far — four of the wasi-sysroot's five *targets*, since the arm compiles to
exactly one. Its pin is the **softest** of the three, because what gg commits for it is
objects rather than a compiler-private module format; what is version-private is the
[precompiled header](#c-a-compiler-with-a-precompiled-prelude) the arm builds per machine,
and the directory that lives in is keyed on the compiler binary itself so a reinstall writes
a new key rather than leaving one nothing can read.

### Per-agent compiler isolation

This is the rule **every** language integration satisfies, and the one whose violation gg
cannot detect after the fact. It is stated here in full because a language that gets it
wrong does not fail — it produces wrong answers that look right.

**The rule.** *What a preparation returns is a function of that preparation's input alone.*
Nothing a language compiles with may be reachable from another preparation running at the
same time.

**Why it bites here.** Several compilations are in flight at once, routinely: language is
resolved [per agent](#what-a-language-supplies), agents run in parallel up to
`limits.maxParallel` (16), each turn may chain up to four programs, and every one of them
prepares in the same process.

**Why it is not hypothetical.** Two silent-corruption bugs were measured on real toolchains
while the capability was being designed:

- eight concurrent `purs` compiles into one shared output tree produced a single
  `output/Main/index.js` containing **two different agents' programs interleaved** —
  reproduced 3 times out of 3;
- a shared TeaVM `InProcessBuildStrategy` driven from four threads produced **no output at
  all for three of the four**, and `build()` threw nothing.

**Every process exited zero in both.** Nothing crashed, nothing raised a diagnostic, and
nothing would have been recorded as a [toolchain failure](#a-compiler-has-two-ways-to-fail).
One agent silently evaluates another agent's program, the turn reports success, and every
number downstream is wrong while looking healthy. That is the shape to design against — not
a crash, which the toolchain band already reports.

#### What a language uses instead, and where it comes from

A language does not arrange its own isolation. `prepare_program` and `prepare_module` are
each handed a **`PrepareContext`**, minted per preparation by the sandbox and by nothing
else, and it hands out the only ground the seam offers
(`crates/gg/src/sandbox/language/compile.rs`):

| Need | The one sanctioned answer |
| --- | --- |
| Somewhere to put files while compiling | `context.workspace()` — created fresh per preparation, removed when it ends. A language uses fixed file names inside it; the directory is what differs. |
| Somewhere for a compiler's artifacts | `workspace.output()`, inside that same private tree |
| Running a compiler | `context.compiler(program)` — working directory, `HOME`, `TMPDIR` and the `XDG_*` roots all inside that tree, plus the timeout, the kill and the reap |
| A long-lived compiler instance (a daemon, a warm builder) | `CompilerPool::checkout` — lends an instance **exclusively**, so no two preparations can hold one |
| A long-lived compiler **process** to put in that pool | `daemon(program)` — started on a private tree of its own rather than on any preparation's workspace, spoken to one request at a time with a deadline, killed and reaped when it is dropped |
| Toolchain inputs too big to unpack per preparation | `shared_toolchain_dir(key)` + `place(path, bytes)` for one file, or `place_tree(path, fill)` for a whole directory — content-keyed, written by rename, **sealed read-only afterwards** |

The environment redirection is what earns the most. A toolchain that writes to `output/`
relative to its working directory, or to `~/.cache/<toolchain>`, or to `$TMPDIR` — which is
most of them, and is exactly how the `purs` corruption happened — lands inside the private
tree without its language having thought about it. A language cannot opt out by forgetting;
it can only opt out by naming an absolute path somewhere else on purpose.

The pool is the answer to the *other* bug. Keeping a compiler warm is often the difference
between an affordable arm and an unaffordable one — a `purs ide server` turns 1.1–3.6 s into
151–713 ms, an embedded `kotlinc` turns 9.7 s into 140 ms — and the obvious way to keep one
warm is a `static` instance every preparation reaches, which is precisely the TeaVM bug. A
checkout **owns** its instance for the length of one compilation, so exclusivity is a
property of the borrow checker rather than of a discipline. The [Java arm](#java-a-warm-jvm-and-two-compilers-per-program)
is the first to need it — a cold JVM is 4–9 s and a warm one 0.33–0.56 s — and its own tree
is why `daemon()` exists rather than a preparation's `compiler()`: a daemon outlives the
preparation that started it, and a workspace does not.

#### What holds a language to it

Three gates, none of which a language opts into:

1. **The isolation gate** (`crates/gg/src/sandbox/language/isolation.rs`) drives every
   registered language's program step *and* module step **sixteen at a time**, each with a
   distinguishable input, and requires every result to belong to its own input: it
   succeeded, it carries its own marker, it carries no other preparation's marker, it
   matches what the same input produced alone, and no two of the sixteen were handed the
   same workspace. The input it drives them with is each language's own
   [generated documentation program](#the-steps) with the marker as one of its names — the one
   *whole program* the seam requires every language to be able to write. It used to be a single
   synthesized file-view statement, and PureScript is why it is not: a language whose programs are
   **modules** has no compiling artifact for one loose line, so that subject would have failed this
   gate's own baseline over syntax rather than over anything about isolation. For the **module**
   half a language may answer with a subject of its own shape, and
   [Java](#what-a-java-code-module-is-and-the-one-gate-that-noticed) is why: a Java module is a
   class body while a Java program is a statement sequence, so that same program is a module
   offering nothing. The default stays the program, and it is safe to default because the baseline
   pass runs each subject **alone** before any concurrency and names the language whose baseline
   failed. The list of languages
   is derived from the registry, so a new arm is inside the gate the moment it compiles —
   including one that compiles nothing:
   [Python](#python-a-guest-that-carries-its-own-interpreter) is driven sixteen ways like
   every other arm, opens no workspace and spawns no process, and passes because a
   preparation that touches nothing shared trivially satisfies a rule about shared state.

   One thing the "matches what the same input produced alone" check has to be told, and it is
   told **by the language rather than by weakening the check**: a compiled arm may put things in
   its artifact that describe *how* it was built rather than what it does, and some of them are a
   function of the private tree the isolation contract itself created. A language therefore
   declares a **stable projection** of its own artifact, identity for every arm but one.
   [Swift](#swift-the-reply-is-the-artifact-verbatim) is the exception twice over: its debug
   information records the clang module cache and precompiled-header hashes computed over an
   invocation naming this preparation's own working directory, `HOME` and `TMPDIR` — ~1.5 MB that
   differ between two preparations of one program and are byte-identical everywhere else — and
   `swiftc` stamps every object with a 16-byte module hash no flag disables. The projection sets
   exactly those aside, by a section-framing walk that keeps every standard section and every
   custom section that is not `.debug_*`, and by an anchor **derived** from compiling one program
   twice with assertions that fail loudly if a second source of variation appears. The rule a
   projection is held to is that it may set aside a description of *how* an artifact was built and
   never any part of what it does — so the marker checks, which are the two that catch the measured
   corruptions directly, are untouched by it.
2. **The gate's own teeth.** It is generic over a *preparation*, not over a language, and
   its tests point it at four deliberately broken ones — the two measured bugs written in
   the smallest code that has their shape, plus a memoised compile and a cache keyed on
   something that is not the program — and require it to catch each. Beside them sit the two
   correct implementations, a private workspace and a pooled daemon, which must pass. A
   language author is meant to recognise their own design in one of the six.
3. **A source-level gate.** No file under `crates/gg/src/sandbox/language/` may name
   `Command::new`, `process::Command`, `env::temp_dir` or `TempDir` — only the seam's own
   `compile.rs` may. A compiler started outside the seam is a compiler with none of the
   above, so it is a failing test rather than something discovered in a study's numbers.

**It is *not* a stall risk.** The prepare step runs on a blocking task, so a slow compiler
holds up neither the loop nor any sibling agent. The hazard is contention and shared state,
and guarding the wrong one costs the isolation that is actually needed.

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
that is *not* fixed across languages: TypeScript takes a trailing options object and Python
takes keyword arguments, because those are what each language's readers and writers expect. The SDK bridges its idiom to the wire; the model never sees the bridge.

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
| **Preparing a program** | Turning a model's reply into source its guest can evaluate, given the [code modules](#a-module-a-program-has-to-be-linked-against) already in that agent's scope. TypeScript's is the `oxc` type-strip, the early-error check, the refusals for module syntax and top-level `await`, the stack sizing an unguarded recursive-descent parser forces on untrusted text, and then a `tsc` pass over the unstripped source. A language that runs a compiler here must also say **which of two failures** it hit — see [below](#a-compiler-has-two-ways-to-fail). |
| **Whether preparing a program compiles** | Whether that step invokes a compiler whose cost belongs to the program that paid it, and is therefore [recorded](#what-compiling-costs-and-where-it-is-recorded). A required answer rather than an inferred one: an arm whose compile time went unrecorded because nobody declared it would look free and would not be. |
| **Preparing a module** | Turning a [code skill](/gg/skills/#code-skills)'s or [code memory](/gg/memories/#code-memories)'s file into something that yields a namespace, bound at `lib.<key>` — for an interpreted arm, source its guest evaluates; for a [compiled](#a-module-a-program-has-to-be-linked-against) one, source the *next program's* compile is built against. |
| Its **guest component** | The committed `.wasm` that evaluates the prepared source, embedded in the binary — or **nothing at all**, for an arm whose prepare step [compiles the component itself](#an-arm-whose-artifact-is-the-program). |
| Its **signature catalogue** | The committed JSON reflected out of its own SDK — every object, signature, argument, type and type member the model reads through `object.list()` and `view.openDocsView()`. See [the catalogue](#the-catalogue). |
| A **healing dialect** | The language-shaped questions [response healing](/gg/response-healing/#the-skeleton-and-the-dialect) asks: which fence tags mean "this block is the program", which lines are certainly code and which are certainly prose, which bytes of a source are code rather than string or comment, what an import statement looks like, what makes a binding the language refuses to see twice, and what a whole-program concurrency wrapper looks like. |
| A **prompt dialect** | Its own `system-code.<id>.hbs` and `code-nothing-shown.<id>.hbs` templates, and nothing else. Not one function name: every call a template quotes is resolved from that language's catalogue when the template renders — see [nothing quotes a call by hand](#nothing-quotes-a-call-by-hand). |
| **Healing fixtures** (tests only) | Replies its own dialect must survive, so that healing's delete-only invariant is re-earned per language rather than inherited. |

Its two committed artifacts follow one convention:
`crates/gg/src/sandbox/guests/<language-id>.component.wasm` and
`<language-id>.signatures.json`. Both are checked in and embedded, which is what means no
build or CI step ever needs a componentizing toolchain. A catalogue is always the
language's own — it carries the id it was generated for and the host asserts it — while a
**component** may be shared with another language whose programs it evaluates identically:
[JavaScript](#javascript-the-same-arm-unchecked) has no `.wasm` of its own and serves
TypeScript's, which is why the pair is named in the seam's exemption table rather than left
to be inferred from a test that happens to pass.

### An arm whose artifact is the program

Every arm described above evaluates a **string**. Python's committed component holds a whole
CPython, Ruby's holds Opal, the ECMAScript one holds a JavaScript engine, and what crosses
the membrane is source those runtimes read. That shape has a name — an *interpreted* arm —
and it is not the only one.

A **compiled** arm has no runtime to commit. `rustc` does not produce a Rust interpreter
that later runs a program; it produces the program, as a wasm module, and that module *is*
the component. There is no artifact of the language that is not one particular program, so
there is nothing to check in and nothing a per-process cache could hold.

The seam carries both shapes, and the difference is two fields:

- a language answers **nothing** for its guest component, which is a real answer rather
  than an omission — the seam's "every registered language carries its committed artifacts"
  gate requires such a language to say so, so "the artifact went missing" and "this arm has
  no artifact" stay different failures;
- and its prepare step hands back the **bytes it compiled**, on the prepared program,
  beside the source. They ride together because they *are* the preparation's output: asking
  for the artifact separately would be a second compile, and a language that cached the
  answer between the two would be caching one program's artifact where the next program
  could reach it — the exact failure [isolation](#per-agent-compiler-isolation) exists to
  prevent.

What it costs is one wasmtime `Component::new` per turn instead of one per process, and
that cost is **reported rather than hidden**: it lands in the same `compileWaitMs` an
interpreted arm reports on its first turn only, so a cross-language query reads it instead
of losing it in the response residual.

How big that cost is turns out to be the language's, not the shape's, and the two arms of
this shape sit at opposite ends of it. An ordinary **Rust** program is ~25 KB and compiles
in ~9 ms, because the link dead-strips everything the program did not reach and almost
nothing in `std` is reachable from a program that does not name it. A **Swift** program of
the same size is **~7 MB** and costs **~1.3 s**, because Swift's standard library is
statically linked and its reflection metadata keeps most of itself reachable — so that arm
pays more per turn to *instantiate* its program than to compile it. Neither figure is a
defect; both are what the study is for, and this is why the field exists rather than being
folded into the turn's response time.

Two things follow that a language author should expect. There is nothing for
[precompile](/gg/responses-as-code/) to warm, so such an arm's warm-up is entirely its
prepare step's — unpacking its toolchain and its library set. And the drift gate that asks
the artifact which tools it binds asks a **freshly compiled** one: it is stronger evidence
than the committed case rather than weaker, because a stale artifact is not a failure mode
an arm of this shape has.

The first arm of this shape is **[Rust](#rust-the-program-is-the-artifact)**
(`crates/gg/src/sandbox/language/rust.rs`, `packages/gg-sandbox-rust/`). The second is
**[Swift](#swift-the-reply-is-the-artifact-verbatim)**
(`crates/gg/src/sandbox/language/swift.rs`, `packages/gg-sandbox-swift/`). The third is
**[C++](#c-the-prelude-is-precompiled-and-the-exceptions-work)**
(`crates/gg/src/sandbox/language/cpp.rs`, `packages/gg-sandbox-cpp/`). Swift inherits the
shape unchanged and adds three things to it that are worth reading before a fourth arm is
written:

- **its compiler's output is a preview1 core module, not a component.** The Swift SDK
  publishes one target triple and it is `wasm32-unknown-wasip1`, so the encode gg already
  ran for Rust additionally adapts the module with the pinned `wasi_snapshot_preview1`
  reactor adapter, which gg carries beside its bindings. A language whose toolchain emits
  preview1 is not thereby excluded from this seam; it costs one 52 KB artifact.
- **there is no `wit-bindgen` generator for it, and it does not need one.** Swift imports C
  natively, so the canonical ABI is generated once with the **C** generator, compiled to a
  wasm object at build time, and reached from Swift through a bridging header. The
  alternative — hand-writing the lowering — would be a second implementation of a
  specification that drifts from `crates/gg/wit` on its own schedule.
- **its SDK is a prebuilt module rather than sources compiled beside the program**, and the
  shell re-exports it. That is the first arm where the SDK is a separate *compilation unit*
  from the program, and it buys two things a compiled-in SDK cannot: ~2,000 lines are not
  type-checked on every turn, and a program that declares its own `fs` **shadows** gg's
  rather than colliding with it. See [what Swift's SDK looks
  like](#what-swifts-sdk-looks-like).

#### C++: a compiler with a precompiled prelude

The third arm of this shape, and the one that changes the *cost* argument rather than the
mechanism.

Everything structural it does, one of the two arms above already did. It is compiled by
`clang++` from **wasi-sdk 33** into a `wasm32-wasip1` core module and adapted with the same
pinned preview1 reactor adapter Swift needs; the canonical ABI is generated once with
`wit-bindgen`'s **C** generator, exactly as Swift's is, because calling C is what `extern "C"`
is for. What is new is four things, and each is a decision a study should be able to read.

**A model's reply is compiled verbatim, and it must define `main`.** This is Swift's shape
reached for a stronger reason: C++ refuses a `template` and a `namespace` at block scope
outright, and a `#include` inside a function body would expand the whole of `<vector>` there.
So the reply is a translation unit, gg's shell calls its `main`, and a reply that defines
none is refused by name at prepare time. That refusal has to exist because the *linker* will
not object: wasi-libc references `main` weakly, so a program with no entry point links
cleanly and traps having done nothing — which is the one failure a model cannot recover from.
No linker flag asks the question (`--undefined`, `--unresolved-symbols=report-all` and
`--export` were each measured and each fails), so gg reads the reply lexically instead, in
the one direction where being wrong costs nothing.

**A precompiled header is what makes the arm affordable, and it is built per machine.**
Parsing the ~55 standard-library headers a C++ author reaches for costs **~850 ms of every
compile**; reading them back precompiled costs ~40 ms. Measured on this repository's dev
container, a small program is 883–1110 ms without it and **82–95 ms** with it — which makes
this the cheapest compiled arm per turn rather than the dearest. It cannot be committed the
way every other compile input here is: a PCH is readable only by the clang that wrote it and
records the absolute path of every header in it, so one built in a checkout is unreadable by
the wasi-sdk in a run image. It is built into a content-keyed shared toolchain directory
instead, by the first compile of a process, placed by rename and sealed read-only — and the
key folds in the compiler **binary's own stamp**, because a reinstall at the same version
invalidates a PCH without changing any version anybody wrote down.

**Exceptions work, and turning them on cost the workspace a build feature.** C++ is an
exception language, and `-fno-exceptions` would make every `try` a model writes a compile
error — an arm measuring gg's flag rather than the language. Two measurements were needed.
clang 22 defaults `-fwasm-exceptions` to the *legacy* encoding, which the pinned wasmtime
refuses outright; `-mllvm -wasm-use-legacy-eh=false` selects the standardised `try_table`
form, which it accepts. And accepting it needs `Config::wasm_exceptions`, which wasmtime
gates behind a `gc` build feature and a collector — a dependency this workspace shares with
the two **other** wasm hosts in the repository. Cargo features are additive, so both now
build against a wasmtime with GC support, and both turn `gc_support` back **off** on their
own engines rather than inheriting a wider validation surface from a decision another
component made. gg's engine is the only one that opts in.

**Its error surface is three bands, and two of them took a decision to get.** An uncaught
`throw` under wasm exception handling never reaches `std::terminate`: it unwinds out of the
module and arrives as `thrown Wasm exception` and nothing else. gg's shell catches it and
reports the exception's own class — demangled by hand, rather than linking libc++abi's
demangler into every artifact — and its `what()`, as an ordinary recoverable program error
with **no location**. A libc++ **hardening** failure (`v[10]`, `.front()` on an empty
container) carries libc++'s own sentence *and* the model's own line, and both halves are
gg's doing: wasi-sdk ships libc++ configured to check nothing, and the message is a synthetic
inlined frame in the debug information rather than anything printed — the same mechanism
Swift's whole error surface rests on. What is left is **undefined behaviour**, which says
nothing anywhere and is located and no more. That last band is a comparability risk this arm
carries and no other does: a failure the language caused can be hard to tell, in the run
record, from a model that reasoned badly.

Two smaller things are worth recording beside the other two arms. Its artifacts are
**byte-identical across preparations** — clang stamps no per-invocation nonce and
`-ffile-prefix-map` removes the one path that would differ — so it is the only compiled arm
that hands the isolation gate whole artifacts rather than a projection with a compiler's
entropy set aside. And its per-turn figures sit between the other two: `clang++` ~85 ms and
`Component::new` ~19 ms on an ~800 KB artifact for a small program, against Rust's ~9 ms on
25 KB and Swift's ~1.3 s on 7 MB.

#### A module a program has to be linked against

A compiled arm changes one more thing, and it changes it for **every** language rather than
only for itself: preparing a *program* is handed the [code modules](/gg/skills/#code-skills)
in that agent's scope.

On an interpreted arm nothing needed that. The guest is given each module's prepared source
beside the program and evaluates it first, so `lib.<key>` is bound at run time and a
program's preparation has no business knowing what is in scope. A compiled arm has no such
moment. A Rust module is Rust, Rust links, and the only artifact a module can end up in is
the artifact of a program that was compiled against it — so a seam that withheld the modules
from the program's preparation would be a seam on which a code skill *silently bound
nothing* on one arm of a study about capability.

So the modules travel with the source, every interpreted arm ignores the parameter, and each
compiled one writes each module beside its entry file — Rust as a `mod`, Swift as
[a file of the program's own module](#what-a-swift-code-module-is), because Swift has no
nested module and its namespace is a caseless `enum` instead, and C++ as
[a header opened inside a namespace](#what-a-c-code-module-is), which is the plainest of the
three because it is the one language with a nested namespace and a line-control directive.
Two consequences are visible from outside:

- **the binding is resolved by the compiler, not looked up on a value.**
  `lib::csv_tools::parse(…)` on the Rust and C++ arms is a qualified name and
  `lib.csvTools.parse(…)` on the Swift arm is a member of a nested type, so on all three a
  key or a function that does not exist is a diagnostic on the turn that wrote it, where an
  interpreted arm finds out when the call is reached;
- **a module is compiled twice** — once alone when it is read, only to be checked, and again
  as part of every program that uses it. The first compile is what buys the *location*:
  without it a module that does not build would take down every program the agent wrote from
  then on, with the diagnostic landing against the turn's own program in a file the model
  never saw.

The same change removed a second preparation nothing wanted. A code skill's **on-use script**
is prepared at the read, so that whoever wrote it gets a located diagnostic there; it used to
be prepared a second time when it ran. That was harmless on an arm whose prepared output is
source in the language it read and nonsense everywhere else — a compiled arm's prepared
program is not source at all, so re-preparing it would have compiled the empty string and
reported a clean run over a script that never executed. The queued script now carries the
whole prepared program and is run as-is.

#### What Rust's SDK looks like

An idiomatic Rust SDK is not the TypeScript one with `&str` in it. Every difference below is a
spelling rather than an identity, and the [agreement gate](#the-agreement-gate) accepts each of
them:

- **An API object is a module.** `fs::read_file("src/main.rs", ReadOptions::default())?` is a
  path and a call, which is how Rust namespaces anything. gg writes one line in front of every
  program — `use gg::prelude::*;` — so all twelve objects and every type are already in scope. A
  **glob** rather than a list of imports, and that is the load-bearing part: Rust lets an explicit
  `use` shadow a glob-imported name, so a program that writes `use std::fs;` gets the standard
  library's `fs` where an explicit import gg wrote would have made that program an `E0252` about a
  name the model never asked for.
- **A failure is a `Result`, not a throw.** Every call returns `Result<_, ToolError>`, `ToolError`
  implements `std::error::Error`, and the body gg wraps a program in returns
  `Result<(), gg::Failure>` — so `?` composes a gg call with `std`'s own fallible operations in one
  chain, and a failure a program *expects* is an ordinary `match` on the `code`. This is the arm
  where the seam's "a failure is usually fatal to what you were doing" is expressed by the
  language's own type rather than by an exception, and nothing about it is special-cased.
- **Optional arguments are a struct with a `Default`, filled in with functional update.**
  `ReadOptions { limit: Some(40), ..Default::default() }`. Rust has neither default arguments nor
  keyword ones, and this is what it reaches for instead. A call with exactly **one** optional
  argument takes an `Option<T>` in that position — `system::shell(command, Some(30.0))`,
  `programs::get(None)` — because there the `Option` *is* the idiom and a one-field struct would be
  ceremony.
- **A three-way patch field is an `enum`.** `TextEdit::Keep` / `Clear` / `Set(…)`, with `Keep` as
  the `Default`, so `TaskPatch { status: Some(TaskStatus::Done), ..Default::default() }` leaves the
  description alone and says so in a value. Where [Python](#what-native-bought-in-the-catalogue)
  needs an `UNCHANGED` sentinel, Rust has a word for the third state.
- **A span of turns is a range.** `context::archive_thread(&[4..=19, 30..=35])`, because a span of
  integers in this language *is* a `RangeInclusive` — the same move Ruby makes with `Range`, and the
  one place this arm's spelling is shorter than the wire's, which carries a record with a `start` and
  an `end`.
- **A fixed choice is an `enum`, and its arms are not prefixed.** Rust namespaces a variant under its
  type, so `TaskStatus::Done` and `IssueStatus::Done` coexist — where
  [PureScript](#what-native-means-in-purescript) has to call them `TaskDone` and `IssueDone` because
  a program imports the whole surface from one module.
- **A read is a real sum type**, narrowed with an ordinary `match` that needs no catch-all;
  a child's brief is `Brief::Prompt(…)` or `Brief::Issue(…)`, so "both" and "neither" are programs
  that do not compile.
- **`println!` is not the log.** This arm's target has no standard output — a `print!` on
  `wasm32-unknown-unknown` is accepted and discarded — so the SDK carries `gg::log`, which is this
  arm's `console.log`: the run's **operator** reads it, and `view::open_text` is what reaches the
  model.

Its catalogue is reflected from **rustdoc's own JSON** (`packages/gg-sandbox-rust/signatures.sh`,
regenerated by the [drift gate](#the-catalogue)), which carries the doc comment on every function,
struct field and enum variant *and* the types, already resolved — so a signature is the compiler's
reading of the declaration rather than a string anybody typed. Two things about that are worth
stating, because both are decisions:

- **It is read under `RUSTC_BOOTSTRAP=1`.** rustdoc's JSON output is unstable and this repository
  pins a *stable* toolchain deliberately, since an `.rlib` is compiler-version-private and this arm
  must be built by the one compiler every checkout has. The alternative was a second toolchain in
  every checkout and in CI to read documentation out of a crate the first one compiles. The format
  version is pinned in the script, so a `rustc` bump that moves it stops there by name instead of
  emitting a catalogue with a field quietly missing.
- **There is no per-parameter doc slot**, because `///` on a parameter is a compile error in Rust.
  So the `# Arguments` convention stands in for one — the same fallback
  [PureScript](#the-catalogue-and-the-two-things-purescript-does-not-have) makes — and the reflector
  holds it to being a contract rather than a habit: a signature that takes *N* arguments must
  document *N*, in order, under their own names, or the reflection fails on the author.

The **library set** is `std` plus five curated crates, declared under machine-readable headings in
`packages/gg-sandbox-rust/Cargo.toml`: `regex`, `serde_json`, `base64`, `itertools` and `indexmap`.
That one declaration has two readers — `build.sh` marks those crates `extern` in the committed
manifest, which is what `rustc --extern` puts in a program's prelude, and the reflector groups the
catalogue's library list by the same headings — so what a model is told it may `use` and what the
compile lets it name cannot drift, and a test compares the two lists and then compiles a program that
really uses all five. Two constraints decide what may be in the set and both are hard: **no proc
macros anywhere in the tree**, since a proc macro is a host `.so` and an rlib whose metadata names
one cannot be loaded on another architecture (which is what rules out `serde`'s `derive`,
`thiserror` and `clap`, and what `build.sh` fails on rather than trusts); and it must compile for
`wasm32-unknown-unknown`, which has no clock, no filesystem, no sockets and no randomness — so
`rand`, `chrono` and `reqwest` are out, and reaching the world is what `fs` and `system` are for.
The whole set weighs 9.4 MB gzipped inside gg's binary, of which `regex` is 4.4 MB; none of it
reaches an artifact the program did not use it in, because the link dead-strips.

Two things about **how that set is built** are decisions rather than mechanics, and both were paid
for by a defect.

- **Nothing in CI re-cuts it.** `scripts/ci/contract-drift.sh` regenerates every language's
  catalogue on every run and then diffs both committed directories, so a step that writes into
  `crates/gg/src/sandbox/checkers/` on the way past fails the gate on bytes nobody edited. This
  arm's catalogue needs the generated WIT bindings, which are not committed — so the bindings are
  their own script, `packages/gg-sandbox-rust/bindings.sh`, called by `signatures.sh` and by
  `build.sh` alike. Before that split, a fresh checkout with no `src/bindings.rs` sent the signature
  step through `build.sh`, which re-cut the library set, and the gate could not pass anywhere but on
  the machine the committed tarball was built on. The rule is now asserted rather than remembered:
  the drift gate checks that the checkers directory is untouched *after* the signature steps and
  before the re-cut ones, and says which kind of failure it is.
- **The same inputs produce the same archive on any machine.** An `.rlib` records the absolute
  paths of the sources it was compiled from and the directory `rustc` ran in, so before this the
  set was a function of where the checkout happened to live — measured, `libgg.rlib` came out
  1,111,590 bytes at one path and 1,116,390 at a longer one. `build.sh` remaps this package and
  `CARGO_HOME` to fixed logical roots, which cargo deliberately leaves out of the unit hash it
  derives `-C metadata` from, so the remapping does not itself reintroduce the path. Verified by
  building at two roots and under two `$HOME`s and comparing every rlib's digest. That is what makes
  the archive something a reviewer can rebuild and compare, which is the only review a directory of
  binaries admits.

#### What Swift's SDK looks like

An idiomatic Swift SDK is not the Rust one with `try` in it. Swift's defining feature is the
**argument label**, and this surface is built on it: a call reads as a sentence, and the label
is part of the function's name rather than a way of reordering a call.

```swift
let entries = try fs.listDir("src")
let sources = entries.filter { $0.kind == .file }
try fs.editFile("src/main.swift", replacing: "old", with: "new")
let built = try system.shell("swift build", timeout: 300)
try view.openText("build", body: built.output)
try harness.finish("looked at \(sources.count) sources")
```

Every difference below is a spelling rather than an identity, and the
[agreement gate](#the-agreement-gate) accepts each of them:

- **An API object is a caseless `enum`**, which is Swift's own namespace, so `fs.readFile(…)` is a
  call on a namespace and nothing is constructed first. The object's *name* is gg's identity rather
  than this SDK's spelling — `fs`, `view`, `harness` are on the wire and in the console's grouping —
  so this is the one place the SDK departs from Swift's UpperCamelCase convention for types, and it
  is a departure the surface's own rules force.
- **The surface is in scope with no import line**, and that is what keeps a reply *verbatim*. The
  SDK is compiled ahead of time into a module called `gg`, and gg's shell — a second file of the
  model's own module — writes `@_exported import gg`. A plain `import` is **file-scoped** and would
  put nothing in `main.swift`; a re-export is module-scoped. Both were measured, because the
  alternative was making a model write `import gg` on line 1 and paying a line offset on every
  diagnostic and every located trap for the rest of the arm's life.
- **A program's own declarations shadow gg's.** Because the SDK is a different *module*, a program
  that writes `struct DirEntry { … }` gets its own — where an SDK compiled into the program's module
  would have made that a redeclaration error on the model's own line. It is the same property
  [Rust](#what-rusts-sdk-looks-like) gets from glob-importing its prelude, reached a different way.
- **A failure is thrown, and `try` is the whole of the ceremony.** Every call is `throws` and
  `ToolError` is an ordinary Swift `Error`, so a failure a program *expects* is
  `catch let failure as ToolError where failure.code == .notFound` — an ordinary `catch` with a
  `where` clause, not an SDK-specific combinator.
- **Optional arguments are default values**, which is Swift's own idiom and the reason this surface
  has no options record anywhere in it: `fs.readFile("a.swift", limit: 40)` skips `offset:` because
  Swift lets it, where [Rust](#what-rusts-sdk-looks-like) has to fill in a struct and
  [Java](#what-javas-sdk-looks-like) has to declare an overload.
- **A three-way patch field is an `enum` with `.keep` as its default**: `try tasks.updateTask("t1",
  description: .clear)` clears the description and leaves the title and the status alone, and the
  leaving-alone is the argument the call did not name.
- **A span of turns is a `ClosedRange`**: `try context.archiveThread([4...19, 30...35])`, because
  that is what an inclusive span of integers is in this language — the same move Rust makes with
  `RangeInclusive` and Ruby with `Range`, against a wire that carries a record with a `start` and an
  `end`.
- **A fixed choice is an `enum` and a choice that carries something is an `enum` with an associated
  value.** `.done`, `.inProgress`, `.file` — and a child's brief is `.prompt("…")` or
  `.issue("AUTH-1")`, so "both" and "neither" are programs that do not compile. A read is a real sum
  type, narrowed with a `switch` that needs no `default`.
- **`gg.log` is the operator's channel.** `print` works here — this arm's guest has a real WASI
  stdout, unlike [Rust](#what-rusts-sdk-looks-like)'s — and goes to the same place, but `gg.log` is
  the name that says where the line goes, and `view.openText` is what reaches the model.

Its catalogue is reflected from a **DocC symbol graph** (`swiftc -emit-symbol-graph`, driven by
`packages/gg-sandbox-swift/signatures.sh` and regenerated by the [drift gate](#the-catalogue)),
which is the machinery DocC itself is built on. It carries every doc comment verbatim, every
parameter's label and internal name, and every type the compiler resolved — with a mangled
identifier saying which module each came from, which is how the reflector tells a `TextEdit` from a
`String` without a table of names. Two things about it are decisions:

- **Per-parameter prose is a convention over the doc comment**, not a slot in the syntax: `-
  Parameter path:` for one argument, or a `- Parameters:` block. So the reflector reads the
  convention and holds it to being a contract, exactly as
  [Rust's](#what-rusts-sdk-looks-like) reads `# Arguments` — with one addition Swift forces. An
  argument is documented under the name a **call site** writes, which for a labelled argument is the
  **label** (`- Parameter to:`, not `- Parameter blockedBy:`), because the label is what a model has
  to type and the internal name is one it never sees.
- **`- Returns:` and `- Throws:` stay in the description** rather than being stripped as metadata,
  because what a call hands back and which failures to expect are half of what a model needs — the
  same reading [Rust's](#what-rusts-sdk-looks-like) reflector gives `# Errors`.

The **library set** is the Swift standard library, the modules the Swift SDK for WebAssembly ships
beside it (Foundation and its companions, `RegexBuilder`, `Synchronization`, `Observation`,
`WASILibc`) and three vendored packages compiled for this arm's target: **swift-collections**
(`Deque`, `OrderedDictionary`, `Heap`, `BitSet`, `TreeDictionary`, `Rope`), **swift-algorithms**
(`chunks`, `windows`, `combinations`, `uniqued`, `adjacentPairs`) and **swift-numerics**, which is
swift-algorithms' own dependency and a perfectly good library in its own right.
`packages/gg-sandbox-swift/libraries.txt` is the one declaration, and a test compiles a program
importing every module in it through the production prepare step — so a name a model is told about
that the committed archive does not carry fails there rather than reaching a model.

Two properties of that set are worth stating.

- **It costs a program that does not use it nothing.** The vendored modules are compiled into one
  **static archive**, and `lld` pulls archive members — so an artifact for a program that imports
  none of them is byte for byte the size of one built without the archive on the command line at
  all. Measured; passing the objects directly instead added ~2.7 MB to *every* artifact on this arm,
  used or not, because `--gc-sections` cannot strip what a reflection metadata table names. That is
  what lets the declared set be this wide.
- **This is full Swift, not Embedded Swift**, and the choice is deliberate. Embedded Swift would cut
  this arm's 7 MB artifact — almost all of it the statically linked standard library — by one or two
  orders of magnitude, and with it the ~1.3 s this arm pays to instantiate a program on every turn.
  What it drops is Foundation, `Codable`, existentials (`any P`), most of reflection and much of the
  runtime a model reaches for without thinking. An arm whose `Date()` or `JSONSerialization` is a
  compile error is an arm writing against a Swift nobody else writes, which is the one confound a
  cross-language study cannot carry. The size is paid as `compileWaitMs` and
  [recorded](#a-language-whose-prepare-step-compiles-the-component) rather than hidden.

One thing this arm's SDK cannot do anything about is worth recording beside it, because it is the
opposite of what the same arm does well. A Swift **runtime failure** — an index out of range, a
force-unwrapped `nil`, a `fatalError`, an arithmetic overflow — reaches the model with its own
message *and its own line*, symbolicated out of the artifact's debug information. An **uncaught
throw** does not: the runtime hands the error to `swift_errorInMain` from the entry point's
synthesized epilogue, so what a model reads is gg's own sentence about the failed call
(`` `read_file` failed (not-found): … ``) with no line at all. Catching what you expect is what buys
the line back, which is why the SDK's own examples are written that way.

The prompt is **per language and not one template with branches**, which looks like
duplication and is not. Its example programs are written in one language's syntax — a list
literal, a statement terminator, a trailing options object — and its sentences describe that
language's own protocol. A merged template would need a branch at almost every line, and
adding a language would mean editing the one file every language shares. It is also
operator-facing surface:
the console's prompt-override editor is seeded from it, and an operator overriding the
prompt is overriding it for the language they are running. What a copied template can lose
is a whole section, so that is [asserted](#the-agreement-gate) rather than trusted: every
registered language's prompt must render, under every context fixture, carrying every
required section. A checked language's prompt is additionally held to *saying* it is checked,
by the name of its own compiler — [`checker`](#what-a-language-supplies) is where that name
comes from — and to the term gg's own vocabulary uses, which is that a program is **compiled**
rather than that its *types* are checked. That distinction is not pedantry: TypeScript's `tsc`
checks types and Ruby's `opal` checks grammar, and a gate demanding "type-check" of every
checked arm would have forced a Ruby prompt to say something false about itself.

A section can also survive as a heading and lose what was under it, so the same gate reads
three things off a maximal context rather than one, and a fourth off a minimal one. Every
**value the run configured** must reach the prompt — each roster name and description,
each ceiling, the assigned issue's id.
Every **capability the run granted** must be named by the call that reaches it, resolved
through that language's own catalogue rather than quoted, so `agents.spawnSubagent` and
`agents.spawn_subagent` each satisfy it in their own arm. Every **rule a program is written
under** must still be stated — that calls are synchronous, that a view is the only way to
read data out, that a returned value is discarded, that a view arrives on the next turn,
that a failed program's ending is revoked. The fourth is read the other way round, off a
context with every capability **off**: a capability the run withheld must appear nowhere,
which is the prompt half of gg's [capability model](#what-the-host-checks-and-what-a-language-must-not-be-trusted-with).
A language author writing template fixtures needs both — the maximal one alone cannot show
that a withheld capability stays out.

What the gate deliberately does not assert is wording. It reads names, numbers,
identifiers and the one term each rule cannot be stated without — never a sentence, never
punctuation, never emphasis. A prompt is prose and revising it is ordinary work: rewrapping
a paragraph, rewriting a sentence or changing `**bold**` to `*italic*` must not fail a test,
or the gate stops being a safety net and becomes a reason not to improve the prompt.

#### What C++'s SDK looks like

An idiomatic C++ SDK is not the Rust one with `::` already in it. It arrives in the same
precompiled prelude as `<vector>` and `<string>` and is called with `std::string` arguments, so it
is written to read like the **standard library**: `snake_case` functions, `snake_case` types, and
nothing a C++ author has to switch conventions for mid-expression.

```cpp
const auto entries = fs::list_dir("src");
std::vector<std::string> sources;
for (const auto &entry : entries) {
  if (entry.kind == entry_kind::file) sources.push_back(entry.name);
}
const auto built = system::shell("cmake --build build", 300.0);
view::open_text("build", built.output);
harness::finish(std::format("looked at {} sources", sources.size()));
```

Every difference below is a spelling rather than an identity, and the
[agreement gate](#the-agreement-gate) accepts each of them:

- **An API object is a namespace**, so `fs::read_file(…)` is a qualified name and a call. That is
  the same answer [Rust](#what-rusts-sdk-looks-like) gives, reached with C++'s own construct.
- **The whole surface lives in `namespace gg`, and the prelude ends with `using namespace gg;`.**
  That is the one thing on this arm that is *forced* rather than chosen, and by one object's name:
  `<cstdlib>` declares `int system(const char *)` at global scope, and `namespace system { … }`
  beside it is *redefinition of 'system' as different kind of symbol*. Qualified lookup for a
  nested-name-specifier considers only namespaces and types and never functions, so once the
  surface is in a namespace the C library's `system` cannot shadow the object. The using-directive
  also gives a program the last word, as Rust's glob `use` does — with one measured exception: a
  namespace **alias** is *ambiguous* rather than shadowing, so `namespace fs = std::filesystem;`
  beside `gg::fs` is a compile error naming both candidates at the model's own line. That is why
  `<filesystem>` is deliberately not in this arm's library set: the alias is a reflex, and an arm
  that invited it would spend turns on gg's namespace rather than on the work.
- **A failure is thrown.** `gg::tool_error` derives from `std::runtime_error`, so
  `catch (const std::exception &)` catches it as a C++ programmer expects of anything a library
  throws, `what()` is gg's own sentence about the failure, and `code()` is the value a `catch`
  branches on instead of matching prose. This is the opposite of Rust's `Result`, and for the
  opposite reason: Rust has `?` and no exceptions, C++ has exceptions and no `?`, and a surface
  where every call returned `std::expected` would force a branch after every line and make a
  composed program unwritable.
- **One optional argument is a default argument; several are an aggregate filled in with
  designated initialisers.** `fs::read_file("main.cpp", {.limit = 40})` names the one field it sets
  and says nothing about the rest — which matters because C++ has no keyword arguments and a
  defaulted parameter cannot be skipped over, so `read_file(path, std::nullopt, 40)` would have
  made a model count commas. The one call spelled as an **overload pair** instead is
  `agents::wait_for_subagents`, where "every outstanding child" and "these children" are two calls
  rather than one with an absent argument.
- **A read is a `std::variant`**, narrowed with `std::get_if` — what C++ has for a value that is
  exactly one of two things — and a fixed choice is an `enum class`, never a string.
- **A three-way patch field is a value with named factories.** Leave `description` default to keep
  it, `text_edit::clear()` to empty it, `text_edit::set(…)` to replace it; `epic_assignment` is the
  same shape for an epic id. A child's brief is `brief::prompt(…)` or `brief::issue(…)`, so "both"
  and "neither" are programs that do not compile.
- **A span of turns is an ordinary aggregate**: `context::archive_thread({{4, 19}, {30, 35}})`.
  C++ has no value type for a closed integer range — `std::ranges::iota_view` is a *sequence*,
  which a span of turn numbers is not — so this is the one place the arm spells with a record what
  Rust spells with `4..=19`.
- **`gg::log` is this arm's `console.log`.** `std::printf` reaches the same place, because ambient
  WASI gives this guest a real standard output, but it is the C library's rather than gg's. The
  bare name resolves to gg's even beside `<cmath>`'s `log`, because one takes text and the other a
  number.

Underneath it is one bridge file a model never reads, and its whole job is lifetimes: the canonical
ABI's strings do not own what they point at, so every call's arguments are held in a scratch that
frees them in its destructor — and held in a `std::deque` rather than a `std::vector`, because a
vector would move its elements on growth and invalidate every pointer already handed out, which is
a use-after-free that appears only once a call takes more than a handful of strings.
`project::create_issue` takes nine.

##### The catalogue, and the one arm whose compiler reads its own documentation

This arm's catalogue is reflected by **clang's comment AST**, dumped as JSON by the same `clang++`
that compiles every program. clang carries a real documentation parser — the one `-Wdocumentation`
diagnoses against and the one `libclang`'s comment API and `clang-doc` are built on — and it does
the two things that matter: it decides which comment belongs to which declaration, and it parses
the Doxygen commands inside one into structure. So `\param path`'s prose arrives attached to the
parameter called `path`, `\returns` and `\throws` arrive as their own nodes, and `\copydoc`
arrives as a reference the reflector resolves.

That makes C++ **one of the few arms whose per-parameter documentation slot is the language's own**
rather than a convention standing in for one. [Rust](#what-rusts-sdk-looks-like) needs a
`# Arguments` heading and [PureScript](#the-catalogue-and-the-two-things-purescript-does-not-have)
needs the same, because neither language has anywhere to write a comment on a parameter; here the
compiler polices it, and the reflection is compiled with `-Werror=documentation` so a `\param`
naming an argument the function does not take fails the reflection rather than reaching a model.

Three mechanics of it are worth recording, because each was a decision:

| | |
| --- | --- |
| **The AST is filtered** | A translation unit that includes this SDK also includes half the standard library, and dumping the whole of one is ~300 MB for `<string>` alone. `-ast-dump-filter=gg` keeps the declarations whose name matches — which for this SDK is all of them, because the surface lives in one namespace for the collision above. 3 MB and half a second. |
| **`///` means model-facing and `//` does not** | A public member the bridge needs — `text_edit::tag()`, `brief::is_issue()` — carries `//` and is left out of the declaration a model is shown. There is no other marker, and a public member with no documentation at all is omitted rather than emitted blank. |
| **`list` is written once and declared twelve times** | C++ has no protocol extension, and a comment inside a macro body is gone before the macro is ever expanded — so the twelve `list()` declarations cannot share one written paragraph the way [Swift](#what-swifts-sdk-looks-like)'s protocol default or Rust's `macro_rules!` do. They share `gg::detail::api_object_list` instead, by a one-line `\copydoc` the reflector resolves, and the reflector asserts all twelve declare the same shape. |

Two smaller things the reflector has to do that no other arm's does. clang's comment lexer splits a
line wherever it thinks it sees markup, so `std::get_if<text_file>` arrives as four fragments —
they are put back together by their **source offsets**, since two fragments that abut are one line
and a gap between them is the `///` that separated them. And a default argument is quoted out of
the header by **byte** offset rather than printed back from the expression tree, because printing
it would be the reflector inventing a spelling and this SDK's prose is full of em dashes.

##### The library set is the standard library, and that is an argument rather than a shortfall

Declared header by header in `Sources/prelude.hpp` under `// == Heading ==` groups, which is one
declaration with **three** readers: the compile, the committed manifest, and the catalogue's
`libraries` section — so what a model is told it may include and what the compile allows cannot
drift.

This is the one arm that ships no third-party library at all, where [Rust](#what-rusts-sdk-looks-like)
ships five crates and [Swift](#what-swifts-sdk-looks-like) vendors three packages, and the argument
is that it is not a thinner set. The seam's rule is that commonly used libraries are available by
default, and what a C++ author reaches for first *is* the standard library — at a breadth
(`<ranges>`, `<format>`, `<expected>`, `<regex>`, `<chrono>`, `<random>`, the whole container set)
that no other arm's standard library matches. There is no ambient C++ package manager to reach one
through, so anything beyond it would be a vendored tree in this repository, and vendoring one badly
— unpinned, unlicensed, untested against wasm — is worse than the argument above. A curated header
set on the include path is the shape it would take if it is ever taken, and it would cost a
program nothing when unused, because the prelude is what is precompiled and an `-I` is not.

Three absences inside the standard set are decisions rather than gaps: `<thread>`, `<future>` and
`<atomic>`, because this sandbox has no concurrency and a header a model is told it has and cannot
use is worse than one it was never offered; `<iostream>`, because a program's stdout is not a
channel a turn is read from and including it drags its static initialisation into every artifact;
and `<filesystem>`, for the namespace collision above.

### The catalogue

A language's catalogue is the whole of what a model is *told* about the surface, and every
word of it is **reflected out of documentation written on the declaration it describes**.
Nothing in it is authored in a table, a template or a prompt: an object's one-line
description comes from the doc comment on the constant that names the object, an argument's
description from the `@param` (or `# Arguments` heading, or `///` on the parameter — the
convention is the language's) written on that argument, and a type member's from the comment
above the member. A description kept anywhere else is a description that drifts, and nothing
would catch it.

It has nine sections:

| Section | What it carries |
| --- | --- |
| `objects` | Every API object a program's surface is divided into, **in the order the surface is presented in**, each with the sentence the system prompt introduces it by. The order is model-facing: it is what the prompt's API list and the run's [agent surface](/gg/agent-surface/) both render. |
| `libraries` | The **libraries a program may import**, grouped as the artifact that decides the set groups them, each name spelled exactly as a program must write it. The one section that is not a signature, and it is here for the same reason the rest is: it is model-facing text about the arm's surface, so it is reflected out of the code that decides the set rather than described in a prompt. Absent for a language whose programs get their runtime's own standard library and nothing more. |
| `meta` | The functions that hang off **no** object because they hang off all of them — today just `list`, the directory every object carries. Its entries have no `object` field, because any object one of them named would be a claim about the eleven it is also on. |
| `session` | The [ending calls](/gg/ending-a-session/), one group per role. |
| `views` | The `view` object — the calls that put material into the agent's own context window. |
| `programs` | The [program library](/gg/program-library/)'s calls. |
| `tools` | One entry per gg tool, in exact bijection with the tool registry's vocabulary. |
| `helpers` | The convenience wrappers bound alongside a tool. |
| `types` | Every type a signature refers to: its declaration, the paragraph explaining what it is for, and **a line per member**. A declaration says what fields a value has and nothing about what any of them means — `shown: boolean` on a `FileRead` is not a thing a model can infer — so the members travel with it. |

#### One entry, many signatures

Every function entry carries a `signatures` **array**, and that array is the mechanism by
which a language expresses its own idiom without changing what the function *is*.

An optional argument is a Java overload pair, a Kotlin default, a Python keyword argument
and a TypeScript `?`. Those are four spellings of one capability. Java's arrives as **one
entry with two signatures**, each with its own argument list; the other three arrive as one
entry with one. Nothing downstream compares the count, because the count is spelling — see
[the agreement gate](#the-agreement-gate).

[Ruby](#what-native-means-in-ruby) is the arm that first produced that shape, and not over an
optional argument: `view.open_text(label, body)` and `view.open_text(label, &body)` are one
function a Ruby author may hand a long body to as an argument or as a **block**, which is two
signatures and one capability. Until it landed, this half of the schema was a shape nothing
emitted.

An overload group is **one entry with many signatures, never two entries sharing a name**,
and a reflector that emits the second shape is rejected at load: two entries on one object
spelled the same is one of them silently shadowing the other at bind time, and every
consumer that routes on `(object, name)` — the doc lookup, `object.list()`, the reference
projection — would show the first and lose the rest.

Each signature carries its arguments in order, and each argument carries its name, its type,
whether it is optional, whether it is passed by position or **by name**, the default the
language states for it if any, its description, and — for a structured argument written
inline at the call site — the same again for each of its fields. An argument typed by *name*
carries no fields: that type is catalogued in its own right and its members carry its
documentation, so filling both would be two copies of one sentence with nothing keeping
them equal.

### Nothing quotes a call by hand

The catalogue is where every word about the SDK lives, and the rule that keeps it that way is
blunt: **no name a model reads is written anywhere but on the declaration it describes.** Not
in a prompt template, not in a `const` in gg's Rust, not in a table. gg names a call by its
language-independent identity — an object and a catalogue key — and resolves the spelling from
the run's own catalogue at the moment it renders.

So a template writes `` `{{api.view.open_text.signature}}` `` and gets
`view.openText(label: string, body: string): void` under TypeScript and whatever the next
language's SDK declares under that. Three fields are available for each call: `.name` (the bare
name, for the places a prompt quotes one as a string argument), `.call` (the name qualified by
its object, which is how a program writes it), and `.signature` (the qualified signature).
`{{meta.<key>.…}}` does the same for the object-less [meta functions](#the-catalogue). A path
that names nothing is a strict-mode render failure rather than a sentence quietly describing a
call nobody has.

The rule is not aesthetic. A spelling frozen in a template is *stale* the day the SDK renames
the function and *false* the day a second language is registered — rendered for a Python agent,
a TypeScript spelling names a call that agent's scope does not bind, and the model copies it
verbatim. It had already gone wrong in exactly that way with one language registered: the
TypeScript template quoted `view.openText(slug: str, contents: str)`, whose two argument names
were never those and whose type name is Python's.

Five gates hold the line, and each of them can be shown to catch something:

- **No template spells an SDK call by hand.** Read off the template *sources*, so it covers a
  `{{#if}}` branch no test context renders — which is where a stale spelling survives longest.
- **Every `{{api.…}}` a template writes resolves in every registered language.** Also read off
  the sources, so a typo in a rarely-rendered branch is a build failure rather than a mid-run
  panic — and per language, so a reference that resolves for one arm of a study and not the
  other is caught.
- **No template a code agent reads names a bare gg tool.** A tool name is the right identity in
  the tool-calling prompt and a wrong answer everywhere else, because a program calls a method
  on an object. The context-pressure block — the one message whose whole purpose is to tell an
  agent how to reclaim its window — named two gg tools at every code agent gg had ever run.
- **Every argument a rendered prompt names is one that signature takes, in that order.**
  Where the argument shape matters more than the return type does, a template writes the name
  through the catalogue and the argument list beside it — `` `{{api.programs.rerun.call}}(source)` ``.
  That fragment is a signature typed into a template, in the one shape the first rule cannot
  see, since the span begins with an `{{api.…}}` reference rather than with a spelling. Only a
  span whose arguments are all bare identifiers is judged: one carrying a literal, an object or
  a nested call is a worked *example*, whose names are the template's own.
- **No literal in gg's own Rust names an SDK call.** The same rule on the host side, and the
  allow-list is now one entry — the mock model's canned fixtures. `sandbox/language/` used to be
  exempt wholesale on the reason that a language's own module is where its syntax belongs; what
  those modules actually hold is `{{api.…}}` *references*, which resolve through the catalogue
  and only look like spellings to a substring search. The gate strips Handlebars references
  before searching instead, so the directory holding every language's implementation — the
  likeliest home for a hand-written spelling — is covered like the rest of the crate.

A sixth gate exists on the **compiled** arms only, because only there is it possible — and only
there does it matter enough to pay a compiler for. Everything above resolves the call gg *quotes*;
none of it can tell whether the code around the quote would build. On an interpreted arm an
example that does not build costs a model a runtime error it can read and work around; on a
compiled arm the program is refused before it runs, and the diagnostic that comes back is about
gg's own prose, so the whole turn is spent on it. So on the Rust arm every Rust example a model is
shown — each ` ```rust ` block in the prompt and the "nothing shown" notice, each inline span that
reads as a call, and each fenced block in the committed catalogue, which came off a `///` comment
on the SDK — is gathered into one program and put through the arm's production prepare step: the
same `rustc`, the same wrapper and the same library set a model's own reply gets. It was written
because exactly that defect shipped: the prompt taught `fs::list()?`, and `list` returns a `Vec`
rather than a `Result`, so the `?` a model would have copied is an `E0277`. Placeholder names the
prose uses without introducing (`path`, `turn`, `source`) are bound in the test's own preamble, so
an example that gains a new one fails here by name rather than being quietly excused.

One thing a model reads is deliberately outside the rule, and it is worth naming so nobody
audits it as a miss. A **built-in skill family's description** — the sentence under each of
the eleven skills gg seeds — is gg's own prose about a *grouping of capabilities*, not about
an SDK function: there is no declaration it could be reflected from, and deriving one by
concatenating the members' summaries would read worse than what is written. It carries no
spelling of any call, so it is language-independent by construction.

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

### What the host links, and why it is the same for every language

This is the part that is easy to miss, and the empirical finding that shaped the seam: **a
component built by a general-purpose toolchain imports far more than the program uses.** A
component built with `componentize-py` imports the **full WASI p2 surface** — `wasi:cli`,
`wasi:filesystem`, `wasi:sockets`, `wasi:clocks`, `wasi:random`, `wasi:io` — whether or not
the program touches any of it, because the runtime it embeds is linked against the whole of
it. A host that answered for none of those imports could not instantiate such a component at
all.

So gg's linker defines the whole surface, for every guest, unconditionally. A language
declares nothing about it, and nothing about a new language's guest can fail to link.

That is a deliberate choice, not merely the convenient one. A model reaching for its
language's ordinary file, clock or socket APIs instead of a bespoke SDK call is a model
writing the language it was told to write in — plausibly *better* than one steered around
its own standard library. And an agent has a `shell` tool in nearly every configuration, so
denying the guest what the process already has would be theatre.

It is also what makes a whole class of languages cheap instead of expensive, and that is now
measured rather than argued. The [Python guest](#adding-a-language-worked-python) is the
first that imports the whole surface, and building it *without* WASI is exactly what once
priced the arm at six to ten weeks: with `--stub-wasi`, `datetime.now()`, `SystemRandom()`,
`uuid4()`, `tempfile` and `threading` all **trap** — unshimmably, because they are
C-implemented immutable types — and a trap takes the store down with nothing catchable and
nothing to tell the model. Against the ambient surface all five are ordinary calls again and
`threading` raises a catchable `RuntimeError`.

The one thing the host withholds is **stdout**: gg's [telemetry](/gg/telemetry/) stream is
the process's own stdout, so a guest write to it would corrupt the run's event stream. The
TypeScript component is baked `--disable stdio` for that reason and rebinds `console.*` to
gg's feedback channel; the host's WASI context is built without stdout to match.

A component is only affected by the imports it **declares**, and gg's own
`test-cabinet:gg/*` namespace does not overlap WASI's, so what a guest does not ask for costs
it nothing. A frugal guest asks for only part of the surface. TypeScript's is one: alongside
the fifteen membrane interfaces it declares `wasi:clocks`, `wasi:random` and `wasi:io` — which
is exactly how a program's `Date.now()` reads the host's wall clock and `crypto.randomUUID()`
draws the host's entropy — and declares neither `wasi:filesystem` nor `wasi:sockets`, because
it is baked without them. Those two are **unused** by that guest, not withheld from it: the
host defines them all the same, and a `componentize-py` guest importing them gets them.

That list is asserted against the committed artifact on every test run, because it is decided
by the `--disable` flags in `packages/gg-sandbox/build.sh` and a flag changed there rewrites
what a program can reach without touching a line of readable diff. The Python guest's list is
asserted the same way and for the same reason, and it is the other end of the range: fifteen
membrane interfaces and **twenty** WASI ones, `wasi:filesystem` and all five `wasi:sockets`
interfaces included.

## The agreement gate

The seam says the only thing free to differ between two languages is **spelling**. That is
not left as a convention anyone is asked to remember; it is asserted, for every registered
language, on every test run.

gg builds an **identity** for each function a language's catalogue describes, and compares
the sets:

- **Identity** — the section it sits in, the **object** it hangs off (`fs`, `view`,
  `harness`) or *no* object at all for a `meta` function, its language-independent **key**
  (a tool's is its gg tool name; `request_changes` and `open_text` are the carve-outs' own),
  the gg tool that **gates** it, the ending **role** whose programs bind it, and whether it
  belongs to the [program library](/gg/program-library/). None of it may differ.
- **Spelling** — everything else, and deliberately a great deal: the name a program calls,
  the prose that documents it, the object's own description, and the whole **shape of the
  call**. Argument names, argument descriptions, whether an argument is positional or passed
  by name, what it defaults to, and *how many signatures an entry carries* are all spelling.
  A language that must express an optional argument as an overload pair carries two
  signatures where one expressing it as a default carries one, and that is not a difference
  in what the function does — so the gate does not compare the count.

The one thing about the call shape that is **not** free is whether there is one. A capability
that needs a path needs it in every language, so *whether an entry documents any argument at
all* is compared across arms: an arm whose model is told what to put in `fs.readFile` and an
arm whose model is not are not two spellings of one surface.

What the gate asserts about spelling is that it is **there**. Every argument, every field of
a structured argument, every type, every one of a type's members and every API object must
carry documentation; a signature must begin with the name a program calls; an argument must
be named by the signature that takes it — a renamed parameter left behind under its old name
in the docs reads perfectly and tells a model to write something the call will not accept —
except where the notation has nowhere to put a name, which is [ML
notation](#the-catalogue-and-the-two-things-purescript-does-not-have), where the same check is
kept for the **fields** of a structured argument and dropped for the arguments a type cannot
name; and no two functions on one object may share a name. Those checks run over the **emitted
catalogue**, so they are one gate for every language: a language whose compiler enforced its
doc comments (Java's `-Xdoclint`) and one whose only per-argument slot is a **convention** over
the comment text (Rust's and PureScript's `# Arguments`, Swift's `- Parameters:`) land in the
same shape here.

An **omission** is caught as well as a blank, which matters because the languages with no
per-argument doc slot of their own are exactly the ones whose reflector is most likely to
emit an empty argument list and call it done. Two checks catch it, and between them they
cover every notation: a signature that writes a non-empty argument list — between brackets, or as
a chain of top-level arrows where the notation is `readFile :: String -> Effect FileRead` — and
documents nothing fails on its own, and an entry documenting no argument where another arm
documents one fails comparatively.

Each language is additionally anchored to **gg's own vocabularies**: its tools in exact
bijection with the tool registry's, its component binding exactly those tools, its ending
calls exactly the four the tool-calling arm dispatches and each bound to the role gg gives
it, its `meta` section exactly the one function gg seeds onto every object (`list`), every
gate a real tool name, `view.openFile` gated on `read_file` and the rest of the view surface
gated on nothing, and every type a signature mentions declared in its own catalogue.

A `meta` function is checked in one more way the others are not, because it is bound on
*every* object rather than on one: its name may not collide with any catalogued function's,
since a collision would shadow silently on whichever object carried it.

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
role, an undocumented argument, a type member with no description, an API object nothing
describes, an argument the signature does not name — and assert on what comes back. One test
runs the other way: a catalogue that **renames every argument, passes them by name with
stated defaults, and splits an optional argument into an overload pair** must be accepted
without complaint, because a gate that rejected that would make an overloading language
impossible to register — which is a worse failure than any it prevents.

The comparative half runs over the registry for real, and with
[Python](#python-a-guest-that-carries-its-own-interpreter) in it that is now a comparison
worth making: two SDKs written by hand, in two languages, sharing no declaration — where the
TypeScript/JavaScript pair is the easiest possible comparison, its two catalogues being one
set of declarations reflected twice. It is also exercised, on every run, against a
**fixture language** that exists only
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

A further language is **additive**. Nothing in `packages/gg-sandbox/` changes when it lands,
and neither does the WIT, the host's `ToolApi`, the membrane or the gate model. (The one
registered language that *did* touch that package is
[JavaScript](#javascript-the-same-arm-unchecked), because it is not a new guest at all —
it is this one's catalogue emitted a second time under a second id.)

Python is **registered**, and this section is the walkthrough rather than a plan: what the arm
*is* is [above](#python-a-guest-that-carries-its-own-interpreter), and what follows is the
order it was built in and what each step cost, because that is what the next language needs.

It landed in three pieces, and the split is worth keeping. First the **substrate** — the
guest CPython lives inside, its build, and the proof that a program crosses into it, runs,
reaches back through the membrane and comes back out. Then the **surface** — the hand-written
idiomatic SDK and the catalogue reflected out of it. Only then the **registration**, because a
`ProgramLanguage` arm cannot be half-registered: the registry's `match` is exhaustive, and
every gate that iterates the registered set demands two templates and a healing dialect the
moment the enum has a variant.

The surface was not taken on trust in the meantime, which is the part worth copying. The
[agreement gate](#the-agreement-gate) was run against the committed Python catalogue a step
*before* it was registered, wearing the [fixture language](#the-agreement-gate) so it could be
handed a catalogue whose id the wire enum did not carry yet; and every one of the thirty-five
tools was driven through the real membrane from its Python spelling, against the same expected
JSON the TypeScript arm's crossing table asserts. Every arm since has done the same, and the
fixture's borrowed-catalogue constructor lives exactly as long as it is needed: it is added by the
step that has an unregistered catalogue to check and removed by the step that registers it, so
there is never a facility in the tree that nothing uses. That the two arms produce byte-identical
arguments for the same capability is the property a cross-language study rests on, and it was
checked a step before the commit least able to absorb a surprise. Both halves are ordinary
registered-language gates now.

### What was measured

A spike answered the questions that could have made this a redesign rather than an addition,
and the guest that followed re-measured every one of them on the real artifact:

| Question | Finding |
| --- | --- |
| Does another toolchain bind gg's existing WIT world? | **Yes.** `componentize-py` generates clean Python bindings for this exact world — 14 interfaces, ~55 typed functions with real records, enums and variants, already in `snake_case`. WIT is a language-neutral IDL and behaves like one; no generic `call(name, json)` fallback was needed anywhere, and the hand-written layer on top is thin because of it. |
| What does baking one cost? | **~1.8 s**, which is a hand-run build step, not a problem. |
| How big is the artifact? | **~24 MiB**, against the JavaScript guest's 13.4 MiB. Larger, and the same *kind* of number: both embed a whole runtime, and this one additionally carries a curated standard library and the SDK. Not an exact number, because the build is not byte-reproducible — `componentize-py` snapshots a running interpreter's memory, so two builds of identical sources differ by tens of kilobytes. A test holds it to a 22–28 MiB band; **rebuilding to check whether the artifact is current does not work**, and its build script says so. |
| What does it import? | The **full WASI p2 surface** — `wasi:cli`, `wasi:filesystem`, `wasi:sockets`, `wasi:clocks`, `wasi:random`, `wasi:io` — 20 interfaces beside the 15 membrane ones. |
| What does a turn cost? | **~20 ms**, almost all of it the instantiate: ~17–22 ms to instantiate the component against the real linker and ~2.6 ms to evaluate a program. Against TypeScript's tens of microseconds and 0.7–3 ms that is a real difference and an irrelevant one — it is two hundredths of a second beside a model request measured in seconds. Baking the standard library in costs nothing here: a minimal component instantiates no faster. |
| What does the one-per-process component compile cost? | **~3.5 s** in the dev test profile, paid by `precompile` and overlapped with the run's first model request. |

What it imports was once the open question, and the one that could have made this a redesign;
gg's linker now defines that whole surface for every guest, so the answer is a fact about the
artifact rather than a problem.

### Two things the guest measured that nothing had

**`--stub-wasi` was the whole of the old cost estimate.** An earlier study priced this arm at
six to ten weeks on the strength of five standard-library families trapping unshimmably —
`datetime.now()`, `random.SystemRandom()`, `uuid.uuid4()`, `tempfile`, `threading` — all of
them C-implemented immutable types that no shim can monkey-patch. That was an artefact of the
flag, whose own `--help` says it *"replace[s] all WASI imports with trapping stubs"*. Built
against gg's ambient surface, every one of them works and `threading` raises a **catchable**
`RuntimeError`. The difference between a trap and an exception is the difference between a
turn that dies opaquely and a sentence a model can act on.

**`sys.setrecursionlimit` is a store-killer, and `except` does not save you.** Raised past
what the wasm stack holds, a `RecursionError` the program *already caught* takes the store
down while CPython unwinds its traceback (`tb_dealloc` → `_Py_Dealloc` → `tb_dealloc`). The
shim clamps the limit rather than trusting a handler. It is the kind of defect that only a
real program run through a real store finds, which is why the arm was built substrate-first.

### What a Python program is offered, and why that is a bake-time fact

`componentize-py` bundles only the modules the entry module's import closure actually
reached — measured by *executing* the import, so a function-local one does not count.
Everything else is absent from the component's filesystem entirely, and a program that asks
for it gets `ModuleNotFoundError`. So the library set is a property of the **artifact**, not
a policy applied at run time: `src/library.py` imports what the arm offers, and a test asks
the committed component which modules really landed.

That is worth more than it costs. A study can state exactly what each arm was given, and the
statement is checkable against the binary rather than against a promise. What is offered is
around ninety modules — a **curated subset** of the standard library, not all of it — plus two
pinned pure-Python wheels (`PyYAML`, `tomli-w`). What is deliberately withheld is `asyncio`
(nothing here is asynchronous), `subprocess` and `multiprocessing` (a component cannot spawn a
process — `system.shell` is how an agent runs a command), and `unittest`/`doctest`. What is
simply unavailable is `ssl`, `bz2`, `lzma`, `ctypes` and `curses`: `componentize-py`'s CPython
is not built with them, and `ssl`'s absence is why `urllib.request` reaches `http://` and not
`https://`.

#### The model is told the set, and is told it from the artifact

"Curated subset" is the kind of fact a prompt gets wrong. This one's prompt did: it claimed the
whole standard library of CPython 3.14 was importable apart from three named modules, where
`library.py`'s closure had baked around ninety — so a model that wrote `import unittest` or
`import concurrent.futures` spent a turn discovering a sentence was out of date, and nothing
gated the sentence.

So the library set is reflected, exactly as a signature is. `signatures.py` reads the
module-scope imports of `src/library.py` — the file that *decides* the set, because that closure
is what gets baked — together with the `# --- … ---` headings they are filed under, and emits
them as the catalogue's [`libraries`](#the-catalogue) section. The system prompt renders that
section, so what a model is told it may import is what the component was built with, down to the
dotted name (`urllib.parse`, not `urllib`, because its siblings are not there).

Three gates hold it:

- the reflector refuses an import it cannot group, a `from … import …`, a duplicate, or a
  grouped scan that disagrees with what `ast` reports the module-scope imports to be;
- `a_language_that_declares_libraries_names_every_one_in_its_prompt` renders the prompt of every
  registered language and requires each declared group's heading and its exact comma-joined list
  to appear in it — so a catalogue entry withheld from the model fails;
- `the_committed_guest_carries_every_library_the_prompt_names` drives that same list into the
  **committed component** and imports every name inside it, so a curated import dropped in a
  rebuild fails here rather than in a run.

The three named absences the prompt still states in prose — `asyncio`, `subprocess`/
`multiprocessing`, `ssl` — are held by the second half of that substrate test, which imports each
one and requires `ModuleNotFoundError`.

### WASI

gg's linker provides the **whole** WASI p2 surface to every guest, so a `componentize-py`
guest instantiates with nothing added to the host and nothing stubbed out of the guest. See
[what the host links](#what-the-host-links-and-why-it-is-the-same-for-every-language) for the
reasoning and for the one thing that is still withheld.

:::caution[A registered guest can block, and the deadline does not reach it]
The [execution timeout](/gg/execution-limits/) is delivered by epoch interruption, which can
only fire where the guest is running wasm. A guest parked inside a **synchronous WASI call** —
`wasi:io/poll` on a clock pollable, which is what `time.sleep` and `Thread.sleep` compile to,
or a blocking socket read — is running none, so the timeout cannot trap it, and the membrane's
deadline guard does not help because it only refuses at the next bridged call. Nothing stalls:
the program runs on a blocking thread, so sibling agents are unaffected.

The ECMAScript guest cannot reach this — it shadows the timers and exposes no filesystem or
socket API. **Python can**, and it has been measured rather than reasoned about. The
measurement says the overrun is bounded by the **longest single park**, not by the budget:

| Program | Budget | Measured |
| --- | --- | --- |
| `time.sleep(8)` | 2 s | the whole 8 s, 5 runs of 5 (8.02 s elapsed) |
| `time.sleep(4)` | 1 s | the whole 4 s, 8 runs of 8 |
| 200 × `time.sleep(0.05)` — ten seconds of sleeping | 1 s | 1.00–1.09 s |

So a parked program *is* stopped and the elapsed figure is honest, but the deadline can only
fire **between** parks and never inside one: a program sleeping in short hops is bounded near
its budget, and a program sleeping in one long hop runs the hop out. The common case for a
model writing `time.sleep(60)` is therefore the second row, not the third — the deadline is an
upper bound on the guest's *execution* and on nothing else, and a `time.sleep(3600)` sits until
the run-level idle watchdog (30 minutes) declares the run hung. Both halves are pinned by
`the_interpreters_own_landmines_are_defused` rather than left as a figure in prose.

**The decision, settled with the arm that made it reachable: gg does not extend the timeout to
a parked WASI call.** It is an acceptance rather than a gap, and the reason is that the
behaviour underneath it is neither new nor unusual — `system.shell("sleep 3600")` parks for an
hour on every arm gg has ever had, and the epoch callback deliberately excludes that time so a
real build is never mistaken for a runaway. A sleeping guest is a *second door* to the same
behaviour; what genuinely differs is that gg does not record it, because a `shell` wait is a
bridged call in the run's telemetry and a `time.sleep` is nothing at all.

What is not at risk is what the ceiling exists for. A runaway that *computes* is stopped
exactly as intended — a Python `while True:` traps on the deadline every time, and that case
has a test — and a parked program can do no further gg work either, because the membrane
refuses every bridged call once the budget is spent.

Both closures were weighed and neither is worth its cost yet. **Async WASI with `call_async`**,
so a park becomes a cancellable yield, is the right answer eventually and is a change to how
*every* guest is driven — the sandbox becomes async end to end and every existing arm is
re-validated against it, which is not a change to make on the way past while registering a
language. **Abandoning the thread from a wall-clock watchdog** is cheaper and wrong: the store
would outlive the turn gg reported and, while the membrane would refuse it every gg tool, it
would still hold the ambient filesystem — a leaked program writing files after gg has moved on
is a worse failure than a turn that waits.

Reopen it when a parked turn is observed in a real run, or when an arm can block in a way a
model reaches by accident rather than by writing a sleep.
:::

### The steps

1. **A sibling guest directory** — `packages/gg-sandbox-python/`, with its sources under
   `src/`, its pinned third-party wheels in `requirements.txt`, and its own `build.sh`
   driving `componentize-py`. It is not an npm workspace and shares no code with the
   TypeScript package. **Decide the library set here**: `componentize-py` bakes only the
   modules the entry module's import closure reached, so what a program can `import` is
   settled by this directory and nowhere else. Declare it in the catalogue's
   [`libraries`](#the-catalogue) section rather than describing it in a template: what the model
   is told it may import has to be read off whatever decides the set, or it is one more sentence
   that drifts.
2. **Bind the one WIT.** `crates/gg/wit/gg-sandbox.wit` is the wire and there is exactly one
   copy of it. The guest binds it directly.
3. **Hand-write the SDK**, idiomatic for the language, obeying the
   [five rules](#the-rules-an-agent-facing-surface-obeys-in-every-language) above. Python's is
   `packages/gg-sandbox-python/src/gg/`: `catalogue.py` holds the identity data — which gg tool
   is which function, on which object, gated by what — and every other module holds the
   spellings. It is also where the guest's *surface* is built (`scope.py`), which is not the
   same thing as the capability model: the objects follow the run, so a withheld tool is not an
   attribute and an object with nothing enabled is not a name, while the **host** is what
   refuses a call a program made by importing the package directly.
4. **Emit a catalogue** at `crates/gg/src/sandbox/guests/python.signatures.json`, in
   [the same shape](#the-catalogue), with `language: "python"` and the same `key`s: the
   `objects` section in presentation order, one entry per function with its `signatures` and
   each signature's arguments, every type with its own description and its members', the
   `meta` section carrying `list`, and — if the arm ships a curated library set — the
   `libraries` section reflected out of whatever decides it. It
   need not use the TypeScript package's reflector — only the emitted JSON is contractual —
   and Python's does not: `packages/gg-sandbox-python/tools/signatures.py` reads the SDK with
   **`griffe`**, the language's own documentation tool, statically and without importing it
   (every SDK module imports `wit_world`, which exists only inside the baked component). What
   it reads is what a Python author already writes: the docstring's summary and body, its
   `Args:` entries, its `Raises:` section, each parameter's annotation and default, each
   dataclass field's and enum member's own docstring. It must reflect them rather than list
   them, because the completeness half of the agreement gate fails a catalogue with a blank in
   it — and, for an argument, with a gap where one should be: a signature that takes arguments
   and documents none fails, as does an entry documenting no argument where another arm
   documents one. The reflector refuses to emit either, so the failure lands on the author
   rather than on a model.
5. **Commit both artifacts** under `crates/gg/src/sandbox/guests/`. If the language
   type-checks the model's program, its compiler has to reach the run container, and there
   are two places for it. A compiler small enough to *be* an artifact goes under
   `crates/gg/src/sandbox/checkers/`, pinned at one release, and rides inside gg's own
   binary — TypeScript's is a `tsc` cut out of the same pinned `typescript` its catalogue is
   reflected with, which is what stops a program from being judged by one release and
   described by another. A real toolchain goes in the
   [gg image layer](#where-a-compiler-lives-and-what-it-must-never-share) instead (step 8),
   because gg is copied into a container as a single file and a JDK is not one.
6. **Add the enum variant** in `crates/core/src/gg.rs`, and list it in `GgProgramLanguage::ALL`
   with an `ordinal()` arm. Neither is optional and neither can be forgotten: `ordinal()` is an
   exhaustive `match`, so the variant does not compile without an arm, and each arm checks its
   own position against `ALL` in a `const` block, so an arm for a language missing from the list
   is a build failure. gg then does not compile until the registry has an arm for it either.
7. **Implement the trait** in `crates/gg/src/sandbox/language/python.rs`: the preparation
   step — compiling through the `PrepareContext` it is handed and nothing else, per
   [per-agent compiler isolation](#per-agent-compiler-isolation) —
   [whether it compiles](#what-compiling-costs-and-where-it-is-recorded) and what
   preparing it needs warmed before the first turn, the
   binding-name convention, the synthesized file-view statement, the **program that opens a
   documentation view per name** (the on-use script of every built-in family skill, and the one
   thing gg generates rather than quotes), the **file extensions a code skill's module and
   on-use script are spelled with** in this language (`skill.py`, `on-use.py` — a skills
   directory is authored once and read by every agent, and language is resolved per agent, so a
   skill's code has one file name per language and each agent reads its own), the healing
   dialect, the prompt dialect, the two templates (`system-code.python.hbs`, `code-nothing-shown.python.hbs`) — whose every quoted
   call is an `{{api.…}}` reference and never a literal — and the healing fixtures its dialect
   must survive. If a code module in this language is not the same *shape* as a program — Java's
   is a class body — answer `isolation_module` as well, so the
   [isolation gate](#per-agent-compiler-isolation) has a module it can drive.
8. **Install its toolchain**, if it needs one at run time, in
   `containers/gg-toolchains/Dockerfile` — under `/opt/gg/toolchains` and nowhere else,
   relocatable across the Debian- and Ubuntu-based run images, and drivable with a
   per-invocation working tree and output directory rather than only through a shared
   process. The Dockerfile's header states both constraints;
   [per-agent compiler isolation](#per-agent-compiler-isolation) states what the calling side
   already does for it and what still has to be true of the toolchain itself. If the step
   `COPY`s anything out of the build context — Java's does, so that the image and a developer's
   machine install from one pinned list rather than two — **re-include that path in
   `.dockerignore`**, which is an allowlist: a `COPY` nobody re-included fails the build with
   `failed to compute cache key: "/path": not found`, and takes the `-gg` variant of every
   *other* language with it, because `containers/build.sh` builds this one builder before all of
   them. `scripts/ci/build-context.sh` is the gate that catches it, and the only one that can —
   the Rust suite, the drift gate and the lints all pass on a tree whose images cannot be built.
9. **Add a line to `scripts/ci/contract-drift.sh`** regenerating the new guest's catalogue —
   and re-cutting its checker, if it has one — so the drift gate covers them rather than only
   diffing them. The script lists the stems it knows how to regenerate and **fails on one it
   does not**, so a catalogue whose guest is never re-run is an error rather than a silent
   pass. What it must not regenerate is a component: Python's is not byte-reproducible, so a
   rebuild would fail the diff every time. A **signature step may write its catalogue and
   nothing else** — the gate asserts that the checkers directory is untouched after them — so
   whatever a catalogue needs that a build script happens to also produce gets its own script,
   as [Rust](#what-rusts-sdk-looks-like)'s WIT bindings did. Python's step also installs `uv`
   (`scripts/ci/install-uv.sh`), which is how all three machines that run this — a
   devcontainer with no usable `pip`, an Azure agent and a GitHub runner — reach the same
   pinned `griffe`. [Ruby](#ruby-compiled-to-javascript-before-it-crosses)'s needs no installer
   of its own: all three ship a Ruby, and its `signatures.sh` puts the pinned `yard` in that
   one with a `gem install --user-install`.
10. **Add the console's row**: a label in `PROGRAM_LANGUAGE_LABELS`
   (`packages/ui/src/app/pages/runs/gg/ggCatalog.ts`), which is what the capability editor's
   picker is built from, and a name in `PROGRAM_LANGUAGE_NAMES` on the Reference page. Both are
   `Record`s over the `GgProgramLanguage` union — **not** arrays of options, which is the
   distinction that makes the guarantee real: a `Record` missing a key is a TypeScript error,
   where an array missing a row type-checks perfectly and silently offers an operator one
   language fewer than gg has. The prompt editor needs nothing: `npm run gen:contract`
   discovers `system-code.*.hbs` from the directory and mirrors every one.
11. **Run the gates.** The [isolation gate](#per-agent-compiler-isolation) drives the new
    language's program and module steps sixteen ways and requires every artifact to belong to
    its own program — and if the new arm's compiler writes anything into an artifact that
    describes the *environment* rather than the program, say so with a **stable projection**
    rather than by loosening the check; the agreement gate compares the new catalogue against TypeScript's
    identity-for-identity; the prompt gate renders the new templates under every context
    fixture and checks every required section, every configured value, every granted
    capability's call and every rule a program runs under; the
    [prompt-resolution gate](#nothing-quotes-a-call-by-hand) reads the new templates' sources
    and refuses a hand-typed spelling or an unresolvable reference; the healing invariant
    re-earns delete-only over the new dialect's own fixtures **and** over the shared round-1
    corpus.

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
  exception raised at the call site — `except ToolError as failure:`, then
  `if failure.code is ToolErrorCode.CONFLICT:` — rather than a `ToolError` object thrown by
  hand. Same inversion, same reason (a surface where every call returns `(ok, output)` forces
  a branch after every line and makes a composed program unwritable), spelled the way the
  language spells it. The code is an enum member rather than a string, on rule 3.
- **Dataclasses and enums for results and fixed choices**, so a field is read as
  `entry.kind is EntryKind.FILE` rather than by string comparison, and the model's editor
  and the model's memory can both complete it.
- **A record's fields are the function's own arguments.** The wire declares one
  `memory-input` for three calls; the SDK spells it `memory.create_memory(name, description,
  body, code=…)` rather than asking a model to construct a value before it can make a call.
  A language whose optional arguments are keyword arguments has no reason to do otherwise —
  and it is why this arm documents more arguments per entry than TypeScript does, which is
  spelling and therefore free.
- **A named sentinel where `None` is already taken.** A patch field that can be *cleared* has
  three states, and Python spells "absent" as `None` — which is the request to clear it. So
  the third is `UNCHANGED`: leave the argument out to keep what is there, pass `None` to empty
  it, pass a value to replace it. TypeScript needs no such name, because `undefined` and
  `null` are two words there and one here.
- **`isinstance`, not a discriminant.** A read is `TextFile | ImageFile`, two classes a
  program narrows with `isinstance` or a `match` statement, where TypeScript reads a `kind`
  field off a union of object literals.

What must not differ: which functions exist, which object each hangs off, what gates each
one, and the [five rules](#the-rules-an-agent-facing-surface-obeys-in-every-language). A
Python SDK that offered `call("read_file", {...})` would be a smaller diff and a different
experiment.
