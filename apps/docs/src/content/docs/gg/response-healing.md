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
**disclosed to the model** in the same turn's feedback and **counted on the run**, so
"how often did this model still send a fence after being told not to?" is a number a
study can group by. That count is the point: the ablation this capability exists to run
is about how well models follow a code-only contract, and a repair the model is never
told about teaches it nothing and corrupts the measurement.

## The seam

```text
the model's reply, unmodified   ── streamed as its assistant_message, pushed to the context
        │
        ▼
   heal(reply, had_tool_calls, config)
        │                      ═══════ THE SEAM ═══════
        │                      above: text repair.  below: syntax.
        ├─ verdict = not a program ──▶ an error turn, fed back; the sandbox is never entered
        └─ verdict = program
                 ▼
          oxc type-strip ──▶ instantiate ──▶ run
```

The raw reply is what gg streams and stores: healing never touches the recorded
assistant message, so "did this model still emit a fence?" is answerable from the
transcript as well as from the counters.

Healing owns **"was this a program at all?"**; the type-strip owns **"is this program
valid?"**. Keeping them apart is what lets a not-a-program verdict short-circuit before
any engine work — no component, no store, no timer — and what lets every rule on this
page be a microsecond-scale unit test with no wasm behind it. The module
(`crates/gg/src/healing.rs`) does no I/O, reads no clock, is not `async`, and imports
nothing from the sandbox; turning a strategy off changes only what one pure function
returns, which is what makes the ablation honest.

There is exactly **one** hand-back across the seam, and it is forced by measurement
rather than taste: a reply that failed to type-strip and contains **no code-shaped line**
is reclassified as prose (see [below](#the-six-not-a-program-reasons)). It is the modal
real failure, and answering it with a syntax error the model is asked to fix — rather
than with "that was not a program; call `finish` if you meant to stop" — is what made
one real session unrecoverable.

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
all six strategies at once. It is enforced as a property test over the whole fixture
corpus — every captured real reply — under **every** configuration.

Where a strategy cannot apply cleanly it **declines**: silently, leaving the text exactly
as it was. The asymmetry is deliberate. A missed repair costs one turn and a located
diagnostic; a wrong repair deletes the model's work. Only one of those is recoverable.

Dropping a byte-order mark, the blank lines around a reply and its trailing whitespace is
**canonicalisation, not repair**: a program that differs from another only in that is the
same program, so it is neither disclosed nor counted. What is deliberately *kept* is the
**indentation of the first content line** — four spaces make an indented code block rather
than a fence, so un-indenting it here would answer a question the fence scanner exists to
ask.

## The six strategies

They run in this order, repeated to a fixpoint, with the classifier last:

```text
trim  ->  [ strip-fences -> strip-prose -> drop-duplicate-program
            -> drop-imports -> unwrap-async ]*  ->  strip-comment-only
              ^                                 |
              +---- repeat until a pass applies nothing +
```

Fences first, because until the wrapper is off, "is this line prose?" and "is this line
an import?" are questions about the wrong text. Prose before duplicates, so the two
copies of a program are adjacent when they are compared. Duplicates before imports and
async, so a doubled reply is halved before either of those looks at it. Imports before
async, because a leading `import` line is exactly what makes `unwrap-async` decline —
one strategy's output enabling another's match is why this is a fixpoint and not a list.
Comment-only last, because it classifies whatever survived.

A **not-a-program verdict short-circuits immediately**: no later strategy runs, so what
the model is told about is the text as it stood when classification stopped. The
fixpoint is bounded at four passes; measured, no real reply needs more than one and the
deepest shape in the corpus (a fence nested in a fence) needs two. If that bound is ever
reached, **every repair is discarded**, the reply runs exactly as it was sent, the run
logs a `warn`, and the turn's record carries `didNotConverge` — because the alternative
(an untouched program and an empty repair list) is byte-identical to a clean response,
and reporting the one pathological reply as "nothing was unusual" is the kind of quiet
lie this subsystem exists to remove.

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
| **D2** | **two or more candidates** | not a program (`several_blocks`); nothing rewritten, nothing recorded, the pipeline short-circuits |
| **D3** | exactly one candidate, but a line **outside the fences** is certainly code | decline **silently** — unwrapping would delete real code |
| **D4** | zero candidates | not a program (`no_program_block`) when no line outside a block is code; otherwise decline silently |
| — | otherwise | unwrap to the single candidate's body |

**D2 outranks D3** because a reply offering gg several candidate programs is a plain
contract violation whatever else is in it, and the tailored feedback is what teaches the
model. Under the reverse order the worst real reply measured — seven candidate blocks
inside 9,800 bytes of narration — would decline silently, record nothing, serialise as a
*clean* response, and send a page of Markdown to the type-strip.

**D3 asks about every line outside the fences**, not only those above the first one. What
tells a fence *inside* a program from a fence *around* one is whether real code survives
outside it, and that code sits below the block as often as above it: a model that fences
the working half of its program and writes `finish("…")` underneath has written one
program across a fence. An unwrap keeps only the candidate block's body — and its
disclosure counts other *blocks*, not outside lines — so unwrapping there would delete the
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
still there. When removal would leave nothing, the reply *was* prose and is classified as
such.

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

This is the fence-free counterpart of `strip-fences`' several-candidates verdict. With
fences gone from the contract, a model that drafts two programs has nothing left to
separate them with, and it pastes the second after the first. Where the two halves are
*not* identical there is nothing safe to delete, so the same strategy **classifies**
instead: a reply that declares the same top-level name more than once is
[`several_blocks`](#the-six-not-a-program-reasons) in its bare shape, counted by cutting the
reply at every redeclaration, and the model is told what it actually sent rather than being
handed a redeclaration message that never mentions the real mistake.

Two different drafts that declare *different* names are neither repaired nor refused: that
is a legal program with a dead tail, it runs, and the
[type-strip](/gg/responses-as-code/) is what reports the half that could not run.

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
broken, the reply is simply a program that does nothing, and the turn feedback says so.
Unwrapping it would not repair anything; it would *execute* statements the response never
asked to execute, and it would make `async` the difference between a forgotten call doing
nothing and a forgotten call deleting a directory.

### `strip-comment-only`

Classifies a reply whose bytes, minus comments and whitespace, are empty. It rewrites
nothing. It exists because a comment-only program type-strips *cleanly*, runs, returns
nothing, and produces a turn that looks like a success — the worst available outcome,
because the model then believes it did something.

### The lexical mask, and the one thing it cannot lex

`drop-imports`, `unwrap-async` and `strip-comment-only` each work over a mask of which
bytes are code as opposed to string, template-literal or comment text. It handles `'…'`,
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

## The six not-a-program reasons

A reply that is not a program is an **error turn**, never a completion. gg feeds it back
naming the shape it sent, saying that nothing ran and nothing changed, and telling the
model that only `finish` ends the run.

| Reason | What it is |
| --- | --- |
| `empty` | Nothing but whitespace. |
| `tool_calls_only` | No text at all, but the response carried native tool calls — a reflex some providers push even when no tools are offered. Telling such a model its reply was "empty" would describe something it did not do. |
| `prose` | Nothing in the reply was code. |
| `comment_only` | Comments and whitespace only. |
| `no_program_block` | The reply is fenced blocks, none of which gg reads as a program. |
| `several_blocks` | The reply offered more than one program, so none of them ran; the count and the shape it was counted in both ride along on the record. Two shapes reach it: several fenced candidate blocks, and — the shape real models send now that fences are gone from the contract — one program pasted after another, which declares the same top-level name twice and could therefore never have run. The two are told apart in the words the model is shown, because a model that sent no fence cannot act on a sentence about the code blocks it did not write, and on the record, because they are different failures a study must be able to count separately. |

`prose` is reached two ways, and the second is the one that fires on real replies. The
`strip-prose` predicate has to be severe, because that strategy *deletes* — and applied
to the real terminal prose replies models actually send, it matches **none** of their
lines. The classification that does fire deletes nothing: a source that failed to
type-strip and contains no **certainly-code** line was never a program. That predicate is
safe precisely because it is only ever used to classify: measured against the captured
replies it matches 0 of 7 lines across the terminal prose ones and at least one line in
every real program. A real program has a code-shaped line by construction.

Two reasons — `empty` and `tool_calls_only` — are **not gated on any strategy**. Even
with healing switched off entirely, an empty reply is still not a program: reading an
empty string as "nothing to run" is not a repair, it is reading it correctly, and the
alternative is that the off arm of an ablation type-strips the empty program, runs it to
a silent success, and loops forever on a model that has stopped answering.

## Disclosure

Every repair is stated to the model, in the same turn, at the top of **all four** code
feedback templates — the one that ran, the one that did not compile, the one the sandbox
stopped, and the one that was not a program. It has to appear on all four because what
healing did happened to the model's *message*, not to its program:

```text
gg repaired your reply before running it:
- removed the Markdown code fence you wrapped it in — its closing fence had text on the
  same line, which does not close a fence, so everything after it would otherwise have
  been read as part of your program
Only text was removed — nothing was added, and nothing was reordered. Your whole reply is
the program, so you can send the TypeScript on its own: anything you want to say belongs
in a `console.log(…)`, or in the summary you pass to `finish(…)`.
```

The note teaches rather than nags by doing three things and no others: it says what was
changed, it **bounds** what gg is allowed to change (so the model can trust the rest of
its program), and it says where the prose it wanted to write actually belongs. There is
no "you must not", no repetition of the rule, and no tally of previous offences.

The clause is written per repair, with its own counts — *"removed 2 lines of explanation
before your program and 1 after it"*, *"removed 1 import line — every tool is already in
scope, and there is nothing to import"*, *"unwrapped the async function you wrapped your
program in, and removed its 3 awaits — every tool function is synchronous and returns its
value directly"*. Where a repair implies something the model got wrong about the surface,
the clause says so once.

Disclosure also reaches the **operator**: a repaired reply logs an `info` line naming the
strategies that fired, so a study watching a live run can see that the program gg
compiled was not byte-for-byte the one the model sent, without waiting for the closing
rollup.

Because the model reads a type-strip diagnostic against the program gg actually compiled
— located to a line and column of the **healed** source — the disclosure is what lets it
reconcile the two. A model told "line 4" *and* "a fence was stripped from the top of your
reply" can find its mistake; one told only "line 4" cannot.

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
| `strip-fences` | A fenced reply is compiled *with* its fence, which is not code, so the turn is a type-strip error — and a multi-block reply is no longer refused with the tailored "which of these did you mean?" feedback either; the whole thing goes to the type-strip. This is the arm that measures what a fence costs when nothing catches it. |
| `strip-prose` | A bare program with an explanatory sentence around it fails to type-strip, or — if none of it is code-shaped — is classified as prose. (No real reply has yet taken this shape: every model fenced.) |
| `drop-duplicate-program` | A reply that sent the same program twice reaches the type-strip, which refuses it as an early error naming the redeclared identifier, its line and its column. That is a good diagnostic and a lost turn: this is the arm that measures whether a model recovers from it on its own. |
| `drop-imports` | An `import` line reaches the type-strip, which refuses it and tells the model the sandbox has no module system. |
| `unwrap-async` | An `async`-wrapped program runs to its first `await` and defers the rest past its own return, so the turn reports a program that did almost nothing — and says so, since deferred work is noticed and named. |
| `strip-comment-only` | A comments-only reply type-strips cleanly, runs, returns nothing, and reports a **silent success** — precisely the cost that strategy exists to measure. |

`empty` and `tool_calls_only` still classify under every arm, including the master
switch's, for the reason given [above](#the-six-not-a-program-reasons).

## Metrics

Per **turn**, on the `code_execution` [telemetry](/gg/telemetry/) event — and omitted
entirely for a clean reply, so the presence of the object *is* "something was unusual
about this response":

```jsonc
"healing": {
  "strategies": ["strip-fences", "drop-imports"],   // in application order, repeats kept
  "notAProgram": "several_blocks",                  // absent when the reply ran
  "blocks": 7,                                      // only alongside several_blocks
  "candidateShape": "fenced",                       // "fenced" or "bare"; present with blocks
  "didNotConverge": false                           // omitted when false
}
```

`blocks` counts **candidate programs**, and counts the same thing in both shapes so the two
are comparable: the candidate blocks of a fenced reply, and the segments a bare reply's
top-level redeclarations cut it into. The bare figure is a **lower bound** — five programs
that share one name between two of them count as two, because two is all the reply proves —
and never an over-count, so an aggregate of it reads "at least this many programs per
offending reply". `candidateShape` is what keeps the two apart: a fenced reply is a model
still formatting a reply it was told not to format, a bare one is a model sending two
answers in one turn, and those are different mistakes with different fixes.

Per **run**, on the session summary's `healing` rollup, folded from that same event so
numerator and denominator can never come from different mechanisms:

| Field | What it counts |
| --- | --- |
| `healed` | Responses that had to be repaired **and then ran**. |
| `applications` | Total strategy applications — at least `healed`, since one response may need several repairs, and possibly more, since a classification is an application too. |
| `stripFences`, `stripProse`, `dropDuplicateProgram`, `dropImports`, `unwrapAsync`, `stripCommentOnly` | Applications of each strategy. |
| `notAProgram` | Responses that were not programs at all, and so never ran. |
| `severalBlocks` | Of those, the ones that offered more than one program — a subset of `notAProgram`, never an alternative to it, and exactly the sum of the two below. |
| `severalBlocksFenced`, `severalBlocksBare` | The same count split by `candidateShape`, so a study can ask which of the two mistakes a model makes without re-deriving it from every turn's record. |
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
response healing: strip-fences, strip-prose, drop-duplicate-program, drop-imports, unwrap-async, strip-comment-only
response healing: disabled — every strategy is off, so a reply is compiled exactly as the model sent it
```

A response is **healed** exactly when repairs were applied *and* it then became a
program. A response that was only *classified* was repaired of nothing, because nothing
ran: it counts an application without counting a heal. The denominator for every rate is
`codeExecutions`, which is one per code-shaped turn — including the turns whose reply was
not a program.

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

[Result aggregation](/gg/result-aggregation/) exposes thirteen summary metrics —
`responses_healed`, `healing_rate`, `healing_applications`, the six per-strategy counts,
`responses_not_a_program`, `responses_several_blocks` and its two per-shape splits
`responses_several_blocks_fenced` and `responses_several_blocks_bare`. `healing_rate` is the
computed one (`healed / code_executions`, absent for a run that took no code-shaped turn), so:

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
