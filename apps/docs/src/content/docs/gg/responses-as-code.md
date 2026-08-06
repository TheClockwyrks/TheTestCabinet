---
title: "Responses as code"
---

An alternative to traditional tool calling: an agent answers a turn by **writing a whole
program** over its tools, which gg executes in a
[wasmtime](https://wasmtime.dev/) sandbox — instead of emitting one tool call, waiting
for its result, and emitting the next. Loops, conditionals, filtering, intermediate
values and a dozen composed calls all happen inside a single turn. What comes back is the
[views](#showing-yourself-things) the program opened — which are how anything a program
computed reaches the model at all — and, when something failed, the error and nothing else.

This is well-trodden ground for us: the same approach is already implemented and
well understood in another of the author's projects (and wasmtime is already the
sandbox The Test Cabinet's [Foray](/testing/adversarial/foray/architecture/) engine
runs untrusted controllers in), so it is a low-risk capability to bring to gg.

It is a capability like any other, which is the point. Turn it on and the model is
offered **no native tool definitions at all** — the [system prompt](/gg/prompts/) names
the API objects the program is given, and the model reads the functions on them on demand
with `object.list()` and `view.openDocsView()`; turn it off and the same run executes as ordinary
tool calling. Freeze the model, the test case and the rest of the
[capability set](/gg/overview/#the-capability-set), vary this one toggle, and the
difference is attributable to the shape of the response. That A/B — do code-shaped
responses help a model tackle the large [Hard](/testing/end-to-end/) cases? — is what
the capability exists to measure.

Which **language** that program is written in is a second axis of the same kind, and it is
[first-class](#the-program-language): gg registers a *set* of program languages and a run
picks one per agent. Four are registered: TypeScript, which is the default;
[JavaScript](/gg/program-languages/#javascript-the-same-arm-unchecked), which is the same
arm with the [type check](#stripped-and-checked) removed and nothing else changed;
[Python](/gg/program-languages/#python-a-guest-that-carries-its-own-interpreter), whose
guest carries its own CPython so a program reaches it as source with no compiler on the
turn path; and
[Ruby](/gg/program-languages/#ruby-compiled-to-javascript-before-it-crosses), which a real
compiler reads whole — and may refuse — before it runs, with no type system anywhere. Every example on this page is TypeScript — and where a passage below quotes a
spelling, a type-strip or a fence tag, it is TypeScript's answer to a question **every**
language answers. [Program languages](/gg/program-languages/) is the design of that seam.

## The contract a model sees

The model's **whole reply is the program**. Not a block inside the reply, not the
first of several — the first character of the reply is the first character of its
code, and what gg compiles is the reply itself:

```ts
const specs = fs.listDir("specs").filter((e) => e.kind === "file" && e.name.endsWith(".md"));
const missing = specs.filter((e) => !fs.readTextFile(`specs/${e.name}`).includes("## Rules"));
view.openText("specs-missing-rules", missing.map((e) => e.name).join("\n"));
if (missing.length === 0) harness.finish(`Checked all ${specs.length} spec files; every one documents its rules.`);
```

That example is fenced **on this page**, because this page is written for humans. The
model's reply carries no fence, no `ts` tag and no prose around the code, and the
[prompt](/gg/prompts/) says so in as many words: *do not include any plain text, Markdown
formatting, or other non-code text in your responses*. A fence is Markdown formatting, so
the rule that forbids the prose forbids the fence with it. The one fenced block the prompt
itself can render is not a counter-example — it illustrates a message the model
**receives** (the `<label>\n----\n` heading rule), not a reply it sends.

- **`view` is how anything reaches the model.** A program that computed something worth
  seeing next turn *opens a view* of it, and gg pushes **one message per view** into the
  next prompt — the exact counterpart of one tool result per tool call, carrying the band
  it is charged to and the selector it can be closed by. This is the whole subject of
  [showing yourself things](#showing-yourself-things) below, and the one part of the
  protocol a model cannot work around.
- **`console.*` is captured, and it goes to the run's *operator*.** It is not stdout:
  gg's [telemetry](/gg/telemetry/) *is* this process's stdout, so `console.log` is routed
  to a host call instead — and from there onto the turn's own `code_execution` event,
  which carries every line the program printed (and how many the capture caps dropped).
  That event is what puts a program's output on the operator's stream, in the run record
  and on the console's activity feed, and it is the **only** record of it: a log line is
  not shown back to the model, and neither is the count of them. That `console.log()` will
  not be visible is said once, in the [system prompt](/gg/prompts/), where a standing rule
  belongs — not on every turn that breaks it. The one thing that can still call it out is
  the [notice a turn earns](#a-program-that-worked-earns-no-message) when it put nothing in
  the window at all.
- **`return` at the top level** ends the program, exactly as it ends any function body,
  and **its value is discarded**. A program uses it to stop early; it says nothing. That
  rule, too, is stated once in the system prompt; the fact that a particular program
  returned something goes to the run's [operator](#what-the-operator-is-told-instead) and
  not to the model — see
  [the rule that replaced a family of rules](#a-returned-value-is-discarded) below.
- **An [ending call](/gg/ending-a-session/#ending-calls) ends the session** — and nothing else
  does. Which one an agent has depends on the role it was dispatched in:
  `harness.finish(summary)` for an agent doing work, `review.approve()` /
  `review.requestChanges(items)` for a reviewer. Only that role's group is bound, so a
  call another role would make is an
  undefined identifier here, exactly as a withheld tool is — and the membrane
  [refuses it as well](#capability-gating), so an agent that has the name anyway still
  cannot use it. Each is a real membrane
  function, not a rule about text: it **sets a flag** in the agent's host-side context and
  returns, the program runs on, and the loop reads the flag once the program has ended.
- **Every reply is compiled, and gg judges none of them.** After
  [healing](/gg/response-healing/) the reply goes straight to the run's
  [program language](#the-program-language), to be prepared for its guest — for TypeScript,
  the type-strip. Prose does
  not compile and earns a `Compiler error`; two programs pasted together do not compile
  and earn the redeclaration error that is what is actually wrong with them; a reply of
  comments, or an empty reply, is a program that compiles, runs and does nothing. gg
  performs **no** analysis of the text to decide whether it "is a program" — the compiler
  answers that, over the model's own words, with a line and a column. A turn that failed
  to compile is an **error turn**, so a configured
  [error ceiling](/gg/execution-limits/) can stop a model that has started answering in
  prose; with none configured, the run is bounded by its turn ceiling as it always was.

### A reversal: there is no fenced block, and there *is* a `finish`

This page previously documented the opposite protocol, and the reversal is recorded
here rather than quietly overwritten, because the argument that was overturned was a
reasonable one and the evidence that overturned it is the useful part.

**What it used to say.** Each turn was exactly one fenced block tagged `ts`;
extraction took the first recognised block and ignored the rest; a turn with **no**
fenced block ended the session, exactly as an empty tool-call turn ends a tool-calling
one. There was deliberately no `done()` tool, on the grounds that a second termination
path in the loop, and a name in scope a program could call by accident, were both
worse than the rule.

**What changed the answer.** Four real models ran the same task against that
implementation. All four emitted **more than one** candidate block on their very first
turn — 2, 5, 7 and 2 of them — and the extractor ran the first and silently discarded
the others, with no diagnostic anywhere in the turn's feedback. For one model the
discarded block was the one that wrote the deliverable; it never learned, and every
one of its failed assertions traces to that single silent drop. Three of the four also
narrated a finished task in prose, before seeing any result — and the implicit rule duly
read such a turn as an ending. One of them finished that way having produced **zero**
successful executions and no deliverable on disk, over a run whose recorded terminal
status was `completed`.

**Answering the old objection.** `finish` is not a *second* termination path: the
implicit one is gone, so this loop has **one** ending where it used to have one plus a
silent one. Nor can it be called by accident, which was the other half of the
objection: with no fence there is no "turn with no block" to fall into, and ending a
run now requires the model to *write* `finish("…")` with a summary of what it did.
Ending by omission — the failure mode that shipped a run as `completed` with nothing
built — is no longer expressible.

The measurement argument survives the change intact, and in better shape. "How often
did a model need rescuing?" is still a question this capability exists to answer; it is
now answered by counted, disclosed [response healing](/gg/response-healing/) rather
than by whether a run silently produced the wrong artifact.

### Ending a session, exactly

The whole of the mechanism is a **flag in the agent's own host-side context** — the same
per-agent state a program's `readFile` or `spawnSubagent` is aimed at, which is what tells
gg *which* agent is asking. `finish` writes that flag and returns; the loop reads it when
the program has ended. There is no exception to raise, so there is nothing for a program to
catch, and nothing about ending the run depends on the guest behaving.

- **`finish` does not stop the program.** The statements after it run, their calls are
  dispatched and recorded like any other, and the session ends when the program does. A
  program that declares itself done and then tidies up gets the tidying it wrote.
- **Last call wins.** Calling it twice is not a failure — two branches that both run, or a
  call inside a loop, are ordinary shapes — and the later summary is the one written with
  more of the program's work behind it. The replacements are counted and the run logs a
  `warn` about them.
- **A program that then fails loses the ending.** An uncaught throw, or a sandbox ceiling
  stopping the guest, **revokes** the flag: the summary describes checks the program never
  ran to the end of. The run carries on, and the model reads the throw and nothing else.
  What keeps it from fixing the throw and never calling `finish` again is the
  [system prompt](/gg/prompts/), which states the rule up front — *a program that throws
  does not end your session, even if it called an ending function before it threw* — rather
  than a sentence appended to the one turn that tripped over it. The revocation itself is
  logged for the [operator](#what-the-operator-is-told-instead). A failure the program
  **catches** revokes nothing: it ran to its end.
- **An empty summary finishes nothing.** It is refused as `invalid-argument` at the host,
  because the summary is the run's final word — and a subagent's entire answer to whoever
  asked for the work.
- **`finish` inside a conditional.** Nothing special, and it is the *intended* shape: the
  branch that reaches it ends the run and the branch that does not carries on. The prompt
  teaches checking the work and concluding in the same program, since that is what writing
  a program is for.
- **Never calling it.** Nothing ends implicitly. The session continues until a bound stops
  it — the turn ceiling, the wall-clock budget, a model API failure, gg's own machinery, or
  a configured [execution ceiling](/gg/execution-limits/).

#### Why a flag, and not an exception

The first implementation raised an unwind from `finish` so that nothing after it could run,
and recorded the completion at the host *before* raising it so a broad `try`/`catch` could
not swallow the ending. It worked, and it cost more than it bought. A model that wrote
`finish` where it meant "and we are done" silently lost every statement below it —
including, in one real session, the one that wrote the deliverable — and gg could only
report that after the fact, on the operator's stream, because the run had already ended.
The catchable-unwind case then needed rules of its own: a `conflict` on the second call, a
`refused` on every later tool call, a warning about a program that had "caught its own
completion".

A flag needs none of that. The work after `finish` is just work, a second call is just a
newer summary, and the one thing the unwind was protecting against — an ending that rests on
a program that never finished — is handled directly by revoking the flag when the program
fails.

### A returned value is discarded

A top-level `return` ends the program and gg **does not look at the value**. The guest
reports only *that* a value was returned — a fact that goes to the run's
[operator](#what-the-operator-is-told-instead), where a reader can see that a program tried
to answer through a channel that does not carry; the value itself never crosses the
membrane.

This is a subtraction, and what it removed is the point. A carried return value needed a
rule for every shape a program might hand back: a `Promise` (the trace of `async` in a
synchronous sandbox), a cycle `JSON.stringify` throws on, a function that serialises to
nothing, a structure nested past the 127 levels the host's parser would read back, a value
large enough to need its own 8 KiB cap in the feedback. Each had its own message and its own
failure mode, and each was a rule a model had to learn in order to use a channel it did not
need: anything a program can return, it can hand to a channel that already has one rule. One
sentence replaced all of them — at the time, *`console.log` what you want to see*; since
[views](#showing-yourself-things), *open a view of it*. Which channel it is has changed
once; that there is exactly one, and that it takes a string, has not.

`return` itself is untouched and is still worth writing: it is how a program stops early
without an `else`. And one thing gg does still say to the model about it — statements after a
top-level `return` are counted and quoted in a [`Notice`](#the-three-things-gg-says) — is the
exception that shows where the line is drawn. Nothing the program can observe reveals that
half its statements never ran: no call failed, nothing threw, and the shape is exactly what a
pasted second draft looks like. A notice is the only channel that fact has.

### Malformed replies are healed, and the repair is counted

Between the raw reply and the preparation step sits a **deletion-only healing pass**: it
unwraps a Markdown fence a model wrapped its program in, drops explanatory lines around
it, removes `import` lines for a surface that is already in scope, and unwraps an
`async` wrapper whose continuation this sandbox would have run only after the program
had already returned. The pass itself is language-independent — what an import looks
like, and what a whole-program concurrency wrapper looks like, are asked of the run's
language's [dialect](/gg/response-healing/#the-skeleton-and-the-dialect).
Every repair is counted on the run and disclosed to the run's
operator, so a healed response is a measurement rather than a rescue — but nothing about it
is said to the model, for the same reason nothing else about a working program is. The
strategies, their decline rules,
their configuration and their metrics are [their own page](/gg/response-healing/).

A reply that was *nearly* right is a different problem, and it has its own capability. Under
this protocol a one-character mistake in a sixty-line program costs the sixty lines again;
the [program library](/gg/program-library/) keeps what gg ran and lets the next program fetch
it, patch it as a string, and hand it back to be run. Opt-in, and off by default.

## The typed tool surface

Every gg tool is a **distinct, typed function** in the run's
[program language](#the-program-language), already in the program's scope. There is no
dispatcher to name a tool through and no JSON to hand-assemble — that holds in every
language, and is [the first of the rules](/gg/program-languages/#the-rules-an-agent-facing-surface-obeys-in-every-language)
an SDK has to keep. The spellings below are TypeScript's:

| Function | Returns |
| --- | --- |
| `system.shell(command: string, options?: { timeoutSecs?: number; })` | `ShellOutput` |
| `fs.readFile(path: string, options?: { offset?: number; limit?: number; })` | `FileRead` |
| `fs.writeFile(path: string, contents: string)` | `number` (bytes written) |
| `fs.editFile(path: string, oldString: string, newString: string)` | `void` |
| `fs.listDir(path?: string)` | `DirEntry[]` |
| `agents.spawnSubagent(request: { agent: string; } & ({ prompt: string; } \| { issueId: string; }))` | `SubagentHandle` |

**Every** one of gg's thirty-seven tools is bound this way — there is no withheld class
(see [below](#every-tool-is-bound)) — plus one
convenience helper, `fs.readTextFile(path, options?)`, for the overwhelmingly common case
of wanting a file's text rather than its metadata, and the
[ending calls](/gg/ending-a-session/#ending-calls) and the
[`view` object](#showing-yourself-things), which are membrane functions like any other but
not tools: no capability offers them, they dispatch nothing, and each is declared in its
**own** WIT interface precisely so the one-to-one correspondence between the tool
interfaces and gg's tool vocabulary is not perturbed by them. A signature and a sentence of
documentation exist for every function **the run actually offers**, reflected out of that
language's SDK's own emitted declarations by the same build that produces its component; the
prompt names the objects — plus the argument shape of the two or three calls a program
cannot bootstrap without, `view.openText`, `view.openFile` and `system.shell`, each named
only when this run binds it — and the model reads the rest of the functions on demand with
`object.list()` and `view.openDocsView()`. A hand-written list would drift, and a prompt
that describes a signature the sandbox does not have is worse than no prompt, because the
model has no way to discover the lie.

### Reading the documentation is opening a view

There are two discovery calls and they are deliberately different kinds of thing.

`object.list()` returns **inline**, as a value the program can iterate. It is a *directory* —
one line per function on that object, name and summary — and a directory is something a
program consults in order to decide what to do next, in the turn it is deciding. It is
unchanged, and it is the reason every API object carries a `list` and the view API's own
listing call had to be named [`current`](#showing-yourself-things) instead.

`list` is the one function that hangs off **no** object, because it hangs off all of them: the
guest seeds it onto each object it creates with that object's name closed over. It is
catalogued all the same, in a
[`meta` section](/gg/program-languages/#the-catalogue) of its own, and for the reason
everything else is — its signature and its description are read by a model, and every word a
model reads about this SDK is reflected out of the declaration that states it. Answering for
it from a constant on gg's side was the one description in the whole surface that no gate could
compare against the code.

What it returns inline it returns **to the program**, which is the whole distinction between
the two calls and the one the [prompt](/gg/prompts/) now draws in as many words. A directory
is an ordinary return value, so it reaches the model's window not at all unless the program
forwards it — `view.openText("fs", JSON.stringify(fs.list()))` — and the failure of not
saying so is silent rather than noisy. A model told that `list()` and `openDocsView` are two
ways of looking a function up writes `system.list();`, the program runs, the value is
discarded like every other returned value, and the turn produces *nothing*: the only thing
that comes back is the [`Notice`](#a-program-that-worked-earns-no-message) saying the program
put nothing in its context, earned by a program that did exactly what it was told.

`view.openDocsView(fn)` is the other one, and it opens a **view**. Pass the bound function
itself — `view.openDocsView(view.openText)` — or its name, `view.openDocsView("openText")`.
What comes back is every shape the function may be called in — usually one, but a language
that spells an optional argument as an overload pair carries two — with **a line per
argument** saying what to put there, then its documentation, then the declarations of every
type it mentions, each with **a line per member**. All of it arrives under the
[`Documentation`](#three-kinds-of-view) heading qualified by the function's name.

Each argument's line carries its name, its type, its default where the language states one,
and its description. It also says **`(passed by name)`** where the language passes that
argument by name rather than by position — Python's keyword arguments, Kotlin's named ones —
because that is the one property of an argument that changes what the model has to type. It
is silent for a positional argument, which is every argument in TypeScript and would be a
label on every line.

The per-argument and per-member lines are not commentary gg wrote: every one of them is
reflected out of the doc comment on the argument or member it describes, in the SDK's own
source, by the same build that produced the component. A declaration says what fields a
value has and nothing about what any of them *means* — `shown: boolean` on a `FileRead` is
unguessable — which is the half that decides whether a model uses the value correctly.

An argument that is *neither* a bound function nor a name is refused in the **guest**, before
any lookup happens, and that placement is the point. `view.openDocsView(system.run)` — a
function this run does not bind — evaluates to `undefined` long before the call is made, and
coercing it looked up a function literally named `"undefined"` and reported that name back as
unknown. The name was never the model's: nothing it wrote said `undefined`, so it was sent
hunting a typo that did not exist. The last layer that can still see what the value *was* is
the one that names it, so `undefined` and `null` are answered with the fault that actually
occurred (*no documentation found*) and any other wrong type is named for what it is
(*expected a function or function name, got number*). A name that is merely unknown still
throws `not-found`, because that one really is a name the model wrote.

And because it is a name the model wrote, the `not-found` says which bound names it is
*nearly*, on a second line indented under the error the way a compiler indents a hint:

```text
Runtime error
----
`openDocsView` failed (not-found): no documentation for `write`
  Did you mean `writeFile` or `writeMemory`?
```

Watching real sessions, a missed lookup is almost never an invented name. It is the **gg tool
name** where the program spelling belongs (`write_file` for `writeFile` — the tool name is what
the model's own telemetry, its prompt and gg's sentences call the same function), a **stem**
completed by guess (`write`, `read`, `open`), or a **typo** in a name it has already used. All
three are answerable from the very set the lookup just failed against, so gg answers them: an
object qualifier is seen through, so is the difference between `write_file` and `writeFile`, and
a name within an edit or two is offered as the typo it is. At most three names, only ever the
closest *kind* of near-miss — an exact name under another spelling is never padded out with
typos beside it — and, when nothing is close, nothing at all, since a wrong suggestion sends the
model to read documentation for a function it did not want. The candidates are the names **this
agent binds**, never the whole catalogue: offering `editFile` to a run that withheld `edit_file`
would trade a `not-found` for a `ReferenceError` a turn later. `<object>.list()` remains the
directory; this is a nudge, not a substitute for it.

That is a reversal, and the thing it replaced is worth stating because the replacement is a
subtraction. gg used to hang a `.docs()` method off every bound function (and a
`harness.readDocs(name)` beside it, for a model that had only a name). Calling it did two
things at once: it **pinned** a documentation block into the window *and* returned the same
text inline to the program. So the material arrived twice, through two doors that could not
see each other, and the pinned copy was charged to nobody's account and reclaimable by no
close — a model that looked up eight functions early and then wanted the room back had no
call that would give it any. Both `.docs()` and `harness.readDocs` are gone. There is one
door, it is the door everything else goes through, and what it opens can be closed with
`view.close(name)` like anything else.

Two consequences fall out of that, and the prompt states both:

- **The documentation arrives on the *next* turn.** A view is material for the window, not a
  value for the program, so it is not available during the turn that asks for it: ask in one
  turn, use it in the next. The old prompt claimed exactly this and was simply wrong —
  `.docs()` did return inline, and a model that believed the prompt wasted a turn waiting for
  something it already had. It is true now.
- **A lookup is self-contained.** It carries every type declaration the function refers to,
  **every time**, with no dedup against what an earlier lookup showed. Deduplicating would be
  the obvious economy and it is exactly wrong here: a view can be closed, and a view can be
  superseded, so a block that omitted `FileRead` on the grounds that some other block already
  carried it would stop making sense the moment the model tidied up. A lookup that only reads
  correctly in the company of the lookups that preceded it is not a lookup.

The `harness` object shrank in the same change. It now carries `finish` and nothing else — it
existed to hold `readDocs` for every role, so a reviewer and a judge, whose endings live on
`review` and `judge`, were each handed a `harness` with one function on it they were not
supposed to end with. A reviewer now gets no `harness` object at all. The prompt's one-line
description of it changed to match: from *read documentation* to *end your session*. `view`'s
grew to say what it had become — *show yourself a file, a value, or a function's
documentation — the only way material enters your context*.

### Why typed functions, and not one generic call

A single `callTool(name, argsJson)` would have been far less work, and it is exactly
what this design forbids. The interface between a program and gg is a
[WIT](https://component-model.bytecodealliance.org/design/wit.html) membrane —
`crates/gg/wit/gg-sandbox.wit` — declaring **one function per tool**, with typed
parameters and a typed `result<T, tool-error>`, grouped one interface per capability
family. That has three consequences worth the effort:

- **The compiler is the drift gate.** A WIT function cannot exist without a host
  implementation, so a tool cannot be added, renamed or removed without a typed
  signature following it.
- **The model gets a real API.** `readFile(p, { limit: 200 })` is discoverable,
  auto-completable in the model's head, and wrong in ways the SDK can name. A JSON blob
  is none of those.
- **Nothing else is reachable *as a tool*.** The membrane is the only way to ask *gg*
  for anything: what the interface does not declare is not something a program can ask
  gg to do, and the component is built with no module system to reach around it. That is
  a statement about gg's surface, not about the language's — the guest also imports the
  WASI its runtime needs, and the host links the rest of WASI besides. (See
  [what a program can and cannot reach](#what-a-program-can-and-cannot-reach).)

JSON survives in exactly one place, and it is deliberately **inside the host**: between
the membrane implementation and gg's existing tool registry, which has always dispatched
on a name and a JSON value. That is what keeps the compaction gate, delegation
routing through the subagent scheduler, `ToolCall`/`ToolResult` telemetry and
[session-record](/gg/session-record/) capture completely untouched while the model-facing surface
becomes typed functions.

None of this is TypeScript's to give up. The WIT is a language-neutral IDL — other guest
toolchains bind this exact world — so a second language binds the same typed membrane, and
its SDK is [hand-written and idiomatic](/gg/program-languages/#the-sdk-is-hand-written-and-native)
on top of it. A generic dispatcher would not be a shortcut for a new language; it would be
the one thing that makes it a different capability.

### Stripped and checked

This is TypeScript's **preparation step**. Every language answers the same question —
*how does a model's reply become source this guest can evaluate?* — and this is
TypeScript's answer. It is where a language spends whatever it must to make untrusted text
safe to hand to a parser, and where it refuses, with a sentence the model can act on,
anything the sandbox has no implementation of.

It is two passes, in this order, and each does something the other cannot.

**The strip** erases the types with [`oxc`](https://oxc.rs/) in-process, in around 0.2 ms.
An `interface` declaration disappears and `const x: Entry[] = …` becomes `const x = …`;
what comes out is the JavaScript the guest evaluates. This pass is also where a syntax
error, an [early error](#statements-that-cannot-run), a refused `import` and the
[unreachable-tail](#statements-that-cannot-run) count come from, each in gg's own located
rendering.

**The check** runs `tsc` over the model's *unstripped* source, against the SDK's own
declarations, in around 90 ms. A program that does not type-check is **not executed**: the
model is handed the compiler's diagnostics, at the coordinates of the text it wrote, and
writes another program next turn. So a call that passes a string where a number was
declared no longer runs — it costs a turn and a diagnostic rather than a `TypeError` half
way through a piece of work.

The cheap pass runs first, so a program with a typo costs a parse rather than a compiler,
and each failure lands in the [kind that names its cause](#what-can-go-wrong).

The **JavaScript** arm is the first pass and not the second — the same strip, the same
guest, the same catalogue with its annotations intact, and no `tsc`. It exists so that
whether the check is worth what it costs is a question a run can answer rather than a claim
this section makes; see
[JavaScript](/gg/program-languages/#javascript-the-same-arm-unchecked).

The **Python** arm is neither pass. Its guest carries its own CPython, so the reply crosses
the membrane as the model wrote it and the interpreter that runs it is the first thing to
read it: a syntax error arrives as a located run-time error with the failing line quoted,
rather than as a refusal from the host. See
[Python](/gg/program-languages/#python-a-guest-that-carries-its-own-interpreter).

#### What the check is, exactly

- **The compiler.** A `tsc` pinned at one release, committed under
  `crates/gg/src/sandbox/checkers/` and embedded in the gg binary, run with the `node`
  every run image already ships. gg carries it for the same reason it carries the
  component: it is copied as a single file into an ephemeral run container and must arrive
  with everything it needs. Cut from the same pinned `typescript` the SDK's declarations
  are emitted by, so what a program is judged against and what the model is shown are one
  release.
- **The declarations.** The ES2022 standard library, plus the whole SDK surface generated
  from the [signature catalogue](/gg/program-languages/#the-sdk-is-hand-written-and-native)
  — so the signatures the prompt shows and the signatures the checker enforces cannot
  disagree — plus `console`, `lib`, `performance` and `crypto`, the names a program can
  reach that no SDK declaration covers.
- **Strict mode**, which is why a caught error is `unknown` until it is narrowed. The
  prompt says so.
- **No `DOM`.** `document`, `fetch` and the timers are undeclared, because a program has
  none of them; naming one is a compile error rather than a surprise at run time.
- **The whole surface, not the run's.** The declarations carry every object and every
  function the catalogue has, including the ones this run's toolset withholds — which is
  the *opposite* of what the prompt does. Two reasons: a withheld name has to stay
  reachable **as a withheld name**, so that "the model reached for something it was not
  given" keeps being recorded as `program_unknown_name` in a checked arm and an unchecked
  one alike (see [toolset ablation](/gg/toolset-ablation/)); and a verdict has to depend on
  the program alone, since the same text is checked as a turn's program, as a skill's
  on-use script and as the code half of a memory being written.

A code [skill](/gg/skills/) or [memory](/gg/memories/) is checked too, as what it is — a
module with exports, in its own coordinates. A module that does not type-check would
otherwise bind a `lib.<key>` whose every call fails in some later turn that has nothing to
do with the one that wrote it.

What the check costs is [measured, not assumed](/gg/telemetry/): TypeScript declares that
its preparation compiles, so every program it prepares is timed — the rejected ones
included — and the reading reaches the run as `compileMs`.

#### The validators are still there, and still earn their keep

A type checker sees the program; it does not see a value that arrived as `any`, and it
does not run in an unchecked arm at all. So **run-time validation in the SDK wrappers**
stays, on the three shapes that are otherwise silent or unreadable:

- `shell("npm test", 300)` — a positional argument where an options object belongs
  would quietly read `timeoutSecs` off a number, get `undefined`, and use the default.
  It is refused with *"expected an options object, got number"*.
- `readFile("a.ts", { offset: -1 })` — a negative number lowers across the membrane by
  two's-complement wrap and fails for a reason unrelated to what was written. It is
  refused with the permitted range.
- A record's `list<T>` field left off entirely — which arrives as `undefined` and
  throws `TypeError: can't access property "length"`, naming neither the tool nor the
  field. It is defaulted to `[]`.

Bad enum strings and bad variant tags already produce good messages from the generated
bindings, so the validators cover exactly that gap and nothing more.

One layer *below* types is checked, though, because leaving it to the guest costs the
model its location: ECMAScript's **early errors** — a `const` declared twice, a `let`
shadowing a parameter, a duplicate name in a destructuring pattern. Those are scope
errors, not parse errors, and the guest's `new Function` raises them at *construction*
time, before a statement runs — a throw with no stack frame inside the program, so the
shim's line recovery finds nothing and the model gets `SyntaxError: redeclaration of
const root` with no file, no line and no excerpt. gg checks them during the type-strip
instead, where the scope analysis the transformer needs is already being done, and hands
back the same located diagnostic every other preparation failure carries — pointing at both
the first binding and the second, since a redeclaration is only fixable from the half that
came later.

It is worth knowing what produces one. Nearly always: two programs in one reply.

### Statements that cannot run

A program's top level is a function body, so a top-level `return` ends it and everything
after it is dead. That is legal JavaScript and nothing refuses it — a language whose
program body may end early is entitled to dead code after the statement that ends it, and
gg's preparation step reports the fact rather than judging it, in whatever language. But a
model that
pasted a second draft after the first one's `return` would otherwise be told *"your
program ran to completion"* about a reply whose second half, the half that wrote the
deliverable and called `finish`, never executed. So gg counts what could not run and says
so, in a [`Notice`](#the-three-things-gg-says) and on the run's stream:

```text
2 statements after your top-level `return` did not run — the first is line 4:
writeFile("MANIFEST.md", "- a.ts (6 lines)\n");. A top-level `return` ends the program,
so nothing written after it executes. Send exactly one program per reply.
```

Hoisted `function` declarations are excluded (they are in scope before the first statement
runs), as are `interface`/`type` declarations (erased entirely) and stray semicolons. A
`return` inside an `if`, a loop or a block is a conditional exit and says nothing about
what follows it, so only a top-level one counts.

A top-level `finish(…)` call used to be the same shape for the same reason, and is not one
any more: `finish` returns, so the statements after it run and calling them unreachable
would be false. That change is what removed the more damaging half of this defect — a
program that declared the run complete and then went on to write its artifact now writes
it.

## `lib`: code the agent loaded

Beside the tool objects there is one more thing a program can find in its scope: **`lib`**,
the code the agent has loaded. Its contents come from exactly two places, and both are
things the agent read:

- a [**code skill**](/gg/skills/#code-skills) — a skill directory's module, authored ahead
  of the run in this language's own file (`skill.ts` here, `skill.py` on a Python agent);
  and
- a [**code memory**](/gg/memories/#code-memories) — the `code` a program handed
  `memory.writeMemory` (or `createMemory` / `updateMemory`), which the model wrote itself.

Each is bound at `lib.<key>`, `key` being the skill's name or the memory's slug in camel
case — `csv-tools` becomes `lib.csvTools` — deduplicated with a numeric suffix if two things
camel-case alike. The reply to the read that loaded it **states the key it really got and
lists what it exports**, so a binding path is never guessed:

```ts
const rows = lib.csvTools.parseCsv(fs.readTextFile("data/vendor.csv"));
view.openText("rows", `${rows.length} rows, ${rows[0].length} columns`);
```

`lib` follows the same capability rule every other object does: it joins the scope only when
the agent has actually loaded something, so a program written by an agent that has read no
code has no `lib` identifier at all. It is not an **API object**, though — it holds no gg
functions, and it has no `list()` to call. The hint an unknown name earns keeps the two
apart, listing the API objects a program may reach and then naming `lib` separately, because
a list that lumped them together would be false about one of them.

Loaded code is **not context**. It is prepared once and held by the host, so it costs no
tokens, is never summarized, and a [compaction](/gg/compaction/) does not sweep it — an
agent never has to re-read a skill to get its helpers back. A
[`fork`](/gg/fork-and-exec/) or a succession is the other way round: a new instance starts
with nothing bound, and re-reading is the whole of the recovery.

### What a module may be

A module is an ordinary file in the run's [program language](#the-program-language), and
each language prepares one its own way — a module is a second preparation step beside the
one for programs, not a variation on it. TypeScript's: gg parses the file as a module (so
`export` is legal), blanks the `export` keywords, type-strips it exactly as it type-strips
a program, and appends the `return { … }` that makes its exports the value of evaluating
it. The blanking is textual and byte-for-byte, so **every diagnostic still points at the
line the author wrote**.

**What it exports** is whatever it says it exports — and, if it says nothing, everything it
declares:

```ts
// Exports parseCsv only.
export function parseCsv(text: string) { /* … */ }
function quoteAware(line: string) { /* … */ }
```

```ts
// No `export` anywhere: exports both.
function parseCsv(text: string) { /* … */ }
function toRows(text: string) { /* … */ }
```

The forgiving arm exists because a file that declares three functions and exports none is a
file whose author meant all three; refusing it, or binding an empty object, would be a rule
that only ever catches someone out. Type-only declarations (`interface`, `type`,
`export type { … }`) export nothing, because they do not exist at run time. A renaming
export (`export { rows as toRows }`) is offered under the name it was exported as.

**What is refused**, with a located diagnostic in the same voice a program's errors use:
`import` in any form, `export … from`, `export *`, `export default`, a dynamic `import()`,
and top-level `await`. That is TypeScript's list, and the two facts behind it are the
sandbox's rather than the language's, so they hold in any of them: there is no module loader
to resolve a specifier against and no event
loop to await on — a module is `lib.<key>`, not a package — and `export default` has no name
for a namespace to offer it under. The size and nesting ceilings that
[bound a program](#the-limits) bound a module identically: the source is untrusted whoever
wrote it.

### A module may call gg functions

A module is evaluated as the body of a function whose parameters are the scope's object
names — the **same scope the program gets** — so it may call `fs.readFile`, `system.shell`
or anything else the run offers, and a helper can be a whole procedure rather than a pure
function.

What it may **not** see is another module. Modules are evaluated in order, each against the
scope rather than against the `lib` being built, because a module that could reach its
neighbours would make the load order part of the contract — and the load order is whatever
order the agent happened to read things in.

### A module that throws does not take the program down

Its author is whoever wrote the skill or the memory, not the model whose program merely has
it in scope, so a throw while loading is not a program error. gg leaves `lib.<key>` as an
empty object, lets the program run, and reports the failure as a **module error** naming the
binding key and the message — never the source, which the model is not shown. A program that
then calls into it gets an ordinary, located `TypeError` naming the member it wanted, and an
agent that found `lib.x` empty is told why rather than left to guess.

The same channel carries an [on-use script](/gg/skills/#an-on-use-script-that-runs-once)
that failed, for the same reason: one sentence naming the skill or memory, and the turn's
own outcome untouched.

## How a turn runs

```text
the model's whole reply
   └─ heal it (deletion only; it never refuses a reply)
        └─ prepare it for this language's guest
             (TypeScript: the oxc type-strip in process, ~0.2 ms, then the `tsc`
              type check in a `node` subprocess, ~90 ms; size and nesting bounded first)
             └─ instantiate this language's compiled component  (24–124 µs)
                  └─ run the program against exactly this run's tools
                       │  fs.readFile("a.ts", { limit: 200 })
                       └─ typed WIT call → host → gg's tool registry → the agent loop
                            (gated, routed, streamed as ToolCall/ToolResult, recorded)
                       │  view.openText("summary", …)
                       └─ typed WIT call → host → this agent's live context window
   ← one message per open view, into the next prompt
   ← the error, if there was one, and nothing else
```

Everything above the tool registry is new; everything below it is the same code an
ordinary tool-calling turn runs through, which is what preserves the loop's gating,
delegation, telemetry and capture behaviour unchanged.

The sandbox is synchronous and CPU-bound, so it runs on a blocking thread while each
call it makes is serviced **on the async loop** over a channel. That is not an
optimisation: a program's `spawnSubagent` still goes through the
[scheduler](/gg/subagents/), a `waitForSubagents` still blocks on its
delegated children, and a `context.evictFileView` is still
applied against the live window and told what it really freed. The
[`view` calls](#showing-yourself-things) are the one thing on that path that reaches no
tool at all: they are applied to the agent's **own** window, and applied *immediately*,
so a program that opens a view and later closes it in the same turn leaves nothing behind.

### Why TypeScript's guest is a componentized JavaScript engine

Every language faces this question, and it is the language's to answer — what evaluates the
prepared source is one of the things [a language supplies](/gg/program-languages/#what-a-language-supplies).
This is TypeScript's answer.

A model cannot emit wasm, so something has to interpret its program. The cheap answer is
to write that interpreter — a small language, a lexer, a parser, a tree-walker, compiled
to wasm. gg tried that first, and it was wrong twice over: it made gg's model-facing
surface a dialect nothing was trained on, and with no type system to declare tools in it
forced every tool through one untyped door.

Componentizing a real JavaScript engine instead means the model writes the language it
already knows, and the trust boundary becomes the typed WIT membrane above rather than a
hand-rolled ABI. The cost is a **~13 MB component** — it embeds a whole JavaScript engine
— and the discipline needed to compile it only once.

### The latency design

The non-negotiable property is that a turn never pays for the **component** compile. The wasm
`Engine` is process-wide, and each registered language's compiled `Component` lives behind a
`OnceLock` of its own, so a language's artifact is compiled **at most once per process** and every
program thereafter pays instantiate plus invoke and nothing else. A run that never drives an
agent in a given language never compiles that language's component at all. `componentize-js`
never runs on the turn path, and nothing about the component is cached to disk.

What a turn *does* pay is its own language's [prepare step](#stripped-and-checked), and for
TypeScript that is now a real cost rather than a rounding error: the strip is in-process, but
the check spawns `node` against the committed `tsc`. It is measured for exactly that reason and
reported per turn as [`compileMs`](/gg/telemetry/).

| Stage | Measured |
| --- | --- |
| Prepare, pass 1 — TypeScript's `oxc` type-strip, in process | ~0.2 ms |
| Prepare, pass 2 — TypeScript's `tsc` type check, in a `node` subprocess | ~90 ms |
| Compile the component — **once per process, per language** | 658 ms (18 cores), 1.29 s (4), 2.36 s (2), 4.84 s (1) |
| Instantiate a store from the compiled component | 24–124 µs |
| Evaluate an ordinary program (excluding its tool calls) | 0.7–3 ms |

Even that single compile is kept off the critical path: when the capability is on, gg
fires a warm-up compile once at session start, concurrently with the first model
request, which takes far longer. It never fires from a subagent, and the `OnceLock`
makes a second call free. A run **without** the capability compiles nothing at all.

The component is deliberately never cached to disk. gg runs one process per run inside
an ephemeral container, so such a cache would be written once and thrown away with the
container — while the wasmtime `cache` feature would drag `zstd`'s C compile onto a
binary that is release-built for three platforms and statically linked against musl. The
type checker's `NODE_COMPILE_CACHE` is not a counter-example: it caches nothing about the
*program*, only Node's bytecode for the 6.2 MB compiler that reads it, it is re-earned in
the first check of every run, and a Node that ignores it or a directory it cannot write to
costs time and changes no verdict.

The "compiled once" property is asserted by a **counter**, not a stopwatch: a static
compile count is checked to be exactly 1 after two component fetches and after two
program runs, so the guarantee is verified rather than inferred on a shared machine.

## The limits

A program runs under a wall-clock **execution timeout** and a **linear-memory** cap, both
per-store, which is exactly what lets the whole process share one compiled component
while each run keeps its own ceilings.

| Limit | Default | What it bounds |
| --- | --- | --- |
| `timeoutSecs` | 30 s | Guest-CPU time for **one program** — the guest's own setup, the program, and every value crossing the membrane — re-armed for each turn. Time parked in a bridged tool call is excluded. |
| `maxMemoryBytes` | 256 MiB | Guest linear memory. A `memory.grow` past it is denied. |

The timeout is a **pure infinite-loop guard, not a work ration**. It exists only to stop
a program that does not terminate, and it is set far longer than any honest program's
execution needs, so it is never reached outside a runaway. It replaced a wasmtime *fuel*
budget the sandbox used to meter: fuel was exact but its cost model was invisible to the
model writing the program — lowering a string *out* of the guest cost about 300× lifting
one in, so a program that merely wrote a few large files could exhaust a fuel ceiling that
a runaway loop would take seconds to reach. A wall-clock timeout removes that failure mode
by construction: writing a lot is fast, so only a program that loops forever runs long.

| Workload | Guest CPU |
| --- | --- |
| `console.log(40 + 2);` (the guest's own floor) | << 1 ms |
| A realistic orchestration program (list → filter → shell → write → log) | a few ms |
| Rewriting twenty 64 KiB files — the heaviest *honest* program measured | ≈1.8 s |
| A runaway `while (true) {}` | runs at wall-clock speed until the timeout stops it |

So the default 30 s gives even the heaviest honest program more than an order of magnitude
of headroom while stopping a `while (true) {}` in about half a minute. 256 MiB is about 25×
the 10.3 MiB the guest engine occupies at rest.

:::note
**The timeout measures the guest's *own* execution, not raw wall clock.** Time a program
spends parked in a bridged tool call — a `shell` build that takes minutes — is excluded, so
waiting on a build is never mistaken for a runaway. wasmtime **epoch interruption** enforces
this: a background ticker advances the engine's epoch, the store arms a deadline against it,
and when the deadline is reached a callback re-arms it for however much guest budget is left
after subtracting the time spent in host calls, trapping only when the guest's own clock is
genuinely spent.
:::

Two further bounds are not configurable, because each protects gg itself rather than
rationing a run:

- **A TypeScript program nests brackets at most 200 deep.** This one belongs to the
  language rather than to the sandbox — it is what TypeScript's preparation step has to
  spend to make untrusted text safe to parse. The parser is recursive
  descent with no depth guard, and a stack overflow is not a catchable panic — it would
  take the whole gg process down over one degenerate response. A model that repeats a
  bracket in a generation loop produces exactly that shape, so that one shape is bounded
  before the parse. **Nothing bounds a program's *length*:** a response is processed in
  full however long it is, and the parse runs on a stack sized *for that program* —
  4 KiB per byte of source, never under 256 MiB, against the ~1.2 KiB per source byte the
  hungriest measured shape actually consumes. A thread's stack is reserved rather than
  committed, so the pages a parse never touches cost nothing and sizing generously per
  program is free.
- **A `shell` timeout is clamped to what is left of the run's wall-clock budget.** A
  host function cannot trap, so one `shell("sleep 3600")` would otherwise carry the run
  past its deadline with no mechanism left to stop it.

The execution timeout meters only the guest. A program that spends ten minutes waiting on
`shell` builds is not stopped by it; what bounds *that* is the run's wall-clock deadline,
which the membrane checks **before every bridged call**. Once the budget is
spent, every further call is refused with a `limit-exceeded` failure saying that
everything the program already did stands — a refusal rather than a kill, so the program
stops cleanly and the turn still reports what it accomplished. `finish` is the exception:
it performs no work and ends the run, which is exactly what a spent budget wants, so it is
never refused for one. `view.openText`, `view.openDocsView`, `view.close` and `view.current`
are carved out for
the same reason — they dispatch nothing, and a turn that cannot say what it found is worse
than one that says it late. `view.openFile` **is** refused, because it reads.

## Capability gating

A withheld tool is **not in scope**. The guest builds the program's scope from the run's
enabled tool names and evaluates the program as the body of a function whose *parameters*
are exactly those names, so a tool this run does not offer is an undefined identifier —
not a call that travels to the host and is refused there.

**The host checks the same facts.** Scope injection is a capability model only for a guest
that builds a scope, and that is a property of the language's SDK rather than of gg: a
language whose SDK is linked as an ordinary library has every name, and there is no scope
to leave anything out of. So the membrane holds the whole of what a run offers — the
enabled tool names, the [ending group](/gg/ending-a-session/) this agent's role declares,
and whether it keeps a [program library](/gg/program-library/) — and refuses anything
outside it as `unavailable`, which is the same failure class, and the same recovery, a
missing name produces. For today's TypeScript arm that check is unreachable; for the next
arm it is the whole of the gate.

`unavailable` is therefore recorded as the same turn error a missing name is
(`program_unknown_name`), and the host decides that from the failure **code** rather than
from what the guest made of the throw. Otherwise one event — the model reaching for
something it was not given — would be counted one way in a language that can withhold a
name and another way in a language that cannot, which is precisely the confound a
cross-language comparison cannot carry.

The same set drives the prompt, so a withheld capability contributes **no prompt text**:
a run without the [tasks](/gg/tasks/) capability is not shown the task functions and is
not shown the `TaskUsage` type either. That is the property
[toolset ablation](/gg/toolset-ablation/) depends on — the toolset and its description
come from one source and cannot disagree.

It extends to the section's **prose**, not just its listing. The line teaching
`view.openFile` renders only for a run that binds `read_file`, the line teaching
`system.shell` only for one that offers `shell`, and the documentation lookup the prompt
demonstrates is spelled `view.openDocsView(view.openText)` — against the one view function
nothing gates. A call named in a prompt is the part of it a model copies verbatim, so
naming an ungated one would hand a reduced-toolset run a `ReferenceError` on its first
turn. The gate is drawn at the finest grain the fact has: the `openFile` line's *second
half*, the `{ offset, limit }` window, renders only under a
[capped read mode](/gg/filesystem/#read-modes), because `unlimited`'s `read_file` takes no
such arguments and teaching a knob that does nothing is its own kind of lie.

The [filesystem capabilities](/gg/filesystem/) compose the same way: a run with
`read-file` off has no `fs.readFile`, no `fs.readTextFile` and no `view.openFile`, and a
capped read mode windows a program's reads exactly as it windows a tool call's.

:::note
**The `view` object is the one family no capability gates at all.** A run that enables no
tools must still be able to show its model something, so `view.openText`,
`view.openDocsView`, `view.close` and `view.current` are bound whatever the capability set
says, and nothing on the host refuses them. (`view.openFile` is the exception inside the
exception: it is a read, so it is bound only when `read_file` is, and it is refused like
any other read.)

**An ending call is bound to every run too, but which one depends on the role.** A run that
enables no tools must still be able to *end*, so the group its role declares is bound
whatever the capability set says, and no toolset gate and no spent budget withholds it — a
program can end the run even while the loop is waiting for a compaction, which is
deliberate, since a run that cannot end is worse than one that ends early. What the host
does check is the role: an agent doing work calling `review.approve` is refused
`unavailable`, because a verdict is the one declaration nothing downstream re-examines.
:::

### Every tool is bound

There is **no** class of gg tool a program is denied: the toolset a program's scope is
built from is exactly the toolset a tool-calling session of the same run would be
offered. gg once withheld three *turn-level transitions* — `enter_plan_mode`,
`submit_plan` and `advance_state`, which changed the loop's mode rather than producing a
value a program could compose — but those tools no longer exist, and nothing has replaced
them.

The calls that come closest are the three that change *which agent is running*, and none
of them is withheld either — they are **deferred**, the shape `context.compact` already
has. `agents.exec(agent, prompt?)` and `agents.transitionState(state, note?)` register the
handoff, return, and let the program run to its end; the loop applies it once the turn
closes, because replacing the window a running program is composing into would pull every
remaining statement out from under it. `agents.fork(prompt)` returns the copy's id
immediately — the id is real — but the copy itself is dispatched when the turn closes, so
it cannot be waited on until the next one. A turn makes at most one succession, so a second
`exec` (or an `exec` after a `transitionState`) throws a `refused` `ToolError` that a
program can catch; forks are additive and a turn may declare as many as it likes.

## A tool failure throws

Under tool calling, a failed tool returns its failure **into** the conversation as a
value. Inside a program, a failed tool **throws** a typed `ToolError` carrying `.tool`,
`.code` and `.message`, and an uncaught throw ends the program at that statement.

`.tool` is worth reading precisely: it names **the function the program called**, and no
longer implies that a tool ran and failed. The guest re-tags a binding-level `TypeError` as a
`ToolError` on the call it came out of, so `tasks.addTask({ title: "x" })` — an `addTask`
with no `id`, refused by the generated lowering code before anything reached a tool — is
reported as `` `addTask` failed (invalid-argument) `` with the bindings' own complaint after
it. That is the honest attribution rather than a widened one. The field always answered the
question a model actually asks (*which of my calls was this about?*), and the alternative was
worse in both directions: a fault that named no call at all, or a second failure vocabulary
for the class of mistakes a model makes most.

The inversion — a failure that throws rather than one that comes back as a value — is
deliberate, and it is why composition works at all. A surface where every call returns
`{ ok, output }` forces a branch after every line, and the worked
example at the top of this page becomes unwritable. Three things keep it honest:

1. **The throw is catchable and typed.** `catch (e) { if (e.code === "conflict") … }` is
   the shape a function's [documentation](#reading-the-documentation-is-opening-a-view)
   teaches — `fs.editFile`'s names that very code — and
   `ToolError` is bound into the program's scope so `e instanceof ToolError` works. It
   also serialises: a plain `Error`'s `message` is non-enumerable, so without an explicit
   `toJSON` a failure a program logged — or put in a [view](#showing-yourself-things) —
   would arrive as `{}`.

   That `toJSON` was only ever half the answer, and the other half is a **realm** check.
   The generated component bindings are evaluated against a *different* `Error` intrinsic
   than the SDK and the model's program see, so the `TypeError` a mistyped argument raises
   answers `false` to `instanceof Error` — it fell past every branch that reads `.name` and
   `.message`, reached the fallback that stringifies a thrown value, and an `Error`'s own
   fields are non-enumerable, so what the model received was the literal string `{}`: a
   runtime error carrying no information at all, for the single most common mistake anyone
   makes against this API. Every classifier in the guest — what gets logged, what gets
   re-tagged, what gets reported — therefore asks `Object.prototype.toString` for the brand
   instead, which reads the internal slot every `Error` carries whatever intrinsic
   constructed it. `instanceof` was never the question being asked; *is this thing an
   error* was.
2. **The work before it stands.** Every call the program landed before the throw has
   landed for good, and what the model is told is which statement threw, on which line of
   *its own* program — the guest remaps the line out of the interpreter's coordinates. That
   the earlier work stands is a standing rule stated in the
   [system prompt](/gg/prompts/) — *whatever the program did before it threw stands, so do
   not repeat that work* — rather than a list of landed calls appended to the throw. A
   [`Runtime error`](#the-three-things-gg-says) carries the error and nothing else.
3. **`shell` is carved out.** A non-zero exit is a **value**, not a throw: a process that
   ran is a successful call whatever it exited with, and `shell("npm test")` has to be
   usable inside an expression. The program reads the exit code and branches on it; nothing
   about it reaches the model except through whatever the program chooses to show itself.

## Showing yourself things

A program's calls happen *inside* the turn and their results are values in a variable.
Nothing a program computes reaches the model on its own: a returned value is discarded, and
`console.log` goes to the operator. What a model wants to **see** on its next turn it opens
a **view** of, and gg pushes **one message per open view** into that next prompt — the exact
counterpart of one tool result per tool call.

A view is a piece of material an agent has declared should be visible to it. Each agent owns
its own set of open views; each view has a **kind**, a **selector** (its key), and a body.

| Function | What it does |
| --- | --- |
| `view.openFile(path, options?)` | Reads the file **and** opens a view of it. Returns exactly what `fs.readFile` returns, so a program that wants both the bytes and the view pays for one read. |
| `view.openText(label, body)` | Opens — or replaces — the text view keyed by `label`. |
| `view.openDocsView(fn \| "name")` | Opens — or replaces — the [documentation view](#reading-the-documentation-is-opening-a-view) for one bound function, keyed by its name. Returns `void`: the documentation is material for the window, not a value for the program. An argument that is neither a bound function nor a name is `invalid-argument` in the guest, before the lookup, so a name this run does not bind is never quoted back as `undefined`. An unbound name is `not-found`, carrying the bound names nearest it (`Did you mean \`writeFile\`?`) when there are any. |
| `view.close(selector)` | Closes every view carrying that selector (for a file, every page of that path) and returns how many it closed. Closing something that is not open is `0`, not a failure. |
| `view.current()` | Lists what is open: each view's `kind`, `selector`, roughly what it costs in `tokens`, and a paged file view's `region`. |

It is `current` and not `list` because every API object already carries a `list()` that
lists that object's **own functions**, and one name cannot mean both.

The object is bound whatever a run enables — the same carve-out `harness.finish` has, and
for the same reason: a run that offers no tools at all must still be able to show its model
something. `view.openFile` alone is gated, on `read_file`, because it is a read.

### Three kinds of view

| Kind | Selector (its key) | [Band](/gg/context-visibility/) | Body |
| --- | --- | --- | --- |
| **file** | `(path, region)` | `File views` | what the read returned, plus any picture |
| **text** | `label` | `Agent views` | the string the program supplied |
| **docs** | the function's name | `Skills & docs` | one function's signature, documentation and types |

The second band answers to two names on purpose, one per audience: the console calls it
**Agent views**, beside File views, because that is what it is from outside; the agent's own
[context-usage signal](/gg/agent-managed-context/#the-context-usage-signal) calls it
**Text Views**, because `view.openText` is the call the model wrote to fill it.

Everything on disk is a file; everything a program can compute is a string. A directory
listing, a `shell` result, a subagent's answer, a computed diff, a table the program
assembled — every one of those is a **text view**. That pair is still closed, and for the
reason it always was: a *fourth* kind of thing a program could compute would hand the model a
classification question to answer before it could show gg anything, in exchange for a
distinction nothing downstream reads.

The **docs** kind does not reopen that question, because the model never chooses it. It is
not a shape material might have; it is what
[`view.openDocsView`](#reading-the-documentation-is-opening-a-view) produces and the only
thing it produces, and nothing a program computes could be one. gg picks the kind from the
call, so the model's classification burden is exactly what it was: none. What the kind buys
is on the other side of the membrane — `view.current()` can say *this slot is documentation,
not your work*, and the accounting can charge it to the band that already holds authored
material rather than to the band that holds the agent's own.

That band is shared with read [skills](/gg/skills/), which is why it answers to
**Skills & docs** in the console. The two are told apart by **retention**, not by source: a
read skill is pinned and unlabelled, so it survives a compaction and `view.current()` does
not list it (offering a close that would reclaim nothing is worse than offering none); a docs
view is ephemeral and labelled with the function it documents, so it lists, supersedes and
closes like every other view. `view.close` therefore reaches a docs view and cannot reach the
skill beside it.

The file-view key is `(path, region)` and not `path`, because
`view.openFile("a.ts", { offset: 1, limit: 200 })` and the same call at `offset: 201` are a
program **paging** through a file, not a program changing its mind: two views that coexist.
A whole-file read has no region, so it is its own key and re-reading it replaces itself.
`view.close("a.ts")` — like [`evict_file_view { path }`](/gg/agent-managed-context/) — works
on the **path**, and closes every page of it.

**Images are not a third kind.** An image is a file view *of an image file*: the view item
carries the picture, with the same magic-number detection, the same 8 MiB ceiling and the
same [vision-recovery](/gg/filesystem/#models-that-cannot-see-images) behaviour the
[native read](/gg/filesystem/#reading-images) has. A view is therefore the **only** way a
picture reaches a code agent's window — see [the caps](#the-caps-and-why-none-of-them-truncates)
for the one number that bounds how many may be open at once.

### `fs.readFile` gets bytes; `view.openFile` shows a file

The separation is the point, and it is taught where the model meets the call: in those
words, as the second sentence of what
[`view.openDocsView(view.openFile)`](#reading-the-documentation-is-opening-a-view) opens. It
used to be a line in the system prompt as well and
is not any more — the prompt names the two calls and leaves what separates them to the
documentation the model asks for, so the fact arrives attached to the function it is about
rather than screens away from it. Since documentation is now a view, that sentence lands on
the turn *after* the model asks for it, which is why the split is also stated by
`fs.readFile`'s own result — see below — where it arrives at the moment it matters.

A program that reads forty files to grep them puts **nothing** in the window: it consumed
those reads itself. A program that opens a view of one of them has put one file in the
window, charged to its path, closable by its path, and countable against it.

That is literal for pictures too, and it is the part worth stating twice, because a
*description* of a mockup and a *sight* of it read almost the same in a program's output. A
bare `fs.readFile` of a `.png` succeeds and hands the program its descriptor — label,
format, byte size — and shows the model nothing: the result carries `shown: false` and says
so in as many words (*`fs.readFile` reads and describes an image but does not show it to
you; open a view of it with `view.openFile(path)` to actually look at it*). It used to be
otherwise — a bare read attached up to four pictures to the turn's feedback, on a budget of
its own, so one turn that both read a mockup and opened a view of it could put eight
pictures in the window through two different doors, neither of which could see the other.
One channel collapses that by construction rather than by reconciling two counters.

### Re-opening a selector replaces what was under it

Re-opening the same selector — the same label, or the same file and page — **supersedes**
the view that was there. This is a deliberate divergence from the native tool-calling path,
where each `read_file` appends its own view and nothing rewrites it, and the reason is what
the two calls *name*:

- `read_file` names an **action**. It happened, it returned what the file said at that
  moment, and the honest record of the thread is that the agent saw exactly that.
- `view.openFile` / `view.openText` name an **intent** — *this should be visible to me* —
  and re-stating an intent replaces it rather than repeating it. A program that loops over
  changed files and re-opens each one must not pile up a duplicate per turn, or the precise
  accounting this whole mechanism exists to deliver would be worse than the blob it
  replaced.

Superseding still obeys the [append-only](/gg/context-visibility/) rule, with one refinement:
a copy pushed on an **earlier** turn has already been sent and cached, so it is left where it
sits, retagged as ordinary history with its selector cleared, and the new copy is appended at
the tail. A copy pushed in **this** turn — the same program opened it a moment ago and
nothing has been sent — is replaced **in place**, because there is no cached prefix to protect
and a program refining a view in a loop should not leave a corpse per iteration. A view opened
and then closed within one program reaches the window not at all.

A retired copy keeps its **text** — it has already been sent and paid for, and rewriting it
would invalidate the cached prefix that leaving it in place exists to protect. Its **picture**
is the one thing that does not stay: an image is re-uploaded whole on every subsequent request
for as long as it is resident, so twenty re-opens of one screenshot would leave twenty copies
of it in the window, none of them a view anyone could close. The retired copy is stripped of
its image and gains a line saying so and pointing at the live view below it, and its token
estimate follows the bytes rather than remembering them.

The native `read_file` path is unchanged. Only the view API supersedes.

### The caps, and why none of them truncates

Over a cap is a catchable `ToolError` with code `limit-exceeded` **naming the cap**, thrown at
the call site — so the program can split the body, trim it, or write it to a file and open a
file view of that instead, in the same turn, before it has finished running. Silently
truncating a model's only output channel behind its back is the failure mode this mechanism
exists to remove; telling it a turn later, when the material is gone and the program that had
it has ended, is the second-worst version of the same thing.

| Cap | Value | Applies to |
| --- | --- | --- |
| `MAX_TEXT_VIEW_BYTES` | 65,536 (64 KiB) | one `openText` body |
| `MAX_VIEW_LABEL_BYTES` | 200 | one `openText` label |
| `MAX_OPEN_TEXT_VIEWS` | 50 | text views open at once, per agent |
| `MAX_VIEW_OPS_PER_PROGRAM` | 100 | `openFile` + `openText` + `openDocsView` + `close` calls in one program |
| [`imageViewCap`](#configuring-it) | unset (no ceiling), per agent | image-carrying **file** views open at once |

An **empty label** is `invalid-argument`: a view with no selector could never be closed,
superseded or attributed. So is an empty selector handed to `close` — a blank string is not a
name that happens to match nothing, it is a bug, and answering it with a cheerful `0` would
hide one. So, one layer earlier, is an
[`openDocsView` argument](#reading-the-documentation-is-opening-a-view) that is neither a
function nor a name. An empty **body** is allowed, because it is how a program says that
something it was showing is now empty, and refusing it would make that unexpressible.

The last one is the only cap here that counts **occupancy** rather than events, and it has
to. A picture is not sent once: it is re-sent whole on every request for as long as the view
carrying it is open, so what costs the run is how many are *resident*, not how many were
opened this turn. A per-turn budget would bound nothing that matters — four a turn is
forty over ten turns, all of them still in the window. `imageViewCap` is therefore read off
the live window at the moment `view.openFile` is about to attach a picture: there is no
counter to reset, nothing that can drift from what the window actually holds, and
`view.close(path)` frees a slot for the next mockup immediately. Superseding is what keeps
open and resident the same number: [re-opening a picture](#re-opening-a-selector-replaces-what-was-under-it)
takes the image out of the copy it retires, so an agent that re-renders and re-opens one
screenshot every turn holds exactly one picture, not one per turn.

Over it **refuses**, like every other cap on this page. `view.openFile` throws
`limit-exceeded` naming the cap and the remedy — close one with `view.close(path)`,
`view.current()` lists what is open — **no view is opened and nothing is charged to the
window**. The program learns at the call site, in a form it can branch on, instead of
discovering afterwards that its window holds a view announcing a picture that is not in it.
That last failure mode is gone by construction: there is no half-opened view left to
describe an image the model was never shown.

Three things sit outside the cap, deliberately:

- A **text** view is never refused by it, however full the pictures are. The two are
  different resources and the model should not have to close a mockup to show itself a
  string.
- **Re-opening a path that is already an open image view** is a supersede, not a new
  occupant, so it is admitted at exactly the ceiling. Refusing an agent's re-read of a file
  it is *already* looking at would be a cap punishing the case it exists to bound.
- A **pinned** [autoloaded specification](/gg/autoload-specifications/) image occupies
  nothing. It is the operator's choice rather than the agent's, the agent cannot close it,
  and counting it would let a configuration that pins four mockups make the cap permanently
  unreachable — an agent refused its first `view.openFile` of the session, with no remedy it
  could act on.

**Native tool calling stays uncapped, on purpose.** A native `read_file` of an image pushes
its file view with no budget at all, and that did not change. Introducing a cap there to fix
a defect in the code arm would move the **control** arm of the A/B this whole capability
exists to measure, which is worse than an asymmetry — so the asymmetry is documented rather
than closed.

### Nothing reports on the views a program opened

gg used to answer every program with a list of what it had done to its own window — *opened
text view `specs-missing-rules` (~412 tokens)*, *replaced file view `src/main.rs`*, *closed
view `scratch`*, *view refused: that body is 91,204 bytes…*. That list is gone from the
model's side of the membrane, and its absence is the point: **the views are the report**. A
model that opened a view reads the view on its next turn, headed and labelled; being told
separately that it opened it is being told something it is looking at. A refusal is not on
that list either, because a refused view [throws](#the-caps-and-why-none-of-them-truncates)
at the call site, into the program, in a form it can branch on — which is strictly earlier
and strictly more useful than a line in a report the model reads a turn later.

What the list was genuinely good for was *diagnosis by a human*, and that is where it went:
every open, replace, close and refusal is logged to the run's
[operator](#what-the-operator-is-told-instead), with its selector and its token estimate.

### A reversal: `console.log` was the channel, and is not any more

This page previously documented `console.*` as the **only** channel a program had for showing
gg a value, and the section below as *"a code turn is charged to the window as one ephemeral
tool-output message"* with *"a program's `readFile` does **not** push a file view"* stated as
the design's whole point. Both are recorded here rather than quietly overwritten, because the
argument that was overturned was a reasonable one.

**What it used to say.** Reads are consumed *inside* the program instead of being poured into
the context; a program that reads forty files should not put forty files in the window; so a
program's output — everything it logged, its call roster, its refusals — arrived as one
ephemeral message and nothing else. Pictures were carved out as the one thing the model had to
see with its own eyes.

**What changed the answer.** That one message is an *unattributable blob*. Under tool calling
everything entering the window is a discrete message carrying the band it is charged to and,
for a read, the path as its selector — which is what lets gg say which file cost how many
tokens, [evict one view by path](/gg/agent-managed-context/), carry the open set across an
[agent-persistence](/gg/agent-persistence/) succession, and re-seed named files after a
[compaction](/gg/compaction/). A program that did

```ts
console.log(fs.readTextFile("specs/rules.md"));
console.log(JSON.stringify(summary));
```

had just put a file and a computed summary into the window as one anonymous lump: charged to
`tool_output`, carrying no label, evictable only by evicting the whole turn's report,
invisible to per-file attribution, not persisted, and not re-seeded after a compaction. A
persistent code-mode profile consequently recorded and restored **nothing** — the capability
was inert in the mode that most needed it.

**Answering the old objection.** The objection to removing logs was that a program needs
*somewhere* to put a value, and that the one-message arrangement is what keeps forty reads out
of the window. Neither survives. A view is somewhere to put a value that is strictly better
than a log line — it is attributable, closable, persisted and countable — and the forty reads
still stay out, because `fs.readFile` still does not open a view. What changed is that a
program now says *which* of its material is worth carrying, one item at a time, instead of gg
guessing "all of it" or "none of it". Logs did not stop being captured; they stopped being the
model's business. They still reach [telemetry](/gg/telemetry/), the operator's stream, the
[session record](/gg/session-record/) and the console — nothing an operator or an analysis could
previously see is lost.

There is deliberately **no configuration toggle** for the old behaviour. The two arrangements
disagree about what a context message *is*, and a param that forked the context model would
fork the accounting, the attribution, the persistence and the compaction behaviour along with
it.

## The three things gg says

Under this protocol every assistant turn is a program and everything gg says back is plain
`user` text, so the [heading](/gg/prompts/) is the only thing telling the model what it is
looking at. The vocabulary is therefore deliberately tiny — **three messages, and no
fourth**:

| Heading | When | Body |
| --- | --- | --- |
| `Compiler error` | the program did not compile, so none of it ran | the compiler's error, and nothing else |
| `Runtime error` | it compiled and then threw, or a sandbox limit stopped it | the error, and nothing else |
| `Notice` | a fact about the *session* rather than about the program | the fact |

A `Runtime error` from a program that threw is the throw, formatted the way a stack trace is
formatted, because that is what it is:

```text
`edit_file` failed (conflict): `oldString` matched 3 times in src/main.rs
    at line 12, column 5
```

One frame — the model's own. Every other frame belongs to the interpreter shim or to the SDK,
and none of them reaches the model: the guest finds the program's frame by matching it
**positively** (only frames inside the constructed function carry the marker it looks for)
rather than by filtering gg's out, so there is no denylist to fall behind the internals it
names. A model cannot act on gg's internals, and a trace full of them is a trace it has to
read past to find the one line it can.

`Notice` is the `System` band, and it is where the small population of things gg genuinely has
to say lives: an ending an [agent-stop hook](/gg/hooks/#agent-stop) rejected; the results of a deferred `wait_for_issue`;
[statements after a top-level `return`](#statements-that-cannot-run) that could not run; and
the one notice a *working* program can earn, [below](#a-program-that-worked-earns-no-message).
When a turn produces both a notice and an error, the notices come first and the error last —
so the error is the last thing the model reads before it writes its next program, and so a
notice can never be mistaken for part of the diagnostic above it.

### An error message carries the error alone

That is the rule the whole design reduces to. No preamble, no *"your program stopped"*, no
advice, no roster of what the program called, no restatement of the rules it broke.

The argument for it is that everything gg might have added is already somewhere better. A
failed call **throws into the program** — the program has the code, the message and the tool
name, at the statement that made the call, in time to catch it. A refused view **throws into
the program**, at the call site, naming the cap. Everything left over is a *standing rule* —
that a program which throws does not end the session; that whatever it did before the throw
stands; that a returned value is discarded; that `console.log` is not a channel — and a
standing rule belongs in the [system prompt](/gg/prompts/), where it is stated once, rather
than on every turn that trips over it. Stating it on the failing turn is the arrangement that
looks most helpful and reads worst: it puts gg's prose between the model and the diagnostic,
so the model has to parse gg out before it can read its own error, and it spends the tokens
again on every retry.

The inverse rule holds too, and bounds the restraint: gg may **remove** from an error — a
stack trace whose frames are its own internals — but never **adds** to one.

There is one carve-out, and it is narrower than it looks: the layer that *raises* a fault may
compose into it the answer to the question that fault provokes, because at that point the
answer is part of the diagnostic rather than commentary on it. A `ReferenceError` provokes
*what do I have?*, so the guest names the API objects this run bound — the model would
otherwise have to spend a turn asking. That is composed **in the guest, at the call site**,
by the code that knows what went wrong; it is not gg reading a finished error and deciding to
be helpful about it a turn later, which is the thing this rule forbids.

A failed [documentation lookup](#reading-the-documentation-is-opening-a-view) is the same
carve-out on the host's side of the membrane. *No documentation for `write`* provokes *then what
is it called?*, and the only layer that can answer is the one that just decided the name is
unbound — it is holding this agent's scope, which is what the answer is made of. So the
`not-found` carries the bound names nearest the miss, indented under it. It is still a fact the
fault implies rather than advice about it: gg names names, and says nothing about what to do
with them.

The carve-out covers a *fact* the fault implies, never advice about what to do with it. Every
message the guest raises is one clause and is made of facts — the offending value, the
argument's name, the cap, the path, the expected type — because the fault class is already in
the rendered line (`` `openDocsView` failed (invalid-argument): … ``) and a model acts on the
value it got wrong, not on a sentence explaining why the rule exists.

There used to be a fourth message, headed `Output`, and its absence is the clearest statement
of the change. It reported what a program had done: the roster of its composed calls, how many
lines it logged, the views it opened and closed, whether it returned a value, whether an
ending was revoked. But `console.log` does not reach the model, and a view is the only channel
material has into the window, so `Output` was a heading over an empty idea — a report on
output that was not output, arriving beside the views that already *were* the result.

### A program that worked earns no message

A program that ran and did what it meant to gets **nothing back at all**. The views it opened
are the turn's result, and the system prompt says so in as many words: *when your program
compiles and runs, you are not told so — the views it opened are the result. You hear from the
harness only when something failed or when there is a process fact you could not otherwise
know.*

There is exactly one exception, and it is a mechanical one rather than a judgement about the
program. If the turn would otherwise end on the **assistant's own message** — which is what a
window looks like when a program ran, opened nothing, and gg said nothing — the next request
asks the provider to *continue* that message rather than to answer it, and the model gets back
a continuation of its own program instead of a turn. So gg pushes a `Notice`:

```text
Your program ran and put nothing in your context.

A view is the only way to see anything: `view.openText(label, body)` for a value
you computed, `view.openFile(path)` for a file. `console.log` goes to the run's
operator, not to you.
```

The condition is tested against the **assembled window**, not inferred from the program's
outcome, and that distinction is load-bearing. A program that opened a view can still leave
the window ending on its own message, because [superseding](#re-opening-a-selector-replaces-what-was-under-it)
a view opened earlier in the same turn lands the new copy *in place* rather than at the tail;
and a [compaction](/gg/compaction/) rewrites the window under the turn entirely. Asking the
window what it actually ends with is the only test that survives both.

### A runtime error does not roll back the window

The views a program opened before it threw are **still there on the next turn**. They were
pushed live, as the program ran, against the agent's own context — that is what
[the turn diagram](#how-a-turn-runs) means by the `view` calls reaching no tool at all — so a
throw ten statements later takes nothing back.

This is what makes an error-only message survivable rather than brutal. A program that read
six files, opened views of two of them, and then threw on the seventh leaves its model looking
at those two views and one error. It does not need a report telling it which calls landed,
because the ones whose results it wanted to keep are in front of it, and the standing rule in
the prompt tells it the rest landed too. Rolling the window back to the start of the turn
would be the arrangement that made a roster necessary.

### What the operator is told instead

None of this is lost — it changed audience. `report_to_operator` writes every fact the old
report carried to the run's stream, where it reaches [telemetry](/gg/telemetry/), the run
record, the [session-record](/gg/session-record/) capture and the console's activity feed:

- every call the program refused or had refused, and how many further ones a cap suppressed;
- every view opened, replaced or closed, with its selector and token estimate, and every view
  refusal;
- that the program returned a value, which was discarded;
- that a later ending call replaced an earlier one, and the summary the session ended on;
- that an ending was **revoked** because the program then failed.

Beside them, every call a program made is bracketed on the stream as it happens — an
`api_call` before the work and an `api_result` after it — and that pair is what the console's
activity feed reads a code agent by. It reads it in **the model's own vocabulary**: the feed
says `fs.readFile`, because that is what the program wrote, and the `read_file` gg dispatched
to serve it is folded into the same row rather than repeating one action in the layer below.
The calls **no gg tool backs at all** — `context.list`, a view call, an ending call, a
[program-library](/gg/program-library/) call — appear there for the same reason: they are
things the agent did, and a feed reading only the tool layer showed them as nothing at all,
so an operator watching a live run could not see the agent finish.

Losing the model's copy of these is not losing the record; for most of them the operator's
stream is now the *only* copy, which makes it more load-bearing than it was rather than less.
The trade is deliberate: a human reading a run wants to know what the program did, and a model
writing the next program wants to know what went wrong. They are different questions, and
answering both in one message was what made the report unreadable to both.

## What a code turn costs the context window

A code turn is charged to the window as **one message per view the program opened**, and — on
a turn that failed — one short message carrying the error. There is no per-turn report any
more: a program that ran cleanly and opened one view costs the window that one view and
nothing else.

A program's `fs.readFile` still pushes **no** [file view](/gg/context-visibility/) and no
picture: a program that reads forty files to search them should not put forty files in the
window, and that is still what makes a code turn cheap. The difference is that the model can
now say which of them it wants to keep looking at, with
[`view.openFile`](#showing-yourself-things), one at a time.

Everything a program can produce in a loop is still bounded, and whatever a bound discarded is
still **counted** rather than silently dropped — but every one of these caps now bounds the
[operator's record](#what-the-operator-is-told-instead) rather than the prompt, because that
is where all of it goes:

| What | Cap |
| --- | --- |
| Calls described | 500 (a program can compose far more within its timeout) |
| Refusals described | 100 |
| View operations described | 100 per kind (opened, closed, refused) |
| Failure text kept per entry | 512 bytes |
| Log lines kept | 200, 16 KiB in total, 2 KiB per line — the **last** lines, evicting from the front |

None of them describes anything the model reads. They ride out on the turn's
`code_execution` [telemetry](/gg/telemetry/) event, so what they bound is how much of a runaway
loop's activity is kept for a *reader*, not how much of the prompt it can occupy — and what
each cap discards is counted on that same event (`logsSuppressed` for the log half), so a
capped list never reads as a program that stopped doing anything. What a program puts in the
**prompt** is bounded by [the view caps](#the-caps-and-why-none-of-them-truncates) instead,
and those refuse rather than truncate.

The dispatched-call count reported in [telemetry](/gg/telemetry/) is the described set **plus**
what the cap suppressed, so it always equals the number of `ToolCall`/`ToolResult` pairs
the turn actually streamed. Refusals are counted separately and never inflate it: nothing
was dispatched.

## What a program can and cannot reach

A program runs with the **host's** WASI: the wall clock, the host's randomness, the
container's filesystem, its network sockets and the process's own **environment** are all
there, and gg links them for every guest unconditionally. A model reaching for its
language's ordinary date, random or file APIs is a model using the language it was told to
write in, and an agent with a `shell` tool already has all of it anyway — so withholding the
guest's own runtime would deny nothing and cost a great deal of naturalness.

The environment is inherited because a language runtime needs it to work at all — `HOME`,
`PATH`, `TMPDIR`, the locale — and a guest handed an empty one behaves like a guest on a
broken machine. The honest consequence, and it is an accepted one rather than an oversight:
whatever this process's environment holds, **including the run's model credentials**, is
readable from inside a program. That is the same reach a program has through the preopened
filesystem. It is worth knowing when configuring a run that deliberately withholds `shell`,
because unlike the filesystem and the network — which such a run still reaches through its
language's standard library — [the shell really is
withheld](/gg/toolset-ablation/#one-confound-this-page-cannot-remove-a-code-agents-own-runtime),
while the environment is not.

Two things are still out of reach, and both are named to the model as an ordinary located
program error rather than left to fail silently:

- **the timers** — `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`,
  `requestAnimationFrame` — because gg's guest export is *synchronous*: it is called, it
  returns, and nothing polls afterwards, so a scheduled callback would simply never run.
  Unshadowed, `setTimeout(() => { hit = 1 }, 0)` leaves `hit` at `0` and reports no error
  at all, which is the worst possible answer to the single most common reflex a model
  brings to a new runtime;
- **`fetch`**, because the TypeScript component is baked without an HTTP client. That is a
  fact about *this guest*, not about the sandbox: the host links `wasi:sockets` for every
  guest, so a guest that imported it would have the network;
- **`queueMicrotask`**, which does run but runs *after* the program has ended — outside the
  turn, where a failure inside it would be invisible.

The mechanism is worth knowing because it is where a guest's failures come from. Baking
the component without a WASI capability removes the underlying **import** but leaves the
JavaScript **builtin** defined, so an unshadowed `fetch` reaches a missing import and
**traps the whole store** — uncatchable, unreportable. The guest therefore shadows every
such global with a thrower, so each produces an ordinary, located, catchable program error
naming what is missing and why.

## What can go wrong

Every one of these is a **turn** outcome, not a run outcome, and every one emits its
`code_execution` telemetry event whether it succeeded or not — including a turn whose
reply never compiled, which is what makes that event's count the exact number of
code-shaped turns a run took.

The third column is what reaches the **model**, under one of
[the three headings](#the-three-things-gg-says). Several rows say *nothing*: the program
already knows, because the failure threw into it, and the operator's stream carries the
record.

| What went wrong | Caught by | What the model is told |
| --- | --- | --- |
| The reply is prose, or several code blocks, or anything else that is not valid source in the run's language | preparation — TypeScript's type-strip here; gg itself judges nothing | a `Compiler error` carrying the parser's diagnostics over the reply exactly as sent |
| The program does not parse | preparation, before any engine work | a `Compiler error` carrying every parser diagnostic — each with its line, its column and the offending source line quoted — and nothing else; that none of it ran is what the heading means |
| The program breaks a rule enforced before any statement runs — for TypeScript an **early error**, most often a `const` declared twice, i.e. two programs in one reply | preparation's scope analysis, before any engine work | a `Compiler error`: the identifier, and **both** places it was bound, each with a line, a column and the source line quoted |
| The reply carried statements after a top-level `return` | preparation, from the tree it already built | a `Notice`: how many did not run, which one was first, and that a top-level `return` ends the program — the program itself still runs |
| `import`, `export`, a dynamic `import()`, or a top-level `await` — TypeScript's spelling of "something this sandbox has no implementation of" | preparation, which refuses it | a `Compiler error` saying the sandbox has no module system and is synchronous, and what to write instead |
| The language's compiler read the whole program and **rejected** it — a type error, a name that does not resolve, an argument of the wrong shape. TypeScript's `tsc` pass is what raises it | preparation, before any engine work | a `Compiler error` carrying the compiler's own diagnostics and nothing else. It is the model's to fix and the turn is recorded as `transpile_compile`; it must never be confused with the committed **component** failing to compile, which is an artifact defect that ends the session |
| The language's compiler **could not finish** — it crashed, its timeout killed it, or it is not installed in the run's image | preparation, which reports the compiler rather than the program | a `Notice`: that the program was not run, that this is the environment rather than anything it wrote, and that nothing about it was rejected. **Not** a `Compiler error`, because nothing read the program. The turn is an error, under its own `toolchain` base kind rather than `transpile` |
| A TypeScript program nests brackets past 200 deep | that language's nesting guard, before the parse | a `Compiler error`: its depth, the cap, that the parse runs on a bounded stack, and that this is almost always a repeated bracket |
| An unknown identifier (usually a withheld tool) | the guest | a `Runtime error`: the name, the program line — **and the API objects this run binds**, because the question a `ReferenceError` provokes is *what do I have?*, and the guest composes that into the error rather than gg wrapping prose around it |
| An argument of the wrong shape — a record missing a required field, a number where a string goes | the SDK's validators, or the generated bindings one layer below them | a catchable `invalid-argument` `ToolError` thrown at the call site and, uncaught, a `Runtime error`: **which function** the argument was wrong for, what the bindings said was wrong with it, and the line of the program that made the call. It used to be caught by nothing at all — the bindings' `TypeError` is an `Error` from [another realm](#a-tool-failure-throws), so it fell through to the value branch and arrived as the literal string `{}` |
| A tool threw and was not caught | the guest's single `catch` | a `Runtime error`: which tool failed, its code and message, and the one line of *its own* program it threw on. Not the calls that already landed — those stand, which the [system prompt](/gg/prompts/) says once |
| A tool failed but was caught | the program's own `catch` | nothing. It was handed the typed `ToolError` at the statement that made the call, which is the whole point of the surface; the operator's stream still records the failure |
| A denied global (`setTimeout`, `fetch`, …) | in a checked language, the checker, which declares none of them; otherwise the guest's throwers | a `Compiler error` saying the name cannot be found, or — for a value the checker could not see into — a `Runtime error`: the denied name, why this guest cannot honour it (there is no event loop; this runtime is built without an HTTP client), and the line |
| The program returned a Promise | the guest | a `Runtime error` naming what came back and that the sandbox is synchronous |
| The program `return`ed a value | the guest | nothing. That a returned value is discarded is a standing rule in the system prompt; that this program returned one goes to the operator |
| A view call broke one of [its caps](#the-caps-and-why-none-of-them-truncates) — a body or label over the ceiling, a fifty-first text view, a hundred-and-first view operation, an empty label | the host, which owns the window | a catchable `limit-exceeded` (or `invalid-argument`) thrown at the call site, **naming the cap**, and nothing afterwards: material that never reached the window is refused where the program can still do something about it |
| The program called `finish` and then failed | the host, which revokes the flag | the failure, as a `Runtime error`, and nothing about the revocation — the system prompt states that a program which throws has not finished, and the operator's stream records that this one lost its ending |
| Work deferred with `.then()` ran after the program ended | the guest's call guard | nothing; the note that deferred work is outside the turn and its failures are never reported goes to the operator |
| A tool this run withholds, or a second succession in a turn that already declared one | the host's backstop | a catchable `refused` `ToolError` thrown into the program; **not** counted as a tool call |
| The run's wall-clock budget ran out mid-program | the deadline check before each call | a catchable `limit-exceeded` failure saying the budget is spent and prior work stands |
| Execution timeout reached | the trap classifier | a `Runtime error`: the ceiling, and that a timeout this long almost always means a loop or recursion that never ends — find it rather than write less |
| Memory cap exceeded, or set below the guest's ~10 MiB floor | the memory limiter's denial flag | a `Runtime error`: the configured cap, and the floor the guest engine needs before a program runs at all |
| The committed component fails to compile or instantiate, or gg's own wasm plumbing fails | the engine, or the host | nothing — the **session ends** with a model-error status and a log naming which of the two it was, because every further turn would fail identically |
| A configured [error ceiling](/gg/execution-limits/) was breached | the loop, at the turn boundary | the last turn's message, then the **session ends** `limit_exceeded` with the breach recorded |

Which of these count as an **error turn** follows one definition shared by both execution
modes: a turn is an error when the work it *declared* could not be carried out as
declared — a program that did not compile, one that threw uncaught, one the sandbox
stopped at a ceiling, one whose compiler could not be made to run at all. A failure gg reported *into* a program
that carried on — a caught throw, a refused call, a non-zero `shell` exit, a call refused
because the wall-clock budget is spent — is **not** one: the program handled it, which is
the entire point of the typed surface. How many such turns a run tolerates is a matter of
its [execution ceilings](/gg/execution-limits/); by default a run's turn ceiling is
unbounded (the host caps its wall-clock) and its two error ceilings — 5 consecutive
errors, and an error rate above 0.4 over the last 50 turns — end a run that has stopped
making progress.

## How the sandbox is built and shipped

The TypeScript guest lives at `packages/gg-sandbox/` — the typed SDK, the interpreter
shim, and the build that bakes them into a component with a pinned `componentize-js`. Two
of its outputs are **committed** into the Rust crate, named for the **language** rather
than for the package, because every registered language commits a pair:

| Artifact | What it is |
| --- | --- |
| `crates/gg/src/sandbox/guests/typescript.component.wasm` | The baked component, embedded in the binary (14,004,036 bytes as committed). |
| `crates/gg/src/sandbox/guests/typescript.signatures.json` | The signature catalogue the model reads through `object.list()` and `view.openDocsView()`. |

Committing them follows the precedent the `foray-ref-*` guests already set, and it is
what means **no build or CI step ever needs `componentize-js`**: the host
`include_bytes!`s the component and `include_str!`s the catalogue. (The only Node CI runs
for this package is the `signatures` regeneration in `scripts/ci/contract-drift.sh`, which
needs TypeScript alone and exists to prove the committed catalogue is current.) Refreshing
them is a
deliberate act — run `packages/gg-sandbox/build.sh` after changing the membrane or the
guest, and commit both outputs with the source change. Committing the component
zstd-compressed (~4 MB) was considered and rejected: it would drag a C toolchain onto a
musl-static release binary to shrink an artifact nobody downloads on a budget.

The component is embedded rather than read from disk because gg is copied as a single
file into an ephemeral run container and has to carry everything it needs with it.

Five gates stop the committed artifacts drifting from the code around them: the
`componentize-js` link fails if the guest and the membrane disagree; gg's instantiation
test fails if the committed component's imports no longer match the host's linker; gg's
`bound-tools` test asks the **artifact** which tools it can bind and compares that against
gg's own tool vocabulary, which is the one drift no source-level test can catch; CI
regenerates the signature catalogue and fails on a diff; and the
[agreement gate](#the-agreement-gate) checks the catalogue against every other registered
language's, which is the one drift the first four cannot see because each of them only ever
compares a language to itself.

## The program language

The language a program is written in is not baked into the sandbox. It is a **registered
axis**: gg holds a set of program languages, each of which answers the same questions —
how to prepare a model's reply into something its guest evaluates, which committed guest
and signature catalogue are its own, what its guest needs from the host linker, which
[healing](/gg/response-healing/) questions have language-shaped answers, and which system
prompt teaches it. Four are registered. TypeScript is the default;
[JavaScript](/gg/program-languages/#javascript-the-same-arm-unchecked) is the same surface,
the same guest and the same signatures with the `tsc` pass taken out, so an A/B across that
pair measures what checking a program before it runs is worth;
[Python](/gg/program-languages/#python-a-guest-that-carries-its-own-interpreter) is a
different language rather than a variation on one — its own hand-written SDK, its own guest,
its own healing dialect, and no compiler anywhere on the turn path; and
[Ruby](/gg/program-languages/#ruby-compiled-to-javascript-before-it-crosses) is compiled to
JavaScript by a committed Opal before it crosses, which makes it the arm that separates
*compiled* from *typed*: its programs are read and may be refused before they run, and
their types are never checked at all. This
section is the capability's view of that seam; the design of it — the rules every
language's surface obeys, why each SDK is hand-written, and what adding one costs — is
[its own page](/gg/program-languages/).

This exists so a study can compare **arms that differ only in the language**. The run
record carries the answer as a scalar in two places — `summary.programLanguage` and each
`agent_surface` event's `programLanguage` — so a query slices on it with no new
vocabulary. Both are absent for a tool-calling agent, which has no program language at
all, as against an unknown one. What each arm *paid* to compile is recorded on the same
terms: `compileMs` on every `code_execution` event and `summary.compileMs` on the run,
because the sandbox's clock starts once a program is prepared and a compile would
otherwise be invisible. See
[what compiling costs](/gg/program-languages/#what-compiling-costs-and-where-it-is-recorded).

What a second language may and may not change is the point of the seam. Free to differ:
how a function is spelled (`requestChanges` against `request_changes`), how optional
arguments are passed, how the prompt teaches the language. Not free to differ: **which**
functions exist, which object each is grouped under, and what gates it. Each catalogue
entry that is not a gg tool therefore carries a language-independent `key`; a tool needs
none, because its gg tool name already is one.

### The agreement gate

That rule is not a convention anyone is asked to remember — it is asserted. gg builds, for
every registered language, the **identity** of each function its catalogue describes: the
section it sits in, the object it hangs off, its `key`, the gg tool that gates it, the
ending role that binds it, and whether it belongs to the program library. Every language's
set must be identical, and each language's own must line up with gg's vocabularies: the
tools in exact bijection with the tool registry's, the ending calls exactly the four the
tool-calling arm dispatches, each bound to the role `EndingRole` gives it, every gate a
real tool name, `view.openFile` gated on `read_file` and the rest of the view surface
gated on nothing.

Everything else is **spelling**, and the gate asserts only that it is there: every function
name unique within its object, every signature starting with the name a program calls, and
a description on every object, every argument, every field of a structured argument, every
type and every one of a type's members. What it deliberately does not compare is the *shape*
of a call — an argument's name, whether it is passed by position or by name, what it
defaults to, or how many signatures an entry carries. A language that must express an
optional argument as an overload pair offers the same capability as one that expresses it as
a default, and a gate that said otherwise would make the first kind of language impossible
to register.

The one exception is whether a call *has* a shape: a function that takes arguments must
document them, and an entry documenting none where another arm documents some fails. A
capability that needs a path needs it in every language, so an arm whose model is told what
to put in `fs.readFile` and an arm whose model is not are not two spellings of one surface.

It is load-bearing because its absence is silent. Each language's own drift gates compare
it to gg's tool vocabulary and to its own committed component — never to another language
— so two internally consistent surfaces that disagree with *each other* are two green test
suites, and an A/B across them measures the difference in the surface rather than the
difference in the language, with nothing anywhere to say so.

The comparative half runs over the registry for real, and is also exercised
on every test run against a **fixture language** that exists only under `#[cfg(test)]` —
because the registered pair is the easiest comparison there is, its two catalogues being
one set of declarations reflected twice. The fixture is a
second implementation of the seam whose catalogue is TypeScript's re-spelled in
snake_case, with its own healing dialect, its own prompt and its own preparation step. It
has no wire id, so it can never be configured, recorded or run. It is what turns the
seam's claims into observations — that the healing skeleton asks the dialect rather than
knowing TypeScript's answers, that a prompt is selected per language, that no language
serves another's artifacts — and, by being handed to the gate with a dozen deliberately
damaged catalogues, what proves the gate catches a disagreement rather than merely
reporting agreement.

Adding one is additive: a sibling guest directory — not necessarily an npm package —
that binds the same `crates/gg/wit/gg-sandbox.wit`, commits
`crates/gg/src/sandbox/guests/<language>.{component.wasm,signatures.json}`, and
hand-writes an SDK that is **idiomatic for that language** while obeying the same rules
this one does: namespaced typed bindings rather than a generic dispatcher, every call
synchronous, no strings-as-enums, no model-authored JSON in or out, required arguments
positional. [Program languages](/gg/program-languages/#adding-a-language-worked-python)
walks the whole of it through, with what a Python guest was measured to cost;
`packages/gg-sandbox/README.md` states the artifact contract in full.

## Configuring it

The capability is `responses-as-code`, under **Models & tools** in the
[configuration](/gg/configurations/) editor, with five parameters:

| Param | Default | Notes |
| --- | --- | --- |
| `language` | `typescript` | The [program language](#the-program-language) this agent writes in — `typescript`, `javascript` or `python`. A value gg cannot read as a registered language changes nothing and is reported at launch, on the same terms every unreadable param is. |
| `timeoutSecs` | `30` | The per-program guest-execution timeout, in seconds. |
| `maxMemoryBytes` | `268435456` | The per-program linear-memory cap. |
| `imageViewCap` | unset — no ceiling | How many [image-carrying views](#the-caps-and-why-none-of-them-truncates) this agent may hold open at once. Labelled **Max open image views** in the editor. |
| `healing` | each strategy at its own default | Which [response-healing](/gg/response-healing/#configuration) repairs are armed. Five of the six are on unless a run says otherwise; `drop-doubled-response` is [armed deliberately](/gg/response-healing/#the-one-strategy-you-have-to-ask-for). |

The three numeric params each fall back to their default when absent, non-numeric, or
non-positive — and `imageViewCap`'s default is **no ceiling at all**, because how many pictures
a run needs resident is a property of the work rather than of the sandbox. `timeoutSecs` is a wall-clock time, so a **fraction** is honoured — `0.5` is
half a second, which a study measuring a very short ceiling has every reason to ask for —
while `maxMemoryBytes` and `imageViewCap` are counts and truncate a fraction towards zero.
None of them is clamped — a study may starve the sandbox on purpose to measure what that
does — so what protects an operator from a mystifying failure is the error message, which
names the configured limit.

All five are resolved **per agent**, from the profile that agent runs under, so a root that
may look at four mockups and a reviewer subagent that may look at one are one
configuration — and, in principle, so are a root and a reviewer writing different
languages. `imageViewCap` lives here and not on `read-file` because it bounds only the
code arm; hanging it off the read tool would imply it governs native reads, which it
deliberately does not.

The ceilings that bound the *run* rather than one program — turns, wall clock,
consecutive errors, recent error rate, cost — are not params of this capability at all.
They live on the capability set, apply to both execution modes, and have
[their own page](/gg/execution-limits/).

## What the session record holds of a program

A program's composed calls are captured for the
[session record](/gg/session-record/) exactly as native tool calls are: each streams its own
`ToolCall`/`ToolResult` pair and is recorded. They carry a synthetic call id prefixed
`program:` — a program's call has no provider-assigned id, and the ordinal in that id is
what keeps two calls to the same tool in one program distinct, and what tells a reader that
the call came from a program rather than from a tool-calling turn the model never took.
