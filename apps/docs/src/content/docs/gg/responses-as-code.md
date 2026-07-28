---
title: "Responses as code"
---

An alternative to traditional tool calling: an agent answers a turn by **writing a
TypeScript program** over its tools, which gg executes in a
[wasmtime](https://wasmtime.dev/) sandbox — instead of emitting one tool call, waiting
for its result, and emitting the next. Loops, conditionals, filtering, intermediate
values and a dozen composed calls all happen inside a single turn, and gg feeds back
whatever the program logged and how each call went.

This is well-trodden ground for us: the same approach is already implemented and
well understood in another of the author's projects (and wasmtime is already the
sandbox The Test Cabinet's [Foray](/testing/adversarial/foray/architecture/) engine
runs untrusted controllers in), so it is a low-risk capability to bring to gg.

It is a capability like any other, which is the point. Turn it on and the model is
offered **no native tool definitions at all** — the toolset arrives as TypeScript
signatures in the [system prompt](/gg/prompts/) instead; turn it off and the same run
executes as ordinary tool calling. Freeze the model, the test case and the rest of the
[capability set](/gg/overview/#the-capability-set), vary this one toggle, and the
difference is attributable to the shape of the response. That A/B — do code-shaped
responses help a model tackle the large [Hard](/testing/end-to-end/) cases? — is what
the capability exists to measure.

## The contract a model sees

The model's **whole reply is the program**. Not a block inside the reply, not the
first of several — the first character of the reply is the first character of its
code, and what gg compiles is the reply itself:

```ts
const specs = listDir("specs").filter((e) => e.kind === "file" && e.name.endsWith(".md"));
const missing = specs.filter((e) => !readTextFile(`specs/${e.name}`).includes("## Rules"));
console.log(`checked ${specs.length} spec files; missing: ${missing.map((e) => e.name)}`);
if (missing.length === 0) finish(`Checked all ${specs.length} spec files; every one documents its rules.`);
```

That example is fenced **on this page**, because this page is written for humans. The
model's reply carries no fence, no `ts` tag and no prose around the code, and the
[prompt](/gg/prompts/) says so in as many words — its own worked examples are indented
rather than fenced, so that nothing gg shows a model can re-teach the shape it is
asking the model not to send.

- **`console.*` is captured** and shown back, and it is the **only** channel a program
  has for showing gg a value. It is not stdout: gg's [telemetry](/gg/telemetry/) *is*
  this process's stdout, so `console.log` is routed to a host call instead.
- **`return` at the top level** ends the program, exactly as it ends any function body,
  and **its value is discarded**. A program uses it to stop early; it says nothing. A
  model that returns a value is told, once, in that turn's feedback, that the value went
  nowhere and that logging is what carries — see
  [the rule that replaced a family of rules](#a-returned-value-is-discarded) below.
- **`finish(summary: string): void` ends the session** — and nothing else does. It is a
  real membrane function bound into every program's scope, not a rule about text. It
  **sets a flag** in the agent's host-side context and returns: the program runs on, and
  the loop reads the flag once the program has ended. The summary becomes the run's final
  text (for a subagent, its return value to whichever agent asked for the work).
- **A reply that is not a program is an error turn**, not a conclusion. Prose, an
  empty reply, comments only, or several candidate code blocks are each fed back to
  the model naming the shape it sent, saying that nothing ran and nothing changed, and
  telling it that only `finish` ends the run. Such a turn counts as an **error turn**,
  so a configured [error ceiling](/gg/execution-limits/) can stop a model that has
  started answering in prose; with none configured, the run is bounded by its turn
  ceiling as it always was.

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
  ran to the end of. The run carries on, and the turn's feedback says the ending was
  cancelled and why — without that sentence a model reads an ordinary failed turn, fixes
  the throw, and never calls `finish` again. A failure the program **catches** revokes
  nothing: it ran to its end.
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
reports only *that* a value was returned, so the turn's feedback can point the model at
`console.log`; the value itself never crosses the membrane.

This is a subtraction, and what it removed is the point. A carried return value needed a
rule for every shape a program might hand back: a `Promise` (the trace of `async` in a
synchronous sandbox), a cycle `JSON.stringify` throws on, a function that serialises to
nothing, a structure nested past the 127 levels the host's parser would read back, a value
large enough to need its own 8 KiB cap in the feedback. Each had its own message and its own
failure mode, and each was a rule a model had to learn in order to use a channel it did not
need: anything a program can return, it can log. One sentence — *`console.log` what you want
to see* — replaced all of them.

`return` itself is untouched and is still worth writing: it is how a program stops early
without an `else`. What gg reports about it is unchanged too — statements after a top-level
`return` are counted and quoted in the feedback, because that shape is what a pasted second
draft looks like.

### Malformed replies are healed, and the repair is counted

Between the raw reply and the type-strip sits a **deletion-only healing pass**: it
unwraps a Markdown fence a model wrapped its program in, drops explanatory lines around
it, removes `import` lines for a surface that is already in scope, and unwraps an
`async` wrapper whose continuation this sandbox would have run only after the program
had already returned. Every repair is
disclosed to the model in the same turn's feedback and counted on the run, so a healed
response is a measurement rather than a rescue. The strategies, their decline rules,
their configuration and their metrics are [their own page](/gg/response-healing/).

## The typed tool surface

Every gg tool is a **distinct, typed TypeScript function** already in the program's
scope. There is no dispatcher to name a tool through and no JSON to hand-assemble:

| Function | Returns |
| --- | --- |
| `shell(command: string, options?: { timeoutSecs?: number; })` | `ShellOutput` |
| `readFile(path: string, options?: { offset?: number; limit?: number; })` | `FileRead` |
| `writeFile(path: string, contents: string)` | `number` (bytes written) |
| `editFile(path: string, oldString: string, newString: string)` | `void` |
| `listDir(path?: string)` | `DirEntry[]` |
| `spawnSubagent(request: { agent: string; } & ({ prompt: string; } \| { issueId: string; }))` | `SubagentHandle` |

Thirty of gg's thirty-three tools are bound this way — everything except the three
[turn-level transitions](#turn-level-transitions-are-not-composable) — plus one
convenience helper, `readTextFile(path, options?)`, for the overwhelmingly common case
of wanting a file's text rather than its metadata, and `finish(summary)`, which is a
membrane function like any other but not a tool: no capability offers it, it dispatches
nothing, and it is declared in its own WIT interface precisely so the one-to-one
correspondence between the tool interfaces and gg's tool vocabulary is not perturbed by
it. The prompt lists the signature and a
sentence of documentation for each tool **the run actually offers**, and both are
reflected out of the sandbox SDK's own emitted declarations by the same build that
produces the component. A hand-written list would drift, and a prompt that describes a
signature the sandbox does not have is worse than no prompt, because the model has no
way to discover the lie.

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
- **Nothing else is reachable.** The component imports the membrane and nothing else,
  and is built with every WASI capability disabled — no filesystem, no clock, no
  randomness, no network, no module system. What the interface does not declare does
  not exist inside the guest.

JSON survives in exactly one place, and it is deliberately **inside the host**: between
the membrane implementation and gg's existing tool registry, which has always dispatched
on a name and a JSON value. That is what keeps plan-mode and FSM gating, delegation
routing through the subagent scheduler, `ToolCall`/`ToolResult` telemetry and
[replay](/gg/replay/) capture completely untouched while the model-facing surface
becomes typed functions.

### Type-stripped, not type-checked

The program is TypeScript, but nothing type-*checks* it. gg erases the types with
[`oxc`](https://oxc.rs/) in-process — around 0.2 ms — and hands the JavaScript to the
guest. An `interface` declaration disappears, `const x: Entry[] = …` becomes
`const x = …`, and a call that passes a string where a number was declared runs anyway.

The prompt says so in as many words, because a model that believes its types were
checked writes different (worse) code than one that knows they were not. What catches
the mistakes that actually matter is **run-time validation in the SDK wrappers**, on
the three shapes that are otherwise silent or unreadable:

- `shell("npm test", 300)` — a positional argument where an options object belongs
  would quietly read `timeoutSecs` off a number, get `undefined`, and use the default.
  It is refused with *"`shell(…)` takes an options object for its optional arguments"*.
- `readFile("a.ts", { offset: -1 })` — a negative number lowers across the membrane by
  two's-complement wrap and fails for a reason unrelated to what was written. It is
  refused with the permitted range.
- A record's `list<T>` field left off entirely — which arrives as `undefined` and
  throws `TypeError: can't access property "length"`, naming neither the tool nor the
  field. It is defaulted to `[]`.

Bad enum strings and bad variant tags already produce good messages from the generated
bindings, so the validators cover exactly that gap and nothing more.

Plain JavaScript passes through essentially unchanged, so a model that ignores the word
"TypeScript" still runs.

One layer *below* types is checked, though, because leaving it to the guest costs the
model its location: ECMAScript's **early errors** — a `const` declared twice, a `let`
shadowing a parameter, a duplicate name in a destructuring pattern. Those are scope
errors, not parse errors, and the guest's `new Function` raises them at *construction*
time, before a statement runs — a throw with no stack frame inside the program, so the
shim's line recovery finds nothing and the model gets `SyntaxError: redeclaration of
const root` with no file, no line and no excerpt. gg checks them during the type-strip
instead, where the scope analysis the transformer needs is already being done, and hands
back the same located diagnostic every other transpile failure carries — pointing at both
the first binding and the second, since a redeclaration is only fixable from the half that
came later.

It is worth knowing what produces one. Nearly always: two programs in one reply.

### Statements that cannot run

A program's top level is a function body, so a top-level `return` ends it and everything
after it is dead. That is legal JavaScript and nothing refuses it — but a model that
pasted a second draft after the first one's `return` would otherwise be told *"your
program ran to completion"* about a reply whose second half, the half that wrote the
deliverable and called `finish`, never executed. So gg counts what could not run and says
so, in the turn's feedback and on the run's stream:

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

## How a turn runs

```text
the model's whole reply
   └─ heal it into a program             (not a program ⇒ an error turn, fed back)
        └─ oxc type-strip, in process    (~0.2 ms; size and nesting bounded first)
             └─ instantiate the process-wide compiled component  (24–124 µs)
                  └─ run the program against exactly this run's tools
                       │  readFile("a.ts", { limit: 200 })
                       └─ typed WIT call → host → gg's tool registry → the agent loop
                            (gated, routed, streamed as ToolCall/ToolResult, recorded)
   ← logs + the call roster + any pictures read + any completion
```

Everything above the tool registry is new; everything below it is the same code an
ordinary tool-calling turn runs through, which is what preserves the loop's gating,
delegation, telemetry and replay behaviour unchanged.

The sandbox is synchronous and CPU-bound, so it runs on a blocking thread while each
call it makes is serviced **on the async loop** over a channel. That is not an
optimisation: a program's `spawnSubagent` still goes through the
[scheduler](/gg/subagents/), a `speculate` still runs its
[best-of-K](/gg/speculative-execution/) attempts, and an `evictFileView` is still
applied against the live window and told what it really freed.

### Why a componentized JavaScript engine

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

The non-negotiable property is that a turn never pays for a compile. The wasm `Engine`
and the compiled `Component` both live behind a process-wide `OnceLock`, so the artifact
is compiled **at most once per process** and every program thereafter pays instantiate
plus invoke and nothing else. There is no `componentize-js`, no Node, no `tsc`, and no
disk cache anywhere on the turn path.

| Stage | Measured |
| --- | --- |
| Type-strip the program (`oxc`, in process) | ~0.2 ms |
| Compile the component — **once per process** | 658 ms (18 cores), 1.29 s (4), 2.36 s (2), 4.84 s (1) |
| Instantiate a store from the compiled component | 24–124 µs |
| Evaluate an ordinary program (excluding its tool calls) | 0.7–3 ms |

Even that single compile is kept off the critical path: when the capability is on, gg
fires a warm-up compile once at session start, concurrently with the first model
request, which takes far longer. It never fires from a subagent, and the `OnceLock`
makes a second call free. A run **without** the capability compiles nothing at all.

There is deliberately no on-disk compilation cache. gg runs one process per run inside
an ephemeral container, so a disk cache would be written once and thrown away with the
container — while the wasmtime `cache` feature would drag `zstd`'s C compile onto a
binary that is release-built for three platforms and statically linked against musl.

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

Three further bounds are not configurable, because each protects gg itself rather than
rationing a run:

- **A program is at most 64 KiB**, and nests brackets at most 200 deep. The TypeScript
  parser is recursive descent with no depth guard, and a stack overflow is not a
  catchable panic — it would take the whole gg process down over one degenerate
  response. A model that repeats a bracket in a generation loop produces exactly that
  shape, so the untrusted input is bounded before it is parsed (and the parse runs on a
  256 MiB stack sized against what those bounds still admit).
- **A `shell` timeout is clamped to what is left of the run's wall-clock budget.** A
  host function cannot trap, so one `shell("sleep 3600")` would otherwise carry the run
  past its deadline with no mechanism left to stop it.

The execution timeout meters only the guest. A program that spends ten minutes waiting on
`shell` builds is not stopped by it; what bounds *that* is the run's wall-clock deadline,
which the membrane checks **before every bridged call**. Once the budget is
spent, every further call is refused with a `limit-exceeded` failure saying that
everything the program already did stands — a refusal rather than a kill, so the program
stops cleanly and the turn still reports what it accomplished. `finish` is the one
exception: it performs no work and ends the run, which is exactly what a spent budget
wants, so it is never refused for one.

## Capability gating

A withheld tool is **not in scope**. The guest builds the program's scope from the run's
enabled tool names and evaluates the program as the body of a function whose *parameters*
are exactly those names, so a tool this run does not offer is an undefined identifier —
not a call that travels to the host and is refused there. Scope injection is the
capability model, and the host's enabled-set check behind it is a defensive backstop that
a program cannot normally reach.

The same set drives the prompt, so a withheld capability contributes **no prompt text**:
a run without the [tasks](/gg/tasks/) capability is not shown the task functions and is
not shown the `TaskUsage` type either. That is the property
[toolset ablation](/gg/toolset-ablation/) depends on — the toolset and its description
come from one source and cannot disagree.

It extends to the section's **prose**, not just its listing. The worked example is chosen
from the tools the run binds (composition when it can list and read, a `shell` example when
it can only run commands, a write example, and a tool-free one otherwise), and the three
bullets that illustrate themselves with a named function — an options object, a caught
failure, a non-zero exit — are each gated on that function being bound. An example is the
one part of a prompt a model copies verbatim, so an ungated one would hand a reduced-toolset
run a `ReferenceError` on its first turn.

The [filesystem capabilities](/gg/filesystem/) compose the same way: a run with
`read-file` off has no `readFile` and no `readTextFile`, and a capped read mode caps a
program's reads exactly as it caps a tool call's.

:::note
**`finish` is the one bound name no capability gates.** A run that enables no tools at
all must still be able to end, so it is bound whatever the capability set says — and
because it is not a tool, neither the membrane's enabled-set backstop nor the loop's
dispatch gates apply to it. A program can therefore end the run from a state
[plan mode](/gg/planning/) or an [FSM](/gg/fsms/) was meant to hold it in. That is
consistent with both machines being inert under this capability, which gg already warns
about at launch.
:::

### Turn-level transitions are not composable

Three tools are declared in the membrane and never bound into a program's scope:
`enter_plan_mode`, `submit_plan` and `advance_state`. They change the loop's **mode**,
which takes effect between turns and is not a value a program can compose — "the rest of
this turn now runs in plan mode" means nothing. Reaching one anyway (through the host's
backstop) is refused with the reason, and the refusal is listed in the turn's feedback. The
refusal deliberately does **not** suggest making the transition on a later turn: under
responses-as-code every turn is a program, so there is no turn that could. It tells the
model to do the work directly instead.

:::note
**Responses as code therefore does not compose with [planning](/gg/planning/) or
[FSM-driven processes](/gg/fsms/).** Both machines are driven by a transition the model
can no longer call. Planning is left simply inert — a pass that can never be entered
restricts nothing. An FSM is worse than inert: its first state's tool restrictions still
apply to every call a program makes, but the run can never advance out of that state.
This is stated rather than hidden: the prompt says so, and gg emits a startup **warning**
naming the combination and what it does, so a misconfigured study is loud at launch rather
than at its deadline. A study that wants to vary either must vary it against tool-calling
runs.
:::

## A tool failure throws

Under tool calling, a failed tool returns its failure **into** the conversation as a
value. Inside a program, a failed tool **throws** a typed `ToolError` carrying `.tool`,
`.code` and `.message`, and an uncaught throw ends the program at that statement.

That inversion is deliberate, and it is why composition works at all. A surface where
every call returns `{ ok, output }` forces a branch after every line, and the worked
example at the top of this page becomes unwritable. Three things keep it honest:

1. **The throw is catchable and typed.** `catch (e) { if (e.code === "conflict") … }` is
   the shape the prompt teaches, and `ToolError` is bound into the program's scope so
   `e instanceof ToolError` works. It also serialises: a plain `Error`'s `message` is
   non-enumerable, so without an explicit `toJSON` a logged failure would arrive as
   `{}`.
2. **The work before it stands, and is reported.** Every call the program landed before
   the throw is in the turn's roster, and the model is told which statement threw, on
   which line of *its own* program — the guest remaps the line out of the interpreter's
   coordinates.
3. **`shell` is carved out.** A non-zero exit is a **value**, not a throw: a process that
   ran is a successful call whatever it exited with, and `shell("npm test")` has to be
   usable inside an expression. The turn's roster records it as a completed call
   (`exited 1`) rather than as a failure carrying the command's whole output.

## What a code turn costs the context window

A code turn is charged to the window as **one ephemeral tool-output message**: the call
roster, the logs, and any refusals. That is the whole point —
reads are consumed *inside* the program instead of being poured into the context.

In particular, a program's `readFile` does **not** push a
[file view](/gg/context-visibility/): a program that reads forty files should not put
forty files in the window. Pictures are the exception, because they are the one thing the
model has to see with its own eyes — a `readFile` of a reference mockup rides out on the
turn's feedback as an attached image, exactly as the
[native path](/gg/filesystem/#reading-images) does.

Everything a program can produce in a loop is bounded, and whatever a bound discarded is
**counted** rather than silently dropped — a model whose roster was cut needs to be told,
or it will read the shorter list as evidence that its loop never ran:

| What | Cap |
| --- | --- |
| Calls described in the roster | 500 (a program can compose far more within its timeout) |
| Refusals described | 100 |
| Log lines | 200, 16 KiB in total, 2 KiB per line — the **last** lines, evicting from the front |
| Failure text kept per roster entry | 512 bytes |
| Pictures attached to one turn | 4 |

The dispatched-call count reported in [telemetry](/gg/telemetry/) is the roster **plus**
what the cap suppressed, so it always equals the number of `ToolCall`/`ToolResult` pairs
the turn actually streamed. Refusals are counted separately and never inflate it: nothing
was dispatched.

## Determinism

The component is built with clocks and randomness disabled, so inside a program:

- `Date.now()` and `new Date()` are **frozen** at a fixed instant (the component's own
  build instant), and return the same value on every run of every study;
- `Math.random()` returns the same sequence every time;
- `crypto.getRandomValues()` and `crypto.randomUUID()` **throw** rather than returning
  the same value forever while looking authoritative.

The prompt names all three, and — when the run offers `shell` — tells the model to reach
for it when it genuinely needs the real time, a random value, or the network.

This is what makes two runs of the same program **comparable**: given the same tool
outcomes, it takes the same path and composes the same calls in the same order, so a
difference between two arms of a study is a difference in the model, not in the sandbox.
It is *not* what makes replay exact — see [replay](#replay) below, which reconstructs a
recorded turn rather than re-running it.

Disabling a WASI capability removes the underlying import but leaves the JavaScript
builtin defined, so an unshadowed `setTimeout` would reach a missing import and **trap
the whole store** — uncatchable, unreportable, and the single most common reflex a model
brings to a new runtime. The guest therefore shadows every such global with a thrower, so
`setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `queueMicrotask`,
`requestAnimationFrame`, `fetch`, `performance.now` and the two `crypto` methods each
produce an ordinary, located, catchable program error naming what is missing and why.

## What can go wrong

Every one of these is a **turn** outcome, not a run outcome, and every one emits its
`code_execution` telemetry event whether it succeeded or not — including a turn whose
reply was not a program at all, which is what makes that event's count the exact number
of code-shaped turns a run took.

| What went wrong | Caught by | What the model is told |
| --- | --- | --- |
| The reply was not a program — prose, empty, comments only, native tool calls and no text, no block gg reads as a program, or several candidate blocks | [healing](/gg/response-healing/), before any engine work | which shape it sent, that nothing ran and nothing changed, and that only `finish` ends the run |
| The program is not valid TypeScript | the type-strip, before any engine work | every parser diagnostic — each with its line, its column and the offending source line quoted — and that nothing ran so nothing changed |
| The program breaks an **early error** — most often a `const` declared twice, i.e. two programs in one reply | the type-strip's scope analysis, before any engine work | the identifier, and **both** places it was bound, each with a line, a column and the source line quoted |
| The reply carried statements after a top-level `return` | the type-strip, from the tree it already built | how many did not run, which one was first, and that a top-level `return` ends the program — the program itself still runs |
| `import`, `export`, a dynamic `import()`, or a top-level `await` | the type-strip | that the sandbox has no module system and is synchronous, and what to write instead |
| The program is longer than 64 KiB | the size guard, before the parse | its size, the cap, and that a program orchestrates tools rather than carrying a document inline |
| The program nests brackets past 200 deep | the nesting guard, before the parse | its depth, the cap, that the parse runs on a bounded stack, and that this is almost always a repeated bracket |
| An unknown identifier (usually a withheld tool) | the guest | the name, the program line — **and the list of tools this run offers** |
| A tool threw and was not caught | the guest's single `catch` | which tool failed, its code and message, the program line, plus every call that already landed |
| A tool failed but was caught | the call roster | `- edit_file → failed: …`, so a caught failure is not invisible |
| A denied global (`setTimeout`, `fetch`, `crypto.randomUUID`, …) | the guest's throwers | the denial, located, plus "every tool function is synchronous" |
| The program returned a Promise | the guest | to remove `async`/`await` and `console.log` what it wanted to see |
| The program `return`ed a value | the guest | that return values are discarded and `console.log` is the channel |
| The program called `finish` and then failed | the host, which revokes the flag | that a program which fails has not finished, and to call `finish` again from one that runs to its end |
| Work deferred with `.then()` ran after the program ended | the guest's call guard | that deferred work is outside the turn and its failures are never reported |
| A turn-level transition, or a tool this run withholds | the host's backstop | a `refused:` line in the feedback; **not** counted as a tool call |
| The run's wall-clock budget ran out mid-program | the deadline check before each call | a `limit-exceeded` failure saying the budget is spent and prior work stands |
| Execution timeout reached | the trap classifier | the ceiling, and that a timeout this long almost always means a loop or recursion that never ends — find it rather than write less |
| Memory cap exceeded, or set below the guest's ~10 MiB floor | the memory limiter's denial flag | the configured cap, and the floor the guest engine needs before a program runs at all |
| The committed component fails to compile or instantiate, or gg's own wasm plumbing fails | the engine, or the host | nothing — the **session ends** with a model-error status and a log naming which of the two it was, because every further turn would fail identically |
| A configured [error ceiling](/gg/execution-limits/) was breached | the loop, at the turn boundary | the last turn's feedback, then the **session ends** `limit_exceeded` with the breach recorded |

Which of these count as an **error turn** follows one definition shared by both execution
modes: a turn is an error when the work it *declared* could not be carried out as
declared — a reply that was not a program, a program that did not compile, one that threw
uncaught, one the sandbox stopped at a ceiling. A failure gg reported *into* a program
that carried on — a caught throw, a refused call, a non-zero `shell` exit, a call refused
because the wall-clock budget is spent — is **not** one: the program handled it, which is
the entire point of the typed surface. How many such turns a run tolerates is a matter of
its [execution ceilings](/gg/execution-limits/); by default a run's turn ceiling is
unbounded (the host caps its wall-clock) and its two error ceilings — 5 consecutive
errors, and an error rate above 0.4 over the last 50 turns — end a run that has stopped
making progress.

## How the sandbox is built and shipped

The guest lives at `packages/gg-sandbox/` — the typed SDK, the interpreter shim, and the
build that bakes them into a component with a pinned `componentize-js`. Two of its
outputs are **committed** into the Rust crate:

| Artifact | What it is |
| --- | --- |
| `crates/gg/src/sandbox/gg-sandbox.component.wasm` | The baked component, embedded in the binary (13,456,844 bytes as committed). |
| `crates/gg/src/sandbox/signatures.json` | The signature catalogue rendered into the system prompt. |

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

Four gates stop the committed artifacts drifting from the code around them: the
`componentize-js` link fails if the guest and the membrane disagree; gg's instantiation
test fails if the committed component's imports no longer match the host's linker; gg's
`bound-tools` test asks the **artifact** which tools it can bind and compares that against
gg's own tool vocabulary, which is the one drift no source-level test can catch; and CI
regenerates the signature catalogue and fails on a diff.

## Configuring it

The capability is `responses-as-code`, under **Models & tools** in the
[configuration](/gg/configurations/) editor, with three parameters:

| Param | Default | Notes |
| --- | --- | --- |
| `timeoutSecs` | `30` | The per-program guest-execution timeout, in seconds. |
| `maxMemoryBytes` | `268435456` | The per-program linear-memory cap. |
| `healing` | every strategy on | Which [response-healing](/gg/response-healing/#configuration) repairs are armed. |

The two numeric params each fall back to their default when absent, non-numeric, or
non-positive. `timeoutSecs` is a wall-clock time, so a **fraction** is honoured — `0.5` is
half a second, which a study measuring a very short ceiling has every reason to ask for —
while `maxMemoryBytes` is a count and truncates a fraction towards zero. Neither is clamped
— a study may starve the sandbox on purpose to measure what that does — so what protects an
operator from a mystifying failure is the error message, which names the configured limit.

The ceilings that bound the *run* rather than one program — turns, wall clock,
consecutive errors, recent error rate, cost — are not params of this capability at all.
They live on the capability set, apply to both execution modes, and have
[their own page](/gg/execution-limits/).

## Replay

A program's composed calls are captured for [replay](/gg/replay/) exactly as native tool
calls are: each streams its own `ToolCall`/`ToolResult` pair and is recorded. They carry
a synthetic call id prefixed `program:` — a program's call has no provider-assigned id,
and the ordinal in that id is what keeps two calls to the same tool in one program
distinct. The replay driver recognises the prefix and attributes such a result to the
open turn's program rather than to a native tool call the model never made.

Replaying a code turn is exact because the driver **reconstructs** it: it walks the record
and re-emits the recorded call/outcome pairs in recorded order. No program is transpiled,
no reply is healed and no sandbox is instantiated, so the record — not the guest's
determinism — is what makes the reconstruction faithful. The attribution rule is scoped
to a run the record's own
capability set says was in code mode, so a `program:` id appearing in a tool-calling record
is still reported as the divergence it is.
