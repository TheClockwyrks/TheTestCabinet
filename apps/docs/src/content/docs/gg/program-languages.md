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

Two are registered. TypeScript is the default; **JavaScript** is the same arm with the
[type check removed](#javascript-the-same-arm-unchecked) and nothing else changed. This
page is the design of the seam: why the language is an axis, what an agent-facing surface
has to look like in *any* language, what a language must supply to be registered, what
stops two languages from quietly describing different capabilities, and what adding
another actually costs.

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
silently drops a run that has none. [JavaScript](#javascript-the-same-arm-unchecked) is the
registered language that takes that branch, and it is the arm a checked one is compared
against — so the difference between "compiled, in under a millisecond" and "there is no
compiler here" is exactly the difference being measured.

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

A compiler is on the **turn path**, so it has to be in the run container. gg itself is
copied in as a single static binary, which works because a binary copies fine — a JDK does
not. So a gg run resolves a `<name>-gg` **variant** of the image it would otherwise get:
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
| Toolchain inputs too big to unpack per preparation | `shared_toolchain_dir(key)` + `place(path, bytes)` — content-keyed, written by rename, **read-only afterwards** |

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
property of the borrow checker rather than of a discipline.

#### What holds a language to it

Three gates, none of which a language opts into:

1. **The isolation gate** (`crates/gg/src/sandbox/language/isolation.rs`) drives every
   registered language's program step *and* module step **sixteen at a time**, each with a
   distinguishable input, and requires every result to belong to its own input: it
   succeeded, it carries its own marker, it carries no other preparation's marker, it
   matches what the same input produced alone, and no two of the sixteen were handed the
   same workspace. The list of languages is derived from the registry, so a new arm is
   inside the gate the moment it compiles.
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
| **Preparing a program** | Turning a model's reply into source its guest can evaluate. TypeScript's is the `oxc` type-strip, the early-error check, the refusals for module syntax and top-level `await`, the stack sizing an unguarded recursive-descent parser forces on untrusted text, and then a `tsc` pass over the unstripped source. A language that runs a compiler here must also say **which of two failures** it hit — see [below](#a-compiler-has-two-ways-to-fail). |
| **Whether preparing a program compiles** | Whether that step invokes a compiler whose cost belongs to the program that paid it, and is therefore [recorded](#what-compiling-costs-and-where-it-is-recorded). A required answer rather than an inferred one: an arm whose compile time went unrecorded because nobody declared it would look free and would not be. |
| **Preparing a module** | Turning a [code skill](/gg/skills/#code-skills)'s or [code memory](/gg/memories/#code-memories)'s file into something whose evaluation yields a namespace, bound at `lib.<key>`. |
| Its **guest component** | The committed `.wasm` that evaluates the prepared source, embedded in the binary. |
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
required section.

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

### The catalogue

A language's catalogue is the whole of what a model is *told* about the surface, and every
word of it is **reflected out of documentation written on the declaration it describes**.
Nothing in it is authored in a table, a template or a prompt: an object's one-line
description comes from the doc comment on the constant that names the object, an argument's
description from the `@param` (or `# Arguments` heading, or `///` on the parameter — the
convention is the language's) written on that argument, and a type member's from the comment
above the member. A description kept anywhere else is a description that drifts, and nothing
would catch it.

It has eight sections:

| Section | What it carries |
| --- | --- |
| `objects` | Every API object a program's surface is divided into, **in the order the surface is presented in**, each with the sentence the system prompt introduces it by. The order is model-facing: it is what the prompt's API list and the run's [agent surface](/gg/agent-surface/) both render. |
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
- **No literal in gg's own Rust names an SDK call.** The same rule on the host side, with a
  short allow-list: a language's own module (where its syntax belongs, and which resolves the
  call's name even so) and the mock model's canned fixtures.

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
in the docs reads perfectly and tells a model to write something the call will not accept;
and no two functions on one object may share a name. Those checks run over the **emitted
catalogue**, so they are one gate for every language: a language whose compiler enforced its
doc comments (Swift's `docc`, Java's `-Xdoclint`) and one whose convention did (Rust's
`# Arguments`, PureScript's `@param`) land in the same shape here.

An **omission** is caught as well as a blank, which matters because the languages with no
per-argument doc slot of their own are exactly the ones whose reflector is most likely to
emit an empty argument list and call it done. Two checks catch it, and between them they
cover every notation: a signature that writes a non-empty argument list between brackets and
documents nothing fails on its own, and an entry documenting no argument where another arm
documents one fails comparatively — which is what covers a signature written without
brackets to look inside, as an ML-style `readFile :: String -> Effect FileRead` is.

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

The comparative half runs over the registry for real, now that
[JavaScript](#javascript-the-same-arm-unchecked) is in it — though that pair is the easiest
possible comparison, since the two catalogues are one set of declarations reflected twice.
So it is also exercised, on every run, against a **fixture language** that exists only
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

Python is no longer hypothetical here: its **guest exists**, in
`packages/gg-sandbox-python/` — the shim, the curated library set, the hand-run build, and
the committed component. What does *not* exist yet is its SDK and its
registration, which is why `python` is not a value an operator can configure. The split is
deliberate: a `ProgramLanguage` arm cannot be half-registered — the registry's `match` is
exhaustive and every gate that iterates the registered set would immediately demand a
catalogue, two templates and a healing dialect — so the artifact is proven first, on its own,
and the registration lands in one piece with the surface it registers.

### What was measured

A spike answered the questions that could have made this a redesign rather than an addition,
and the guest that followed re-measured every one of them on the real artifact:

| Question | Finding |
| --- | --- |
| Does another toolchain bind gg's existing WIT world? | **Yes.** `componentize-py` generates clean Python bindings for this exact world — 14 interfaces, ~55 typed functions with real records, enums and variants. WIT is a language-neutral IDL and behaves like one; no generic `call(name, json)` fallback was needed anywhere. |
| What does baking one cost? | **~1.8 s**, which is a hand-run build step, not a problem. |
| How big is the artifact? | **~23.5 MiB**, against the JavaScript guest's 13.4 MiB. Larger, and the same *kind* of number: both embed a whole runtime, and this one additionally carries a curated standard library. Not an exact number, because the build is not byte-reproducible — `componentize-py` snapshots a running interpreter's memory, so two builds of identical sources differ by tens of kilobytes. A test holds it to a 22–28 MiB band; **rebuilding to check whether the artifact is current does not work**, and its build script says so. |
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
most of the standard library plus two pinned pure-Python wheels (`PyYAML`, `tomli-w`);
what is deliberately withheld is `asyncio` (nothing here is asynchronous), `subprocess` and
`multiprocessing` (a component cannot spawn a process — `system.shell` is how an agent runs a
command), and `unittest`/`doctest`. What is simply unavailable is `ssl`, `bz2`, `lzma`,
`ctypes` and `curses`: `componentize-py`'s CPython is not built with them, and `ssl`'s absence
is why `urllib.request` reaches `http://` and not `https://`.

### WASI

gg's linker provides the **whole** WASI p2 surface to every guest, so a `componentize-py`
guest instantiates with nothing added to the host and nothing stubbed out of the guest. See
[what the host links](#what-the-host-links-and-why-it-is-the-same-for-every-language) for the
reasoning and for the one thing that is still withheld.

:::caution[A prerequisite for the first guest that can block]
The [execution timeout](/gg/execution-limits/) is delivered by epoch interruption, which can
only fire where the guest is running wasm. A guest parked inside a **synchronous WASI call** —
`wasi:io/poll` on a clock pollable, which is what `time.sleep` and `Thread.sleep` compile to,
or a blocking socket read — is running none, so the timeout cannot trap it, and the membrane's
deadline guard does not help because it only refuses at the next bridged call. The turn hangs
until the run-level idle watchdog (30 minutes) declares the run hung. Nothing stalls: the
program runs on a blocking thread, so sibling agents are unaffected.

No **registered** guest can reach this — TypeScript's shadows the timers and exposes no
filesystem or socket API — but the [Python guest](#adding-a-language-worked-python) already
can, and it has now been measured rather than reasoned about. `time.sleep(8)` against a
**2 s** budget was stopped at 2.5 s, 2.7 s, 4.3 s, 7.0 s and 9.4 s across five runs of the
same program: it *is* stopped, the trap lands, and the elapsed figure is honest — but where
it lands is wherever CPython's sleep next re-enters wasm, and in the worst observed case that
was only after the whole sleep had run. So the deadline is an upper bound on nothing, and a
`time.sleep(3600)` would sit until the run-level idle watchdog declares the run hung.

A runaway that *computes* is stopped exactly as intended: a Python `while True:` traps on the
deadline every time, and that case has a test. Closing the sleeping case is a design decision,
not a comment: async WASI with `call_async` so a park becomes a cancellable yield, or a
wall-clock watchdog that can cancel a store from outside. **Settle it with the registration of
the first such language, which is the first turn a model can reach it from.**
:::

### The steps

1. **A sibling guest directory** — `packages/gg-sandbox-python/`, with its sources under
   `src/`, its pinned third-party wheels in `requirements.txt`, and its own `build.sh`
   driving `componentize-py`. It is not an npm workspace and shares no code with the
   TypeScript package. **Decide the library set here**: `componentize-py` bakes only the
   modules the entry module's import closure reached, so what a program can `import` is
   settled by this directory and nowhere else.
2. **Bind the one WIT.** `crates/gg/wit/gg-sandbox.wit` is the wire and there is exactly one
   copy of it. The guest binds it directly.
3. **Hand-write the SDK**, idiomatic for the language, obeying the
   [five rules](#the-rules-an-agent-facing-surface-obeys-in-every-language) above.
4. **Emit a catalogue** at `crates/gg/src/sandbox/guests/python.signatures.json`, in
   [the same shape](#the-catalogue), with `language: "python"` and the same `key`s: the
   `objects` section in presentation order, one entry per function with its `signatures` and
   each signature's arguments, every type with its own description and its members', and the
   `meta` section carrying `list`. It
   need not use the TypeScript package's reflector — only the emitted JSON is contractual,
   and a Python guest would reflect its own docstrings and type hints with its own script —
   but it must reflect them rather than list them, because the completeness half of the
   agreement gate fails a catalogue with a blank in it — and, for an argument, with a gap
   where one should be: a signature that takes arguments and documents none fails, as does an
   entry documenting no argument where another arm documents one.
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
   must survive.
8. **Install its toolchain**, if it needs one at run time, in
   `containers/gg-toolchains/Dockerfile` — under `/opt/gg/toolchains` and nowhere else,
   relocatable across the Debian- and Ubuntu-based run images, and drivable with a
   per-invocation working tree and output directory rather than only through a shared
   process. The Dockerfile's header states both constraints;
   [per-agent compiler isolation](#per-agent-compiler-isolation) states what the calling side
   already does for it and what still has to be true of the toolchain itself.
9. **Add a line to `scripts/ci/contract-drift.sh`** regenerating the new guest's catalogue —
   and re-cutting its checker, if it has one — so the drift gate covers them rather than only
   diffing them.
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
    its own program; the agreement gate compares the new catalogue against TypeScript's
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
