---
title: "Response healing"
---

Under [responses as code](/gg/responses-as-code/) a model's **whole reply is the
program**. That contract fits in one sentence and can be broken in several ways, and real
models break it: they wrap the program in a Markdown fence, they glue a sentence onto the
closing fence — which CommonMark does not accept as a close, so the sentence becomes part of
the program — and they explain themselves above and below the code. One shape on this page is
not the model's doing at all: a provider that returns a completion which is literally the
program **followed by a byte-identical copy of itself**, with nothing between the halves.

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
   heal(reply, config, dialect)
        │            ═══════ THE SEAM ═══════
        │            above: text repair.  below: syntax.
        ▼
   prepare ──▶ instantiate ──▶ run
```

Every reply travels the whole way. **gg never asks whether a reply "is a program"** —
that question belongs to the language's own prepare step, which answers it with a located
diagnostic over the model's own text rather than with gg's reading of it. For a language
whose preparation runs a real compiler that answer can also be a *type* error rather than a
parse error; either way it is the compiler's words, not gg's. An empty reply becomes an empty
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

### The skeleton and the dialect

Healing is split along the same line the rest of gg is: a **skeleton** that is true of
every [program language](/gg/program-languages/), and a **dialect**
that answers the questions only a language can. Markdown is not a program language, so
the whole fence scanner, the candidacy ladder, the decline ladder and the prose-run scan
are skeleton; what a dialect supplies is the *data and the predicates* they consult —
which fence tags mean "this block is the program", and whether a line is certainly code or
certainly prose. The trait carries one further question of the same kind — which bytes of a
source are code as against string or comment text — that no strategy on this page asks; see
[the lexical mask](#the-lexical-mask-which-healing-does-not-ask-for) for who does.
`drop-doubled-response` is the one strategy with no dialect hook at all: it is byte
arithmetic over the reply.

The dialect is a parameter of `heal`, and the language owns its implementation
(`crates/gg/src/sandbox/language/typescript.healing.rs`), so `healing.rs` still imports
nothing from the sandbox. Every language must **re-earn** the deletion-only invariant on
its own replies rather than inherit it: a registered language contributes fixtures its own
dialect has to survive, and gg asserts the healed program is a subsequence of the reply
for each one.

Two languages may share one dialect where they share one syntax, and the two ECMAScript
arms do: [JavaScript](/gg/program-languages/#javascript-the-same-arm-unchecked) is
TypeScript with the type check removed, so every question above has the same answer on
both. A second copy giving a *different* answer would be a difference in surface in the
middle of the one study that pair exists to run.

[Python](/gg/program-languages/#python-a-guest-that-carries-its-own-interpreter) is the arm
where the answers really diverge, and it is worth reading as the shape a dialect takes when
the language underneath is genuinely different. Its program tags are its own — `python`, `py`,
`python3`, `py3` — and deliberately not `pycon` or `doctest`, each of which names an
interactive *transcript* rather than a program. Its keyword clause is matched
**case-sensitively**, which is the whole of what keeps `If you want to…` prose while `if x:` is
code. And a `#` line is **never** prose here, because `#` opens a Python comment as well as a
Markdown heading and nothing lexical tells the two apart: a model that headed its explanation
`## Plan` keeps that heading in its program, where the interpreter reads it as a comment and it
costs nothing. The alternative is deleting the model's own words, which is a deletion of code.

[Ruby](/gg/program-languages/#ruby-compiled-to-javascript-before-it-crosses) agrees with that
last answer, for the same reason restated in its own language — a Ruby comment and a Markdown
heading are the same byte — and then diverges where nothing else does. Its lexer is the largest of
the ten dialects, because Ruby has five string shapes, one of them a heredoc; the one it
deliberately does not read is the regular-expression literal, since `/…/` cannot be told from
division without a parse, so a regex carrying an apostrophe makes the scan **decline** rather than
guess.

[PureScript](/gg/program-languages/#purescript-a-compiler-in-the-image-a-library-set-in-the-binary)
is where a derived answer runs the *other* way, and it is the best illustration on this page that a
dialect is derived rather than copied. It is the first arm to **delete a `#` line**. Python and Ruby
refuse to because `# Plan` is a comment in their languages and deleting it would delete the model's
own words; PureScript comments with `--` and `{- … -}`, and `#` is `Data.Function.applyFlipped`, so
a `## Plan` left in a program is a parse error rather than a comment. Same rule — never delete a
comment, never keep a heading — opposite conclusion, because the language underneath is different.
The cost of that answer is its own carve-out: `# map trim` is a pipeline continuation, so an
*indented* single `#` applied to a lower-case name and an argument is code and is kept.

It is also the first arm to need a clause for a **call with no brackets**. PureScript applies a
function by juxtaposition, so `log "done"` and `throwError message` carry no bracket, no operator, no
keyword and no dot for a lexical test to find — where every other arm's syntax hands the scan its
call parentheses. Two answers: `"` is on this dialect's non-prose character list, which no other arm
needs, and the sentence test reads the shape English is written in (a capital at the front or
terminal punctuation at the end) rather than the tokens, which are identical to a word counter.
Both were fixed against a demonstrated deletion, not a suspicion.

[Java](/gg/program-languages/#what-its-dialect-says-and-the-two-answers-nobody-else-gives) is the
arm closest to TypeScript in syntax and therefore the best evidence that a dialect is *derived*
rather than copied: two of its answers differ, and each is the same rule reaching a different
conclusion. A `#` line **is** prose and is deleted, agreeing with PureScript against Python and
Ruby, because Java has no `#` token at all. And a **backtick** is not on the non-prose character
list, which every other C-shaped dialect puts it on: Java has no template literal, so a line
carrying one is certainly not Java and a lead-in written with an inline code span can be deleted
here where TypeScript's dialect has to keep it.

[Kotlin](/gg/program-languages/#what-its-dialect-says-and-the-two-answers-the-other-jvm-arm-does-not-give)
is the sharpest evidence of all of this, because it is the arm that could most easily have been
handed Java's dialect and moved on: the two share a compiler road, a guest and a classlib.
**Two** of the lexical answers still differ. A **backtick** goes back on the non-prose list,
because Kotlin has backquoted identifiers, so this arm may not delete the inline-code-span lead-in
Java may. And a **`;`** says almost nothing, because a Kotlin statement ends at the newline — so
the weight moves to the keyword clause, a chain-continuation clause (`.map { … }`, `?.let { … }`)
and one clause no other C-shaped arm needs, a line that carries an **assignment**, without which
`total += 1` is a line this dialect could say nothing about.

[Rust](/gg/program-languages/#what-its-dialect-says-and-the-one-answer-nobody-else-gives) gives **one**
answer no other registered arm gives, and it is the same rule reading a different grammar: **the
lexer has to tell a character literal from a lifetime**. `'a'` is a `char` and `'a` is a lifetime,
and a scan that read the `'` of `&'static str` as an opening quote would swallow the rest of the
program. The rule that resolves it — a `'` opens a literal only when one character and a closing
`'` follow — has a second effect worth having: an apostrophe in a stray line of English is ordinary
punctuation here, so a reply of prose around a program still lexes where the identical apostrophe
leaves Kotlin's scan with no mask at all.

[Swift](/gg/program-languages/#what-its-dialect-says-and-the-lexer-that-survives-text-two-others-do-not)
reaches that same place from the other direction, which is why the two are worth reading
together. Swift has **no character literal to tell anything from** — the language has none — so
its lexer needs none of Rust's reasoning about the `'`, and an apostrophe in prose is ordinary
punctuation here too. What it asks for instead is an interpolation followed through with a
**paren** count (`"total: \(rows["n"])"`) and a raw string's `#` fence counted rather than
looked for.

[C++](/gg/program-languages/#what-its-dialect-says-and-the-one-question-only-this-arm-has-to-answer)
is the arm where **`#` is two different things and case is what tells them apart**. No other dialect
has to answer it: every other one keeps `#` off its prose test and loses nothing, while here
`#include` and `#define` open the file and `# Heading` opens the reply. So `#` is not read as code
punctuation — a Markdown heading stays deletable — and a line whose `#` is followed by one of the
fourteen directive words **spelled lower-case** is code to both predicates, which makes
`# Include the manifest` prose and `#include` not. Its lexer reads a **raw string's
author-chosen fence** (`R"gg(…)gg"`) rather than looking for a quote, tells `1'000'000`'s digit
separator from a character literal by the rule that a literal cannot open where a value has just
ended, and ends a block comment at the **first** `*/`, C++ comments being the ones that do not nest.
It is also the one lexer here with two readers: a mask is handed over only when the scan ended
cleanly, and the reader that asks whether a reply defines `main` takes the best reading whatever
happened, because its errors are safe in the accepting direction.

[C#](/gg/program-languages/#what-its-dialect-says-and-the-lexer-that-reads-two-shapes-no-other-arms-does)
faces the `#` question second and answers it the same way, thirteen lower-case directive words rather
than fourteen. Its lexer reads a **raw string's fence as a run of quotes chosen by its author**
(`"""…"""`) and follows an **interpolation hole back into code**, including one holding another
string (`$"{items.First(x => $"{x}")}"`), which C# 11 admits and a scanner that stopped at the second
quote would read as three literals. It shares C++'s two-reader arrangement, and its `'` needs none of
C++'s reasoning because C# spells a digit separator `_` — what that costs is one shape and it costs
nothing, since a line of English with an apostrophe in it is a literal that never closes, and a scan
that has lost its place reports itself unclean rather than guessing.

A dialect that answers "no" to everything is legal, and gg keeps one — an **inert
dialect**, in the tests — to hold the split honest. Under it `strip-prose` goes inert,
leaving the reply's explanation exactly where the model put it; `strip-fences` narrows to
the untagged block it can recognise without help; and `drop-doubled-response` — the one
strategy that is pure skeleton — goes on working exactly as it does under any other. So a
language with no lexical rules written yet loses repairs rather than losing programs, and
nothing in the skeleton is TypeScript's rules with the labels filed off. The same cases are
run through a second, non-inert dialect, whose different fence tags and different prose test
pick a different block out of the same reply and delete a different line from it.

## The invariant that makes it honest

> **Healing only ever deletes.** Every strategy removes contiguous text; the two that
> unwrap something — `strip-fences` and `strip-prose` — additionally remove the
> indentation the body's lines share. No strategy inserts a character, moves a line,
> rewrites a token in place, or reorders anything. Therefore **the healed program, with
> whitespace removed, is a subsequence of the response with whitespace removed.**

One machine-checkable sentence that covers "never invents code" and "never reorders" for
all three strategies at once. It is enforced as a property test over the whole fixture
corpus — every captured real reply — under **every** configuration, all 2³ of them.

Because it compares only non-whitespace characters, that sentence says nothing about
indentation — so the dedent gets an invariant of its own:

> **Unwrapping moves every line by the same indent.** After `strip-fences` and
> `strip-prose`, there is a single indent that, put back in front of every non-blank line
> of the program, yields a line the model really sent.

One indent for all of them is exactly "the block moved"; two would be "gg misaligned it".
That distinction is invisible in a language that ignores leading whitespace and is a
syntax error in one where indentation is punctuation — over text the model never wrote,
against a reply that is fine — which is why it is asserted separately rather than left to
the subsequence property to imply.

Where a strategy cannot apply cleanly it **declines**: silently, leaving the text exactly
as it was. The asymmetry is deliberate. A missed repair costs one turn and a located
diagnostic; a wrong repair deletes the model's work. Only one of those is recoverable.

Dropping a byte-order mark, the blank lines around a reply and its trailing whitespace is
**canonicalisation, not repair**: a program that differs from another only in that is the
same program, so it is not counted. What is deliberately *kept* on the way in is the
**indentation of the first content line** — four spaces make an indented code block rather
than a fence, so un-indenting it there would answer a question the fence scanner exists to
ask. Indentation is Markdown's to interpret first; what is left of it once a wrapper comes
off is a question about a *program*, and that is the dedent's, below.

## The three strategies

They run in this order, repeated to a fixpoint:

```text
trim  ->  [ strip-fences -> strip-prose -> drop-doubled-response ]*
            ^                                                  |
            +------ repeat until a pass applies nothing -------+
```

Fences first, because until the wrapper is off, "is this line prose?" is a question about
the wrong text — and `strip-prose` says so itself, declining outright while an opening
fence survives. `drop-doubled-response` last, because the doubling it recognises is a
property of the **whole** text and the other two change what the whole text is: a fence
around a doubled body is not itself a doubling, and becomes one the moment the fence comes
off. Going last is what lets it see that in the same pass rather than the next.

It is a fixpoint rather than a list because a pass's output is what the next pass reads. A
fence nested inside a fence is one wrapper per pass and needs two; and a doubled reply whose
halves are each a fenced program offers `strip-fences` two candidates, so it declines — until
`drop-doubled-response` halves the reply at the end of the pass and leaves the single block the
next pass unwraps. One strategy's output enabling another's match is why the loop runs until
nothing applies.

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

*Candidacy* is a three-tier ladder, first non-empty tier wins: blocks tagged with one of
this [language](/gg/program-languages/)'s program tags — for
the two ECMAScript arms, which share one dialect, `ts`, `typescript`, `tsx`, `js`, `javascript`, `mjs`, `node` (and the rest of that closed list); for Python, `python`, `py`, `python3`, `py3`; for Ruby, `ruby` and `rb` — and deliberately not `pycon`, `doctest`, `irb` or `pry`, every one of which names an interactive *transcript* rather than a program;
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
| — | otherwise | unwrap to the single candidate's body, dedented |

**The body is dedented, not trimmed.** CommonMark lets an opening fence carry up to three
spaces, and models routinely indent a whole block under a lead-in ("1. First, run this:").
Removing only the leading whitespace of the *text* — which is what trimming a body does —
puts line 1 at the margin and leaves every line after it where the model had it. The
indentation every line shares is removed from all of them instead, so the block's internal
shape is exactly what it was.

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
*to*, and it goes to the type-strip as the model wrote it. What it does keep is
[dedented](#the-invariant-that-makes-it-honest), for the same reason an unwrapped fence
is: a lead-in that indents the program it introduces would otherwise leave the program
half-aligned.

It is deliberately severe. A line is certainly prose only when it contains none of
`` ` `` `;` `{` `}` `(` `)` `[` `]` `=` `<` `>` `|` `&` `$` `\`, contains no `//` or
`/*`, does not open with a JavaScript statement keyword, and reads like a sentence
(two or more words, one of them with a real run of letters — or a single word ended by
`.`, `!` or `?`). Real replies produced *no* bare-program-with-prose responses — every
model fenced — so a strategy with no evidence behind it gets the setting where a false
positive costs one turn and a false negative deletes the model's code.

### `drop-doubled-response`

The one strategy that is **off by default** — see
[the one strategy you have to ask for](#the-one-strategy-you-have-to-ask-for).

**Matches** a reply that is one completion concatenated with a byte-identical copy of
itself. Let `t` be the text with trailing whitespace trimmed: if `t.len()` is even and
`t[..t.len()/2] == t[t.len()/2..]`, it **rewrites** to the first half.

```text
"foo();\nbar();foo();\nbar();"   ->   "foo();\nbar();"
```

That is the whole rule. The comparison is of **exact bytes** — whitespace is not
normalised, no line structure is consulted, no token is parsed — because the defect is a
byte-exact concatenation performed by the transport, not a model that wrote something
twice. An inexact "near doubling" is the model's own text and none of this strategy's
business: it goes to the language's own prepare step as it arrived, which either refuses it
as the redeclaration it is or runs it, and either answer comes from a compiler reading the
model's own text rather than from gg's reading of it.

| # | Condition | Result |
| --- | --- | --- |
| **D1** | `t` has odd length | decline — a string of odd length cannot be `X + X` |
| **D2** | the midpoint is not a character boundary | decline — panic-safety, not a rule; see below |
| **D3** | the halves differ in any byte | decline |
| **D4** | the half is empty | decline — the only size floor there is |
| — | otherwise | keep the first half |

**D2 is panic-safety, not a heuristic.** Slicing a multi-byte UTF-8 sequence down the middle
panics, so the boundary is checked before the slice is taken. It excludes nothing a rule
would want to keep — a midpoint inside a character means the halves hold different fragments
of it, so they could not have compared equal anyway — and a later reader should not mistake
it for a guard worth relaxing.

#### The separator argument, and why almost no other guards

This is the one strategy whose warrant is *not* "the reply could not have run as sent". It
could have run: twice. So the reason it is safe has to be argued rather than asserted, and
the argument is the **separator**:

> A model that means to repeat a statement writes something between the two copies.
> `step(); step();` has a space; `step();\nstep();` has a newline. **Any odd-length
> separator makes the whole reply odd-length**, so D1 declines on arithmetic alone, before a
> single byte is compared. Two copies can only compare equal when the model emitted them
> with *no* separator at all — `step();step();` — which is not a shape models produce. The
> defect, by contrast, is exactly that: a concatenation with nothing between the copies,
> because nothing wrote a separator.

Two consequences follow and both are load-bearing:

- **No minimum length.** The observed doubling frequently happens on a run's **first** turn,
  where the program is a line or two — so any length floor worth the name would miss
  precisely the case this exists for. D4's "not empty" is the whole size rule, and it is
  there so a whitespace-only reply is not "repaired" into itself and counted.
- **No newline requirement and no minimum statement count.** A single-line reply that is an
  exact doubling is the defect, not the model's intent, for the same reason.

The arithmetic bounds what this strategy can repair, and the bound is worth stating rather
than discovering: a doubling in which **each copy ends with a newline** has odd length once
the trailing whitespace is trimmed — `2n` for two copies of `n` bytes, minus the final
newline, is `2n - 1` — so D1 declines it before a byte is compared. That is the same
separator argument read from the other side, and the cost of it is a real doubling this
strategy leaves alone. The reply then reaches its language's prepare step exactly as it
arrived, which is what every un-repaired reply gets and a better answer than a match rule
loosened until it could fire.

It applies **once** per pass, so a quadrupled reply is halved twice by the fixpoint loop, one
halving per pass: each halving leaves a shorter text on which the same match either holds
again or does not, so nothing here has to reason about how many times the transport repeated
itself.

### The lexical mask, which healing does not ask for

A [dialect](#the-skeleton-and-the-dialect) answers one further lexical question of the same
kind as the three above — which bytes of a source are code as opposed to string,
template-literal or comment text — and **no strategy on this page consults it**. It is named
here rather than left out because the method sits on the trait beside the questions healing
does ask, and a later reader who finds a dialect method the skeleton never calls should not
go looking for the call. What reads a mask is a language's own **preparation**, in four places.
Three of them are the per-language module analysis — `sandbox/language/python.modules.rs`,
`ruby.modules.rs` and `purescript.modules.rs` — which lists what a
[code module](/gg/skills/#code-skills) offers or imports, and must not read an `import` written
into a string, or a `def` written into a heredoc, as the statement it spells. The fourth is
`swift.source.rs`, which takes that arm's mask on exactly healing's terms — declining when the
scan does — to read a module's top-level declarations at brace depth zero, so a module and a
program are read by one lexer rather than two.

Two further arms share the *lexer* rather than the mask it produces, and those are the
two-reader arrangements named above. `cpp.source.rs` reaches past the mask to the scan beneath
it, because *does this reply define `main`* wants the best reading whatever happened where
healing wants none at all; C# builds the same pair from the other end, its scan living with the
source analysis and its dialect deriving a mask from it. That is the whole set: outside healing
nothing else reads a mask or the lexer beneath one, and not one of the readers is a strategy.

The mask handles `'…'`, `"…"`, `` `…` `` with `${ … }` substitutions re-entering code,
`//…`, `/*…*/` and backslash escapes. Three states end a scan uncleanly — an unterminated
block comment, an unterminated template literal, and a quoted string still open at a newline
— and a dialect answers with nothing at all for each of them, rather than hand over a reading
it already knows is wrong.

It deliberately does not lex **regular-expression literals**: telling `/` as division
from `/` as the start of a regex needs parser context, which is the very thing the mask
exists to avoid. A regex containing a quote (`str.replace(/don't/g, "")`) therefore
desyncs the scan, which leaves a string open at the next newline, which makes the mask
unclean, which leaves its caller without one. The failure mode of the one shape it cannot
lex is **no answer at all**, which is the correct one.

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

Healing only ever gets a reply as far as *preparation*, and for a language that checks its
programs that is two passes, not one. A repaired reply that survives the strip is still put
through the [type check](/gg/responses-as-code/#stripped-and-checked), so a repair can be
followed by a compile error rather than by a run — the strip's arms below name the failure
they cause first, not the only failure left.

What a *study* needs is the record, and that is telemetry rather than prompt text. A
repaired reply logs an `info` line naming the strategies that fired, so a live run shows
that the program gg compiled was not byte-for-byte the one the model sent; the raw reply
is streamed and stored unmodified, so "did this model still emit a fence?" is answerable
from the transcript as well as from the counters.

## Configuration

Healing is configured in the `responses-as-code` capability's params, as a `healing`
object keyed by strategy id. The object is a **delta against the defaults**, not a whole
configuration: **a strategy absent from it takes its own default.**

```jsonc
{ "id": "responses-as-code", "enabled": true,
  "params": { "timeoutSecs": 30, "maxMemoryBytes": 268435456,
              "healing": { "strip-fences": false, "drop-doubled-response": true } } }
```

| `params.healing` | Meaning |
| --- | --- |
| absent / `null` / `true` / `{}` | **the defaults** — the two on, `drop-doubled-response` off |
| `false` | every strategy **off** — the master switch |
| `{ "strip-prose": false }` | `strip-prose` off, the rest at their defaults |
| `{ "drop-doubled-response": true }` | `drop-doubled-response` **on**, the rest at their defaults |
| `{ "strip-prose": 0 }` | `strip-prose` at its default — a non-boolean is not a toggle — and the key is reported |
| `{ "stripProse": false }` | the defaults, and `healing.stripProse` is reported as unreadable |
| `5`, `"off"`, `[]` | the defaults, and `healing` is reported as unreadable |

Rows three and four are the same mechanism read in two directions: `false` is how a
default-on strategy is turned off and `true` is how the default-off one is turned on, and
both travel through the same line of code. There is no second way to arm a strategy, which
is what keeps that table a description of the implementation rather than a summary of it.

An unreadable key is **reported at `warn` on the run's own stream**, before the first
turn, rather than dropped: `{"stripFences": false}` would otherwise run the default arm
silently, under the disabled arm's name, and every number that ablation produced would be
a measurement of the wrong thing. No such warning ever fails a launch — a sweep's one
shared configuration document has to stay interpretable by every arm.

In the [configuration editor](/gg/configurations/) the strategies are switches on the
capability, and only the ones that **differ from their default** are written into the saved
configuration: the underlying params are a delta, so writing out the untouched ones would
turn every saved configuration into an explicit opt-in that a later default change could no
longer reach.

### The one strategy you have to ask for

Two of the three are armed by default. The rule is **a strategy is armed by default when
repairing is strictly safer than not repairing**, and for both the warrant is the same: *the
reply the strategy deletes from could not have run as sent*. A fenced reply is not a program
in any language; nor is one with prose around it. Declining to repair either of those costs
the turn outright, so the default that loses least is *on*.

`drop-doubled-response` is the exception, and the asymmetry is real rather than an
abundance of caution: **the half it deletes is valid code under any reading other than "the
transport duplicated this."** A reply that runs its program twice is a reply that runs — so
where the other two turn a dead reply into a live one, this one changes what a live
reply *does*. The
[separator argument](#the-separator-argument-and-why-almost-no-other-guards)
is why the match rule is nonetheless safe with almost no guards; it is not a reason to arm a
repair on every model when only some exhibit the defect. So it is armed **deliberately**,
per run, by an operator who has seen it — and the default arm every study compares against
stays the one gg has always had.

Under the master switch (`"healing": false`) it is off with everything else. A master
switch that armed a default-off strategy would not be a master switch.

### What switching one off actually does

The point of a toggle is the arm it creates, so each one's cost is stated plainly:

| Off | What that run then does |
| --- | --- |
| `strip-fences` | A fenced reply is compiled *with* its fence, which is not code, so the turn is a type-strip error. This is the arm that measures what a fence costs when nothing catches it. |
| `strip-prose` | A bare program with an explanatory sentence around it fails to type-strip. (No real reply has yet taken this shape: every model fenced.) |

`drop-doubled-response` is read the other way round, since its default is the off arm. **On**,
a duplicated completion becomes the program the model wrote once and the turn proceeds
normally. **Off** — which is what a run says by not mentioning it — the doubled reply is
compiled whole: sometimes that is a type-strip error naming a redeclared identifier, and
sometimes, for a body of bare statements, it is a program that runs and does every piece of
its work **twice**. The second is the reason the strategy exists, and it is also why the
arm it creates is worth measuring: the run does not obviously fail, it silently does
everything twice.

Under the master switch every reply is compiled exactly as the model sent it. Healing
still runs — it canonicalises a byte-order mark and the blank lines around a reply, which
is not a repair — and repairs nothing.

## Metrics

Per **turn**, on the `code_execution` [telemetry](/gg/telemetry/) event — and omitted
entirely for a clean reply, so the presence of the object *is* "something was unusual
about this response":

```jsonc
"healing": {
  "strategies": ["strip-fences", "strip-prose"],    // in application order, repeats kept
  "didNotConverge": false                           // omitted when false
}
```

Per **run**, on the session summary's `healing` rollup, folded from that same event so
numerator and denominator can never come from different mechanisms:

| Field | What it counts |
| --- | --- |
| `healed` | Responses that had to be repaired **and then ran**. |
| `applications` | Total strategy applications — at least `healed`, since one response may need several repairs. |
| `stripFences`, `stripProse`, `dropDoubledResponse` | Applications of each strategy. |
| `enabled` | The strategies that were **armed** for the run, in application order. Empty means every one was off (for a code-mode run) — `executionMode` is what tells that apart from a tool-calling run, where healing never runs at all. |

`enabled` is the field that makes an ablation legible from the telemetry alone. Every
other figure here counts what *fired*, and a run in which nothing fired is byte-identical
whether its strategies were all armed or all disabled — so without it the two arms of a
study are indistinguishable in the data and the arm has to be recovered from the
invocation files that produced the runs. It is therefore **always** written, empty list and
all: a key that disappeared exactly when it meant "every strategy was off" would leave the
healing-off arm indistinguishable all over again. `dropDoubledResponse` is written by every
run that records a rollup at all, including the runs that predate it, which read it as the
`0` those runs' pipelines really did apply. The same resolved set is named on the run's
launch log, beside the ceilings:

```text
response healing: strip-fences, strip-prose
response healing: strip-fences, strip-prose, drop-doubled-response
response healing: disabled — every strategy is off, so a reply is compiled exactly as the model sent it
```

The first of those is the **default** arm, not "everything on" — a run that says nothing
about healing prints exactly that line, and the second is what a run that armed the extra
strategy prints. The two are one strategy apart on purpose: the difference between them is
the whole ablation.

A response is **healed** exactly when at least one repair was applied to it, since every
healed reply then runs. The denominator for every rate is `codeExecutions`, which is one
per code-shaped turn — including the turns whose reply did not compile.

It also includes the turns whose **compiler could not finish**, and those say nothing about
healing at all. A `toolchain_failed` turn is one where the language's compiler crashed, was
killed by its timeout, or was missing from the image: nothing read the reply, so it is
neither evidence that a repair failed nor evidence that one was needed. When an ablation
arm's compiler is flaky, read its healing rates against
[`errors.toolchain`](/gg/telemetry/) before reading them against each other.

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

The whole rollup is flattened into the [query language](/gg/analysis/query-language/)'s
run document, so every **counter** above is a queryable name — `summary.healing.healed`,
`summary.healing.applications`, and one per strategy — with no metric enum to extend when a
strategy is added. (`enabled` is a list, and a list contributes only its length, as
`summary.healing.enabled.count`; which strategies those were is a question for the run, not
for an aggregate.)

```text
has.summary:true | stats avg(summary.healing.healed) as healed by model
```

answers "which models still need their replies repaired?" in one query. The rate is
`healed / codeExecutions` and is deliberately not stored as a third field, for the same
reason [no error percentage is](/gg/telemetry/#the-run-rollup): a figure that can disagree
with its own denominator is worse than one the reader divides.

The ablation itself needs nothing new either. A capability's params are flattened into the
same document, so each strategy's declaration is its own field under
`cap.responses-as-code.healing.<strategy>` — and because absent means absent, a run that
left the strategy at its default falls out of the comparison rather than being counted as a
value it never declared. Note which arm that is: for the two default-on strategies the
absent bucket is *on*, and for `drop-doubled-response` it is *off*. That inversion is the
whole reason the strategy's default is worth stating twice.
