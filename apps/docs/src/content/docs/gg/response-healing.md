---
title: "Response healing"
---

Under [responses as code](/gg/responses-as-code/) a model's **whole reply is the
program**. That contract fits in one sentence and can be broken in half a dozen ways,
and real models break it: they wrap the program in a Markdown fence, they glue a
sentence onto the closing fence, they explain themselves above and below the code, they
`import` a surface that is already in scope, and they wrap everything in an
`async function main()` whose `await`s buy nothing in a sandbox where every tool function
is synchronous — and cost everything, because what follows the first one runs after the
program has already returned.

**Healing** is the pass that turns those replies into the program the model meant. It is
not a lenient parser and not a rescue mission — it is an instrument. Every repair is
**counted on the run**, so "how often did this model still send a fence after being told
not to?" is a number a study can group by. That count is the point: the ablation this
capability exists to run is about how well models follow a code-only contract.

Healing is **invisible to the model**. A repaired reply is simply the reply that runs —
no note at the top of the turn, no mention anywhere in the prompt. See
[why it is silent](#why-healing-is-silent).

## The seam

```text
the model's reply, unmodified   ── streamed as its assistant_message, pushed to the context
        │
        ▼
   heal(reply, config)
        │            ═══════ THE SEAM ═══════
        │            above: text repair.  below: syntax.
        ▼
  oxc type-strip ──▶ instantiate ──▶ run
```

Every reply travels the whole way. **gg never asks whether a reply "is a program"** —
that question belongs to the compiler, which answers it with a located diagnostic over
the model's own text rather than with gg's reading of it. An empty reply becomes an empty
program that runs and does nothing. A reply of comments becomes a program that runs and
does nothing. A reply that is two programs pasted together fails to compile, with the
redeclaration error that really is what is wrong with it. A reply of prose fails to
compile too, and the model is shown the syntax error rather than an essay about what gg
thinks it meant.

The raw reply is what gg streams and stores: healing never touches the recorded
assistant message, so "did this model still emit a fence?" is answerable from the
transcript as well as from the counters.

Everything on this page is therefore a **deletion**, never a judgement — which is what
lets every rule here be a microsecond-scale unit test with no wasm behind it. The module
(`crates/gg/src/healing.rs`) does no I/O, reads no clock, is not `async`, and imports
nothing from the sandbox; turning a strategy off changes only what one pure function
returns, which is what makes the ablation honest.

Healing does not run on the [replay](/gg/replay/) path at all. The replay driver
*reconstructs* a code turn from the record; it does not re-drive the text through the
pipeline.

## The invariant that makes it honest

> **Healing only ever deletes.** Every strategy removes contiguous text; `unwrap-async`
> additionally removes leading whitespace from the body's lines. No strategy inserts a
> character, moves a line, rewrites a token in place, or reorders anything. Therefore
> **the healed program, with whitespace removed, is a subsequence of the response with
> whitespace removed.**

One machine-checkable sentence that covers "never invents code" and "never reorders" for
all five strategies at once. It is enforced as a property test over the whole fixture
corpus — every captured real reply — under **every** configuration.

Where a strategy cannot apply cleanly it **declines**: silently, leaving the text exactly
as it was. The asymmetry is deliberate. A missed repair costs one turn and a located
diagnostic; a wrong repair deletes the model's work. Only one of those is recoverable.

Dropping a byte-order mark, the blank lines around a reply and its trailing whitespace is
**canonicalisation, not repair**: a program that differs from another only in that is the
same program, so it is not counted. What is deliberately *kept* is the
**indentation of the first content line** — four spaces make an indented code block rather
than a fence, so un-indenting it here would answer a question the fence scanner exists to
ask.

## The five strategies

They run in this order, repeated to a fixpoint:

```text
trim  ->  [ strip-fences -> strip-prose -> drop-duplicate-program
            -> drop-imports -> unwrap-async ]*
              ^                            |
              +---- repeat until a pass applies nothing +
```

Fences first, because until the wrapper is off, "is this line prose?" and "is this line
an import?" are questions about the wrong text. Prose before duplicates, so the two
copies of a program are adjacent when they are compared. Duplicates before imports and
async, so a doubled reply is halved before either of those looks at it. Imports before
async, because a leading `import` line is exactly what makes `unwrap-async` decline —
one strategy's output enabling another's match is why this is a fixpoint and not a list.

The fixpoint is bounded at four passes; measured, no real reply needs more than one and
the deepest shape in the corpus (a fence nested in a fence) needs two. If that bound is
ever reached, **every repair is discarded**, the reply runs exactly as it was sent, the
run logs a `warn`, and the turn's record carries `didNotConverge` — because the
alternative (an untouched program and an empty repair list) is byte-identical to a clean
response, and reporting the one pathological reply as "nothing was unusual" is the kind
of quiet lie this subsystem exists to remove.

### `strip-fences`

**Matches** a Markdown code fence wrapping the program — tagged or not, closed properly,
closed with prose glued to the closing line, or never closed at all. **Rewrites** the
reply to the body of the one *candidate* block; everything outside the fences goes.

The scan is a real CommonMark fence scanner, not a search for the next ```` ``` ````. A
program routinely *contains* a fenced block — writing a README or a spec snippet is
ordinary gg work — and a model doing that opens its program with a **longer** fence,
exactly as CommonMark asks. So the opening fence's length is recorded, both fences must
start their own line, and a closing fence must be at least as long as the opening one.
Two relaxations come from measured real replies, and neither touches the length rule:

| Shape | What the scanner does |
| --- | --- |
| the **glued open** — prose and the next fence on one line (`…to confirm.` ```` ```ts ````) | opens a block; the prose becomes an outside line |
| the **glued close** — a closing run with text after it (```` ```Consumed fuel: 24,000 … ````) | closes the block as `glued`; the trailing text becomes an outside line. CommonMark does *not* accept this as a close, which is exactly why the reply that contained it — seven times over — was read as one enormous program |
| **end of input with a block open** | closes it as `unterminated` and runs what it holds |

*Candidacy* is a three-tier ladder, first non-empty tier wins: blocks tagged `ts`,
`typescript`, `tsx`, `js`, `javascript`, `mjs`, `node` (and the rest of that closed list);
otherwise blocks with **no** tag; otherwise blocks whose unrecognised tag is anything
else **and** whose body looks like code. A closed list rather than a deny list, because a
block tagged `json`, `text`, `bash` or `md` is context the model showed rather than the
program — and tier 3 is what stops the closed list being a trap for a lone block tagged
something gg has never heard of.

The **decline ladder** is part of the specification, not an implementation detail,
because two of its rungs disagree on real inputs:

| # | Condition | Result |
| --- | --- | --- |
| **D1** | no blocks at all | not applicable; nothing recorded |
| **D2** | **two or more candidates** | decline — gg cannot know which was meant, and picking one would delete a program the model wrote |
| **D3** | exactly one candidate, but a line **outside the fences** is certainly code | decline — unwrapping would delete real code |
| **D4** | zero candidates | decline |
| — | otherwise | unwrap to the single candidate's body |

**D2 declines rather than refusing the reply.** The worst real reply measured — seven
candidate blocks inside 9,800 bytes of narration — is compiled exactly as sent, and what
comes back is the compiler's error over the model's own text. gg used to answer that
shape with a sentence of its own ("your reply contained 7 separate code blocks"); it does
not, because counting how many programs a reply "is" is an analysis of the text, and the
only analysis this pipeline performs is the one it can prove is a safe deletion.

**D3 asks about every line outside the fences**, not only those above the first one. What
tells a fence *inside* a program from a fence *around* one is whether real code survives
outside it, and that code sits below the block as often as above it: a model that fences
the working half of its program and writes `finish("…")` underneath has written one
program across a fence. An unwrap keeps only the candidate block's body — and its record
counts other *blocks*, not outside lines — so unwrapping there would delete the
ending, leave the run unable to terminate, and never say so. The narrowness lives in the
code predicate instead, where it costs nothing: only shapes English does not have count as
code, so a stray `;` in a model's lead-in sentence does not block the unwrap, and across
every real reply this strategy accepted as a single candidate, no line outside the fences
is code-shaped.

Blocks left where they were are counted, and so is how many of *those* contained a
code-shaped line. That second count is the one shape where "gg removed a wrapper"
understates what happened — most often a three-backtick program that itself writes
Markdown, whose inner fence closed the outer block early — so the model is told so
explicitly.

### `strip-prose`

**Matches** contiguous runs of certainly-prose lines at the **start** and **end** of the
text, and nowhere else. **Declines** at the first line that is not certainly prose — no
scanning past it, no paragraph heuristics — and **while an opening fence survives**,
because its precondition ("a program with prose around it") is false while a wrapper is
still there. It also declines when removal would leave nothing at all: a reply that is
prose from end to end has no program under the explanation, so there is nothing to strip
*to*, and it goes to the type-strip as the model wrote it.

It is deliberately severe. A line is certainly prose only when it contains none of
`` ` `` `;` `{` `}` `(` `)` `[` `]` `=` `<` `>` `|` `&` `$` `\`, contains no `//` or
`/*`, does not open with a JavaScript statement keyword, and reads like a sentence
(two or more words, one of them with a real run of letters — or a single word ended by
`.`, `!` or `?`). Real replies produced *no* bare-program-with-prose responses — every
model fenced — so a strategy with no evidence behind it gets the setting where a false
positive costs one turn and a false negative deletes the model's code.

### `drop-duplicate-program`

**Matches** a reply that ends with a byte-identical repetition of the text immediately
before it — one program pasted after a copy of itself — when the repeated text declares
something with `const`, `let` or `class` at its top level. **Rewrites** it to the single
copy. Three copies converge to one at a copy per pass, because the tail is compared with
the text immediately preceding it rather than with the whole head.

That guard is what makes the deletion provably behaviour-preserving, which is otherwise
not obvious: deleting the second of two identical `writeFile(…)` calls really would change
what a run does. It cannot here — a redeclared `const` is an **early error**, so the reply
as sent could not execute a single statement — so the deletion removes text that had no
behaviour at all and turns a reply that could never run into the program the model wrote
once. `var` and `function` are deliberately not on that list: both may legally be declared
twice in the function body a program is evaluated as, so a repetition of either is evidence
of nothing.

This is the fence-free counterpart of `strip-fences`' several-candidates decline. With
fences gone from the contract, a model that drafts two programs has nothing left to
separate them with, and it pastes the second after the first. Where the two halves are
*not* identical there is nothing safe to delete, so the strategy **declines** and the
reply is compiled as sent — and the [type-strip](/gg/responses-as-code/) refuses it as
the early error it is, naming the redeclared identifier, its line and its column. That
diagnostic comes from a compiler reading the model's own text, which is a better answer
than any count gg could infer from it.

Two different drafts that declare *different* names are likewise left alone: that is a
legal program with a dead tail, it runs, and the type-strip is what reports the half that
could not run.

### `drop-imports`

In **code** lexical context only, deletes whole lines that are a complete single-line
`import`, a complete single-line `const`/`let`/`var … = require(…)`, or a bare
`require("…");` statement. **Declines** on a multi-line import (deciding where it ends is
a parse, and the type-strip already names `import` and says what to write instead); on an
`import` that the lexical mask places inside a string, template literal or comment — a
program *writing* a TypeScript file is ordinary gg work; and on everything when the mask
does not lex cleanly.

### `unwrap-async`

Matches a program whose **entire** top level is one `async` wrapper *that the program
calls* — `async function main(…) { … }` followed by exactly one call to it, or
`(async () => { … })();` / `(async function (…) { … })();`. It deletes the header, the
closing brace and the trailing invocation, dedents the body, and deletes every `await`
**token** in code context (`const x = await foo();` becomes `const x =  foo();`, the same
program). The dedent skips any line that begins *inside* a template literal, because the
leading whitespace of such a line is the model's data rather than its indentation.

**Declines** on an unclean mask; on a wrapper brace with no match; on anything at the top
level besides the wrapper and its invocation; on a wrapper the program never **calls**; on
a `main().then(…)` invocation, because dropping the call would delete the callback's code;
and on a **non-`async`** wrapper — `function main(){…} main();` already runs, so
unwrapping it would change what the program evaluates to for no reason.

This is the one strategy that rewrites *structure*, and it does change what the program
evaluates to. That is defensible only because a **called** `async` wrapper cannot do
useful work in this sandbox anyway: the body runs synchronously as far as its first
`await` and the rest is deferred past the program's return, where its result is lost and
its failures are never reported, while a program that returns the promise is refused
outright with *"your program returned a Promise"*. There is no working behaviour to
preserve, so the repair turns a program that could not run into the straight-line program
the model meant.

Both halves of that warrant matter, which is why an **uncalled** wrapper declines. Its
body never ran, so there is no `await` to throw and no promise to reject — nothing is
broken, the reply is simply a program that does nothing, and gg already has a message for
that: a program that put nothing in its own context earns the
[notice](/gg/responses-as-code/#showing-yourself-things) that says so.
Unwrapping it would not repair anything; it would *execute* statements the response never
asked to execute, and it would make `async` the difference between a forgotten call doing
nothing and a forgotten call deleting a directory.

### The lexical mask, and the one thing it cannot lex

`drop-imports`, `unwrap-async` and `drop-duplicate-program` each work over a mask of
which bytes are code as opposed to string, template-literal or comment text. It handles `'…'`,
`"…"`, `` `…` `` with `${ … }` substitutions re-entering code, `//…`, `/*…*/` and
backslash escapes. Three states end a scan uncleanly — an unterminated block comment, an
unterminated template literal, and a quoted string still open at a newline — and every
strategy that needs the mask **declines** on all three.

It deliberately does not lex **regular-expression literals**: telling `/` as division
from `/` as the start of a regex needs parser context, which is the very thing the mask
exists to avoid. A regex containing a quote (`str.replace(/don't/g, "")`) therefore
desyncs the scan, which leaves a string open at the next newline, which makes the mask
unclean, which makes every strategy decline. The failure mode of the one shape it cannot
lex is **no healing at all**, which is the correct one.

## Why healing is silent

gg says nothing to the model about what it repaired. A turn carries back the fault and
nothing else — why the program did not compile, or what it threw. It does not report what
the program *did*, so there is no running commentary for a note about healing to attach
itself to in the first place.

That is a deliberate reversal. Healing used to open every repaired turn with a paragraph
naming each repair, bounding what gg was allowed to change, and explaining where prose
belongs — in the harness's own name. Three things were wrong with it:

- **It described a mechanism the model cannot act on.** Healing is not a tool it invokes,
  a setting it controls, or a behaviour it can opt out of. A prompt spends tokens on what
  the reader can do something about.
- **It named the harness on every repaired turn.** An agent is told what to do and how,
  never what is driving it.
- **It had a second contract to get wrong.** The note had to say whether the repaired
  reply then *ran* — and when it did not, because it failed to type-strip, an
  unconditional wording contradicted the very error message it opened. That shipped, and
  a model cannot act on a turn that asserts both.

What the model needs from a repaired turn is the diagnostic, which it gets. A type-strip
error is located in the **healed** source; a model told "line 4" fixes line 4, which is
the line gg compiled.

What a *study* needs is the record, and that is telemetry rather than prompt text. A
repaired reply logs an `info` line naming the strategies that fired, so a live run shows
that the program gg compiled was not byte-for-byte the one the model sent; the raw reply
is streamed and stored unmodified, so "did this model still emit a fence?" is answerable
from the transcript as well as from the counters.

## Configuration

Healing is configured in the `responses-as-code` capability's params, as a `healing`
object keyed by strategy id. **A strategy absent from the object is on.**

```jsonc
{ "id": "responses-as-code", "enabled": true,
  "params": { "timeoutSecs": 30, "maxMemoryBytes": 268435456,
              "healing": { "strip-fences": false } } }
```

| `params.healing` | Meaning |
| --- | --- |
| absent / `null` / `true` / `{}` | every strategy **on** |
| `false` | every strategy **off** — the master switch |
| `{ "strip-prose": false }` | `strip-prose` off, the other four on |
| `{ "strip-prose": 0 }` | `strip-prose` **on** — a non-boolean is not a toggle — and the key is reported |
| `{ "stripProse": false }` | every strategy on, and `healing.stripProse` is reported as unreadable |
| `5`, `"off"`, `[]` | every strategy on, and `healing` is reported as unreadable |

An unreadable key is **reported at `warn` on the run's own stream**, before the first
turn, rather than dropped: `{"stripFences": false}` would otherwise run the default arm
silently, under the disabled arm's name, and every number that ablation produced would be
a measurement of the wrong thing. No such warning ever fails a launch — a sweep's one
shared configuration document has to stay interpretable by every arm.

In the [configuration editor](/gg/configurations/) the strategies are switches on the
capability, and only the ones switched **off** are written into the saved configuration:
the underlying params are "on unless a configuration says otherwise", so writing out the
untouched ones would turn every saved configuration into an explicit opt-in that a later
default change could no longer reach.

### What switching one off actually does

The point of a toggle is the arm it creates, so each one's cost is stated plainly:

| Off | What that run then does |
| --- | --- |
| `strip-fences` | A fenced reply is compiled *with* its fence, which is not code, so the turn is a type-strip error. This is the arm that measures what a fence costs when nothing catches it. |
| `strip-prose` | A bare program with an explanatory sentence around it fails to type-strip. (No real reply has yet taken this shape: every model fenced.) |
| `drop-duplicate-program` | A reply that sent the same program twice reaches the type-strip, which refuses it as an early error naming the redeclared identifier, its line and its column. That is a good diagnostic and a lost turn: this is the arm that measures whether a model recovers from it on its own. |
| `drop-imports` | An `import` line reaches the type-strip, which refuses it and tells the model the sandbox has no module system. |
| `unwrap-async` | An `async`-wrapped program runs to its first `await` and defers the rest past its own return. Nothing names the deferred half: a program that ran is told nothing at all, so the only sign the model gets is the notice a turn earns when the program put nothing in its context — and even that is absent for a program whose synchronous prefix managed to open a view. This is the arm that measures how long a model goes on wrapping. |

Under the master switch every reply is compiled exactly as the model sent it. Healing
still runs — it canonicalises a byte-order mark and the blank lines around a reply, which
is not a repair — and repairs nothing.

## Metrics

Per **turn**, on the `code_execution` [telemetry](/gg/telemetry/) event — and omitted
entirely for a clean reply, so the presence of the object *is* "something was unusual
about this response":

```jsonc
"healing": {
  "strategies": ["strip-fences", "drop-imports"],   // in application order, repeats kept
  "didNotConverge": false                           // omitted when false
}
```

Per **run**, on the session summary's `healing` rollup, folded from that same event so
numerator and denominator can never come from different mechanisms:

| Field | What it counts |
| --- | --- |
| `healed` | Responses that had to be repaired **and then ran**. |
| `applications` | Total strategy applications — at least `healed`, since one response may need several repairs. |
| `stripFences`, `stripProse`, `dropDuplicateProgram`, `dropImports`, `unwrapAsync` | Applications of each strategy. |
| `enabled` | The strategies that were **armed** for the run, in application order. Empty means every one was off (for a code-mode run) — `executionMode` is what tells that apart from a tool-calling run, where healing never runs at all. |

`enabled` is the field that makes an ablation legible from the telemetry alone. Every
other figure here counts what *fired*, and a run in which nothing fired is byte-identical
whether its strategies were all armed or all disabled — so without it the two arms of a
study are indistinguishable in the data and the arm has to be recovered from the
invocation files that produced the runs. It is therefore **always** written, empty list and
all: a key that disappeared exactly when it meant "every strategy was off" would leave the
healing-off arm indistinguishable all over again. The same resolved set is named on the run's
launch log, beside the ceilings:

```text
response healing: strip-fences, strip-prose, drop-duplicate-program, drop-imports, unwrap-async
response healing: disabled — every strategy is off, so a reply is compiled exactly as the model sent it
```

A response is **healed** exactly when at least one repair was applied to it, since every
healed reply then runs. The denominator for every rate is `codeExecutions`, which is one
per code-shaped turn — including the turns whose reply did not compile.

Read the per-strategy counts as **what gg's pipeline did**, not as what the model wrote.
The pipeline applies its strategies in a fixed order to a fixpoint, so which strategy
gets the credit for a response several could have repaired is a property of that order.

One thing the run rollup deliberately does **not** count: a reply that defeated the
pipeline — whose repairs never reached a fixpoint, so all of them were discarded — folds
in as an ordinary response, contributing only to the denominator. That diagnosis lives on
the turn's own `didNotConverge` and on the live feed, because it describes one
pathological reply rather than a rate a study slices on. Look for it there, not in the
rollup.

### Querying them

[Result aggregation](/gg/result-aggregation/) exposes eight summary metrics —
`responses_healed`, `healing_rate`, `healing_applications` and the five per-strategy
counts. `healing_rate` is the computed one (`healed / code_executions`, absent for a run
that took no code-shaped turn), so:

```jsonc
{ "groupBy": [{ "kind": "slotModel", "slot": "primary" }],
  "metrics": [{ "metric": { "kind": "summary", "field": "healing_rate" },
                "agg": "avg" }] }
```

answers "which models still need their replies repaired?" in one query. The ablation
itself needs no new facet: a `capabilityParam` facet over
`responses-as-code` / `healing.strip-fences` resolves a dotted path through the params,
buckets a run that left the strategy at its default as **absent**, and buckets the rest
as `"true"` / `"false"`.
